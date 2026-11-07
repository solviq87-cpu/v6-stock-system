# -*- coding: utf-8 -*-
# du 轮改码②：推送流水上限常量化 + 「今天已发」判据感知证据是否被裁
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

# ---------- ① pushlog 三处写死 500 → 走登记 ----------
rep(u"    if (PUSH_LOG.length > 500) PUSH_LOG.length = 500;",
    u"    // ⛔ du 轮：上限走登记（这份流水是「今天已发」唯一的落盘证据，容量变了必须一处生效）\n    if (PUSH_LOG.length > dataCapOf('pushLog')) PUSH_LOG.length = dataCapOf('pushLog');")

rep(u"  atomicWrite(PUSH_LOG_FILE, JSON.stringify(PUSH_LOG.slice(0, 500)));",
    u"  atomicWrite(PUSH_LOG_FILE, JSON.stringify(PUSH_LOG.slice(0, dataCapOf('pushLog'))));")

rep(u"  if (Array.isArray(_loaded)) PUSH_LOG.push(..._loaded.slice(0, 500));",
    u"  if (Array.isArray(_loaded)) PUSH_LOG.push(..._loaded.slice(0, dataCapOf('pushLog')));")

# ---------- ② 「今天已发」判据：证据被裁过必须说出来 ----------
rep(u"""// ⛔ 只认"已送达"：被闸门拦下的那些本来就该重试，绝不能因为留过一条流水就判"发过了"。
function pushedToday(titleRe) {
  try {
    const ds = todayStr();""",
u"""// ⛔ 只认"已送达"：被闸门拦下的那些本来就该重试，绝不能因为留过一条流水就判"发过了"。
// ⛔⛔ du 轮：这条判据查的是 PUSH_LOG，而 PUSH_LOG **有容量上限**（实测已顶到 500/500）。
//    一旦某天推送多到把流水挤满，"今天早些时候发过"的记录就被裁掉了 —— 此时
//    "没找到"不再等于"没发过"，判据会静默失效并重复推送（bt 轮的 11 个闭锁全靠它）。
//    现在先问一句"这份证据够不够覆盖今天一整天"：覆盖不全就留痕告警，让失效看得见。
function pushLogCoversToday() {
  const cap = dataCapOf('pushLog');
  if (!cap || PUSH_LOG.length < cap) return true;   // 没装满 → 今天不可能被裁
  const oldest = PUSH_LOG[PUSH_LOG.length - 1];
  const ts = Number(oldest && oldest.ts) || 0;
  if (!ts) return true;
  return dayKeyOf(ts) !== todayStr();               // 最老一条不是今天 → 今天的记录还全在
}
let _pushLogCapWarnDate = '';
function pushedToday(titleRe) {
  try {
    const ds = todayStr();
    if (!pushLogCoversToday() && _pushLogCapWarnDate !== ds) {
      _pushLogCapWarnDate = ds;
      console.warn('[幂等] ⚠️ 推送流水已满 ' + PUSH_LOG.length + '/' + dataCapOf('pushLog') +
        ' 条，且最老一条就是今天 —— 「今天已发」判据可能查不到更早的记录，有重复推送风险');
    }""")

# ---------- ③ 其它容器上限也走登记（避免同一个数散落多处） ----------
rep(u"  if (S.learnHistory.length > 300) S.learnHistory = S.learnHistory.slice(0, 300);",
    u"  if (S.learnHistory.length > dataCapOf('learnHistory')) S.learnHistory = S.learnHistory.slice(0, dataCapOf('learnHistory'));")

rep(u"    if (S.learn.signals.length > 2000) S.learn.signals = S.learn.signals.slice(-1500);",
    u"    if (S.learn.signals.length > dataCapOf('learnSignals')) S.learn.signals = S.learn.signals.slice(-1500);")

rep(u"      if (S.signals.length > 200) S.signals.pop();",
    u"      if (S.signals.length > dataCapOf('signals')) S.signals.pop();")
rep(u"          if (S.signals.length > 200) S.signals.pop();",
    u"          if (S.signals.length > dataCapOf('signals')) S.signals.pop();")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))
