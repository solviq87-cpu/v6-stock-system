# -*- coding: utf-8 -*-
"""临时脚本：把 cd/ce 两轮的工作日志追加到两个 workspace 的记忆文件（写完即删）"""
import io, os

DAILY_A = r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\2026-10-06.md"
MEM_A   = r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\MEMORY.md"
DAILY_B = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\2026-10-06.md"

LOG = """

## 2026-10-07 cd / ce：不看代码看事实（从线上真实运行数据反查）

前面 30 轮的前提都是「读源码 → 找逻辑漏洞」。这一轮换了顺序：**直接把线上实例跑出来的真实数据拉下来看**，
结果抓到一类断言永远测不出来的问题，以及一处更要命的 —— **回归总榜的绿灯是假的**。

### 拉下来的线上事实（_verify_online.py：/api/lock/trust 登录 → 状态/台账/持仓/流水/state）
- appVer=20261005cc，pushRole=primary，gen=4 / viewGen=2（三次发版没把自己踢下线）
- 设备台账 **19 条，其中 9 条是「已授权设备（自动恢复）」占位**
- 推送流水共 495 条，**最近 30 条里 25 条是「📦 源码包 · 仅本人可见」**
- 持仓 3 条、ops 1 条、快照 1 份（3 条）→ cc 轮「快照存操作之前」的修复在线上已产出正确内容
- 各池规模正常：ztPool 52 / pool 30 / trendScan 30 / steadyUp 12 / ztPre 20 / bigMoney 9 / sectors 20
- 非「已送达」的推送 0 条 → 飞书通道健康，没被队列锁死

### 修的三处（都由真实数据驱动，代码单看全对，合起来才出事）
1. **源码包刷屏**（srcPkgShip）：发版脚本每发一版推一条 → 一天十几个版本弹十几条，还抢「少而精」额度。
   「私密通道同步发源码」是用户点名要的能力必须保留 → 改成**同一天只推一次**，
   能力一点没减（链接照样生成、照样进面板「推送流水」随时能取）。判据复用 bt 轮 pushedToday（只认真实送达）。
2. **台账堆占位**（touchDevice）：口令登录每次签新令牌、摘要不同就补一条，而这类占位不带指纹没得归并。
   现在**无指纹时按 IP + 角色归并**，同 IP 同角色只留最新一条，带指纹的真设备一条不动。
3. **存量清不掉**（/api/lock/devices 的 prune，ce 轮补）：只改新建不够 ——
   prune **只按 fp 归并**，而占位恰恰没有指纹 → 面板点「整理授权设备」永远清不掉那 9 条。
   现在 prune 也按 IP + 角色归并。**新建归并 + 存量归并缺一边都不够**。

### ⛔⛔ 最严重的一处：回归总榜的绿灯是假的
加了 21 条断言，全量总断言数反而从 2921 掉到 2892 —— 顺这条线查下去发现：
- `_runall.js` 找不到「N 通过 / M 失败」汇总行时退化成**数 ✓ 的行数**，
  而套件只要打出过几个 ✓ 就**永远不会标红**。
- 实测两个套件是真崩（exit 1）：
  · `_test_src_priv_channel.js` 打出 7 个 ✓ 后 `ReferenceError: pushedToday is not defined`
    —— 沙箱 new Function 的**注入清单没跟上块里新增的判据**（本轮加的 pushedToday）。
  · `_test_enum_gap.js` 打出 14 个 ✓ 后 `ReferenceError: savePushGov is not defined`
    —— bt 轮给 modDayTake 加落盘时引入，**从那天起这个门就没跑完过**。
- 另有 11 个套件用 ✅ 或「合计 60 项：通过 60、失败 0」「通过 8 项，失败 0 项」「通过 20 / 20」
  这类中文写法，旧正则一个都不认 → 按 0 断言计，同样不红。
- 修完口径：**3243 → 3250 通过 / 0 失败（103 套件）**，比假的 2892 多出 **350+ 条一直被吞掉的断言**。

**这不是某个功能模块的 bug，是「我们用来判断有没有 bug 的那把尺子」本身是漏的**，
而且失效方式是最坏的那种：不报错不崩，只是静静地少报。

三条硬口径（写在 _runall.js 里，判定逻辑抽成 `judge(out, err)` 导出）：
① **退出码非 0 一律标红**（崩了就是崩了，没有"部分通过"）
② 汇总行认四种写法：标准 / `合计 N 项：通过 N、失败 M` / `通过 N 项，失败 M 项` / `通过 N / M`（分母是总数）
③ 既没汇总行也没有任何 ✓ ✅ 对勾 标记 → **计红**（套件压根没跑起来）
另：总榜有红灯时 `process.exitCode = 1`（脚本与 CI 拦得住）。

### 新增/改动文件
- 新增 `_test_runtime_facts.js`（30 断言：源码包当日闸门 / 台账按 IP 归并 / prune 存量归并，全部真跑 + 旧写法反证）
- 新增 `_test_runall_honesty.js`（34 断言：崩掉不许判绿 / 四种汇总写法 / 三种勾 / 零断言计红 / 源码层面钉死口径 / 沙箱注入清单漏项）
- 新增 `_scan_runtime_facts.js`（累积型问题普查：发消息的函数有没有频次闸门、长期容器有没有归并或裁剪、台账无指纹时的兜底键）
- 重写 `_runall.js`（judge 导出 + 三口径）
- 修 `_test_enum_gap.js`（注入 savePushGov + 补「占额度必须落盘」断言）、`_test_src_priv_channel.js`（注入 pushedToday + 新增 ②b 当日闸门用例）
- `_test_take.js` 以前只是**打印** ✅/❌ 没有任何计数 → 总榜按 0 断言计，等于从没进过回归；现在统一走 ok() 并给汇总行（8 断言）
- CODE_FILES 109 个（新增 `_runall.js` —— 否则 _test_code_coupling.js 会红：随包测试的依赖也必须在清单里）

### 教训（写给下一轮）
- **沙箱注入清单漏项 = 整个套件崩掉**，而旧总榜判绿 → 症状是"总断言数莫名少了"，不是红灯。
  以后凡看到总断言数不升反降，先查有没有套件崩了。
- 用 `new Function` 抠实现块做测试时，块里**每多引用一个外部符号都必须同步补注入清单**（本项目已踩第 5 次）。
"""

