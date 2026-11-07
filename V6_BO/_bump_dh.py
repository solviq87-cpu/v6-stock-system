# -*- coding: utf-8 -*-
"""dh 轮：升 APP_VER（两端，按内容定位）"""
import io

NOTE = (
    "20261007dh：同一个「数据没取到」，在系统里必须有同一个口径（本轮新角度）。"
    "全项目到处都在「没取到就给个兜底」，而这些兜底**根本不是同一件事**，以前各写各的："
    "大单缺 K 线 → 位置权重 0.7；板块冷热取不到 → 0.85；实证档取不到 → 50；"
    "流通市值取不到 → 0；排序时取不到质量分 → -1（按最差）；"
    "而**胜率闸门取不到质量分 → `prob != null && …` 整条跳过 = 默许放行**。"
    "最后两条是**相邻两行、语义完全相反**的同一个「取不到分」：排序按最差、闸门按通过。"
    "更要命的是胜率门是一票否决的硬闸门，而 L3203 自己写着的既定原则恰恰是"
    "「判不出来」≠「判了通过」—— 缺数据不判死只适用于**打分权重**，从来不适用于硬闸门。"
    "实测：趋势扫描 30 只、连续收涨 12 只**整池取不到质量分**（它们的分叫 ztP/upP，"
    "不在 prob/riseProb/score/trendScore 里），一旦哪天接上推送就是整池绕过主闸门。"
    "修法：① 建 MISS_RULE 登记表，每个「没取到」必须声明自己是四类里的哪一类 —— "
    "weight（打分权重·给中性值不判死）/ worst（排序·按最差）/ block（硬闸门·判不出即不放行）/ "
    "clear（对外陈述·明写「未判定」）；读取走 missingOf / missKind，五处裸写的中性值全部改成读表；"
    "② 闸门侧取不到分 → 拦下 + 计数 + 日志（判不出 ≠ 通过），确实没有质量分的类型必须"
    "显式登记进 NO_SCORE_TYPES 才放行（目前为空，实测 7 个调用点全都带分，今天一个都不误伤）；"
    "③ pushGovBlocked 三类互不包含（noScore 不许被算进 throttled 冒充重复/冷却），脚注带上第三类。"
    "⛔ 通用教训：看到「给个兜底值」就要先问一句 —— 这个兜底是**权重**还是**闸门**？"
    "权重可以给中性值，闸门给任何值都等于替用户做了一个判断。"
    "守门 _test_missing.js（63 断言，含反证：旧判定式在 prob 为 undefined 时确实放行）；"
    "扫描器 _scan_dh.js。"
)


def bump(path):
    src = io.open(path, encoding='utf-8').read()
    lines = src.split('\n')
    hit = 0
    for i, l in enumerate(lines):
        if l.startswith('const APP_VER = '):
            lines[i] = "const APP_VER = '20261007dh'; // " + NOTE
            hit += 1
    assert hit == 1, '%s 命中 %d 处' % (path, hit)
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print('%s → %d 处已升版' % (path, hit))


bump(r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\server.js")
bump(r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\public\index.html")
