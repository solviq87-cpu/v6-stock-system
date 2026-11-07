# -*- coding: utf-8 -*-
# dn 轮补发：OUT_N 把「本轮产出条数」与「池里存了几条」混成了一个名字
#   线上实测（20261007dn 发布后带 token 拉 /api/state）：
#     ztpre     taskState.n = 4612   S.ztPre.length      = 20
#     trendScan taskState.n = 2289   S.trendScan.length  = 30
#     steadyUp  taskState.n = 66     S.steadyUp.length   = 12
#   三处都是「扫出 N 只 / 存了 M 只」两个不同的量共用一个名字，
#   而 outNState() 在 /api/state 时才求值、taskSet 在扫描时求值 —— 求值时机不同 → 分叉。
#   修法：① outN 记忆化（传了本轮值就以它为准，之后不再重算）→ 两个出口必然是同一个数；
#        ② 补第二个量 shown（面板实际列出的条数），文案在 shown < n 时明说「列出前 M 只」。
import io, sys
P = 'server.js'
s = io.open(P, encoding='utf-8').read()

# ① OUT_N 加 shown
OLD_TBL_END = """from: () => Number(((_s('nextplan') || {}).cand) || 0) }
};"""
NEW_TBL_END = """  nextplan:   { label: '次日计划',     from: () => Number(((_s('nextplan') || {}).cand) || 0) }
};
// ⛔ 「本轮产出条数」与「池里存了几条」是**两个不同的量**，不许再共用一个名字（2026-10-07 补发）。
//    线上实测：ztpre 扫出 4612 只却只存 20、trendScan 扫出 2289 只存 30、steadyUp 扫出 66 只存 12 ——
//    面板说「有效 4612 只」下面只列 20 行，用户无从判断是没刷新还是被截断了。
//    n = 本轮产出（权威值，由扫描时传进来）；shown = 实际落池/列出的条数。shown < n 时文案要明说。
const OUT_SHOWN = {
  ztpre:     () => ((_s('ztPre') || []).length),
  trendScan: () => ((_s('trendScan') || []).length),
  steadyUp:  () => ((_s('steadyUp') || []).length),
  bigmoney:  () => (((_s('bigMoney') || {}).items) || []).length,
  pre:       () => (((_s('pre') || {}).items) || []).length,
  buzhang:   () => (((_s('buzhang') || {}).items) || []).length,
  similar:   () => ((_s('similar') || []).length)
};
// ⛔ 记忆表：本轮值一旦登记就以它为准，之后 outN(pool) 不再重算 ——
//    否则 taskSet（扫描时求值）与 outNState（/api/state 时求值）两个出口会给出两个不同的数。
const _outNMem = {};"""
if s.count(OLD_TBL_END) != 1:
    print('FAIL 表尾 count=%d' % s.count(OLD_TBL_END)); sys.exit(1)
s = s.replace(OLD_TBL_END, NEW_TBL_END)
print('OK  加 shown 表与记忆表')

# ② outN 记忆化 + outNShown
OLD_OUTN = """function outN(pool, fresh) {
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
}"""
NEW_OUTN = """function outN(pool, fresh) {
  const d = OUT_N[pool];
  if (!d) { console.error('[outN] 未登记的池: ' + pool); return 0; }
  // ⛔ 记忆优先：本轮值登记过之后就以它为准，不许在 /api/state 时再算一遍
  //    （否则 taskSet 的 n 与 outNState 的 n 是两次求值 → 同一个池两个条数）
  if (fresh == null && Object.prototype.hasOwnProperty.call(_outNMem, pool)) return _outNMem[pool];
  let v;
  if (fresh != null) v = Number(fresh);
  else {
    try { v = Number(d.from() || 0); }
    catch (e) { console.error('[outN] ' + pool + ' 取条数失败: ' + (e && e.message)); return 0; }
  }
  v = Number.isFinite(v) ? v : 0;
  if (fresh != null) _outNMem[pool] = v;
  return v;
}
// 「面板实际列出几条」—— 与 n 是两个量，只在 shown < n 时文案才需要点出来
function outNShown(pool) {
  const f = OUT_SHOWN[pool];
  if (!f) return null;
  try { const v = Number(f() || 0); return Number.isFinite(v) ? v : null; }
  catch (e) { return null; }
}
function outNState() {
  const o = {};
  for (const k of Object.keys(OUT_N)) o[k] = { label: OUT_N[k].label, n: outN(k), shown: outNShown(k) };
  return o;
}"""
if s.count(OLD_OUTN) != 1:
    print('FAIL outN count=%d' % s.count(OLD_OUTN)); sys.exit(1)
s = s.replace(OLD_OUTN, NEW_OUTN)
print('OK  outN 记忆化 + outNShown')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('CR:', s.count('\r'))
