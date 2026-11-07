// 一次性测量：auczt prob 三代刻度在学习库里的分布与 empTable 桶污染
// 口径：stats.json signals，auczt 非 void；按发布日期切三代
//   era1: date < 20261015（hz 包之前，旧刻度 18+sc*0.62）
//   era2: 20261015 <= date < 20261016（hy 分段刻度，hz 包）
//   era3: date >= 20261016（ig 诚实刻度 9/20）
const fs = require('fs');
const path = require('path');
const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));
const sig = (st.signals || []).filter(s => s.type === 'auczt' && !s.void && s.prob != null && isFinite(s.prob));
const eraOf = d => (d < 20261015 ? 'era1旧' : (d < 20261016 ? 'era2中' : 'era3诚实'));
const byEra = {};
for (const s of sig) {
  const e = eraOf(String(s.date).replace(/-/g, ''));
  (byEra[e] = byEra[e] || []).push(s);
}
console.log('auczt 非void 有prob 样本总数:', sig.length);
for (const e of Object.keys(byEra).sort()) {
  const arr = byEra[e];
  const ps = arr.map(s => s.prob).sort((a, b) => a - b);
  const hit = arr.filter(s => s.resolved && s.resolved.limitUp).length;
  console.log(`${e}: n=${arr.length} prob[min=${ps[0]}, p25=${ps[Math.floor(ps.length * .25)]}, 中位=${ps[Math.floor(ps.length / 2)]}, p75=${ps[Math.floor(ps.length * .75)]}, max=${ps[ps.length - 1]}] 当日封板=${(hit / arr.length * 100).toFixed(1)}%`);
}
// 按 5 分桶看每个桶由哪个年代构成（模拟 empBucketOf 的 5 分档）
function bucketOf(p) { return Math.floor(p / 5) * 5; }
const buckets = {};
for (const s of sig) {
  const b = bucketOf(s.prob);
  const v = buckets[b] = buckets[b] || { n: 0, era1: 0, era2: 0, era3: 0, hit: 0 };
  v.n++; v[eraOf(String(s.date).replace(/-/g, ''))]++;
  if (s.resolved && s.resolved.limitUp) v.hit++;
}
console.log('\n桶 | n | era构成 | 桶内当日封板率');
for (const b of Object.keys(buckets).map(Number).sort((a, c) => a - c)) {
  const v = buckets[b];
  console.log(`${b}-${b + 4} | ${v.n} | 旧${v.era1}/中${v.era2}/诚${v.era3} | ${(v.hit / v.n * 100).toFixed(1)}%`);
}
// empProb 查档模拟：新信号 prob=9 与 prob=20 会读到哪个桶
console.log('\n新刻度信号查档: prob=9 → 桶', bucketOf(9) + '-' + (bucketOf(9) + 4), '；prob=20 → 桶', bucketOf(20) + '-' + (bucketOf(20) + 4));
