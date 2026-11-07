# -*- coding: utf-8 -*-
import io, sys, re

OLDV = '20261007dm'
NEWV = '20261007dn'
NOTE = ('20261007dn：同一件事不许有两个名字（本轮新角度：同义异名与同名异义）—— '
        '全项目里「这个池本轮产出几条」实测有 **4 个名字、2 条代码路径**：面板侧读 '
        'items.length（大单/埋伏/补涨龙）· count（自定义规则）· cand（次日计划）· '
        'zpg.total / _tsp.total（涨停前形态/趋势扫描）· su.length（连续收涨），'
        '而「🩺 各模块本轮状态」读的是 taskState 里的 n —— 同一个池的条数在同一时刻被**数了两遍**，'
        '两边都是自己那一瞬间的真实值，所以两边都不会报错、谁也不会发现，'
        '用户只会看到同一个模块显示两个不一样的条数。'
        '修法：① OUT_N 登记表（10 个池各自只登记一次「条数从哪来」）+ outN(pool, fresh) 唯一出口 '
        '（传了本轮值就用本轮值，表里 from 只是没传时的默认来源，二者是同一个数）；'
        '未登记的池拒绝 + console.error + 返回 0，坏值（NaN）一律归 0 不许穿透成 "undefined 只"；'
        '② outWhy(n) —— 「0 条的原因」必须由同一个 n 派生，原来 n 走一条表达式、empty 又自己数一遍'
        '（`n: outN(\'bigmoney\')` 配 `empty: S.bigMoney.items.length ? …`），六处全部改走 outWhy；'
        '③ 前端 poolN(s, pool, fallback) 只读后端 /api/state 下发的 outN，后端没下发（旧版本/还没算）'
        '才回落本地值；七个条数展示点全部改走它（含补漏：连续收涨 suInfo 原在数 su.length）。'
        '⛔ 通用教训：看到「同一个数在两处被分别算出来」就要问一句 —— 这两处会不会分叉？'
        '分叉的特征就是**两边都没错**，所以永远不会有人报错。守门 _test_outn.js（87 断言，'
        '含反证：老写法 items.length / count / cand / total 与新写法逐一相等）；扫描器 _scan_dn.js / _scan_dn2.js / _scan_dn3.js。')

# ── ① server.js / index.html：APP_VER 行 ──
for P, pat in (('server.js', re.compile(r'^const APP_VER = ')),
               ('public/index.html', re.compile(r'^const APP_VER = '))):
    lines = io.open(P, encoding='utf-8').read().split('\n')
    hit = 0
    for i, l in enumerate(lines):
        if pat.match(l):
            lines[i] = "const APP_VER = '%s'; // %s" % (NEWV, NOTE)
            hit += 1
    if hit != 1:
        print('FAIL %s hit=%d' % (P, hit)); sys.exit(1)
    io.open(P, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
    print('OK  %s APP_VER -> %s' % (P, NEWV))

# ── ② _publish.py：登记本轮新文件 ──
P = '_publish.py'
s = io.open(P, encoding='utf-8').read()
ANCH = '              "_scan_dl.js",'
if s.count(ANCH) != 1:
    print('FAIL publish anchor count=%d' % s.count(ANCH)); sys.exit(1)
ADD = (
  '              "_test_outn.js",  # 守门测试：同一件事不许有两个名字（2026-10-07 dn，本轮新角度：同义异名与同名异义）—— '
  '「这个池本轮产出几条」实测有 4 个名字、2 条代码路径：面板读 items.length（大单/埋伏/补涨龙）· count（自定义规则）· '
  'cand（次日计划）· total（涨停前形态/趋势扫描）· 数组长度（连续收涨），任务状态读 n —— 同一个数被数了两遍，'
  '两边都是真实值所以永远不会报错，用户只会看到同一个模块两个条数。修法：OUT_N 登记表 + outN() 唯一出口 '
  '+ outWhy()（0 条原因不许再数第二遍，六处 empty 双轨全改）+ 前端 poolN() 只读后端下发的同一个数（七个展示点，'
  '含补漏 suInfo）。测试沙箱真跑 OUT_N/outN/outWhy/outNState（87 断言），含反证：老写法与新写法逐一相等，'
  '未登记的池报错且返回 0，NaN 不许穿透\n'
  '              "_scan_dn.js",  # 扫描器：dn 轮体检 —— ① 「产出条数」的九种叫法（n 193 / total 21 / count 8 / scanned 12 / kept 1 / universeN 4 / added 5 / hit 16）② n: 89 处里压着的六种语义 ③ time: 53 处装的四种语义（当前时刻/数据自带/时间戳/空）④ 同义异名与同名异义候选清单\n'
  '              "_scan_dn2.js",  # 扫描器：dn 轮第二遍 —— ⑤ 逐池比对「面板读条数」与「任务状态读条数」两条代码路径（bigMoney/pre/buzhang/myrules/nextplan/steadyUp 六池全部双轨）⑥ 改名改一半留下的双轨痕迹\n'
  '              "_scan_dn3.js",  # 扫描器：dn 轮第三遍 —— taskSet 调用点逐条取出 n / empty 字段值归类，确认 7 个池全部走 outN、6 处 empty 全部走 outWhy（修完后可复跑验证）\n'
)
s = s.replace(ANCH, ADD + ANCH)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
n = len(re.findall(r'"_test_[^"]+\.js"', s))
print('OK  _publish.py 登记新文件（CODE_FILES 现 %d 条 _test_）' % n)
