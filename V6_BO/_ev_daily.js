// 每日 EV 指标 · 「按信号买到底赚不赚」的分桶 × 分类型实测（2026-10-16 ig 轮）
//
// 为什么有这一个模块（if 轮 EV 首测的翻车教训，全项目最贵的一次口径污染）：
//   if 轮用 stats.json 首次实测 EV，得出「55-59 桶 +1.42%，全场唯一强正；闸门 55 恰好卡在 EV 最优带下沿」。
//   ig 轮复核发现：1938 条样本里混了 600 条 histzt 历史回填（hist:true, resolved.mode:'历史回测'）——
//   那些是「先知道涨停才倒推登记」的事后样本（项目既有铁律：hj 轮 K 线买点排除 histzt、
//   dv 轮 SKIP_RULE 单列 empHist「历史回测 600」）。剔掉后真相：55-59 实际 −1.14%、50-54 −0.64%，
//   live 全桶全负，「唯一强正」整个是回填堆出来的假象。选择偏差 + 既存铁律被自己绕过，双罪。
//   ⛔⛔ 本模块铁律：hist/histzt 单列展示，绝不并入任何 live 口径（分桶/分类型/分环境/闸门消费）。
//
// 口径（全部显式，禁静默；改任何一条都要同步 _test_ev_daily.js）：
//   ① 纯净 live 样本 = 非 void + nd.nextPct 为有限数 + 非事后样本（ig+2 轮第三宗翻车，最深）：
//      事后样本三分类，与 server.js L1449-1457 的 isLiveSample 严格同语义（⛔ 同一概念禁两份实现：
//      evStats 支持经 isLive 注入 server 的分类器，默认用本文件同语义默认版，两侧永不漂移）：
//        · isBacktestSample：resolved.mode==='历史回测'（含 hist:true 的 histzt 回填）
//        · isPostHocSample：type∈{zt,review}（事后复盘登记）∨
//          (resolved.limitUp ∧ maxGain≤0.5)（登记价就在涨停板上，物理上买不到——模拟盘早有
//          S.ztCodes 一字板拦截，这类「成交」是幻想价）
//        · live = 非回测 ∧ 非事后
//      ⛔⛔ ig+2 翻车实录：本文件原先只排回测，把 zt 算成「唯一为正的充分类 +1.11%」——那一百多条的
//      成交价全在涨停板上，实盘根本买不到，整个「正 EV」是幻想成交价。修正后 live n=1210，
//      zt/yier 两个「正 EV 类」整个消失。⛔ 教训：判据只写「排除回测」不够，必须排全部事后形态。
//   ② prob 缺失/非有限数 → 单列「noprob」桶（⛔ 不猜、不填默认值、不并进相邻桶）
//   ③ EV 三件套（单位 %）：
//      · evClose 收盘口径：信号日收盘买 → 次日收盘卖（nd.nextPct 均值）
//      · evP3   +3% 止盈口径：次日最高涨幅 maxGain≥3 按 +3% 成交，否则按次日收盘（nd.nextPct）
//                ⚠️ 近似声明：跳空高开 >3% 的限价单会以更优价成交，日线无法还原，保守取下界 3；
//                不含止损（止损口径要 .kline_cache 次日最低价，归执行层模块做，⛔ 不在这里另造一套）
//      · 费后 = 上述 − FEE_RT（0.2%，RT 佣金+印花+过户的保守高估；未计最低 5 元佣金，小额实扣更高）
//   ④ 环境分层复用 _backtest_nd.js 的 envLayerOf/normDate（唯一实现；⛔ 不抄第二份，抄了就会漂移）
//   ⑤ 样本不足不硬判：cell 充分性 = n≥MIN_N(30) 且跨交易日≥MIN_DAYS(5)（后者沿用项目实测重标定的
//      两级证据标准，「三五天的噪声不能改系统」）；不足 → unknown:true + reason，⛔ 判不出不当通过
//   ⑥ 跳过登记（dv 轮精神）：void / 无 nd / hist 各计数，进 skipped 字段，报告里可见，不静默丢弃
//
// 既是独立 CLI（node _ev_daily.js → 打印 markdown + 写 ev_daily.json），也是模块：
//   evStats() 供 #261 EV 准入闸门与每日诊断消费（同 stats.json 数据源，不另开通道）；
//   evCell() 是闸门的取数接口（层级回退 type×env → type×bucket → type → bucket → unknown，
//   env=当前行情层；ig+2 条件化：普跌日负 EV 更危险，阈值收紧到 EV_COLD_FEE）。
// 须随包（automation 在云端跑此脚本），登记 _publish.py CODE_FILES。

