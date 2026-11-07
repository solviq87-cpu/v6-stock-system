# -*- coding: utf-8 -*-
import io, os

ENTRY = u"""
## dg 轮（20261007dg）同一个配置键的默认值，在所有入口下必须是同一个数

**角度**：一个开关往往在 A 入口读配置、B 入口用常量兜底、C 入口靠 `||` 取默认，
三处的"没配过"其实不是同一个值；以及**默认值改了之后，磁盘上躺着的旧值走不走这道校验**。

### 侦察过程（正面靶子没命中，换了一半才打到）
1. 先写 `_scan_dg.js` 扫「同一个键在不同调用点的默认值」—— **11 个键、23 处调用、分叉 0 个**。
   正面靶子没命中，说明**收口过的东西确实收住了**，别在原地打转。
2. 换到角度的另一半：**默认值散在几种不同形态的写法里**，而不是散在几个调用点里 ——
   ① `_govCfg('simGate', 62)` 的第二参数（23 处调用，改一个键要同时改六处）
   ② `S.config` 初始对象里的 `probThreshold: 0.80`
   ③ 读取端的 `||` 兜底（`+(S.config.probThreshold || 0)` 与 `(S.config && …) || null`）
   → **三处的"没配过"是三个值：0.80 / 0.82 / null**，而系统自己在回滚段、CFG_RANGE 的 hint、
     线上 config.json 里认定的都是 0.82 —— 全新实例（config.json 丢了）会按 **80%** 跑，
     面板还把它印成「概率推送线 80%」，没人知道它本该是 82%。
3. 顺带挖出**同一条道理下的漏网之鱼**：bn 轮给**写入端**加了 CFG_RANGE 体检，但只体检
   【新提交】的值；df 轮给开关类那张表 `cfgSetOf` 补了「上界在读取端也要兜」，
   **数值键这边没补** → pushMinProb=200 从面板提交会被拦下，从手改过的 config.json
   里读出来却原样生效 → 全天一条推不出去、且不报错。
4. 再顺带挖出一个 **TDZ**：口径回滚段（原 L2697）引用了 L5030 才定义的 `_govCfg`，
   顶层执行到那里必抛 ReferenceError，被 `catch(e){console.error(...)}` 吞掉 →
   **这段回滚从来没有生效过，也不留任何痕迹**（只有 `_upgradeNote` 为真那一轮会走到）。

### 修法
- `CFG_RANGE` 每键补 `def`（默认值与 min/max/hint 同表）；`_govCfg(k)` **不再收第二参数**，
  23 个调用点全部去掉 → 默认值只剩一份。
- 读取端补**上界兜底**：越界 / 非数字 / `null` / 空串一律退回 `def`。
  ⛔ `null` 与空串视为「没配过」而不是 0 —— `Number(null) === 0` 与 `Number('') === 0`，
  而 0 在这些键上是有实义的（= 不限）；bn 轮在**写入端**堵过这个坑，读取端当时漏了同一条。
- `probThreshold` 收成唯一读取口 `probThreshold()`（量纲 0~1）：四处裸读 + 一处 `|| null`
  全部改掉。以前键坏了就是 undefined，`* 100` 之后 NaN，`probC > NaN` 恒 false
  → **整个「后排涨停概率」模块永久静默、日志一行不报**。
- 把 `CFG_RANGE` / `cfgRangeErrors` / `_govCfg` **整块前移**到回滚段之前（修 TDZ）。
- `/api/state` 下发 `cfgRange`（cur / raw / def / min / max / hint / using / bad），
  面板「🛠 工具 → 🎚 门槛 / 额度」显示当前值·默认值·越界告警 ——
  用户把门槛调乱之后想改回来，以前面板上没有任何一处写着「默认是多少」。

### 连带修的一个真事故（守门测试往线上留残留）
`_test_hold2.js` 的所有删除都带 `_noSync: true`（cf 轮定的：不许拿测试改线上），
而**本机是 replica，`/api/holdings` 会回拉线上展示** → **线上残留永远删不掉**：
`PRE` 每轮都吃到它们，最后一条断言永远红；带标记的检测票一直挂在用户手机端。
实测线上挂着 600519/000001/300750 三只（**全带 `__hold2_test__` 标记**，用户线上本为空）。
处置：① 用 `_clean_online_residue.js` 按标记清掉（无标记的一律不碰）→ 线上 0 条
② 给测试加 `purgeRemote()`：收尾连线上一起清，只删带标记的
③ **升级 `_test_test_isolation.js` 的判据**（不是削弱）：允许一个显式的远程清理出口，
   但把边界钉死 —— 只删 filter 出来的带标记项、先删后清流水、只在收尾调一次、
   没配 syncUpstream 就不打网络。原判据「任何 purgeOps 带 remote:true 都不合格」
   假设了"写线上一定是坏的"，而**清掉自己造的残留**是必要的（db 轮事故已证明）。

### 数据
守门 `_test_cfgdef.js` **103 断言 / 0 失败**（含反证：新旧写法在 200 / 82 / null 上结论确实不同）；
回归 **4183 / 0（130 套件）**；线上 appVer=20261007dg、cfgRange 11 键齐备、
probThreshold cur=def=using=0.82、**持仓 0 条**、双端同步 23ms、台账 3 条（用户 2 台 + FPUB_SYNC02）。

### 通用教训（第 21 条）
**一张表补了校验之后，要问一句「磁盘上已经躺着的旧值走不走这道校验」——
写入端拦得住新值，拦不住老文件，而老文件正是手改过、最容易越界的那一份。**
同一条原则在两张表上（CFG_SET / CFG_RANGE）必须一起落地，只落一半等于没落。

下一轮可换角度：**「同一个『没配过』在系统里到底有几种写法」** —— 除了配置键
（`_govCfg` / `cfgSetOf` / `S.learn.X || N` / 解构默认值 / 函数默认参数），
还有 K 线缺失、行情缺失、板块缺失、题材缺失这些"数据没取到"的场景，
它们各自的"中性值"是不是同一个口径（有的按 0、有的按 0.7、有的判死）。
"""

