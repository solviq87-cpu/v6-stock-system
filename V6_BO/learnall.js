// 全A股走势自主学习引擎 v2（learnall.js）
// ---------------------------------------------------------------------------
// 用户原话：「我让你学习上涨逻辑你学习了没有 而不是依靠我喂给你的那些数据」
//
// ⚠️⚠️ v1 为什么是假的（2026-09-30 事故，必须牢记）---------------------------------
// v1 的 extractFeatures 按 `r.c / r.h / r.l / r.v / r.amt` 取字段，
// 而本项目 K 线行的真实字段是 `close / high / low / volume / amount`。
//   → c/h/l/v 全部读到 undefined → _num() 返回 0
//   → vr 恒 1（分子分母都 0，写死的兜底值）、rangePos 恒 0.5（hi<=lo 的兜底）、
//     ma5slope 恒 0、upCons 一路数到底（0>=0 永远成立，出现「连阳29天」这种鬼值）
//   → 15675 条样本里**唯一真特征是 pct**（来自 r.pct）和 amt（来自 amount 兜底命中）
// 结果：「学习」退化成对「今日涨跌幅 → 次日涨跌幅」的单维查表，学到了零个新规律。
// 这就是用户问「你学个啥」的答案 —— 不是没学，是喂进去的特征全是常数。
//
// v2 的三件事：
//   ① 字段兼容：同时认 c/close、h/high、l/low、v/vol/volume、amt/amount，
//      并对缺失的 pct / amount 做推算兜底（腾讯备用K线这两列全是 0）。
//   ② 从「存样本」改成「存统计量」（统计立方）：
//      不再保存几十万条样本（体积爆炸、只能按 pct 一个维度分桶），
//      而是对每个特征的每一档、以及**任意两个特征档位的组合**累计 (n, hits)。
//      好处：① 文件从 2.4MB 降到几十 KB；② 能容纳全市场几十万根K线；
//            ③ 多条件组合的样本量依然能直接读到 —— 这是"学出组合规律"的关键。
//   ③ 规律由数据自动挖出来，不是人写死的：
//      mineRules() 扫描统计立方，挑出「样本够多 且 命中率显著高于基准」的 cell；
//      predictML() 用 log-odds 增量证据合成（组合cell优先于它的两个单条件，避免重复计数）。
//      人只提供「看哪些特征维度」这一个选择，其余全部是数据说了算。
// ---------------------------------------------------------------------------
'use strict';
const fs = require('fs');
const path = require('path');
// ⛔ 涨停判定必须走 analysis.js 的唯一入口（2026-10-06 修，重复实现分叉专项）。
//   learnall 原本自带两处 `pct >= lp - 0.5`（ztCount 的 N 日涨停次数、labelZt 的次日封板标注），
//   数值上跟 server.js 那六处写死的一模一样，但**绕过了 A.isNearLimitUp**：
//   新股上市前 5 个交易日不设涨跌幅限制，涨 30% 照样被数成"涨停"。
//   而 runLearnallIngest 的门槛只有 rows.length>=6 —— 新股是**真能进来的**，
//   zt20/zt60（涨停基因）两个特征维度与"次日封板"标签会被一起污染，学出来的规律是假的。
//   analysis.js 是纯函数模块（不 require 任何东西），这里单向依赖不会成环。
const A = require('./analysis.js');

const FILE = path.join(__dirname, 'learnall.json');
const LABEL_THR = 3;          // 次日涨幅≥3% 算「上涨」标签（与全局 HIT_THR 一致）
// ⚠️ v3 = 新增 6 个趋势形态维度（maBull/ma20slope/dd60/runUp/volTrend/zt60）。
//    维度变了 → 旧立方里的统计全部作废（bin 编号含义变了），必须整库重建。
const VER = 3;
const MAX_SAMPLES = 20000;    // 兼容旧导出（v2 不再依赖它）
const DAMP = 0.6;             // 各维度证据独立性修正（多条件天然相关，不能直接相加）

