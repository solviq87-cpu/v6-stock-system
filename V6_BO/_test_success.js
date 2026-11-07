// 守门 · dl 轮：同一个「成功」，在系统里必须有同一套说法
//   本轮角度（dk 轮「失败有几种说法」的对称另一半）：以前「成功」只有一种说法 —— ok = true
//   （= 没抛异常）。实测同一个 ok:true 在系统里至少指四件事：
//     ① 真产出：扫出 12 只         → 面板该显示 ✅ 12
//     ② 跑通但 0 只：数据源限流 / 池子空 / 闸门全拦 → 也是 ✅，用户分不清"今天没票"还是"源挂了"
//     ③ 仅未抛异常：推送 / 写入 / 配置类           → 不代表有任何产出
//     ④ 推送返回 true：真送达 / 副本拦截 / 条数闸门 → 返回 true 手机可能一条都没收到
//   修法：DONE_RULE 给成功分级 + EMPTY_WHY 给 0 条定原因 + PUSH_DONE 把"送达"与"返回 true"分开。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };

// ── 沙箱：把 TASK_RULE / taskSet / DONE_RULE / EMPTY_WHY / PUSH_DONE 整块切出来真跑 ──
const DONE_SRC = cut(SV, 'const TASK_RULE = {', 'let _rollbackMsg = null;');
const _errs = [];
const F = new Function('console', DONE_SRC +
  '\nreturn { TASK_RULE, taskSet, taskState, _taskState, DONE_RULE, doneOf, EMPTY_WHY, emptyWhyOf, PUSH_DONE, pushLast, doneRuleState };'
)({ error: (...a) => _errs.push(a.join(' ')), log() { } });

// ════════ 【A】DONE_RULE：成功的四个等级 ════════
console.log('【A】DONE_RULE：成功必须分级，不许只有一种说法');
{
  const ks = Object.keys(F.DONE_RULE);
  ok('等级表非空', ks.length >= 4, '实得 ' + ks.length);
  for (const k of ['yield', 'empty', 'ok', 'skip', 'fail'])
    ok('等级 ' + k + ' 已登记', ks.indexOf(k) >= 0);
  for (const k of ks) {
    const d = F.DONE_RULE[k];
    ok(k + ' 有 label', typeof d.label === 'string' && d.label.length > 0);
    ok(k + ' 有 mark（面板符号）', typeof d.mark === 'string' && d.mark.length > 0);
    ok(k + ' 有 note 说明', typeof d.note === 'string' && d.note.length > 0);
    ok(k + ' 有排序 rank', typeof d.rank === 'number');
  }
  // ⛔ 核心：有产出与 0 条必须是两个不同的等级、两个不同的符号
  ok('⛔ 有产出与 0 条不是同一个等级', F.DONE_RULE.yield.rank !== F.DONE_RULE.empty.rank);
  ok('⛔ 有产出与 0 条的面板符号不同', F.DONE_RULE.yield.mark !== F.DONE_RULE.empty.mark,
    F.DONE_RULE.yield.mark + ' vs ' + F.DONE_RULE.empty.mark);
  ok('0 条的 note 里写明不许打勾', F.DONE_RULE.empty.note.indexOf('不许打') >= 0);
  ok('doneOf 未登记等级返回空串', F.doneOf('不存在的等级') === '');
  ok('doneOf 取得到符号', F.doneOf('yield').length > 0);
  ok('doneRuleState 下发全部等级', Object.keys(F.doneRuleState()).length === ks.length);
}

