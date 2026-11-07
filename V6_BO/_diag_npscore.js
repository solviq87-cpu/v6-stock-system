// 诊断：次日作战计划为什么 42 只候选全部落榜（count=0 / relay=0）
// 用真实涨停池 + 本地 K 线缓存，跑 nextplan 的评分，看真实分数分布
const fs = require('fs');
const NP = require('./nextplan.js');

const st = JSON.parse(fs.readFileSync('_d.json', 'utf8'));
const zp = st.ztPool || [];
const zbsArr = st.ztBySector || [];
const ztCountOf = {};
for (const x of zbsArr) ztCountOf[x.sector] = x.count;

const universe = [];
const miss = [];
for (const z of zp) {
  const f = '.kline_cache/' + z.code + '.json';
  if (!fs.existsSync(f)) { miss.push([z.name, '无K线缓存']); continue; }
  let k;
  try { k = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { miss.push([z.name, 'K线解析失败']); continue; }
  if (!k.rows || k.rows.length < 25) { miss.push([z.name, 'K线不足25根(' + ((k.rows || []).length) + ')']); continue; }
  universe.push({
    stock: { code: z.code, name: z.name, price: z.price, pct: z.pct, turnover: z.turnover, mainInflow: z.mainInflow || 0 },
    rows: k.rows,
    sector: { name: z.sector, ztCount: ztCountOf[z.sector] || 0, pct: 0, mainInflow: 0 },
    fundDays: [], elapsedMin: 240,
  });
}

console.log('涨停池 ' + zp.length + ' 只，可用 K 线 ' + universe.length + ' 只，缺样本 ' + miss.length + ' 只');
if (miss.length) console.log('  缺样本eg:', miss.slice(0, 5).map(m => m[0] + '(' + m[1] + ')').join(', '));

// minScore=0 → 放开门槛看全部分数分布
const plan = NP.buildPlan(universe, { maxPicks: 999, minScore: 0 });
const picked = plan.picked || [];
console.log('\n全部打分 ' + picked.length + ' 只（minScore=0）');
const scores = picked.map(x => x.score).sort((a, b) => b - a);
console.log('分数分布: 最高=' + (scores[0] ?? '-') + ' 最低=' + (scores[scores.length - 1] ?? '-') +
  ' 中位=' + (scores[Math.floor(scores.length / 2)] ?? '-'));
const bucket = { '>=55': 0, '45-54': 0, '35-44': 0, '<35': 0 };
for (const s of scores) {
  if (s >= 55) bucket['>=55']++;
  else if (s >= 45) bucket['45-54']++;
  else if (s >= 35) bucket['35-44']++;
  else bucket['<35']++;
}
console.log('分档计数:', JSON.stringify(bucket));
console.log('\nTop15:');
picked.slice(0, 15).forEach(x => {
  const dims = x.dims || {};
  console.log('  ' + String(x.score).padStart(3) + '分 ' + x.name + '(' + x.code + ') ' + (x.sector || '') +
    ' | 板块' + dims.板块 + ' 资金' + dims.资金 + ' 量比' + dims.量比 + ' 技术' + dims.技术 + ' 纪律' + dims.纪律 +
    ' | ' + x.grade);
});
if (picked[0]) {
  console.log('\n最高分票的完整分项:');
  console.log(JSON.stringify({ name: picked[0].name, score: picked[0].score, dims: picked[0].dims, reasons: (picked[0].reasons || []).slice(0, 5), risks: (picked[0].risks || []).slice(0, 5) }, null, 1));
}