// ── 特征维度定义（唯一定制点：机器只看这些维度，规律从数据里挖） ──────────
// 每档写成 [下界, 上界, 中文名]，取值落在 [下界, 上界)。
const DIMS = [
  { key: 'pct', name: '当日涨幅', bins: [
    [-1e9, -5, '跌超5%'], [-5, -3, '跌3~5%'], [-3, 0, '跌0~3%'],
    [0, 3, '微涨0~3%'], [3, 5, '涨3~5%'], [5, 9.5, '涨5~9%'], [9.5, 1e9, '涨停/近涨停']] },
  { key: 'vr', name: '量比', bins: [
    [-1e9, 0.8, '量比<0.8'], [0.8, 1.2, '量比0.8~1.2'], [1.2, 2, '量比1.2~2'],
    [2, 3.5, '量比2~3.5'], [3.5, 1e9, '量比>3.5']] },
  { key: 'rangePos', name: '20日位置', bins: [
    [-1e9, 0.2, '位置<20%'], [0.2, 0.4, '位置20~40%'], [0.4, 0.6, '位置40~60%'],
    [0.6, 0.8, '位置60~80%'], [0.8, 1e9, '位置>80%']] },
  { key: 'ma5slope', name: '5日线斜率', bins: [
    [-1e9, -1, '均线陡降'], [-1, -0.2, '均线下行'], [-0.2, 0.2, '均线走平'],
    [0.2, 1, '均线上行'], [1, 1e9, '均线陡升']] },
  { key: 'upCons', name: '连阳', bins: [
    [-1e9, 1, '无连阳'], [1, 2, '连阳2天'], [2, 3, '连阳3天'], [3, 1e9, '连阳≥4天']] },
  { key: 'amt', name: '成交额', bins: [
    [-1e9, 1, '成交<1亿'], [1, 3, '成交1~3亿'], [3, 10, '成交3~10亿'],
    [10, 30, '成交10~30亿'], [30, 1e9, '成交>30亿']] },
  // ↓ 下面这几位是专门为「涨停之前」这件事加的：
  //   只靠涨跌幅/量比时，"还没涨"的那批票几乎看不出差别（留出验证 AUC 仅 0.545）。
  //   突破前夕真正的变化是：缩到很窄、贴着前高、尾盘收在高位、前几日温和爬升、身上有涨停基因。
  { key: 'closePos', name: '收盘位置', bins: [
    [-1e9, 0.3, '收在全天低位'], [0.3, 0.6, '收在全天中位'], [0.6, 0.85, '收在次高位'],
    [0.85, 1.01, '尾盘收在高位']] },
  { key: 'gap20', name: '距20日高点', bins: [
    [-1e9, 3, '贴住20日高点'], [3, 8, '距高点3~8%'], [8, 15, '距高点8~15%'],
    [15, 1e9, '远离20日高点']] },
  { key: 'amp20', name: '20日振幅', bins: [
    [-1e9, 25, '平台收敛<25%'], [25, 40, '振幅25~40%'], [40, 60, '振幅40~60%'],
    [60, 1e9, '振幅>60%']] },
  { key: 'cum5', name: '近5日动能', bins: [
    [-1e9, -3, '5日累跌'], [-3, 0, '5日微跌'], [0, 3, '5日微涨'],
    [3, 8, '5日涨3~8%'], [8, 1e9, '5日涨超8%']] },
  { key: 'zt20', name: '涨停基因', bins: [
    [-1e9, 1, '20日无涨停'], [1, 2, '20日1个板'], [2, 1e9, '20日≥2个板']] },
  // ↓ v3 新增：趋势形态维度。没有这几位，"走了两周上升通道"和"昨天刚反弹一天"
  //    在模型眼里完全一样 —— 奥士康就是这么被漏掉的（登记信号 0 条）。
  { key: 'maBull', name: '均线排列', bins: [
    [-1e9, 1, '空头排列'], [1, 2, '部分多头'], [2, 3, '标准多头排列']] },
  { key: 'ma20slope', name: '中期均线方向', bins: [
    [-1e9, -0.5, '中期下行'], [-0.5, 0.3, '中期走平'], [0.3, 1e9, '中期上行']] },
  { key: 'dd60', name: '距60日高回撤', bins: [
    [-1e9, 5, '贴住60日高'], [5, 15, '回撤5~15%'], [15, 30, '回撤15~30%'], [30, 1e9, '回撤>30%']] },
  { key: 'runUp', name: '连涨天数', bins: [
    [-1e9, 1, '未连涨'], [1, 2, '连涨2天'], [2, 3, '连涨3天'], [3, 1e9, '连涨≥4天']] },
  { key: 'volTrend', name: '量能趋势', bins: [
    [-1e9, 0.8, '缩量'], [0.8, 1.2, '量能持平'], [1.2, 2, '温和放量'], [2, 1e9, '爆量']] },
  { key: 'zt60', name: '长周期涨停基因', bins: [
    [-1e9, 1, '60日无板'], [1, 3, '60日1~2板'], [3, 1e9, '60日≥3板']] }
];
// pct 维度 → 旧的分桶名（保持 /api/learnall-status 输出向后兼容）
const PCT_LABELS = ['深跌', '-5~-3', '-3~0', '0~3', '3~5', '5~9', '涨停'];
const D_PCT = 0;

function binIdx(d, v) {
  const bins = DIMS[d].bins;
  const x = Number.isFinite(v) ? v : 0;
  for (let i = 0; i < bins.length; i++) if (x >= bins[i][0] && x < bins[i][1]) return i;
  return bins.length - 1;
}
function binTxt(d, i) { return DIMS[d].bins[i] ? DIMS[d].bins[i][2] : '?'; }

