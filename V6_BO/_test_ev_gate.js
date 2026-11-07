// 守门：#261 EV 准入闸门（ig 轮 · 2026-10-16）
// 钉语义不钉数字：① 接线事实（require/守卫/计数/脚注/承诺区）② evGateOf 行为（充分+显著+阈值→拦；
// 普跌收紧的核心对照：同型信号同一 EV，仅行情不同判决相反）③ govTake 沙箱真跑（typeof 守卫生效、
// 注入 EV 后拦/放行）④ 判不出不当通过（unknown/ns/无 EV 模块都放行）。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const fs = require('fs'), path = require('path');
const assert = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); }
};
let pass = 0, fail = 0;

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const EV = require('./_ev_daily.js');
const cut = (aMark, bMark) => {
  const i = src.indexOf(aMark);
  const j = src.indexOf(bMark, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + aMark);
  return src.slice(i, j);
};

// ============ ① 接线事实（源码级）============
console.log('\n===== ① 接线事实 =====');
assert(src.includes("const EV = require('./_ev_daily.js')"), 'server require _ev_daily.js（单一实现，不抄第二份）');
assert(src.includes("const { envLayerOf: _envLayerOf } = require('./_backtest_nd.js')"), '行情分层走 _backtest_nd 单一实现');
const govSrc = cut('const PUSH_GOV = { day:', '// ---------------- 推送流水');
assert(/typeof evGateOf === 'function'\) \? evGateOf\(type, prob\)/.test(govSrc), 'govTake 内 typeof 守卫调 evGateOf（沙箱不注入时自动跳过，hi 轮同款故障防护）');
assert(/PUSH_GOV\.negEv\+\+/.test(govSrc), 'EV 拦截有独立计数 negEv');
assert(/if \(res\.evGate && res\.evGate\.blocked\) negEv\+\+/.test(govSrc), 'govFilter 按 res.evGate.blocked 显式分类（⛔ 不靠 why 字符串匹配——文案会改，字段不会）');
assert(/const negEv = Math\.min/.test(govSrc) && /throttled: Math\.max\(0, dropped - lowProb - follow - noScore - negEv\)/.test(govSrc), 'pushGovBlocked 五类互不包含（negEv 钳位，不计入 throttled）');
assert(/PUSH_GOV = \{ day: '', codes: new Map\(\), total: 0, dropped: 0, lowProb: 0, noScore: 0, follow: 0, negEv: 0 \}/.test(govSrc), 'PUSH_GOV 声明含 negEv');
assert(/PUSH_GOV\.follow = 0; PUSH_GOV\.negEv = 0;/.test(govSrc), '换日重置含 negEv（不漏计）');
assert(/条因实盘 EV 为负被挡/.test(govSrc), 'govFoot 脚注含 EV 拦截数');
assert(/实盘 EV 底线/.test(src), '承诺区闸门清单含 EV 门（声明层：说到就要做到）');
assert(!/const EV_GATE_FEE\s*=/.test(src) && !/const EV_COLD_FEE\s*=/.test(src), 'server 不定义第二份阈值常量（只用 EV.EV_GATE_FEE / EV.EV_COLD_FEE）');
assert(/thr = \(e === '普跌'\) \? EV\.EV_COLD_FEE : EV\.EV_GATE_FEE/.test(govSrc), '阈值按行情条件化：普跌日收紧');
assert(/if \(typeof EV === 'undefined' \|\| !EV \|\| typeof EV\.evStats !== 'function'\) return null;/.test(govSrc), 'evStatsCached 有 EV typeof 守卫（沙箱里本门自动失效不崩）');
assert(/\(typeof _envLayerOf === 'function'\) \? _envLayerOf\(ur\) : '未知'/.test(govSrc), 'evEnvNow 有 _envLayerOf typeof 守卫');
assert(/isLive: \(typeof isLiveSample === 'function'\) \? isLiveSample : undefined/.test(govSrc), 'evStats 注入 server 自己的 isLiveSample（同一概念禁两份实现）');
assert(/cell\.sig !== 'sig'\) return \{ blocked: false/.test(govSrc), '不显著（ns）禁作结论——放行不拦（ig+1 教训）');

// ============ ② evGateOf 行为（沙箱真跑，真实 EV 模块）============
console.log('\n===== ② evGateOf 行为（真实 EV 模块 + 构造样本）=====');
// 抽 evGateOf / evStatsCached / evEnvNow 三段（从 EV 闸门注释头到 govTake 注释前）
const evGateSrc = cut('// ── #261 EV 准入闸门', '// 判定某只票这一条能不能发出去');
assert(evGateSrc.includes('function evGateOf(') && evGateSrc.includes('function evStatsCached(') && evGateSrc.includes('function evEnvNow('), '三段可被原样切出');

