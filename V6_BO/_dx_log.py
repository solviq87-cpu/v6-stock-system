# -*- coding: utf-8 -*-
# dx 轮日志：写入两个工作区的 2026-10-08.md（追加）
import io, os

DIRS = [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory",
]

ENTRY = u"""

## dx 轮（20261007dx，已发布）—— 配置里的「数值默认值」到底哪个入口认、哪个入口不认

**角度**：同一类数值配置散在多模块。查 ① 同一键在写入端/读取端/面板展示端是不是同一个默认值
② 配置改了之后哪个消费者用「启动时冻结的旧值」、哪个用「实时读的新值」③ 有没有「配了没入口读」的孤儿键。

### 实证一 · 自动调参改了主闸不落盘（真 bug）
三个自学习闭环都会写 S.config 的数值门槛：`bigMoneySelfOptimize`→bigMoneyProbGate、`similarSelfOptimize`→simGate
写完都调 `saveCfg()`；**唯独 `trendSelfOptimize`→probThreshold（最要紧的推送主闸）改了内存不落盘**。
线上实例被平台回收冷启动 / 发版重启后，S.config 从 config.json 读回旧值（或 def 0.82）→ 调参成果整段蒸发；
而 `adjRemember('trend', ...)` 台账还记着「从 cur 调到了 nv」→ 台账与现实分叉，复核闸拿错误的 from/to 判
「上次上调没改善」，可能错误地阻止/允许再次调整。修：上调/下调两个分支都补 `saveCfg()`。

### 实证二 · 注释里的默认值与代码分叉
/api/config 的注释写着「名额默认120」，而 CFG_RANGE.pushMaxPerDay.def 早已改成 350（额度退居兜底、
主闸换成胜率门槛那次改的），注释没跟着改 → 同一数值默认值两个说法。已改注释。

### 顺带发现（真实数据损坏，已修复）
`paper.json` 的 pre 账户里，002900 的买入流水被记了**两次**：一条 side="买入"（干净）、一条
side="买\ufffd\ufffd\ufffd"（"入" 编码损坏成 3 个 U+FFFD，同一 t/shared/amount/fee/basis）。
这是「重复 + 编码损坏」的历史数据，导致对账 dPos=1（重算多出 4500 股 002900 的幽灵持仓）。
已本地移除损坏那条，对账回归 41/0。全项目扫 U+FFFD 仅此一处，非系统性编码 bug。

### 其余全扫干净
① 数值配置读取全部实时走 `_govCfg`（无启动期冻结变量）② CFG_RANGE/CFG_SET 白名单与读取键一致（无孤儿键）
③ 前端面板默认值由后端 cfgRangeState 下发（无硬编码 0.82/55）④ 自动调参钳制都在取值域内
⑤ `_govCfg` 无第二参数残留（第二份默认值会被静默忽略）。

### 守门
`_test_cfg_persist.js`（12 断言 / 0 失败）：三处自优化一致落盘（4 个落盘点）、反证（不落盘→重启弹回 def）、
saveCfg 失败走 _diskFail、自动调参钳制在取值域内。

### 教训
**「改了内存」和「改了磁盘」是两回事** —— 自学习/自动调参这类程序自己改配置的地方最容易漏 saveCfg()，
而且它不报错、不算错，重启才露馅（"不报错但悄悄错"的又一形态）。另：注释里的「默认 N」要和登记表 def 对得上。
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
