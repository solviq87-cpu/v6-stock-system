# -*- coding: utf-8 -*-
import io, re
L = io.open('public/index.html', encoding='utf-8', newline='').read().split('\n')
pats = [r'items \|\| \[\]\)\.length', r'\.count \|\| 0', r'\.cand \|\| 0', r'sy\.total', r'sy\.kept', r'\.total \|\|']
seen = set()
for i, t in enumerate(L):
    for p in pats:
        if re.search(p, t) and (i + 1) not in seen:
            seen.add(i + 1)
            print(i + 1, t.strip()[:150])
