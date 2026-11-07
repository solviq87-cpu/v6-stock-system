# di 轮：写记忆（两个工作区：日志追加 + MEMORY.md 增补）
import io, os

# ───────── ① 日志追加 ─────────
LOG = u'''
## di 轮（2026-10-07，已发布 20261007di）：「够了 / 达标」在系统里是不是同一把尺子

**侦察**（`_scan_di.js` / `_scan_di2.js`）：
- K 线根数门槛散在 **11 种写法**：5 / 6 / 8 / 12 / 21 / 25 / 30 / 40 / 45 / 60 / 100。
  同一份 K 线在精选池「够」（≥5 根进池）、在涨停前扫描「不足 40 根直接跳过」。
- 一致的部分（顺带确认，不必再查）：learnall 全链路 6 根、ztpre 扫描+入库 40 根、
  趋势 hygiene+扫描 21 根、八字 25 根 —— 这四组各自内部是一致的。
- **真正的靶子是评分本身**：`scoreStock` 入池门槛只要 5 根，而它的分项
  （获利盘 `calcProfitRatio` 要 5 根、90 日涨停基因窗口是 90 根）在短数据下天然残缺
  → 同一个 62 分，A 票是「8 个分项全算过」的 62，B 票是「只算过 4 个分项」的 62，
  两者同池排序、同比那条**评分线 75** —— 量的是两把不同的尺子，且从头到尾没人说。
- 更狠的一层：`backtest` / 学习样本只认 **45 根**，而实盘入池只要 **5 根** →
  评分线是用「45 根以上」那批样本学出来的，却拿去量「5 根」的票。
- 附带抓到：`scoreStock` 无 rows 时 `return { score: 0 }` —— 0 是一个**真实的低分**，
  会参与排序、会去比评分线 = 用「判了，很差」冒充「没判」。
  同一条原则在八字四维（`baziDim` 明写「不许用 50 冒充判出来的分」）早已落实，这里没落实。

**修法**：
1. `NEED_RULE` 登记表（server.js，插在 `MISS_RULE` 之后）：10 把尺子，每键
   `{ n, onLess, note }`；`onLess` 四类 —— skip（跳过不进）／null（返回 null 按没判处理）／
   partial（照算但窗口不足，必须明写）／zero（⛔ 给 0，只许用于「确实很差」）。
   唯一读取口 `needOf` / `needLess`；`needRuleState()` 下发面板。
2. `scoreStock`（analysis.js）随分返回 `basis`：
   `{ rows, avail, missing, partial, zt90Win }` —— avail = 本次真正计入的满分（满 94），
   missing = 数据不足根本没算的项，partial = 算了但窗口不足的项。
   ⛔ 无 K 线时 `score: 0` → **`score: null`**。
3. `scoreNoteOf(score, basis)` 唯一出口，把「几根 K 线、按多少满分算的」如实说给用户；
   精选池 item 带 `basis` + `scoreNote`，前端分数旁标「⚠评分未满项」，
   池标题行补一句「入池≥5 根 K 线（完整评分/学习样本需≥45 根）」。

**踩坑**：
- 守门测试锚点用了注释行 `// ---------- 涨停概率模型` —— 剥注释版里它已被抹成空行，
  `indexOf` 找不到 → 整个套件崩。改用 `function limitUpProbability` 当锚点。
- 全量回归现 1 红：`_test_state_field_parity.js` 【5】「后端算了却没人用的键」—— 我给
  `/api/state` 加了 `needRule` 而前端没读。正确解法是**让前端真的用上**（池标题行显示门槛），
  不是把字段删掉、也不是把判据放宽。

**结果**：守门 `_test_need.js` **85 断言 / 0 失败**；全量回归 **4187 / 0（132 套件）**；
线上 appVer=20261007di、needRule 十把尺子全下发、持仓带 token **0 条**、双端同步 18ms、
台账只剩 FPUB_SYNC02 + 用户 2 台真机。
'''

for base in [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory",
]:
    p = os.path.join(base, "2026-10-07.md")
    s = io.open(p, encoding="utf-8").read()
    if "## di 轮（2026-10-07" in s:
        print("已写过:", p); continue
    if not s.endswith("\n"):
        s += "\n"
    io.open(p, "w", encoding="utf-8", newline="").write(s + LOG)
    print("日志追加:", p)

