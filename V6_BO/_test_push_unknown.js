'use strict';
// 守门：推送回执「结果未知」不等于「确认没送到」—— 重复推送真正的根因
// ──────────────────────────────────────────────────────────────────────────
// 事故（2026-10-09 fz 轮，用户原话「飞书你又重复推送」；10-08 已投诉过「复盘推了六遍」）：
//   超时 / 断连 **不等于** 没送到。请求已经出了网，飞书很可能已投递，只是回执没回来。
//   旧逻辑一律当成确认失败 → _release() 把「额度/冷却/**去重**」占位全部撤销
//   → 下一轮定时器问「今天发过没」→ 去重已撤销、流水里也没有 ✅ 送达记录 → 判定"还没发"
//   → 照原样再推一遍 → 用户收到两条一模一样的。
//   且这条会自我放大：网络越差 → 超时越多 → 撤销越频繁 → 重复越严重。
//   前几轮修的都是「重启重放」（内存闭锁清零靠落盘流水兜），**从没人动这条**。
// 修法：sendResultUnknown() 区分两者。超时/断连 = 未知 → 不撤销去重、不重推、不退回群；
//       飞书明确返回错误码 = 确认没送到 → 照旧撤销，下一轮补推。
// 钉的语义（改写法不算回归，把"未知当失败"这条放回去才算）：
//   ① 超时/断连/看门狗兜底 → unknown=true；明确错误码(9499/业务码) → unknown=false
//   ② pushAll 主通道：unknown 分支**不许**调 _release（否则就是重复的那一下）
//   ③ pushAll 主通道：确认失败分支**仍要**调 _release（不能把补推能力一起删了）
//   ④ 私密通道：unknown 时不许退回群机器人（既重复、又把"仅本人可见"广播出去）
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = SRC.split('\n').filter(l => !/^\s*\/\//.test(l) && !l.startsWith('const APP_VER = ')).join('\n');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
// ⛔ 括号配平取函数体/块，不许固定行号窗口
function block(startRe, fromIdx) {
  const i = SV.search(startRe) >= 0 ? SV.indexOf(SV.match(startRe)[0], fromIdx || 0) : -1;
  if (i < 0) return '';
  let d = 0, j = SV.indexOf('{', i);
  if (j < 0) return '';
  for (let k = j; k < SV.length; k++) {
    if (SV[k] === '{') d++;
    else if (SV[k] === '}') { d--; if (d === 0) return SV.slice(i, k + 1); }
  }
  return '';
}
// 从任意起点括号配平取块体（钉"这一支里有没有做某件事"，不许用固定字符窗口跨过 return）
function bodyAt(s, i) {
  if (i < 0) return '';
  let d = 0, j = s.indexOf('{', i);
  if (j < 0) return '';
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return s.slice(i, k + 1); }
  }
  return '';
}

