# -*- coding: utf-8 -*-
# dv 轮改码①：SKIP_RULE 登记表 + empTable 分母留痕 + paperBuy 未买入原因
import io

P = "server.js"
src = io.open(P, "r", encoding="utf-8").read()
steps = []

def rep(old, new, want=1):
    global src
    n = src.count(old)
    if n != want:
        steps.append("FAIL(%d!=%d) %s" % (n, want, old[:70].replace("\n", "\\n")))
        return False
    src = src.replace(old, new, want)
    steps.append("OK  %s" % (old[:70].replace("\n", "\\n")))
    return True

# ---------- ① 跳过原因登记表 ----------
SKIP_FN = u"""// ⛔⛔ 跳过原因登记表（dv 轮：静默跳过必须留下为什么）
//    全项目 160 处 continue，其中 145 处跳过时**既不计数也不留痕** —— 调用方拿到的结果
//    少了东西，却没有任何地方说少了多少、为什么少。实证（本机真实样本库）：
//    S.learn.signals 共 1959 条，真正进得了实测命中率档的只有 368 条（18.8%）——
//    缺次日口径 737、缺概率 242、历史回测 600、事后 12；而 histzt / pool / trend / zt
//    四类共 1051 条**整类零存活**，面板上这些类型的实测栏永远是空的，
//    谁也分不清那是"还没回验"还是"按设计被排除"。
//    ⛔ 只登记**会影响结论**的跳过（进不了分母、进不了候选池）；纯遍历中的正常 continue 不必登记。
//    ⛔ 未登记的 kind 会被 skipAdd 直接丢弃 —— 逼着新增跳过点时先来这里写清楚原因。
const SKIP_RULE = {
  empNoNd: '缺次日回验口径（sig.nd）',
  empVoid: '样本已作废',
  empNoProb: '缺原始概率',
  empBacktest: '历史回测样本（事后倒推，按设计不进实测标定）',
  empPostHoc: '事后样本（登记时已封板 / zt / review）',
  buyHeld: '已持有（同票不重复买）',
  buyNoPrice: '取不到有效价',
  buySealed: '已封涨停（一字板买不进）',
  buyNoCash: '现金不足一手',
  buyOverCash: '现金不足（含手续费）',
  ztNoCache: 'K线缓存读取失败',
  ztNoKline: 'K线不足 40 根',
  ztJunk: 'ST／退市／次新等名称过滤',
  ztCheap: '股价低于 2 元',
  ztSealed: '已封板（追不进去）',
  ztLianban: '4 连板以上不推',
  ztNoFeat: '形态特征不足',
  ztNoPred: '模型无输出',
  trNoCache: 'K线缓存读取失败',
  trNoKline: 'K线不足 25 根',
  trJunk: 'ST／退市名称过滤',
  trCheap: '股价低于 2 元',
  trSealed: '已封板（追不进去）',
  trLianban: '4 连板以上不推',
  trHyg: '流通市值不足 50 亿 / 20 日内上蹿下跳',
  trNoFeat: '形态特征不足',
  trNoPred: '模型无输出'
};
const _skipTally = { n: 0, by: {}, at: 0 };
function skipAdd(kind, n) {
  const k = String(kind || '');
  if (!SKIP_RULE[k]) return 0;                 // ⛔ 未登记的跳过原因不许悄悄混进来
  const add = Number.isFinite(Number(n)) ? Math.max(1, Math.round(Number(n))) : 1;
  _skipTally.n += add;
  _skipTally.by[k] = (_skipTally.by[k] || 0) + add;
  _skipTally.at = Date.now();
  return add;
}
function skipWhy(kind) { return SKIP_RULE[String(kind || '')] || String(kind || ''); }
// ⛔ 「跳过了 1591 条」没有意义，「回测 600 / 缺口径 737 / 缺概率 242」才有 —— 交出去必须带原因
function skipTop(m) {
  const lim = Number.isFinite(Number(m)) ? Math.max(1, Number(m)) : 8;
  return Object.keys(_skipTally.by).map(k => ({ kind: k, label: skipWhy(k), n: _skipTally.by[k] }))
    .sort((a, b) => b.n - a.n).slice(0, lim);
}
function skipState() { return { total: _skipTally.n, top: skipTop(8), at: _skipTally.at }; }
let _empSkip = { scanned: 0, live: 0, by: {} };
function empSkipStat() {
  const s = _empSkip || {};
  const by = Object.keys(s.by || {}).map(k => ({ kind: k, label: skipWhy(k), n: s.by[k] })).sort((a, b) => b.n - a.n);
  const sc = Number(s.scanned) || 0, lv = Number(s.live) || 0;
  return { scanned: sc, live: lv, by,
    note: '样本库 ' + sc + ' 条 → 进档 ' + lv + ' 条（存活 ' + (sc ? Math.round(lv / sc * 100) : 0) + '%）' };
}
let _empCache = { t: 0, map: {}, done: false };"""

