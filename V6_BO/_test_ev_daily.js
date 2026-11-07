// 守门：_ev_daily.js（每日 EV · 纯净 live 口径）
// 钉语义不钉数字（§11 铁律）：口径过滤（backtest/postHoc/void/noNd 单列不并）、桶边界、+3% 近似、
// 充分性双条件、evCell 层级回退「判不出不当通过」、行情条件化（type×env 优先+envMismatch 诚实标注）、
// 真实数据恒等（不钉活数据具体数）。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const assert = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); }
};
let pass = 0, fail = 0;

const fs = require('fs');
const path = require('path');
const M = require('./_ev_daily.js');
const { evStats, evOf, evCell, bucketOf, withSufficiency, FEE_RT, MIN_N, MIN_DAYS, BUCKETS, EV_GATE_FEE, EV_COLD_FEE, isLiveSample, isBacktestSample, isPostHocSample } = M;

// ⛔ 判据与展示必须同精度（2026-10-17 eb 轮实测的真 bug）：
//    原来 sig 用**未取整**的 tClu 判、对外发布 toFixed(2) → 边界自相矛盾：
//    原始 t=-1.996 判 ns，而面板/报告写「t=-2.00」，谁读都是显著。
//    真数据命中过（envCells pool|普涨 n=82 days=2 原始 t≈-1.996）。
//    钉法：先定格成要发布的精度，再由它推 sig；且 return 里不许二次取整（单一精度来源）。
{
  const src = fs.readFileSync(path.join(__dirname, '_ev_daily.js'), 'utf8');
  const iRound = src.indexOf('tClu = tClu == null ? null : +tClu.toFixed(2);');
  const iSig = src.indexOf('sig = (tClu != null && Math.abs(tClu) >= 2)');
  assert(iRound > 0 && iSig > iRound, 'sig 由已定格的 tClu 推出（先取整、后判定，别让数字和标签打架）');
  assert(!/tClu: tClu == null \? null : \+tClu\.toFixed\(2\)/.test(src), 'tClu 不在 return 里二次取整（单一精度来源）');
}

// 0) 事后样本三分类（ig+2 轮：与 server.js L1449-1457 isLiveSample 同语义，同一概念禁两份实现）assert(isBacktestSample({ resolved: { mode: '历史回测' } }) === true, 'isBacktestSample：历史回测→true');
assert(isBacktestSample({ hist: true, resolved: {} }) === false, 'isBacktestSample：仅 hist 标记不算回测（由 evStats 的 s.hist 分支接管）');
assert(isPostHocSample({ type: 'zt', resolved: { limitUp: true, maxGain: 0.2 } }) === true, 'isPostHocSample：zt 复盘登记→true');
assert(isPostHocSample({ type: 'review' }) === true, 'isPostHocSample：review→true');
assert(isPostHocSample({ type: 't1', resolved: { limitUp: true, maxGain: 0.5 } }) === true, 'isPostHocSample：涨停板登记价 maxGain=0.5(边界)→true');
assert(isPostHocSample({ type: 't1', resolved: { limitUp: true, maxGain: 0.6 } }) === false, 'isPostHocSample：涨停但 maxGain>0.5（买得到）→false');
assert(isPostHocSample({ type: 't1', resolved: { limitUp: false, maxGain: 0.1 } }) === false, 'isPostHocSample：非涨停→false');
assert(isLiveSample({ type: 't1', date: 'x', nd: { nextPct: 1 } }) === true, 'isLiveSample：普通 live→true');
assert(isLiveSample({ type: 'zt' }) === false, 'isLiveSample：zt→false');
assert(isLiveSample({ resolved: { mode: '历史回测' } }) === false, 'isLiveSample：回测→false');