// ── K线字段读取：同时兼容 learnall 自造格式与本项目 server 的真实格式 ──────
//  ⚠️ 这一段就是 v1 翻车的地方。真实行：{date,open,close,high,low,volume,amount,pct}
//     自造/文档格式：{c,o,h,l,v,amt}。两边都要认，取第一个「有限且>0」的值。
function _num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function _pick(r, names) {
  for (const n of names) { const x = Number(r[n]); if (Number.isFinite(x) && x > 0) return x; }
  return 0;
}
const F_CLOSE = ['c', 'close'];
const F_HIGH = ['h', 'high'];
const F_LOW = ['l', 'low'];
const F_OPEN = ['o', 'open'];
const F_VOL = ['v', 'vol', 'volume'];
const F_AMT = ['amt', 'amount'];
function _close(rows, i) { return rows[i] ? _pick(rows[i], F_CLOSE) : 0; }
function _high(rows, i) { return rows[i] ? _pick(rows[i], F_HIGH) : 0; }
function _low(rows, i) { return rows[i] ? _pick(rows[i], F_LOW) : 0; }
function _vol(rows, i) { return rows[i] ? _pick(rows[i], F_VOL) : 0; }
// 成交额：腾讯备用K线 amount 恒为 0 → 用 量(手)×100×收盘价 估算。
// 不估的话这类票全落进「成交<1亿」档，等于凭空造一个假规律出来。
function _amtOf(rows, i) {
  const r = rows[i]; if (!r) return 0;
  const a = _pick(r, F_AMT);
  if (a > 0) return a;
  const v = _vol(rows, i), c = _close(rows, i);
  return (v > 0 && c > 0) ? v * 100 * c : 0;
}
// 当日涨跌幅：pct 缺失或为 0 时（备用源没给），退回用前后收盘算。
// ⚠️ 不能像 v1 那样「只要 r.pct 是数字就直接返回」—— 缺失时它就是 0，
//    直接采信会把整段历史当成一字横盘。
function _pctOf(rows, i) {
  const r = rows[i]; if (!r) return 0;
  const p = _num(r.pct);
  const prev = i > 0 ? _close(rows, i - 1) : 0;
  if (p !== 0 && Number.isFinite(p)) return p;
  if (prev > 0 && _close(rows, i) > 0) return (_close(rows, i) / prev - 1) * 100;
  return p;
}

// ── 指标 ──────────────────────────────────────────────────────────────
function rangePos(rows, i, n = 20) {
  if (i < 0) return 0.5;
  const lo = Math.max(0, i - n + 1);
  let hi = -Infinity, lp = Infinity, any = false;
  for (let k = lo; k <= i; k++) {
    if (!rows[k]) continue;
    const h = _high(rows, k), l = _low(rows, k);
    if (h <= 0 || l <= 0) continue;      // 高低点缺失就不能假装是 0
    any = true;
    if (h > hi) hi = h; if (l < lp) lp = l;
  }
  const c = _close(rows, i);
  if (!any || hi <= lp || c <= 0) return 0.5;
  return Math.max(0, Math.min(1, (c - lp) / (hi - lp)));
}
function avgVol5(rows, i) {
  let s = 0, n = 0;
  for (let k = Math.max(0, i - 4); k <= i; k++) { s += _vol(rows, k); n++; }
  return n ? s / n : 0;
}
function volRatio(rows, i) {
  const v = _vol(rows, i), a = avgVol5(rows, i);
  return a > 0 ? v / a : 1;
}
function upCons(rows, i) {
  let n = 0;
  for (let k = i; k >= 1; k--) {
    const c0 = _close(rows, k), c1 = _close(rows, k - 1);
    if (c0 > 0 && c1 > 0 && c0 >= c1) n++; else break;
  }
  return n;
}
function ma5Slope(rows, i) {
  if (i < 5) return 0;
  let ok = true;
  for (let k = i - 5; k <= i; k++) if (!(_close(rows, k) > 0)) ok = false;
  if (!ok) return 0;
  const s1 = (_close(rows, i) + _close(rows, i - 1) + _close(rows, i - 2) + _close(rows, i - 3) + _close(rows, i - 4)) / 5;
  const s0 = (_close(rows, i - 1) + _close(rows, i - 2) + _close(rows, i - 3) + _close(rows, i - 4) + _close(rows, i - 5)) / 5;
  return s0 > 0 ? (s1 - s0) / s0 * 100 : 0;
}
function gapToLimit(rows, i, limitPct) {
  const lp = Number.isFinite(limitPct) && limitPct > 0 ? limitPct : 10;
  return Math.max(0, lp - _pctOf(rows, i));
}
// 收盘在当日振幅中的位置：1=收在最高价，0=收在最低价（尾盘走强/走弱的直接证据）
function closePos(rows, i) {
  const h = _high(rows, i), l = _low(rows, i), c = _close(rows, i);
  if (!(h > 0) || !(l > 0) || !(c > 0) || h <= l) return 0.5;
  return Math.max(0, Math.min(1, (c - l) / (h - l)));
}
// 距 N 日最高收盘还有几个点在下方（贴住前高=突破前夕）
function gapToHigh(rows, i, n = 20) {
  const lo = Math.max(0, i - n + 1);
  let hi = -Infinity, any = false;
  for (let k = lo; k <= i; k++) {
    const h = _high(rows, k);
    if (h > 0) { any = true; if (h > hi) hi = h; }
  }
  const c = _close(rows, i);
  if (!any || !(hi > 0) || !(c > 0)) return null;
  return +(((hi - c) / hi) * 100).toFixed(2);
}
// N 日振幅：(最高-最低)/最低（越小=越像被压缩的弹簧）
function ampN(rows, i, n = 20) {
  const lo = Math.max(0, i - n + 1);
  let hi = -Infinity, lp = Infinity, any = false;
  for (let k = lo; k <= i; k++) {
    const h = _high(rows, k), l = _low(rows, k);
    if (h > 0 && l > 0) { any = true; if (h > hi) hi = h; if (l < lp) lp = l; }
  }
  if (!any || !(lp > 0)) return null;
  return +(((hi - lp) / lp) * 100).toFixed(2);
}
// N 日累计涨幅
function cumReturn(rows, i, n) {
  const lo = Math.max(0, i - n + 1);
  const c0 = _close(rows, lo), c1 = _close(rows, i);
  if (!(c0 > 0) || !(c1 > 0)) return null;
  return +((c1 / c0 - 1) * 100).toFixed(2);
}
// ⛔ 涨停判定的唯一入口（容差 0.5，与 server.js 三个扫描器同一份口径）。
//   opt 里带了 code/name 就走 A.isNearLimitUp（限幅规则 + 新股无涨跌幅限制期全项目共用一份）；
//   没带（旧签名 / 单元测试 / 外部脚本）才退化为纯数值比较 —— 与修之前逐字节等价，绝不越改越松。
function _isZt(pct, limitPct, opt) {
  if (opt && opt.code != null && opt.code !== '') return A.isNearLimitUp(opt.code, opt.name, pct, 0.5);
  const lp = Number.isFinite(limitPct) && limitPct > 0 ? limitPct : 10;
  return (+(pct) || 0) >= lp - 0.5;
}
// N 日内涨停（按各自板块限幅）次数
function ztCount(rows, i, n, limitPct, opt) {
  const lo = Math.max(0, i - n + 1);
  let c = 0;
  for (let k = lo; k <= i; k++) if (_isZt(_pctOf(rows, k), limitPct, opt)) c++;
  return c;
}

