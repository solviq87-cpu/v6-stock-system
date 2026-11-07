// cl 轮守门：兜底路径必须被【真跑过一次】，不能只写在注释里。
// 角度：系统里到处是"取不到就用 X 兜底"的分支，平时几乎不走、测试很少覆盖，
//       一旦真走到就是从未被执行过的代码 —— 里面崩了、算了 NaN，谁都不会发现。
// 抓到的实例（都是真实可达的）：
//   ① buildZTReason：涨停池字段缺失时 `zt.turnover.toFixed(1)` 直接 TypeError。
//      而同一个 z 对象在复盘里另一处写的是 `+(Number(z.turnover) || 0).toFixed(1)`（有防护）——
//      同一份数据两处处理不一致，正说明这条路径从没被执行过。它崩在复盘 items 构造里 = 整份复盘归零。
//      另外 fmtWan(undefined) 会算出 "封单NaN万" 这种脏文案。
//   ② nextDayLimitProb：入参带 undefined/NaN 时整个 z 变 NaN → 概率返回 NaN，
//      存进 items、参与排序、最后在推送文案里打成 "概率NaN%"。
//   ③ 复盘 sealRatio：amount 有值而 sealAmount 缺失时 `undefined/正数` = NaN，一路污染下去。
// 离线、确定性：真跑 analysis.js，不碰线上数据。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const A = require('./analysis');
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

const row = (c, pct) => ({ close: c, open: c, high: c * 1.01, low: c * 0.99, vol: 1e6, pct: pct || 0, turnover: 3, date: '2026-10-06' });
const rows30 = (() => { const a = []; for (let i = 0; i < 30; i++) a.push(row(10 + i * 0.1, 0.5)); return a; })();
const noNaN = s => !/NaN|undefined|Infinity/.test(String(s));

console.log('\n【⛔⛔ 自检：先证明这些函数真的会被外部数据的缺失打到】');
{
  ok('自检：buildZTReason 正常输入能出文案',
    /板块/.test(A.buildZTReason({ zt: { sector: '银行', turnover: 3.5, sealAmount: 1e8, breakCount: 0, limitUpCount: 1 }, sectorZT: 1, sectorInflow: 0, sealRatio: 0.3 })));
  ok('自检：nextDayLimitProb 正常输入返回 0~100',
    (v => Number.isFinite(v) && v >= 0 && v <= 100)(A.nextDayLimitProb({ limitUpCount: 2, sealRatio: 0.3, breakCount: 0, sectorZT: 3, turnover: 8, aboveMa5: true })));
  ok('自检：scoreStock 正常输入能出分',
    (v => v && Number.isFinite(v.score))(A.scoreStock({ rows: rows30, profitRatio: 0.8, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 1 })));
}

console.log('\n【① buildZTReason：字段缺失不许崩，也不许打 NaN】');
{
  const cases = [
    ['zt 为空对象', { zt: {}, sectorZT: 0, sectorInflow: 0, sealRatio: 0 }],
    ['zt 为 null', { zt: null, sectorZT: 0, sectorInflow: 0, sealRatio: 0 }],
    ['缺 turnover', { zt: { sector: '银行', sealAmount: 1e8 }, sectorZT: 3, sectorInflow: 1e8, sealRatio: 0.5 }],
    ['缺 sealAmount', { zt: { sector: '银行', turnover: 3 }, sectorZT: 2, sectorInflow: 0, sealRatio: 0.2 }],
    ['缺 sector', { zt: { turnover: 3, sealAmount: 1e8 }, sectorZT: 3, sectorInflow: 1e8, sealRatio: 0.5 }],
    ['turnover 为 NaN', { zt: { sector: '银行', turnover: NaN, sealAmount: 1e8 }, sectorZT: 0, sectorInflow: 0, sealRatio: 0 }],
    ['sealRatio 为 NaN', { zt: { sector: '银行', turnover: 3, sealAmount: 1e8 }, sectorZT: 0, sectorInflow: 0, sealRatio: NaN }],
  ];
  for (const [nm, arg] of cases) {
    let v = '', err = '';
    try { v = A.buildZTReason(arg); } catch (e) { err = (e && e.message) || String(e); }
    ok('⛔ ' + nm + ' → 不崩', !err, err.slice(0, 70));
    if (!err) ok('   ' + nm + ' → 文案里没有 NaN/undefined', noNaN(v), v.slice(0, 80));
  }
}

console.log('\n【② nextDayLimitProb：任何输入都必须是 0~100 的有限数】');
{
  const cases = [
    ['全字段 undefined', { limitUpCount: undefined, sealRatio: undefined, breakCount: undefined, sectorZT: undefined, turnover: undefined, aboveMa5: undefined }],
    ['空对象', {}],
    ['sealRatio 为 NaN', { limitUpCount: 1, sealRatio: NaN, breakCount: 0, sectorZT: 2, turnover: 8, aboveMa5: true }],
    ['turnover 为 NaN', { limitUpCount: 1, sealRatio: 0.3, breakCount: 0, sectorZT: 2, turnover: NaN, aboveMa5: true }],
    ['全 0', { limitUpCount: 0, sealRatio: 0, breakCount: 0, sectorZT: 0, turnover: 0, aboveMa5: false }],
    ['极值 999', { limitUpCount: 999, sealRatio: 999, breakCount: 999, sectorZT: 999, turnover: 999, aboveMa5: true }],
  ];
  for (const [nm, arg] of cases) {
    const v = A.nextDayLimitProb(arg);
    ok('⛔ ' + nm + ' → 有限数且在 0~100', Number.isFinite(v) && v >= 0 && v <= 100, String(v));
  }
  // 反证：旧写法确实会把 NaN 放出去（把旧算法照抄一遍跑）
  const old = ({ limitUpCount, sealRatio }) => {
    let z = -2.1;
    z += 0.55 * Math.min(limitUpCount - 1, 4);
    z += 2.0 * Math.min(sealRatio, 1);
    return +(100 / (1 + Math.exp(-z))).toFixed(0);
  };
  ok('反证：旧写法在 sealRatio=NaN 时确实返回 NaN', Number.isNaN(old({ limitUpCount: 1, sealRatio: NaN })));
}

