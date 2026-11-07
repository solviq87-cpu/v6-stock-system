# -*- coding: utf-8 -*-
import io, sys

TARGET = '20261007dl'   # 与 APP_VER 一致：两端不同步 → 前端无限 reload

def bump(path, pref):
    src = io.open(path, encoding='utf-8', newline='').read()
    out, n = [], 0
    for l in src.split('\n'):
        if l.startswith(pref):
            old = l
            # ⛔ 按内容定位，不按行号 —— server.js:37 / index.html:1453 是超长版本注释行
            i = l.find("'")
            j = l.rfind("'")
            if i < 0 or j <= i:
                i = l.find('"'); j = l.rfind('"')
            l = l[:i] + "'" + TARGET + "'" + l[j + 1:]
            print('  %s: %s -> %s' % (path, old.strip()[:60], l.strip()[:60]))
            n += 1
        out.append(l)
    if n != 1:
        print('FAIL %s 命中 %d 处' % (path, n)); sys.exit(1)
    io.open(path, 'w', encoding='utf-8', newline='').write('\n'.join(out))

bump('server.js', 'const APP_VER = ')
bump('public/index.html', 'const APP_VER = ')
print('APP_VER ->', TARGET)
