# -*- coding: utf-8 -*-
# 把 dq 轮新增文件登记进 _publish.py 的 CODE_FILES
import io, sys

P = '_publish.py'
s = io.open(P, encoding='utf-8').read()

ANCHOR = '              "_scan_dp2.js",'
if s.count(ANCHOR) != 1:
    print('FAIL: anchor count = %d' % s.count(ANCHOR)); sys.exit(1)

# 定位 _scan_dp2.js 那一行的行尾
i = s.index(ANCHOR)
j = s.index('\n', i)
ADD = (
    '\n              "_test_prevsnap.js",  # 守门测试：dq 轮 —— 同一个数在不同时间被问是不是同一个数。'
    '① 板块资金突增的基线存在内存 Map 里跨天不清，而主力净流入是**当日累计**跨天归零 → '
    '开盘拿今天累计减昨天累计，实证昨天流出 2 亿、今天流入 1000 万却算出 2.1 亿增量，越过 3000 万门槛误报突增。'
    '⛔ 原判据只问基线在不在，挡得住首次运行、挡不住跨天。'
    '② 资金留存 retain 名义窗口 10 分钟、实际跨度随轨迹长度变化（刚启动只几秒），面板却一律只标「资金留存」。'
    '修法 PREV_SNAP 登记表（每份做差快照声明时点口径 kind=dayCum）+ prevSnapUsable/Mark/State 三个唯一出口'
    '（跨天只建档不比较，并把基线日期下发给面板）+ retain 随值返回实际窗口与整句文案。'
    '沙箱真跑（40 断言），含反证：跨天做差算出 2.1 亿而真实流入只有 1000 万'
    '\n              "_scan_dq.js",  # 扫描器：dq 轮 —— 「上一次」变量清单（last/prev/old/snap 等 60+ 个）、'
    '做差比较点、内存 Map 缓存是否落盘（实测 11 个无一落盘）、做差时有没有判同一天（44 处没判）'
)

s = s[:j] + ADD + s[j:]
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK: _test_prevsnap.js / _scan_dq.js 已登记进 CODE_FILES')
