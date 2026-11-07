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
    src = src.replace(old, new, n)
    print('OK  ' + tag)

# ── 1) 插入 DONE_RULE / EMPTY_WHY / PUSH_DONE 三张登记表 ──
BLK = u'''// ───────── dl 轮：同一个「成功」在系统里有几种说法 ─────────
// 以前「成功」只有一种说法：ok = true（= 没抛异常）。后果是：
//   · 跑出 12 只 → ✅；跑出 0 只（数据源限流 / 池子空 / 闸门全拦）→ 也是 ✅
//   · 推送「返回 true」→ 调用方当"送达"置位闭锁，实际可能是副本拦截 / 条数闸门，手机一条没收到
//   用户看到满屏 ✅ 却什么都没有，分不清「今天真没符合条件的票」和「数据源挂了所以 0 只」。
//   ⛔ 与 dk 轮（失败的五种说法）是同一件事的两半：失败要分级，成功同样要分级。
const DONE_RULE = {
  yield:  { rank: 1, label: '有产出',      mark: '\\u2705', note: '真跑出了 N 条（n>0）\\u2192 面板 \\u2705 N' },
  empty:  { rank: 2, label: '跑通但 0 条', mark: '\\u26aa', note: '没抛异常但一条都没出 \\u2192 必须带 empty 原因，面板 \\u26aa 0（原因）；\\u26a0 不许打 \\u2705' },
  ok:     { rank: 3, label: '仅未抛异常',  mark: '\\u00b7',  note: '推送 / 写入 / 配置类 \\u2192 不代表有产出，面板不打 \\u2705 N' },
  skip:   { rank: 4, label: '本轮没跑',    mark: '\\u2014',  note: '未开盘 / 未到时段 / 被闸门跳过 \\u2192 既不是成功也不是失败' },
  fail:   { rank: 5, label: '本轮没跑成',  mark: '\\u274c', note: '抛异常了 \\u2192 走 dk 轮 FAIL_RULE.task，带 error 原因' }
};
const doneOf = k => { const d = DONE_RULE[k]; return d ? d.mark : ''; };
// 0 条的原因枚举：\\u26a0 0 条必须说明为什么，否则和「数据源挂了」在用户眼里长得一模一样
const EMPTY_WHY = {
  noMarket: '未开盘（行情源无实时数据）',
  noSrc:    '数据源没回来（保留上一次结果）',
  noCand:   '候选池为空（上游没给出候选）',
  gate:     '全部被闸门拦下（门槛 / 市值 / 质量）',
  noTime:   '此时段天然无数据（如竞价只在 9:15~9:25）',
  justNone: '本轮确实没有符合条件的票',
  unknown:  '0 条但没登记原因'          // \\u26a0 兜底：守门测试要求线上不出现这一条
};
const emptyWhyOf = k => EMPTY_WHY[k] || EMPTY_WHY.unknown;
// 推送侧的「成功」：\\u26a0 返回 true \\u2260 送达（副本拦截 / 条数闸门都返回 true，手机一条收不到）
const PUSH_DONE = {
  sent:    { ret: true,  mark: '已送达', note: '真的发出去了 \\u2192 调用方可以置位闭锁' },
  blocked: { ret: true,  mark: '未送达', note: '副本拦截 / 条数闸门 / 无通道 \\u2192 返回 true 只表示「本轮终结」，不代表送达' },
  silent:  { ret: false, mark: '静默',   note: '夜间静默 \\u2192 返回 false，时段一过自动解除，值得重试' }
};
let _pushLast = { ret: null, sent: null, why: '', t: 0 };
function pushLast() { return Object.assign({}, _pushLast); }
function doneRuleState() {
  const o = {};
  for (const k of Object.keys(DONE_RULE)) o[k] = { label: DONE_RULE[k].label, mark: DONE_RULE[k].mark, note: DONE_RULE[k].note };
  return o;
}
'''
rep(u"let _rollbackMsg = null;", BLK + u"let _rollbackMsg = null;", 'insert DONE_RULE block')