// ════════ 【B】taskSet：ok:true 不再是成功的唯一说法 ════════
console.log('【B】taskSet：n>0 与 n=0 必须落到不同等级');
{
  F.taskSet('steadyUp', { ok: true, n: 12 });
  let s = F.taskState().steadyUp;
  ok('跑出 12 只 → yield', s.done === 'yield', s.done);
  ok('有产出时不带 empty 说明', s.empty === '');
  ok('面板符号是勾', s.mark === F.DONE_RULE.yield.mark);

  F.taskSet('steadyUp', { ok: true, n: 0, empty: F.emptyWhyOf('justNone') });
  s = F.taskState().steadyUp;
  ok('⛔ 跑出 0 只 → empty（不是 yield）', s.done === 'empty', s.done);
  ok('⛔ 0 只的面板符号不是勾', s.mark !== F.DONE_RULE.yield.mark, s.mark);
  ok('0 只带上了原因', s.empty === F.EMPTY_WHY.justNone, s.empty);

  F.taskSet('steadyUp', { ok: false, error: '数据源超时' });
  s = F.taskState().steadyUp;
  ok('失败 → fail', s.done === 'fail', s.done);
  ok('失败带 error', s.error === '数据源超时');

  F.taskSet('steadyUp', { ok: null });
  s = F.taskState().steadyUp;
  ok('没跑 → skip', s.done === 'skip', s.done);

  // ⛔ 反证：0 条却没登记原因 → 必须落到 unknown 兜底（而不是当成有产出）
  F.taskSet('similar', { ok: true, n: 0 });
  ok('⛔ 0 条没给原因 → 兜底 unknown', F.taskState().similar.empty === F.EMPTY_WHY.unknown,
    F.taskState().similar.empty);
  ok('且等级仍是 empty（没被当成成功）', F.taskState().similar.done === 'empty');
  ok('unknown 兜底文案里点明了问题', F.EMPTY_WHY.unknown.indexOf('没登记原因') >= 0);
  // ⛔ 0 条的原因必须对得上这件事本身：K线回填 0 条是「没有要补的」，不是「没有符合条件的票」
  ok('登记了 noWork（没得补 ≠ 没票）', typeof F.EMPTY_WHY.noWork === 'string' && F.EMPTY_WHY.noWork.length > 0);
  ok('noWork 与 justNone 是两种说法', F.EMPTY_WHY.noWork !== F.EMPTY_WHY.justNone);
  const _st = [];
  for (let p = 0; ;) { p = SV.indexOf('taskSet(', p); if (p < 0) break; _st.push(SV.slice(p, p + 260)); p += 8; }
  const kbfStmt = _st.filter(t => t.indexOf("taskSet('kbf'") >= 0 && t.indexOf('ok: true') >= 0);
  ok('K线回填 0 条用的不是「没有符合条件的票」',
    kbfStmt.length > 0 && kbfStmt.every(t => t.indexOf("emptyWhyOf('noWork')") >= 0),
    kbfStmt.join(' | ').slice(0, 120));
}

// ════════ 【C】EMPTY_WHY：0 条必须说明为什么 ════════
console.log('【C】EMPTY_WHY：0 条的原因枚举');
{
  const ks = Object.keys(F.EMPTY_WHY);
  ok('原因枚举非空', ks.length >= 5, '实得 ' + ks.length);
  for (const k of ks) ok(k + ' 是中文说明', typeof F.EMPTY_WHY[k] === 'string' && F.EMPTY_WHY[k].length > 0);
  ok('未登记的原因回落到 unknown', F.emptyWhyOf('瞎写的') === F.EMPTY_WHY.unknown);
  ok('登记过的原因取得到原文', F.emptyWhyOf('noCand') === F.EMPTY_WHY.noCand);
  // 源码契约：池子被清成空结果时，必须同时写 empty —— 以前只有 myrules 写了，其余三个光秃秃
  // ⛔ dm 轮改判据：原来按行找 `marketReady()) S.`（单行写法），改成 if/else 块后一行都找不到了。
  //    按【语句块】取：从 marketReady 判定起，到该对象赋值结束为止。
  const emptyPools = SV.match(/if \(marketReady\(\)\)[\s\S]{0,6}S\.\w+ = \{[\s\S]{0,400}?\}/g) || [];
  ok('找得到"清成空结果"的出口', emptyPools.length >= 4, '实得 ' + emptyPools.length);
  const noWhy = emptyPools.filter(l => l.indexOf('empty:') < 0);
  ok('⛔ 每处空结果出口都写了 empty 原因', noWhy.length === 0, noWhy.join(' | ').slice(0, 200));
  // 各 taskSet 成功点也必须带 empty（不许在生产里出现 unknown）
  // ⛔ 按【语句】取，不能按行 —— empty 为了可读性写在下一行，按行抓会漏判
  const stmts = [];
  for (let p = 0; ;) {
    p = SV.indexOf('taskSet(', p);
    if (p < 0) break;
    stmts.push(SV.slice(p, p + 260));
    p += 8;
  }
  const tsOk = stmts.filter(t => t.indexOf('ok: true') >= 0 || t.indexOf('ok: !!') >= 0);
  ok('找得到 taskSet 成功点', tsOk.length >= 6, '实得 ' + tsOk.length);
  const tsNoEmpty = tsOk.filter(l => l.indexOf('empty:') < 0);
  ok('⛔ taskSet 成功点全部带 empty', tsNoEmpty.length === 0, tsNoEmpty.join(' | ').slice(0, 200));
}

