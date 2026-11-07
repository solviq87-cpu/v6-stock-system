# -*- coding: utf-8 -*-
# dq 轮升版本：20261007dp -> 20261007dq
import io, re, sys

NEW_VER = '20261007dq'

NOTE = (
    '20261007dq：同一个数，在不同时间被问是不是同一个数（本轮新角度 —— dp 轮「算出来之后被改过几道」'
    '再往外一层：**比对时点的口径**。系统里到处在比「今天的 X」和「昨天的 X」「上次的值」「均值」「阈值」，'
    '却很少声明**拿哪一份、在什么时点比的**。本轮实证两处：'
    '① **板块资金突增的基线跨了天**：主力净流入是**当日累计**（FLOW_WIN 就是「当日累计」），跨天归零，'
    '而基线存在内存 Map 里、连续运行过夜也不会清。于是开盘拿今天的累计去减昨天的累计，'
    '减出来的「增量」横跨两个累计周期 —— 实证：某板块昨天净流出 2 亿、今天开盘才流入 1000 万，'
    '做差得 2.1 亿，直接越过 3000 万的突增门槛 → 开盘就误报「资金突增 2.1 亿」，而当天真实流入只有 1000 万。'
    '⛔ 原先只判了「基线在不在」，那只挡得住**首次运行**，挡不住**跨天** —— 两种情况基线都存在。'
    '② **资金留存 retain 的窗口是隐式的**：它等于轨迹首尾两根的差，名义窗口 10 分钟，'
    '但实际跨度取决于轨迹里攒了多少根（刚启动只有几秒）。同一个「+500 万」在 10 分钟窗口与 30 秒窗口里'
    '是完全不同的强度（后者折算每分钟强 20 倍），面板却一律只标「资金留存」。'
    '修法：PREV_SNAP 登记表（每份「存起来下一轮做差」的快照声明自己的时点口径 kind=dayCum）+ '
    'prevSnapUsable/prevSnapMark/prevSnapState 三个唯一出口 —— 做差前先验基线是不是同一个累计周期，'
    '跨天就只建档不比较；并把「这基线是哪天建的」下发给面板（⛔ 只在日志里说的结论等于没说）。'
    'retain 则随值返回实际窗口秒数 + 后端产出整句文案，前端改读整句。'
    '⛔ 通用教训：看到「拿上一次的值做差」就要问两句 —— '
    '（a）**这个量是当日累计还是绝对值**？当日累计跨天归零，两天的累计数不能相减；'
    '（b）**这个差值的窗口是谁定的**？名义窗口与实际跨度不一致时，必须把实际跨度一起交出去。'
    '守门 _test_prevsnap.js（40 断言，含反证：跨天做差得出 2.1 亿而真实流入只有 1000 万）；'
    '扫描器 _scan_dq.js（上一次变量清单／做差点／内存缓存是否落盘／做差时有没有判同一天）。'
    '附带记录：全项目 11 个「上一次」缓存**无一落盘**，重启即清零（板块基线、学习融合缓存、'
    '各类推送去重表都是），目前都只影响降噪不影响正确性，暂不改。'
)

def bump(path):
    s = io.open(path, encoding='utf-8').read()
    lines = s.split('\n')
    out, n = [], 0
    for l in lines:
        if l.startswith('const APP_VER = '):
            out.append("const APP_VER = '%s'; // %s" % (NEW_VER, NOTE))
            n += 1
        else:
            out.append(l)
    if n != 1:
        print('FAIL %s: matched %d lines' % (path, n)); sys.exit(1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
    print('OK %s -> %s' % (path, NEW_VER))

bump('server.js')
bump('public/index.html')

a = io.open('server.js', encoding='utf-8').read()
b = io.open('public/index.html', encoding='utf-8').read()
va = re.search(r"const APP_VER = '([^']+)'", a).group(1)
vb = re.search(r"const APP_VER = '([^']+)'", b).group(1)
if va != vb or va != NEW_VER:
    print('FAIL verify: server=%s html=%s' % (va, vb)); sys.exit(1)
for p in ('server.js', 'public/index.html'):
    cr = io.open(p, encoding='utf-8').read().count('\r')
    if cr: print('FAIL CRLF %s = %d' % (p, cr)); sys.exit(1)
print('VERIFY OK: %s  CRLF=0' % va)
