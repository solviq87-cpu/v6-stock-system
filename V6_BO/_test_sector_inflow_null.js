// io 轮守门（M2 修复）：涨停池/复盘的「板块主力净流入」缺失时不得冒充成 0。
// 角度：复盘条目里 `sectorInflow: sec ? sec.mainInflow : 0` 在板块查不到时把"查不到"
//       渲染成"净流入 0"，与同函数 `mainPct: null`（缺失用 null）口径矛盾，
//       也违背「资金流缺失降级显式声明（不拿 0 冒充）」铁律，直接冲击"每个数字可信"。
// 修复：缺失改 null；推送文案对 null 显示「缺失」而非 0万。
// 离线、确定性：真跑 analysis.js + 源码字面量守门。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const A = require('./analysis');
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

console.log('\n【① buildZTReason：板块净流入缺失（null）不应打出"亿"，也不许 NaN】');
{
  // 板块爆发（sectorZT>=3）时，若板块净流入缺失，文案不应含"主力净流入X亿"
  const rNull = A.buildZTReason({ zt: { sector: '银行', turnover: 3, sealAmount: 1e8 }, sectorZT: 3, sectorInflow: null, sealRatio: 0.5 });
  ok('⛔ sectorInflow=null 不崩', !!rNull);
  ok('⛔ sectorInflow=null 文案无 NaN', !/NaN|undefined|Infinity/.test(rNull), rNull.slice(0, 80));
  ok('⛔ sectorInflow=null 时不打印"主力净流入"', !/主力净流入/.test(rNull), rNull.slice(0, 80));
  // 反证：有真实净流入时应当打印，证明守卫是"区分缺失 vs 有值"而非"一律不打印"
  const rReal = A.buildZTReason({ zt: { sector: '银行', turnover: 3, sealAmount: 1e8 }, sectorZT: 3, sectorInflow: 5e8, sealRatio: 0.5 });
  ok('反证：sectorInflow=5e8 时确实打印"主力净流入"', /主力净流入/.test(rReal), rReal.slice(0, 80));
}

console.log('\n【② 源码字面量：复盘条目 sectorInflow 缺失用 null 不冒充 0】');
{
  // 涨停池/复盘条目构造（server.js ~11253/11256）：缺失必须落成 null
  ok('⛔ 复盘条目 sectorInflow 缺失 = null',
    /sectorInflow:\s*sec\s*\?\s*sec\.mainInflow\s*:\s*null/.test(SV));
  // 推送文案（server.js ~11286）：缺失显示「缺失」而非 inf(null)="0万"
  ok('⛔ 复盘推送文案对缺失板块净流入显示"缺失"而非 0万',
    /x\.sectorInflow\s*!=\s*null\s*\?\s*inf\(x\.sectorInflow\)\s*:\s*'缺失'/.test(SV));
  // 口径一致性：同函数内 mainPct 用 null（不应被改回 0）
  ok('⛔ 同条目 mainPct 缺失仍用 null（口径一致）',
    /mainPct:\s*snap\s*&&\s*snap\.mainPct\s*\?\s*snap\.mainPct\s*:\s*null/.test(SV));
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
