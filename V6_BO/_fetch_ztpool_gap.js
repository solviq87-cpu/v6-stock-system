// 定向补拉 .ztpool_hist 缺失日（2026-10-13 ~ 10-20），复用 _fetch_ztpool_hist.js 的 EMX 主路 + 同花顺兜底
const fs = require('fs'), path = require('path');
const em = require('./em.js');
const DIR = path.join(__dirname, '.ztpool_hist');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
const want = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'];
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
  let ok = 0; const miss = [];
  for (const d of want) {
    if (fs.existsSync(path.join(DIR, d + '.json'))) { console.log('skip 已有', d); ok++; continue; }
    let pool = null;
    for (let att = 0; att < 3 && !pool; att++) {
      try { pool = await emxPool(d); } catch { pool = null; }
      if (!pool) await sleep(1200 + att * 1500);
    }
    if (!pool) { try { pool = await em.fetchZTPool(d.replace(/-/g, '')); } catch { pool = null; } }
    if (pool && pool.length) { fs.writeFileSync(path.join(DIR, d + '.json'), JSON.stringify(pool)); ok++; console.log('✅', d, pool.length, '只', pool[0].src || 'ths'); }
    else { miss.push(d); console.log('❌', d); }
    await sleep(350);
  }
  console.log(`完成 ${ok}/${want.length}` + (miss.length ? `；缺失: ${miss.join(' ')}` : ''));
})();