group('[1] sendResultUnknown：真跑各种回执');
const UN = block(/function sendResultUnknown\(info\) \{/);
ok('sendResultUnknown 抠得出来', UN.length > 60, String(UN.length));
let u;
try { u = new Function(UN + '\nreturn sendResultUnknown;')(); } catch (e) { console.log('  ⚠️ 注入失败: ' + e.message); }
ok('注入成功（漏符号=套件崩，不等于红）', typeof u === 'function');
if (typeof u === 'function') {
  ok('飞书请求超时 → 未知（不能当没送到）', u('请求超时（15s 无响应）') === true);
  ok('队列看门狗兜底超时 → 未知', u('发送超时（25000ms 未回调）') === true);
  ok('ETIMEDOUT / socket hang up / ECONNRESET → 未知',
    u('ETIMEDOUT') === true && u('socket hang up') === true && u('ECONNRESET') === true);
  ok('DNS 解析失败 ENOTFOUND / EAI_AGAIN → 未知', u('ENOTFOUND') === true && u('EAI_AGAIN') === true);
  ok('网络异常（无码）→ 未知', u('网络异常: connect fail') === true);
  ok('⛔ 限频 code=9499 → 确认没送到（这个可以补推）', u('code=9499 too many request') === false);
  ok('⛔ 业务错误码 → 确认没送到', u('code=19001 bad request') === false);
  ok('⛔ 地址无效/机器人失效 → 确认没送到', u('机器人地址无效（缺少 /open-apis/bot/v2/hook/ 部分）') === false);
  ok('空信息按确认失败处理（不拿"不知道"当"未知"滥用）', u('') === false && u(undefined) === false);
}

group('[2] pushAll：未知不许撤销去重，确认失败仍要撤销');
const PA = block(/function pushAll\(text, force, opts\) \{/);
ok('pushAll 抠得出来', PA.length > 2000, String(PA.length));
const iUnk = PA.indexOf('if (_unknown) {');
ok('结算里有 _unknown 分支（不然等于没修）', iUnk > 0);
if (iUnk > 0) {
  // 取 _unknown 块本体（从 if (_unknown) { 起括号配平）
  let d = 0, end = -1, s = PA.indexOf('{', iUnk);
  for (let k = s; k < PA.length; k++) {
    if (PA[k] === '{') d++;
    else if (PA[k] === '}') { d--; if (d === 0) { end = k; break; } }
  }
  const unkBody = PA.slice(iUnk, end + 1);
  ok('⛔ 未知分支**不调** _release（这一下就是重复推送的源头）', !/_release\(/.test(unkBody), unkBody.slice(0, 160).replace(/\s+/g, ' '));
  ok('未知分支直接 return（不落到下面的确认失败逻辑）', /return;/.test(unkBody));
  ok('未知分支写了「送达结果未知」流水（用户能自查为什么没收到）', /送达结果未知/.test(unkBody));
  ok('未知分支把 _pushLast 定格为 sent:false（⛔ 不许谎报送达）', /sent:\s*false/.test(unkBody));
}
ok('⛔ 确认失败分支仍然 _release（别把补推能力一起删了）', /_release\(_mailOn \?/.test(PA));
ok('结算前先判 unknown（顺序反了就没用）', PA.indexOf('const _unknown') < PA.indexOf('_release(_mailOn'));
// 没回执原文就分不清「被拒绝」和「没回音」，而这两者处置正好相反 —— 必须把原文带出来
ok('飞书回执原文被记下来（_fsInfo）', /_fsInfo = String\(info \|\| ''\)/.test(PA));
ok('邮箱异常原文被记下来（_mailInfo）', /_mailInfo = String\(\(e && e\.message\) \|\| e\)/.test(PA));
// ⛔ 只钉「通道结算」这一处：私密分支那两处 _release 是"私密失败+群机器人也失败"，属确认失败，正当
const settleBody = bodyAt(PA, PA.indexOf('const _settle = () => {'));
ok('通道结算块抠得出来', settleBody.length > 200, String(settleBody.length));
ok('⛔ 通道结算里只有 1 处 _release，且只在确认失败那一行（撤销去重=重复推送唯一起因）',
  (settleBody.match(/_release\(/g) || []).length === 1, String((settleBody.match(/_release\(/g) || []).length));

group('[3] 私密通道：结果未知不许退回群机器人');
const iPriv = PA.indexOf('if (opts && opts.private && privReady())');
ok('私密分支在', iPriv > 0);
const privBody = PA.slice(iPriv, iPriv + 2600);
ok('私密分支判了 sendResultUnknown', /sendResultUnknown\(r && r\.msg\)/.test(privBody));
ok('⛔ 私密未知时 return，不再 feishuSend（否则同一条来两遍 + 私密内容广播到群）',
  /sendResultUnknown\(r && r\.msg\)\)\s*\{[\s\S]{0,900}?return;/.test(privBody));
ok('私密未知分支写了「未退回群」的说明', /未退回群|不再改发群机器人/.test(privBody));
// ⛔ 括号配平取 catch 块，不许正则硬撸（源码是 .catch(e => { 无空格，写死 `catch \(e` 会假红）
const privAll = PA.slice(iPriv);
const iCatch = privAll.indexOf('.catch(e => {');
const catchBody = (() => {
  if (iCatch < 0) return '';
  let d = 0, s = privAll.indexOf('{', iCatch);
  for (let k = s; k < privAll.length; k++) {
    if (privAll[k] === '{') d++;
    else if (privAll[k] === '}') { d--; if (d === 0) return privAll.slice(iCatch, k + 1); }
  }
  return '';
})();
ok('私密 catch 块抠得出来', catchBody.length > 40, String(catchBody.length));
ok('catch 分支同样区分未知（超时不是代码错误，别一律退回）',
  /sendResultUnknown\(e && e\.message\)/.test(catchBody) && /return;/.test(catchBody),
  catchBody.slice(0, 140).replace(/\s+/g, ' '));
const catchUnkBody = bodyAt(catchBody, catchBody.indexOf('if (sendResultUnknown(e && e.message)) {'));
ok('⛔ catch 未知分支**没有**退回群机器人（异常里也有超时，退回=重复）',
  catchUnkBody.length > 40 && !/feishuSend\(/.test(catchUnkBody), catchUnkBody.slice(0, 120).replace(/\s+/g, ' '));
ok('catch 非未知路径仍可退回群（别把兜底能力一起删了）', /feishuSend\(text/.test(catchBody));

group('[4] pushedToday：「结果未知」也算今天已外发（跨进程那半边）');
// 上面的 [2][3] 只保住**本进程**（内存闭锁还在）。线上多 worker / 冷启动 / 回退发布包是常态，
// 内存闭锁随进程清零，启动后靠 sentLockFromPushLog 查落盘流水 —— 流水不认账就重推。
const PT = block(/function pushedToday\(titleRe\) \{/);
ok('pushedToday 抠得出来', PT.length > 300, String(PT.length));
const _dstr = ts => { const d = new Date(ts || Date.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const LOG = [];
let pt = null;
try {
  pt = new Function('PUSH_LOG', 'dayKeyOf', 'todayStr', 'dataCapOf', 'pushLogCoversToday', 'console',
    // hw 轮：「已外发过」判据收口到 pushIsOutStatus，沙箱必须把它的源码一起编译进去
    'let _pushLogCapWarnDate = "";\n' + block(/function pushIsOutStatus\(st\) \{/) + '\n' + PT + '\nreturn pushedToday;')(
    LOG, _dstr, _dstr, () => 500, () => true, { warn() {}, error() {}, log() {} });
} catch (e) { console.log('  ⚠️ 注入失败: ' + e.message); }
ok('注入成功（漏符号=套件崩，不等于红）', typeof pt === 'function');
if (typeof pt === 'function') {
  const withLog = rows => { LOG.length = 0; rows.forEach(r => LOG.push(Object.assign({ ts: Date.now() }, r))); return pt(/每日复盘/); };
  ok('✅ 已送达 → 今天已发（基线没被改坏）', withLog([{ status: '✅ 已送达', title: '每日复盘 xxx' }]) === true);
  ok('⛔⚠️ 送达结果未知 → 也算今天已发（否则重启/换 worker 就重推一条一模一样的）',
    withLog([{ status: '⚠️ 送达结果未知', title: '每日复盘 xxx' }]) === true);
  ok('私密通道结果未知同样算（私密更不该重复）',
    withLog([{ status: '⚠️ 送达结果未知(私密)', title: '每日复盘 xxx' }]) === true);
  ok('⛔ ❌ 发送失败 → 不算（真没送到，必须留给补推）',
    withLog([{ status: '❌ 发送失败', title: '每日复盘 xxx' }]) === false);
  ok('⛔ 未配置通道 / 条数闸门 / 夜间静默 → 不算（根本没外发过）',
    withLog([{ status: '⚠️ 未配置通道', title: '每日复盘 a' }]) === false &&
    withLog([{ status: '🚫 条数闸门', title: '每日复盘 b' }]) === false &&
    withLog([{ status: '夜间静默拦截', title: '每日复盘 c' }]) === false);
  ok('⛔ ✅ 但明写"未发送"（dry 试算）→ 不算（旧漏洞：试算被当送达证据，真复盘永不补推）',
    withLog([{ status: '✅ 计算完成(dry 未发送)', title: '每日复盘 xxx' }]) === false);
  ok('⛔ 标题不匹配 → 不算（别一条复盘把别的模块全闭锁）',
    withLog([{ status: '✅ 已送达', title: '盘中推送 xxx' }]) === false);
  ok('空流水 → 不算（今天确实没发过）', withLog([]) === false);
}

group('[5] sentToday：今天零流水 = 证据丢失，按已发处理（发布即新容器那半边）');
// 线上取证（2026-10-09）：发布后 /api/push-log 只剩发布之后新写的 6 条，18:43:57 起 71ms 内
// 连发「涨停复盘 / 一进二 / 连板接力」，接着源码包 / 每日复盘 / 学习日报 —— 容器一换就把当天日报全重发。
const HAT = block(/function pushLogHasAnyToday\(\) \{/);
// ⛔ gk 轮：签名多了第 4 个可选参数 dueMin —— 断言钉语义（函数抠得出来）不钉字符串
const ST = block(/function sentToday\(memLock, ds, titleRe(?:,\s*dueMin)?\)\s*\{/);
ok('pushLogHasAnyToday 抠得出来', HAT.length > 100, String(HAT.length));
ok('sentToday 抠得出来', ST.length > 200, String(ST.length));
// ⛔ 源码写的是表达式 `30 * 60 * 1000`，只抠数字会拿到 30（差 6 万倍）→ 整段判据全假红
const GRACE_EXPR = (SV.match(/const BOOT_EVIDENCE_MS = ([^;]+);/) || [])[1] || '';
const GRACE = GRACE_EXPR ? Function('return (' + GRACE_EXPR + ')')() : 0;
ok('启动宽限窗常量抠得出来（30 分钟）', GRACE === 30 * 60 * 1000, String(GRACE));
const LOG2 = [];
let warnN = 0;
// bootAgoMs：容器已运行多久 —— 「零流水=证据丢了」只在刚启动那一阵成立
// bootHad = 启动时流水里有没有今天的记录（⛔ 必须是**启动那一刻**的快照，不是判定时再看）
const mkST = (bootAgoMs, bootHad) => new Function('PUSH_LOG', 'dayKeyOf', 'todayStr', 'dataCapOf', 'pushLogCoversToday', 'console',
  'let _pushLogCapWarnDate = ""; let _bootNoEvidenceWarn = "";\n' +
  'const _bootAt = ' + (Date.now() - bootAgoMs) + ';\nconst BOOT_EVIDENCE_MS = ' + GRACE + ';\n' +
  // ⛔⛔ gk 轮：sentToday 多了 _bootMin / LATE_BOOT_GRACE_MIN 两个依赖（晚起步放行），
  //    沙箱里少注入一个就是 ReferenceError（套件崩，不是红）。_bootMin 设 -1 =
  //    「起步时刻不可知」，放行分支不成立 → 本组所有断言语义与改动前完全一致。
  'const _bootMin = -1;\nconst LATE_BOOT_GRACE_MIN = 120;\n' +
  'const _bootHadTodayLog = ' + (bootHad !== false) + ';\n' +
  block(/function pushIsOutStatus\(st\) \{/) + '\n' + PT + '\n' + HAT + '\n' + ST +   // hw 轮：pushedToday 依赖 pushIsOutStatus
  '\nreturn { sentToday: sentToday, pushLogHasAnyToday: pushLogHasAnyToday };')(
  LOG2, _dstr, _dstr, () => 500, () => true,
  { warn() { warnN++; }, error() {}, log() {} });
let stFresh = null, stOld = null, stHadLog = null;
try {
  stFresh = mkST(60 * 1000, false);            // 刚启动 + 启动时零流水
  stOld = mkST(40 * 60 * 1000, false);         // 跑满 40 分钟 + 启动时零流水
  stHadLog = mkST(60 * 1000, true);            // 刚启动但启动时就有今天的流水
} catch (e) { console.log('  ⚠️ 注入失败: ' + e.message); }
ok('注入成功（漏符号=套件崩，不等于红）', typeof (stFresh && stFresh.sentToday) === 'function');
if (stFresh && stOld && stHadLog) {
  const ds = _dstr();
  const set2 = rows => { LOG2.length = 0; rows.forEach(r => LOG2.push(Object.assign({ ts: Date.now() }, r))); };
  set2([]);
  ok('⛔ 刚启动(1分钟) + 启动时零流水 → 按已发处理（容器换了证据丢了，别把当天日报再全发一遍）',
    stFresh.sentToday('', ds, /每日复盘/) === true);
  // ⛔⛔ 2026-10-09 实测事故：19:22:46 涨停复盘发出去后流水就非空了，
  //    若兜底判"当前流水是否为空"，第一条之后兜底当场失效 → 剩下 4 条照发。必须看启动那一刻的快照。
  set2([{ status: '✅ 已送达', title: '涨停复盘 · 好标的挖掘（刚被自己发出去的）' }]);
  ok('⛔⛔ 启动后自己发出的流水**不算**证据（否则第一条发出去兜底就失效，后面几条照发）',
    stFresh.sentToday('', ds, /一进二/) === true);
  ok('⛔ 启动时就有今天的流水 → 不启用兜底，照 pushedToday 判（证据齐全就按证据来）',
    stHadLog.sentToday('', ds, /一进二/) === false);
  ok('零流水时留痕告警（静默吞掉=无从自查）', warnN === 1, String(warnN));
  ok('⛔ 同一天只告警一次（每轮刷一条会把日志淹了）',
    (stFresh.sentToday('', ds, /每日复盘/), warnN === 1), String(warnN));
  // ⛔ 关键反误伤：14:00 发布、15:30 该发复盘时容器已跑 90 分钟 —— 那不是"发过了"，是"今天还没推"
  set2([]);
  ok('⛔⛔ 已运行 40 分钟 + 零流水 → **不**兜底（否则 14:00 发布会把 15:30 那份复盘一起吞掉）',
    stOld.sentToday('', ds, /每日复盘/) === false);
  set2([{ status: '✅ 已送达', title: '每日复盘 x' }]);
  ok('已运行 40 分钟但有本模块送达 → 已发（基线没被改坏）', stOld.sentToday('', ds, /每日复盘/) === true);
  set2([{ status: '❌ 发送失败', title: '盘中推送 x' }]);
  // ⛔ 判据看的是「启动那一刻有没有今天的流水」，不是当前流水 —— 所以这条要用 stHadLog 验
  ok('⛔ 启动时就有今天的流水、但本模块没送达 → 判未发（真失败该补推还得补推）',
    stHadLog.sentToday('', ds, /每日复盘/) === false);
  set2([]);
  ok('⛔ 内存闭锁命中优先（本进程内已发，零流水也不影响）', stFresh.sentToday(ds, ds, /每日复盘/) === true);
  set2([]);
  ok('⛔ 没给 titleRe 不启用兜底（不知道是谁，不许一律判已发）', stFresh.sentToday('', ds, null) === false);
}

console.log('\n──── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ────');
process.exit(fail ? 1 : 0);
