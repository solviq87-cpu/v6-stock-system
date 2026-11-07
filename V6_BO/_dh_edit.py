# -*- coding: utf-8 -*-
"""dh 轮：同一个「数据没取到」，在系统里必须有同一个口径"""
import io, re

P = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\server.js"
src = io.open(P, encoding='utf-8').read()


def rep(a, b, tag):
    global src
    assert a in src, '找不到（%s）：%s' % (tag, a[:70])
    src = src.replace(a, b, 1)
    print('✓ ' + tag)


# ── E1 「没取到」口径登记表（插在 cfgRangeState 之后、回滚段之前）────────────
ANCHOR = u"let _rollbackMsg = null;"
TABLE = u"""// ── 「数据没取到」的口径登记表（2026-10-07 dh 轮新增 · 本轮角度）────────────────
// 全项目到处都在"数据没取到就给个兜底"，但这些兜底**不是同一件事**，以前各写各的：
//   · 大单缺 K 线 → 位置权重 0.7（轻微打折，不判死）
//   · 板块冷热取不到 → 0.85（按冷门）
//   · 实证档取不到 → 50（按 50% 命中率的中性假设）
//   · 流通市值取不到 → 0（调用方不拦）
//   · 排序时取不到质量分 → -1（按最差，排最末）
//   · 胜率闸门取不到质量分 → **undefined → 整条跳过 = 默许放行**
// 最后两条是**相邻两行、语义完全相反**的同一个"取不到分"：排序按最差、闸门按通过。
// 而 L3203 自己写着的既定原则是：「判不出来」≠「判了通过」…… 缺数据不判死只适用于
// **打分权重**，从来不适用于**一票否决的硬闸门** —— 胜率门恰恰是最硬的那道闸门。
// 现在登记进表：新增场景必须声明自己是四类里的哪一类，读取走 missingOf(k) / missKind(k)。
//   weight = 打分权重（给中性值，不判死）  worst = 排序比较（按最差）
//   block  = 硬闸门（判不出 = 不放行，且必须说出来）  clear = 对外陈述（明写"未判定"）
const MISS_RULE = {
  bmCtxWeight:   { kind: 'weight', value: 0.7,  note: '大单缺K线 → 位置权重按中性 0.7，绝不因为缺K线把票判死' },
  sectorHeat:    { kind: 'weight', value: 0.85, note: '板块冷热取不到 → 按冷门 0.85' },
  empBucketRate: { kind: 'weight', value: 50,   note: '实证档取不到 → 按 50% 命中率的中性假设（不是 0，也不是放行）' },
  floatCap:      { kind: 'weight', value: 0,    note: '流通市值取不到 → 返回 0，调用方按「缺数据不拦」处理' },
  govSort:       { kind: 'worst',  value: -1,   note: '排序时取不到质量分 → 排最末（按最差处理）' },
  govGate:       { kind: 'block',  value: null, note: '⛔ 胜率闸门取不到质量分 → 不放行（判不出 ≠ 通过），且必须计数说出来' },
  bmPosition:    { kind: 'clear',  value: null, note: '位置未判定 → 不进涨停候选，文案明写「位置未判定（缺K线）」' },
  baziStage:     { kind: 'clear',  value: null, note: '八字未算出 → 单独标 baziMiss，日志与卡片如实说"未做闸门判定"' },
  baziDim:       { kind: 'clear',  value: null, note: '八字四维数据不足 → 一律打「—」，不许用 50 冒充判出来的分' },
  r20:           { kind: 'clear',  value: null, note: '20日涨幅取不到 → 文案写「中期数据不足」' }
};
const missingOf = k => { const d = MISS_RULE[k]; return d ? d.value : null; };
const missKind = k => { const d = MISS_RULE[k]; return d ? d.kind : ''; };
// ⛔ 确实没有质量分、因而无法过胜率门的推送类型 —— 必须**显式登记**才放行，
//    登记时要写清「用什么代替这道闸门」，否则等于给某个模块发一张永久免检牌。
//    （dh 轮实测：现有 7 个 govFilter 调用点的 items 全都带质量分 ——
//     精选池 score / 大单 prob / 趋势 trendScore / 板块 prob / 相似 prob / B 组 empOf(50)，
//     所以这条新闸门今天一个都不误伤；它挡的是"以后新接的池子整池绕过胜率门"。）
const NO_SCORE_TYPES = new Set([
  /* 目前为空：任何一个类型要进来，都必须在注释里写清它凭什么不用过胜率门 */
]);
"""
rep(ANCHOR, TABLE + ANCHOR, 'E1 MISS_RULE 表')

