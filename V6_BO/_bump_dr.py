# -*- coding: utf-8 -*-
# dr 轮升版本：20261007dq -> 20261007dr
import io, re, sys

NEW_VER = '20261007dr'

NOTE = (
    '20261007dr：同一个数，在两个人眼里是不是同一个东西（本轮新角度 —— 前几轮收的都是**系统内部**'
    '口径一致：名字／键名／加工／时点；再往外一层是**系统说的和用户理解的是不是一回事**）。'
    '实证两处：'
    '① **百分点没有单位**：两个百分比相减得到的是**百分点（pp）**，不是百分比。'
    '而同一个「溢价 lift」（封板概率 − 基准概率）在项目里有**四种写法**：'
    '`+5.2pp` / 裸 `+5.2` / `平均+5.2点` / 前端写死正号的 `+${lift}pp`。'
    '裸的那种最危险 —— 用户读到「封板 62%（溢价 +5.2）」会以为那是 5.2%，而 62% 与 5.2% 完全不是一回事；'
    '写死正号的那种在负溢价时打出 `+-3.2pp`、配色还是红的（跌了显示成涨）；'
    '用「点」的也有歧义 —— 股民说「涨了 50 点」指的是**上证指数点位**，不是百分点。'
    '② **同一个卡片上两个百分比，基准不同却都不标**：持仓卡片顶部大号 `+8.5%` 是**相对成本价的浮盈比例**，'
    '下面「现价 10.5 +3%」是**当日涨跌幅**，两个挨着却都没说相对什么 —— 用户会把 8.5% 当成今天涨的。'
    '修法：NUM_UNIT 登记表（每个「两个百分比相减得到的数」声明单位 pp 并写明为什么）+ `ppTxt(v, signed)` '
    '唯一出口（null/NaN → 「-」，⛔ 不许显示成 0pp 冒充「没有差距」；判空在转数字之前）+ '
    '前端正负号与配色一律走 sign()/cls()，不再写死 `+` 与 `up`；持仓卡片两个百分比各自标「浮盈」与「当日」。'
    '⛔ 通用教训：看到「一个光秃秃的数字」就要问两句 —— '
    '（a）**它是怎么来的**？两个百分比相减得到的数，单位是百分点不是百分比，必须带出来；'
    '（b）**它是相对什么的**？涨跌幅相对昨收、收益率相对成本、回撤相对区间高点，'
    '同一个「X%」在系统里可以有好几个基准，挨着摆时必须各自标出来。'
    '顺带一条：**正负号与配色不许写死**（写死 `+` 会让负数显示成 `+-3.2`，写死 up 会让下跌显示成红色）。'
    '守门 _test_ppunit.js（44 断言，含反证：老写法碰负数打出 "+-3.1"、碰 null 打出 "+null"）；'
    '扫描器 _scan_dr.js（百分比表述／「相对什么」说明词／今日标签／单位混用／区间 vs 点值／pp 与「点」）。'
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