// ═══ 趋势形态维度（v3 新增）═════════════════════════════════════════════
// 用户原话：「奥士康那种才是经典的趋势票」「你要学习全A股所有股票的K线图，
//   并且能结合上涨趋势的K线发掘出更多的上涨票」。
// v2 的 12 个维度全是【单日】快照：当日涨幅、当日量比、当日收盘位置……
//   一只票走了两周的上升通道，在 v2 眼里和一只昨天刚反弹的票没有区别 ——
//   因为"趋势"是跨多日的形状，单日快照根本装不下。这就是奥士康被完全漏掉的根因。
// 下面这组把"趋势"拆成机器能统计的量：均线排列、中期均线方向、回撤深度、
//   连涨天数、量能趋势、更长的涨停基因。
// ── N 日均线值（数据不足返回 null，绝不用 0 冒充）──
function maN(rows, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const c = _close(rows, k);
    if (!(c > 0)) return null;
    s += c;
  }
  return s / n;
}
// ── 均线多头层数：ma5>ma10 记 1 层，ma10>ma20 记 1 层（0~2）──
//   0 = 空头排列（均线从上到下压着）；2 = 标准多头排列
function maBullLayers(rows, i) {
  const m5 = maN(rows, i, 5), m10 = maN(rows, i, 10), m20 = maN(rows, i, 20);
  if (m5 == null || m10 == null || m20 == null) return 0;
  return (m5 > m10 ? 1 : 0) + (m10 > m20 ? 1 : 0);
}
// ── N 日均线斜率（%）：现在的均线 vs 5 天前的均线 ──
//   ma20slope 是"中期趋势还在不在"最直接的证据：均线向下 = 下降通道里的反弹
function maSlopeN(rows, i, n) {
  const a = maN(rows, i, n), b = maN(rows, Math.max(0, i - 5), n);
  if (a == null || b == null || !(b > 0)) return 0;
  return +((a / b - 1) * 100).toFixed(2);
}
// ── 距 N 日最高价的回撤（%）：趋势有没有被破坏 ──
//   涨了 60% 但离高点只差 3% = 趋势健康；从高点掉 40% = 趋势已死，只是反弹
function ddFromHigh(rows, i, n = 60) {
  const lo = Math.max(0, i - n + 1);
  let hi = -Infinity, any = false;
  for (let k = lo; k <= i; k++) {
    const h = _high(rows, k);
    if (h > 0) { any = true; if (h > hi) hi = h; }
  }
  const c = _close(rows, i);
  if (!any || !(hi > 0) || !(c > 0)) return null;
  return +(((hi - c) / hi) * 100).toFixed(2);
}
// ── 连续收涨天数（收盘价一天比一天高）──
//   用户点名的「连续收涨的票」就是这一个维度；v2 只有 upCons（>=昨日，含走平）
function runUpDays(rows, i) {
  let n = 0;
  for (let k = i; k >= 1; k--) {
    const c0 = _close(rows, k), c1 = _close(rows, k - 1);
    if (c0 > 0 && c1 > 0 && c0 > c1) n++; else break;
  }
  return n;
}
// ── 量能趋势：近5日均量 / 近20日均量 ──
//   趋势票的典型量能是"温和放大后维持"，不是某天爆量（爆量常是出货）
function volTrend(rows, i) {
  let s5 = 0, n5 = 0, s20 = 0, n20 = 0;
  for (let k = Math.max(0, i - 4); k <= i; k++) { s5 += _vol(rows, k); n5++; }
  for (let k = Math.max(0, i - 19); k <= i; k++) { s20 += _vol(rows, k); n20++; }
  if (!n5 || !n20) return 1;
  const a5 = s5 / n5, a20 = s20 / n20;
  return a20 > 0 ? +(a5 / a20).toFixed(2) : 1;
}
function extractFeatures(rows, i, opt) {
  const o = opt || {};
  if (!rows || i < 0 || i >= rows.length) return null;
  const g20 = gapToHigh(rows, i, 20), a20 = ampN(rows, i, 20);
  const dd = ddFromHigh(rows, i, 60);
  return {
    pct: +_pctOf(rows, i).toFixed(2),
    vr: +volRatio(rows, i).toFixed(2),
    rangePos: +rangePos(rows, i, 20).toFixed(2),
    upCons: upCons(rows, i),
    ma5slope: +ma5Slope(rows, i).toFixed(2),
    gap: +gapToLimit(rows, i, o.limitPct).toFixed(2),
    amt: +(_amtOf(rows, i) / 1e8).toFixed(2),   // 成交额(亿)
    closePos: +closePos(rows, i).toFixed(2),
    gap20: g20 == null ? 50 : g20,              // 拿不到就给个"很远"的中性值，别造假信号
    amp20: a20 == null ? 50 : a20,
    cum5: +(cumReturn(rows, i, 5) == null ? 0 : cumReturn(rows, i, 5)),
    zt20: ztCount(rows, i, 20, o.limitPct, o),
    // ── v3 趋势形态 ──
    maBull: maBullLayers(rows, i),
    ma20slope: maSlopeN(rows, i, 20),
    // 数据不足 60 根时给"中性偏保守"的 20，别假装贴住高点也别假装腰斩
    dd60: dd == null ? 20 : dd,
    runUp: runUpDays(rows, i),
    volTrend: volTrend(rows, i),
    zt60: ztCount(rows, i, 60, o.limitPct, o),
    ver: VER
  };
}