targets = [
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\2026-10-07.md",
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\2026-10-07.md",
]
for t in targets:
    d = os.path.dirname(t)
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    old = io.open(t, encoding='utf-8').read() if os.path.exists(t) else u''
    with io.open(t, 'a', encoding='utf-8', newline='\n') as f:
        f.write(ENTRY)
    print(t, '→', len(old) + len(ENTRY), 'chars')

# MEMORY.md：§9 加 dg 条目 + §10 第 21 条
P1 = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\MEMORY.md"
s = io.open(P1, encoding='utf-8').read()

ANCHOR = u"- **dd（20261007dd）只有结论、没有前提**："
assert ANCHOR in s
NEW = u"""- **dg（最新·20261007dg）同一个键的默认值在不同入口下是不是同一个**：默认值散在三种写法里 —— `_govCfg('k', 62)` 的第二参数（23 处）／`S.config` 初始对象的 `probThreshold: 0.80`／读取端的 `||` 兜底。**三处的"没配过"是三个值：0.80 / 0.82 / null**，而回滚段+hint+config.json 全是 0.82 → 全新实例按 80% 跑且面板真印出来。修法：`CFG_RANGE` 每键补 `def`，`_govCfg(k)` 不再收第二参数（23 处全去掉）；**读取端补上界兜底**（bn 轮只体检【新提交】的值，`cfgSetOf` 早补了而数值键没补 → pushMinProb=200 手改进文件就全天零推送）；⛔ `null`／空串 = 没配过不是 0（`Number(null)===0`，而 0 = 不限是有实义的）；`probThreshold()` 收成唯一读取口（四处裸读 + 一处 `|| null`，键坏了就是 NaN → 判定式恒 false → 模块永久静默）；整块前移修 TDZ（回滚段引用后方 `_govCfg` → 抛错被 catch 吞 → **这段回滚从未生效**）。`/api/state` 下发 `cfgRange`，面板「🎚 门槛 / 额度」显示当前值·默认值·越界。守门 `_test_cfgdef.js`(103)，扫描器 `_scan_dg.js`。
"""
s = s.replace(ANCHOR, NEW + ANCHOR, 1)

A2 = u"20. **凡是\"用户照着做就能达成\"的提示（报错建议、注释里的「可在面板 X」），都要当成一条待兑现的路径去核对**：面板上有入口吗？接口收这个键吗？有没有写入点？三者缺一就是空头承诺 —— 而且它会**不报错、不崩溃、面板照常显示**，只是那句话从头到尾是空的。\n"
assert A2 in s
s = s.replace(A2, A2 + u"21. **一张表补了校验之后，要问一句「磁盘上已经躺着的旧值走不走这道校验」—— 写入端拦得住新值，拦不住老文件，而老文件正是手改过、最容易越界的那一份。** 同一条原则在多张表（CFG_SET / CFG_RANGE）上必须一起落地，只落一半等于没落。\n22. **正面靶子没命中时，换角度的「另一半」而不是原地加码**：dg 轮扫「默认值分叉」得 0 个后，改成扫「默认值散在几种**写法**里」才打到 —— 收口过的东西确实收住了，别在原地打转。\n", 1)

io.open(P1, 'w', encoding='utf-8', newline='\n').write(s)
print('MEMORY.md 已更新', len(s), 'chars, CR=', s.count('\r'))

P2 = r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\MEMORY.md"
io.open(P2, 'w', encoding='utf-8', newline='\n').write(s)
print('已同步到另一工作区')