const fs = require('fs');
const path = require('path');
const { envLayerOf, normDate } = require('./_backtest_nd.js');

const FEE_RT = 0.2;          // 费用（RT，%）：佣金+印花+过户的保守高估
const MIN_N = 30;            // cell 充分性的最小样本数（EV 方差比命中率大，严于项目的 20 条标准）
const MIN_DAYS = 5;          // cell 充分性的最小跨交易日数（项目实测重标定的两级证据标准）
const BUCKETS = ['<50', '50-54', '55-59', '60-69', '70+', 'noprob'];

// ── 口径①的事后样本分类器（默认版；server 可经 evStats({isLive}) 注入它的实现，语义一字不差）──
// ig+2 轮立案：与 server.js L1449-1457 同语义，防「EV 模块说 live、server 说事后」各判各的。
const POST_HOC_TYPES = new Set(['zt', 'review']);
function isBacktestSample(s) { return !!(s && s.resolved && s.resolved.mode === '历史回测'); }
function isPostHocSample(s) {
  if (!s || isBacktestSample(s)) return false;
  return POST_HOC_TYPES.has(s.type) || !!(s.resolved && s.resolved.limitUp && +(s.resolved.maxGain || 0) <= 0.5);
}
function isLiveSample(s) { return !isBacktestSample(s) && !isPostHocSample(s); }

// ── #261 EV 准入闸门的阈值（ig+2 行情条件化；server 消费同一常量，⛔ 禁抄第二份）──
const EV_GATE_FEE = -1.0;   // 一般日：充分 + 聚类显著 + 费后 EV ≤ −1% → 拦（决策 D1=② 已获批）
const EV_COLD_FEE = -0.5;   // 普跌日收紧到 −0.5%：与 ENV_COLD_UPLIFT「偏冷环境胜率门 +8」同哲学——
                            // 下跌市里同样的负 EV 更危险（流动性差、反弹弱），宁紧勿松

// prob → 桶名（noprob 单列，禁静默归并）
function bucketOf(prob) {
  if (typeof prob !== 'number' || !Number.isFinite(prob)) return 'noprob';
  if (prob < 50) return '<50';
  if (prob < 55) return '50-54';
  if (prob < 60) return '55-59';
  if (prob < 70) return '60-69';
  return '70+';
}

// 一批纯净 live 信号的 EV 统计（调用方保证已过滤 void/无 nd/hist）
// ig+1 轮补：显著性必须按**信号日聚类**算标准误——同日信号高度相关（同一大盘/同一板块），
//   朴素 SE=sd/√n 会把「8 天里碰巧两天大跌」当成「这个类型持续亏钱」。
//   实测教训：ig 轮报告「70+ −1.05% 确凿负」「zt 唯一为正」在聚类后全部跌出显著
//   （tClu=-1.93 / +1.33）——拿噪声当了结论。⛔ |tClu|<2 的数字只能当「点为负/正」，禁作结论。
function evOf(arr) {
  const n = arr.length;
  if (!n) return { n: 0, unknown: true, reason: 'empty' };
  let lu = 0, sumClose = 0, sumP3 = 0, p3Hit = 0;
  const xs = [];
  for (const s of arr) {
    const nd = s.nd || {};
    if (nd.limitUp) lu++;
    sumClose += nd.nextPct;
    xs.push(nd.nextPct);
    const mg = nd.maxGain;
    if (typeof mg === 'number' && mg >= 3) { sumP3 += 3; p3Hit++; } else { sumP3 += nd.nextPct; }
  }
  const evClose = sumClose / n, evP3 = sumP3 / n;
  // ── 显著性（按信号日聚类；G<2 的单日/双日样本一律 ns，不许出结论）──
  let varr = 0;
  for (const x of xs) varr += (x - evClose) * (x - evClose);
  varr = n > 1 ? varr / (n - 1) : 0;
  const sd = Math.sqrt(varr);
  const se = sd / Math.sqrt(n);
  const byDay = {};
  for (const s of arr) { const d = String(s.date || '?'); (byDay[d] = byDay[d] || []).push((s.nd || {}).nextPct || 0); }
  const G = Object.keys(byDay).length;
  let seClu = null, tClu = null, sig = 'ns';
  if (G >= 2 && n > 1) {
    const Ts = Object.values(byDay).map(a => a.reduce((x, y) => x + y, 0));
    const Tbar = Ts.reduce((a, b) => a + b, 0) / G;
    const varSum = G / (G - 1) * Ts.reduce((a, b) => a + (b - Tbar) * (b - Tbar), 0);
    seClu = Math.sqrt(varSum) / n;
    tClu = seClu > 0 ? evClose / seClu : null;
    // ⛔ 显著性与对外发布的数字必须同精度（2026-10-17 eb 轮实测的真 bug）：
    //    原来 sig 用**未取整**的 tClu 判、对外却发布 toFixed(2) —— 边界上会自相矛盾：
    //    原始 t=-1.996 → 判 ns，而面板/报告上写的是「t=-2.00」，任何人都读成显著
    //    （_test_ev_daily 的「sig ⇔ |tClu|≥2」就是这么红的，envCells pool|普涨 n=82 实测命中）。
    //    现在先把 tClu 定格成要发布的那个值，再由它推 sig —— 判据与展示不可能分叉。
    tClu = tClu == null ? null : +tClu.toFixed(2);
    sig = (tClu != null && Math.abs(tClu) >= 2) ? 'sig' : 'ns';   // |t|≥2 ≈ 5% 水平
  }
  return {
    n,
    days: G,
    limitUpRate: +(lu / n * 100).toFixed(1),
    evClose: +evClose.toFixed(3),
    evP3: +evP3.toFixed(3),
    p3HitRate: +(p3Hit / n * 100).toFixed(1),   // +3% 止盈触发率（诊断用：规则到底在工作还是休眠）
    sd: +sd.toFixed(2),
    se: +se.toFixed(3),
    seClu: seClu == null ? null : +seClu.toFixed(3),
    tClu,                                       // 已按展示精度定格（sig 由它推出，见上）
    sig,                                        // 'sig'=聚类显著 / 'ns'=不显著（含单日样本）
    evCloseFee: +(sumClose / n - FEE_RT).toFixed(3),
    evP3Fee: +(sumP3 / n - FEE_RT).toFixed(3),
  };
}

