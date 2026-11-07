# -*- coding: utf-8 -*-
import io

P1 = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\MEMORY.md"
s = io.open(P1, encoding='utf-8').read()

ANCHOR = u"- **dg（最新·20261007dg）"
assert ANCHOR in s
NEW = u"""- **dh（最新·20261007dh）同一个「数据没取到」在系统里必须有同一个口径**：全项目到处都有"没取到就给个兜底"，而这些兜底**不是同一件事** —— 大单缺K线 0.7／板块冷热 0.85／实证档 50／市值 0／排序 -1（按最差）／**胜率闸门 undefined → `prob != null && …` 整条跳过 = 默许放行**。最后两条是**相邻两行、语义完全相反**的同一个"取不到分"；而胜率门是一票否决的硬闸门，L3203 自己写着「判不出来」≠「判了通过」（缺数据不判死只适用于打分权重，不适用于硬闸门）——同一条原则在八字闸门 `baziUnknown` 落实了、在胜率门没落实。实测趋势扫描 30 只、连续收涨 12 只**整池取不到质量分**（它们的分叫 ztP/upP，不在 prob/riseProb/score/trendScore 里）。修法：`MISS_RULE` 登记表（weight／worst／block／clear 四类）+ `missingOf`/`missKind` 唯一读取口，五处裸写中性值全改读表；闸门侧取不到分 → 拦下+计数+日志，确实没分的类型必须登记进 `NO_SCORE_TYPES` 才放行（目前为空，7 个调用点全都带分、不误伤）；`pushGovBlocked()` 四类互不包含（noScore 不许被算进 throttled）。守门 `_test_missing.js`(63)，扫描器 `_scan_dh.js`。
"""
if ANCHOR in s and u'- **dh（最新·20261007dh）' not in s:
    s = s.replace(ANCHOR, NEW + ANCHOR, 1)

ADD = u"""24. **看到「给个兜底值」就要先问一句：这个兜底是**权重**还是**闸门**？权重可以给中性值（不判死）；闸门给任何值，都等于替用户做了一个判断。**
25. **同一条既定原则要在所有"同类位置"上一块儿落实**：八字闸门 `baziUnknown` 落实了「判不出来≠判了通过」，胜率闸门那儿却没落实 —— 只落一半等于没落，而且没人会发现（不报错、不留痕）。
"""
if u'25. **同一条既定原则要在所有' not in s:
    lines = s.split('\n')
    idx = None
    for i, l in enumerate(lines):
        if l.startswith(u'23. '):
            idx = i
            break
    assert idx is not None, '找不到第 23 条'
    j = idx + 1
    while j < len(lines) and not (lines[j][:1].isdigit() and lines[j].find(u'. ') > 0):
        j += 1
    lines.insert(j, ADD.rstrip('\n'))
    s = '\n'.join(lines)

io.open(P1, 'w', encoding='utf-8', newline='\n').write(s)
print('MEMORY.md →', len(s), 'chars, CR=', s.count('\r'))

P2 = r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\MEMORY.md"
io.open(P2, 'w', encoding='utf-8', newline='\n').write(s)
print('已同步另一工作区')
