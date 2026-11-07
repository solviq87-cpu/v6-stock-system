# -*- coding: utf-8 -*-
"""版本号统一升级（避免各文件手写不一致导致前端无限 reload）。"""
import ast
import glob
import os
import re

OLD = '20261023kt'
NEW = '20261024ku'
F = '_publish.py'

# ① public/index.html
p = 'public/index.html'
h = open(p, encoding='utf-8').read()
m = re.search(r"((?:const|let|var)\s+APP_VER\s*=\s*')([^']+)(')", h)
if m:
    print('前端:', m.group(2), '→', NEW)
    h = h[:m.start(2)] + NEW + h[m.end(2):]
else:
    raise SystemExit('前端没找到 APP_VER 定义')
open(p, 'w', encoding='utf-8', newline='\n').write(h)

# ② server.js
s = open('server.js', encoding='utf-8').read()
if "const APP_VER = '%s';" % OLD in s:
    s = s.replace("const APP_VER = '%s';" % OLD, "const APP_VER = '%s';" % NEW)
elif "const APP_VER = '%s';" % NEW in s:
    print('server.js 已是 %s' % NEW)
else:
    raise SystemExit('server.js 没找到 APP_VER')
open('server.js', 'w', encoding='utf-8', newline='\n').write(s)

# ③ 测试断言
for f in sorted(glob.glob('_test_*.js')):
    t = open(f, encoding='utf-8').read()
    if OLD in t:
        open(f, 'w', encoding='utf-8', newline='\n').write(t.replace(OLD, NEW))
        print('断言更新:', f)

# ④ logic.js 进发布清单
t = open(F, encoding='utf-8').read()
old = '              "learnall.js"]     # 全A股走势自主学习引擎 v0（2026-09-29 新增）'
new = ('              "learnall.js",     # 全A股走势自主学习引擎 v2（2026-09-29 新增）\n'
       '              "logic.js"]        # 驱动归因：情绪票 vs 硬逻辑票（2026-09-30 新增）')
if old in t:
    t = t.replace(old, new, 1)
    open(F, 'w', encoding='utf-8', newline='\n').write(t)
    print('✅ CODE_FILES 已加入 logic.js')
elif '"logic.js"' in t:
    print('logic.js 已在清单里')
else:
    raise SystemExit('没找到 learnall.js 锚点')
ast.parse(open(F, encoding='utf-8').read())
print('全部完成')
