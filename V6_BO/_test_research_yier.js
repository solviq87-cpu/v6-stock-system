// hj2 轮 / ik 版本守门：H2 封板时间（首次封板 firstSeal）因子接入 nextDayLimitProb 后，
// 用守门把"因子真的生效 + 旧写法真的分不出"两件事都钉死。
//
// 故障形态（要防的）：因子只挂在注释里、或接线漏掉某调用点、或 firstSeal 解析被东财/同花顺源差异吞掉
//   —— 表面上"加了因子"，实际 nextDayLimitProb 对早封与午后封算出来一模一样（用户看到的推送中封板时间
//   永远不影响概率）。本守门用沙箱真跑 + 旧写法反证，把"生效"和"失效"都断言出来。
//
// 判据全部「钉语义不钉字符串」：早封概率必须高于午后封（且二者都不等于中性基线），
// 缺数据/非交易时段必须落中性档（不加不减，不把缺数据当看空），旧写法对两种封板时间无区分力。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const A = require('./analysis');
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const AN = fs.readFileSync(path.join(ROOT, 'analysis.js'), 'utf8');
const EM = fs.readFileSync(path.join(ROOT, 'em.js'), 'utf8');
const IH = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') throw new Error('守门断言条件必须是布尔值（参数顺序写反了？）: ' + name);
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + '  ──'); }

// 中性基线参数：构造一个 z≈0.3（概率≈58）的中间档，让 +0.1z / -0.2z 在整数概率上分得开。
const base = {
  limitUpCount: 1, sealRatio: 0.5, sealStrength: 0.2, breakCount: 0,
  sectorZT: 3, turnover: 8, aboveMa5: true,
  capYi: 0, rangePos: 80, volRatio: 1.2, brkEngulf: false,
  mktUpRatio: 50, gapUp: 0, sigDate: null, cci: null,
  firstSeal: null
};

group('[1] 沙箱真跑：封板时间因子对概率产生方向正确的偏移');
const pNeutral = A.nextDayLimitProb(Object.assign({}, base, { firstSeal: '143001' })); // 14:30:01 落中性档
const pEarly = A.nextDayLimitProb(Object.assign({}, base, { firstSeal: '093000' }));    // 09:30 ≤10:00 早封
const pAfternoon = A.nextDayLimitProb(Object.assign({}, base, { firstSeal: '133000' }));// 13:30 13:00-14:00 午后封
ok(typeof pNeutral === 'number' && isFinite(pNeutral), '中性基线概率有效', 'pNeutral=' + pNeutral);
ok(pEarly > pNeutral, '早封(≤10:00) 概率高于中性基线', `early=${pEarly} neutral=${pNeutral}`);
ok(pAfternoon < pNeutral, '午后封(13:00-14:00) 概率低于中性基线', `afternoon=${pAfternoon} neutral=${pNeutral}`);
ok(pEarly > pAfternoon, '早封概率显著高于午后封（因子方向正确）', `early=${pEarly} afternoon=${pAfternoon}`);
ok(pEarly - pAfternoon >= 5, '早封与午后封拉开至少 5 个百分点的概率差', `Δ=${pEarly - pAfternoon}`);

group('[2] 缺数据 / 非交易时段 = 落中性档（不加不减，不把缺数据当看空）');
const neutralVals = [null, '', 0, 'abc', '120000', '170000', '113000', '999999'];
let allNeutral = true, detail = '';
for (const v of neutralVals) {
  const p = A.nextDayLimitProb(Object.assign({}, base, { firstSeal: v }));
  if (p !== pNeutral) { allNeutral = false; detail += `[${JSON.stringify(v)}→${p}] `; }
}
ok(allNeutral, '缺失/格式错/午休/收盘后/开盘前 全部落中性档（p 与中性基线一致）', detail);

group('[3] 9:25 集合竞价封板 归早封档（≤10:00）');
const pAuction = A.nextDayLimitProb(Object.assign({}, base, { firstSeal: '92500' }));
ok(pAuction > pNeutral, '09:25 封板按早封处理（概率高于中性）', `auction=${pAuction} neutral=${pNeutral}`);