// 1) bucketOf 边界语义（含 prob 缺失单列，禁静默归并）
assert(bucketOf(49) === '<50', 'bucketOf 49→<50');
assert(bucketOf(50) === '50-54', 'bucketOf 50→50-54(边界)');
assert(bucketOf(54) === '50-54', 'bucketOf 54→50-54(边界)');
assert(bucketOf(55) === '55-59', 'bucketOf 55→55-59(边界)');
assert(bucketOf(59) === '55-59', 'bucketOf 59→55-59(边界)');
assert(bucketOf(60) === '60-69', 'bucketOf 60→60-69(边界)');
assert(bucketOf(69) === '60-69', 'bucketOf 69→60-69(边界)');
assert(bucketOf(70) === '70+', 'bucketOf 70→70+(边界)');
assert(bucketOf(95) === '70+', 'bucketOf 95→70+');
assert(bucketOf(null) === 'noprob', 'bucketOf null→noprob(单列不猜)');
assert(bucketOf(undefined) === 'noprob', 'bucketOf undefined→noprob');
assert(bucketOf('60') === 'noprob', 'bucketOf 字符串"60"→noprob(禁隐式转换)');
assert(bucketOf(NaN) === 'noprob', 'bucketOf NaN→noprob');
assert(BUCKETS[BUCKETS.length - 1] === 'noprob', 'noprob 是最后一个桶');

// 2) evOf 统计口径（nextPct 均值 / +3% 近似：maxGain≥3 按 3 否则按收盘 / 涨停率 / 触发率）
const arr = [
  { nd: { nextPct: 5, maxGain: 6, limitUp: true } },    // 止盈触发 → +3
  { nd: { nextPct: 10, maxGain: 10, limitUp: true } },  // 涨停，maxGain≥3 → +3（不按 10，规则就是 3 走）
  { nd: { nextPct: -5, maxGain: -2, limitUp: false } }, // 未触发 → 收盘 -5
];
const st = evOf(arr);
assert(st.n === 3, 'evOf n=3');
assert(st.evClose === 3.333, 'evOf evClose=10/3（保留 3 位）');
assert(st.evP3 === 0.333, 'evOf evP3=+3%止盈近似 1/3（保留 3 位）');
assert(st.p3HitRate === 66.7, 'evOf 止盈触发率 2/3');
assert(st.limitUpRate === 66.7, 'evOf 涨停率 2/3');
const empty = evOf([]);
assert(empty.n === 0 && empty.unknown === true, 'evOf 空数组→unknown(不硬判)');

// 2b) 显著性（ig+1 轮补：同日信号相关 → t 按信号日聚类；⛔ ns 禁作结论）
// 构造可手算案例：d1 一条 +6、d2 两条 0 → mean=2；偏差 4/−2/−2 → 方差 24/2=12 → sd=√12 → 朴素 se=√12/√3=2；
// 聚类：T1=6,T2=0,G=2,Tbar=3 → varSum=2*(9+9)=36 → seClu=6/3=2 → tClu=1 → ns
const sigArr = [
  { date: 'd1', nd: { nextPct: 6, maxGain: 6, limitUp: false } },
  { date: 'd2', nd: { nextPct: 0, maxGain: 0, limitUp: false } },
  { date: 'd2', nd: { nextPct: 0, maxGain: 0, limitUp: false } },
];
const sg = evOf(sigArr);
assert(sg.days === 2, 'evOf days=2（按 date 聚类数）');
assert(sg.se === 2, 'evOf 朴素 se=2（√12/√3）');
assert(sg.seClu === 2, 'evOf 聚类 seClu=2（手算值）');
assert(sg.tClu === 1, 'evOf 聚类 tClu=1');
assert(sg.sig === 'ns', 'evOf |t|<2 → sig=ns');
// 零方差+两天条数不均（d1 一条、d2 两条，全是 +4）：聚类估计器按「日总量」波动出 t——
//   T1=4,T2=8,Tbar=6 → varSum=2*(4+4)=16 → seClu=4/3 → tClu=3。这是标准聚类估计器的真实行为
//   （日内零方差时总量差全部来自条数不均衡），非 bug；连续真实收益数据永不触发此形态，此处仅钉住行为防回归。
const flat = evOf([
  { date: 'd1', nd: { nextPct: 4, maxGain: 4, limitUp: false } },
  { date: 'd2', nd: { nextPct: 4, maxGain: 4, limitUp: false } },
  { date: 'd2', nd: { nextPct: 4, maxGain: 4, limitUp: false } },
]);
assert(flat.seClu === 1.333 && flat.tClu === 3 && flat.sig === 'sig', 'evOf 零方差不均日：聚类估计器按总量波动出 t=3（标准行为，钉防回归）');
// 零方差+两天条数相等 → 总量无波动 → seClu=0 → tClu=null（⛔ 除零禁出 NaN）
const flatBal = evOf([
  { date: 'd1', nd: { nextPct: 4, maxGain: 4, limitUp: false } },
  { date: 'd1', nd: { nextPct: 4, maxGain: 4, limitUp: false } },
  { date: 'd2', nd: { nextPct: 4, maxGain: 4, limitUp: false } },
  { date: 'd2', nd: { nextPct: 4, maxGain: 4, limitUp: false } },
]);
assert(flatBal.tClu === null && flatBal.sig === 'ns' && flatBal.seClu === 0, 'evOf 零方差均日→tClu=null（⛔ 禁 NaN）');
// 单日样本 → 聚类不可用 → ns（ig 轮翻车形态：单/双日样本禁出结论）
const oneDay = evOf([
  { date: 'd1', nd: { nextPct: 9, maxGain: 9, limitUp: true } },
  { date: 'd1', nd: { nextPct: 9, maxGain: 9, limitUp: true } },
]);
assert(oneDay.days === 1 && oneDay.tClu === null && oneDay.sig === 'ns', 'evOf 单日→tClu=null sig=ns（禁出结论）');