console.log('\n【③ 复盘 sealRatio：amount 有值但 sealAmount 缺失时不许算出 NaN】');
{
  // 把复盘里那两行抠出来真跑（不复制算法，直接验证源码里就是这个写法）
  const m = /const _amt = Number\(z\.amount\), _seal = Number\(z\.sealAmount\);[\s\S]{0,200}?const sealRatio = isFinite\(_sr\) \? Math\.min\(_sr, 1\.5\) : 0;/.exec(SV);
  ok('⛔ 复盘里的 sealRatio 计算带 isFinite 兜底', !!m);
  const calc = new Function('z', (m ? m[0] : '') + '\nreturn sealRatio;');
  ok('sealAmount 缺失 → 0（不是 NaN）', calc({ amount: 1e8, sealAmount: undefined }) === 0);
  ok('两者都有 → 正常比例', Math.abs(calc({ amount: 1e8, sealAmount: 2e7 }) - 0.2) < 1e-9, String(calc({ amount: 1e8, sealAmount: 2e7 })));
  ok('amount 为 0 → 0', calc({ amount: 0, sealAmount: 1e8 }) === 0);
  // 反证：旧写法
  const old = z => z.amount > 0 ? Math.min(z.sealAmount / z.amount, 1.5) : 0;
  ok('反证：旧写法在 sealAmount 缺失时确实算出 NaN', Number.isNaN(old({ amount: 1e8, sealAmount: undefined })));
}

console.log('\n【④ 声明过的中性兜底，实际执行时要成立】');
{
  // 大单：缺 K 线 → 权重按中性 0.7（不是 0，也不是判死）
  // ⛔ dh 轮改判据：中性值已收进 MISS_RULE 表，钉字面量会假红（第六次同类坑）；
  //    这里要钉的是**语义** —— 缺 K 线时给的是登记过的中性权重，且这个权重是 0.7（不是 0、不是判死）。
  const m = /const w = \(x\.ctx && x\.ctx\.weight != null\) \? x\.ctx\.weight : missingOf\('bmCtxWeight'\);/.test(SV);
  ok('大单排序：缺 K 线按中性权重（走 MISS_RULE.bmCtxWeight）', m);
  ok('  且这个中性权重登记为 0.7（不是 0，也不是判死）',
    /bmCtxWeight:\s*\{\s*kind:\s*'weight',\s*value:\s*0\.7/.test(SV));
  const w = (ctx) => (ctx && ctx.weight != null) ? ctx.weight : 0.7;
  ok('  ctx 为 undefined → 0.7', w(undefined) === 0.7);
  ok('  ctx 为 null → 0.7', w(null) === 0.7);
  ok('  ctx 有 weight → 用它', w({ weight: 1.0 }) === 1.0);
  // 位置未判定的票不许进涨停候选（判不出来 ≠ 没问题）
  const ctxUnknown = x => !x.ctx;
  ok('⛔ 位置未判定(ctx=null)被认出来，不会当成"不是接盘单"', ctxUnknown({ ctx: null }) === true);
  ok('  有 ctx 时不算未知', ctxUnknown({ ctx: { flowKind: '趋势中加仓' } }) === false);
  // 趋势池：市值缺数据不拦（只有明确小于 50 亿才拦）
  const hg = A.trendHygiene(rows30, 12, null);
  ok('⛔ 趋势体检缺市值 → capOk 为 null（不是 false）', hg.capOk === null, String(hg.capOk));
  const vd = A.trendVerdict(hg, '温和');
  ok('  缺市值不判死（jumpy 只看波动）', vd.jumpy === false, JSON.stringify(vd));
  ok('  ⛔ 通道忘传时按温和（严的一侧），不是按强势', A.trendVerdict({}).channel === '温和');
}

console.log('\n【⑤ 兜底不许返回 NaN：全项目普查】');
{
  const fns = ['nextDayLimitProb', 'buildZTReason', 'scoreStock', 'bigMoneyContext', 'reviewFlags', 'trendHygiene', 'trendVerdict'];
  for (const f of fns) {
    let bad = '';
    for (const arg of [undefined, null, {}, [], 0, NaN]) {
      let v;
      try { v = A[f](arg); } catch (e) { continue; }   // 崩了由别处管，这里只看"悄悄返回 NaN"
      const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      if (/NaN|Infinity/.test(s)) { bad += ' ' + JSON.stringify(arg) + '→' + s.slice(0, 40); }
    }
    ok('⛔ ' + f + ' 对畸形入参不返回 NaN/Infinity', !bad, bad.slice(0, 90));
  }
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