# ── E2 流通市值兜底 ────────────────────────────────────────────────────────
rep(u"  return _capIdx.get(String(code)) || 0;",
    u"  return _capIdx.get(String(code)) || missingOf('floatCap');", 'E2 floatCap')

# ── E3 大单位置权重中性值 ──────────────────────────────────────────────────
rep(u"    const w = (x.ctx && x.ctx.weight != null) ? x.ctx.weight : 0.7;   // 缺 K 线 → 中性",
    u"    const w = (x.ctx && x.ctx.weight != null) ? x.ctx.weight : missingOf('bmCtxWeight');   // 缺 K 线 → 中性（口径登记在 MISS_RULE）",
    'E3 bmCtxWeight')

# ── E4 板块冷热兜底 ────────────────────────────────────────────────────────
rep(u"    const h = x.heat ? (x.heat.hot ? 1.15 : 0.85) : 0.85;",
    u"    const h = x.heat ? (x.heat.hot ? 1.15 : 0.85) : missingOf('sectorHeat');",
    'E4 sectorHeat')

# ── E5 实证档兜底 ──────────────────────────────────────────────────────────
rep(u"  const empOf = x => { const b = emp[bmBucket(x.prob || 0)]; return (b && b.rate != null) ? b.rate : 50; };",
    u"  const empOf = x => { const b = emp[bmBucket(x.prob || 0)]; return (b && b.rate != null) ? b.rate : missingOf('empBucketRate'); };",
    'E5 empBucketRate')

# ── E6 排序侧中性值 ────────────────────────────────────────────────────────
rep(u"      if (!Number.isFinite(v)) return -1;",
    u"      if (!Number.isFinite(v)) return missingOf('govSort');   // 取不到分 → 按最差排最末（与闸门侧同语义）",
    'E6 govSort')

# ── E7 闸门侧：取不到分 ≠ 通过 ─────────────────────────────────────────────
A7 = u"""  let drop = 0, lowProb = 0;
  for (const x of list) {
    const code = codeAt(x);
    const strong = strongOf ? !!strongOf(x) : false;
    const res = govTake(code, type, strong, probAt(x));"""
B7 = u"""  let drop = 0, lowProb = 0, noScore = 0;
  for (const x of list) {
    const code = codeAt(x);
    const strong = strongOf ? !!strongOf(x) : false;
    // ⛔⛔ dh 轮（本轮角度：同一个「数据没取到」在系统里是不是同一个口径）：
    //    排序侧 `_p` 遇到取不到质量分是 `return -1`（按最差处理），而 govTake 里
    //    `prob != null && …` 在 prob 为 undefined 时**整条跳过 = 默许放行** ——
    //    同一个"取不到分"，相邻两行两个完全相反的语义。
    //    胜率门是**一票否决的硬闸门**，不是打分权重：L3203 自己写着的既定原则是
    //    「判不出来」≠「判了通过」，缺数据不判死只适用于打分权重、不适用于硬闸门。
    //    现在统一：判得出的照判；判不出的按 MISS_RULE.govGate = block **拦下并如实计数**；
    //    确实没有质量分的类型必须显式登记进 NO_SCORE_TYPES 才放行（且要写清凭什么）。
    if (probAt(x) === undefined && !NO_SCORE_TYPES.has(type)) {
      noScore++; drop++;
      console.log(`[gov] ⚠️ ${type}: ${code} 取不到质量分（prob/riseProb/score/trendScore 都没有）→ 判不出 ≠ 通过，本条拦下` +
        `（若这个类型本就没有质量分，请登记进 NO_SCORE_TYPES 并写明替代判据）`);
      continue;
    }
    const res = govTake(code, type, strong, probAt(x));"""
