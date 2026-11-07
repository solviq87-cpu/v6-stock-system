const em = require('./em.js');
const todo = require('./.missing_codes.json');
const sample = todo.slice(0, 60);
(async () => {
  const t0 = Date.now();
  const r = await em.fetchKlineBulk(sample, 60, 10);
  console.log(`批量 ${sample.length} 只 并发10：成功 ${r.added} 失败 ${r.fail}  耗时 ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log('失败的:', r.failed.slice(0,10).join(','));
  const one = r.map.get(sample.find(c=>r.map.has(c)));
  if (one) console.log('样例 rows=', one.rows.length, 'fallback=', !!one.fallback, '最后:', JSON.stringify(one.rows[one.rows.length-1]));
  console.log('东财是否判定不可用:', em.emKlineDown());
})();