// 构造样本（语义受控，不钉活数据）。12 个日期：前 6 日普跌（upRatio 10）、后 6 日普涨（upRatio 60）：
//   negev  40 条全在普跌日，日内常量、日间波动 → mean≈-1.49 聚类显著（t≈-3.9）→ negev|普跌 环境层充分
//   midneg 40 条跨 6 日（3 普跌 + 3 普涨）→ mean≈-0.74 显著；费后≈-0.94（夹在 -1 与 -0.5 之间）；
//          每个环境层各 20 条 → 均不充分 → 回退 type×bucket 并标 envMismatch
//   postype 40 条全在普涨日 → mean≈+1.0 显著（永不被拦）
//   nostype 42 条跨 6 个普涨日，其中一天 +3 其余 -1.5 → |t|<2 不显著（ns 禁作结论）
//   thintype 5 条单日 → 样本不足（unknown 判不出不当通过）
const DATES_D = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];   // 普跌
const DATES_U = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'];   // 普涨
const mkSig = (type, date, nextPct) => ({ type, date, prob: 56, nd: { nextPct, maxGain: nextPct, limitUp: false } });
const sigs = [];
const negevDay = [-2.5, -2.0, -1.5, -1.0, -0.5, -1.0], negevN = [8, 7, 7, 6, 6, 6];
negevDay.forEach((v, d) => { for (let i = 0; i < negevN[d]; i++) sigs.push(mkSig('negev', DATES_D[d], v)); });
const midDay = [-1.4, -1.0, -0.7, -0.4, -0.1, -0.6], midN = [8, 7, 7, 6, 6, 6];
midDay.forEach((v, d) => { for (let i = 0; i < midN[d]; i++) sigs.push(mkSig('midneg', d < 3 ? DATES_D[d] : DATES_U[d - 3], v)); });
const posDay = [0.5, 1.0, 1.5, 0.8, 1.2, 0.6], posN = [8, 7, 7, 6, 6, 6];
posDay.forEach((v, d) => { for (let i = 0; i < posN[d]; i++) sigs.push(mkSig('postype', DATES_U[d], v)); });
// nostype：5 个普涨日 -1.5（7 条/天）+ 1 个普涨日 +3（7 条）→ n=42, days=6, mean=-0.75, |t|<2
for (let d = 0; d < 5; d++) for (let i = 0; i < 7; i++) sigs.push(mkSig('nostype', DATES_U[d], -1.5));
for (let i = 0; i < 7; i++) sigs.push(mkSig('nostype', DATES_U[5], 3));
// thintype：5 条全在同一个普跌日
for (let i = 0; i < 5; i++) sigs.push(mkSig('thintype', DATES_D[0], -2));

const breadth = {};
DATES_D.forEach(d => { breadth[d] = { upRatio: 10 }; });
DATES_U.forEach(d => { breadth[d] = { upRatio: 60 }; });
const S = { learn: { signals: sigs }, breadth, klines: new Map() };

const mkEvGate = (Sx, breadthNow) => new Function('S', 'EV', 'console', 'todayBreadth', '_envLayerOf', 'isLiveSample',
  `${evGateSrc}\nreturn { evGateOf, evStatsCached, evEnvNow };`)(
    Sx, EV, { log() { }, error() { } },
    // ⛔ 桩语义对齐真实 todayBreadth：取不到宽度时返回 null（不是 {upRatio:null}——
    //    +null=0 是有限数，会被 envLayerOf 判成普跌，正是「判不出当判了」的形态）
    () => (breadthNow == null ? null : { upRatio: breadthNow }),
    ur => (ur == null || Number.isNaN(ur)) ? '未知' : (ur < 40 ? '普跌' : (ur > 52 ? '普涨' : '退潮')),
    s => !s.hist && s.type !== 'zt',   // 注入的分类器（证明 isLive 注入通路）
  );

const G = mkEvGate(S, 60);   // todayBreadth 桩：普涨（evEnvNow 默认路径）

// 先验证样本本身的性质（钉构造意图，不是钉代码输出）
const stCheck = EV.evStats({ signals: sigs, breadth, isLive: s => !s.hist && s.type !== 'zt' });
assert(stCheck.byType.negev && stCheck.byType.negev.sig === 'sig' && stCheck.byType.negev.evCloseFee <= -1, '构造自检：negev 显著且费后 ≤ -1%');
assert(stCheck.byType.midneg && stCheck.byType.midneg.sig === 'sig' && stCheck.byType.midneg.evCloseFee > -1 && stCheck.byType.midneg.evCloseFee <= -0.5, '构造自检：midneg 显著且费后夹在 (-1, -0.5]');
assert(stCheck.byType.postype.sig === 'sig' && stCheck.byType.postype.evCloseFee > -1, '构造自检：postype 显著且费后 > -1%');
assert(stCheck.byType.nostype.sig === 'ns', '构造自检：nostype 不显著（|t|<2）');
assert(stCheck.byType.thintype.unknown === true, '构造自检：thintype 样本不足→unknown');
assert(stCheck.envCells['negev|普跌'] && stCheck.envCells['negev|普跌'].n === 40 && !stCheck.envCells['negev|普跌'].unknown, '构造自检：negev|普跌 环境层充分（40 条）');

