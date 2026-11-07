// hi 轮守门：pushlog 启动载入不许再踩 TDZ（gb 轮 10-09 引入、潜伏 5 天的静默故障）。
//
// 故障形态：server.js 顶层 try 块（模块初始化期执行）里调用 dataCapOf('pushLog')，
// 而 dataCapOf 函数体读的 DATA_CAP 是文件后面（L8506）的 const —— 调用即
// ReferenceError(Cannot access 'DATA_CAP' before initialization)，被空 catch {} 吞掉：
//   · PUSH_LOG 每次启动都是空数组 → 磁盘「500 条跨重启可追溯」名存实亡；
//   · 面板 /api/push-log 只剩本次进程新写的几条，历史证据看不见；
//   · tier-2 pushedToday（sentToday 的②落盘判据）重启后恒 false → 防重复只剩
//     内存闭锁 + ③ 起步时刻启发式（「重复推送」投诉的根因土壤）；
//   · 下一次 flush 用「仅本次进程的新记录」整体覆盖磁盘 → 旧证据被静默销毁。
// 修法：载入阶段不调 dataCapOf（全量进内存，容量由运行时 pushLogFlush/入队处裁），
//       空 catch 改记错误日志（saveXxx 不得空 catch 的同源纪律）。
//
// 判据全部「钉语义不钉字符串」：载入块从源码原样切出来在沙箱里真跑；
// 旧写法在同样沙箱下必须静默丢光（反证）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const IH = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });   // 剥注释留字符串：抽取与结构断言都用它

let pass = 0, fail = 0;
// ⛔ 本文件断言签名是 (cond, name, detail) —— 与其它守门的 (name, cond) 相反，
//    所以加类型闸：条件不是布尔值直接炸，防止参数顺序写反时「真值字符串」静默通过。
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') throw new Error('守门断言条件必须是布尔值（参数顺序写反了？）: ' + name);
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + '  ──'); }