// 3) withSufficiency 双条件（n 与跨天，缺一即 unknown——判不出不当通过）
const d5 = ['d1', 'd2', 'd3', 'd4', 'd5'];
assert(withSufficiency({ n: 30, evClose: 1 }, d5).unknown === undefined, 'n=30 跨5天→充分');
assert(withSufficiency({ n: 29, evClose: 1 }, d5).unknown === true && withSufficiency({ n: 29 }, d5).reason === 'n<' + MIN_N, 'n=29→unknown(n<30)');
assert(withSufficiency({ n: 30, evClose: 1 }, ['d1', 'd2', 'd3', 'd4']).reason === 'days<' + MIN_DAYS, '只跨4天→unknown(days<5)');
assert(withSufficiency(null, d5).unknown === true, '无样本→unknown');

// 4) evStats 口径铁律：hist/void/noNd 单列计数，绝不进 live 任何口径
const sigs = [
  // 6 条同类型同桶的 live（n=6，触发 unknown 但不丢）
  { type: 't1', date: '2026-10-10', prob: 56, nd: { nextPct: 1, maxGain: 2, limitUp: false } },
  { type: 't1', date: '2026-10-10', prob: 56, nd: { nextPct: 2, maxGain: 4, limitUp: false } },
  { type: 't1', date: '2026-10-11', prob: 56, nd: { nextPct: 3, maxGain: 1, limitUp: false } },
  { type: 't1', date: '2026-10-11', prob: 56, nd: { nextPct: -1, maxGain: 0, limitUp: false } },
  { type: 't1', date: '2026-10-12', prob: 56, nd: { nextPct: 0, maxGain: 3, limitUp: false } },
  { type: 't1', date: '2026-10-12', prob: 56, nd: { nextPct: -2, maxGain: -1, limitUp: false } },
  // hist 事后回填（+10% 的诱惑）：必须被踢出且计数
  { type: 'histzt', date: '2026-08-19', prob: 50, hist: true, resolved: { nextPct: 10, maxGain: 10, limitUp: true }, nd: { nextPct: 10, maxGain: 10, limitUp: true } },
  // void：必须被踢出且计数
  { type: 't1', date: '2026-10-12', prob: 56, void: true, nd: { nextPct: 99, maxGain: 99, limitUp: true } },
  // 无 nd.nextPct：必须被踢出且计数
  { type: 't1', date: '2026-10-12', prob: 56, nd: {} },
  // prob 缺失：进 noprob 桶，不进 55-59
  { type: 't2', date: '2026-10-10', prob: null, nd: { nextPct: 4, maxGain: 5, limitUp: false } },
  // ig+2 事后样本①：zt 复盘登记（+9.9% 的诱惑）——必须被踢出且计数（ig+2 前它被算成「唯一正 EV 类」）
  { type: 'zt', date: '2026-10-09', prob: 58, resolved: { limitUp: true, maxGain: 0.2, nextPct: 9.9 }, nd: { nextPct: 9.9, maxGain: 0.2, limitUp: true } },
  // ig+2 事后样本②：非 zt 类型但登记价在涨停板上（maxGain≤0.5，物理上买不到）
  { type: 't3', date: '2026-10-09', prob: 57, resolved: { limitUp: true, maxGain: 0.3 }, nd: { nextPct: 9.7, maxGain: 0.3, limitUp: true } },
];
const r = evStats({ signals: sigs, breadth: {}, fee: 0.5, minN: 3, minDays: 2 });
assert(r.universe.n === 7, 'evStats live n=7（hist/void/noNd/postHoc 各剔，事后样本不进分母）');
assert(r.skipped.backtest === 1 && r.skipped.void === 1 && r.skipped.noNd === 1 && r.skipped.postHoc === 2, '跳过登记：backtest/void/noNd 各 1、postHoc=2（dv 轮精神）');
assert(r.hist.n === 1 && r.hist.evClose === 10, 'hist 单列展示（n=1, EV=+10），不进 universe');
assert(r.universe.n + r.skipped.void + r.skipped.noNd + r.skipped.backtest + r.skipped.postHoc === sigs.length, '恒等：live+四类跳过=总数（不丢样本）');
assert(r.byType['zt'] === undefined && r.byType['t3'] === undefined, 'ig+2 修正：zt/t3 不进 byType（涨停板幻想价禁入任何 live 口径）');
assert(r.byBucket['55-59'].n === 6, 'prob=56 的 6 条进 55-59 桶');
assert(r.byBucket.noprob.n === 1, 'prob=null 进 noprob 桶（不并进相邻桶）');
assert(r.byBucket['<50'].n === 0, 'prob 缺失不进 <50');
assert(r.cells['t1|55-59'].n === 6 && r.cells['t2|noprob'].n === 1, 'type×bucket 最具体层正确切分');
assert(r.fee === 0.5 && Math.abs(r.universe.evCloseFee - (r.universe.evClose - 0.5)) < 1e-9, 'fee 参数生效：费后=EV-fee');

