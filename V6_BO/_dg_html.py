# -*- coding: utf-8 -*-
"""dg 轮：面板补「门槛/额度」栏 —— 让你看见默认值，以及文件里的越界旧值"""
import io

P = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\public\index.html"
src = io.open(P, encoding='utf-8').read()

# ── 1 工具抽屉里加一栏 ────────────────────────────────────────────────────
ANCHOR = u"""      <span id="cfgSetBox" class="muted" style="font-size:12px">读取中…</span>
    </div>
"""
assert ANCHOR in src, '找不到 cfgSetBox 锚点'
NEW_BOX = ANCHOR + u"""    <!-- 🎚 门槛 / 额度（2026-10-07 dg）：用户把某个门槛调乱之后想改回来，
         以前面板上没有任何一处写着「默认是多少」—— 默认值只活在 _govCfg 调用点的第二个参数里，
         而 probThreshold 甚至还有第二份（S.config 初始对象的 0.80），两处说的不是同一个数。
         更要紧的是：写入端 cfgRangeErrors 只体检【新提交】的值，config.json 里躺着的越界旧值
         从来没人兜 —— 这一栏把「文件里是什么 / 实际按什么生效 / 默认是多少」直接说出来。 -->
    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed #dee2e6">
      <b style="font-size:13px">🎚 门槛 / 额度</b>
      <span id="cfgRangeBox" class="muted" style="font-size:12px">读取中…</span>
    </div>
"""
src = src.replace(ANCHOR, NEW_BOX, 1)

# ── 2 refresh() 里挂上渲染 ────────────────────────────────────────────────
A2 = u"    try { renderCfgSet(s); } catch (e) { console.error('[cfgSet]', e && e.message); }"
assert A2 in src, '找不到 renderCfgSet 调用'
src = src.replace(A2, A2 + u"\n    try { renderCfgRange(s); } catch (e) { console.error('[cfgRange]', e && e.message); }", 1)

# ── 3 渲染函数（紧跟 renderCfgSet 之后）────────────────────────────────────
A3 = u"async function saveCfgSetOne(k, v) {"
assert A3 in src, '找不到 saveCfgSetOne'
FUNC = u"""// 🎚 门槛 / 额度：只读展示「文件里是什么 / 实际按什么生效 / 默认是多少」。
//   名称、量纲、范围、默认值全部由服务端的 CFG_RANGE 产出（de 轮：契约由兑现方产出），
//   面板不另抄一份 —— 否则又是「同一条规则两处各写一遍」的老毛病。
function renderCfgRange(s) {
  const box = document.getElementById('cfgRangeBox');
  if (!box) return;
  const cr = (s && s.cfgRange) || {};
  const keys = Object.keys(cr);
  if (!keys.length) { box.textContent = '（服务端未下发）'; return; }
  box.innerHTML = keys.map(k => {
    const it = cr[k] || {};
    const cur = it.cur == null ? '未设置' : String(it.cur);
    const def = String(it.def);
    const tip = `${String(it.hint || '')}｜允许 ${it.min}~${it.max}｜默认 ${def}｜实际生效 ${String(it.using)}`;
    if (it.bad === 'bad') {
      return `<span style="color:#c0392b;font-weight:600" title="${tip}">⚠️ ${k}：文件里是 ${cur}，越界，实际按 ${String(it.using)} 生效</span>`;
    }
    return `<span title="${tip}">${k} ${cur}${it.bad === 'unset' ? '（默认 ' + def + '）' : ''}</span>`;
  }).join('<span class="muted"> · </span>');
}
"""
src = src.replace(A3, FUNC + A3, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(src)
print('index.html 写入完成，行数', src.count('\n') + 1)
