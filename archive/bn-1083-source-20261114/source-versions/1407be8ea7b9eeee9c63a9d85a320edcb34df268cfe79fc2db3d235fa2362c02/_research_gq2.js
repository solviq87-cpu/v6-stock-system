// gq 轮补充：市值 × 位置 共线性检查 + 分年度稳健性
const fs = require('fs');
const A = require('./analysis.js');
const out = JSON.parse(fs.readFileSync('_research_gq_out.json', 'utf8'));
void out;
// 重建 records（与主脚本同口径，省略）
const snap = JSON.parse(fs.readFileSync('stocks_snapshot.json', 'utf8'));
const floatSh = new Map();
for (const r of snap.rows || []) {
  if (!r.code || !(r.price > 0) || !(r.floatCap > 0)) continue;
  floatSh.set(r.code, { fs: r.floatCap / r.price, listedTs: Number(r.listedDate) || 0, name: r.name || '' });
}
const DAY_MS = 86400000;
function tsOf(d) { return new Date(d + 'T12:00:00').getTime(); }
const records = [];
const files = fs.readdirSync('.kline_cache').filter(f => f.endsWith('.json'));
for (const f of files) {
  const code = f.replace('.json', '');
  const sh = floatSh.get(code);
  if (!sh || !sh.fs) continue;
  let k; try { k = JSON.parse(fs.readFileSync('.kline_cache/' + f, 'utf8')); } catch { continue; }
  const nm = k.name || sh.name || '';
  if (A.isJunkName(nm) || code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) continue;
  const rows = (k.rows || []).filter(r => r && r.close > 0);
  if (rows.length < 25) continue;
  const lp = A.limitPctOf(code, nm);
  const start = Math.max(20, rows.length - 60);
  for (let i = start; i < rows.length - 1; i++) {
    const ts = tsOf(rows[i].date);
    if (sh.listedTs && ts - sh.listedTs < 45 * DAY_MS) break;
    const c = rows[i].close, cPrev = rows[i - 1].close;
    const pct = (c / cPrev - 1) * 100;
    if (!(pct >= lp - 0.3)) continue;
    if (rows[i].open >= cPrev * (1 + lp / 100) - 0.02) continue;
    let mn20 = Infinity, mx20 = -Infinity;
    for (let q = Math.max(0, i - 19); q <= i; q++) { mn20 = Math.min(mn20, rows[q].low); mx20 = Math.max(mx20, rows[q].high); }
    const rangePos = mx20 > mn20 ? +((c - mn20) / (mx20 - mn20) * 100).toFixed(1) : 50;
    const nx = rows[i + 1];
    const nextHiPct = (nx.high / c - 1) * 100;
    records.push({
      date: rows[i].date,
      capYi: +(c * sh.fs / 1e8).toFixed(1), rangePos,
      nextZtTouch: nextHiPct >= lp - 0.3, nextPct: +((nx.close / c - 1) * 100).toFixed(2)
    });
  }
}
console.log('[涨停日切片] n =', records.length);
const capT = r => r.capYi < 100 ? '<100亿' : r.capYi < 500 ? '100-500亿' : '≥500亿';
const posT = r => r.rangePos < 30 ? '底<30' : r.rangePos <= 70 ? '中30-70' : '顶>70';
function cell(rows2) {
  const n = rows2.length;
  if (!n) return 'n=0';
  const zt = rows2.filter(r => r.nextZtTouch).length;
  const avg = rows2.reduce((s, r) => s + r.nextPct, 0) / n;
  return `n=${String(n).padStart(5)} 触板${(zt / n * 100).toFixed(1).padStart(5)}% 均涨${avg.toFixed(2).padStart(6)}%`;
}
console.log('\n── 市值 × 位置 交叉（触板率） ──');
for (const cp of ['<100亿', '100-500亿', '≥500亿']) {
  for (const pp of ['底<30', '中30-70', '顶>70']) {
    console.log((cp + ' × ' + pp).padEnd(22) + cell(records.filter(r => capT(r) === cp && posT(r) === pp)));
  }
}
console.log('\n── 边际（验证两因子是否各自独立） ──');
for (const cp of ['<100亿', '100-500亿', '≥500亿']) console.log('市值 ' + cp.padEnd(10) + cell(records.filter(r => capT(r) === cp)));
for (const pp of ['底<30', '中30-70', '顶>70']) console.log('位置 ' + pp.padEnd(10) + cell(records.filter(r => posT(r) === pp)));
// 月分稳健性
console.log('\n── 分月稳健性（触板率） ──');
const byMon = {};
for (const r of records) {
  const m = r.date.slice(0, 7);
  (byMon[m] = byMon[m] || []).push(r);
}
for (const m of Object.keys(byMon).sort()) {
  const rs = byMon[m];
  const sub = f => { const s = rs.filter(f); return s.length ? (s.filter(r => r.nextZtTouch).length / s.length * 100).toFixed(1) + '%(n=' + s.length + ')' : '-'; };
  console.log(m + ' 基数' + sub(() => true).padStart(16)
    + ' <100亿' + sub(r => capT(r) === '<100亿').padStart(16)
    + ' 中位' + sub(r => posT(r) === '中30-70').padStart(16));
}
