// ch 轮守门：同一条规则被复制到新位置时，前提有没有一起带过去。
// 具体钉的是「趋势票体检」这条规则：
//   用户点名要的两条前提 —— ① 流通市值 ≥50亿  ② 20 日不上蹿下跳出局 ——
//   原本只长在精选池那条路上（A.trendPoolCheck 内部）。另外两条【同样往趋势票榜单灌票、
//   同样会推给用户】的路（全市场趋势扫描 scanTrendUniverse、连续收涨 scanSteadyUp）
//   各自重写了一套更短的过滤，两条前提都没带过来 → 同一台机器里出现两种"趋势票"。
// 现在三条路共用 A.trendHygiene（原始体检数据）+ A.trendVerdict（按通道判出局）。
// 离线、确定性：K 线是构造的，市值/资金都是注入的。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const A = require('./analysis');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const ASRC = fs.readFileSync(path.join(__dirname, 'analysis.js'), 'utf8');

// 按「每日涨幅 + 当日振幅」造 K 线（振幅围绕当日收盘上下各 amp/2，故日均振幅 ≈ |pct| + amp）
function rowsFrom(pcts, amp) {
  const rows = []; let c = 10;
  for (let i = 0; i < pcts.length; i++) {
    const p = pcts[i];
    const prev = c; c = c * (1 + p / 100);
    const a = (amp == null ? 2.0 : amp) / 100;
    const hi = Math.max(prev, c) * (1 + a / 2), lo = Math.min(prev, c) * (1 - a / 2);
    rows.push({
      date: 'd' + i, open: +prev.toFixed(4), close: +c.toFixed(4),
      high: +hi.toFixed(4), low: +lo.toFixed(4), volume: 1e7, amount: 1e8, pct: +p.toFixed(2)
    });
  }
  return rows;
}
// 按花括号配对取函数真实函数体：先跳过形参表，再找函数体的 '{'
// （固定行数窗口会串到相邻函数；从函数名后第一个 '{' 开始配对会被解构形参骗到）
function fnBody(src, name) {
  const i = src.indexOf(name);
  if (i < 0) return '';
  let p = src.indexOf('(', i);
  let d = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') d++;
    else if (src[k] === ')') { d--; if (d === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  d = 0;
  let inStr = null;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(open, j + 1); }
  }
  return '';
}

