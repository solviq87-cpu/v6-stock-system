# -*- coding: utf-8 -*-
import io, sys
P = 'public/index.html'
src = io.open(P, encoding='utf-8', newline='').read()
orig = src
def rep(old, new, tag):
    global src
    if src.count(old) != 1:
        print('FAIL[%s] count=%d' % (tag, src.count(old))); sys.exit(1)
    src = src.replace(old, new, 1); print('OK  ' + tag)

# ── 1) 加统一出口 helper ──
rep(u"function staleTime(s, pool, time) {",
u'''// ⛔ dn 轮：同一个池的「产出几条」不许两处各数一遍。
//   以前面板读 `items.length` / `count` / `cand` / `zpg.total`，而「🩺 各模块本轮状态」读
//   taskState.n —— 同一个数两个名字、两条代码路径，一旦分叉，同一个模块会显示两个条数，
//   而且两边都是"自己那一瞬间的真实值"，谁也不会报错。现在后端 outNState() 是唯一出口，
//   这里只负责读；后端没下发（旧版本 / 还没算）时才退回本地值。
function poolN(s, pool, fallback) {
  const v = (s && s.outN && s.outN[pool]);
  if (v && typeof v.n === 'number') return v.n;
  return fallback == null ? 0 : fallback;
}
function staleTime(s, pool, time) {''', '加 poolN helper')

# ── 2) 六处条数改走统一出口 ──
rep(u"温和上涨未涨停 · ${(s.bigMoney.items || []).length} 只`",
    u"温和上涨未涨停 · ${poolN(s, 'bigmoney', (s.bigMoney.items || []).length)} 只`", 'bigMoney 条数')
rep(u"`全市场扫 ${zpg.scanned || 0} 只 → 有效 ${zpg.total || 0} 只",
    u"`全市场扫 ${zpg.scanned || 0} 只 → 有效 ${poolN(s, 'ztpre', zpg.total || 0)} 只", 'ztPre 条数')
rep(u"`学习库 ${(s.learnall && s.learnall.n) || 0} 条样本 · 全市场扫 ${_tsp.scanned || 0} 只 → 有效 ${_tsp.total || 0} 只",
    u"`学习库 ${(s.learnall && s.learnall.n) || 0} 条样本 · 全市场扫 ${_tsp.scanned || 0} 只 → 有效 ${poolN(s, 'trendScan', _tsp.total || 0)} 只", 'trendScan 条数')
rep(u"${staleTime(s, 'nextplan', np.time)} · 候选${np.cand || 0}只",
    u"${staleTime(s, 'nextplan', np.time)} · 候选${poolN(s, 'nextplan', np.cand || 0)}只", 'nextplan 条数')
rep(u"`${staleTime(s, 'myrules', mr.time)} · 扫描 ${mr.scanned || 0} 只 · 符合体系 ${mr.count || 0} 只`",
    u"`${staleTime(s, 'myrules', mr.time)} · 扫描 ${mr.scanned || 0} 只 · 符合体系 ${poolN(s, 'myrules', mr.count || 0)} 只`", 'myrules 条数')
rep(u"热点板块内当日涨幅 -1.5%~+4% 且未涨停 · ${(P.items || []).length} 只`",
    u"热点板块内当日涨幅 -1.5%~+4% 且未涨停 · ${poolN(s, 'pre', (P.items || []).length)} 只`", 'pre 条数')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('written, delta=%d' % (len(src) - len(orig)))