// ① 显著负 EV → 拦（type×env 层，无 mismatch）
const g1 = G.evGateOf('negev', 56, '普跌');
assert(g1.blocked === true && /EV 为负/.test(g1.why), 'negev 显著负 EV → 拦（普跌日阈值 -0.5%）');
assert(/普跌日·阈值收紧到 -0.5%/.test(g1.why), '普跌日拦因说明阈值收紧（用户看得懂为什么今天更严）');
assert(g1.cell.layer === 'type×env' && g1.cell.envMismatch === false, '环境层充分 → 证据取自 type×env 且无 mismatch');
assert(g1.env === '普跌' && g1.cell.env === '普跌', '回传环境层供诊断');
// ② 同类型查普涨日：无该环境层 → 诚实回退 type×bucket 并标 mismatch，费后 -1.69 仍 ≤ -1% → 拦
const g2 = G.evGateOf('negev', 56, '普涨');
assert(g2.blocked === true && g2.cell.envMismatch === true && g2.cell.layer === 'type×bucket', 'negev 查普涨日：无环境层→回退 type×bucket 标 envMismatch，仍按 -1% 拦');
// ③④ ⭐ 核心对照：midneg 费后≈-0.94 —— 普涨日不拦、普跌日拦（仅行情不同，判决相反）
const g3 = G.evGateOf('midneg', 56, '普涨');
assert(g3.blocked === false, '⭐对照：midneg 普涨日不拦（费后 -0.94 > 阈值 -1%）');
const g4 = G.evGateOf('midneg', 56, '普跌');
assert(g4.blocked === true, '⭐对照：midneg 普跌日拦（费后 -0.94 ≤ 收紧阈值 -0.5%）——同一 EV 仅行情不同判决相反');
assert(g4.cell.envMismatch === true && /诚实回退/.test(g4.why), 'midneg 环境层样本不足 → 回退 type×bucket 并如实标注 envMismatch');
// ⑤ 显著正 EV → 永不拦
assert(G.evGateOf('postype', 56, '普跌').blocked === false, 'postype 显著正 EV → 普跌日也不拦（不是所有普跌都拦）');
// ⑥⑦ 判不出不当通过：unknown / ns 都放行
assert(G.evGateOf('thintype', 56, '普跌').blocked === false, 'thintype 样本不足（unknown）→ 放行（判不出不当通过）');
assert(G.evGateOf('nostype', 56, '普跌').blocked === false, 'nostype 不显著（ns）→ 放行（点估计禁作结论）');
assert(G.evGateOf('nobody', 56, '普跌').blocked === false, '陌生类型 → 放行');
// ⑧ prob 缺失时 type×env 层仍可判决（EV 判据不依赖 prob）
assert(G.evGateOf('negev', null, '普跌').blocked === true, 'prob 缺失不妨碍 type×env 层判决');
// ⑨ evEnvNow 接线：todayBreadth 桩（不传 env）自动取当前行情层并选阈值
const Gcold = mkEvGate(S, 10);   // 桩：普跌
assert(Gcold.evGateOf('midneg', 56).blocked === true, 'evEnvNow 取到普跌 → midneg 按收紧阈值拦');
const Ghot = mkEvGate(S, 60);   // 桩：普涨
assert(Ghot.evGateOf('midneg', 56).blocked === false, 'evEnvNow 取到普涨 → midneg 按一般阈值放行');
const Gnull = mkEvGate(S, null);   // 桩：取不到宽度 → 未知层 → 一般阈值
assert(Gnull.evGateOf('midneg', 56).blocked === false && Gnull.evEnvNow() === '未知', '取不到宽度 → 环境「未知」不伪造，按一般阈值');
// ⑩ 无 EV 模块时 evStatsCached 返回 null（守门沙箱场景：本门失效但不崩）
const GnoEV = new Function('S', 'console', 'todayBreadth', '_envLayerOf', 'isLiveSample',
  `${evGateSrc}\nreturn { evGateOf, evStatsCached };`)(S, { log() { }, error() { } }, () => ({ upRatio: 10 }), ur => '普跌', s => true);
assert(GnoEV.evStatsCached() === null && GnoEV.evGateOf('negev', 56, '普跌').blocked === false, '沙箱无 EV 模块 → evStatsCached=null、闸门放行不崩（typeof 守卫生效）');