MEM_PATCH = """
## ⛔⛔ 回归总榜的判定口径（2026-10-07 修，别再退回去）
- `_runall.js` 三条硬口径：**退出码非 0 一律标红**（以前只数 ✓，套件打出几个 ✓ 后崩掉照样判绿 ——
  实测 `_test_src_priv_channel.js` / `_test_enum_gap.js` 崩了好几轮没人发现）、
  汇总行认四种中文写法、既没汇总行也没标记则计红。判定逻辑是导出的 `judge(out, err)`，可单测。
- **总断言数不升反降 = 有套件崩了**（旧的唯一症状），先跑 `node _test_X.js` 单独看退出码。
- 用 `new Function` 抠实现块做沙箱测试时，**块里新增的每一个外部符号都要补进注入清单**，
  否则不是断言变红而是整套崩（本项目已踩 5 次：A / isTradeDay / savePushGov / pushedToday / …）。
- 每个 `_test_*.js` 必须给出标准汇总行（「N 通过 / M 失败」）或至少一个 ✅ 标记，否则按 0 断言计。

## 🧭 已用过的审查角度（cd/ce 之前 30 个，此处只补新的）
- **cd：不看代码看事实** —— 从线上真实运行数据反查（推送流水 / 设备台账 / 池规模），
  专抓「每一行代码单看都对、合起来才出事」的累积型问题；
  配套扫描器 `_scan_runtime_facts.js`（频次闸门 / 容器归并裁剪 / 台账兜底键）。
"""

def append(path, text):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    old = ""
    if os.path.exists(path):
        old = io.open(path, encoding="utf-8").read()
    io.open(path, "w", encoding="utf-8", newline="\n").write(old + text)
    print("append ->", path, len(old + text))

def patch_mem(path):
    if not os.path.exists(path):
        print("skip (no file):", path)
        return
    old = io.open(path, encoding="utf-8").read()
    if "回归总榜的判定口径" in old:
        print("already patched:", path)
        return
    io.open(path, "w", encoding="utf-8", newline="\n").write(old + MEM_PATCH)
    print("patch ->", path)

append(DAILY_A, LOG)
append(DAILY_B, LOG)
patch_mem(MEM_A)