// ── 标注：次日涨跌幅 ≥ LABEL_THR → 1 ────────────────────────────────────
function labelNext(rows, i, thr) {
  const t = Number.isFinite(thr) ? thr : LABEL_THR;
  if (i + 1 >= (rows || []).length) return null;
  const next = _pctOf(rows, i + 1);
  return next >= t ? 1 : 0;
}
// 第二个学习目标：次日直接封板没有？（各板块限幅不同：主板10/创业科创20/北交所30；ST 2026-04 起同主板）
function labelZt(rows, i, limitPct, opt) {
  if (i + 1 >= (rows || []).length) return null;
  // 次日最高价摸到涨停也算（用户是要在"涨停前"埋伏，不是为了收盘还封着）
  const nt = rows[i + 1];
  const hiPct = (Number(nt.pct) || 0);
  if (_isZt(hiPct, limitPct, opt)) return 1;
  const prev = _close(rows, i), hi = _high(rows, i + 1);
  if (prev > 0 && hi > 0 && _isZt((hi / prev - 1) * 100, limitPct, opt)) return 1;
  return 0;
}

// ── 单指标合法性自检（给测试和排障用：v1 的特征通胀不能再没人管） ────────
function featHealth(rows, opt) {
  const out = { n: 0, zeroHl: 0, zeroVol: 0, constVr: 0, constPos: 0, constSlope: 0, badUpCons: 0 };
  if (!Array.isArray(rows) || rows.length < 8) return out;
  const start = Math.max(1, rows.length - 40);
  const vrs = new Set(), pos = new Set(), sl = new Set();
  for (let i = start; i < rows.length - 1; i++) {
    out.n++;
    if (!(_high(rows, i) > 0) || !(_low(rows, i) > 0)) out.zeroHl++;
    if (!(_vol(rows, i) > 0)) out.zeroVol++;
    const f = extractFeatures(rows, i, opt);
    vrs.add(f.vr); pos.add(f.rangePos); sl.add(f.ma5slope);
    if (f.upCons > 10) out.badUpCons++;
  }
  out.constVr = vrs.size; out.constPos = pos.size; out.constSlope = sl.size;
  return out;
}

// ── 分桶（旧接口保留：传样本数组走旧逻辑；传 db 走立方版） ───────────────
function bucketOf(feat, opt) {
  const p = feat.pct;
  // ⛔ 同上：不写死 9.5（那是主板口径）。带了 code/name 就走唯一入口，没带才退化为 9.5。
  if (opt && opt.code != null && opt.code !== '' ? A.isNearLimitUp(opt.code, opt.name, p, 0.5)
    : p >= 9.5) return '涨停';
  if (p >= 5) return '5~9';
  if (p >= 3) return '3~5';
  if (p >= 0) return '0~3';
  if (p >= -3) return '-3~0';
  if (p >= -5) return '-5~-3';
  return '深跌';
}
function computeBuckets(x) {
  // db 形态：从统计立方直接还原 pct 桶（体积和维度都不再依赖原始样本）
  if (x && !Array.isArray(x)) {
    const stat = x.stat || {};
    const out = {};
    for (let i = 0; i < DIMS[D_PCT].bins.length; i++) {
      const c = stat['S:' + D_PCT + ':' + i];
      const n = c ? c[0] : 0, h = c ? c[1] : 0;
      out[PCT_LABELS[i]] = { n, hits: h, rate: n ? +(h / n * 100).toFixed(1) : null };
    }
    return out;
  }
  const b = {};
  for (const s of x || []) {
    if (s == null || s.label == null) continue;
    const k = s.bucket || bucketOf(s.feat || { pct: 0 });
    const e = b[k] = b[k] || { n: 0, hits: 0 };
    e.n++; if (s.label === 1) e.hits++;
  }
  const out = {};
  for (const k of Object.keys(b)) {
    const e = b[k];
    out[k] = { n: e.n, hits: e.hits, rate: e.n ? +(e.hits / e.n * 100).toFixed(1) : null };
  }
  return out;
}
// 旧版查表预测（保留兼容；真正给选股用的是下面的 predictML）
function predict(feat, buckets) {
  if (!feat) return null;
  const k = bucketOf(feat);
  const e = (buckets || {})[k];
  if (!e || !e.n) return { bucket: k, rate: null, n: 0 };
  return { bucket: k, rate: e.rate, n: e.n };
}