// ============ ③ govTake 沙箱真跑（守门自己也会被守门）============
console.log('\n===== ③ govTake 沙箱（typeof 守卫 + 注入后拦/放行）=====');
const cfgRangeSrc = cut('const CFG_RANGE = {', '// 返回人类可读的错误列表');
const govCfgSrc = cut('const _govCfg = k => {', '// 「概率推送线」唯一读取口');
const MISS_SRC = (() => {
  const i = src.indexOf('const MISS_RULE = {');
  return src.slice(i, src.indexOf('let _rollbackMsg = null;', i));
})();
const todayStrSrc = (() => {
  const i = src.indexOf('const todayStr = ');
  return src.slice(i, src.indexOf('};', i) + 2);
})();
const mkGovTake = (extra) => {
  const fn = new Function('S', 'console', 'fusedProb', 'krowsOf', 'path', 'fs', 'atomicWrite', 'isReplica', '__dirname',
    'EV', 'todayBreadth', '_envLayerOf', 'isLiveSample',
    `${todayStrSrc}\n${cfgRangeSrc}\n${govCfgSrc}\n${MISS_SRC}\n${govSrc}\nreturn { govTake, PUSH_GOV };`);
  const base = {
    S: { config: { pushMaxPerDay: 0, pushMinProb: 55, pushMaxPerCode: 5, pushCooldownMin: 0 }, klines: new Map(), fastinRepeat: new Map(), learn: { signals: [] }, breadth: {} },
    console: { log() { }, error() { } },
    fusedProb: (code, name, rows, type, p) => ({ prob: p, model: p, emp: null, la: null, delta: 0, src: '替身', why: '' }),
    krowsOf: () => null,
    path: { join: (a, b) => a + '/' + b },
    fs: { readFileSync: () => { throw new Error('沙箱无存档'); } },
    atomicWrite: () => { }, isReplica: () => false, __dirname,
    EV: undefined, todayBreadth: () => null, _envLayerOf: ur => '未知', isLiveSample: s => true,
  };
  // ⛔ extra.S 必须真的传下去：沙箱的 S 是 new Function 形参，base.S 与 extra.S 混用会静默用错一份
  return fn(extra.S || base.S, base.console, extra.fusedProb || base.fusedProb, base.krowsOf, base.path, base.fs, base.atomicWrite, base.isReplica, base.__dirname,
    extra.EV, extra.todayBreadth, extra._envLayerOf, extra.isLiveSample);
};
// A) 不注入 EV（模拟 _test_gov 沙箱）：typeof 守卫生效 → 不崩、按原逻辑放行
const GA = mkGovTake({});
assert(GA.govTake('600001', 'pool', false, 80).ok === true, '沙箱无 EV 模块 → EV 门自动跳过，其余闸门照常（不崩）');
// B) 注入 EV + 负 EV 样本库：negev 被拦、postype 放行、negEv 计数
const GB = mkGovTake({
  EV,
  S: { config: { pushMaxPerDay: 0, pushMinProb: 55, pushMaxPerCode: 5, pushCooldownMin: 0 }, klines: new Map(), fastinRepeat: new Map(), learn: { signals: sigs }, breadth },
  todayBreadth: () => ({ upRatio: 10 }),   // 普跌
  _envLayerOf: ur => (ur == null ? '未知' : (ur < 40 ? '普跌' : (ur > 52 ? '普涨' : '退潮'))),
  isLiveSample: s => !s.hist && s.type !== 'zt',
});
const rNeg = GB.govTake('666666', 'negev', false, 60);
assert(rNeg.ok === false && /EV 为负/.test(rNeg.why) && rNeg.evGate && rNeg.evGate.blocked === true, '注入后：negev 过胜率门但被 EV 门拦下（原因可读、带 evGate 句柄）');
assert(GB.PUSH_GOV.negEv === 1, 'negEv 计数 +1（独立于 lowProb/throttled）');
const rPos = GB.govTake('666667', 'postype', false, 60);
assert(rPos.ok === true, '注入后：postype 显著正 EV → 放行（EV 门不误杀好信号）');
const rThin = GB.govTake('666668', 'thintype', false, 60);
assert(rThin.ok === true, '注入后：thintype 样本不足 → 放行（判不出不当通过）');
assert(GB.PUSH_GOV.negEv === 1, 'negEv 不重复计（放行的两条不计）');

// ============ ④ 阈值常量与 _ev_daily 一致性（禁两处各判各的）============
console.log('\n===== ④ 阈值一致性 =====');
assert(EV.EV_GATE_FEE === -1 && EV.EV_COLD_FEE === -0.5 && EV.EV_COLD_FEE > EV.EV_GATE_FEE, '阈值：一般 -1% / 普跌收紧 -0.5%（更严）');
assert(/EV\.EV_COLD_FEE : EV\.EV_GATE_FEE/.test(govSrc), 'server 只消费 EV 模块的阈值常量');

console.log(`_test_ev_gate: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
