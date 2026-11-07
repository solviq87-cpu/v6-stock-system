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

# ── 1) 加统一出口 helper（放在 renderTaskState 之前）──
rep(u"function renderTaskState(s) {",
u'''// ⛔ dm 轮：面板侧的「这份数据新不新鲜」必须与日志、接口、推送同一句话。
//   数据源没回来时后端【保留上一次结果】，界面却照写「更新于 10:23:11」—— 那个时间是上一次的，
//   用户看到的就是"刚刚更新过"。以前这件事只在日志里说（12 处 marketReady 判据、14 处「行情源」），
//   面板侧 0 处提及。现在时间与新鲜度一起由后端 staleState 下发，这里只负责把它说出来。
function staleTime(s, pool, time) {
  const v = ((s && s.staleState) || {})[pool];
  const t = time || '-';
  if (v && v.kind === 'held')  return `${v.mark} 行情源未就绪 · ${v.word} ${t}`;
  if (v && v.kind === 'empty') return `${v.mark} 本轮无符合条件的结果（${t}）`;
  if (v && v.kind === 'none')  return `未产出`;
  return `更新于 ${t}`;
}
function renderTaskState(s) {''', '加 staleTime helper')

# ── 2) 各池的「更新于」改走统一出口 ──
rep(u"document.getElementById('bmInfo').textContent = `更新于 ${s.bigMoney.time || '-'} ·",
    u"document.getElementById('bmInfo').textContent = `${staleTime(s, 'bigMoney', s.bigMoney.time)} ·` + ` 当日主力净占比>6%", 'bmInfo')
# bmInfo 那条替换后需要处理尾部；改为整行替换更稳 —— 拆开做
src = src.replace(u"`${staleTime(s, 'bigMoney', s.bigMoney.time)} ·` + ` 当日主力净占比>6%",
                  u"`${staleTime(s, 'bigMoney', s.bigMoney.time)} · 当日主力净占比>6%", 1)

rep(u"? `更新于 ${mr.time} · 扫描 ${mr.scanned || 0} 只 · 符合体系 ${mr.count || 0} 只`",
    u"? `${staleTime(s, 'myrules', mr.time)} · 扫描 ${mr.scanned || 0} 只 · 符合体系 ${mr.count || 0} 只`", 'mrTime')

rep(u"document.getElementById('rvTime').textContent = `${_pre}更新于 ${s.review.time} · 共 ${it.length} 只涨停`;",
    u"document.getElementById('rvTime').textContent = `${_pre}${staleTime(s, 'review', s.review.time)} · 共 ${it.length} 只涨停`;", 'rvTime')

rep(u"document.getElementById('bzTime').textContent = `更新于 ${s.buzhang.time} · ${_pn.buzhang}`;",
    u"document.getElementById('bzTime').textContent = `${staleTime(s, 'buzhang', s.buzhang.time)} · ${_pn.buzhang}`;", 'bzTime')

rep(u"document.getElementById('preTime').textContent = `更新于 ${P.time || '-'} · 热点板块内当日涨幅",
    u"document.getElementById('preTime').textContent = `${staleTime(s, 'pre', P.time)} · 热点板块内当日涨幅", 'preTime')

# nextplan：日期前缀保留，只把时间那一段换成统一口径
rep(u"? `${_npAd ? '适用于 ' + _npAd + ' · ' : '适用于下一交易日 · '}${_npGd ? '生成于 ' + _npGd + ' ' : ''}${np.time} · 候选${np.cand || 0}只",
    u"? `${_npAd ? '适用于 ' + _npAd + ' · ' : '适用于下一交易日 · '}${_npGd ? '生成于 ' + _npGd + ' ' : ''}${staleTime(s, 'nextplan', np.time)} · 候选${np.cand || 0}只", 'npTime')

# ── 3) 工具抽屉加「🌡 数据新鲜度」一栏 ──
rep(u'      <span id="taskBox" class="muted" style="font-size:12px">读取中…</span>',
    u'      <span id="taskBox" class="muted" style="font-size:12px">读取中…</span>\n'
    u'      <br><span id="staleBox" class="muted" style="font-size:12px">读取中…</span>', '加 staleBox 容器')

rep(u"    try { renderTaskState(s); } catch (e) { console.error('[taskState]', e && e.message); }",
    u"    try { renderTaskState(s); } catch (e) { console.error('[taskState]', e && e.message); }\n"
    u"    try { renderStaleState(s); } catch (e) { console.error('[staleState]', e && e.message); }", 'refresh 调用')

rep(u"function renderCfgRange(s) {",
u'''// 🌡 数据新鲜度：把「这份结果是这一轮的，还是沿用上一次的」摆到面上。
// ⛔ 沿用上一次时必须显式标注 —— 只显示一个时间戳，用户会当成"刚刚更新过"。
function renderStaleState(s) {
  const box = document.getElementById('staleBox');
  if (!box) return;
  const st = s.staleState || {};
  const ks = Object.keys(st);
  if (!ks.length) { box.textContent = '（服务端未下发）'; return; }
  const held = ks.filter(k => st[k].kind === 'held');
  if (!held.length) {
    box.textContent = ks.map(k => st[k].name + (st[k].kind === 'fresh' ? '✅' : st[k].mark)).join(' · ');
    return;
  }
  box.innerHTML = held.map(k =>
    `<span class="tag" style="background:#fff3bf;color:#8a5a00;cursor:help" title="行情源未就绪，这份结果是上一次的（dm 轮）">${esc(st[k].name)} ${st[k].mark} ${st[k].word}</span>`
  ).join(' ') + ' <span class="muted">' + ks.filter(k => st[k].kind !== 'held').map(k => st[k].name + (st[k].kind === 'fresh' ? '✅' : st[k].mark)).join(' · ') + '</span>';
}
function renderCfgRange(s) {''', '加 renderStaleState')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('written, delta=%d' % (len(src) - len(orig)))
