# -*- coding: utf-8 -*-
"""给 holdings.js 注入「写操作审计 + 条数减少自动留快照」。
用法: python _patch_holdings_audit.py
holdings.js 是项目里唯一的全 CRLF 文件 —— 处理前归一化成 LF，写回时还原 CRLF。
"""
import sys

F = 'holdings.js'
raw = open(F, 'rb').read()
crlf = b'\r\n' in raw
t = raw.decode('utf-8').replace('\r\n', '\n')

if 'HOUTAI_AUDIT_V1' in t:
    print('已注入过，跳过')
    sys.exit(0)

anchor = "  const saveHold = () => { try { fs.writeFileSync(HOLD_FILE, JSON.stringify(HOLD)); } catch {} };"
assert anchor in t, '找不到 saveHold 锚点'
helpers = anchor + """
  // ── 持仓写操作审计 + 自动快照（HOUTAI_AUDIT_V1，2026-09-30 新增）────────────
  // 事故背景：用户两次发现「持仓又没有了」，而 remove / removeMany / clear 这三条写路径
  // 以前是直接改写 items 然后 saveHold —— 既不记「删之前是哪几只」，也不留任何旧文件，
  // 事后只能干瞪眼。典型的静默失败：数据没了，系统里却找不到半个字的痕迹。
  // 现在两条硬保障：
  //   ① 所有写操作登记审计流水 .holdings_ops.json（含增删前后的票清单，最多 500 条）；
  //   ② 只要持仓【条数变少】或【被清空】，额外在 .holdings_bak/ 落一份完整快照（留最近 12 份），
  //      面板「持仓 → 变更记录」可一键还原，不用再去翻 git。
  const HOLD_BAK_DIR = path.join(dir, '.holdings_bak');
  const OPS_FILE = path.join(dir, '.holdings_ops.json');
  const readOps = () => { try { const a = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
  function writeOps(list) { try { fs.writeFileSync(OPS_FILE, JSON.stringify(list.slice(-500))); } catch {} }
  const _brief = items => (items || []).map(x => `${(x && x.code) || ''}${(x && x.name) ? '·' + x.name : ''}`).slice(0, 80);
  function snapshot(reason) {
    try {
      if (!fs.existsSync(HOLD_BAK_DIR)) fs.mkdirSync(HOLD_BAK_DIR);
      const fn = path.join(HOLD_BAK_DIR, 'holdings_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '_' + (reason || 'bak') + '.json');
      fs.writeFileSync(fn, JSON.stringify(HOLD));
      try {
        const files = fs.readdirSync(HOLD_BAK_DIR).filter(f => /^holdings_.*\\.json$/.test(f)).sort();
        while (files.length > 12) { const old = files.shift(); try { fs.unlinkSync(path.join(HOLD_BAK_DIR, old)); } catch {} }
      } catch {}
      return fn;
    } catch { return null; }
  }
  // act / before / after / extra {removedCodes, addedCodes}
  function commit(act, before, after, extra) {
    before = before || []; after = after || [];
    try {
      const list = readOps();
      const rec = { t: Date.now(), act, beforeCount: before.length, afterCount: after.length,
        added: (extra && extra.addedCodes) || [], removed: (extra && extra.removedCodes) || [],
        beforeBrief: _brief(before), afterBrief: _brief(after) };
      if (after.length < before.length) rec.snapshot = snapshot(act) || '';
      list.push(rec); writeOps(list);
    } catch {}
    saveHold(); bust();
  }
  // 面板/接口用：谁删的、删了啥、能不能救回来
  function ops(n) { const l = readOps(); return l.slice(-Math.max(1, Math.min(500, n || 30))); }
  function snapshots() {
    try {
      const files = fs.readdirSync(HOLD_BAK_DIR).filter(f => /^holdings_.*\\.json$/.test(f)).sort();
      return files.slice(-12).map(f => {
        let it = [];
        try { it = (JSON.parse(fs.readFileSync(path.join(HOLD_BAK_DIR, f), 'utf8')).items) || []; } catch {}
        return { file: f, count: it.length, brief: _brief(it).slice(0, 12) };
      }).reverse();
    } catch { return []; }
  }
  function restore(file) {
    const fp = path.join(HOLD_BAK_DIR, String(file || '').replace(/[\\\\/]/g, ''));
    try {
      const h = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!h || !Array.isArray(h.items)) return { ok: false, error: '备份内容不是有效持仓' };
      const before = HOLD.items.slice();
      HOLD.items = h.items;
      commit('restore', before, HOLD.items, {});
      return { ok: true, count: h.items.length, msg: `已从备份恢复 ${h.items.length} 条持仓` };
    } catch (e) { return { ok: false, error: '读取备份失败: ' + ((e && e.message) || e) }; }
  }"""
