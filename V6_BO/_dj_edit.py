# dj 轮改码：「最近 N 日」的名义窗口 vs 实际窗口必须一致
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    s2 = fn(s)
    if s2 is None:
        print('失败:', p); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))

def rep(s, old, new, cnt=1, tag=''):
    if s.count(old) != cnt:
        print('  !! %s 锚点命中 %d 次（应 %d）: %r' % (tag, s.count(old), cnt, old[:70])); sys.exit(1)
    return s.replace(old, new, cnt)

# ════════ A. analysis.js：趋势池指标带实际窗口 ════════
def fa(s):
    s = rep(s, u"  const hi60 = Math.max(...rows.slice(-60).map(r => (r && r.high) || 0));",
               u"  const _hi60Rows = rows.slice(-60);\n"
               u"  // ⛔ 实际窗口必须跟着值一起返回（dj 轮）：rows 只有 32 根时这里算的是「32 日高点」，\n"
               u"  //    而文案一律写「距60日高点」—— 说的和算的不是一回事，且不留痕迹。\n"
               u"  const hi60Win = _hi60Rows.length;\n"
               u"  const hi60 = Math.max(..._hi60Rows.map(r => (r && r.high) || 0));", 1, 'hi60')
    s = rep(s, u"  const lo60 = Math.max(0, rows.length - 60);",
               u"  const lo60 = Math.max(0, rows.length - 60);\n"
               u"  const zt60Win = rows.length - lo60;   // 实际窗口（不足 60 根时是真实根数）", 1, 'zt60')
    s = rep(s, u"    aboveMa10, partBull, lb, zt60,",
               u"    aboveMa10, partBull, lb, zt60, hi60Win, zt60Win,", 1, 'ret')
    return s

rw('analysis.js', fa)

# ════════ B. server.js：WIN_RULE 表 + winLabel / winShort ════════
WIN = u'''// ─── 「最近 N 日」的窗口登记表（2026-10-07 dj 轮）─────────────────────
// 系统里到处在说「近3日 / 近20日 / 60日高点 / 90日内涨停 / 95日低点」，
// 而实现是 slice(-N) 切最近 N 根 K 线 —— **名义窗口是 N，实际窗口是 min(N, 你有多少根)**。
// 数据不足时（新股、回填没补齐、缓存里就 30 根）窗口会**静默变短**：
//   slice(-90) 在只有 6 根时算的是「6 日内涨停几次」，文案却照写「90日内 1 次涨停」——
//   用户会以为这只票三个月才板过一次（弱），真相是它只有 6 天数据、6 天里板了 1 次（很猛）。
// ⛔ 反向也一样：low95 原来是 `Math.min(...k.rows.map(r => r.low))` **根本没切 95 根**，
//    数据 200 根时算的是「200 日低点」，文案写「距95日低点」—— 名不副实的两头都占。
// 现在窗口登记进表，对外说法一律走 winLabel（主说法）+ winShort（不足时的尾巴）：
//   ⛔ 说得出的窗口必须与实际参与计算的那一段一致，不许再出现「写 90 日、算 6 日」。
const WIN_RULE = {
  zt90:       { n: 90, what: '涨停基因窗口（精选池）' },
  zt60:       { n: 60, what: '涨停基因窗口（趋势池）' },
  hi60:       { n: 60, what: '60日高点 / 回撤' },
  low95:      { n: 95, what: '95日低点' },
  hi20:       { n: 20, what: '20日高点（含今日）' },
  prevHigh20: { n: 20, what: '20日高点（不含今日）' },
  r20:        { n: 20, what: '近20日涨幅' },
  ma20:       { n: 20, what: '20日均线' },
  ma60:       { n: 60, what: '60日均线' },
  amp20:      { n: 20, what: '20日振幅' },
  news3:      { n: 3,  what: '新闻近3日归档（⛔ 自然日，不是交易日 —— 同一句「近3日」两种算法）' }
};
const winOf = k => { const d = WIN_RULE[k]; return d ? d.n : 0; };
// 唯一出口：把「最近 N 日」说得与实际窗口一致（actualN 为该窗口真实参与的根数）
function winLabel(k, actualN) {
  const d = WIN_RULE[k]; if (!d) return '';
  const n = Number.isFinite(actualN) && actualN > 0 ? Math.min(actualN, d.n) : 0;
  return n ? n + '日' : d.n + '日';
}
function winShort(k, actualN) {
  const d = WIN_RULE[k]; if (!d) return '';
  const n = Number.isFinite(actualN) && actualN > 0 ? Math.min(actualN, d.n) : 0;
  if (!n || n >= d.n) return '';
  return `（数据仅${n}根，名义${d.n}日）`;
}
// 精选池「N 日 N 板」的短说法（盘口一行放不下长尾巴，只在窗口不足时带一句）
function zt90Label(c) {
  const w = (c && c.basis && c.basis.zt90Win) || 0;
  return winLabel('zt90', w) + winShort('zt90', w);
}
function winRuleState() {
  const o = {};
  for (const k of Object.keys(WIN_RULE)) { const d = WIN_RULE[k]; o[k] = { n: d.n, what: d.what }; }
  return o;
}
let _rollbackMsg = null;'''

def fb(s):
    return rep(s, u'let _rollbackMsg = null;', WIN, 1, 'WIN')

rw('server.js', fb)