// 4b) isLive 注入（⛔ 同一概念禁两份实现：server 传入它的分类器，语义一字不差）
const rInj = evStats({ signals: sigs, breadth: {}, minN: 3, minDays: 2, isLive: s => s.type === 't1' || s.type === 't2' });
assert(rInj.universe.n === 7 && rInj.skipped.postHoc === 2, '注入 isLive：与默认分类器同结果（zt/t3 仍被剔）');
const rInj2 = evStats({ signals: sigs, breadth: {}, minN: 3, minDays: 2, isLive: s => s.type === 't1' });
assert(rInj2.universe.n === 6 && rInj2.skipped.postHoc === 3, '注入更严 isLive：t2 也被剔（noprob 桶空）');

// 5) evCell 层级回退 + 判不出不当通过
// 5a. type×bucket 充分 → 用最具体层
const r2 = evStats({ signals: sigs, breadth: {}, minN: 3, minDays: 2 });
const c1 = evCell(r2, 't1', 56);
assert(c1.layer === 'type×bucket' && c1.n === 6, 'evCell 最具体层优先');
assert(!c1.unknown, 'evCell 充分 cell 不带 unknown');
// 5b. type×bucket 不充分但 type 充分 → 回退 type 层
const c2 = evCell(r2, 't1', 62);   // 62 在 60-69 桶，该 cell 无样本
assert(c2.layer === 'type' && c2.n === 6, 'evCell type×bucket 空→回退 type 层');
// 5c. type 也不充分（n=1）→ 回退 bucket 层；bucket 也不充分 → unknown（⛔ 判不出不当通过）
const r3 = evStats({ signals: sigs, breadth: {}, minN: 3, minDays: 2 });
const c3 = evCell(r3, 't2', 56);   // t2 只有 1 条且无 prob；55-59 桶有 6 条充分 → bucket 层
assert(c3.layer === 'bucket' && c3.n === 6, 'evCell type 不充分→回退 bucket 层');
const c4 = evCell(r3, 'nobody', 30); // 类型不存在、<50 桶 0 条 → unknown
assert(c4.unknown === true && c4.reason === 'evidence-insufficient', 'evCell 全不够→unknown(判不出不当通过)');
const c5 = evCell(null, 't1', 56);
assert(c5.unknown === true && c5.reason === 'no-stats', 'evCell 无 stats→unknown');
// 5d. ⛔ 充分性不足的 cell 绝不被 evCell 当充分用（把 minN 抬到 100，全部 cell unknown）
const r4 = evStats({ signals: sigs, breadth: {}, minN: 100, minDays: 2 });
assert(evCell(r4, 't1', 56).unknown === true, 'cell 全 unknown 时 evCell 不许硬判通过');

