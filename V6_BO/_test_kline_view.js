// 守门：hj 轮「应用内 K 线面板」（K线/量能/大单/洗盘出货判定 + 买卖T点锁仓标注 + 可折叠 + 实时同步）
//   ① 后端 /api/kline + /api/kline-marks 字段契约完整（含 flow/wash 两层新数据）
//   ② washVsDistribute 判定分支真跑（沙箱，取生产源码）
//   ③ 判不出不硬判 / 资金流缺失必须声明（项目铁律）
//   ④ 前端三入口可点 + 面板可折叠 + 只读边界不漏私密层
//   ⑤ 不重犯 TDZ：新增顶层常量不得在模块初始化期依赖后置 const
'use strict';
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');

const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SVK = stripNoise(SV, { keepStrings: true });
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const HTMLK = stripNoise(HTML, { keepStrings: true });

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') { console.log('❌ [类型闸] ' + name + ' 入参非布尔: ' + typeof cond); fail++; return; }
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? ' | ' + detail : '')); }
}
// 取函数体（花括号配平，禁止固定行号窗口 —— gd 轮铁律）
function bodyAt(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return '';
  const start = src.indexOf('{', m.index);
  let d = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

console.log('\n[1] 后端接口契约：/api/kline 与 /api/kline-marks');
{
  const klBlk = (() => {
    const i = SVK.indexOf("p === '/api/kline' && req.method === 'GET'");
    return i < 0 ? '' : SVK.slice(i, i + 1400);
  })();
  const mkBlk = (() => {
    const i = SVK.indexOf("p === '/api/kline-marks' && req.method === 'GET'");
    // ⛔ 窗口不再用固定字节数（③d 后该 handler 变长会截断）：以「下一个接口标记」为边界取完整块
    const j = SVK.indexOf("p === '/api/smallyang' && req.method === 'GET'");
    return i < 0 ? '' : SVK.slice(i, j < 0 ? i + 3200 : j);
  })();
  ok(!!klBlk && /klineRows\(code\)/.test(klBlk), 'K线接口走 klineRows（与精选池同源三级缓存，不新开通道）');
  ok(!!klBlk && /rows\.slice\(-n\)|rows\.slice\(-60\)|slice\(-n\)/.test(klBlk), 'K线接口默认返回最近 60 根（③d 支持 n 参数懒加载更早数据）');
  ok(!!klBlk && /klineMaOf/.test(klBlk), 'K线接口下发均线 ma（前端不另算一套）');
  ok(!!mkBlk && /isEditorReq\(req, mkTok\)/.test(mkBlk), '标注接口用 isEditorReq(req, tok) 判私密（签名不许写反）');
  ok(!!mkBlk && /out\.paper = mk\.paper/.test(mkBlk) && /paperHidden/.test(mkBlk), '只读身份不返回模拟盘层，且给出隐藏说明');
  ok(!!mkBlk && /pullPaperDownstream/.test(mkBlk) && /isReplica\(\)/.test(mkBlk), '副本打开面板时后台回拉线上（用户要求实时一致）');
  ok(!!mkBlk && /syncedAt/.test(mkBlk), '返回 syncedAt（数据是哪一刻的必须可见）');
  ok(!!mkBlk && /flow:/.test(mkBlk) && /wash,/.test(mkBlk), '新增：下发当日资金流 flow + 洗盘/出货判定 wash');
  ok(!!mkBlk && /flowWhy/.test(mkBlk), '资金流取不到时下发 flowWhy（不静默为 null）');
}
console.log('\n[2] 洗盘/出货判定：沙箱真跑生产源码');
{
  const src = SV.slice(SV.indexOf('function klineMaOf('), SV.indexOf('// 给大单卡片补'));
  // ⛔ hz 轮补注：washVsDistribute 内部用了 todayStr，沙箱必须注入
  const todayStr = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
  const mod = eval('(function(){ ' + src + '; return { washVsDistribute }; })()');
  const { washVsDistribute } = mod;
  const mk = (date, close, open, high, low, volume, pct) => ({ date, open, close, high, low, volume, pct });
  const _td = todayStr(); // 2026-10-15
  const _yd = '2026-10-14', _d2 = '2026-10-13';
  const base = (n, vol) => { const a = []; for (let i = 0; i < n; i++) a.push(mk('2026-09-' + String(i + 1).padStart(2, '0'), 10 + i * 0.01, 10 + i * 0.01, 10 + i * 0.01 + 0.03, 10 + i * 0.01 - 0.03, vol, 0.1)); return a; };

  // 洗盘：上升趋势中缩量回踩 + 主力净流入（最新日期必须是今天，否则 washVsDistribute 返回 unknown）
  const r1 = (() => {
    const rows = base(20, 1000);
    rows.push(mk(_yd, 10.12, 10.16, 10.18, 10.05, 200, -0.7));
    rows.push(mk(_td, 10.14, 10.09, 10.18, 10.06, 250, 0.4));
    return washVsDistribute(rows, { data: { mainPct: 2.5, superNet: 1e7, bigNet: 5e6, midNet: -1e6, smallNet: -2e6 } });
  })();
  ok(r1.verdict === 'wash', '缩量回踩 + 主力流入 → 判洗盘', JSON.stringify(r1));
  ok(r1.reasons.some(x => x.side === 'wash' && /缩量回调/.test(x.text)), '洗盘理由含「缩量回调」');

  // 出货：高位放量三连跌 + 主力净流出 + 超大单出逃（最新日期必须是今天）
  const r2 = (() => {
    const rows = base(20, 600);
    rows.push(mk(_d2, 10.6, 10.72, 10.78, 10.5, 1800, -1.8));
    rows.push(mk(_yd, 10.2, 10.6, 10.62, 10.1, 1900, -3.6));
    rows.push(mk(_td, 9.9, 10.2, 10.25, 9.8, 2000, -3.8));
    return washVsDistribute(rows, { data: { mainPct: -2.8, superNet: -2e7, bigNet: -3e6, midNet: 1e6, smallNet: 2e6 } });
  })();
  ok(r2.verdict === 'distribute', '放量下跌 + 主力流出 → 判出货', JSON.stringify(r2));
  ok(r2.reasons.some(x => x.side === 'distribute' && /放量下跌/.test(x.text)), '出货理由含「放量下跌」');
  ok(r2.reasons.some(x => x.side === 'distribute' && /超大单/.test(x.text)), '出货理由含超大单出逃');

  // 判不出：K线不足 15 根
  const r3 = washVsDistribute(base(10, 1000), null);
  ok(r3.verdict === 'unknown', '数据不足 → unknown（⛔ 不许硬判）', JSON.stringify(r3));
  ok(/不足 15 根/.test((r3.reasons[0] || {}).text || ''), 'unknown 时说明缺什么');

  // 资金流缺失：降级但仍声明
  const r4 = (() => {
    const rows = base(20, 1000);
    rows.push(mk(_td, 10.14, 10.09, 10.18, 10.06, 250, 0.4));
    return washVsDistribute(rows, { data: null, why: '资金流接口未返回该票（非交易时段）' });
  })();
  ok(r4.reasons.some(x => x.side === 'note' && /资金流未取到/.test(x.text)), '资金流缺失必须显式声明（不静默当无）');

  // MA20 斜率回退：窗口 <25 根时不得把「判不出」当「下行」
  const r5 = (() => {
    const rows = base(21, 1000);   // ma20[n-6] 为 null，需回退找最近非 null
    rows[rows.length - 1].date = _td; // ⛔ 改为今天，避免 hz 轮「陈旧数据不硬判」拦截
    return washVsDistribute(rows, null);
  })();
  ok(r5.maUp === true, '窗口 21 根时 MA20 斜率仍能回退判定（不恒 false）', JSON.stringify({ maUp: r5.maUp, ma20: r5.ma20 }));

  // 脏数据不崩（volume=0、high=low）
  const r6 = washVsDistribute([...base(18, 0), mk(_td, 10, 10, 10, 10, 0, 0)], null);
  ok(typeof r6.verdict === 'string' && isFinite(r6.score), '脏数据（零量/一字）不崩且有结论');
}
console.log('\n[3] 资金流接口封装（klineFlowOf）节流与降级');
{
  const fb = bodyAt(SVK, 'klineFlowOf');
  ok(!!fb && /KL_FLOW_TTL/.test(fb), '资金流带 TTL 节流（面板刷新不重复打东财）');
  ok(!!fb && /fetchBatchFlowEM/.test(fb), '资金流走 em.fetchBatchFlowEM（复用既有通道）');
  ok(!!fb && /rec\.why/.test(fb), '取不到时记 why（前端要显示原因）');
  ok(!!fb && /data: null/.test(fb), '失败时 data=null，⛔ 不拿 0 冒充');
  ok(/KL_FLOW_TTL = 30 \* 1000/.test(SVK), 'TTL 为 30 秒');
  ok(/_klFlowCache\.size > 50/.test(SVK), '缓存有上限（防无界增长）');
}
console.log('\n[4] 前端：面板、入口、折叠、只读边界');
{
  ok(/function openKline\(/.test(HTMLK), '存在 openKline 全局入口');
  // 判 UI 用原始 HTML（stripNoise 会抹掉内联事件属性里的字符串）
  ok(HTML.includes('<b class="kl-link" onclick="openKline(\'${x.code}\')"'), '精选池股票名可点开 K 线');
  ok(HTML.includes('<span class="kl-link" onclick="openKline(\'${x.code}\')"'), '一进二/连板卡片股票名可点开 K 线');
  ok((HTML.match(/onclick="openKline\('/g) || []).length >= 3, '至少三处入口（精选池/一进二/持仓）', String((HTML.match(/onclick="openKline\('/g) || []).length));
  ok(/kl-link/.test(HTMLK) && /\.kl-link\{cursor:pointer/.test(HTMLK), '可点股票名有 kl-link 提示样式');
  ok(/qd_kline_folded/.test(HTMLK) && /klApplyFold/.test(HTMLK), '面板可折叠且折叠态持久化（localStorage）');
  ok(/setInterval\([\s\S]{0,120}15000/.test(HTMLK) && /klLoad\(false\)/.test(HTMLK), '打开期间 15 秒静默刷新（实时与线上一致）');
  ok(/KL\.canPaper/.test(HTMLK) && /klPaperLbl/.test(HTMLK), '只读身份隐藏模拟盘图层开关');
  ok(/模拟盘成交层属私密数据/.test(HTML), '只读时给出隐藏说明而非空白');
  ok(/klWashBox/.test(HTMLK) && /klFlowBox/.test(HTMLK), '面板含洗盘/出货区与大单资金流区');
  ok(/量能副图|volume/.test(HTMLK), 'K线图含量能副图');
  ok(/klSvg/.test(HTMLK) && /polyline/.test(HTMLK), '均线用 polyline 绘制（自绘 SVG，无外部图表库）');
  ok(/touchmove/.test(HTMLK), '手机触摸光标支持');
}
console.log('\n[5] 不重犯 TDZ（hi 轮铁律）+ 版本一致');
{
  // 新增的顶层常量块不得调用任何「函数体读后置 const」的函数
  // ⛔ stripNoise 会剥掉注释，定位块必须用代码标记而非注释（gd 轮：不对整份文件 indexOf 界面原文）
  const klTop = SVK.slice(SVK.indexOf('async function klineFlowOf'), SVK.indexOf('function washVsDistribute'));
  ok(!!klTop && !/dataCapOf/.test(klTop), '新增顶层块不调用 dataCapOf（hi 轮 TDZ 反例）');
  ok(!/readJsonSafe\(/.test(klTop), '新增顶层块不做磁盘载入（容量裁剪推迟到运行时）');
  const v1 = (SV.match(/const APP_VER = '([^']+)'/) || [])[1] || '';
  const v2 = (HTML.match(/const APP_VER = '([^']+)'/) || [])[1] || '';
  ok(!!v1 && v1 === v2, '两端 APP_VER 一致（不一致会无限 reload）', v1 + '/' + v2);
  ok(/^\d{8}[a-z]{2}$/.test(v1), '版本号格式 ^\\d{8}[a-z]{2}$', v1);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