# ───────── ② MEMORY.md 增补 ─────────
def rep(s, old, new, cnt=1, tag=''):
    if s.count(old) != cnt:
        print("  !! %s 锚点命中 %d 次（应 %d）" % (tag, s.count(old), cnt)); return None
    return s.replace(old, new, cnt)

NEW5 = u'''- **⛔ 「够了 / 达标」的尺子统一登记（di）**：全项目到处在判"够不够"，门槛散在 11 种写法（K线 5/6/8/12/21/25/30/40/45/60/100 根）。登记进 `NEED_RULE`（每键 `{n, onLess, note}`，onLess 四类 skip／null／partial／zero），唯一读取 `needOf`/`needLess`，面板经 `needRuleState()` 下发。⛔ 复合指标（评分/概率/命中率）必须随值返回 `basis`（几根K线、按多少满分算的、哪些项没算），由 `scoreNoteOf()` 如实说出；**无 K 线时 score 是 `null` 不是 `0`** —— 0 是一个真实的低分，会参与排序与达标判定，等于用「判了，很差」冒充「没判」。
'''

NEW9 = u'''- **di（最新·已发布 20261007di）同一个「够了/达标」是不是同一把尺子**：门槛散在 11 种写法（K线 5/6/8/12/21/25/30/40/45/60/100 根）；同一份 K 线在精选池「够」、在涨停前扫描「不足 40 根跳过」。最隐蔽的是评分：入池只要 5 根，而 scoreStock 的分项（获利盘 5 根、90 日涨停基因 90 根）在短数据下天然残缺 —— 同一个 62 分，A 票是「8 项全算过」、B 票是「只算过 4 项」，同池排序同比那条**评分线 75**，量的却是两把尺子且没人说；更狠的是回测/学习只认 45 根，评分线本就是用那批严样本学出来的。修法见 §5 `NEED_RULE` + `basis` + `scoreNoteOf()`。守门 `_test_need.js`(85)、扫描器 `_scan_di.js`/`_scan_di2.js`。
- **下一轮建议角度**：「最近 N 日」在系统里是不是同一个窗口 —— 各处 `slice(-3/-5/-8/-20/-60/-90/-95)`，而"日"有的指交易日有的指自然日；⛔ 数据不足时窗口会**静默变短**（`slice(-90)` 在只有 6 根时实际是 6 日），而文案照样写「90日涨停」—— 说的和算的不是一回事（dc 数量词 + dd 前提缺失在「窗口」这个维度上的延伸）。
'''

NEW10 = u'''26. **同一个「达标」若被两把尺子量出来，用户看到的是一个数还是两个数？** —— 评分/概率/命中率这类**复合指标**必须带它是在什么数据上算出来的（样本量·窗口·满分），否则"低分"会被读成"真的差"，而真相常常只是数据短。
'''

for base in [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory",
]:
    p = os.path.join(base, "MEMORY.md")
    s = io.open(p, encoding="utf-8").read()
    orig = s
    # §5：在「锁要对称」前插入
    s = rep(s, u"- **锁要对称**：", NEW5 + u"- **锁要对称**：", 1, '§5') or s
    # §9：替换旧的「下一轮建议角度」行为 di 条目 + 新角度
    old9_marker = u"- **下一轮建议角度**：「够了/达标」在系统里是不是同一把尺子"
    i = s.find(old9_marker)
    if i < 0:
        print("  !! §9 锚点缺失"); continue
    j = s.find("\n", i)
    s = s[:i] + NEW9 + s[j + 1:]
    # §10：追加第 26 条
    if s.rstrip().endswith(u"25. **同一条原则要在所有同类位置上一块儿落实**：八字闸门落实了「判不出来≠判了通过」，胜率门没落实 —— 只落一半等于没落，而且没人会发现（不报错、不留痕）。"):
        s = s.rstrip() + "\n" + NEW10
    else:
        s = s.rstrip() + "\n" + NEW10
    io.open(p, "w", encoding="utf-8", newline="").write(s)
    print("MEMORY.md 更新: %s  字符 %d -> %d  CR=%d" % (p, len(orig), len(s), s.count("\r")))