rep(A7, B7, 'E7 闸门侧')

# ── E8 收尾计数与日志 ──────────────────────────────────────────────────────
A8 = u"""  if (drop) {
    PUSH_GOV.dropped += drop;
    console.log(`[gov] ${type}: ${keep.length} 通过 / ${drop} 条被拦（其中 ${lowProb} 条因预估胜率不足；今日已推 ${PUSH_GOV.total} 条）`);
  }"""
B8 = u"""  if (drop) {
    PUSH_GOV.dropped += drop;
    if (noScore) PUSH_GOV.noScore = (+PUSH_GOV.noScore || 0) + noScore;
    console.log(`[gov] ${type}: ${keep.length} 通过 / ${drop} 条被拦（其中 ${lowProb} 条因预估胜率不足${noScore ? `、${noScore} 条因取不到质量分` : ''}；今日已推 ${PUSH_GOV.total} 条）`);
  }"""
rep(A8, B8, 'E8 收尾日志')

# ── E9 PUSH_GOV 初始化与日重置 ─────────────────────────────────────────────
rep(u"const PUSH_GOV = { day: '', codes: new Map(), total: 0, dropped: 0, lowProb: 0 };",
    u"const PUSH_GOV = { day: '', codes: new Map(), total: 0, dropped: 0, lowProb: 0, noScore: 0 };",
    'E9a PUSH_GOV 初始化')
rep(u"    PUSH_GOV.day = d; PUSH_GOV.codes = new Map(); PUSH_GOV.total = 0; PUSH_GOV.dropped = 0; PUSH_GOV.lowProb = 0;",
    u"    PUSH_GOV.day = d; PUSH_GOV.codes = new Map(); PUSH_GOV.total = 0; PUSH_GOV.dropped = 0; PUSH_GOV.lowProb = 0; PUSH_GOV.noScore = 0;",
    'E9b 日重置')

# ── E10 pushGovBlocked 三类分开（不许互相包含）──────────────────────────────
A10 = u"""function pushGovBlocked() {
  const dropped = Math.max(0, +PUSH_GOV.dropped || 0);
  const lowProb = Math.min(Math.max(0, +PUSH_GOV.lowProb || 0), dropped);
  return { dropped, lowProb, throttled: Math.max(0, dropped - lowProb) };
}"""
B10 = u"""function pushGovBlocked() {
  const dropped = Math.max(0, +PUSH_GOV.dropped || 0);
  const lowProb = Math.min(Math.max(0, +PUSH_GOV.lowProb || 0), dropped);
  // ⛔ 三类互不包含（dc 轮：一句话里两个数量词不许互相包含）——
  //    noScore 是新加的第三类（取不到质量分被拦），不许被算进 throttled 里冒充"重复/冷却"。
  const noScore = Math.min(Math.max(0, +PUSH_GOV.noScore || 0), Math.max(0, dropped - lowProb));
  return { dropped, lowProb, noScore, throttled: Math.max(0, dropped - lowProb - noScore) };
}"""
rep(A10, B10, 'E10 pushGovBlocked')

# ── E11 脚注带上第三类 ─────────────────────────────────────────────────────
A11 = u"""    _bl.lowProb ? `${_bl.lowProb} 条因预估胜率不足被挡，` : ''}${_bl.throttled ? `${_bl.throttled} 条重复/冷却样本被节流，` : ''}完整榜单见面板）`"""
B11 = u"""    _bl.lowProb ? `${_bl.lowProb} 条因预估胜率不足被挡，` : ''}${_bl.noScore ? `${_bl.noScore} 条因取不到质量分被挡，` : ''}${_bl.throttled ? `${_bl.throttled} 条重复/冷却样本被节流，` : ''}完整榜单见面板）`"""
rep(A11, B11, 'E11 脚注')

io.open(P, 'w', encoding='utf-8', newline='\n').write(src)
print('写入完成：', src.count('\n') + 1, '行')
