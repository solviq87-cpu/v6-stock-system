# -*- coding: utf-8 -*-
# 补：S.signals 两处（缩进不同）全部替换
import io

P = "server.js"
src = io.open(P, "r", encoding="utf-8").read()
old = u"if (S.signals.length > 200) S.signals.pop();"
new = u"if (S.signals.length > dataCapOf('signals')) S.signals.pop();"
n = src.count(old)
src = src.replace(old, new)          # 全部替换（两处缩进不同）
io.open(P, "w", encoding="utf-8", newline="\n").write(src)
print("替换 %d 处；剩余写死 200 的: %d" % (n, src.count(u"S.signals.length > 200")))