// 给 cell 补充分性判定（n 与跨天两个条件，缺一即 unknown）
// ⚠️ minN/minDays 可覆盖（守门/不同消费方要不同严格度时不改全局常量）；
//    2026-10-16 ig 轮守门抓到的静默 bug：本函数原先只读模块级 MIN_N/MIN_DAYS，
//    evStats 的 minN/minDays 参数被整个忽略（传 3 也按 30 判）——参数必须真的传下来。
function withSufficiency(st, dates, minN, minDays) {
  if (!st || !st.n) return { n: 0, unknown: true, reason: 'no-sample' };
  const mn = typeof minN === 'number' ? minN : MIN_N;
  const md = typeof minDays === 'number' ? minDays : MIN_DAYS;
  // days 单一来源：evOf 已按 date 聚类数出（同一语义两处算就会漂移），兜底才用 dates 数组
  const days = typeof st.days === 'number' ? st.days : new Set(dates || []).size;
  const out = Object.assign({}, st, { days });
  if (st.n < mn) { out.unknown = true; out.reason = 'n<' + mn; return out; }
  if (days < md) { out.unknown = true; out.reason = 'days<' + md; return out; }
  return out;
}

// 核心：纯净 live 口径的 EV 全景（分桶 × 分类型 × 分环境）
function evStats({ signals, breadth, fee, minN, minDays, isLive }) {
  const feeRt = typeof fee === 'number' ? fee : FEE_RT;
  const liveOk = typeof isLive === 'function' ? isLive : isLiveSample;   // 默认同语义分类器
  const minNUse = typeof minN === 'number' ? minN : MIN_N;
  const minDaysUse = typeof minDays === 'number' ? minDays : MIN_DAYS;
  const all = signals || [];

  // ── 跳过登记（dv 轮：每个不进分母的理由都计数可见）──
  const skipped = { void: 0, noNd: 0, backtest: 0, postHoc: 0 };
  const live = [];
  const histArr = [];
  for (const s of all) {
    if (s.void) { skipped.void++; continue; }
    // 历史回测家族（hist:true 或 resolved.mode==='历史回测'）→ 单列展示，⛔ 禁并入 live
    if (s.hist || isBacktestSample(s)) { skipped.backtest++; histArr.push(s); continue; }
    // 事后样本（zt/review 复盘登记、涨停板登记价）→ 计数可见，⛔ 不进任何 live 口径（ig+2 修正）
    if (!liveOk(s)) { skipped.postHoc++; continue; }
    const nd = s.nd || {};
    if (typeof nd.nextPct !== 'number' || !Number.isFinite(nd.nextPct)) { skipped.noNd++; continue; }
    live.push(s);
  }

  const universe = evOf(live);
  universe.evCloseFee = +(universe.evClose - feeRt).toFixed(3);
  universe.evP3Fee = +(universe.evP3 - feeRt).toFixed(3);

  // ── 分 prob 桶 ──
  const byBucket = {};
  for (const b of BUCKETS) byBucket[b] = { n: 0 };
  const bkDates = {};
  for (const b of BUCKETS) bkDates[b] = [];
  for (const s of live) {
    const b = bucketOf(s.prob);
    (bkDates[b].push(s.date));
    if (!byBucket[b]._arr) byBucket[b]._arr = [];
    byBucket[b]._arr.push(s);
  }
  for (const b of BUCKETS) {
    const st = evOf(byBucket[b]._arr || []);
    st.evCloseFee = st.n ? +(st.evClose - feeRt).toFixed(3) : null;
    st.evP3Fee = st.n ? +(st.evP3 - feeRt).toFixed(3) : null;
    delete byBucket[b]._arr;
    byBucket[b] = withSufficiency(st, bkDates[b], minNUse, minDaysUse);
  }

  // ── 分类型 ──
  const byType = {};
  const tpArr = {}, tpDates = {};
  for (const s of live) {
    const t = String(s.type || 'unknown');
    (tpArr[t] = tpArr[t] || []).push(s);
    (tpDates[t] = tpDates[t] || []).push(s.date);
  }
  for (const t of Object.keys(tpArr)) {
    const st = evOf(tpArr[t]);
    st.evCloseFee = +(st.evClose - feeRt).toFixed(3);
    st.evP3Fee = +(st.evP3 - feeRt).toFixed(3);
    byType[t] = withSufficiency(st, tpDates[t], minNUse, minDaysUse);
  }

  // ── 最具体层：type × bucket（闸门 evCell 的第一优先）──
  const cells = {};
  const cellArr = {}, cellDates = {};
  for (const s of live) {
    const t = String(s.type || 'unknown');
    const k = t + '|' + bucketOf(s.prob);
    (cellArr[k] = cellArr[k] || []).push(s);
    (cellDates[k] = cellDates[k] || []).push(s.date);
  }
  for (const k of Object.keys(cellArr)) {
    const st = evOf(cellArr[k]);
    st.evCloseFee = +(st.evClose - feeRt).toFixed(3);
    st.evP3Fee = +(st.evP3 - feeRt).toFixed(3);
    cells[k] = withSufficiency(st, cellDates[k], minNUse, minDaysUse);
  }

  // ── 信号日行情环境（单一实现 envOfSignal；⛔ 分层/条件化 cell 共用，禁抄第二份）──
  // 涨跌比分层语义复用 _backtest_nd.js 的 envLayerOf；未知=信号日缺 breadth（不伪造环境）
  const envOfSignal = s => {
    const b = breadth && breadth[normDate(s.date)];
    return envLayerOf(b ? b.upRatio : null);
  };

  // ── 分环境层（普跌/退潮/普涨/未知）──
  const envArr = { '普跌': [], '退潮': [], '普涨': [], '未知': [] };
  for (const s of live) {
    envArr[envOfSignal(s)].push(s);
  }
  const byEnv = {};
  for (const L of Object.keys(envArr)) {
    const st = evOf(envArr[L]);
    st.evCloseFee = st.n ? +(st.evClose - feeRt).toFixed(3) : null;
    st.evP3Fee = st.n ? +(st.evP3 - feeRt).toFixed(3) : null;
    byEnv[L] = withSufficiency(st, envArr[L].map(s => s.date), minNUse, minDaysUse);
  }

  // ── 行情条件化 cell：type × 环境层（ig+2 轮，用户点醒「要根据市场情绪改条件」）──
  // 无条件 EV 是混合行情的平均数：拿它预测持续下跌市 = 用全年级平均分预测明天考试。
  // 实测对照（stats.json 实测，live n≈1210）：fastin 无条件 −0.49%（闸门放行）但次日普跌 −2.01%（n=20）；
  // bigmoney 无条件 −0.49% 但次日普跌 +0.13%（n=33）；pool 无条件 −1.54%、次日普跌 −2.03%。
  // → 闸门取数先看 type×环境：普跌日的负 EV 按 EV_COLD_FEE(−0.5%) 更严阈值拦，否则该拦没拦。
  const envCells = {};
  const envCellArr = {}, envCellDates = {};
  for (const s of live) {
    const k = String(s.type || 'unknown') + '|' + envOfSignal(s);
    (envCellArr[k] = envCellArr[k] || []).push(s);
    (envCellDates[k] = envCellDates[k] || []).push(s.date);
  }
  for (const k of Object.keys(envCellArr)) {
    const st = evOf(envCellArr[k]);
    st.evCloseFee = st.n ? +(st.evClose - feeRt).toFixed(3) : null;
    st.evP3Fee = st.n ? +(st.evP3 - feeRt).toFixed(3) : null;
    envCells[k] = withSufficiency(st, envCellDates[k], minNUse, minDaysUse);
  }

  // ── histzt 事后回填单列（⛔ 声明选择偏差，绝不并回上面的任何口径）──
  const hist = evOf(histArr.map(s => Object.assign({}, s, {
    nd: { nextPct: (s.resolved && s.resolved.nextPct) || 0, maxGain: s.resolved && s.resolved.maxGain, limitUp: s.resolved && s.resolved.limitUp },
  })));
  hist.note = 'histzt 历史回填（先知道涨停才倒推登记的选择偏差样本）——单列展示，禁止并入 live 任何口径';

  return { fee: feeRt, minN: minNUse, minDays: minDaysUse, universe, byBucket, byType, cells, byEnv, envCells, hist, skipped, liveN: live.length };
}