// ── 从源码原样切出「顶层载入块」：从 readJsonSafe 锚点回退到行首 try {，到 catch 行为止 ──
const iAnchor = SVK.indexOf('const _loaded = readJsonSafe(PUSH_LOG_FILE');
if (iAnchor < 0) throw new Error('未找到 pushlog 载入块锚点（readJsonSafe(PUSH_LOG_FILE）');
const iTry = SVK.lastIndexOf('\ntry {', iAnchor);
const iCatch = SVK.indexOf("} catch (e) { console.error('[pushlog]", iAnchor);
if (iTry < 0 || iCatch < 0) throw new Error('载入块边界不完整（try / catch 行缺失）');
const iCatchEnd = SVK.indexOf('\n', iCatch);
const LOAD = SVK.slice(iTry + 1, iCatchEnd);          // 剥注释版：含 try { … } catch (e) { … }
if (!/try \{[\s\S]*readJsonSafe\(PUSH_LOG_FILE[\s\S]*catch \(e\)/.test(LOAD)) {
  throw new Error('载入块剥注释后结构不完整（状态机自保护断言）');
}

// ── 花括号配平取函数体（与其它守门同源；在剥注释版上数括号，注释里的括号不算） ──
function bodyAt(src, idx) {
  const b = src.indexOf('{', idx);
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return '';
}
const iFlush = SVK.indexOf('function pushLogFlush() {');
const iPT = SVK.indexOf('function pushedToday(titleRe) {');
if (iFlush < 0 || iPT < 0) throw new Error('未找到 pushLogFlush / pushedToday');
const FLUSH_BODY = bodyAt(SVK, iFlush);
const PT_BODY = bodyAt(SVK, iPT);
// hw 轮：pushedToday 现在调用 pushIsOutStatus；沙箱里没有它 → ReferenceError 被 catch 吞成「没记录」
const _iPis = SVK.indexOf('function pushIsOutStatus(st)');
const PIS_SRC = _iPis < 0 ? '' : 'function pushIsOutStatus(st) ' + bodyAt(SVK, _iPis);
if (!PIS_SRC) throw new Error('未找到 pushIsOutStatus（沙箱会静默失效，必须显式炸出来）');
if (!/atomicWrite\(PUSH_LOG_FILE/.test(FLUSH_BODY)) throw new Error('pushLogFlush 函数体抽取异常（自保护断言）');
// hw 轮：「已外发过」的判据收口到 pushIsOutStatus（与 pushLog 同一把尺子），旧的局部 _isOut 已删除
if (!/titleRe\.test/.test(PT_BODY) || !/pushIsOutStatus\(/.test(PT_BODY)) throw new Error('pushedToday 函数体抽取异常（自保护断言）');

group('[1] 源码结构：载入阶段不碰 dataCapOf，运行时仍裁');
ok(!/dataCapOf/.test(LOAD), '顶层载入块不再调用 dataCapOf（TDZ 根源清除）');
ok(/dataCapOf\('pushLog'\)/.test(FLUSH_BODY), 'pushLogFlush 仍按 dataCapOf 裁容量（同一容量一个口径，只在运行时裁）');
ok(/mirrorDurable\(\)/.test(FLUSH_BODY), 'pushLogFlush 仍同步镜像到本地 durable/（④ 耐久化接线未掉）');
ok(/function dayKeyOf\(/.test(SV), 'dayKeyOf 仍是函数声明（启动期幂等检查 Hoist 可用，不踩 Cannot access before initialization TDZ）');
ok(!/catch\s*\{\s*\}/.test(LOAD), '载入块 catch 不再是空 catch（失败要留声）');
ok(/console\.error/.test(LOAD), '载入失败会记错误日志（面板流水与 tier-2 降级看得见）');

group('[2] 沙箱真跑：修好的载入块在「dataCapOf 一调就炸」的环境下照样载满');
{
  const PUSH_LOG = [];
  const fakeDisk = [
    { ts: 1791912054246, status: '✅ 已送达(私密)', title: '═══ 📦 源码包 ═══', time: '', channel: '' },
    { ts: 1791915641446, status: '✅ 已送达(私密)', title: '═══ 📦 源码包 ═══', time: '', channel: '' },
    { ts: 1791800000000, status: '❌ 发送失败', title: '═══ 📋 每日复盘 ═══', time: '', channel: '' },
  ];
  const logs = [];
  let threw = null, n = -1;
  try {
    const mk = new Function('PUSH_LOG', 'readJsonSafe', 'console', 'PUSH_LOG_FILE', 'dataCapOf',
      LOAD + '\nreturn PUSH_LOG.length;');
    n = mk(
      PUSH_LOG,
      () => fakeDisk,
      { log: s => logs.push(String(s)), error: s => logs.push('ERR:' + String(s)) },
      '/tmp/pushlog.json',
      () => { throw new Error('载入阶段不许调用 dataCapOf（DATA_CAP 尚未初始化）'); }
    );
  } catch (e) { threw = e; }
  ok(threw === null, '载入过程不抛错（不被 catch 吞掉也不往上崩）', threw && threw.message);
  ok(n === 3, '磁盘 3 条流水全部载入内存（不再因 TDZ 静默丢成 0 条）', '实际 ' + n);
  ok(logs.some(l => l.indexOf('已载入历史推送流水 3') >= 0), '载入成功有日志行（历史可追溯的可见证据）',
    logs.join(' | '));
  ok(PUSH_LOG.length === 3, 'PUSH_LOG 被原地填满（同一数组引用，供 pushedToday 判据用）');
}

group('[3] 反证：旧写法（顶层 slice(0, dataCapOf(...))）在同样环境下静默丢光');
{
  const OLD_CORE = "try {\n  const _loaded = readJsonSafe(PUSH_LOG_FILE, 'x');\n"
    + "  if (Array.isArray(_loaded)) PUSH_LOG.push(..._loaded.slice(0, dataCapOf('pushLog')));\n"
    + "  console.log('[pushlog] loaded ' + PUSH_LOG.length);\n} catch";
  // ③a 把空 catch 换成抛出：证明 TDZ 错误真实存在（不是假想）
  const mkThrow = new Function('PUSH_LOG', 'readJsonSafe', 'console', 'PUSH_LOG_FILE',
    'function dataCapOf(k) { return DATA_CAP[k]; }\n' + OLD_CORE + ' (e) { throw e; }\n'
    + 'const DATA_CAP = { pushLog: 500 };\nreturn PUSH_LOG.length;');
  let caught = null;
  try { mkThrow([], () => [{ ts: 1 }], { log() {}, error() {} }, 'x'); } catch (e) { caught = e; }
  ok(caught !== null && /DATA_CAP/.test(String(caught && caught.message)),
    '旧写法 + 抛出 catch → ReferenceError(DATA_CAP)：TDZ 确实存在，判据不是假想',
    caught && caught.message);
  // ③b 旧写法原样（空 catch）：不崩、不报错、一条都进不了内存 —— 静默故障复现
  const logs = [];
  const mkSilent = new Function('PUSH_LOG', 'readJsonSafe', 'console', 'PUSH_LOG_FILE',
    'function dataCapOf(k) { return DATA_CAP[k]; }\n' + OLD_CORE + ' {}\n'
    + 'const DATA_CAP = { pushLog: 500 };\nreturn PUSH_LOG.length;');
  let threw2 = null, n2 = -1;
  try {
    n2 = mkSilent([], () => [{ ts: 1, status: '✅', title: 't' }],
      { log: s => logs.push(String(s)), error() {} }, 'x');
  } catch (e) { threw2 = e; }
  ok(threw2 === null && n2 === 0, '旧写法原样：不抛错但流水静默丢光（PUSH_LOG=0）—— 正是潜伏 5 天的形态',
    'threw=' + (threw2 && threw2.message) + ' n=' + n2);
  ok(!logs.some(l => l.indexOf('loaded 1') >= 0), '旧写法连「loaded」日志都不会打（坏得悄无声息）',
    logs.join(' | '));
}

group('[4] 容量仍由运行时收敛：flush 按 cap 裁，不是载入时裁');
{
  const PUSH_LOG = [];
  for (let i = 0; i < 5; i++) PUSH_LOG.push({ ts: 1000 + i, status: '✅ x', title: 't' + i });
  let written = null;
  // 函数声明先 hoist、DATA_CAP 初始化后再调用 —— 复刻「运行时调用无 TDZ」
  const mk = new Function('PUSH_LOG', 'PUSH_LOG_FILE', 'atomicWrite', 'mirrorDurable',
    'function dataCapOf(k) { return DATA_CAP[k]; }\nfunction pushLogFlush() ' + FLUSH_BODY
    + '\nconst DATA_CAP = { pushLog: 2 };\npushLogFlush();');
  mk(PUSH_LOG, 'x', (_f, txt) => { written = txt; }, () => {});
  let arr = null;
  try { arr = JSON.parse(written); } catch (e) {}
  ok(Array.isArray(arr) && arr.length === 2, '灌 5 条、cap=2 → 落盘 2 条（运行时裁，不依赖载入期）',
    written && ('len=' + written.length));
}

group('[5] tier-2 判据恢复：pushedToday 灌今日流水真跑');
{
  const todayStr = () => '20261014';
  const dayKeyOf = () => '20261014';
  const covers = () => true;
  const runPT = (log, re) => {
    const mk = new Function('PUSH_LOG', 'todayStr', 'dayKeyOf', 'pushLogCoversToday', 'dataCapOf',
      'console', '_pushLogCapWarnDate',
      // hw 轮：「已外发过」判据收口到 pushIsOutStatus，沙箱必须把它的源码一起编译进去
      PIS_SRC + '\nfunction pushedToday(titleRe) ' + PT_BODY + '\nreturn pushedToday;');
    return mk(log, todayStr, dayKeyOf, covers, () => 500, { log() {}, error() {}, warn() {} }, '')(re);
  };
  const rec = (ts, status, title) => ({ ts, status, title, time: '' });
  const NOW = new Date(2026, 9, 14, 9, 25, 0).getTime();
  ok(runPT([rec(NOW, '✅ 已送达', '═══ 📋 每日复盘 · 涨停形态与归因 ═══')], /每日复盘/) === true,
    '今日 ✅ 流水 → 判「今天已发」（重启后 tier-2 恢复生效）');
  ok(runPT([rec(NOW, '⚠️ 送达结果未知', '═══ 📋 每日复盘 ═══')], /每日复盘/) === true,
    '「送达结果未知」也算已外发（fz 轮口径不变）');
  ok(runPT([], /每日复盘/) === false, '空流水 → 判「没发过」（不漏挡真没发的）');
  ok(runPT([rec(NOW, '❌ 发送失败', '═══ 📋 每日复盘 ═══')], /每日复盘/) === false,
    '❌ 失败流水不算送达（该补推的还能补）');
  ok(runPT([rec(NOW, '✅ 计算完成(dry 未发送)', '═══ 📋 每日复盘 ═══')], /每日复盘/) === false,
    '「未发送」的 ✅ 不算送达（防试算冒领）');
}

group('[6] 工程纪律');
ok(!/\r/.test(SV), 'server.js 保持 LF（无 CRLF）');
ok(!/\r/.test(IH), 'public/index.html 保持 LF（无 CRLF）');
const vS = (SV.match(/APP_VER = '([^']+)'/) || [])[1];
const vH = (IH.match(/APP_VER = '([^']+)'/) || [])[1];
ok(/^\d{8}[a-z]{2}$/.test(vS || ''), 'server.js 版本号格式正常', vS);
ok(vS === vH, '两端 APP_VER 一致（否则前端无限刷新）', vS + ' vs ' + vH);

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
console.log(fail === 0 ? '✅ 全部通过' : '❌ 有失败项');
process.exit(fail > 0 ? 1 : 0);
