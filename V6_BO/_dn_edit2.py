# -*- coding: utf-8 -*-
# dn 轮：把「本轮 0 条的原因」也绑到同一个 n 上 —— 原来 n 走一条表达式、empty 再数一遍，
#         这正是「同一件事两个名字」：同一个条数在系统里被数了两遍。
import io, sys
P = 'server.js'
s = io.open(P, encoding='utf-8').read()

# ① 加 outWhy helper（紧跟 outN 之后）
ANCH = "function outNState() {"
HELP = (
  "// ⛔ 「本轮 0 条」的原因也必须从**同一个 n** 派生：原来 n 写一条表达式、empty 再自己数一遍\n"
  "//    （`n: outN('bigmoney')` 与 `empty: S.bigMoney.items.length ? …`），同一个条数被数了两遍，\n"
  "//    一旦哪天 outN 换了来源，两者就会分叉 —— 而两边都不会报错。现在统一走 outWhy(n)。\n"
  "function outWhy(n) { const v = Number(n || 0); return (Number.isFinite(v) && v > 0) ? '' : emptyWhyOf('justNone'); }\n"
)
if s.count(ANCH) != 1:
    print('FAIL anchor outNState count=%d' % s.count(ANCH)); sys.exit(1)
if 'function outWhy(' in s:
    print('SKIP outWhy 已存在')
else:
    s = s.replace(ANCH, HELP + ANCH)
    print('OK  插入 outWhy')

PAIRS = [
  # ztpre
  ("empty: (_zpProg.total || 0) ? '' : emptyWhyOf('justNone') });",
   "empty: outWhy(_zpProg.total) });"),
  # trendScan
  ("empty: (_tsProg.total || 0) ? '' : emptyWhyOf('justNone') });",
   "empty: outWhy(_tsProg.total) });"),
  # steadyUp
  ("empty: out.length ? '' : emptyWhyOf('justNone') });",
   "empty: outWhy(out.length) });"),
  # similar
  ("empty: list.length ? '' : emptyWhyOf('justNone') });",
   "empty: outWhy(list.length) });"),
  # bigmoney
  ("empty: (((S.bigMoney || {}).items || []).length ? '' : emptyWhyOf('justNone')) });",
   "empty: outWhy(outN('bigmoney')) });"),
  # pre
  ("empty: (((S.pre || {}).items || []).length ? '' : emptyWhyOf('justNone')) });",
   "empty: outWhy(outN('pre')) });"),
]
for old, new in PAIRS:
    c = s.count(old)
    if c != 1:
        print('FAIL  count=%d  %s' % (c, old[:60])); sys.exit(1)
    s = s.replace(old, new)
    print('OK  %s' % old[:52])

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('--- 剩余裸写的 justNone 处数:', s.count("emptyWhyOf('justNone')"))
print('CR:', s.count('\r'))
