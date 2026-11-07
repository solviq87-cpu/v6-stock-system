# dk 轮：前端加「🩺 各模块本轮状态」一栏（后端算了没人用 = 白算）
import io, sys

p = 'public/index.html'
s = io.open(p, encoding='utf-8').read()

def rep(old, new, cnt=1, tag=''):
    global s
    if s.count(old) != cnt:
        print('  !! %s 锚点命中 %d 次（应 %d）: %r' % (tag, s.count(old), cnt, old[:70])); sys.exit(1)
    s = s.replace(old, new, cnt)

# ① 工具抽屉新增一栏
rep(u'''    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed #dee2e6">
      <b style="font-size:13px">🎚 门槛 / 额度</b>
      <span id="cfgRangeBox" class="muted" style="font-size:12px">读取中…</span>
    </div>
  </div>''',
    u'''    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed #dee2e6">
      <b style="font-size:13px">🎚 门槛 / 额度</b>
      <span id="cfgRangeBox" class="muted" style="font-size:12px">读取中…</span>
    </div>
    <!-- 🩺 各模块本轮状态（2026-10-07 dk）：同一个「这一轮没跑成」，以前各模块各说各的 ——
         三个任务会写状态、其余几个只打日志甚至空 catch 静默，面板一律显示上一次成功的数据，
         用户没法判断「这是没跑，还是跑砸了」。现在九个周期任务统一由 taskSet 产出，面板一处看全。 -->
    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed #dee2e6">
      <b style="font-size:13px">🩺 各模块本轮状态</b>
      <span id="taskBox" class="muted" style="font-size:12px">读取中…</span>
    </div>
  </div>''', 1, 'html-box')

# ② refresh 里调用
rep(u"    try { renderCfgRange(s); } catch (e) { console.error('[cfgRange]', e && e.message); }",
    u"    try { renderCfgRange(s); } catch (e) { console.error('[cfgRange]', e && e.message); }\n"
    u"    try { renderTaskState(s); } catch (e) { console.error('[taskState]', e && e.message); }", 1, 'refresh')

# ③ 渲染函数（放在 renderCfgRange 之前，避免 TDZ）
rep(u"function renderCfgRange(s) {",
    u'''function renderTaskState(s) {
  const box = document.getElementById('taskBox');
  if (!box) return;
  const ts = s.taskState || {};
  const ks = Object.keys(ts);
  if (!ks.length) { box.textContent = '（服务端未下发）'; return; }
  const bad = ks.filter(k => ts[k].ok === false);
  if (!bad.length) {
    box.textContent = ks.map(k => ts[k].name + '✅').join(' · ');
    return;
  }
  // ⛔ 跑砸了的必须排在前面并把原因挂在 title 上 —— 只写「失败」等于没说
  box.innerHTML = bad.map(k =>
    `<span class="tag" style="background:#ffe3e3;color:#c92a2a;cursor:help" title="${String(ts[k].error || '').replace(/"/g, '&quot;')}">${ts[k].name} 本轮未跑成</span>`
  ).join(' ') + ' <span class="muted">' + ks.filter(k => ts[k].ok !== false).map(k => ts[k].name + '✅').join(' · ') + '</span>';
}
function renderCfgRange(s) {''', 1, 'render')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))