# ── 2) taskSet / taskState：ok:true 不再是成功的唯一说法 ──
OLD_TS = u'''const _taskState = {};
function taskSet(name, patch) {
  if (!TASK_RULE[name]) { console.error('[task] 未登记的任务名: ' + name); return; }
  const cur = _taskState[name] || { ok: null, error: '', n: 0, ms: 0, t: 0 };
  _taskState[name] = Object.assign({}, cur, patch, { t: Date.now() });
}
function taskState() {
  const o = {};
  for (const k of Object.keys(TASK_RULE)) {
    const v = _taskState[k] || { ok: null, error: '', n: 0, ms: 0, t: 0 };
    o[k] = { name: TASK_RULE[k], ok: v.ok, error: v.error, n: v.n, ms: v.ms, t: v.t };
  }
  return o;
}'''
NEW_TS = u'''const _taskState = {};
function taskSet(name, patch) {
  if (!TASK_RULE[name]) { console.error('[task] 未登记的任务名: ' + name); return; }
  const cur = _taskState[name] || { ok: null, error: '', n: 0, ms: 0, t: 0, done: '', empty: '' };
  const nx = Object.assign({}, cur, patch, { t: Date.now() });
  // ⛔ dl 轮：ok:true 不再是「成功」的唯一说法 —— n=0 一律降级成 empty，且必须带原因。
  //    n>0 → yield（有产出）｜ n=0 → empty（跑通但 0 条）｜ ok:false → fail ｜ ok:null → skip
  if (nx.ok === true) {
    const n = Number(nx.n) || 0;
    if (n > 0) { nx.done = 'yield'; nx.empty = ''; }
    else { nx.done = 'empty'; if (!nx.empty) nx.empty = emptyWhyOf('unknown'); }
  } else if (nx.ok === false) { nx.done = 'fail'; nx.empty = ''; }
  else { nx.done = 'skip'; nx.empty = ''; }
  _taskState[name] = nx;
}
function taskState() {
  const o = {};
  for (const k of Object.keys(TASK_RULE)) {
    const v = _taskState[k] || { ok: null, error: '', n: 0, ms: 0, t: 0, done: '', empty: '' };
    o[k] = { name: TASK_RULE[k], ok: v.ok, error: v.error, n: v.n, ms: v.ms, t: v.t,
             done: v.done || '', empty: v.empty || '', mark: doneOf(v.done || '') };
  }
  return o;
}'''
rep(OLD_TS, NEW_TS, 'taskSet/taskState 分级')

# ── 3) 各 taskSet 成功点：显式登记 0 条的原因（不许落到 unknown）──
rep(u"  taskSet('ztpre', { ok: !!_zpProg.ok, error: _zpProg.error || '', n: _zpProg.total || 0, ms: _zpProg.ms || 0 });",
    u"  taskSet('ztpre', { ok: !!_zpProg.ok, error: _zpProg.error || '', n: _zpProg.total || 0, ms: _zpProg.ms || 0,\n"
    u"                     empty: (_zpProg.total || 0) ? '' : emptyWhyOf('justNone') });",
    'ztpre empty')
rep(u"  taskSet('trendScan', { ok: !!_tsProg.ok, error: _tsProg.error || '', n: _tsProg.total || 0, ms: _tsProg.elapsedMs || 0 });",
    u"  taskSet('trendScan', { ok: !!_tsProg.ok, error: _tsProg.error || '', n: _tsProg.total || 0, ms: _tsProg.elapsedMs || 0,\n"
    u"                         empty: (_tsProg.total || 0) ? '' : emptyWhyOf('justNone') });",
    'trendScan empty')
rep(u"  taskSet('steadyUp', { ok: true, error: '', n: out.length });",
    u"  taskSet('steadyUp', { ok: true, error: '', n: out.length, empty: out.length ? '' : emptyWhyOf('justNone') });",
    'steadyUp empty')
rep(u"    taskSet('kbf', { ok: true, error: '', n: _kbfProg.added || 0, ms: _kbfProg.elapsedMs || 0 });",
    u"    taskSet('kbf', { ok: true, error: '', n: _kbfProg.added || 0, ms: _kbfProg.elapsedMs || 0,\n"
    u"                     empty: (_kbfProg.added || 0) ? '' : emptyWhyOf('justNone') });",
    'kbf empty')
rep(u"    taskSet('bigmoney', { ok: true, error: '', n: ((S.bigMoney || {}).items || []).length });",
    u"    taskSet('bigmoney', { ok: true, error: '', n: ((S.bigMoney || {}).items || []).length,\n"
    u"                          empty: (((S.bigMoney || {}).items || []).length ? '' : emptyWhyOf('justNone')) });",
    'bigmoney empty')
rep(u"    taskSet('similar', { ok: true, error: '', n: list.length });",
    u"    taskSet('similar', { ok: true, error: '', n: list.length, empty: list.length ? '' : emptyWhyOf('justNone') });",
    'similar empty')
rep(u"    taskSet('pre', { ok: true, error: '', n: ((S.pre || {}).items || []).length });",
    u"    taskSet('pre', { ok: true, error: '', n: ((S.pre || {}).items || []).length,\n"
    u"                     empty: (((S.pre || {}).items || []).length ? '' : emptyWhyOf('justNone')) });",
    'pre empty')

# ── 4) 空池出口统一带 empty 说明（以前只有 myrules 带，其余三个光秃秃一个 items:[]）──
rep(u"  if (!base.length) { if (marketReady()) S.bigMoney = { time: new Date().toLocaleTimeString('zh-CN'), items: [] }; return []; }",
    u"  if (!base.length) { if (marketReady()) S.bigMoney = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('noCand') }; return []; }",
    'bigmoney 空池')
