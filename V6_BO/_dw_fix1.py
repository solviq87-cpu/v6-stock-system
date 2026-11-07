# -*- coding: utf-8 -*-
# dw 轮：_test_holiday_push 钉死 `_reviewStartupCheck` 里的旧字面量（改判据不改实现）
import io, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

def rd(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

def rep(path, old, new, tag):
    s = rd(path)
    n = s.count(old)
    if n != 1:
        FAILS.append(tag + ' :: 锚点命中 %d 次' % n)
        print('FAIL ' + tag + ' :: 锚点命中 %d 次' % n)
        return
    wr(path, s.replace(old, new))
    print('OK   ' + tag)

rep('_test_holiday_push.js',
    u"ok('_reviewStartupCheck 排除法定假日 isTradeDay(d)',\n"
    u"  /const _reviewStartupCheck = \\(\\) =>[\\s\\S]{0,500}?if \\(!isTradeDay\\(d\\)\\) return;/.test(s));",
    u"// ⛔ dw 轮：这处 return 现在带上了 remedySkip 留痕（补救跳过=消耗机会，必须留原因）→\n"
    u"//    断言改成钉语义：休市日判定仍在、且必须**当场 return**（不许继续往下补发）。\n"
    u"ok('_reviewStartupCheck 排除法定假日 isTradeDay(d)',\n"
    u"  /const _reviewStartupCheck = \\(\\) =>[\\s\\S]{0,600}?if \\(!isTradeDay\\(d\\)\\)[^\\n]*\\breturn;/.test(s));\n"
    u"ok('_reviewStartupCheck 休市日跳过也要留原因（dw：补救跳过=消耗一次机会）',\n"
    u"  /const _reviewStartupCheck = \\(\\) =>[\\s\\S]{0,600}?isTradeDay\\(d\\)\\)\\s*\\{\\s*remedySkip\\('reviewBoot', 'reviewNotTrade'\\);/.test(s));",
    'holiday_push 改判据')

print('\n==== FAILS: %d ====' % len(FAILS))
sys.exit(1 if FAILS else 0)
