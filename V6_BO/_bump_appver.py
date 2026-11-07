# -*- coding: utf-8 -*-
"""发布工具链：统一升 APP_VER（四端一致，避免 PWA 缓存钉死旧版 / 前端无限 reload）。
OLD/NEW 按本轮改。
"""
import glob, os

OLD = '20261027mn'
NEW = '20261027mo'
ASSIGN = "const APP_VER = '%s';" % OLD
ASSIGN_NEW = "const APP_VER = '%s';" % NEW

# 四端（server.js 是真相源；index/mobile/sw 必须与之一致）
ENDS = ['server.js', 'public/index.html', 'public/mobile.html', 'public/sw.js']

for p in ENDS:
    t = open(p, encoding='utf-8').read()
    if ASSIGN not in t:
        raise SystemExit('❌ %s 没找到赋值 `%s`' % (p, ASSIGN))
    # 只替换「赋值」那一行，绝不碰注释里的历史版本引用
    t2 = t.replace(ASSIGN, ASSIGN_NEW, 1)
    open(p, 'w', encoding='utf-8', newline='\n').write(t2)
    print('✅ 升版:', p)

# 守门测试里耦合版本号的断言一并更新（沿用 _bump_ver.py 的既有惯例）
n = 0
for f in sorted(glob.glob('_test_*.js')):
    t = open(f, encoding='utf-8').read()
    if OLD in t:
        open(f, 'w', encoding='utf-8', newline='\n').write(t.replace(OLD, NEW))
        n += 1
if n:
    print('✅ 同步更新 %d 个测试断言里的版本引用' % n)

# 校验四端
for p in ENDS:
    t = open(p, encoding='utf-8').read()
    assert ASSIGN_NEW in t, '❌ %s 未升到 %s' % (p, NEW)
    assert ASSIGN not in t, '❌ %s 仍残留 %s' % (p, OLD)
print('🔒 四端一致校验通过，全部 =', NEW)
print('DONE')