// 5e. 行情条件化（ig+2 轮，用户点醒「根据市场情绪改条件」）：type×env 层优先，不足诚实回退
// 构造：cold 类型 6 条全在普跌日（10-10/11/12 各 2 条，upRatio<40），EV=−2；hot 2 条在普涨日（upRatio>52）
const condSigs = [];
for (let i = 0; i < 6; i++) condSigs.push({ type: 'cold', date: ['2026-10-10', '2026-10-11', '2026-10-12'][i % 3], prob: 56, nd: { nextPct: -2, maxGain: 1, limitUp: false } });
condSigs.push({ type: 'hot', date: '2026-10-13', prob: 56, nd: { nextPct: 1, maxGain: 2, limitUp: false } });
condSigs.push({ type: 'hot', date: '2026-10-14', prob: 56, nd: { nextPct: 2, maxGain: 3, limitUp: false } });
const condBreadth = { '2026-10-10': { upRatio: 10 }, '2026-10-11': { upRatio: 15 }, '2026-10-12': { upRatio: 12 }, '2026-10-13': { upRatio: 60 }, '2026-10-14': { upRatio: 65 } };
const rC = evStats({ signals: condSigs, breadth: condBreadth, minN: 3, minDays: 2 });
assert(rC.envCells['cold|普跌'].n === 6 && rC.envCells['hot|普涨'].n === 2, 'envCells：type×环境 切分正确（cold|普跌=6, hot|普涨=2）');
assert(rC.envCells['cold|普涨'] === undefined, 'envCells：无样本的组合不建 key（不造假层）');
const cEnv = evCell(rC, 'cold', 56, '普跌');
assert(cEnv.layer === 'type×env' && cEnv.n === 6 && !cEnv.unknown && !cEnv.envMismatch, 'evCell：普跌层充分→type×env 优先（条件化证据）');
const cEnvMis = evCell(rC, 'cold', 56, '普涨');
assert(cEnvMis.envMismatch === true && cEnvMis.layer === 'type×bucket', 'evCell：环境层无证据→回退 type×bucket 并标 envMismatch（诚实标注依据强度）');
const cEnvNone = evCell(rC, 'hot', 56, '普跌');
assert(cEnvNone.layer === 'bucket' && cEnvNone.envMismatch === true, 'evCell：环境层/type×bucket/type 均无充分→回退 bucket 层仍标 envMismatch');

// 6) 与 _backtest_nd 的 envLayerOf 单一实现（evStats 环境分层不许抄第二份）
//    信号日分布：10-10 三条（t1×2+t2）、10-11 两条、10-12 两条；breadth 只覆盖 10-10/10-11
const breadth = { '2026-10-10': { upRatio: 30 }, '2026-10-11': { upRatio: 60 } };
const r5 = evStats({ signals: sigs, breadth, minN: 1, minDays: 1 });
assert(r5.byEnv['普跌'].n === 3, '环境分层：upRatio30→普跌(3条)');
assert(r5.byEnv['普涨'].n === 2, '环境分层：upRatio60→普涨(2条)');
assert(r5.byEnv['未知'].n === 2, '10-12 缺 breadth→未知层(2条)，不伪造环境');