// 闸门取数接口：type × prob × env → 最具体的充分 cell（层级回退，都判不出 → unknown）
// env 传入当前行情层（'普跌'/'退潮'/'普涨'）：ig+2 行情条件化——同类型在普跌日可能
// 从「放行」变「该拦」（fastin 实测：无条件 −0.49% → 普跌 −2.01%）。
// layer 字段记录证据取自哪层，推送/诊断可诚实标注依据强度；envMismatch=true 表示想要的
// 环境层证据不足、回退到了不含环境维的层（闸门据此知道「这份 EV 不是当前行情下的」）。
function evCell(st, type, prob, env) {
  if (!st || !st.cells) return { unknown: true, reason: 'no-stats' };
  const t = String(type || 'unknown');
  const b = bucketOf(prob);
  const e = env ? String(env) : null;
  const cands = [];
  if (e) cands.push([st.envCells && st.envCells[t + '|' + e], 'type×env']);
  cands.push([st.cells[t + '|' + b], 'type×bucket']);
  cands.push([st.byType && st.byType[t], 'type']);
  cands.push([st.byBucket && st.byBucket[b], 'bucket']);
  for (const [cell, layer] of cands) {
    if (cell && cell.n && !cell.unknown) {
      return Object.assign({}, cell, { layer, key: t + '|' + b, env: e, envMismatch: !!e && layer !== 'type×env' });
    }
  }
  return { unknown: true, reason: 'evidence-insufficient', key: t + '|' + b, env: e };
}

