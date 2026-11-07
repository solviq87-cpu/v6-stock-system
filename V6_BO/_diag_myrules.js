'use strict';
// 用户的「十四条」离线实盘验证：用 9/30 收盘后真实数据（涨停池 + K线缓存 + 板块榜）跑一遍，
// 看看真实票在用户自己的体系下能命中几条、卡在哪几条。
const fs = require('fs');
const path = require('path');
const MY = require('./myrules.js');
const A = require('./analysis.js');

const rv = JSON.parse(fs.readFileSync('./review.json', 'utf8'));
const secs = JSON.parse(fs.readFileSync('./sectors.json', 'utf8'));
const ztBySector = {};
for (const it of (rv.items || [])) { const k = it.sector || '未知'; (ztBySector[k] = ztBySector[k] || []).push(it); }

const list = [];
let miss = 0;
for (const it of (rv.items || [])) {
  const cf = path.join('.kline_cache', it.code + '.json');
  let rows = null;
  try { rows = JSON.parse(fs.readFileSync(cf, 'utf8')).rows; } catch {}
  if (!rows || rows.length < 60) { miss++; continue; }
  const sec = (secs || []).find(x => x.name === it.sector);
  let pr = null;
  try { pr = A.calcProfitRatio(rows); } catch {}
  list.push({
    stock: {
      code: it.code, name: it.name, price: it.price, pct: it.pct, floatCap: it.floatCap,
      amount: it.amount, sealAmount: it.sealAmount, limitUpCount: it.limitUpCount, breakCount: it.breakCount,
    },
    rows,
    sector: (it.sector && it.sector !== '未知') ? { name: it.sector, ztCount: (ztBySector[it.sector] || []).length, pct: sec ? +sec.pct || 0 : 0 } : null,
    auction: null,   // 非竞价时段，天然无数据 → ⑥⑧ 应标"缺数据"
    profitRatio: pr,
  });
}
console.log(`涨停池 ${(rv.items || []).length} 只 → K线≥60根 ${list.length} 只、不足 ${miss} 只\n`);
const r = MY.scan(list, {});
console.log(`符合十四条的：${r.count} 只 / 共 ${r.all.length} 只\n`);
console.log('──── 命中条数排行（前 6）────');
for (const x of r.all.slice(0, 6)) {
  console.log(`▌${x.name}(${x.code}) 命中 ${x.hits}/${x.known} 条${x.pass ? ' ✅符合' : ''}${x.unknown ? ` · ${x.unknown}条缺数据` : ''}`);
  console.log(`   命中 [${x.hitList.join(',')}]  未中 [${x.missList.join(',')}]  缺数据 [${x.unknownList.join(',')}]`);
}
console.log('\n──── 全样本：每条各被命中多少次 ────');
const stat = {};
for (const x of r.all) for (const t of x.items) {
  stat[t.i] = stat[t.i] || { name: t.name, hit: 0, miss: 0, unk: 0 };
  if (t.unknown) stat[t.i].unk++; else if (t.ok) stat[t.i].hit++; else stat[t.i].miss++;
}
for (const k of Object.keys(stat).sort((a, b) => a - b)) {
  const v = stat[k];
  console.log(`  [${k}] ${v.name}：命中 ${v.hit} · 未中 ${v.miss} · 缺数据 ${v.unk}`);
}
if (r.all[0]) { console.log('\n──── 样例：第一名逐条判定 ────'); console.log(MY.formatOne(r.all[0])); }