// ── 统计立方：单条件 cell + 两两组合 cell ────────────────────────────────
// key: 'S:<dimIdx>:<binIdx>'  /  'P:<dA>:<iA>:<dB>:<iB>'  → [n, hits3, hitsZt]
//   hits3  = 次日涨≥3% 的次数（命中口径，与全局 HIT_THR 对齐）
//   hitsZt = 次日直接封板 的次数 —— 用户要的就是这个：「涨停之前告诉我」。
//           同一个立方里放两套计数，机器才能分别回答「明天涨的概率」和「明天封板的概率」，
//           而不是把两个目标搅成一个四不像的数字。
// 所有维度两两组合都计数，机器才有机会发现「两个条件同时满足」这种人想不到的组合规律。
const TARGETS = { up3: 1, zt: 2 };
const TARGET_NAME = { up3: '次日涨≥3%', zt: '次日封板' };
function _bump(stat, key, up3, zt) {
  const e = stat[key];
  if (e) { e[0]++; if (up3 === 1) e[1]++; if (zt === 1) e[2]++; }
  else stat[key] = [1, up3 === 1 ? 1 : 0, zt === 1 ? 1 : 0];
}
function countSample(db, feat, up3, zt) {
  const stat = db.stat = db.stat || {};
  db.n = (db.n || 0) + 1;
  if (up3 === 1) db.hits = (db.hits || 0) + 1;
  if (zt === 1) db.hitsZt = (db.hitsZt || 0) + 1;
  const d = DIMS.length;
  const bi = new Array(d);
  for (let k = 0; k < d; k++) bi[k] = binIdx(k, feat[DIMS[k].key]);
  for (let k = 0; k < d; k++) _bump(stat, 'S:' + k + ':' + bi[k], up3, zt);
  for (let a = 0; a < d; a++)
    for (let b = a + 1; b < d; b++)
      _bump(stat, 'P:' + a + ':' + bi[a] + ':' + b + ':' + bi[b], up3, zt);
}
function hitRate(db, target) {
  if (!db || !db.n) return 0;
  if (target === 'zt') return (db.hitsZt || 0) / db.n;
  return (db.hits || 0) / db.n;
}
function _logit(p) { const x = Math.min(0.98, Math.max(0.02, p)); return Math.log(x / (1 - x)); }
function _sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
function _shrink(n, K) { return n / (n + K); }

// ── 自动挖掘规律：是谁说了算？数据说了算 ────────────────────────────────
// 只做一件事：扫一遍统计立方，把「样本够多(n≥minN) 且 命中率显著高于基准(lift≥minLift)」
// 的 cell 挑出来 —— 没有一条规则是人预先写好的，包括它们的组合。
function mineRules(db, opt) {
  const o = opt || {};
  const target = (o.target === 'zt') ? 'zt' : 'up3';
  const ti = TARGETS[target];
  const minN = o.minN || 150, minPairN = o.minPairN || 80;
  const minLift = o.minLift || 1.15, minPairLift = o.minPairLift || 1.25;
  const base = hitRate(db, target);
  if (!base) return null;
  const stat = db.stat || {};
  const out = { target, name: TARGET_NAME[target], base: +base.toFixed(4), minN, minPairN, single: [], pair: [] };
  const cell = key => stat[key];
  const mkCell = (txt, c, tags) => {
    const rate = c[ti] / c[0], lift = rate / base;
    return Object.assign({ txt, n: c[0], hits: c[ti], rate: +(rate * 100).toFixed(1), lift: +lift.toFixed(2) }, tags || {});
  };
  for (let d = 0; d < DIMS.length; d++) {
    for (let i = 0; i < DIMS[d].bins.length; i++) {
      const c = cell('S:' + d + ':' + i);
      if (!c || c[0] < minN) continue;
      const e = mkCell(binTxt(d, i), c, { d, i });
      if (e.lift < minLift) continue;
      e.score = +(Math.log(e.lift) * _shrink(e.n, 400)).toFixed(4);
      out.single.push(e);
    }
  }
  out.single.sort((a, b) => b.score - a.score);
  out.single = out.single.slice(0, 16);
  for (let a = 0; a < DIMS.length; a++) {
    for (let b = a + 1; b < DIMS.length; b++) {
      for (let ia = 0; ia < DIMS[a].bins.length; ia++) {
        for (let ib = 0; ib < DIMS[b].bins.length; ib++) {
          const c = cell('P:' + a + ':' + ia + ':' + b + ':' + ib);
          if (!c || c[0] < minPairN) continue;
          const e = mkCell(binTxt(a, ia) + ' × ' + binTxt(b, ib), c, { a, ia, b, ib });
          if (e.lift < minPairLift) continue;
          e.score = +(Math.log(e.lift) * _shrink(e.n, 800)).toFixed(4);
          out.pair.push(e);
        }
      }
    }
  }
  out.pair.sort((a, b) => b.score - a.score);
  out.pair = out.pair.slice(0, 40);
  out.minedAt = Date.now();
  return out;
}