rep(u"let _empCache = { t: 0, map: {}, done: false };", SKIP_FN)

# ---------- ② empTable：跳过按原因分类计数 ----------
rep(u"""  const m = {};
  const bump = (k, s) => {""",
u"""  const m = {};
  // ⛔ dv 轮：命中率的分母必须说清楚是谁。以前这两个 continue 静默跳过，
  //    面板上「55 档实测 60%（n=30）」的 n 是跳完之后剩下的，而样本库另外 1591 条去哪了没人知道。
  const sk = { scanned: 0, live: 0, by: {} };
  const bumpSkip = kk => { sk.by[kk] = (sk.by[kk] || 0) + 1; skipAdd(kk); };
  const bump = (k, s) => {""")

rep(u"""  for (const s of (S.learn.signals || [])) {
    // ⚠️ 只认次日口径（sig.nd）："当日"回验混进来会污染预测力，详见 resolveNextDay 注释
    if (!s.nd || s.void || s.prob == null || !isFinite(s.prob)) continue;
    // ⛔ 事后样本（历史回测倒推 / 已涨停后登记）不得进实测标定 —— 见 isLiveSample 注释。
    //    漏了这一句，未启动类 55~74 档会被虚高 31~44 个点，直接把推送闸门放宽。
    if (!isLiveSample(s)) continue;
    const b = empBucketOf(s.prob);""",
u"""  for (const s of (S.learn.signals || [])) {
    sk.scanned++;
    // ⚠️ 只认次日口径（sig.nd）："当日"回验混进来会污染预测力，详见 resolveNextDay 注释
    if (!s.nd) { bumpSkip('empNoNd'); continue; }
    if (s.void) { bumpSkip('empVoid'); continue; }
    if (s.prob == null || !isFinite(s.prob)) { bumpSkip('empNoProb'); continue; }
    // ⛔ 事后样本（历史回测倒推 / 已涨停后登记）不得进实测标定 —— 见 isLiveSample 注释。
    //    漏了这一句，未启动类 55~74 档会被虚高 31~44 个点，直接把推送闸门放宽。
    //    拆成两条分别计数：isLiveSample 只返回 true/false，看不出到底是哪一类被排除了。
    if (isBacktestSample(s)) { bumpSkip('empBacktest'); continue; }
    if (isPostHocSample(s)) { bumpSkip('empPostHoc'); continue; }
    sk.live++;
    const b = empBucketOf(s.prob);""")

rep(u"""  _empCache = { t: now, map: m, done: true };
  return m;""",
u"""  _empCache = { t: now, map: m, done: true };
  _empSkip = sk;
  return m;""")

# ---------- ③ paperBuy：没买入要说为什么 ----------
rep(u"""    if (Object.keys(acc.positions).length >= cfg.maxPos) break;
    if (acc.positions[c.code]) continue;
    const price = (pm && pm.get(c.code)) || c.price;
    if (!price || price <= 0) continue;""",
u"""    if (Object.keys(acc.positions).length >= cfg.maxPos) { skipAdd('buyHeld'); break; }
    // ⛔ dv 轮：这几处 continue 以前完全静默 —— 面板只显示"暂无持仓（等待新信号）"，
    //    而真实原因可能是"5 只候选全因一字板买不进"或"现金不足一手"，用户根本无从自查。
    if (acc.positions[c.code]) { skipAdd('buyHeld'); continue; }
    const price = (pm && pm.get(c.code)) || c.price;
    if (!price || price <= 0) { skipAdd('buyNoPrice'); continue; }""")

rep(u"    if (sealedUp) continue;",
    u"    if (sealedUp) { skipAdd('buySealed'); continue; }")

rep(u"    if (shares < 100) continue; // 资金不足一手，跳过",
    u"    if (shares < 100) { skipAdd('buyNoCash'); continue; } // 资金不足一手，跳过")

rep(u"    if (cost + fee > acc.cash) continue;     // 兜底：任何情况下都不许把现金买成负数",
    u"    if (cost + fee > acc.cash) { skipAdd('buyOverCash'); continue; }     // 兜底：任何情况下都不许把现金买成负数")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))
