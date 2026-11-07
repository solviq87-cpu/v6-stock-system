# -*- coding: utf-8 -*-
# dq 轮改码 第 3 步：retain（资金留存）随值返回**实际窗口**
#   名义窗口 10 分钟，实际窗口 = 轨迹里第一根到最后一根的跨度；刚启动时只有几秒，
#   而面板一律标「资金留存」—— 同一个数在不同时刻问，代表的窗口长度不同。
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

ANCHOR = 'function stateCut() {'

HELPER = '''// ── 资金留存窗口：名义 10 分钟，实际取决于轨迹攒了多少根 ────────────────────
// ⛔ `retain = h[last].mainInflow - h[0].mainInflow` 这个差值的**窗口是隐式的**：
//    h 最多保留 10 分钟，但刚启动（或某票刚入池）时里面只有几根，跨度可能只有 10 秒。
//    而面板一律标「资金留存 +500万」—— 满窗（10 分钟）与半窗（30 秒）下
//    +500 万是完全不同的强度（后者折算成每分钟强 20 倍），却说着同一句话。
//    ⛔ 「上一次」是 h[0]，它是什么时候的，必须跟着值一起说出去。
function retainWinTxt(sec) {
  const v = Number(sec) || 0;
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v < 60) return Math.round(v) + '秒';
  return Math.round(v / 60) + '分钟';
}
'''

OLD = """      const h = S.inflowHistory.get(c.code);
      let retain = null;
      if (h && h.length >= 12) {
        const d = (h[h.length - 1].mainInflow || 0) - (h[0].mainInflow || 0);
        retain = Math.round(d / 1e4); // 万元/10分钟
      }
      const k = S.klines.get(c.code);
      const levels = k && k.rows ? A.computeLevels(k.rows, c.price, c.high, c.low) : null;
      return { ...c, retain, levels, bad: S.news.badCodes.has(c.code) };"""

NEW = """      const h = S.inflowHistory.get(c.code);
      let retain = null, retainWin = null, retainTxt = null;
      if (h && h.length >= 12) {
        const t0 = Number(h[0] && h[0].t) || 0;
        const t1 = Number(h[h.length - 1] && h[h.length - 1].t) || 0;
        const d = (h[h.length - 1].mainInflow || 0) - (h[0].mainInflow || 0);
        retain = Math.round(d / 1e4); // 万元（窗口见 retainWin）
        // ⛔ 名义 10 分钟，实际跨度随轨迹长度变化 —— 把实际窗口一并交出去
        retainWin = t1 > t0 ? Math.round((t1 - t0) / 1000) : 0;
        const wt = retainWinTxt(retainWin);
        retainTxt = (retain > 0 ? '+' : '') + retain + '万' + (wt ? '/' + wt : '');
      }
      const k = S.klines.get(c.code);
      const levels = k && k.rows ? A.computeLevels(k.rows, c.price, c.high, c.low) : null;
      return { ...c, retain, retainWin, retainTxt, levels, bad: S.news.badCodes.has(c.code) };"""

c1 = s.count(ANCHOR)
if c1 != 1:
    print('FAIL step3a: anchor count = %d' % c1); sys.exit(1)
s = s.replace(ANCHOR, HELPER + ANCHOR, 1)

c2 = s.count(OLD)
if c2 != 1:
    print('FAIL step3b: OLD count = %d' % c2); sys.exit(1)
s = s.replace(OLD, NEW, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step3: retainWinTxt + retain/retainWin/retainTxt 已写入')
