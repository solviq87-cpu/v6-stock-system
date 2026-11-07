# -*- coding: utf-8 -*-
import io

P1 = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\MEMORY.md"
s = io.open(P1, encoding='utf-8').read()

ANCHOR = u"- **dd（20261007dd）只有结论、没有前提**："
assert ANCHOR in s, 'dd 锚点找不到'
NEW = u"""- **dg（最新·20261007dg）同一个键的默认值在不同入口下是不是同一个**：默认值散在三种写法里 —— `_govCfg('k', 62)` 的第二参数（23 处）／`S.config` 初始对象的 `probThreshold: 0.80`／读取端的 `||` 兜底。**三处的"没配过"是三个值：0.80 / 0.82 / null**，而回滚段 + hint + config.json 全是 0.82 → 全新实例按 80% 跑且面板真印出来。修法：`CFG_RANGE` 每键补 `def`，`_govCfg(k)` 不再收第二参数（23 处全去掉）；**读取端补上界兜底**（bn 轮只体检【新提交】的值，`cfgSetOf` 早补了而数值键没补 → pushMinProb=200 手改进文件就全天零推送）；⛔ `null`／空串 = 没配过不是 0（`Number(null)===0`，而 0 = 不限是有实义的）；`probThreshold()` 收成唯一读取口（四处裸读 + 一处 `|| null`，键坏了就是 NaN → 判定式恒 false → 模块永久静默）；整块前移修 TDZ（回滚段引用后方 `_govCfg` → 抛错被 catch 吞 → **这段回滚从未生效**）。`/api/state` 下发 `cfgRange`，面板「🎚 门槛 / 额度」显示当前值·默认值·越界。守门 `_test_cfgdef.js`(103)，扫描器 `_scan_dg.js`。
"""
if u'- **dg（最新·20261007dg）' not in s:
    s = s.replace(ANCHOR, NEW + ANCHOR, 1)

ADD = u"""21. **一张表补了校验之后，要问一句「磁盘上已经躺着的旧值走不走这道校验」—— 写入端拦得住新值，拦不住老文件，而老文件正是手改过、最容易越界的那一份。** 同一条原则在多张表（CFG_SET / CFG_RANGE）上必须一起落地，只落一半等于没落。
22. **正面靶子没命中时，换角度的「另一半」而不是原地加码**：dg 轮扫「默认值分叉」得 0 个后，改成扫「默认值散在几种**写法**里」才打到 —— 收口过的东西确实收住了，别在原地打转。
23. **守门测试的收尾必须能清到它真正写的那个环境**：本机是 replica 而 `/api/holdings` 回拉线上展示，测试删除却全带 `_noSync` → 线上残留永远清不掉（实测挂着 3 只带标记的检测票）。允许一个显式的远程清理出口时，**要把边界钉死而不是削弱判据**：只删 filter 出来的带标记项、先删后清流水、只在收尾调一次、没配 syncUpstream 就不打网络。
"""
if u'23. **守门测试的收尾必须能清到它真正写的那个环境**' not in s:
    lines = s.split('\n')
    # 插在第 20 条之后
    idx = None
    for i, l in enumerate(lines):
        if l.startswith(u'20. '):
            idx = i
            break
    assert idx is not None, '找不到第 20 条'
    # 第 20 条可能跨行，找到下一条以数字开头的行
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
