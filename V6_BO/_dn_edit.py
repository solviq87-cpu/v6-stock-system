# -*- coding: utf-8 -*-
import io, sys

P = 'server.js'
src = io.open(P, encoding='utf-8', newline='').read()
orig = src
def rep(old, new, tag, n=1):
    global src
    c = src.count(old)
    if c != n:
        print('FAIL[%s] count=%d want=%d' % (tag, c, n)); sys.exit(1)
    src = src.replace(old, new, n); print('OK  ' + tag)

# ── 0) 插入 OUT_N 命名表（放在 STALE 块之后、dk 轮 FAIL_RULE 之前）──
ANCHOR = u"// ─── 「失败」的说法登记表（2026-10-07 dk 轮）────────────────────────────"
BLK = u'''// ─── 「本轮产出几条」的命名登记表（2026-10-07 dn 轮）────────────────────
// 前两轮的积累：dl「成功」有四种说法、dm「陈旧」有五种写法。这一轮系统性扫**命名** ——
// 实测「这个模块本轮产出几条」在系统里有**五个名字**：
//   total（ztpre / trendScan / steadyUp 三个扫描的返回值）
//   n    （taskSet 任务状态，dk 轮起的统一出口）
//   count（S.myrules.count）  cand（S.nextplan.cand）
//   items.length（S.bigMoney / S.pre / S.buzhang）
// ⛔ 同一件事两个名字 = 两处各数一遍，且没人保证二者相等：面板「补涨龙 3 只」读的是
//    S.buzhang.items.length，而「🩺 各模块本轮状态」读的是 taskState.buzhang.n ——
//    这两个数来自**不同的代码路径**，一旦分叉，用户看到的是同一个模块两个不同的条数，
//    而且两边都没错（各自都是自己那一瞬间的真实值），谁也不会报错、谁也不会发现。
// 现在登记 OUT_N：任何地方要「这个池本轮产出几条」一律走 outN()，不许再自己数一遍。
// ⛔ 本轮刚算出来的原始值（如 out.length）通过第二参数传进来 —— 表里的 from 只是
//    「没传时」的默认来源，二者是同一个数，不许再分叉成两个。
const OUT_N = {
  ztpre:     { label: '涨停前形态',   from: () => Number((typeof _zpProg !== 'undefined' && _zpProg && _zpProg.total) || 0) },
  trendScan: { label: '全市场趋势扫描', from: () => Number((typeof _tsProg !== 'undefined' && _tsProg && _tsProg.total) || 0) },
  steadyUp:  { label: '连续收涨',     from: () => ((_s('steadyUp') || []).length) },
  bigmoney:  { label: '大单流入',     from: () => (((_s('bigMoney') || {}).items) || []).length },
  pre:       { label: '启动前埋伏',   from: () => (((_s('pre') || {}).items) || []).length },
  buzhang:   { label: '补涨龙',       from: () => (((_s('buzhang') || {}).items) || []).length },
  similar:   { label: '相似走势跟随', from: () => ((_s('similar') || []).length) },
  kbf:       { label: 'K线回填',     from: () => Number((typeof _kbfProg !== 'undefined' && _kbfProg && _kbfProg.added) || 0) },
  myrules:   { label: '自定义规则',   from: () => Number(((_s('myrules') || {}).count) || 0) },
  nextplan:  { label: '次日计划',     from: () => Number(((_s('nextplan') || {}).cand) || 0) }
};
// ⛔ 沙箱友好：S 未注入时退化成空对象（typeof 保护），不会 ReferenceError 把整个套件崩掉
function _s(k) { const g = (typeof S === 'object' && S) ? S : {}; return g[k]; }
function outN(pool, fresh) {
  const d = OUT_N[pool];
  if (!d) { console.error('[outN] 未登记的池: ' + pool); return 0; }
  if (fresh != null) { const v = Number(fresh); return Number.isFinite(v) ? v : 0; }
  try { const v = Number(d.from() || 0); return Number.isFinite(v) ? v : 0; }
  catch (e) { console.error('[outN] ' + pool + ' 取条数失败: ' + (e && e.message)); return 0; }
}
function outNState() {
  const o = {};
  for (const k of Object.keys(OUT_N)) o[k] = { label: OUT_N[k].label, n: outN(k) };
  return o;
}
'''
rep(ANCHOR, BLK + ANCHOR, 'insert OUT_N block')

# ── 1) 七个 taskSet 调用点：条数一律走 outN()（数值不变，名字统一）──
rep(u"  taskSet('ztpre', { ok: !!_zpProg.ok, error: _zpProg.error || '', n: _zpProg.total || 0, ms: _zpProg.ms || 0,",
    u"  taskSet('ztpre', { ok: !!_zpProg.ok, error: _zpProg.error || '', n: outN('ztpre', _zpProg.total), ms: _zpProg.ms || 0,",
    'ztpre n')
rep(u"  taskSet('trendScan', { ok: !!_tsProg.ok, error: _tsProg.error || '', n: _tsProg.total || 0, ms: _tsProg.elapsedMs || 0,",
    u"  taskSet('trendScan', { ok: !!_tsProg.ok, error: _tsProg.error || '', n: outN('trendScan', _tsProg.total), ms: _tsProg.elapsedMs || 0,",
    'trendScan n')
rep(u"  taskSet('steadyUp', { ok: true, error: '', n: out.length,",
    u"  taskSet('steadyUp', { ok: true, error: '', n: outN('steadyUp', out.length),", 'steadyUp n')
rep(u"    taskSet('kbf', { ok: true, error: '', n: _kbfProg.added || 0, ms: _kbfProg.elapsedMs || 0,",
    u"    taskSet('kbf', { ok: true, error: '', n: outN('kbf', _kbfProg.added), ms: _kbfProg.elapsedMs || 0,", 'kbf n')
rep(u"    taskSet('bigmoney', { ok: true, error: '', n: ((S.bigMoney || {}).items || []).length,",
    u"    taskSet('bigmoney', { ok: true, error: '', n: outN('bigmoney'),", 'bigmoney n')
rep(u"    taskSet('similar', { ok: true, error: '', n: list.length,",
    u"    taskSet('similar', { ok: true, error: '', n: outN('similar', list.length),", 'similar n')
rep(u"    taskSet('pre', { ok: true, error: '', n: ((S.pre || {}).items || []).length,",
    u"    taskSet('pre', { ok: true, error: '', n: outN('pre'),", 'pre n')

# ── 2) /api/state 下发 ──
rep(u"    staleState: staleState(),\n    staleRule: staleRuleState(),",
    u"    staleState: staleState(),\n    staleRule: staleRuleState(),\n    outN: outNState(),",
    'api/state 下发 outN')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('written, delta=%d chars' % (len(src) - len(orig)))