// ---- CLI ----
function main() {
  const root = __dirname;
  const st = JSON.parse(fs.readFileSync(path.join(root, 'stats.json'), 'utf8'));
  let breadth = {};
  try { breadth = JSON.parse(fs.readFileSync(path.join(root, 'breadth.json'), 'utf8')); } catch (e) {}
  const res = evStats({ signals: st.signals || [], breadth });

  fs.writeFileSync(path.join(root, 'ev_daily.json'), JSON.stringify(res, null, 2));

  const L = [];
  const pct = v => v == null ? '—' : (v > 0 ? '+' : '') + v + '%';
  // 显著性列：同日信号相关 → t 按信号日聚类；|t|≥2 记数值，否则标 ns（不显著·禁作结论）
  const sigCell = c => c.tClu == null ? 'ns(单/双日)' : (Math.abs(c.tClu) >= 2 ? `t=${c.tClu} ✓sig` : `t=${c.tClu} ns`);
  L.push('# 每日 EV · 按信号买到底赚不赚（纯净 live 口径，剔 histzt 回填）');
  L.push('');
  L.push(`> 样本：live n=${res.liveN}（跳过：void ${res.skipped.void} / 无次日口径 ${res.skipped.noNd} / 历史回测 ${res.skipped.backtest} / 事后登记 ${res.skipped.postHoc}）；费用 ${res.fee}% RT；充分性 n≥${res.minN} 且跨天≥${res.minDays}。`);
  L.push('> 口径：收盘=信号日收盘买→次日收盘卖；+3%=触及+3%止盈否则收盘卖（跳空高开保守取下界，不含止损）。');
  L.push('> ⚠️ 显著性：同日信号相关，t=按信号日聚类的标准误；|t|≥2 记 ✓sig，否则 **ns=不显著，该 EV 数字只是点估计，禁作结论**（ig 轮翻车教训：拿 ns 数字当「唯一正 EV 类」）。费用为保守上界：实际 RT ≈0.10-0.12%（佣金0.025%×2+印花0.05%[卖出]+过户0.001%×2，2023-08-28 起税率未变），本表 0.2% 令「费后」系统性偏悲观约 0.1pp；小额另有最低 5 元佣金。');
  L.push('');
  const u = res.universe;
  L.push(`## 总体：n=${u.n} 次日涨停率 ${u.limitUpRate}% ｜ 收盘EV ${pct(u.evClose)}（费后 ${pct(u.evCloseFee)}）｜ +3%规则EV ${pct(u.evP3)}（费后 ${pct(u.evP3Fee)}）｜ 止盈触发率 ${u.p3HitRate}% ｜ 聚类 ${sigCell(u)}`);
  L.push('');
  L.push('## 按 prob 桶');
  L.push('| 桶 | n | 跨天 | 次日涨停率 | 收盘EV | +3%EV | 费后收盘EV | 费后+3%EV | 聚类t |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const b of BUCKETS) {
    const c = res.byBucket[b];
    if (!c.n) { L.push(`| ${b} | 0 | — | — | — | — | — | — | — |`); continue; }
    const un = c.unknown ? ` ⚠️${c.reason}` : '';
    L.push(`| ${b} | ${c.n} | ${c.days} | ${c.limitUpRate}% | ${pct(c.evClose)} | ${pct(c.evP3)} | ${pct(c.evCloseFee)} | ${pct(c.evP3Fee)}${un} | ${sigCell(c)} |`);
  }
  L.push('');
  L.push('## 按信号类型');
  L.push('| 类型 | n | 跨天 | 次日涨停率 | 收盘EV | +3%EV | 费后收盘EV | 费后+3%EV | 聚类t |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const t of Object.keys(res.byType).sort((a, b2) => res.byType[b2].n - res.byType[a].n)) {
    const c = res.byType[t];
    const un = c.unknown ? ` ⚠️${c.reason}` : '';
    L.push(`| ${t} | ${c.n} | ${c.days} | ${c.limitUpRate}% | ${pct(c.evClose)} | ${pct(c.evP3)} | ${pct(c.evCloseFee)} | ${pct(c.evP3Fee)}${un} | ${sigCell(c)} |`);
  }
  L.push('');
  L.push('## 按信号日市场环境（涨跌比分层）');
  L.push('| 环境层 | n | 收盘EV | 费后收盘EV | 聚类t |');
  L.push('|---|---|---|---|---|');
  for (const L2 of ['普跌', '退潮', '普涨', '未知']) {
    const c = res.byEnv[L2];
    if (!c.n) { L.push(`| ${L2} | 0 | — | — | — |`); continue; }
    L.push(`| ${L2} | ${c.n} | ${pct(c.evClose)} | ${pct(c.evCloseFee)} | ${sigCell(c)} |`);
  }
  L.push('');
  L.push(`## histzt 历史回填（单列，禁并入）：n=${res.hist.n} 收盘EV ${pct(res.hist.evClose)} —— ${res.hist.note || ''}`);
  L.push('');
  L.push('## 按类型 × 行情环境（ig+2 条件化：无条件 EV 是混合行情的平均数）');
  L.push('| 类型×环境 | n | 跨天 | 收盘EV | 费后收盘EV | 聚类t |');
  L.push('|---|---|---|---|---|---|');
  for (const k of Object.keys(res.envCells).sort((a, b2) => res.envCells[b2].n - res.envCells[a].n)) {
    const c = res.envCells[k];
    if (!c.n) continue;
    const un = c.unknown ? ` ⚠️${c.reason}` : '';
    L.push(`| ${k} | ${c.n} | ${c.days} | ${pct(c.evClose)} | ${pct(c.evCloseFee)}${un} | ${sigCell(c)} |`);
  }
  L.push('');
  console.log(L.join('\n'));
  return res;
}

if (require.main === module) main();

module.exports = { evStats, evOf, evCell, bucketOf, withSufficiency, FEE_RT, MIN_N, MIN_DAYS, BUCKETS, POST_HOC_TYPES, isBacktestSample, isPostHocSample, isLiveSample, EV_GATE_FEE, EV_COLD_FEE };
