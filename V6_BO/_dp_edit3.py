# -*- coding: utf-8 -*-
# dp 轮改码 第 3 步：numGap/numGapRaw 必须先判 null —— ⛔ Number(null)===0 是有限数，
#   不判空就会被当成「这只票今天涨 0%」，算出 gap=10（平盘），而不是「取不到」。
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

OLD1 = """function numGap(code, name, pctRaw) {
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return NUM_NEUTRAL.gap.neutral;
"""
NEW1 = """function numGap(code, name, pctRaw) {
  // ⛔ 先判 null/undefined：Number(null) === 0 是**有限数**，不判空就会被当成「今天涨 0%」→ gap=10（平盘）
  if (pctRaw == null) return NUM_NEUTRAL.gap.neutral;
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return NUM_NEUTRAL.gap.neutral;
"""

OLD2 = """function numGapRaw(code, name, pctRaw) {
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return null;
"""
NEW2 = """function numGapRaw(code, name, pctRaw) {
  if (pctRaw == null) return null; // 同上：null 是「没取到」，不是「涨 0%」
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return null;
"""

for i, (o, nw) in enumerate([(OLD1, NEW1), (OLD2, NEW2)]):
    c = s.count(o)
    if c != 1:
        print('FAIL step3 #%d: count=%d' % (i + 1, c)); sys.exit(1)
    s = s.replace(o, nw, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step3: numGap/numGapRaw 已加 null 判空')
