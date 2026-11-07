# -*- coding: utf-8 -*-
"""dg 轮：升 APP_VER（两端，按内容定位，不许用固定行号）"""
import io

NOTE = (
    "20261007dg：同一个配置键的默认值，在所有入口下必须是同一个数（本轮新角度）。"
    "默认值以前散在三处：① `_govCfg('simGate', 62)` 这样写在调用点第二个参数里的 —— 23 处调用、"
    "11 个键，改一个键要同时改六处；② S.config 初始对象里的 `probThreshold: 0.80`；"
    "③ 读取端的 `||` 兜底（`+(S.config.probThreshold || 0)` 与 `(S.config && …) || null`）。"
    "三处的「没配过」根本不是同一个值：初始对象说 80%，而口径回滚段、CFG_RANGE 的 hint、"
    "线上 config.json 全是 82% —— **全新实例（config.json 丢了）会按 80% 跑**，面板还会把"
    "「概率推送线 80%」印出来，没人知道它本该是 82%。"
    "更隐蔽的是同一条道理下的另一半：bn 轮给**写入端**加了 CFG_RANGE 体检，但只体检【新提交】的值；"
    "df 轮给开关类那张表（cfgSetOf）补了「上界在读取端也要兜」，数值键这边却漏了 —— "
    "config.json 是手改得动的文件，pushMinProb=200 从面板提交会被拦下，从文件里读出来却原样生效"
    "→ 全天一条推不出去，且不报错。修法：① CFG_RANGE 每键补 def，默认值与 min/max 同表；"
    "`_govCfg(k)` 不再收第二参数，23 个调用点全部去掉（默认值只剩一份）；"
    "② 上界在读取端兜住，越界 / 非数字退回 def；⛔ `null` 与空串一律视为「没配过」而不是 0 —— "
    "`Number(null) === 0`，而 0 在这些键上是有实义的（= 不限），bn 轮在写入端堵过这个坑，"
    "读取端当时漏了同一条；③ probThreshold 收成唯一读取口 `probThreshold()`（量纲是 0~1），"
    "四处裸读与一处 `|| null` 全部改掉 —— 以前键坏了就是 undefined，`* 100` 之后变 NaN，"
    "判定式 `probC > NaN` 恒 false → 整个模块永久静默、日志一行不报；"
    "④ 顺带修一个 TDZ：口径回滚段在 2697 行引用了 5030 行才定义的 `_govCfg`，顶层执行到那里"
    "必抛 ReferenceError 并被 catch 吞掉 → **这段回滚从来没生效过，也不留任何痕迹**；"
    "现在把 CFG_RANGE / cfgRangeErrors / _govCfg 整块前移到回滚段之前；"
    "⑤ /api/state 下发 cfgRange（当前值 / 默认值 / 越界标记），面板「🛠 工具 → 🎚 门槛 / 额度」"
    "把它显示出来 —— 用户把门槛调乱之后想改回来，以前面板上没有任何一处写着「默认是多少」。"
    "⛔ 通用教训：一张表补了校验之后，要问一句「磁盘上已经躺着的旧值走不走这道校验」——"
    "写入端拦得住新值，拦不住老文件，而老文件正是手改过、最容易越界的那一份。"
    "守门 _test_cfgdef.js（103 断言，含反证：新旧写法在 200 / 82 / null 上结论确实不同）；"
    "扫描器 _scan_dg.js。"
)


def bump(path):
    src = io.open(path, encoding='utf-8').read()
    lines = src.split('\n')
    hit = 0
    for i, l in enumerate(lines):
        # ⛔ 按内容定位：固定行号会打崩
        if l.startswith('const APP_VER = '):
            lines[i] = "const APP_VER = '20261007dg'; // " + NOTE
            hit += 1
    assert hit == 1, '%s 命中 %d 处 APP_VER' % (path, hit)
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print('%s → %d 处已升版' % (path, hit))


bump(r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\server.js")
bump(r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\public\index.html")
