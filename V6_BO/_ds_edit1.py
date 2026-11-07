# -*- coding: utf-8 -*-
# ds 轮：样本库里 `prob` 混装「概率 / 评分」→ 登记 PROB_KIND，评分类走自己的档。
# ⛔ 每步单独落盘（中途 FAIL 会让整份不写盘，dn/dr 都踩过）；失败收集到最后报告。
import io

errs = []
def sub(path, old, new, want=1, enc="utf-8"):
    with io.open(path, "r", encoding=enc, newline="") as f:
        s = f.read()
    n = s.count(old)
    if n != want:
        errs.append("%s: 期望 %d 实到 %d :: %s" % (path, want, n, old[:60]))
        return False
    s = s.replace(old, new)
    with io.open(path, "w", encoding=enc, newline="") as f:
        f.write(s)
    print("  ✓ x%d :: %s" % (n, old[:56]))
    return True

print("① PROB_KIND 登记表 + probKindOf 唯一出口")
sub("server.js", "const empBucketOf = p =>", """// ─── 样本库里 `prob` 装的是不是概率（2026-10-07 ds 轮）────────────────────────
// ⛔ cs 轮把「精选池评分 / 趋势分」接进 logSignal 的第 5 个参数（prob），血缘是接上了，
//    但**接进去的不是同一个东西** —— 而下游有三处按「概率」解释这个字段：
//      · empTable 按 prob 分档 → 评分（集中在 55~80）混进概率档（集中在 20~65）
//      · S.learn.buckets → 同一个桶里既数概率又数评分 → corr 校准系数被拉歪
//      · govFilter.probAt → 评分与概率共用 pushMinProb 这一道 55 门槛
//    「技术评分 70 分」与「涨停概率 70%」完全是两回事：前者是技术面还行，后者是很看好的票。
//    混档之后那个"实测命中率"既不能证明概率准、也不能证明评分灵。
//    ⛔ 判据：**给一个量登记它是什么；不同刻度的数不许进同一个档。**
const PROB_KIND = {
  pool:  { kind: 'score', label: '精选池技术评分', why: 'scoreStock 的技术评分（0~100），不是涨停概率' },
  trend: { kind: 'score', label: '趋势票趋势分',   why: 'trendScore（0~100），分布与概率不同，不能同档统计' }
};
function probKindOf(type) { const d = PROB_KIND[type]; return d ? d.kind : 'prob'; }
function probKindLabel(type) { const d = PROB_KIND[type]; return d ? d.label : '模型概率'; }
// 实测档的键：概率类与评分类各一套（键结构兼容旧表，评分类另起前缀）
function empKeysOf(prob, type) {
  const b = empBucketOf(prob), g = empGroupOf(type);
  return probKindOf(type) === 'prob' ? [g + '|' + b, '全部|' + b] : ['评分:' + g + '|' + b, '评分|' + b];
}
const empBucketOf = p =>""", 1)

print("② empTable：评分类走自己的档，不进概率档")
sub("server.js", """    const b = empBucketOf(s.prob);
    bump(empGroupOf(s.type) + '|' + b, s);
    bump('全部|' + b, s);
  }""", """    const b = empBucketOf(s.prob);
    // ⛔ 评分类样本走自己的档（ds 轮）：它那个数不是概率，混进概率档会把校准系数拉歪
    const ks = empKeysOf(s.prob, s.type);
    bump(ks[0], s);
    bump(ks[1], s);
  }""", 1)

print("③ empProb / empInfo 按刻度查档")
sub("server.js", """  const b = empBucketOf(prob);
  const g = empGroupOf(type);
  // 族群自己的档证据不足时，回落到"全部|同档"——全局样本更大，往往够格。
  // （追高类是新功能，跨日天然少；全部档往往已经积累够了。）
  const own = t[g + '|' + b];
  const all = t['全部|' + b];""", """  const ks = empKeysOf(prob, type);
  // 族群自己的档证据不足时，回落到"全部|同档"——全局样本更大，往往够格。
  // （追高类是新功能，跨日天然少；全部档往往已经积累够了。）
  // ⛔ 评分类查的是「评分:」那套档，不会去拿概率档的数（ds 轮）。
  const own = t[ks[0]];
  const all = t[ks[1]];""", 1)

sub("server.js", """  const t = empTable();
  const b = empBucketOf(prob), g = empGroupOf(type);
  const own = t[g + '|' + b], all = t['全部|' + b];""", """  const t = empTable();
  const ks = empKeysOf(prob, type);
  const own = t[ks[0]], all = t[ks[1]];""", 1)

print("④ S.learn.buckets：概率校准桶只数概率样本")
sub("server.js", """  for (const s of res) {
    if (s.prob == null) continue;
    const b = s.prob >= 90 ? '90+'""", """  for (const s of res) {
    if (s.prob == null) continue;
    // ⛔ 评分类不进概率校准桶（ds 轮）：corr 是拿去乘【概率】的，桶里混进评分会把它算歪
    if (probKindOf(s.type) !== 'prob') continue;
    const b = s.prob >= 90 ? '90+'""", 1)

print("⑤ logSignal 留痕 probKind")
sub("server.js", """  S.learn.signals.push({
    date: todayStr(), ts: Date.now(), type, code, name, price,
    prob: _p,""", """  S.learn.signals.push({
    date: todayStr(), ts: Date.now(), type, code, name, price,
    prob: _p, probKind: probKindOf(type),""", 1)

sub("server.js", """      if (_p != null) _old.prob = _p;""", """      if (_p != null) { _old.prob = _p; _old.probKind = probKindOf(type); }""", 1)

print("⑥ 出口 probKindState 供面板/接口查看")
sub("server.js", """function stateCut() {""", """// 刻度分流的结果要看得见（⛔ 只在日志里说等于没说）：谁走概率档、谁走评分档、各多少条
function probKindState() {
  const n = { prob: 0, score: 0 };
  for (const s of (S.learn.signals || [])) {
    if (s.prob == null) continue;
    const k = (s.probKind === 'score' || s.probKind === 'prob') ? s.probKind : probKindOf(s.type);
    n[k] = (n[k] || 0) + 1;
  }
  return {
    kinds: Object.keys(PROB_KIND).map(k => ({ type: k, label: PROB_KIND[k].label, kind: PROB_KIND[k].kind, why: PROB_KIND[k].why })),
    sampleN: n,
    note: '样本库里 pool/trend 装的是评分不是概率，两套刻度分开统计（混档会把校准系数算歪）'
  };
}
function stateCut() {""", 1)

print()
if errs:
    print("❌ 失败 %d 项：" % len(errs))
    for e in errs:
        print("   " + e)
else:
    print("✅ 全部成功")
