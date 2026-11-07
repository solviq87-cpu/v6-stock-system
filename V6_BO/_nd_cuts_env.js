const fs = require('fs');
const root = 'C:/Users/28957/WorkBuddy/2026-09-25-13-40-58/stock-dashboard';
const st = JSON.parse(fs.readFileSync(root + '/stats.json', 'utf8'));
const breadth = JSON.parse(fs.readFileSync(root + '/breadth.json', 'utf8'));
function normDate(d) {
  if (typeof d === 'string' && /^\d{8}$/.test(d)) return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  return d;
}
function envOf(d) {
  const b = breadth[normDate(d)];
  if (!b || b.upRatio == null) return '未知';
  return b.upRatio < 40 ? '普跌' : (b.upRatio > 52 ? '普涨' : '退潮');
}
const a = st.signals.filter(s => s.type === 'auczt' && !s.void && s.nd && typeof s.nd.nextPct === 'number');
function stat(arr, label) {
  const n = arr.length;
  if (!n) { console.log(label.padEnd(16), 'n=0'); return; }
  const u3 = arr.filter(s => s.nd.nextPct >= 3).length;
  const lu = arr.filter(s => s.nd.limitUp).length;
  const m5 = arr.filter(s => (s.nd.maxGain || -999) >= 5).length;
  const up = arr.filter(s => s.nd.nextPct > 0).length;
  const avg = arr.reduce((t, s) => t + s.nd.nextPct, 0) / n;
  console.log(label.padEnd(16), `n=${String(n).padStart(3)}  +3%=${(u3 / n * 100).toFixed(1).padStart(5)}%  lift=${(u3 / n * 100 - 12.8).toFixed(1).padStart(5)}pp  涨停=${(lu / n * 100).toFixed(1).padStart(5)}%  最高≥5%=${(m5 / n * 100).toFixed(1).padStart(5)}%  收涨=${(up / n * 100).toFixed(1).padStart(5)}%  均涨=${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`);
}
console.log('== auczt prob 档 × 环境层 ==');
for (const [lbl, lo, hi] of [['prob<40', 0, 40], ['prob 40~50', 40, 50], ['prob>=50', 50, 200]]) {
  for (const L of ['普跌', '退潮', '普涨']) {
    stat(a.filter(s => { const p = s.prob == null ? -1 : s.prob; return p >= lo && p < hi && envOf(s.date) === L; }), lbl + '·' + L);
  }
  console.log('');
}
console.log('== 当日封板(resolved) × 环境层 ==');
const r = st.signals.filter(s => s.type === 'auczt' && !s.void && s.resolved);
for (const L of ['普跌', '退潮', '普涨']) {
  const arr = r.filter(s => envOf(s.date) === L);
  const n = arr.length; if (!n) { console.log(L, 'n=0'); continue; }
  const lu = arr.filter(s => s.resolved.limitUp).length;
  console.log(L.padEnd(6), `n=${String(n).padStart(3)}  当日封板=${(lu / n * 100).toFixed(1)}%`);
}
console.log('== 最近6日 auczt 明细 ==');
const byDate = {};
for (const s of st.signals.filter(s => s.type === 'auczt' && !s.void)) (byDate[s.date] = byDate[s.date] || []).push(s);
for (const d of Object.keys(byDate).sort().slice(-6)) {
  const arr = byDate[d];
  const rOk = arr.filter(s => s.resolved);
  const rLu = rOk.filter(s => s.resolved.limitUp).length;
  const ok = arr.filter(s => s.nd && typeof s.nd.nextPct === 'number');
  console.log(d, `n=${arr.length} 当日封板=${rOk.length ? (rLu / rOk.length * 100).toFixed(1) + '%' : '?'} 已回填nd=${ok.length} [${envOf(d)}]`);
}