// ── 预测：把挖出来的规律按「增量证据」合成一个概率 ──────────────────────
// 做法（为什么这么做）：
//   每个维度单独看时贡献 score=ln(lift)×shrink(n)；但六个维度彼此相关，直接相加会高估。
//   所以先看两两组cell —— 若某个组合cell的证据比它拆成的两个单条证据还强（|gain|大），
//   就用组合**替换**掉那两个单条（增量证据，避免重复计数），最后整体乘 DAMP 修正独立性。
//   p = sigmoid(logit(基准hit率) + Σ修正后证据)
function predictML(feat, db, target) {
  if (!feat || !db) return null;
  const tg = (target === 'zt') ? 'zt' : 'up3';
  const ti = TARGETS[tg];
  const rules = db.rules && db.rules[tg];
  const base = hitRate(db, tg);
  if (!rules || !base) return null;
  const stat = db.stat || {};
  const D = DIMS.length;
  const idx = new Array(D), singleE = new Array(D);
  const minSingleN = Math.min(rules.minN || 150, 80);
  for (let d = 0; d < D; d++) {
    idx[d] = binIdx(d, feat[DIMS[d].key]);
    singleE[d] = null;
    const c = stat['S:' + d + ':' + idx[d]];
    if (!c || c[0] < minSingleN) continue;
    const rate = c[ti] / c[0], lift = rate / base;
    singleE[d] = { txt: binTxt(d, idx[d]), n: c[0], hits: c[ti], rate, lift, score: Math.log(lift) * _shrink(c[0], 400) };
  }
  // 组合cell的「增量证据」：比它那两个单条多出来的信息才算数
  const cands = [];
  for (let a = 0; a < D; a++) {
    if (!singleE[a]) continue;
    for (let b = a + 1; b < D; b++) {
      if (!singleE[b]) continue;
      const c = stat['P:' + a + ':' + idx[a] + ':' + b + ':' + idx[b]];
      if (!c || c[0] < (rules.minPairN || 80)) continue;
      const rate = c[ti] / c[0], lift = rate / base;
      const score = Math.log(lift) * _shrink(c[0], 800);
      const gain = score - singleE[a].score - singleE[b].score;
      cands.push({ txt: binTxt(a, idx[a]) + ' × ' + binTxt(b, idx[b]), n: c[0], hits: c[ti], rate, lift, score, gain, a, b });
    }
  }
  cands.sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain));
  const used = new Set(), picked = [];
  for (const cd of cands) {
    if (Math.abs(cd.gain) < 0.04) break;          // 增量太小 → 不值得替换单条
    if (used.has(cd.a) || used.has(cd.b)) continue; // 维度已被更强的组合占用
    used.add(cd.a); used.add(cd.b);
    picked.push(cd);
    if (picked.length >= 3) break;
  }
  let z = 0; const applied = [];
  for (let d = 0; d < D; d++) {
    if (singleE[d] && !used.has(d)) { z += singleE[d].score; applied.push(singleE[d]); }
  }
  for (const cd of picked) { z += cd.score; applied.push(cd); }
  if (!applied.length) return null;
  const p = _sigmoid(_logit(base) + z * DAMP);
  applied.sort((x, y) => Math.abs(y.score) - Math.abs(x.score));
  return {
    target: tg, name: TARGET_NAME[tg], p, base, lift: p / base,
    rules: applied.slice(0, 4).map(x => ({
      txt: x.txt, n: x.n, rate: +(x.rate * 100).toFixed(1),
      lift: +x.lift.toFixed(2), score: +x.score.toFixed(3)
    })),
    nUsed: applied.length
  };
}