// 7) 跨源真实数据恒等（§11：钉语义不钉活数据具体数）
try {
  const stt = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));
  let br = {};
  try { br = JSON.parse(fs.readFileSync(path.join(__dirname, 'breadth.json'), 'utf8')); } catch (e) {}
  const rr = evStats({ signals: stt.signals || [], breadth: br });
  assert(rr.universe.n + rr.skipped.void + rr.skipped.noNd + rr.skipped.backtest + rr.skipped.postHoc === (stt.signals || []).length, '真实数据恒等：live+跳过=总数');
  let sumB = 0;
  for (const b of BUCKETS) sumB += rr.byBucket[b].n;
  assert(sumB === rr.universe.n, '真实数据恒等：分桶样本和=universe（桶划分不丢样本）');
  let sumT = 0;
  for (const t of Object.keys(rr.byType)) sumT += rr.byType[t].n;
  assert(sumT === rr.universe.n, '真实数据恒等：分类型样本和=universe');
  assert(rr.hist.n > 0 && rr.hist.note && rr.hist.note.indexOf('禁止并入') >= 0, '真实数据 hist 单列且带禁并入声明');
  assert(rr.universe.n > 0, '真实数据 universe 非空');
  assert(rr.byBucket.noprob.n > 0, '真实数据存在 prob 缺失信号（noprob 桶非空，单列生效）');
  // ⛔ 显著性自洽性（钉语义不钉活数据）：sig='sig' ⇔ |tClu|≥2；tClu=null ⇔ ns（含单/双日）
  const allCells = [rr.universe].concat(Object.values(rr.byBucket), Object.values(rr.byType), Object.values(rr.byEnv), Object.values(rr.envCells));
  let sigOk = true, nullOk = true;
  for (const c of allCells) {
    if (!c || !c.n) continue;
    if (c.sig === 'sig' && !(typeof c.tClu === 'number' && Math.abs(c.tClu) >= 2)) sigOk = false;
    if (c.sig === 'ns' && typeof c.tClu === 'number' && Math.abs(c.tClu) >= 2) sigOk = false;
    if (c.tClu === null && c.sig !== 'ns') nullOk = false;
    if (typeof c.tClu === 'number' && !Number.isFinite(c.tClu)) nullOk = false;   // ⛔ 禁 NaN 漏出
  }
  assert(sigOk, '真实数据自洽：sig ⇔ |tClu|≥2（无伪显著/漏标）');
  assert(nullOk, '真实数据自洽：tClu=null ⇔ ns，且无 NaN');
  // ig 轮翻车形态的守门：zt 类点估计为正——若它仍是 ns，说明「唯一正 EV 类」确实是噪声（修复生效）；
  // 若哪天累积成 sig，那是数据自己给出的结论，本断言自动失效也没关系（语义钉，不钉方向）
  const ztc = rr.byType['zt'];
  assert(!ztc || ztc.sig === 'sig' || ztc.tClu == null || Math.abs(ztc.tClu) < 2, 'zt 类：sig 与 tClu 自洽（点估计为正≠显著为正）');
  // ⛔ hist 绝不在任何 live 口径里：hist 的 resolved.nextPct 若并进来会显著抬高 EV——
  // 无法直接证否单条，用「hist 全为涨停次日高收益」的结构性声明替代：hist 单列且 universe 不含其 n
  assert(rr.universe.n !== (stt.signals || []).length, '真实数据：universe 严格小于全量（过滤生效）');
  // envCells 真实数据恒等：type×环境 的样本和 = live（按 type×env 切分不丢样本）
  let sumTE = 0;
  for (const k of Object.keys(rr.envCells)) sumTE += rr.envCells[k].n;
  assert(sumTE === rr.universe.n, '真实数据恒等：type×环境 样本和=universe');
} catch (e) {
  assert(false, '真实数据回归崩了：' + e.message);
}

// 8) 常量钉死（改值须同步守门与文件头注释）
assert(FEE_RT === 0.2 && MIN_N === 30 && MIN_DAYS === 5, '常量 FEE_RT=0.2 / MIN_N=30 / MIN_DAYS=5');
// 8b) 闸门阈值（ig+2 行情条件化）：普跌日收紧——EV_COLD_FEE(−0.5%) 比 EV_GATE_FEE(−1%) 更接近 0，
//     即「费后 EV 跌破 −0.5% 就拦」比「跌破 −1% 才拦」更严（同 ENV_COLD_UPLIFT 偏冷加门哲学）
assert(EV_GATE_FEE === -1 && EV_COLD_FEE === -0.5 && EV_COLD_FEE > EV_GATE_FEE, '闸门阈值：一般日 −1%，普跌日收紧到 −0.5%（更严）');

console.log(`_test_ev_daily: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
