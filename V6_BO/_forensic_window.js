// hv 轮取证②：auczt 样本按「抓取时段」分组 —— 验证非竞价时段抓取=事后开盘价冒充竞价信号
// 判据：ts 的时分落在 09:15~09:29（含 9:25 撮合完成窗）= 竞价时段；其余 = 非竞价时段。
// ⛔ 只读不改。对比两组：样本量 / nd 命中率 / score 分层 lift / Spearman。
const fs = require('fs');
const ST = JSON.parse(fs.readFileSync('stats.json', 'utf-8'));
const sigs = (ST.signals || []).filter(s => s.type === 'auczt' && !s.void);
const hhmm = s => { const t = new Date(s.ts); return t.getHours() * 100 + t.getMinutes(); };
const inAuctionWin = s => { const h = hhmm(s); return h >= 915 && h <= 929; };

const groups = { '竞价时段(09:15-09:29)': [], '非竞价时段': [] };
for (const s of sigs) (inAuctionWin(s) ? groups['竞价时段(09:15-09:29)'] : groups['非竞价时段']).push(s);

function spear(a, b) { const n = a.length; let sa = 0; a.forEach((v, i) => { sa += (v - (n - 1) / 2) * (b[i] - (n - 1) / 2); }); return sa / (n * (n * n - 1) / 12); }
function rank(arr) { const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(arr.length); idx.forEach((p, i) => { r[p[1]] = i; }); return r; }

console.log('auczt 非 void 总数:', sigs.length);
for (const k of Object.keys(groups)) {
  const g = groups[k];
  const nd = g.filter(s => s.nd);
  console.log(`\n===== ${k}: n=${g.length} (有 nd: ${nd.length}) =====`);
  if (!nd.length) continue;
  const lim = nd.filter(s => s.nd.limitUp).length, p3 = nd.filter(s => s.nd.nextPct >= 3).length;
  console.log(`  次日涨停 ${lim}/${nd.length} = ${(lim / nd.length * 100).toFixed(1)}%   次日+3% ${p3}/${nd.length} = ${(p3 / nd.length * 100).toFixed(1)}%`);
  console.log(`  均涨幅 ${(nd.reduce((a, s) => a + s.nd.nextPct, 0) / nd.length).toFixed(2)}%   均最高 ${(nd.reduce((a, s) => a + s.nd.maxGain, 0) / nd.length).toFixed(2)}%`);
  const sc = g.map(s => s.score).sort((a, b) => a - b);
  console.log(`  score 中位=${sc[Math.floor(sc.length / 2)]} p90=${sc[Math.floor(sc.length * 0.9)]} max=${sc[sc.length - 1]}   prob>55: ${g.filter(s => s.prob > 55).length}/${g.length}`);
  const r = rank(nd.map(s => s.score));
  console.log(`  Spearman(score, 次日涨停) = ${spear(r, rank(nd.map(s => s.nd.limitUp ? 1 : 0))).toFixed(3)}   (score, 次日涨幅) = ${spear(r, rank(nd.map(s => s.nd.nextPct))).toFixed(3)}`);
  const edges = [40, 50, 60, 70, 101];
  for (const e of edges) {
    const b = nd.filter(s => s.score < e && (e === edges[0] || s.score >= edges[edges.indexOf(e) - 1]));
    if (!b.length) continue;
    const lo = e === edges[0] ? 0 : edges[edges.indexOf(e) - 1];
    console.log(`    score ${lo}-${e === 101 ? 100 : e - 1}: n=${String(b.length).padStart(3)} 涨停=${(b.filter(s => s.nd.limitUp).length / b.length * 100).toFixed(1)}% +3%=${(b.filter(s => s.nd.nextPct >= 3).length / b.length * 100).toFixed(1)}%`);
  }
}

// 竞价时段组内：prob>55 vs <=55 的区分度（闸门是否只在事前样本上有效）
const A = groups['竞价时段(09:15-09:29)'].filter(s => s.nd);
if (A.length) {
  const hi = A.filter(s => s.prob > 55), lo = A.filter(s => s.prob <= 55);
  console.log(`\n== 竞价时段组内 prob 分层 ==`);
  for (const [nm, b] of [['prob>55', hi], ['prob<=55', lo]]) {
    if (!b.length) { console.log(`  ${nm}: n=0`); continue; }
    console.log(`  ${nm}: n=${b.length} 涨停=${(b.filter(s => s.nd.limitUp).length / b.length * 100).toFixed(1)}% +3%=${(b.filter(s => s.nd.nextPct >= 3).length / b.length * 100).toFixed(1)}%`);
  }
}
// 非竞价时段抓取的 ts 集中在哪些时刻（列全天分布）
const cnt = {};
for (const s of groups['非竞价时段']) { const h = hhmm(s); const k = h < 900 ? '凌晨/早(<09:00)' : h <= 929 ? '?' : h < 1200 ? '上午盘中' : h <= 1300 ? '午休' : h < 1500 ? '下午盘中' : '傍晚/夜间(>=15:00)'; cnt[k] = (cnt[k] || 0) + 1; }
console.log('\n非竞价时段样本的时段分布:', JSON.stringify(cnt));
