// 定论用探针：涨停家数到底是多少？数据源 vs 系统留存。
// 用法: node _probe_zt_count.js [YYYY-MM-DD]
const https = require('https');
const fs = require('fs');
const path = require('path');
const AGENT = new https.Agent({ keepAlive: false, maxSockets: 8, family: 4 });
const EMX = 'https://push2ex.eastmoney.com';

function raw(url) {
  return new Promise((res, rej) => {
    const r = https.get(url, {
      agent: AGENT,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' }
    }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res(b)); });
    r.on('error', rej);
    r.setTimeout(15000, () => { r.destroy(); rej(new Error('timeout')); });
  });
}
function limitPctOf(code, name) {
  if (/ST/i.test(name || '')) return 5;
  if (/^92|^(43|83|87)/.test(code)) return 30;
  if (/^(300|301|688|689)/.test(code)) return 20;
  return 10;
}
// 真实的 A：直接 require 项目里的判定逻辑，避免探针自己写错
const A = require('./analysis.js');

(async () => {
  const day = process.argv[2] || '2026-09-28';
  console.log('目标交易日 =', day);

  let pool = [];
  try {
    const j = JSON.parse(await raw(
      `${EMX}/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt` +
      `&Pageindex=0&pagesize=1000&sort=fbt%3Aasc&date=${day}`));
    pool = (j && j.data && j.data.pool) || [];
  } catch (e) { console.log('取源失败:', e.message); }

  console.log('\n【数据源 getTopicZTPool】', pool.length, '只');
  const cls = { 主板10: 0, '创业科创20': 0, ST5: 0, 北交所30: 0 };
  const odd = [];
  for (const d of pool) {
    const code = d.c || '', name = d.n || '', pct = d.zdp || 0;
    if (/ST/i.test(name)) cls.ST5++;
    else if (/^(300|301|688|689)/.test(code)) cls['创业科创20']++;
    else if (/^(43|83|87|92)/.test(code)) cls.北交所30++;
    else cls.主板10++;
    // 源给的涨幅与「按其板块算的涨停线」对不上的，单独挑出来看
    const need = limitPctOf(code, name);
    if (Math.abs(pct - need) > 0.6) odd.push(`${code} ${name} 涨幅${pct}% 该板块涨停线${need}%`);
  }
  console.log('  分布:', JSON.stringify(cls));
  if (odd.length) { console.log('  ⚠ 涨幅与板块涨停线不符(前8):'); odd.slice(0, 8).forEach(s => console.log('     ', s)); }

  // 硬编码 9.4% 会把谁丢掉 / 把谁误算
  const ge94 = pool.filter(d => (d.zdp || 0) >= 9.4).length;
  const byA = pool.filter(d => A.isLimitUp(d.c, d.n, d.zdp)).length;
  console.log('\n【口径对比】');
  console.log('  写死 pct>=9.4 的老口径 ->', ge94, '只   ← 现在线上用的就是这个');
  console.log('  按板块判定 isLimitUp  ->', byA, '只');
  console.log('  数据源原始            ->', pool.length, '只');
  if (pool.length !== ge94) console.log(`  ⇒ 硬编码口径漏了 ${pool.length - ge94} 只`);

  const missers = pool.filter(d => (d.zdp || 0) < 9.4);
  if (missers.length) {
    console.log('\n  被 9.4% 门槛丢掉的票：');
    for (const d of missers) console.log(`     ${d.c} ${d.n} 涨幅${d.zdp}%  涨停线${limitPctOf(d.c, d.n)}%  ${limitPctOf(d.c, d.n) === 5 ? '← ST股，5%就算涨停' : ''}`);
  }

  // 系统留存
  try {
    const rev = JSON.parse(fs.readFileSync(path.join(__dirname, 'review.json'), 'utf8'));
    console.log('\n【系统留存 review.json】', (rev.items || []).length, '只 (', rev.time, ')');
    const rc = new Set((rev.items || []).map(x => x.code));
    const gone = pool.filter(d => !rc.has(d.c));
    if (gone.length) {
      console.log('  源里有、复盘里没有的', gone.length, '只：');
      gone.forEach(d => console.log(`     ${d.c} ${d.n} 涨幅${d.zdp}% 涨停线${limitPctOf(d.c, d.n)}%`));
    } else console.log('  复盘与源完全一致');
  } catch (e) { console.log('读 review.json 失败:', e.message); }
})();
