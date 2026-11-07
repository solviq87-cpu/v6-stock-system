# -*- coding: utf-8 -*-
import io, sys, re

NEWV = '20261007dn'
NOTE = ('20261007dn：同一件事不许有两个名字（本轮新角度：同义异名与同名异义）—— '
        '「这个池本轮产出几条」实测有 4 个名字、2 条代码路径：面板读 items.length（大单/埋伏/补涨龙）· '
        'count（自定义规则）· cand（次日计划）· total（涨停前形态/趋势扫描）· 数组长度（连续收涨），'
        '任务状态读 taskState.n —— 同一个数被数了两遍，两边都是真实值所以永远不会报错，'
        '用户只会看到同一个模块两个条数。修法：① OUT_N 登记表（10 池各登记一次「条数从哪来」）+ outN() 唯一出口，'
        '未登记的池拒绝 + 报错 + 返回 0，坏值（NaN）归 0；② outWhy(n) —— 「0 条的原因」由同一个 n 派生，'
        '原来 n 走一条表达式、empty 又数一遍，六处全改；③ 前端 poolN() 只读后端下发的 outN。'
        '｜补发（dn2）：首版发布后带 token 拉线上 /api/state 实测，发现首版只统一了「名字」却没统一「量」—— '
        'ztpre 扫出 4612 只却只存 20、trendScan 扫出 2289 只存 30、steadyUp 扫出 66 只存 12：'
        '「本轮产出条数」与「池里存了几条」根本是两个量却共用一个名字，而且 taskSet 在扫描时求值、'
        'outNState 在 /api/state 时才求值 —— 求值时机不同 → 同一个池两个条数（66 vs 12）。'
        '补两处：① outN 记忆化（本轮值一旦登记就以它为准，第二次求值不许再算一遍）→ 两个出口必然是同一个数；'
        '② 补第二个量 OUT_SHOWN / outNShown（面板实际列出几条），文案在 shown < n 时明写「列出前 M 只」，'
        '不再让「有效 4612 只」与下面 20 行互相打脸。⛔ 通用教训：看到「同一个数在两处被分别算出来」要先问 '
        '—— 是两个名字还是一个量？先把量分清，再统一名字；只统一名字不分清量，等于把两个不同的数塞进同一个字段。'
        '守门 _test_outn.js（108 断言，含反证：老写法与新写法逐一相等、记忆化后两次求值同源、'
        'shown 未登记的池返回 null）；扫描器 _scan_dn.js / _scan_dn2.js / _scan_dn3.js。')

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
print('CR server:', io.open('server.js', encoding='utf-8').read().count('\r'))
print('CR html  :', io.open('public/index.html', encoding='utf-8').read().count('\r'))
