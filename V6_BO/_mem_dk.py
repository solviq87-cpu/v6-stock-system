# dk 轮：写记忆（两个工作区；顺带压缩 §9 早期条目控制体积）
import io, os

LOG = u'''
## dk 轮（2026-10-07，已发布 20261007dk）：同一个「失败」在系统里到底有几种说法

**侦察**（`_scan_dk.js`）：失败出口的写法统计 ——
`return null` 43 处 / `return {ok:false}` 23 处 / `return []` 8 处 / `return false` 45 处 /
`console.error` 114 处 / **空 catch 174 处** / `pushLog('❌')` 12 处 / `throw` 10 处。

**核心病（不对称）**：同一个「这一轮没跑成」，
- 涨停前形态 `_zpProg` / 全市场趋势扫描 `_tsProg` / K线回填 `_kbfProg` **三个任务有本轮状态**
  （cu 轮「只在 happy path 上定义过的状态」修的），面板显示"本轮没跑成"；
- 而 **大单流入 / 启动前埋伏 / 相似跟随 / 连续收涨 / 学习入库** 一个都没有 ——
  失败时只 `console.error` 或干脆空 catch，面板**照样显示上一次成功的数据，看起来刚跑完**。

⛔ 这正是记忆第 25 条「同一条原则要在所有同类位置上一块儿落实，只落一半等于没落」的又一次实证：
cu 轮在 ztpre 一处修好了，没推广到其它五个扫描任务。

**修法**：
1. `FAIL_RULE` 登记表：按场景规定"该用哪种说法" ——
   task→state（周期任务必须写本轮状态）／fetch→null（取数失败返回 null，不许空 catch 静默）／
   persist→log（落盘失败必须打日志+撤回内存改动）／async→push（异步重活失败要 pushLog('❌')）／
   bypass→silent（**只有**纯装饰性旁路允许静默，且必须显式登记在这一类）。
2. `TASK_RULE` 登记 9 个周期任务 + `taskSet` 唯一出口 + `taskState()` 下发面板。
   ⛔ 三态：`ok=null`（没跑过）／`true`（成功）／`false`（跑砸且带原因）——
   **没跑 与 跑砸 必须可区分**，否则"没跑过"会被当成"跑砸了"误报。
   未登记的任务名调 taskSet → 拒绝写入并 console.error（不许悄悄建野状态）。
3. 给大单/埋伏/相似/连续收涨四个入口补成功+失败状态；原有 `_zpProg`/`_tsProg`/`_kbfProg`
   并入统一出口（转发一份给 taskSet），面板「🩺 各模块本轮状态」一处看全，失败原因挂 title。

**踩坑**：反证断言第一版写成 `try { throw } finally {}` —— finally 不捕获异常，
异常直接穿出去把整个套件崩了（不是变红）。改成外面再包一层 catch 才看得到"有没有留痕"。

**结果**：守门 `_test_fail.js` **61 断言 / 0 失败**；全量回归 **4189 / 0（134 套件）**，
`routes_smoke` 真起服务通过（`taskSet` 定义在后方、被前方函数调用，靠函数声明提升，无 TDZ）；
线上 appVer=20261007dk、taskState 9 个任务（4 个已跑 ok / 5 个未跑，三态生效）、
持仓带 token **0 条**、双端同步 18ms。
'''

for base in [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory",
]:
    p = os.path.join(base, "2026-10-07.md")
    s = io.open(p, encoding="utf-8").read()
    if "## dk 轮（2026-10-07" in s:
        print("已写过:", p); continue
    if not s.endswith("\n"):
        s += "\n"
    io.open(p, "w", encoding="utf-8", newline="").write(s + LOG)
    print("日志追加:", p)

