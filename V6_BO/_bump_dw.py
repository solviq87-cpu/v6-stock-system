# -*- coding: utf-8 -*-
# dw 轮：升 APP_VER（两处），按内容定位，绝不按行号
import io, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))

OLD = "20261007dv"
NEW = "20261007dw"

NOTE = (
    NEW + u"：那些只有一半入口会走到的「补救」动作。系统里散着一批补救（启动首扫／启动补样本／复盘重启补发／"
    u"K线补齐／回拉对账），它们的共同点是**机会有限**（启动链上只跑 2~3 次、探测 30 次就放弃），"
    u"而以前「完成」的判据是「跑过了」而不是「补出来了」。实证一：**启动首扫把返回值丢掉了** —— "
    u"`const r = await scanTrendUniverse(30)` 赋完再没人看，而 `_bootScanDone = true` 写在 catch **之后**无条件执行："
    u"撞上 _tsBusy（返回 {running:true}，这次根本没启动）、抛异常被 catch 吞掉、三池全是 0 只 —— "
    u"三种情况全都宣告「启动首扫完成」，30 次探测机会立刻归零。而同一个 scanTrendUniverse 在手动入口 "
    u"/api/scan-trend 是**判了 r.running 的**（会 pushLog「⏭ 全市场扫描未启动」）—— "
    u"同一个补救，一个入口负责、另一个入口不负责。实证二：**复盘重启补发只有 2 次机会**（启动 2 分钟／8 分钟），"
    u"而五个 return 全是静默的：8 分钟那次若撞上 reviewBusy 或涨停池没回来，当天补发就彻底消失，"
    u"用户只看到「今天没有复盘」，无从自查。修法：登记 REMEDY_RULE（机会数）+ REMEDY_WHY（补失败的四种说法）"
    u"+ REMEDY_SKIP（机会被跳过的原因，未登记的一律丢弃并报错），唯一出口 remedyDone（判「到底跑没跑」—— "
    u"running／异常不算完成、保留机会下次再试；跑完了但 0 条算跑完但必须留痕告警，不再白扫 30 遍）"
    u"／remedySkip／remedyState；/api/state 下发 remedy，面板在补救没补上时亮黄色徽标。"
    u"⛔ 通用教训：**补救的完成判据是「补出来了」，不是「跑过了」**；且补救被跳过消耗的是**有限的机会**，"
    u"跟普通判据跳过不是一回事 —— 跳过一次就少一次，必须留下原因。"
)

FILES = ['server.js', 'public/index.html']
for f in FILES:
    with io.open(f, 'r', encoding='utf-8') as fh:
        lines = fh.readlines()
    hit = 0
    for i, l in enumerate(lines):
        if l.startswith('const APP_VER = '):
            lines[i] = "const APP_VER = '" + NEW + "'; // " + NOTE + "\n"
            hit += 1
    if hit != 1:
        print('FAIL %s :: APP_VER 命中 %d 次' % (f, hit))
        sys.exit(1)
    with io.open(f, 'w', encoding='utf-8', newline='\n') as fh:
        fh.writelines(lines)
    print('OK   %s 替换 %d 处' % (f, hit))
print('done')
