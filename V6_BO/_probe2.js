const em = require('./em.js');
const todo = require('./.missing_codes.json');
const sample = todo.slice(100, 112);
async function run(label, fn, conc) {
  const t0 = Date.now(); let ok = 0, f = 0; let i = 0;
  async function w() { while (i < sample.length) { const c = sample[i++]; try { const k = await fn(c); if (k && k.rows && k.rows.length >= 6) ok++; else f++; } catch { f++; } } }
  await Promise.all(Array.from({ length: conc }, w));
  console.log(`${label} 并发${conc}: 成功${ok} 失败${f} 耗时${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
(async () => {
  await run('EM ', (c) => em.__em ? em.__em(c, 60) : null, 8);
})().catch(e => console.log('need export:', e.message));
