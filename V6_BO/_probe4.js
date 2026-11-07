const em = require('./em.js');
const todo = require('./.missing_codes.json');
const sample = todo.slice(300, 306);
(async () => {
  for (const c of sample) {
    const t0 = Date.now();
    try {
      const k = await em.fetchKline(c, 60);
      console.log(`${c}: ok=${!!(k&&k.rows)} rows=${k&&k.rows?k.rows.length:0} fallback=${!!(k&&k.fallback)} name="${k&&k.name}" ${Date.now()-t0}ms`);
    } catch (e) { console.log(`${c}: ERR ${e.message} ${Date.now()-t0}ms`); }
  }
})();
