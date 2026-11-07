# -*- coding: utf-8 -*-
# dw 轮：更新 MEMORY.md —— §5.1 加 dw 行、§9 换 dw 条目与新角度、§10 加第 26 条
import io, os

PATHS = [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\MEMORY.md",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\MEMORY.md",
]

def rep(s, old, new, tag):
    if s.count(old) != 1:
        print('FAIL ' + tag + ' :: 命中 %d 次' % s.count(old))
        return s
    print('OK   ' + tag)
    return s.replace(old, new)

for p in PATHS:
    with io.open(p, 'r', encoding='utf-8') as f:
        s = f.read()

    # §5.1：把「最新」从 dv 移到 dw
    s = rep(s,
        u"｜ **dv（最新）静默跳过 `SKIP_RULE`+`skipAdd`/`skipState`+`empSkipStat`**",
        u"｜ dv 静默跳过 `SKIP_RULE`+`skipAdd`/`skipState`+`empSkipStat` ｜ **dw（最新）补救完成判据 `REMEDY_RULE`+`remedyDone`/`remedySkip`/`remedyState`+`remedyBadOf`**",
        '§5.1 加 dw 行')
    # 追加 dw 行说明
    s = rep(s,
        u"- **dv**：**跳过不是免费的** —— 每条 `continue` 都在改结论的分母。登记 `SKIP_RULE`（27 种原因），唯一出口 `skipAdd`（**未登记 kind 直接丢弃**）→ `skipState`/`empSkipStat` 交出「哪道判据跳了多少」。**「按设计排除」与「还没回验」必须分开说**。",
        u"- **dv**：**跳过不是免费的** —— 每条 `continue` 都在改结论的分母。登记 `SKIP_RULE`（27 种原因），唯一出口 `skipAdd`（**未登记 kind 直接丢弃**）→ `skipState`/`empSkipStat` 交出「哪道判据跳了多少」。**「按设计排除」与「还没回验」必须分开说**。\n"
        u"- **dw**：**补救的完成判据是「补出来了」不是「跑过了」**。补救机会有限（启动链 2~3 次 / 探测 30 次），`remedyDone(name,r,outN)` 判「到底跑没跑」：running／异常→不算完成、保留机会；跑完但 0 条→算跑完但留痕告警（不白扫 30 遍）；`remedySkip` 把「这次机会被跳过」计数并留原因。⛔ 补救跳过消耗的是**有限机会**，跟普通判据跳过不是一回事；「按设计跳过」与「数据没回来跳过」分开（`REMEDY_GAP`），机会用尽且卡数据缺口 → `bad` 提醒。",
        '§5.1 dw 说明')

    # §9：dv 改「本轮」为已完；换 dw 条目与下一轮角度
    s = rep(s,
        u"- **dv（本轮）**：160 处 continue 里 **145 处完全静默**。样本库 1959 条只有 368 条（18.8%）进实测档（缺次日口径 737／缺概率 242／回测 600／事后 12），histzt·pool·trend·zt 四类 1051 条**整类零存活**却无人说；paperBuy 五处 continue 静默 → 面板只说「暂无持仓」。详见 `2026-10-08.md`。",
        u"- **dv**：160 处 continue 里 **145 处完全静默**。样本库 1959 条只有 368 条（18.8%）进实测档，histzt·pool·trend·zt 四类 1051 条**整类零存活**却无人说。详见 `2026-10-08.md`。\n"
        u"- **dw（本轮）**：补救的完成判据 =「跑过了」而不是「补出来了」。① `_bootScan` 把 `scanTrendUniverse` 返回值赋给 `const r` 后再没看过，`_bootScanDone=true` 写在 catch 之后无条件执行 → 撞并发锁/抛异常/三池全 0 都宣告完成、30 次机会归零；而同一函数在手动入口 `/api/scan-trend` 是**判了 r.running 的**。② `_reviewStartupCheck` 只 2 次机会、5 个 return 全静默。③ `_bootSeed` 补 0 条静默。详见 `2026-10-08.md`。",
        '§9 dw 条目')
    s = rep(s,
        u"- **下一轮建议角度**：**「只有一半入口会走到的『补救』动作」** —— 系统里散着重试／补发／回填／自愈／兜底重算，重点查：① 补救有没有第二个人在跑（两个入口会不会各补一遍、或都以为对方会补）② 补救失败后有没有第二次机会、会不会被自己的闭锁永久关掉 ③ 补救成功时有没有回头记下「当时为什么需要补救」（数据缺口的根因是不是从来没人看过）。",
        u"- **下一轮建议角度**：**「配置里的『默认值』到底哪个入口认、哪个入口不认」** —— 同一类配置（概率门槛 / 窗口 / 额度 / 开关）散在多个模块，重点查：① 同一个键在写入端、读取端、面板展示端是不是同一个默认值（dg 轮查过『开关』，这轮查『数值默认值』有没有在新增模块时被悄悄换成另一个数）② 配置改了之后，哪个消费者用的是「启动时冻结的旧值」、哪个用的是「实时读的新值」③ 有没有「配了但没入口读」的孤儿键。",
        '§9 新角度')

    # §10：加第 26 条
    s = rep(s,
        u"25. **⛔ 构造「今天」的测试数据不许用「now 往前推 N 分钟」**：凌晨会跨到昨天（实测 00:29 跑 E4 反证静默失效）。锚定「今天零点 + i」。",
        u"25. **⛔ 构造「今天」的测试数据不许用「now 往前推 N 分钟」**：凌晨会跨到昨天（实测 00:29 跑 E4 反证静默失效）。锚定「今天零点 + i」。\n"
        u"26. **⛔ 补救/重试/回填这类动作，完成判据是「补出来了」不是「跑过了」**：被并发锁挡下（{running:true}）、抛异常被 catch 吞掉、产出 0 条，都不算完成；机会有限时更要分清「按设计跳过」与「数据没回来跳过」。同一补救若有两个入口，两个入口都得对返回值负责。",
        '§10 第 26 条')

    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)
    print('WROTE %s  %d bytes  CR=%d' % (p, os.path.getsize(p), s.count('\r')))
print('done')
