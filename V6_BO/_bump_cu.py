# -*- coding: utf-8 -*-
import io

NOTE = (
    "20261006cu：只在 happy path 上定义过的状态（本轮新角度）。"
    "一个长任务有四种出口：成功 / 跳过（前提不满足）/ 失败（抛错）/ 重入（已在跑）。"
    "而这三类全市场任务的**进度对象过去只在成功那一支被更新**，其余出口直接 return、"
    "一个字段都不动 → 面板照样显示「全市场扫 5500 只 → 有效 20 只」，看着像刚跑完，"
    "实际是上一次成功的（可能几小时前甚至昨天）数字，而且**没有任何字段能表达"
    "「这一轮没跑成」** —— 不报错、不算错，只是过时，故障 100% 无法自查。"
    "三处同病：① `scanZtPre` 的 `_zpProg` 只在成功那一行整体替换，「模型未就绪」与 catch 两个出口不动；"
    "② `scanTrendUniverse` 的 `_tsProg` 同款（catch 只 return 不带 prog）；"
    "③ `klineBackfill` 的 `_kbfProg` 在「票池为空」时同样静默 return。"
    "现在三个对象都补 `ok` / `error` 字段，成功/跳过/失败三个出口统一走写入口"
    "（`zpProgSet` / `tsProgSet`；`_kbfProg` 是**累计型**进度、按 day 每日重置的语义不许改坏，"
    "只加本轮成败标记），时间戳一并刷新（不许拿上次成功的时间冒充本次）。"
    "光在后端定义还不够 —— **状态定义了必须让人看得见**：前端涨停前形态与趋势扫描两个区块"
    "在 ok===false 时显示「⚠️ 本轮未跑成(原因)，以下为上次结果」，并保留 basisTxt 基准日标注"
    "（旧数据是哪天的照样说得清）。⛔ 兜底文案不许写光秃秃的「扫描失败」（by 轮钉过："
    "用户看到这四个字既不知道哪儿坏了也不知道怎么办），改为「未知异常，原因见服务端日志 [ztpre]」。"
    "守门 _test_state_exits.js（26：三个出口逐个钉 + 真跑 zpProgSet 验证时间戳刷新 + "
    "反证「删掉失败出口的写入就该被判为不留痕」+ 前端必须显示得出来）；扫描器 _scan_state_exits.js。"
    "⛔ 又踩两次同类（钉字面量）：_test_error_advice.js 钉死「源码不含『扫描失败』」撞上我的兜底文案；"
    "_test_state_field_parity.js 钉死 `(s.ztPreProg || {}).scanned` 这种**写法**，"
    "而我把进度提成局部变量后字面量对不上就假红 —— 判据改成钉语义（两个区块都读 scanned/total）。"
    "｜上一版（ct）：默认是对的假设 —— 不许默认取第一个。"
)

TARGETS = [("server.js", 37), ("public/index.html", 1380)]

for path, lineno in TARGETS:
    with io.open(path, "r", encoding="utf-8", newline="") as f:
        raw = f.read()
    lines = raw.split("\n")
    idx = lineno - 1
    old = lines[idx]
    assert old.startswith("const APP_VER = "), (path, old[:80])
    assert "20261006ct" in old, (path, old[:80])
    lines[idx] = "const APP_VER = '20261006cu'; // " + NOTE
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines))
    print("bumped", path, "line", lineno)