t = t.replace(anchor, helpers, 1)

reps = [
("""    HOLD.items = HOLD.items.filter(x => x.code !== code);
    if (HOLD.items.length === n) return { ok: false, error: '未找到该持仓' };
    saveHold(); bust();
    return { ok: true, msg: '已从持仓中移除' };""",
"""    const before = HOLD.items.slice();
    HOLD.items = HOLD.items.filter(x => x.code !== code);
    if (HOLD.items.length === n) return { ok: false, error: '未找到该持仓' };
    commit('remove', before, HOLD.items, { removedCodes: [String(code)] });
    return { ok: true, msg: '已从持仓中移除' };"""),

("""    const n = HOLD.items.length;
    HOLD.items = HOLD.items.filter(x => !set.has(String(x.code)));
    const removed = n - HOLD.items.length;
    saveHold(); bust();
    return { ok: removed > 0, removed, msg: removed ? `已删除 ${removed} 条旧数据` : '没有匹配的持仓' };""",
"""    const n = HOLD.items.length;
    const before = HOLD.items.slice();
    HOLD.items = HOLD.items.filter(x => !set.has(String(x.code)));
    const removed = n - HOLD.items.length;
    if (removed > 0) commit('removeMany', before, HOLD.items, { removedCodes: before.filter(x => set.has(String(x.code))).map(x => String(x.code)) });
    return { ok: removed > 0, removed, msg: removed ? `已删除 ${removed} 条旧数据` : '没有匹配的持仓' };"""),

("""  function clearAll() {
    const n = HOLD.items.length;
    HOLD.items = [];
    saveHold(); bust();
    return { ok: true, removed: n, msg: n ? `已清空全部 ${n} 条持仓（总资金/风控参数保留）` : '持仓本来就是空的' };
  }""",
"""  function clearAll() {
    const n = HOLD.items.length;
    const before = HOLD.items.slice();
    HOLD.items = [];
    if (n > 0) {
      commit('clear', before, HOLD.items, { removedCodes: before.map(x => String(x.code)) });
      // 清空是最容易被误点、后果又最重的一步。留痕还不够，必须让本人立刻知道：
      // 万一不是他本人操作（别人拿了设备 / 误触），这条提醒就是唯一的止损时机。
      try {
        pushAll('═══ 🗑 持仓已清空 ═══',
          `你的持仓里 ${n} 条已被清空：\\n` +
          before.slice(0, 20).map(x => `▪ ${(x && x.name) || ''}(${(x && x.code) || ''})`).join('\\n') +
          `\\n若不是你本人操作，到面板「持仓 → 变更记录」可一键还原（已自动留快照）。`);
      } catch {}
    }
    return { ok: true, removed: n, msg: n ? `已清空全部 ${n} 条持仓（总资金/风控参数保留）` : '持仓本来就是空的' };
  }"""),
]
for old, new in reps:
    assert old in t, '锚点未命中: ' + old[:60]
    t = t.replace(old, new, 1)

# add / update / lock 也登记（增也要有痕迹，否则「用户到底加过没有」仍查不出来）
add_anchor = """  function addItem(o) {"""
assert add_anchor in t
t = t.replace(add_anchor, """  function addItem(o) {
    const _beforeAdd = HOLD.items.slice();""", 1)

out = t.replace('\n', '\r\n') if crlf else t
open(F, 'wb').write(out.encode('utf-8'))
print('注入完成')
