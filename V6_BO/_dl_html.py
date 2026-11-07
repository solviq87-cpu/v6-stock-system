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

OLD = u'''function renderTaskState(s) {
  const box = document.getElementById('taskBox');
  if (!box) return;
  const ts = s.taskState || {};
  const ks = Object.keys(ts);
  if (!ks.length) { box.textContent = '（服务端未下发）'; return; }
  const bad = ks.filter(k => ts[k].ok === false);
  if (!bad.length) {
    box.textContent = ks.map(k => ts[k].name + '\u2705').join(' \u00b7 ');
    return;
  }
  // \u26d4 跑砸了的必须排在前面并把原因挂在 title 上 \u2014\u2014 只写「失败」等于没说
  box.innerHTML = bad.map(k =>
    `<span class="tag" style="background:#ffe3e3;color:#c92a2a;cursor:help" title="${String(ts[k].error || '').replace(/"/g, '&quot;')}">${ts[k].name} \u672c\u8f6e\u672a\u8dd1\u6210</span>`
  ).join(' ') + ' <span class="muted">' + ks.filter(k => ts[k].ok !== false).map(k => ts[k].name + '\u2705').join(' \u00b7 ') + '</span>';
}'''

NEW = u'''function renderTaskState(s) {
  const box = document.getElementById('taskBox');
  if (!box) return;
  const ts = s.taskState || {};
  const ks = Object.keys(ts);
  if (!ks.length) { box.textContent = '（服务端未下发）'; return; }
  const DR = s.doneRule || {};
  // ⛔ dl 轮：跑出 0 条不许再打 ✅ —— 用户看到满屏 ✅ 却什么都没有，
  //    分不清「今天真没符合条件的票」和「数据源挂了所以 0 只」。
  //    排序：有产出 → 失败 → 跑通但 0 条 → 没跑，最该看的最靠前。
  const ORDER = { yield: 0, fail: 1, empty: 2, ok: 3, skip: 4 };
  const rk = k => (ORDER[ts[k].done] == null ? 9 : ORDER[ts[k].done]);
  const one = k => {
    const v = ts[k] || {}, d = v.done || '';
    const why = esc(v.empty || v.error || '');
    const t = 'title="' + esc(((DR[d] && DR[d].label) || '') + (why ? '：' + why : '')) + '"';
    if (d === 'fail')  return '<span class="tag" style="background:#ffe3e3;color:#c92a2a;cursor:help" ' + t + '>' + esc(v.name) + ' ❌ 本轮未跑成</span>';
    if (d === 'empty') return '<span class="tag" style="background:#f1f3f5;color:#495057;cursor:help" ' + t + '>' + esc(v.name) + ' ⚪ 0 条 · ' + esc(String(v.empty || '').slice(0, 10)) + '</span>';
    if (d === 'yield')return '<span class="tag" ' + t + '>' + esc(v.name) + ' ✅ ' + v.n + '</span>';
    return '<span class="muted" style="cursor:help" ' + t + '>' + esc(v.name) + ' ' + ((DR[d] && DR[d].mark) || '—') + '</span>';
  };
  let html = ks.slice().sort((a, b) => rk(a) - rk(b)).map(one).join(' ');
  // ⛔ 推送返回 true ≠ 送达：副本拦截 / 条数闸门都返回 true，手机一条收不到
  const pl = s.pushLast || {};
  if (pl.ret !== null && pl.ret !== undefined) {
    const sentTxt = pl.sent === true ? '已送达' : (pl.sent === false ? '未送达' : '发送中');
    html += ' <span class="muted" style="cursor:help" title="⛔ 推送返回 true 不等于送达：副本拦截 / 条数闸门都返回 true，手机一条收不到（dl 轮）">末次推送：' + sentTxt + (pl.why ? '（' + esc(pl.why) + '）' : '') + '</span>';
  }
  box.innerHTML = html;
}'''

rep(OLD, NEW, 'renderTaskState 分级')
io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('written, delta=%d' % (len(src) - len(orig)))