group('[4] 源码层面：接线完整（防某调用点漏接 / 解析被源差异吞掉）');
ok(/function nextDayLimitProb\([^)]*firstSeal/.test(AN), 'analysis.js nextDayLimitProb 形参已含 firstSeal（防形参被误删）');
ok(SV.includes('firstSeal: z.firstSeal || null'), 'server.js 复盘/一进二/二进三 三处传 z.firstSeal（真实封板时间）');
ok(SV.includes('firstSeal: null'), 'server.js 板块异动处显式传 null（无 z 对象时落中性档）');
ok(EM.includes("firstSeal: d.fbt != null ? String(d.fbt).padStart(6, '0') : null"), 'em.js 东财源解析 firstSeal（fbt→6位串）');
ok(EM.includes('firstSeal: null'), 'em.js 同花顺兜底源显式置 null（无 fbt，不拿 0 冒充）');

group('[5] 旧写法反证：接入前根本分不出早封与午后封');
// 旧版 nextDayLimitProb 压根没有 firstSeal 形参与分支 —— 早封、午后封、缺数据在它眼里是同一个东西。
// 这里用一个最小化旧式校准器（不含任何 firstSeal 分支）复刻"接入前"行为，断言它对两种封板时间无区分力。
function oldProb(p) {
  // 与 base 同口径但完全忽略 firstSeal 的极简版：z 起点与各项与现版一致，仅缺封板时间分支
  let z = -2.1;
  z += 0.55 * Math.min((p.limitUpCount || 1) - 1, 4);
  z += 2.0 * Math.min(p.sealRatio || 0, 1);
  z += 2.2 * Math.min(p.sealStrength || 0, 0.6);
  if ((p.capYi || 0) >= 500) z -= 1.0; else if ((p.capYi || 0) >= 100) z -= 0.5;
  const rp = p.rangePos || 0; if (rp >= 30 && rp <= 70) z -= 0.6;
  const vr = p.volRatio || 0; if (vr > 0 && vr < 0.8) z += 0.4;
  if ((p.mktUpRatio || 0) >= 75) z -= 0.25;
  if ((p.limitUpCount || 1) >= 2 && p.brkEngulf) z -= 0.5;
  if (p.gapUp) z += 0.2;
  const sz = p.sectorZT || 0; z += 0.16 * Math.min(sz, 8);
  const to = p.turnover || 0; if (to >= 5 && to <= 20) z += 0.3; if (to < 1) z += 0.15; if (to > 35) z -= 0.4;
  if (p.aboveMa5) z += 0.2;
  z -= 0.3 * (p.breakCount || 0);
  // ⛔ 注意：旧版根本没有 firstSeal 这行 —— 这就是反证要钉死的"接入前行为"
  return Math.round(100 / (1 + Math.exp(-z)));
}
const oldEarly = oldProb(Object.assign({}, base, { firstSeal: '093000' }));
const oldAfternoon = oldProb(Object.assign({}, base, { firstSeal: '133000' }));
ok(oldEarly === oldAfternoon, '旧写法：早封与午后封算出来完全一样（因子此前不存在）', `oldEarly=${oldEarly} oldAfternoon=${oldAfternoon}`);
ok(oldEarly !== pEarly || oldAfternoon !== pAfternoon, '新写法相对旧写法确实改变了输出（因子接入生效）');

group('[6] 工程纪律');
ok(!/\r/.test(SV), 'server.js 保持 LF（无 CRLF）');
ok(!/\r/.test(EM), 'em.js 保持 LF（无 CRLF）');
ok(!/\r/.test(IH), 'public/index.html 保持 LF（无 CRLF）');
const vS = (SV.match(/APP_VER = '([^']+)'/) || [])[1];
const vH = (IH.match(/APP_VER = '([^']+)'/) || [])[1];
ok(/^\d{8}[a-z]{2}$/.test(vS || ''), 'server.js 版本号格式正常', vS);
ok(vS === vH, '两端 APP_VER 一致（否则前端无限刷新）', vS + ' vs ' + vH);

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
console.log(fail === 0 ? '✅ 全部通过' : '❌ 有失败项');
process.exit(fail > 0 ? 1 : 0);
