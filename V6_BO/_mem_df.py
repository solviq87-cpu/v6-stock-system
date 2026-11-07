# -*- coding: utf-8 -*-
# df 轮收尾：把本轮条目追加到两个工作区的当日日志
import io, os

ENTRY = u"""

## df 轮（20261007df · 已发布）· 角度：**承诺了但没有任何一条路径会去兑现**

### 侦察路径（可复用）
1. 先怀疑 `MOD_DAY_CAP`（12 键只有 4 个模块真调 `modDayTake`）→ 查注释发现 **cc 轮已修并标注**，换点。
2. `CFG_RANGE` 11 个数值键逐个查读取点 → **全部有**，不是靶子。
3. 写 `_scan_deadswitch.js` 扫「读得到但改不了」的配置键（面板无入口 + 不在 /api/config 白名单 + 全项目零写入点）→ **命中真问题**。
4. 配套 `_scan_df.js`：S.config 键读写计数 / 常量表键有无读取点 / 面板 onclick 函数有无定义 / holdings 导出零调用（后两项全干净）。

### 修的三处（同一类病）
- **`auctionPreview`**：注释「嫌吵可在面板关掉」→ 面板零命中、不在 CFG_RANGE 白名单、全项目零写入点。用户**永远关不掉**。
- **`quietStart` / `quietEnd`**：推送自检诊断会往手机推「请检查面板的静默时段设置」→ 面板上压根没这项设置（index.html 里 `quiet` 出现 0 次）。最讽刺的一条：这句空话会真的发到用户手机上。
- **`viewIdleHours`**：注释「可配 config.viewIdleHours」→ 同样不在白名单、零写入点。
- 顺带核实为「合理不该在面板改」的：pushRole / syncUpstream / boundPhone / wecomWebhook（身份与部署相关）。

### 改法
新增 **`CFG_SET`** 表（与 CFG_RANGE 并列），每键 `{kind: bool|hhmm|int, def, min?, max?, label, note}`：
- 读取唯一入口 `cfgSetOf(k)`：没设过/值坏了 → 退回缺省；⛔ **上界在读取端也要兜**（config.json 手改得动，里面躺着 9999 时不能真生效，写入端拦得住新值拦不住老文件）。
- 写入端 `cfgSetErrors()`：先体检再落盘、整批不写（沿用 CFG_RANGE 那条）；⛔ **int 的下界是 0 不是 min** —— 0 的含义是「交回使用端解释」（viewIdleHours 的 0 = 按缺省 24 走），别重蹈 aq 轮「0 被吃掉/被判越界」。
- `cfgSetState()` 下发 `/api/state`，面板「🛠 工具 → ⛱ 推送时段 / 开关」由它渲染 → **说明文字由兑现方产出**（de 轮原则）。
- 静默时段抽唯一出口 `quietWindow()`：面板 / `inQuietHours` / `pushAll` 三处同读。
- 面板：输入中不重绘（`box.contains(document.activeElement)`，refresh 每 5 秒会冲掉正在敲的内容）；保存失败念出服务端原因并回绘真实值。

### 数据
守门 `_test_cfgset.js` **58 断言 / 0 失败**（含一组反证：旧白名单 CFG_RANGE 里根本没有这四个键 → 提交它们会被整段跳过、**不报错**、接口照样回 ok:true）。
全量回归 **4173 / 0（129 套件）**。守门 58/0。
发布后核验：线上 appVer=20261007df / pushRole=primary、cfgSet 四键齐备、持仓 **0 条**、双端同步 71ms、台账 3 条（FPUB_SYNC02 + 用户两台真实 fp）。

### ⛔ 本轮踩坑 / 新教训
1. **revoke 会 bump 世代号 → 同世代的其它令牌跟着作废**。收尾撤了自己造的设备后，config.json 里的 `syncUpstream.token`（FPUB_SYNC02）也被连带废掉，本机→线上同步当场断。必须**重签并写回 config.json** + **重启本地服务**（服务启动时才读 config）。本次用 `_resign_sync.py` 重签 + 杀 8787 进程后 `pythonw start_daemon.py` 拉起（看门狗本次没自动拉）。
2. **改实现后三个老套件崩（不是变红）**：`_test_time_window.js` / `_test_view_idle.js` 沙箱漏注入 `quietWindow` / `cfgSetOf` / `CFG_SET`（同类坑第 13、14 次）；`_test_push_window.js` 钉死了旧字面量 `S.config.auctionPreview === false` → 按「钉语义不钉字符串」改成断言 `cfgSetOf('auctionPreview')` + 「该键登记在 CFG_SET 里」两条。
3. **写「可在面板 X」这类注释前，先问三句**：这张表里登记了吗？面板读得到吗？接口收得下吗？三者缺一就是空头承诺。

### 下一轮可换角度
**「同一个开关在不同入口下的默认值是不是同一个」** —— 一个开关往往在 A 入口读配置、B 入口用常量兜底、C 入口靠 `||` 取默认，三处的"没配过"其实不是同一个值；以及**默认值改了之后，那些已经在磁盘上的旧值会不会跟着变**（谁该迁移、谁该保留）。
"""

DAILY = u"2026-10-07.md"
for ws in [u"2026-09-25-13-40-58", u"2026-09-25-20-57-21"]:
    p = os.path.join(u"C:\\Users\\28957\\WorkBuddy", ws, u".workbuddy", u"memory", DAILY)
    if not os.path.exists(p):
        print(u"跳过（不存在）: " + p)
        continue
    with io.open(p, "a", encoding="utf-8", newline="\n") as f:
        f.write(ENTRY)
    print(u"已追加: " + p + u"  (" + str(os.path.getsize(p)) + u" 字节)")