// ── 持久化 / 版本迁移 ──────────────────────────────────────────────────
function freshDb() {
  return { ver: VER, n: 0, hits: 0, hitsZt: 0, stat: {}, prog: {}, days: {}, buckets: {}, rules: null, base: 0, updatedAt: 0 };
}
// 原子写 + 损坏留档：进程被 kill 时 writeFileSync 会留下半截 JSON，
// 下次启动 JSON.parse 抛错 → 旧代码 catch 后 freshDb() 重建 → 几十万条样本静默归零。
// 这里改成"写 .tmp 再 rename"，并把坏文件留档而不是丢弃（数据还在，可人工恢复）。
function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); return true; }
  catch (e) { console.error('[learnall] 写盘失败:', e && e.message); try { fs.unlinkSync(tmp); } catch {} return false; }
}
function load() {
  let db = null;
  try {
    const txt = fs.readFileSync(FILE, 'utf8');
    try { db = JSON.parse(txt); }
    catch (e) {
      try {
        const bad = FILE + '.corrupt-' + Date.now();
        fs.renameSync(FILE, bad);
        console.error(`[learnall] ⚠️ 模型库解析失败，坏文件已留档 ${bad} —— 样本未丢失，勿重建覆盖`);
      } catch {}
      db = null;
    }
  } catch { db = null; }
  if (db && db.ver === VER && db.stat) {
    // 防线：predictML 依赖 rules。若库是从某处拷来的、rules 丢了，不补就会让整条选股
    // 静默退化成"自学模型不可用"（laProb 恒 null）—— 这类"算完却在最后一步被丢弃"的坑踩过太多次。
    if (!db.rules || !db.rules.up3) db.rules = { up3: mineRules(db, { target: 'up3' }), zt: mineRules(db, { target: 'zt' }) };
    return db;
  }
  // v1 样本的 pct 以外的特征全是常数（vr=1/rangePos=0.5/ma5slope=0），留着只会污染模型。
  // 这里必须丢掉重来 —— 宁可暂时样本少，也不能拿假特征继续"学习"。
  if (db && db.ver !== VER) {
    console.warn(`[learnall] 检测到 v${db.ver || 1} 旧库（${db.n || 0} 条样本）：特征是损坏的常数（字段名不匹配），已弃用并重建`);
  }
  return freshDb();
}
function save(db) {
  db.ver = VER;
  db.base = +(db.n ? (db.hits || 0) / db.n : 0).toFixed(6);
  db.baseZt = +(db.n ? (db.hitsZt || 0) / db.n : 0).toFixed(6);
  db.buckets = computeBuckets(db);
  db.rules = { up3: mineRules(db, { target: 'up3' }), zt: mineRules(db, { target: 'zt' }) };
  db.updatedAt = Date.now();
  atomicWrite(FILE, JSON.stringify(db));
  return db;
}
function prune() { /* v2 是固定大小的统计立方，无需剪枝；保留空实现以兼容旧调用 */ }

// ── 入库：幂等增量 ─────────────────────────────────────────────────────
// prog[code] 记录「这只票最后一根已计数K线的日期」，下次只处理它之后的新K线。
// 这样反复调用不会把同一根K线重复计数（v1 靠"按日期整批发"，全量回填时会翻车）。
// 倒数第一根（今天）没有"次日"→ 不计数，等明天有新K线时回来补标签。
function ingestAll(rowsByCode, opt) {
  const db = load();
  const o = opt || {};
  const thr = o.thr;
  const stat = db.stat = db.stat || {};
  const prog = db.prog = db.prog || {};
  const days = db.days = db.days || {};
  let added = 0, skippedNoDate = 0;
  for (const code of Object.keys(rowsByCode || {})) {
    const ent = rowsByCode[code] || {};
    const rows = Array.isArray(ent.rows) ? ent.rows : (Array.isArray(ent) ? ent : null);
    if (!rows || rows.length < 6) continue;
    if (!rows[rows.length - 1] || !rows[rows.length - 1].date) { skippedNoDate++; continue; }
    let from = 0;
    const last = prog[code];
    if (last) {
      const at = rows.findIndex(r => (r.date || '') > last);
      if (at < 0) continue;
      from = at;
    }
    const end = rows.length - 2;              // 最后一根没有次日标签，留给下次
    let counted = 0;
    for (let i = Math.max(1, from); i <= end; i++) {
      const entOpt = { limitPct: ent.limitPct, thr, code, name: ent.name };
      const feat = extractFeatures(rows, i, entOpt);
      if (!feat) continue;
      const label = labelNext(rows, i, thr);      // 次日涨≥3%
      if (label == null) continue;
      const zt = labelZt(rows, i, ent.limitPct, entOpt);  // 次日封板（用户要的就是这个）
      countSample(db, feat, label, zt);
      counted++;
      if (rows[i].date) days[rows[i].date] = (days[rows[i].date] || 0) + 1;
    }
    added += counted;
    if (end >= 0 && rows[end] && rows[end].date) prog[code] = rows[end].date;
  }
  save(db);
  return {
    added, total: db.n, base: db.base, baseZt: db.baseZt, buckets: db.buckets, skippedNoDate,
    rules: (db.rules && db.rules.up3 && db.rules.up3.single) ? db.rules.up3.single.length : 0,
    rulesZt: (db.rules && db.rules.zt && db.rules.zt.single) ? db.rules.zt.single.length : 0
  };
}
// 兼容旧调用：单只票抽样本（不再入库，纯粹做分析/测试用）
function ingestKline(rows, opt) {
  const out = [];
  if (!Array.isArray(rows) || rows.length < 6) return out;
  for (let i = 1; i < rows.length - 1; i++) {
    const feat = extractFeatures(rows, i, opt);
    if (!feat) continue;
    const label = labelNext(rows, i, opt && opt.thr);
    if (label == null) continue;
    out.push({ code: opt && opt.code, date: rows[i].date || '', feat, label, bucket: bucketOf(feat, opt) });
  }
  return out;
}

module.exports = {
  extractFeatures, labelNext, labelZt, bucketOf, computeBuckets, predict, predictML, mineRules,
  ingestKline, ingestAll, countSample, hitRate, featHealth, load, save, prune, freshDb, binIdx, binTxt,
  closePos, gapToHigh, ampN, cumReturn, ztCount,
  DIMS, TARGETS, TARGET_NAME, VER, LABEL_THR, MAX_SAMPLES, FILE
};
