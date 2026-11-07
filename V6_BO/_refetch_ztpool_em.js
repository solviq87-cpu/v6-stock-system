'use strict';
// 慢速重试：把 .ztpool_hist 里同花顺兜底的日期换成东财源（带 fbt 封板时间）
// EMX 限流是 burst 型的：单次手动请求能成，连续 59 次就挡 → 每 4s 一次、单尝试、失败下轮再来
const fs = require('fs'), path = require('path');
const em = require('./em.js');
const DIR = path.join(__dirname, '.ztpool_hist');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function emxPool(d) {
  const u = 'https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt' +
    '&Pageindex=0&pagesize=1000&sort=fbt%3Aasc&date=' + d.replace(/-/g, '');
  const j = await em.get(u, 12000);
  const pool = j && j.data && j.data.pool;
  if (!Array.isArray(pool) || !pool.length) return null;
  return pool.map(x => ({
    code: x.c, name: x.n, price: x.p / 1000, pct: x.zdp,
    amount: x.amount, floatCap: x.ltsz, turnover: +x.hs || 0,
    limitUpCount: x.lbc, sealAmount: x.fund, breakCount: x.zbc,
    firstSeal: x.fbt, lastSeal: x.lbt, streakDays: x.zttj ? x.zttj.days : 1,
    sector: x.hybk, src: 'em'
  }));
}
(async () => {
  for (let round = 1; round <= 3; round++) {
    const need = fs.readdirSync(DIR).filter(f => {
      try { const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); return !(j[0] && j[0].src === 'em'); } catch { return true; }
    });
    if (!need.length) break;
    console.log(`第 ${round} 轮：待换源 ${need.length} 天`);
    for (const f of need) {
      const d = f.replace('.json', '');
      let pool = null;
      try { pool = await emxPool(d); } catch {}
      if (pool && pool.length) { fs.writeFileSync(path.join(DIR, f), JSON.stringify(pool)); console.log(`  ✅ ${d} 换东财源 ${pool.length} 只`); }
      await sleep(4000);
    }
  }
  let em = 0, ths = 0;
  for (const f of fs.readdirSync(DIR)) { try { const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); if (j[0] && j[0].src === 'em') em++; else ths++; } catch {} }
  console.log(`完成：东财源 ${em} 天 / 同花顺 ${ths} 天`);
})();