console.log('\n【⛔⛔ 自检】');
{
  ok('自检：trendHygiene 真的导出了', typeof A.trendHygiene === 'function', typeof A.trendHygiene);
  ok('自检：trendVerdict 真的导出了', typeof A.trendVerdict === 'function', typeof A.trendVerdict);
  const hg = A.trendHygiene(rowsFrom(Array(25).fill(1), 2.0), 12, 80e8);
  ok('自检：体检数据算得出来（amp20 有值）', hg && hg.amp20 > 0, JSON.stringify(hg));
  ok('自检：fnBody 取到的是真函数体（不是形参表）', /return\s*\{/.test(fnBody(ASRC, 'function trendPoolCheck(')));
}

console.log('\n【① 三条入榜路共用同一份体检】');
{
  const bPool = fnBody(ASRC, 'function trendPoolCheck(');
  const bScan = fnBody(SRC, 'async function scanTrendUniverse(');
  const bSteady = fnBody(SRC, 'async function scanSteadyUp(');
  ok('精选池（trendPoolCheck）走 A.trendHygiene', /trendHygiene\s*\(/.test(bPool));
  ok('全市场趋势扫描（scanTrendUniverse）走 A.trendHygiene', /trendHygiene\s*\(/.test(bScan));
  ok('连续收涨（scanSteadyUp）走 A.trendHygiene', /trendHygiene\s*\(/.test(bSteady));
  // ⛔ 只调用不算数：必须把两条前提都当"出局"用上，否则等于白算
  ok('扫描路把「市值不合格」当出局', /_hg\.capOk === false/.test(bScan));
  ok('扫描路把「波动体检不合格」当出局', /_jv\.jumpy/.test(bScan));
  ok('连涨路把「市值不合格」当出局', /_hg\.capOk === false/.test(bSteady));
  ok('连涨路把「波动体检不合格」当出局', /_jv\.jumpy/.test(bSteady));
  ok('市值数据是从 S.stocks 补的（扫描路本身只有K线，没有行情快照）', /function floatCapOf\(/.test(SRC) && /floatCapOf\(code\)/.test(SRC));
  // ⛔ 通道是判据的前提：不声明通道就等于又丢了一次前提
  ok('⛔ 扫描路显式声明通道（强势）', /trendVerdict\(_hg,\s*'强势'\)/.test(bScan));
  ok('⛔ 连涨路显式声明通道（温和）', /trendVerdict\(_hg,\s*'温和'\)/.test(bSteady));
  ok('⛔ 精选池按自己算出来的 channel 判（不是写死一边）', /trendVerdict\(_hg,\s*channel/.test(bPool));
}

console.log('\n【② 市值门槛（≥50亿），缺数据不拦】');
{
  const rows = rowsFrom(Array(25).fill(0.8), 2.0);
  const price = rows[rows.length - 1].close;
  const small = A.trendHygiene(rows, price, 30e8);
  const big = A.trendHygiene(rows, price, 80e8);
  const none = A.trendHygiene(rows, price, 0);
  ok('30亿 → capOk = false（拦下）', small.capOk === false, String(small.capOk));
  ok('80亿 → capOk = true（放行）', big.capOk === true, String(big.capOk));
  ok('拿不到市值 → capOk = null（缺数据不判死）', none.capOk === null, String(none.capOk));
  ok('capYi 单位是亿元', big.capYi === 80, String(big.capYi));
  ok('⛔ 体检本身不下出局结论（结论由 trendVerdict 按通道给）', !('risky' in big), Object.keys(big).join(','));
}

console.log('\n【③ 强势通道：涨得猛不是罪，被砸过才是】');
{
  // 奥士康陷阱：20 日内多根大阳、一根大阴都没有 —— 这是最强势的那批票
  const strong = rowsFrom([0, 1, 2, 6.5, 3, 9.9, 1, 8.2, 2, 6.1, 1.5, 3, 2.2, 1, 4, 2, 1.1, 3.3, 2, 1.4, 7.2, 2, 1.8, 2.6, 1.5], 1.5);
  const hgS = A.trendHygiene(strong, strong[strong.length - 1].close, 80e8);
  const vS = A.trendVerdict(hgS, '强势');
  const vG = A.trendVerdict(hgS, '温和');
  ok('强势样本 20 日内确实有多天单日涨跌超 ±5%', hgS.swingDays >= 4, String(hgS.swingDays));
  ok('⛔ 走强势通道**不能**被判死（涨得猛不是罪）', vS.jumpy === false, vS.jumpWhy.join('/'));
  ok('同一份形态走温和通道会被判死（通道确实影响结论）', vG.jumpy === true, vG.jumpWhy.join('/'));
  ok('⛔ 默认通道是温和（忘传时按更严的一侧判，不会漏体检）', A.trendVerdict(hgS).channel === '温和', A.trendVerdict(hgS).channel);

  // 被砸过一根大阴 → 趋势被打断过，这才是真危险，两条通道都该拦
  // ⚠️ 体检只看**近20日**，所以这根大阴必须落在最后 20 根之内（放在数组靠前就测不出来了）
  const smashed = rowsFrom([1, 2, 1.5, 1.2, 2, 1.1, 1.8, 1, 2.2, 1.4, -9, 1.6, 1, 1.9, 1.3, 1.7, 1, 2.1, 1.2, 1.5, 1, 1.4, 1.8, 1, 1.3], 1.5);
  const hgM = A.trendHygiene(smashed, smashed[smashed.length - 1].close, 80e8);
  ok('强势通道：20日内被砸 ≤-7% → 出局', A.trendVerdict(hgM, '强势').jumpy === true, A.trendVerdict(hgM, '强势').jumpWhy.join('/'));
  ok('出局原因写清楚了（不是只给个布尔）', A.trendVerdict(hgM, '强势').jumpWhy.join('/').length > 0);
  // ⚠️ 温和通道走的是"既有大阳又有大阴"那条（与精选池历史口径一致），单靠一根大阴不判死 ——
  //    本轮只做「前提带过去」，不擅自给温和通道加严，所以这里钉的是"口径没被改"。
  ok('温和通道口径未变：单根大阴不判死（加严属另一次决策）', A.trendVerdict(hgM, '温和').jumpy === false, A.trendVerdict(hgM, '温和').jumpWhy.join('/'));
  const both = rowsFrom([1, 2, 1.5, 1.2, 2, 1.1, 1.8, 7.5, 2.2, 1.4, -7.5, 1.6, 1, 1.9, 1.3, 1.7, 1, 2.1, 1.2, 1.5, 1, 1.4, 1.8, 1, 1.3], 1.5);
  const hgB = A.trendHygiene(both, both[both.length - 1].close, 80e8);
  ok('温和通道：既有 +7.5% 又有 -7.5% → 出局', A.trendVerdict(hgB, '温和').jumpy === true, A.trendVerdict(hgB, '温和').jumpWhy.join('/'));
  ok('强势通道：同样出局', A.trendVerdict(hgB, '强势').jumpy === true, A.trendVerdict(hgB, '强势').jumpWhy.join('/'));
  ok('出局文案点名"既有单日"（不是只给个布尔）', A.trendVerdict(hgB, '温和').jumpWhy.some(t => /既有单日/.test(t)), A.trendVerdict(hgB, '温和').jumpWhy.join('/'));

  // 每天都上蹿下跳（日均振幅 6%）→ 出局
  const wide = rowsFrom(Array(25).fill(1.0), 6.0);
  const hgW = A.trendHygiene(wide, wide[wide.length - 1].close, 80e8);
  ok('近20日日均振幅 >5.5% → 温和通道出局', A.trendVerdict(hgW, '温和').jumpy === true, String(hgW.amp20));
  ok('amp20 计算出来了', hgW.amp20 > 5.5, String(hgW.amp20));
}

console.log('\n【④ 抽出来之后精选池的行为不能变】');
{
  const rows = rowsFrom(Array(30).fill(1.2).concat(Array(20).fill(-0.6)), 2.0);
  const t = A.trendPoolCheck({
    rows, fundDays: [{ main: 1e7 }, { main: 1e7 }, { main: 1e7 }],
    price: rows[rows.length - 1].close, mainInflow: 1e7, thsNetAmt: null,
    floatCap: 80e8, code: '600000', name: '测试'
  });
  ok('trendPoolCheck 仍能跑出结论', !!t);
  for (const k of ['capYi', 'capOk', 'amp20', 'swingDays', 'maxUp', 'maxDown', 'jumpy', 'jumpWhy', 'trendScore', 'channel']) {
    ok('字段还在: ' + k, t && (k in t), Object.keys(t || {}).join(','));
  }
  ok('市值 80亿 → 精选池 capOk = true', t && t.capOk === true, String(t && t.capOk));
  const t2 = A.trendPoolCheck({
    rows, fundDays: [{ main: 1e7 }, { main: 1e7 }, { main: 1e7 }],
    price: rows[rows.length - 1].close, mainInflow: 1e7, thsNetAmt: null,
    floatCap: 20e8, code: '600000', name: '测试'
  });
  ok('市值 20亿 → 精选池 capOk = false（门槛没被抽走）', t2 && t2.capOk === false, String(t2 && t2.capOk));
  ok('⛔ jumpWhy 仍是数组（回填时没把类型弄丢）', Array.isArray(t && t.jumpWhy), typeof (t && t.jumpWhy));
}

console.log('\n【⑤ 反向验证：老写法确实漏了这两条】');
{
  const bScan = fnBody(SRC, 'async function scanTrendUniverse(');
  const bSteady = fnBody(SRC, 'async function scanSteadyUp(');
  ok('扫描路仍保留垃圾票过滤（没被替掉）', /isJunkName/.test(bScan) && /isNearLimitUp/.test(bScan));
  ok('连涨路仍保留垃圾票过滤（没被替掉）', /isJunkName/.test(bSteady) && /isNearLimitUp/.test(bSteady));
  // ⛔ dv 轮：出局分支里插入了 skipAdd 计数 → 钉语义：判定式之后 80 字符内必须出现 continue
  const _OUT_RE = /_hg\.capOk === false \|\| _jv\.jumpy\)[\s\S]{0,80}?continue;/;
  ok('⛔ 体检放在【出局】位置（continue），不是只算出来给人看', _OUT_RE.test(bScan));
  ok('⛔ 连涨路同上', _OUT_RE.test(bSteady));
  // 反向：判据只剩一份，不能再有人自己写 `amp20 > 5.5` 当门槛
  const restScan = bScan.replace(/trendVerdict\([^)]*\)/g, '');
  const restSteady = bSteady.replace(/trendVerdict\([^)]*\)/g, '');
  ok('⛔ 扫描路没有自己重写 amp20 门槛', !/amp20\s*>\s*5\.5/.test(restScan));
  ok('⛔ 连涨路没有自己重写 amp20 门槛', !/amp20\s*>\s*5\.5/.test(restSteady));
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