rep(u"  if (!cands.length) { if (marketReady()) S.pre = { time, items: [] }; return []; }",
    u"  if (!cands.length) { if (marketReady()) S.pre = { time, items: [], empty: emptyWhyOf('noCand') }; return []; }",
    'pre 空池')
rep(u"  if (!S.ztPool.length) { if (marketReady()) S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [] }; return; }",
    u"  if (!S.ztPool.length) { if (marketReady()) S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('justNone') }; return; }",
    'buzhang 空池(无涨停)')
rep(u"  if (!cands.length) { if (marketReady()) S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [] }; return; }",
    u"  if (!cands.length) { if (marketReady()) S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('gate') }; return; }",
    'buzhang 空池(闸门)')
rep(u"empty: '候选池为空' };", u"empty: emptyWhyOf('noCand') };", 'myrules 空池', n=2)

# ── 5) pushAll：四种「成功」出口各记一份真实语义 ──
rep(u"    return true;   // 副本：本轮终结（不对外发，但也不能让调用方无限重试烧数据源）",
    u"    _pushLast = { ret: true, sent: false, why: '副本拦截（本实例不外发）', t: Date.now() };\n"
    u"    return true;   // 副本：本轮终结（不对外发，但也不能让调用方无限重试烧数据源）",
    'pushAll 副本拦截')
rep(u"    return true;   // 额度按天重置，当天重试无用 → 本轮终结（内容已进面板流水）",
    u"    _pushLast = { ret: true, sent: false, why: '条数闸门：' + (_mg.why || ''), t: Date.now() };\n"
    u"    return true;   // 额度按天重置，当天重试无用 → 本轮终结（内容已进面板流水）",
    'pushAll 条数闸门')
rep(u"    return false;   // 夜间静默拦下：没发出去",
    u"    _pushLast = { ret: false, sent: false, why: '夜间静默', t: Date.now() };\n"
    u"    return false;   // 夜间静默拦下：没发出去",
    'pushAll 夜间静默')
rep(u"      if (r && r.ok) { pushLog('✅ 已送达(私密)'",
    u"      if (r && r.ok) { _pushLast = { ret: true, sent: true, why: '', t: Date.now() }; pushLog('✅ 已送达(私密)'",
    'pushAll 私密送达')
rep(u"        if (ok) pushLog('✅ 已送达', text, { channel: '飞书(退回)' });",
    u"        if (ok) { _pushLast = { ret: true, sent: true, why: '', t: Date.now() }; pushLog('✅ 已送达', text, { channel: '飞书(退回)' }); }",
    'pushAll 退回送达', n=2)
rep(u"    return true;   // ⛔ 私密已接管：绝不再往下走群机器人 + 邮箱（否则等于私密了个寂寞）",
    u"    if (_pushLast.sent !== true) _pushLast = { ret: true, sent: null, why: '私密通道异步发送中', t: Date.now() };\n"
    u"    return true;   // ⛔ 私密已接管：绝不再往下走群机器人 + 邮箱（否则等于私密了个寂寞）",
    'pushAll 私密接管')
rep(u"""  const _settle = () => {
    if (_fsOk === null || _mailOk === null) return;     // 还有通道没回话，再等等
    if (_fsOk || _mailOk) return;                       // 任一通道送到 → 占位不退（避免重复推）
    _release(_mailOn ? '飞书与邮箱都没送到' : '飞书未送达');
  };
  feishuSend(text, (ok, info) => {""",
    u"""  const _settle = () => {
    if (_fsOk === null || _mailOk === null) return;     // 还有通道没回话，再等等
    // ⛔ dl 轮：顺带把「到底送没送出去」定格下来 —— 以前只有"返回 true"，
    //    而 true 里混着「已送达」与「被闸门拦下根本没发」，面板与流水都看不出区别。
    if (_fsOk || _mailOk) { _pushLast = { ret: true, sent: true, why: '', t: Date.now() }; return; }
    _pushLast = { ret: true, sent: false, why: _mailOn ? '飞书与邮箱都没送到' : '飞书未送达', t: Date.now() };
    _release(_mailOn ? '飞书与邮箱都没送到' : '飞书未送达');
  };
  _pushLast = { ret: true, sent: null, why: '异步发送中', t: Date.now() };
  feishuSend(text, (ok, info) => {""",
    'pushAll 主通道 settle')
rep(u"    return true;   // 配置问题，重试无用 → 本轮终结（已记「未配置通道」流水）",
    u"    _pushLast = { ret: true, sent: false, why: '未配置通道（飞书与邮箱都没配）', t: Date.now() };\n"
    u"    return true;   // 配置问题，重试无用 → 本轮终结（已记「未配置通道」流水）",
    'pushAll 未配置通道')

# ── 6) /api/state 下发 ──
rep(u"    taskState: taskState(),",
    u"    taskState: taskState(),\n    doneRule: doneRuleState(),\n    pushLast: pushLast(),",
    'api/state 下发 doneRule+pushLast')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('written, delta=%d chars' % (len(src) - len(orig)))
