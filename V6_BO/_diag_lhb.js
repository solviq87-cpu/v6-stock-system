'use strict';
// 龙虎榜 + 涨停原因 · 离线端到端诊断
// 看真实数据跑出来是什么样：哪些票被判有大游资、依据写清楚了吗、今天在炒什么题材。
const em = require('./em');

(async () => {
  const d = process.argv[2] || '2026-09-30';
  console.log('──── 龙虎榜（东财）' + d + ' ────');
  const lhb = await em.fetchLhb(d);
  const arr = [...lhb.entries()];
  const whale = arr.filter(([, v]) => v.whale);
  const popular = arr.filter(([, v]) => !v.whale && v.popularNames.length);
  console.log(`上榜 ${arr.length} 只 | 判为大游资 ${whale.length} 只 | 仅东财人气席位 ${popular.length} 只\n`);

  console.log('【判为大游资的（依据可核对）】');
  if (!whale.length) console.log('  （无）');
  for (const [c, v] of whale) console.log(`  ${c}  ${v.why}`);

  console.log('\n【仅人气席位 · 不采信（散户聚集，跟随价值低）】');
  for (const [c, v] of popular.slice(0, 5)) console.log(`  ${c}  ${v.why}`);

  console.log('\n【有营业部净买但不够游资门槛】');
  for (const [c, v] of arr.filter(([, x]) => !x.whale && !x.popularNames.length && x.depts.length).slice(0, 5)) {
    console.log(`  ${c}  ${v.why}`);
  }

  const ztd = d.replace(/-/g, '');
  console.log('\n──── 涨停原因/题材（同花顺）' + ztd + ' ────');
  const zt = await em.fetchZtReason(ztd);
  console.log(`涨停池 ${zt.size} 只，其中有涨停原因 ${[...zt.values()].filter(v => v.reason).length} 只\n`);
  // 与上面同一份题材聚合逻辑
  const m = {};
  for (const v of zt.values()) {
    for (const t of String(v.reason || '').split(/[+＋、,，]/)) {
      const k = t.trim();
      if (k && k.length <= 12) m[k] = (m[k] || 0) + 1;
    }
  }
  const top = Object.entries(m).sort((a, b) => b[1] - a[1]).filter(x => x[1] >= 2).slice(0, 8);
  console.log('【涨停题材 · 只列≥2只的（复盘首行会用）】');
  console.log('  ' + (top.length ? top.map(x => `${x[0]} ${x[1]}只`).join('、') : '（无）'));
  console.log('\n【个股涨停原因示例】');
  for (const [c, v] of [...zt.entries()].slice(0, 6)) {
    console.log(`  ${c} ${v.name.padEnd(6)} ${v.highDays || '-'} → ${v.reason || '(无)'}`);
  }
})();
