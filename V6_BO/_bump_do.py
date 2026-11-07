# -*- coding: utf-8 -*-
import io, sys, re

NEWV = '20261007do'
NOTE = ('20261007do：同一个键名，在后端与接口里是不是同一个值（本轮新角度 —— dn 轮「同一件事两个名字」'
        '往里一层的**同名异义**：同一个键在不同分支里装的不是同一种东西）。'
        'dn 轮给「本轮产出条数」建了 OUT_N + OUT_SHOWN，但只覆盖了 taskSet 登记的那 10 个池；'
        '而 **/api/state 里还有一批数组是截断之后才下发的**，它们的真实总数压根没下发：'
        'trendPool 是 `S.trendPool.slice(0,50)`，而 S.trendPool 是**无上限** push 出来的；'
        'sectors slice(0,20)、ztTopics slice(0,8)、learnHistory slice(0,100)、smallyang.items slice(0,15)。'
        '于是**同一个键名在后端是完整池、在接口里是截断快照** —— 两个不同的值共用一个名字，'
        '而面板直接拿截断后的 `.length` 当真实总数报给用户：`共 ${s.trendPool.length} 只` '
        '—— 池里 60 只时也只说 50 只，而且一声不吭。（精选池没这问题：它有独立的 poolSize 总数键，'
        '所以同样是截断下发却是对的 —— 差别就在「总数有没有另一个键装着」。）'
        '修法：STATE_CUT 登记表（每个截断数组声明 cap 上限 + total 真实总数来源，cap=0 表示不截断）'
        '+ stateCut() 唯一出口下发 {label, cap, total, shown} + 前端 cutN/cutShown 只读它、'
        '复用 dn 轮的 poolCut 在截断时明写「列出前 M 只」。'
        '⛔ 通用教训：看到「接口里这个数组被 slice 了」就要问一句 —— **它的总数还有别的键装着吗**？'
        '没有的话，消费方拿到的长度就是被悄悄改过的数；截断本身没错，错的是把截断后的长度当成总数说出去。'
        '守门 _test_statecut.js（69 断言，含反证：池里 60 只时老写法说 50、新写法说 60 并能明说列出前 50）；'
        '扫描器 _scan_do.js（S.xxx 赋值类型 / time 语义分布 / 前端用法 / 接口返回类型）、'
        '_scan_do7.js（截断数组 × 前端条数展示）、_chk_do4.py（把线上真实 state 喂进前端模板求值）。'
        '｜另记录三处确认的**键名债务**（目前无消费者踩坑，但是双轨温床）：'
        '`pushGov.codes` 装的是数量（数字）而全项目其余 5 处 codes 都是代码数组；'
        '`peers[].n` 装的是股票名（字符串）而其余 n 都是数字；'
        '`jumpy` 在 trendRej 里是计数（233）、在票对象里是判定标志（false）。')

for P in ('server.js', 'public/index.html'):
    lines = io.open(P, encoding='utf-8').read().split('\n')
    hit = 0
    for i, l in enumerate(lines):
        if l.startswith('const APP_VER = '):
            lines[i] = "const APP_VER = '%s'; // %s" % (NEWV, NOTE)
            hit += 1
    if hit != 1:
        print('FAIL %s hit=%d' % (P, hit)); sys.exit(1)
    io.open(P, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
    print('OK  %s -> %s' % (P, NEWV))

P = '_publish.py'
s = io.open(P, encoding='utf-8').read()
ANCH = '              "_test_outn.js",'
if s.count(ANCH) != 1:
    print('FAIL publish anchor count=%d' % s.count(ANCH)); sys.exit(1)
ADD = (
  '              "_test_statecut.js",  # 守门测试：/api/state 里「截断下发的数组」必须同时下发真实总数（2026-10-07 do，本轮新角度：同一个键名在后端与接口里是不是同一个值）。dn 轮的 OUT_N + OUT_SHOWN 只覆盖了 taskSet 那 10 个池，而 /api/state 里还有一批数组是 slice 之后才下发的：trendPool slice(0,50)（而 S.trendPool 是无上限 push 出来的）、sectors slice(0,20)、ztTopics slice(0,8)、learnHistory slice(0,100)、smallyang.items slice(0,15) —— 同一个键名在后端是完整池、在接口里是截断快照，面板却直接拿截断后的 .length 当总数报（`共 ${s.trendPool.length} 只`，池里 60 只也只说 50 只）。精选池没这问题，因为它有独立的 poolSize 总数键 —— 差别就在「总数有没有另一个键装着」。修法：STATE_CUT 登记表（cap 上限 + total 真实总数来源，cap=0 表示不截断）+ stateCut() 唯一出口 + 前端 cutN/cutShown + 复用 dn 的 poolCut 明写「列出前 M 只」。测试沙箱真跑 STATE_CUT/stateCut（69 断言），含反证：60 只时老写法说 50、新写法说 60 且能明说列出前 50\n'
  '              "_scan_do.js",  # 扫描器：do 轮第一遍 —— ① S.xxx 被赋成多种类型的键（59 个键中 16 个多类型，逐条核过均为 `S.x || {}` 兜底写法，非异义）② time 字段语义分布（当前时刻 28 / 数据自带 10 / 空 7 / 带日期 3 / 时间戳 3）③ 前端对同一键的多种用法 ④ 同一路由 json(res,…) 返回类型\n'
  '              "_scan_do7.js",  # 扫描器：do 轮第七遍 —— /api/state 里带 slice 截断的数组字段逐个列出（trendPool 50 / sectors 20 / ztTopics 8 / learnHistory 100 / ztPre 20 / trendScan 30 / steadyUp 12），并对照前端把这些 .length 显示成「N 只」的位置（命中 trendPool 一处）\n'
  '              "_chk_do4.py",  # 核验：把线上真实 /api/state 喂进前端模板的每个裸插值求值，找 undefined / [object Object] / NaN —— 「键的类型与消费方假设不一致」的最终表现（实测除局部形參误报外 0 处真问题）\n'
)
s = s.replace(ANCH, ADD + ANCH)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK  _publish.py 登记新文件')
