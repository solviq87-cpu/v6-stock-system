# -*- coding: utf-8 -*-
# du 轮：给三个模拟盘守门套件补注入 DATA_CAP / dataCapOf
# ⛔ 第 N 次踩这个坑：paperAudit 新增依赖后，所有注入它的沙箱都会 ReferenceError 崩掉（不是变红）
import io

FILES = ["_test_basis_gap.js", "_test_money_round.js", "_test_paper_reconcile.js"]
OLD = u"  grab(/function paperTol\\(n\\) \\{/),"
NEW = (u"  (src.match(/const DATA_CAP = \\{[\\s\\S]*?\\n\\};/) || [''])[0],\n"
       u"  grab(/function dataCapOf\\(k\\) \\{/),\n"
       u"  grab(/function paperTol\\(n\\) \\{/),")

for f in FILES:
    s = io.open(f, "r", encoding="utf-8").read()
    n = s.count(OLD)
    if n != 1:
        print("%s: FAIL 命中 %d 处" % (f, n))
        continue
    s = s.replace(OLD, NEW, 1)
    io.open(f, "w", encoding="utf-8", newline="\n").write(s)
    print("%s: OK" % f)
