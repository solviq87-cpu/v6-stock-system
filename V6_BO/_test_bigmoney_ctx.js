// 离线确定性验证：大单流入池「分辨下跌途中接盘 vs 趋势中加仓」「分辨冷门板块」
// 用户原话（2026-09-30）：「大单流入 的下跌趋势中有大单流入也正常 而且还是些冷门板块 你要注意分辨」
// 实测原型：面板 12 只里 9 只在下跌趋势中、12/12 全是冷门 —— 本测试把这两条锁死，
// 以后谁再改回「纯按主力净占比降序」都会红。
// 不依赖网络：K 线是构造的，板块快照是注入的，排序块从 server.js 源码里原样抓出来跑。
const fs = require('fs');
const path = require('path');
const A = require('./analysis');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// ---------- 源码抓取（花括号配平，避免按行抓出残片） ----------
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
function grabBlock(startStr, endStr) {
  const a = src.indexOf(startStr), b = src.indexOf(endStr, a);
  if (a < 0 || b < 0) throw new Error('找不到块：' + startStr);
  return src.slice(a, b + endStr.length);
}
// 打分 + 排序（不含后面的权重股配额与截断 —— 那两块单独测）
const SRC_RANK = grabBlock('  for (const x of list) {', '((b.mainInflow || 0) - (a.mainInflow || 0)));');
// 权重股配额块：从 const HEAVY_MAX 到重排完成
const SRC_HEAVY = grabBlock('  const HEAVY_MAX = 4, TOTAL = 12;', '((b.mainPct || 0) - (a.mainPct || 0)));\n');
const SRC_CACHE = (src.match(/^let _secRankCache = .*$/m) || [''])[0];
const SRC_RANKMAP = grab(/^function sectorRankMap\(\) \{/m);
// ⛔ 2026-10-07 补注入（ct 轮新增依赖）：sectorOfStock 现在靠 pickTopSector 挑"最强板块"，
//    沙箱注入清单漏了它 → ReferenceError 被第四层的 try/catch 吞掉 → 板块归属静默变"未知"
//    （不报错、不算错，只是"没查出来"，正是这套测试要防的假象）。
const SRC_PTS = grab(/^function pickTopSector\(names\) \{/m);
const SRC_HEAT = grab(/^function sectorHeat\(sec\) \{/m);
const LINE_BADCTX = (() => {
  const m = src.match(/^\s*const badCtx = x =>.*$/m);
  if (!m) throw new Error('找不到 badCtx');
  return m[0];
})();

// ---------- 构造 K 线（60 根） ----------
// up        匀速上行 10→15.9         → 趋势中加仓（回撤小）
// upfast    急拉 10→24.75            → 贴 60 日高点（高位派发风险）
// peak_fall 先冲高 10→29.5 再回落 20 天 → 下降通道，但仍站在 60 日线上 → 下跌途中接盘
// crash     平 30 天后急跌 30 天       → 深跌后承接
// vshape    冲高→深回→再抬起来         → 回踩承接（趋势未破但回撤 >12%）
// rise_pull 涨 55 天后小幅回落 5 天     → 震荡整理（跌破 20 日线但 20 日线仍向上）
function closes(mode, n = 60) {
  const a = [];
  for (let i = 0; i < n; i++) {
    let c;
    if (mode === 'up') c = 10 + i * 0.1;
    else if (mode === 'upfast') c = 10 + i * 0.25;
    else if (mode === 'peak_fall') c = i < 40 ? 10 + i * 0.5 : 29.5 - (i - 39) * 0.15;
    else if (mode === 'crash') c = i < 30 ? 10 : 10 - (i - 29) * 0.13;
    else if (mode === 'vshape') c = i < 30 ? 10 + i * 0.6 : (i < 45 ? 27.4 - (i - 29) * 0.75 : 16.15 + (i - 44) * 0.35);
    else if (mode === 'rise_pull') c = i < 55 ? 10 + i * 0.4 : 31.6 - (i - 54) * 0.42;
    else c = 10;
    a.push(+c.toFixed(3));
  }
  return a;
}
function mkRows(mode, alt = false) {
  return closes(mode).map((c, i) => {
    const r = {
      date: '2026-0' + (1 + (i % 9)) + '-' + String((i % 28) + 1).padStart(2, '0'),
      open: c, high: +(c * 1.01).toFixed(3), low: +(c * 0.99).toFixed(3),
      volume: 1e6, amount: 1e8, pct: 0
    };
    // alt=true 只写老字段名 c/h/l —— 验证多名字兼容（v1 只认 r.c 导致维度全常数，见 learnall 事故）
    if (alt) { r.c = c; r.h = r.high; r.l = r.low; r.v = r.volume; } else { r.close = c; }
    return r;
  });
}
const ctx = (mode, price, alt) => A.bigMoneyContext({ rows: mkRows(mode, alt), price });

// ══════════ ① 大单性质判别 ══════════
console.log('\n【① 大单性质：这笔钱在什么位置进的】');
{
  // 冲高后回落 20 天：20 日线向下、现价在其下方 → 明确的下降通道
  const c = ctx('peak_fall', 26.0);
  ok('下降通道 → 下跌途中接盘（不是买入信号）', c && c.flowKind === '下跌途中接盘', JSON.stringify(c && c.flowKind));
  ok('下跌途中接盘权重最低 = 0.25', c && c.weight === 0.25, String(c && c.weight));
  ok('note 明说"护盘/接盘/对倒，不是买入信号"', !!(c && /护盘|接盘|对倒/.test(c.note)), c && c.note);
  ok('downTrend=true / aboveMa20=false / ma20up=false',
    !!(c && c.downTrend === true && c.aboveMa20 === false && c.ma20up === false),
    `${c && c.downTrend}/${c && c.aboveMa20}/${c && c.ma20up}`);
}
{
  const c = ctx('crash', 5.8);
  ok('深跌（距60日高>28%）→ 深跌后承接', c && c.flowKind === '深跌后承接', JSON.stringify(c && c.flowKind));
  ok('回撤 dd60 真实算出且 >28%', !!(c && c.dd60 > 28), String(c && c.dd60));
  ok('note 写明"需二次确认"', !!(c && /二次确认/.test(c.note)), c && c.note);
  ok('深跌同时踩中"仍在60日线下"风险 → 权重再打 0.7 折（0.40→0.28）',
    !!(c && c.weight === 0.28 && (c.risks || []).some(t => /反弹而非反转/.test(t))),
    `${c && c.weight} / ${JSON.stringify(c && c.risks)}`);
}
{
  const c = ctx('up', 15.3);
  ok('上升通道 → 趋势中加仓', c && c.flowKind === '趋势中加仓', JSON.stringify(c && c.flowKind));
  ok('趋势中加仓权重满分 = 1.00', c && c.weight === 1, String(c && c.weight));
  ok('aboveMa20 / aboveMa60 均为 true', !!(c && c.aboveMa20 === true && c.aboveMa60 === true));
  ok('note 明说"资金与趋势同向"', !!(c && /资金与趋势同向/.test(c.note)), c && c.note);
}
{
  const c = ctx('vshape', 21.4);
  ok('趋势未破但回撤 >12% → 回踩承接', c && c.flowKind === '回踩承接', JSON.stringify(c && c.flowKind));
  ok('回踩承接权重 = 0.85（低于加仓、高于震荡）', c && c.weight === 0.85, String(c && c.weight));
  ok('回撤 dd60 > 12% 且仍站上 20/60 日线',
    !!(c && c.dd60 > 12 && c.aboveMa20 === true && c.aboveMa60 === true), `${c && c.dd60}`);
}
{
  const c = ctx('rise_pull', 28.8);
  ok('跌破20日线但20日线仍向上 → 震荡整理', c && c.flowKind === '震荡整理', JSON.stringify(c && c.flowKind));
  ok('震荡整理权重 = 0.60（中性）', c && c.weight === 0.6, String(c && c.weight));
}
{
  const a = ctx('peak_fall', 26.0, false), b = ctx('peak_fall', 26.0, true);
  ok('K 线老字段名 c/h/l 与 close/high/low 结果一致（防 v1 常数维度事故）',
    !!a && !!b && a.flowKind === b.flowKind && a.ma20 === b.ma20 && a.dd60 === b.dd60 && a.weight === b.weight,
    `${a && a.flowKind}/${a && a.ma20}/${a && a.dd60} vs ${b && b.flowKind}/${b && b.ma20}/${b && b.dd60}`);
}
{
  ok('K 线不足 25 根 → 判不出来就返回 null，不瞎给结论',
    A.bigMoneyContext({ rows: mkRows('up').slice(-10), price: 15 }) === null);
  ok('rows 为空 → null', A.bigMoneyContext({ rows: [], price: 15 }) === null);
}

// ══════════ ② 风险修饰项 ══════════
console.log('\n【② 风险修饰：高位 / 仍在60日线下】');
{
  const c = ctx('upfast', 24.63);   // 贴着最高点，近20日 +24.7%
  ok('贴 60 日高点 → atHigh=true', !!(c && c.atHigh === true), String(c && c.atHigh));
  ok('risks 含"警惕拉高出货"', !!(c && (c.risks || []).some(t => /拉高出货/.test(t))), JSON.stringify(c && c.risks));
  ok('高位只打折、不改性质名（仍是趋势中加仓）', !!(c && c.flowKind === '趋势中加仓'), c && c.flowKind);
  ok('高位权重被打折（1.00×0.85=0.85）', !!(c && c.weight === 0.85), String(c && c.weight));
}

// ══════════ ③ 板块冷热 ══════════
console.log('\n【③ 板块冷热：主线 vs 冷门】');
const S = { sectors: [], ztBySector: {} };
const rankMap = new Function('S', `${SRC_CACHE}\n${SRC_RANKMAP}\n return sectorRankMap;`)(S);
const heat = new Function('S', 'sectorRankMap', 'sectorZTCountFor',
  `${SRC_HEAT}\n return sectorHeat;`)(S, rankMap, () => 0);
{
  // 资金榜：券商第1、军工第2、…、纺织第80（冷门）
  for (let i = 1; i <= 80; i++) S.sectors.push({ name: '板块' + i, mainInflow: 1e9 - i * 1e7 });
  S.sectors[0].name = '券商'; S.sectors[1].name = '军工'; S.sectors[79].name = '纺织';
  S.ztBySector = { '军工': ['a', 'b', 'c'] };
  const h1 = heat('军工');
  ok('板块内有 3 只涨停 → 热门（主线）', !!(h1 && h1.hot === true && h1.ztN === 3), JSON.stringify(h1));
  ok('热门标签写明"3只涨停"', !!(h1 && /3只涨停/.test(h1.label)), h1 && h1.label);
  const h2 = heat('券商');
  ok('无涨停但在资金榜第 1 → 仍算热门', !!(h2 && h2.hot === true && h2.rank === 1), JSON.stringify(h2));
  const h3 = heat('纺织');
  ok('资金榜第 80 → 冷门', !!(h3 && h3.hot === false && h3.cold === true && h3.rank === 80), JSON.stringify(h3));
  ok('冷门标签带"冷门"字样（面板上要看得见）', !!(h3 && /冷门/.test(h3.label) && /冷门/.test(h3.short)), h3 && h3.short);
  const h4 = heat('未知');
  ok('板块未知 → 判冷门且 unknown=true（大盘股多是这个）', !!(h4 && h4.cold === true && h4.unknown === true), JSON.stringify(h4));
  ok('冷门只标注不删除（仍会进榜，交给排序降权）', !!(h3 && h3.cold === true));
}

// ══════════ ④ 加权重排 ══════════
console.log('\n【④ 名次 = 净占比 × 位置权重 × 板块冷热】');

// ⛔ dh 轮补注入（第 16 次同类坑）：中性值已收进 MISS_RULE 表、读取走 missingOf，
//    沙箱少了这一段就是 ReferenceError —— 不是变红，是整个套件崩掉。
const MISS_SRC = (() => {
  const i = src.indexOf('const MISS_RULE = {');
  return src.slice(i, src.indexOf('let _rollbackMsg = null;', i));
})();

const rank = new Function('list', `${MISS_SRC}\n${SRC_RANK}\n return list;`);
const mk = (code, mainPct, c, h) => ({ code, mainPct, mainInflow: 1e8, ctx: c, heat: h });
const HOT = { hot: true, cold: false }, COLD = { hot: false, cold: true };
{
  // 核心回归：净占比更高的「下跌途中接盘」必须排在净占比更低的「趋势中加仓」后面
  const down = mk('600000', 9.0, { weight: 0.25, flowKind: '下跌途中接盘' }, COLD);
  const up = mk('600001', 6.0, { weight: 1.0, flowKind: '趋势中加仓' }, HOT);
  const out = rank([down, up]);
  ok('9%净占比的下跌接盘 排在 6%净占比的趋势加仓 之后（旧逻辑正好相反）',
    out[0].code === '600001', out.map(x => x.code).join(','));
  ok('综合分算对：9×0.25×0.85=1.91 / 6×1.0×1.15=6.90',
    down.bmScore === 1.91 && up.bmScore === 6.9, `${down.bmScore} / ${up.bmScore}`);
}
{
  const a = mk('600010', 7.0, { weight: 1.0, flowKind: '趋势中加仓' }, COLD);
  const b = mk('600011', 7.0, { weight: 1.0, flowKind: '趋势中加仓' }, HOT);
  const out = rank([a, b]);
  ok('同条件：热门板块排在冷门板块之前', out[0].code === '600011', out.map(x => x.code).join(','));
  ok('冷门降权 0.85 / 热门加权 1.15 真实生效',
    a.bmScore === 5.95 && b.bmScore === 8.05, `${a.bmScore} / ${b.bmScore}`);
}
{
  const a = mk('600020', 7.0, null, HOT);
  rank([a]);
  ok('缺 K 线 → 中性权重 0.7（不因缺数据把票判死）', a.bmScore === +(7 * 0.7 * 1.15).toFixed(2), String(a.bmScore));
}
{
  const many = [];
  for (let i = 0; i < 18; i++) many.push(mk('6000' + i, 5 + i * 0.1, { weight: 1.0 }, HOT));
  const out = rank(many);
  ok('18 只候选全部参与打分（候选池已放大到 20，旧逻辑 12 选 12 等于没排）', out.length === 18, String(out.length));
  ok('打分后按综合分降序', out.every((x, i) => i === 0 || out[i - 1].bmScore >= x.bmScore));
}
{
  // 用户实测场景复现：12 只里 9 只下跌途中、12/12 冷门 → 重排后下跌票必须沉底
  const list = [];
  for (let i = 0; i < 9; i++) list.push(mk('6001' + i, 8.5, { weight: 0.25, flowKind: '下跌途中接盘' }, COLD));
  for (let i = 0; i < 3; i++) list.push(mk('6002' + i, 6.2, { weight: 1.0, flowKind: '趋势中加仓' }, HOT));
  const out = rank(list);
  ok('复现实测：3 只趋势票全部升到前 3，9 只下跌票沉底',
    out.slice(0, 3).every(x => x.ctx.flowKind === '趋势中加仓'), out.slice(0, 3).map(x => x.ctx.flowKind).join(','));
  ok('沉底的 12 只里下跌票占 9 只，与实测一致',
    out.filter(x => x.ctx.flowKind === '下跌途中接盘').length === 9);
}

// ══════════ ⑤ 权重股配额：不许把池子占满 ══════════
console.log('\n【⑤ 权重股配额：池子里不能全是银行/石油】');
const applyHeavy = new Function('list', `${SRC_HEAVY}\n return list;`);
const mkCap = (code, mainPct, capYi) => {
  const x = mk(code, mainPct, { weight: 1.0, flowKind: '趋势中加仓' }, HOT);
  x.capYi = capYi; return x;
};
{
  // 15 只全是权重股（实测原型：招商/浦发/北京银行/江苏银行/中国海油/中国石化/万科/中国神华…）
  const all = [];
  for (let i = 0; i < 15; i++) all.push(mkCap('6000' + i, 20 - i * 0.5, 900 - i * 10));
  rank(all);
  const out = applyHeavy(all);
  ok('15 只全是权重股 → 最多只进 4 只（绝不回补，宁可池子不满）', out.length === 4, String(out.length));
  ok('留下的都是权重股中综合分最高的 4 只', out.every(x => x.capYi >= 500) && out[0].mainPct === 20);
}
{
  // 10 只中小盘 + 10 只权重 → 中小盘 8 + 权重 4 = 12，权重恰好占 1/3
  const mix = [];
  for (let i = 0; i < 10; i++) mix.push(mkCap('6001' + i, 15 - i * 0.3, 80 + i));   // 中小盘
  for (let i = 0; i < 10; i++) mix.push(mkCap('6002' + i, 14 - i * 0.3, 600 + i));  // 权重
  rank(mix);
  const out = applyHeavy(mix);
  const hv = out.filter(x => x.capYi >= 500).length;
  ok('混合池共 12 只', out.length === 12, String(out.length));
  ok('权重股恰好 4 只（配额生效）', hv === 4, String(hv));
  ok('中小盘占 8 只（多数席位留给中小盘）', out.filter(x => x.capYi < 500).length === 8);
  ok('合并后仍按综合分降序（名次不乱）', out.every((x, i) => i === 0 || out[i - 1].bmScore >= x.bmScore));
}
{
  // 中小盘只有 3 只时：权重仍只给 4，池子 7 只 —— 不靠权重凑数
  const few = [mkCap('600300', 12, 90), mkCap('600301', 11, 70), mkCap('600302', 10, 60)];
  for (let i = 0; i < 10; i++) few.push(mkCap('6004' + i, 9 - i * 0.2, 700 + i));
  rank(few);
  const out = applyHeavy(few);
  ok('中小盘仅 3 只时：权重仍只有 4 只，总池 7 只（不回补凑数）', out.length === 7 && out.filter(x => x.capYi >= 500).length === 4,
    String(out.length));
}
{
  // 权重股即便综合分最高，也不能挤掉中小盘的第 8 名
  const one = [mkCap('600500', 30, 3000)];                       // 权重，分最高
  for (let i = 0; i < 10; i++) one.push(mkCap('6006' + i, 8 - i * 0.4, 60 + i));  // 中小盘
  rank(one);
  const out = applyHeavy(one);
  ok('权重股分再高也只占 1 席，中小盘该进的照进', out.filter(x => x.capYi >= 500).length === 1 && out.length === 9,
    `${out.length} 只`);
}

// ══════════ ⑥ 推送闸门 ══════════
console.log('\n【⑥ 推送闸门：下跌途中的大单不得当"涨停候选"推】');
const badCtx = new Function(`${LINE_BADCTX}\n return badCtx;`)();
{
  ok('下跌途中接盘 → 拦下（不进涨停候选）', badCtx({ ctx: { flowKind: '下跌途中接盘' } }) === true);
  ok('深跌后承接 → 拦下', badCtx({ ctx: { flowKind: '深跌后承接' } }) === true);
  ok('趋势中加仓 → 放行', badCtx({ ctx: { flowKind: '趋势中加仓' } }) === false);
  ok('回踩承接 → 放行', badCtx({ ctx: { flowKind: '回踩承接' } }) === false);
  ok('震荡整理 → 放行', badCtx({ ctx: { flowKind: '震荡整理' } }) === false);
  ok('缺 K 线数据 → 不拦（没证据就不凭空判死）', badCtx({ ctx: null }) === false && badCtx({}) === false);
}

// ══════════ ⑥ 板块归属第四层：别把"没查出来"当"冷门" ══════════
console.log('\n【⑦ 板块归属：银行/石油/军工不该再显示"未知"】');
{
  // ⚠️ GEO 正则现在是「GEO_PREFIX + GEO_SUFFIX + 合成」，只抽 GEO_BOARD_RE 那一行会
  //    ReferenceError（2026-10-01 踩过）。三行一起抽。
  const SRC_GEO = [
    (src.match(/^const GEO_PREFIX = .*$/m) || [''])[0],
    (src.match(/^const GEO_SUFFIX = .*$/m) || [''])[0],
    (src.match(/^const GEO_BOARD_RE = .*$/m) || [''])[0]
  ].filter(Boolean).join('\n');
  const SRC_SOS = grab(/^function sectorOfStock\(stock\) \{/m);
  const S2 = {
    ztPool: [], sectors: [], secStocks: new Map(),
    stockBoards: new Map([
      // 招商银行：真实东财归属里 地域板块排在行业前面，这一层的价值就在于跳过它
      ['600036', { time: Date.now(), boards: [{ name: '深圳板块' }, { name: '银行' }, { name: '跨境支付' }, { name: '转债标的' }] }],
      ['600028', { time: Date.now(), boards: [{ name: '北京板块' }, { name: '石油行业' }, { name: '可燃冰' }] }],
      ['600760', { time: Date.now(), boards: [{ name: '山东板块' }, { name: '航天航空' }] }]
    ])
  };
  S2.sectors = [{ name: '银行', mainInflow: 5e8 }, { name: '航天航空', mainInflow: 4e8 }];
  const cacheLine = SRC_CACHE;
  const sos = new Function('S', 'boardsOf', 'sectorZTCountFor', 'pickTopSector',
    `${cacheLine}\n${SRC_RANKMAP}\n${SRC_PTS}\n${SRC_GEO}\n${SRC_SOS}\n return sectorOfStock;`)(S2,
    code => {
      const c = S2.stockBoards.get(code); if (!c || !c.boards) return null;
      const arr = c.boards.filter(b => b.name && !['转债标的', '融资融券'].includes(b.name));
      return arr.length ? arr : null;
    }, () => 0);
  ok('银行股 → 跳过"深圳板块"取到"银行"', sos({ code: '600036', name: '招商银行' }) === '银行', sos({ code: '600036', name: '招商银行' }));
  ok('石油股 → 跳过"北京板块"取到"石油行业"', sos({ code: '600028', name: 'XD中国石' }) === '石油行业', sos({ code: '600028', name: 'XD中国石' }));
  ok('军工股 → 跳过"山东板块"取到"航天航空"', sos({ code: '600760', name: '中航沈飞' }) === '航天航空', sos({ code: '600760', name: '中航沈飞' }));
  ok('优先挑当日板块榜里真实存在的那个（银行在榜 → 命中）', sos({ code: '600036', name: '招商银行' }) === '银行');
  ok('查不到归属时仍是"未知"（不编造板块）', sos({ code: '999999', name: '不存在' }) === '未知', sos({ code: '999999', name: '不存在' }));
  // 有了真实板块，冷热判定才不是"一片冷门"
  const h = new Function('S', 'sectorRankMap', 'sectorZTCountFor', `${SRC_HEAT}\n return sectorHeat;`)(S2, () => new Map([['银行', 1]]), () => 0);
  const hb = h(sos({ code: '600036', name: '招商银行' }));
  ok('查到真实板块后：银行在资金榜第1 → 判热门（不再误判冷门）', !!(hb && hb.hot === true && hb.rank === 1), JSON.stringify(hb));
}

console.log(`\n${'─'.repeat(56)}\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
