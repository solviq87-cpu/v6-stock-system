# -*- coding: utf-8 -*-
# dw 轮：补救动作的「完成」判据 —— 只跑过 ≠ 补好了；跳过补救=消耗一次机会，必须留痕
import io, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

def rd(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

def rep(path, old, new, tag):
    s = rd(path)
    n = s.count(old)
    if n != 1:
        FAILS.append(tag + ' :: 锚点命中 %d 次' % n)
        print('FAIL ' + tag + ' :: 锚点命中 %d 次' % n)
        return
    wr(path, s.replace(old, new))
    print('OK   ' + tag)

SRV = 'server.js'
HTML = 'public/index.html'

# ── ① 登记表 + 唯一出口 ──
BLOCK = u"""// ───────── dw 轮：补救动作的「完成」判据 ─────────
// 系统里散着一批「补救」动作：启动首扫、启动补样本、复盘重启补发、K线补齐、回拉对账……
// 它们的共同点是**机会有限**（启动链上只跑 2~3 次，或探测 30 次就放弃），而以前「完成」的判据
// 是「跑过了」而不是「补出来了」：被并发锁挡下（返回 {running:true}）、抛异常被 catch 吞掉、
// 产出 0 条 —— 三种情况全都算完成，机会立刻归零，且一个字都不说。
// ⛔ 更隐蔽的是分叉：同一个 `scanTrendUniverse`，手动入口 /api/scan-trend **判了 r.running**
//    （会 pushLog「⏭ 全市场扫描未启动」），启动首扫那条路却把返回值赋给 `const r` 后**再没看过** ——
//    同一个补救，一个入口负责、另一个入口不负责。
// ⛔ 补救被跳过和普通判据跳过不是一回事：判据跳过只是这一轮少算一条，
//    **补救跳过消耗的是有限的机会**，跳过一次就少一次，所以每种原因都必须登记并交出去。
const REMEDY_RULE = {
  bootScan:   { tries: 30, label: '启动首扫（趋势/连涨/涨停前）' },
  bootSeed:   { tries: 3,  label: '启动补样本与回验' },
  reviewBoot: { tries: 2,  label: '复盘重启补发' }
};
// 「补失败了」的四种说法（dl 轮「成功有几种说法」在补救链上的延续）
const REMEDY_WHY = {
  noRet: '调用方拿不到返回值（无从判断补没补上）',
  busy:  '被并发锁挡下（本次根本没启动）',
  err:   '抛异常或返回 ok:false',
  zero:  '跑完了但产出 0 条'
};
// 「这次机会被跳过」的原因（按动作分）
const REMEDY_SKIP = {
  bootScanNoDb:    '学习库还没加载完',
  bootSeedEnough:  '样本已够 20 条（不需要补）',
  reviewWeekend:   '周末（按设计不补）',
  reviewNotTrade:  '休市日（按设计不补）',
  reviewOffWin:    '不在收盘后窗口（15:30-23:59）',
  reviewAlready:   '当天已发过',
  reviewBusy:      '上一轮复盘还在跑',
  reviewNoPool:    '涨停池为空（数据没回来）'
};
const _remedy = {};
function remedyWhyOf(w) { return REMEDY_WHY[w] || REMEDY_SKIP[w] || String(w || ''); }
function remedyNote(name) {
  const g = _remedy[name], R = REMEDY_RULE[name];
  if (!g || !g.used || !R) return '';
  const wl = remedyWhyOf(g.why);
  const chance = R.tries ? ('（机会 ' + g.used + '/' + R.tries + '）') : '';
  if (g.ok === true) return R.label + '：补出 ' + (g.n == null ? '-' : g.n) + ' 条' + (g.why === 'zero' ? ' ⚠️ 0 条' : '');
  if (g.ok === false) return R.label + '：' + (wl || '没跑成') + chance;
  return R.label + '：' + (wl || '被跳过') + chance;
}
// 补救自己跳过时留痕 —— 未登记的原因直接丢弃，逼着新增跳过来这里写清楚
function remedySkip(name, why) {
  if (!REMEDY_RULE[name]) { console.error('[remedy] 未登记的补救名: ' + name); return 0; }
  if (!REMEDY_SKIP[why]) { console.error('[remedy] 未登记的跳过原因: ' + why); return 0; }
  const g = _remedy[name] || (_remedy[name] = { used: 0, ok: null, why: '', n: null, at: 0 });
  g.used++; g.why = why; g.at = Date.now(); g.ok = null;
  return g.used;
}
// ⛔ 判据是「到底跑没跑」，不是「跑没跑过」：
//    running / 异常 → 不算完成，保留机会下次再试；跑完了但 0 条 → 算完成，但必须留痕告警。
function remedyDone(name, r, outN) {
  if (!REMEDY_RULE[name]) { console.error('[remedy] 未登记的补救名: ' + name); return false; }
  const g = _remedy[name] || (_remedy[name] = { used: 0, ok: null, why: '', n: null, at: 0 });
  g.used++; g.at = Date.now();
  const n = Number.isFinite(Number(outN)) ? Number(outN) : null;
  let why = '', ok = true;
  if (!r) { ok = false; why = 'noRet'; }
  else if (r.running) { ok = false; why = 'busy'; }
  else if (r.ok === false) { ok = false; why = 'err'; }
  else if (n === 0) { why = 'zero'; }
  g.ok = ok; g.why = why; g.n = n;
  const note = remedyNote(name);
  if (!ok) console.warn('[remedy] ' + note + ' → 不算完成，保留机会下次再试');
  else if (why === 'zero') console.warn('[remedy] ' + note + ' → 已跑完但 0 条，不再重试（可能今天真没票）');
  return ok;
}
function remedyState() {
  const o = {};
  for (const k of Object.keys(REMEDY_RULE)) {
    const R = REMEDY_RULE[k], g = _remedy[k] || { used: 0, ok: null, why: '', n: null, at: 0 };
    o[k] = { label: R.label, tries: R.tries, used: g.used, ok: g.ok, why: g.why,
             whyLabel: remedyWhyOf(g.why), n: g.n, at: g.at,
             left: R.tries ? Math.max(0, R.tries - g.used) : null, note: remedyNote(k) };
  }
  return o;
}
let _empCache = { t: 0, map: {}, done: false };"""

rep(SRV,
    "let _empCache = { t: 0, map: {}, done: false };",
    BLOCK,
    '① REMEDY 登记表 + 唯一出口')

# ── ② _bootScan：把「跑过」改成「补出来了」──
rep(SRV,
    u"""  const _bootScan = () => {
    const db = laDb();
    if (!db || !db.n) return false;                       // 学习库还没加载完，下一轮再试
    (async () => {
      // 副本（本地）也扫：它不外推（push 侧另有 isReplica 拦），但自己的面板要看得到
      try {
        const r = await scanTrendUniverse(30);
        const rs = await scanSteadyUp(12);
        // 涨停前形态：先入库再扫（首次启动库是空的，不入库就没法预测）
        try {
          const iz = await runZtpreIngest();
          if (iz && iz.added) console.log(`[ztpre] 启动入库 ${iz.added} 条，累计 ${iz.total} 条`);
          const rz = await scanZtPre(20);
          if (rz && rz.ok) console.log(`[ztpre] 启动扫描：${rz.scanned} 只 → 有效 ${rz.total} 只，取前 ${rz.top} 只（${rz.ms}ms）`);
        } catch (e) { console.error('[ztpre] 启动失败:', e && e.message); }
        console.log(`[trend-scan] 启动首扫完成：趋势 ${(S.trendScan || []).length} 只 / 连涨 ${(S.steadyUp || []).length} 只 / 涨停前 ${(S.ztPre || []).length} 只`);
      } catch (e) { console.error('[trend-scan] 启动首扫失败:', e && e.message); }
      _bootScanDone = true;
    })();
    return true;
  };""",
    u"""  const _bootScan = () => {
    const db = laDb();
    if (!db || !db.n) { remedySkip('bootScan', 'bootScanNoDb'); return false; }   // 学习库还没加载完，下一轮再试
    (async () => {
      const _rs = [];
      // 副本（本地）也扫：它不外推（push 侧另有 isReplica 拦），但自己的面板要看得到
      try {
        const r = await scanTrendUniverse(30);
        const rs = await scanSteadyUp(12);
        _rs.push(r, rs);
        // 涨停前形态：先入库再扫（首次启动库是空的，不入库就没法预测）
        try {
          const iz = await runZtpreIngest();
          if (iz && iz.added) console.log(`[ztpre] 启动入库 ${iz.added} 条，累计 ${iz.total} 条`);
          const rz = await scanZtPre(20);
          if (rz && rz.ok) console.log(`[ztpre] 启动扫描：${rz.scanned} 只 → 有效 ${rz.total} 只，取前 ${rz.top} 只（${rz.ms}ms）`);
          _rs.push(rz);
        } catch (e) { console.error('[ztpre] 启动失败:', e && e.message); _rs.push({ ok: false, error: e && e.message }); }
        console.log(`[trend-scan] 启动首扫完成：趋势 ${(S.trendScan || []).length} 只 / 连涨 ${(S.steadyUp || []).length} 只 / 涨停前 ${(S.ztPre || []).length} 只`);
      } catch (e) { console.error('[trend-scan] 启动首扫失败:', e && e.message); _rs.push({ ok: false, error: e && e.message }); }
      // ⛔ dw 轮：以前 `_bootScanDone = true` 写在 catch **之后**、无条件执行 —— 「跑过」被当成「补好了」。
      //    三种情况都会宣告完成、30 次探测机会立刻归零：① 撞上 _tsBusy（返回 {running:true}，
      //    这一次根本没启动）② 抛异常被上面的 catch 吞掉 ③ 三池全是 0 只（学习库刚有个位数样本时必然如此）。
      //    而同一个 scanTrendUniverse 在手动入口 /api/scan-trend 是**判了 r.running 的**（会 pushLog
      //    「⏭ 全市场扫描未启动」）—— 同一个补救，一个入口负责、另一个入口不负责。
      //    现在按「到底跑没跑」判：没跑成就保留机会、下次再试；跑完了但 0 条要留痕告警（不再重试，
      //    因为 0 条也可能是今天真没票，重试 30 遍等于把 K 线缓存白扫 30 遍）。
      const _out = (S.trendScan || []).length + (S.steadyUp || []).length + (S.ztPre || []).length;
      const _agg = _rs.some(x => x && x.running) ? { running: true }
        : (_rs.some(x => x && x.ok === false) ? { ok: false, error: (_rs.filter(x => x && x.error)[0] || {}).error } : { ok: true });
      if (remedyDone('bootScan', _agg, _out)) _bootScanDone = true;
    })();
    return true;
  };""",
    '② _bootScan 完成判据')

rep(SRV,
    u"    if (++_bootScanTries > 30) { clearInterval(_bootScanTimer); console.log('[trend-scan] 启动首扫放弃：学习库迟迟未就绪'); return; }",
    u"    if (++_bootScanTries > 30) { clearInterval(_bootScanTimer); console.warn('[trend-scan] 启动首扫放弃：' + (remedyNote('bootScan') || '学习库迟迟未就绪')); return; }",
    '②b 放弃日志带真实原因')

# ── ③ _reviewStartupCheck：静默 return 消耗有限机会 ──
rep(SRV,
    u"""      if (!(wd >= 1 && wd <= 5)) return;
      if (!isTradeDay(d)) return;                          // ⛔ 休市日（如国庆里的周五）绝不拿节前涨停池补发复盘
      if (!(t >= 15 * 60 + 30 && t < 23 * 60 + 59)) return; // 只补收盘后到午夜前
      if (reviewSentDate === todayStr()) return;            // 当天已发过
      if (reviewBusy || !(S.ztPool || []).length) return;    // 没涨停池就别空推""",
    u"""      // ⛔ dw 轮：这五个 return 以前**全静默**。而这一路补救**只有 2 次机会**（启动 2 分钟 / 8 分钟），
      //    静默 return 就等于把机会悄悄消耗掉 —— 8 分钟那次若撞上 reviewBusy 或涨停池没回来，
      //    当天的复盘补发就彻底消失了，用户只看到「今天没有复盘」，无从自查。
      //    现在每条都登记原因并计数（真按设计不该补的：周末/休市/已发过，也要能区分）。
      if (!(wd >= 1 && wd <= 5)) { remedySkip('reviewBoot', 'reviewWeekend'); return; }
      if (!isTradeDay(d)) { remedySkip('reviewBoot', 'reviewNotTrade'); return; }          // ⛔ 休市日（如国庆里的周五）绝不拿节前涨停池补发复盘
      if (!(t >= 15 * 60 + 30 && t < 23 * 60 + 59)) { remedySkip('reviewBoot', 'reviewOffWin'); return; } // 只补收盘后到午夜前
      if (reviewSentDate === todayStr()) { remedySkip('reviewBoot', 'reviewAlready'); return; }            // 当天已发过
      if (reviewBusy) { remedySkip('reviewBoot', 'reviewBusy'); return; }
      if (!(S.ztPool || []).length) { remedySkip('reviewBoot', 'reviewNoPool'); return; }                  // 没涨停池就别空推""",
    '③ 复盘启动补发留痕')

# ── ④ _bootSeed：补 0 条时静默 ──
rep(SRV,
    u"""      const _ok = (S.learn.signals || []).filter(s => s.resolved && !s.void).length;
      if (_ok < 20) { const r = await seedLearnFromHistory(60, 600); if (r.added) console.log('[learn] 启动补样本 +' + r.added + ' 条'); }""",
    u"""      const _ok = (S.learn.signals || []).filter(s => s.resolved && !s.void).length;
      if (_ok < 20) {
        const r = await seedLearnFromHistory(60, 600);
        if (r.added) console.log('[learn] 启动补样本 +' + r.added + ' 条');
        // ⛔ dw 轮：补出 0 条时以前**完全静默**（只有 added>0 才打印），而这一路只有 3 次机会
        //    （90s / 6min / 15min）—— 三趟全补 0 条，等于这三趟白跑且没人知道。
        remedyDone('bootSeed', { ok: true }, (r && r.added) || 0);
      } else remedySkip('bootSeed', 'bootSeedEnough');""",
    '④ 启动补样本留痕')

# ── ⑤ /api/state 下发 ──
rep(SRV,
    u"      taskState: taskState(),",
    u"      taskState: taskState(),\n      remedy: remedyState(),",
    '⑤ /api/state 下发 remedy')

# ── ⑥ 前端：补救没补上要看得见 ──
rep(HTML,
    u"""    html += ' <span class="muted" style="cursor:help" title="⛔ 推送返回 true 不等于送达：副本拦截 / 条数闸门都返回 true，手机一条收不到（dl 轮）">末次推送：' + sentTxt + (pl.why ? '（' + esc(pl.why) + '）' : '') + '</span>';
  }
  box.innerHTML = html;""",
    u"""    html += ' <span class="muted" style="cursor:help" title="⛔ 推送返回 true 不等于送达：副本拦截 / 条数闸门都返回 true，手机一条收不到（dl 轮）">末次推送：' + sentTxt + (pl.why ? '（' + esc(pl.why) + '）' : '') + '</span>';
  }
  // ⛔ dw 轮：补救动作没补上必须看得见 —— 启动首扫/启动补样本/复盘重启补发都只有有限次机会，
  //    「跑过」不等于「补好了」。以前这些补救悄悄失败，用户看到的只是「今天没有复盘 / 没有趋势票」。
  const rm = s.remedy || {};
  const bad = Object.keys(rm).filter(k => rm[k] && (rm[k].ok === false || rm[k].why === 'zero' || rm[k].why === 'busy' || rm[k].why === 'err'));
  if (bad.length) {
    const txt = bad.map(k => esc((rm[k].label || k)) + '：' + esc(String(rm[k].whyLabel || ''))).join('；');
    html += ' <span class="tag" style="background:#fff3bf;color:#8a5a00;cursor:help" title="' + esc(bad.map(k => String(rm[k].note || '')).join('；')) + '">⚠️ 补救未成：' + txt + '</span>';
  }
  box.innerHTML = html;""",
    '⑥ 前端补救徽标')

print('\n==== FAILS: %d ====' % len(FAILS))
sys.exit(1 if FAILS else 0)
