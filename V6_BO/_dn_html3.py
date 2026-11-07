# -*- coding: utf-8 -*-
# dn 轮补发：前端补 poolShown，三处「扫出 N 只 / 只列 M 只」必须把截断说清楚
import io, sys
P = 'public/index.html'
s = io.open(P, encoding='utf-8').read()

# ① poolShown helper
OLD = "function staleTime(s, pool, time) {"
NEW = ("""function poolShown(s, pool, fallback) {
  const v = (s && s.outN && s.outN[pool]);
  if (v && typeof v.shown === 'number') return v.shown;
  return fallback == null ? null : fallback;
}
// ⛔ 「扫出 N 只」与「列出 M 只」是两个数 —— N > M 时必须明说，否则用户以为是没刷新
function poolCut(n, shown) {
  return (typeof shown === 'number' && shown > 0 && shown < n) ? ` · 列出前 ${shown} 只` : '';
}
function staleTime(s, pool, time) {""")
if s.count(OLD) != 1:
    print('FAIL anchor count=%d' % s.count(OLD)); sys.exit(1)
s = s.replace(OLD, NEW)
print('OK  插入 poolShown / poolCut')

PAIRS = [
  # 涨停前形态
  ("`全市场扫 ${zpg.scanned || 0} 只 → 有效 ${poolN(s, 'ztpre', zpg.total || 0)} 只 · 次日封板基准 ${p0.base != null ? p0.base + '%' : '—'}${zpWarn}`",
   "`全市场扫 ${zpg.scanned || 0} 只 → 有效 ${poolN(s, 'ztpre', zpg.total || 0)} 只${poolCut(poolN(s, 'ztpre', zpg.total || 0), poolShown(s, 'ztpre', (s.ztPre || []).length))} · 次日封板基准 ${p0.base != null ? p0.base + '%' : '—'}${zpWarn}`"),
  # 趋势扫描
  ("`学习库 ${(s.learnall && s.learnall.n) || 0} 条样本 · 全市场扫 ${_tsp.scanned || 0} 只 → 有效 ${poolN(s, 'trendScan', _tsp.total || 0)} 只 · 按相对基准溢价排序${_tsWarn}`",
   "`学习库 ${(s.learnall && s.learnall.n) || 0} 条样本 · 全市场扫 ${_tsp.scanned || 0} 只 → 有效 ${poolN(s, 'trendScan', _tsp.total || 0)} 只${poolCut(poolN(s, 'trendScan', _tsp.total || 0), poolShown(s, 'trendScan', (s.trendScan || []).length))} · 按相对基准溢价排序${_tsWarn}`"),
  # 连续收涨
  ("`全市场扫出 ${poolN(s, 'steadyUp', su.length)} 只符合条件的连续收涨`",
   "`全市场扫出 ${poolN(s, 'steadyUp', su.length)} 只符合条件的连续收涨${poolCut(poolN(s, 'steadyUp', su.length), poolShown(s, 'steadyUp', su.length))}`"),
]
for old, new in PAIRS:
    c = s.count(old)
    if c != 1:
        print('FAIL count=%d  %s' % (c, old[:60])); sys.exit(1)
    s = s.replace(old, new)
    print('OK  %s' % old[:56])

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('poolShown 出现次数:', s.count('poolShown(s,'))
print('poolCut 出现次数:', s.count('poolCut('))
print('CR:', s.count('\r'))
