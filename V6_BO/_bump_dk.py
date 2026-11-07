# dk 轮：升版本 20261007dj -> 20261007dk + 登记发布清单
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    s2 = fn(s)
    if s2 is None:
        print('失败:', p); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))

def bump(s, tag):
    out, n = [], 0
    for l in s.split('\n'):
        if l.startswith('const APP_VER = '):
            old = l
            l = l.replace("'20261007dj'", "'20261007dk'")
            n += 1
            print('  %s: %s -> %s' % (tag, old[:40], l[:40]))
        out.append(l)
    if n != 1:
        print('  !! %s APP_VER 命中 %d 次（应 1）' % (tag, n)); sys.exit(1)
    return '\n'.join(out)

rw('server.js', lambda s: bump(s, 'server.js'))
rw('public/index.html', lambda s: bump(s, 'index.html'))

NEW = [
    ('_test_fail.js', u'# 守门测试：同一个「失败」在系统里必须有同一套说法（2026-10-07 dk，本轮新角度）—— 实测同一个「这一轮没跑成」有 5 种说法：写 {ok:false}（面板看得见）／return null（调用方当没数据）／console.error 后继续（面板照样显示上一次成功的数据，看起来刚跑完）／pushLog(❌)（只有流水里看得到）／**174 处空 catch 静默**。不对称的实测：涨停前形态／全市场趋势扫描／K线回填三个任务早有本轮状态（cu 轮修的），而**大单流入／启动前埋伏／相似跟随／连续收涨／学习入库一个都没有** —— 同一类事件在这头看得见、在那头毫无痕迹。修法：FAIL_RULE 登记每类场景该用哪种说法（task→state／fetch→null／persist→log／async→push／bypass→silent，只有纯装饰性旁路允许静默且必须显式登记）；TASK_RULE 登记 9 个周期任务，一律走 taskSet 唯一出口，三态 ok=null(没跑)/true/false 可区分；原有三个进度对象 zpProgSet／tsProgSet／_kbfProg 并入统一出口；面板「🩺 各模块本轮状态」一处看全，失败原因挂在 title 上。测试沙箱真跑 FAIL_RULE/taskSet/taskState（61 断言），含反证：只 finally 的旧写法失败后不留任何痕迹'),
    ('_scan_dk.js', u'# 扫描器：dk 轮配套体检 —— ① 失败出口写法统计（return null 43 / return {ok:false} 23 / return [] 8 / return false 45 / console.error 114 / 空 catch 174 / pushLog❌ 12）② 每个 catch 块里到底留了什么痕迹 ③ 各区块「本轮跑没跑成」状态字段是否齐 ④ em.js 各取数函数失败返回值口径'),
]

def add(s):
    lines = s.split('\n')
    idx = None
    for i, l in enumerate(lines):
        if '"_scan_dj.js"' in l:
            idx = i
            break
    if idx is None:
        print('  !! 找不到 _scan_dj.js 锚点'); sys.exit(1)
    indent = lines[idx][:len(lines[idx]) - len(lines[idx].lstrip())]
    ins = ['%s"%s",  %s' % (indent, name, note) for name, note in NEW]
    lines[idx + 1:idx + 1] = ins
    print('  插入 %d 行' % len(ins))
    return '\n'.join(lines)

rw('_publish.py', add)
print('全部完成')
