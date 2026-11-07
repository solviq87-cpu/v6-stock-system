// hv 轮取证①：竞价闸门专项 —— score 分布 / prob 分布 / score-命中关系 / 分位压缩
// 目的：回答「普涨日 score 系统性偏低是设计使然（相对排名被压缩）还是可修问题」，
//       以及「分层门槛 / 日内相对分位」哪条路有数据支撑。⛔ 本脚本只读不改。
const fs = require('fs');
const ST = JSON.parse(fs.readFileSync('stats.json', 'utf-8'));

// 与 server.js 同一把尺子：取 auczt 且有 nd 的样本
const sigs = (ST.signals || []).filter(s => s.type === 'auczt' && !s.void);
console.log('auczt 非 void 总数:', sigs.length);

// 环境分层（与 _backtest_nd.js 同口径：按信号日 breadth upRatio）
function envOf(s) {
  const u = s.mkt && typeof s.mkt.upRatio === 'number' ? s.mkt.upRatio : (s.breadth && typeof s.breadth.upRatio === 'number' ? s.breadth.upRatio : null);
  if (u == null) return 'unknown';
  return u < 40 ? '普跌' : u <= 52 ? '退潮' : '普涨';
}
function bucket(arr, key, edges) {
  const out = {};
  for (const e of edges) out[e] = { n: 0, zt: 0, p3: 0, scores: [] };
  for (const s of arr) {
    const v = key(s);
    if (v == null) continue;
    let hit = false;
    for (const e of edges) if (v < e) { hit = true; break; }
    if (!hit) continue;
    const b = out[edges.find(e => v < e)];
    b.n++; if (s.nd && s.nd.limitUp) b.zt++;
    if (s.nd && s.nd.nextPct >= 3) b.p3++;
    b.scores.push(v);
  }
  return out;
}
const EDGES = [40, 50, 60, 70, 80, 101];
const layers = {};
for (const s of sigs) {
  const e = envOf(s);
  (layers[e] = layers[e] || []).push(s);
}
console.log('\n== 环境分层样本量 ==');
for (const k of Object.keys(layers)) console.log(k, layers[k].length);

for (const k of Object.keys(layers)) {
  const arr = layers[k];
  const withNd = arr.filter(s => s.nd);
  if (!withNd.length) { console.log(`\n[${k}] 无 nd 样本`); continue; }
  const sc = arr.map(s => s.score).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const pb = arr.map(s => s.prob).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const q = p => sc.length ? sc[Math.min(sc.length - 1, Math.floor(p * sc.length))] : null;
  const qp = p => pb.length ? pb[Math.min(pb.length - 1, Math.floor(p * pb.length))] : null;
  console.log(`\n== [${k}] score 分布 (n=${sc.length}) ==`);
  console.log(`  min=${sc[0]} p25=${q(0.25)} 中位=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} max=${sc[sc.length-1]}`);
  console.log(`  score<50: ${(sc.filter(v=>v<50).length/sc.length*100).toFixed(1)}%  score>=60: ${(sc.filter(v=>v>=60).length/sc.length*100).toFixed(1)}%`);
  console.log(`  prob 中位=${qp(0.5)}  max=${qp(1)}  prob>55: ${pb.filter(v=>v>55).length}/${pb.length}`);
  // score → 命中关系（对 nd 样本）
  const bk = bucket(withNd, s => s.score, EDGES);
  console.log('  score 分层 → 次日涨停率 / +3%率:');
  for (const e of EDGES) {
    const b = bk[e];
    if (!b.n) continue;
    console.log(`    <${e}: n=${String(b.n).padStart(3)}  涨停=${(b.zt/b.n*100).toFixed(1)}%  +3%=${(b.p3/b.n*100).toFixed(1)}%`);
  }
}

// 全体：score→命中 单调性检验（Kendall tau 简化：Spearman）
const all = sigs.filter(s => s.nd && typeof s.score === 'number');
function rank(arr) { const idx = arr.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]); const r = new Array(arr.length); idx.forEach((p,i)=>{r[p[1]]=i}); return r; }
const rs = rank(all.map(s=>s.score)), rz = rank(all.map(s=>s.nd.limitUp?1:0)), rp = rank(all.map(s=>s.nd.nextPct));
function spear(a,b){const n=a.length;let sa=0;a.forEach((v,i)=>{sa+=(v-(n-1)/2)*(b[i]-(n-1)/2)});return sa/(n*(n*n-1)/12);}
console.log(`\n== 全样本 Spearman(n=${all.length}) ==`);
console.log('  score vs 次日涨停:', spear(rs, rz).toFixed(3));
console.log('  score vs 次日涨幅:', spear(rs, rp).toFixed(3));

// 普涨日错过的票：score<60 但次日涨停 —— 分层门槛的「漏」有多大
const up = (layers['普涨'] || []).filter(s => s.nd);
const missed = up.filter(s => (s.score||0) < 60 && s.nd.limitUp);
console.log(`\n== 普涨日 score<60 漏掉的次日涨停: ${missed.length} 只 / 普涨日 nd 样本 ${up.length} ==`);
for (const m of missed.slice(0, 15)) console.log(`  ${m.date} ${m.code} ${m.name} score=${m.score} prob=${m.prob} 次日+${((m.nd.nextPct||0)).toFixed(1)}%`);
const caught = up.filter(s => (s.score||0) >= 60 && s.nd.limitUp);
console.log(`  score>=60 且次日涨停: ${caught.length} 只`);
// 反向：普涨日 score>=60 但没涨停的（分层门槛的「误」）
const falseUp = up.filter(s => (s.score||0) >= 60 && !s.nd.limitUp);
console.log(`  score>=60 未涨停: ${falseUp.length} 只（其中 +3%: ${falseUp.filter(s=>s.nd.nextPct>=3).length}）`);
