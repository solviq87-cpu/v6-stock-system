# -*- coding: utf-8 -*-
# F2b 补修：反证的 replace 必须连 if (...) 一起吃掉，否则留下悬空的 `if (cond) }` → SyntaxError
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
    if s.count(old) != 1:
        FAILS.append(tag + ' :: 锚点命中 %d 次' % s.count(old))
        print('FAIL ' + tag + ' :: 锚点命中 %d 次' % s.count(old))
        return
    wr(path, s.replace(old, new))
    print('OK   ' + tag)

OLD = (
    "const broken = block.replace(/if \\(isBacktestSample\\(s\\)\\)[\\s\\S]*?continue;/, '')\n"
    "                    .replace(/if \\(isPostHocSample\\(s\\)\\)[\\s\\S]*?continue;/, '');"
)

NEW = (
    "// ⛔ 必须把 `if (...)` 一起吃掉：只删后半段会留下悬空的 `if (cond) }` → SyntaxError。\n"
    "//    整条语句（含花括号）一起删，才等价于原来删掉 `if (!isLiveSample(s)) continue;`。\n"
    "const _dropOut = kind => block.replace(\n"
    "  new RegExp('if \\\\(' + kind + '\\\\(s\\\\)\\\\)' + '\\\\s*\\\\{?[\\\\s\\\\S]*?continue;\\\\s*\\\\}?', 'g'), '');\n"
    "const broken = _dropOut('isPostHocSample').replace(\n"
    "  /if \\(isBacktestSample\\(s\\)\\)\\s*\\{?[\\s\\S]*?continue;\\s*\\}?/g, '');"
)

rep('_test_hindsight.js', OLD, NEW, 'F2b 反证正则连 if 一起吃')

print('\n==== FAILS: %d ====' % len(FAILS))
sys.exit(1 if FAILS else 0)