# ════════ C. server.js：low95 真 bug + 各窗口文案 ════════
def fc(s):
    # ① low95：根本没切 95 根
    s = rep(s, u"      const low95 = Math.min(...k.rows.map(r => r.low));",
               u"      // ⛔ 原来是 `Math.min(...k.rows.map(r => r.low))` —— **根本没切 95 根**：\n"
               u"      //    数据 200 根时算的是「200 日低点」，数据 32 根时算的是「32 日低点」，\n"
               u"      //    而文案一律写「距95日低点」—— 名不副实的两头都占。现在真的切 95 根。\n"
               u"      const low95Rows = k.rows.slice(-95);\n"
               u"      const low95N = low95Rows.length;\n"
               u"      const low95 = Math.min(...low95Rows.map(r => r.low));", 1, 'low95')
    s = rep(s, u"        pushPath('低位启动', `距95日低点仅+${((s.price / low95 - 1) * 100).toFixed(1)}%、3日累涨${cum3.toFixed(1)}%、今日量能${(volT / volY).toFixed(1)}倍`);",
               u"        pushPath('低位启动', `距${winLabel('low95', low95N)}低点仅+${((s.price / low95 - 1) * 100).toFixed(1)}%${winShort('low95', low95N)}、3日累涨${cum3.toFixed(1)}%、今日量能${(volT / volY).toFixed(1)}倍`);", 1, 'low95txt')
    # ② zt90：90日内 N 次涨停
    s = rep(s, u"    if (profitRatio >= 0.85 && zt90 >= 2) pushPath('涨停基因', `90日内${zt90}次涨停、获利盘${prTxt}`);",
               u"    if (profitRatio >= 0.85 && zt90 >= 2) pushPath('涨停基因', `${winLabel('zt90', k.rows.length)}内${zt90}次涨停${winShort('zt90', k.rows.length)}、获利盘${prTxt}`);", 1, 'zt90path')
    # ③ 盘口一行：90日 N 板
    s = rep(s, u"获利盘${c.profitRatio == null ? '-' : c.profitRatio + '%'} | 90日${c.zt90 || 0}板",
               u"获利盘${c.profitRatio == null ? '-' : c.profitRatio + '%'} | ${zt90Label(c)}${c.zt90 || 0}板", 1, 'zt90line')
    # ④ 趋势池：60日高点 / 60日内涨停
    s = rep(s, u"        shape = `🚀 突破走主升：创60日新高（回撤仅${t.dd60}%），${r20Txt}，均线${t.partBull ? '多头' : '待确认'}排列`;",
               u"        shape = `🚀 突破走主升：创${winLabel('hi60', t.hi60Win)}新高（回撤仅${t.dd60}%${winShort('hi60', t.hi60Win)}），${r20Txt}，均线${t.partBull ? '多头' : '待确认'}排列`;", 1, 's1')
    s = rep(s, u"        shape = `多头排列主升：现价在20/60日线之上，${r20Txt}，距60日高点仅${t.dd60}%（几乎没被砸过，趋势里最强的一档）`;",
               u"        shape = `多头排列主升：现价在20/60日线之上，${r20Txt}，距${winLabel('hi60', t.hi60Win)}高点仅${t.dd60}%${winShort('hi60', t.hi60Win)}（几乎没被砸过，趋势里最强的一档）`;", 1, 's2')
    s = rep(s, u"        shape = `回踩后再起：仍站20/60日线，但距60日高点已回撤${t.dd60}% —— 中途整理，不属最强一档`;",
               u"        shape = `回踩后再起：仍站20/60日线，但距${winLabel('hi60', t.hi60Win)}高点已回撤${t.dd60}%${winShort('hi60', t.hi60Win)} —— 中途整理，不属最强一档`;", 1, 's3')
    s = rep(s, u"        shape = `中长趋势向上：站稳20/60日线（20日线${t.ma20}），${r20Txt}，距60日高点${t.dd60}%`;",
               u"        shape = `中长趋势向上：站稳20/60日线（20日线${t.ma20}），${r20Txt}，距${winLabel('hi60', t.hi60Win)}高点${t.dd60}%${winShort('hi60', t.hi60Win)}`;", 1, 's4')
    s = rep(s, u"        shape = `中期刚转强：站上20日线${t.ma20}，但仍在60日线${t.ma60}下方、距60日高点${t.dd60}% —— 修复中的反弹，还不是完整多头`;",
               u"        shape = `中期刚转强：站上20日线${t.ma20}，但仍在60日线${t.ma60}下方、距${winLabel('hi60', t.hi60Win)}高点${t.dd60}%${winShort('hi60', t.hi60Win)} —— 修复中的反弹，还不是完整多头`;", 1, 's5')
    s = rep(s, u"      if (t.zt60 >= 1) logicTxt += `${logicTxt ? '；' : '｜上涨逻辑: '}60日内${t.zt60}次涨停（有涨停基因）`;",
               u"      if (t.zt60 >= 1) logicTxt += `${logicTxt ? '；' : '｜上涨逻辑: '}${winLabel('zt60', t.zt60Win)}内${t.zt60}次涨停${winShort('zt60', t.zt60Win)}（有涨停基因）`;", 1, 'zt60txt')
    # ⑤ 趋势扫描一行
    s = rep(s, u"      ` · 中期斜率${x.ma20slope > 0 ? '+' : ''}${x.ma20slope}% · 距60日高${x.dd60}% · 连涨${x.runUp}天 · 60日${x.zt60}板`;",
               u"      ` · 中期斜率${x.ma20slope > 0 ? '+' : ''}${x.ma20slope}% · 距${winLabel('hi60', x.hi60Win)}高${x.dd60}%${winShort('hi60', x.hi60Win)} · 连涨${x.runUp}天 · ${winLabel('zt60', x.zt60Win)}${x.zt60}板`;", 1, 'scanline')
    return s

rw('server.js', fc)

# ════════ D. /api/state 下发 winRule ════════
def fd(s):
    return rep(s, u"      needRule: needRuleState(),",
                   u"      needRule: needRuleState(),\n      winRule: winRuleState(),", 1, 'state')

rw('server.js', fd)
print('全部完成')
