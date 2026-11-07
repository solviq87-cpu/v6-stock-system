'use strict';
// 次日作战计划 · 离线实盘验证
// 用 9/30 收盘后真实留下的数据（review.json 涨停池 + .kline_cache 真实K线 + sectors.json 板块）
// 跑一遍 buildPlan，确认挂载后真能产出"买谁/多少钱/止损/怎么验证"，而不是空跑或报错。
const fs = require('fs');
const path = require('path');
const NP = require('./nextplan.js');

const rv = JSON.parse(fs.readFileSync('./review.json', 'utf8'));
const secs = JSON.parse(fs.readFileSync('./sectors.json', 'utf8'));
const ztBySector = {};
for (const it of (rv.items || [])) {
  const k = it.sector || '未知';
  (ztBySector[k] = ztBySector[k] || []).push(it);
}

const universe = [];
let miss = 0;
for (const it of (rv.items || [])) {
  const cf = path.join('.kline_cache', it.code + '.json');
  if (!fs.existsSync(cf)) { miss++; continue; }
  let rows = null;
  try { rows = JSON.parse(fs.readFileSync(cf, 'utf8')).rows; } catch {}
  if (!rows || rows.length < 25) { miss++; continue; }
  const sec = (secs || []).find(x => x.name === it.sector);
  const sector = (it.sector && it.sector !== '未知') ? {
    name: it.sector,
    ztCount: (ztBySector[it.sector] || []).length,
    pct: sec ? +sec.pct || 0 : 0,
    mainInflow: sec ? +sec.mainInflow || 0 : 0,
  } : null;
  universe.push({
    stock: { code: it.code, name: it.name, price: it.price, pct: it.pct, turnover: it.turnover, mainInflow: it.mainPct },
    rows, sector, fundDays: [], elapsedMin: 240,
  });
}

console.log(`涨停池 ${(rv.items || []).length} 只 → K线充足 ${universe.length} 只、缺K线 ${miss} 只`);
const plan = NP.buildPlan(universe, { maxPicks: 6, minScore: 55 });
console.log(`入围 ${plan.count} 只，取前 ${plan.picked.length} 只（日期 ${plan.date}）\n`);
for (const x of plan.picked) {
  console.log(`▌${x.name}(${x.code}) ${x.price}元 ${x.score}分【${x.grade}】板块=${x.sector || '未知'}`);
  console.log(`   进场 ${x.entry[0]}~${x.entry[1]}  止损 ${x.stop}  目标 ${x.target}  量比 ${x.volumeRatio}`);
  (x.reasons || []).slice(0, 2).forEach(r => console.log('   · ' + r));
  (x.invalid || []).slice(0, 1).forEach(r => console.log('   ✗ ' + r));
}
// 门槛降到 0：看真实分数分布，判断 55 分门槛对"全是涨停股的池子"是不是过高
const all = NP.buildPlan(universe, { maxPicks: 52, minScore: 0 });
const scores = all.picked.map(x => x.score);
console.log(`\n──── 分数分布（minScore=0）────`);
console.log(`最高 ${Math.max(...scores)} · 中位 ${scores[Math.floor(scores.length / 2)]} · 最低 ${Math.min(...scores)} · ≥55 分 ${scores.filter(s => s >= 55).length} 只`);
console.log(all.picked.slice(0, 8).map(x => `${x.name}(${x.code}) ${x.score}分 板${x.dims.板块} 资${x.dims.资金} 量${x.dims.量比} 技${x.dims.技术} 纪${x.dims.纪律}`).join('\n'));

// 涨停接力段：与主推同一份 universe，只是门槛降到 45（涨停票被纪律项扣 14 分，55 分下全灭）
const relay = NP.buildPlan(universe, { maxPicks: 4, minScore: 45 });
console.log(`\n──── 涨停接力段（minScore=45）────`);
console.log(`入围 ${relay.count} 只，取前 ${relay.picked.length} 只`);
const zt = new Set((rv.items || []).map(x => x.code));
for (const x of relay.picked) {
  const src = (rv.items || []).find(i => i.code === x.code) || {};
  console.log(`▌${x.name}(${x.code}) ${x.price}元 ${x.score}分 ${src.limitUpCount > 1 ? src.limitUpCount + '连板' : '首板'} · ${x.sector || '未知'}`);
  console.log(`   进场 ${x.entry[0]}~${x.entry[1]} 止损 ${x.stop} 目标 ${x.target}`);
  console.log(`   ✔ ${(x.confirm || [])[0] || '-'}`);
}

console.log('\n──── 推送文案预览（前 24 行）────');
const txt = NP.formatPlan(plan) || '(无)';
console.log(txt.split('\n').slice(0, 24).join('\n'));
