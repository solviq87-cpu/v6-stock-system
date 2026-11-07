'use strict';
// 拉取历史每日涨停池 → .ztpool_hist/{date}.json（每份带 src 标记）
// 优先东财 EMX（全A + fbt 首次封板时间 + fund 封单额 + zbc 炸板次数），失败重试后再走 em.fetchZTPool（含同花顺兜底，无 fbt）
const fs = require('fs'), path = require('path');
const em = require('./em.js');
const DIR = path.join(__dirname, '.ztpool_hist');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '.kline_cache/600418.json'), 'utf8'));
const allDates = (sample.rows || []).map(r => r.date);
const dates = allDates.slice(-61, -1);
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
  let ok = 0, miss = [];
  for (const d of dates) {
    let pool = null, src = '';
    for (let att = 0; att < 3 && !pool; att++) {
      try { pool = await emxPool(d); } catch { pool = null; }
      if (!pool) await sleep(1200 + att * 1500);
    }
    if (!pool) {
      try { pool = await em.fetchZTPool(d.replace(/-/g, '')); src = 'ths-fallback'; } catch { pool = null; }
    }
    if (pool && pool.length) { fs.writeFileSync(path.join(DIR, d + '.json'), JSON.stringify(pool)); ok++; }
    else miss.push(d);
    await sleep(350);
  }
  console.log(`✅ 涨停池缓存 ${ok}/${dates.length} 天` + (miss.length ? `；缺失: ${miss.join(' ')}` : ''));
  let tot = 0, first = 0, emSrc = 0;
  for (const d of dates) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(DIR, d + '.json'), 'utf8'));
      tot += j.length; first += j.filter(x => (x.limitUpCount || 1) === 1).length;
      if (j[0] && j[0].src === 'em') emSrc++;
    } catch {}
  }
  console.log(`股票日 ${tot} 条，首板候选 ${first} 条；东财源 ${emSrc}/${dates.length} 天`);
})();