// ════════ 【D】PUSH_DONE：返回 true ≠ 送达 ════════
console.log('【D】PUSH_DONE：推送的「成功」必须区分送达与未送达');
{
  ok('sent 与 blocked 返回同一个 true',
    F.PUSH_DONE.sent.ret === true && F.PUSH_DONE.blocked.ret === true);
  ok('⛔ 但两者的说法不同（这正是本轮要修的）',
    F.PUSH_DONE.sent.mark !== F.PUSH_DONE.blocked.mark,
    F.PUSH_DONE.sent.mark + ' vs ' + F.PUSH_DONE.blocked.mark);
  ok('只有夜间静默返回 false', F.PUSH_DONE.silent.ret === false);
  for (const k of Object.keys(F.PUSH_DONE)) {
    ok(k + ' 有 note 说明', typeof F.PUSH_DONE[k].note === 'string' && F.PUSH_DONE[k].note.length > 0);
  }
  ok('blocked 的 note 点明不代表送达', F.PUSH_DONE.blocked.note.indexOf('不代表送达') >= 0);
  // 源码契约：pushAll 的每个「成功」出口都要把真实语义记下来
  const i = SV.indexOf('function pushAll(text, force, opts) {');
  ok('找得到 pushAll', i > 0);
  let depth = 0, j = i;
  for (; j < SV.length; j++) { if (SV[j] === '{') depth++; else if (SV[j] === '}') { depth--; if (!depth) break; } }
  const body = SV.slice(i, j + 1);
  const marks = body.split('_pushLast = {').length - 1;
  ok('⛔ pushAll 里登记了每轮推送的真实结果', marks >= 7, '实得 ' + marks);
  ok('真送达分支标记了 sent: true', body.indexOf('sent: true') >= 0);
  ok('未送达分支标记了 sent: false', body.indexOf('sent: false') >= 0);
  ok('异步分支标记了 sent: null（还没结论）', body.indexOf('sent: null') >= 0);
  const badMark = (body.match(/sent: false, why: ''/g) || []).length;
  ok('⛔ 未送达必须带 why（不能只说没送）', badMark === 0, '实得 ' + badMark);
}

// ════════ 【E】前端真的用上了（不是后端算了没人看） ════════
console.log('【E】前端：面板按等级显示，0 条不打勾');
{
  ok('前端读了 doneRule', HV.indexOf('s.doneRule') >= 0);
  ok('前端读了 pushLast', HV.indexOf('s.pushLast') >= 0);
  ok('前端按 done 分支渲染', HV.indexOf("d === 'empty'") >= 0 && HV.indexOf("d === 'yield'") >= 0);
  ok('前端按等级排序（最该看的最靠前）', HV.indexOf('ORDER') >= 0);
  const i = HV.indexOf('function renderTaskState(s) {');
  ok('找得到 renderTaskState', i > 0);
  let depth = 0, j = i;
  for (; j < HV.length; j++) { if (HV[j] === '{') depth++; else if (HV[j] === '}') { depth--; if (!depth) break; } }
  const fn = HV.slice(i, j + 1);
  // ⛔ 0 条那条分支里不许出现勾
  const e = fn.indexOf("d === 'empty'");
  const seg = fn.slice(e, fn.indexOf("d === 'yield'") > e ? fn.indexOf("d === 'yield'") : fn.length);
  ok('⛔ 0 条分支不打勾', seg.indexOf('✅') < 0);
  ok('0 条分支显示 0 条', seg.indexOf('0 条') >= 0);
  ok('失败分支显示本轮未跑成', fn.indexOf('本轮未跑成') >= 0);
  ok('末次推送显示送达状态', fn.indexOf('末次推送') >= 0);
}

// ════════ 【F】跨模块：下发与面板连通 ════════
console.log('【F】跨模块：/api/state 下发，面板读得到');
{
  ok('state 下发 doneRule', SV.indexOf('doneRule: doneRuleState()') >= 0);
  ok('state 下发 pushLast', SV.indexOf('pushLast: pushLast()') >= 0);
  ok('taskState 带 done 字段', SV.indexOf("done: v.done || ''") >= 0);
  ok('taskState 带 empty 字段', SV.indexOf("empty: v.empty || ''") >= 0);
  ok('taskState 带 mark 字段', SV.indexOf('mark: doneOf(') >= 0);
  // ⛔ pushLast 返回副本（外部改不动内部状态）
  const p1 = F.pushLast(); p1.sent = '被外部改了';
  ok('pushLast 返回副本（改不脏内部）', F.pushLast().sent !== '被外部改了');
  // ⛔ 与 dk 轮的 FAIL_RULE 共用同一张任务表（两半不能各记一份）
  ok('与 dk 轮共用 TASK_RULE（不另起一张表）', Object.keys(F.TASK_RULE).length >= 6);
}

console.log('\n' + (FAIL ? '❌ 失败 ' + FAIL + ' 项' : '✅ 全部通过') + '（共 ' + N + ' 项断言）');
process.exit(FAIL ? 1 : 0);
