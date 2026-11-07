# -*- coding: utf-8 -*-
# dw 轮日志：写入两个工作区的 2026-10-08.md（追加）
import io, os

DIRS = [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory",
]

ENTRY = u"""

## dw 轮（20261007dw，已发布）—— 那些只有一半入口会走到的「补救」动作

**角度**：系统里散着的重试／补发／回填／自愈／兜底重算。重点查 ① 补救有没有第二个人在跑
（两个入口各补一遍 or 都以为对方会补）② 补救失败后有没有第二次机会、会不会被自己的闭锁永久关掉
③ 补救成功时有没有回头记下「当时为什么需要补救」。

### 实证一 · 启动首扫把返回值丢掉了（同一补救两个入口口径分叉）
`_bootScan` 里 `const r = await scanTrendUniverse(30)` 赋完**再没人看过**，
而 `_bootScanDone = true` 写在 catch **之后**、无条件执行。于是三种情况全都宣告「启动首扫完成」：
① 撞上 `_tsBusy`（返回 `{running:true}`，这次**根本没启动**）② 抛异常被 catch 吞掉 ③ 三池全是 0 只
（学习库刚有个位数样本时必然如此）。30 次探测机会立刻归零。
⛔ 分叉点：同一个 `scanTrendUniverse`，手动入口 `/api/scan-trend` **是判了 `r.running` 的**
（bz 轮修的 pending 收尾，会 pushLog「⏭ 全市场扫描未启动」）—— 同一个补救，一个入口负责、另一个不负责。

### 实证二 · 复盘重启补发：只有 2 次机会，五个 return 全静默
`_reviewStartupCheck` 只在启动后 2 分钟／8 分钟各跑一次。五个 `return`（周末／休市／不在窗口／
当天已发／`reviewBusy || !ztPool.length`）**全是静默的**。8 分钟那次若撞上 `reviewBusy` 或涨停池没回来，
当天复盘补发就彻底消失，用户只看到「今天没有复盘」，无从自查。
⛔ 而且原来把「休市日（按设计不补）」和「涨停池为空（数据没回来）」混成一条判据，无法区分。

### 实证三 · 启动补样本补 0 条时静默
`if (r.added) console.log(...)` —— 只有补到了才打印。三趟机会（90s/6min/15min）全补 0 条 = 白跑且无人知。

### 修法（登记表 + 唯一出口，与 dv 轮的 SKIP_RULE 同构）
- `REMEDY_RULE`（三个补救 + 各自的**机会数**：bootScan 30 / bootSeed 3 / reviewBoot 2）
- `REMEDY_WHY`：「补失败」的四种说法 —— `noRet`（拿不到返回值）／`busy`（被并发锁挡下，本次根本没启动）／
  `err`（抛异常或 ok:false）／`zero`（跑完了但 0 条）。这是 dl 轮「成功有几种说法」在补救链上的延续。
- `REMEDY_SKIP`：这次机会被跳过的原因（8 种）。**未登记的 name/why 一律丢弃并 console.error**。
- 唯一出口 `remedyDone(name, r, outN)`：判「到底跑没跑」——
  **running／异常 → 不算完成，保留机会下次再试**；**跑完了但 0 条 → 算跑完（不再重试，免得把 K 线缓存白扫 30 遍）但必须留痕告警**。
- `remedySkip(name, why)`（补救跳过＝消耗机会，必须留原因）+ `remedyState()`（交出 used/tries/left/whyLabel/note）。
- `/api/state` 下发 `remedy`；前端 taskBox 在「没补上 / 0 条」时亮黄色徽标 `⚠️ 补救未成：…`。

### 守门
`_test_remedy.js`（44 断言 / 0 失败）：登记表、沙箱真跑四种判据、未登记即丢弃并报错、
机会递减与用尽、反证（旧写法撞并发锁照样宣告完成 vs 新写法不算完成）、
两入口同口径（手动判 `r.running`、启动首扫也判）、五个 return 全留痕、前后端接线。

### 教训
**补救的完成判据是「补出来了」，不是「跑过了」**；而且**补救被跳过消耗的是有限的机会**，
跟普通判据跳过不是一回事 —— 跳过一次就少一次，必须留下原因。
另：同一个补救若有两个入口，两个入口都得对返回值负责（一个判一个不判 = 一半的机会被静默浪费）。
"""

for d in DIRS:
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    p = os.path.join(d, '2026-10-08.md')
    with io.open(p, 'a', encoding='utf-8', newline='\n') as f:
        f.write(ENTRY)
    with io.open(p, 'r', encoding='utf-8') as f:
        s = f.read()
    print('APPENDED %s  %d bytes  CR=%d' % (p, os.path.getsize(p), s.count('\r')))
print('done')