NEW5 = u'''- **⛔ 「失败」的说法必须按场景统一（dk）**：同一个「这一轮没跑成」曾有 5 种说法（写 {ok:false}／return null／console.error 后继续／pushLog('❌')／**174 处空 catch 静默**）。登记进 `FAIL_RULE`（task→state／fetch→null／persist→log／async→push／bypass→silent，⛔ **只有**纯装饰性旁路允许静默且必须显式登记）；周期任务登记进 `TASK_RULE`，一律走 `taskSet` 唯一出口 + `taskState()` 下发面板。⛔ 三态：`ok=null`（没跑过）／`true`／`false`（带原因）—— 没跑与跑砸必须可区分。
'''

NEW9 = u'''- **dk（最新·已发布 20261007dk）同一个「失败」在系统里有几种说法**：实测 5 种（{ok:false}／null／console.error 后继续／pushLog❌／174 处空 catch）。不对称的实证：ztpre／趋势扫描／K线回填三个任务早有本轮状态（cu 轮修的），而**大单／埋伏／相似／连续收涨／学习入库一个都没有** → 失败时面板照样显示上一次成功的数据，看起来刚跑完。修法见 §5 `FAIL_RULE` + `taskSet`（三态 ok=null/true/false）。守门 `_test_fail.js`(61)、扫描器 `_scan_dk.js`。
- **下一轮建议角度**：同一个「成功」在系统里有几种说法 —— 与 dk 对称的另一半：有的"成功"是**真产出**（N 只，n>0），有的是**成功但 0 只**（数据源限流、池子空、被闸门全拦），有的"成功"只是**没抛异常**。面板/日志/推送里一律写「完成 ✅」，用户看到"完成"却什么都没有，分不清"今天就没符合条件的票"和"数据源挂了所以 0 只"。
'''

NEW10 = u'''28. **看到"这一轮失败了"要先问：这个失败在系统里留下了什么痕迹？** —— 只打日志（或空 catch）的失败，面板会继续显示上一次成功的数据，看起来刚跑完；用户与排障都无从下手。周期任务必须有"本轮状态"三态：没跑 / 成功 / 失败（带原因）。
'''

# §9 早期条目压缩（结论已沉淀进 §5，流水里只留指针）
COMPACT = {
    u"- **dh（最新·20261007dh）同一个「数据没取到」在系统里必须有同一个口径**":
        u"- **dh（20261007dh）同一个「数据没取到」必须同一口径**：六种兜底互不相同（0.7／0.85／50／0／-1／**闸门放行**），后两条相邻两行语义相反；而胜率门是硬闸门，L3203 自己写着「判不出来」≠「判了通过」—— 同一条原则八字闸门落实了、胜率门没落实。修法见 §5 `MISS_RULE`。守门 `_test_missing.js`(63)。",
    u"- **dg（最新·20261007dg）同一个键的默认值在不同入口下是不是同一个**":
        u"- **dg（20261007dg）同一个键的默认值在不同入口下是不是同一个**：默认值散在三种写法（第二参数 23 处／初始对象 0.80／`||` 兜底），「没配过」是三个值 0.80/0.82/null；回滚段引用后方 `_govCfg` → 抛错被 catch 吞 → **回滚从未生效**。修法见 §5 `CFG_RANGE`。守门 `_test_cfgdef.js`(103)。",
}

for base in [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory",
]:
    p = os.path.join(base, "MEMORY.md")
    s = io.open(p, encoding="utf-8").read()
    orig = s
    lines = s.split("\n")
    for i, l in enumerate(lines):
        for pref, new in COMPACT.items():
            if l.startswith(pref):
                lines[i] = new
    s = "\n".join(lines)
    s = s.replace(u"- **锁要对称**：", NEW5 + u"- **锁要对称**：", 1)
    marker = u"- **下一轮建议角度**：同一个「失败」在系统里到底有几种说法"
    i = s.find(marker)
    if i < 0:
        print("  !! §9 锚点缺失"); continue
    j = s.find("\n", i)
    s = s[:i] + NEW9 + s[j + 1:]
    s = s.rstrip() + "\n" + NEW10
    io.open(p, "w", encoding="utf-8", newline="").write(s)
    print("MEMORY.md: %s  字符 %d -> %d  CR=%d" % (p, len(orig), len(s), s.count("\r")))
