// dq 轮守门：同一个数，在不同时间被问是不是同一个数（比对时点的口径）
//   ⓵ 把量存起来下一轮做差 → 必须记下那份快照属于哪一天，跨天不许拿来做差
//   ⓶ 带窗口的差值必须把**实际窗口**一起交出去（名义 10 分钟 ≠ 实际 30 秒）
const fs = require('fs');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')'); }

const src = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

// 从源码切出真实实现（不复制，保证测的是线上那份）
function slice(startMark, endMark) {
  const i = src.indexOf(startMark);
  if (i < 0) throw new Error('找不到起点: ' + startMark);
  const j = src.indexOf(endMark, i);
  if (j < 0) throw new Error('找不到终点: ' + endMark);
  return src.slice(i, j + endMark.length);
}
const fnToday = slice('const todayStr = () => {', '\n};');
const blkPrev = slice('const PREV_SNAP = {', '\n};');
// ⛔ 这两个容器也是实现的一部分，漏注入 = 整个套件崩掉（不是变红）
const i0 = src.indexOf('const _prevSnapDay = {};');
const i1 = src.indexOf('const _prevSnapTs = {};');
if (i0 < 0 || i1 < 0) throw new Error('找不到 _prevSnapDay / _prevSnapTs');
const varsPrev = src.slice(i0, i1 + 'const _prevSnapTs = {};'.length);
const fnUsable = slice('function prevSnapUsable(pool, day) {', '\n}\n');
const fnMark = slice('function prevSnapMark(pool, day) {', '\n}\n');
const fnState = slice('function prevSnapState() {', '\n}\n');
const fnWin = slice('function retainWinTxt(sec) {', '\n}\n');

const body = fnToday + '\n' + blkPrev + '\n' + varsPrev + '\n' + fnUsable + '\n' + fnMark + '\n' + fnState + '\n' + fnWin +
  '\nreturn { todayStr, PREV_SNAP, prevSnapUsable, prevSnapMark, prevSnapState, retainWinTxt };';
const impl = new Function('console', 'Number', 'Date', body)(console, Number, Date);
const { todayStr, PREV_SNAP, prevSnapUsable, prevSnapMark, prevSnapState, retainWinTxt } = impl;

console.log('=== A. 登记表 ===');
ok(!!PREV_SNAP.sectorFlow, 'A1 登记了 sectorFlow');
ok(!!PREV_SNAP.sectorFlow.kind, 'A2 声明了时点口径 kind');
eq(PREV_SNAP.sectorFlow.kind, 'dayCum', 'A3 sectorFlow 是「当日累计」型');
ok(/跨天归零/.test(PREV_SNAP.sectorFlow.why || ''), 'A4 写了为什么（跨天归零）');

console.log('\n=== B. 跨天不许做差（本轮核心） ===');
// 首次：还没建过档
eq(prevSnapUsable('sectorFlow', '20261007'), false, 'B1 首次运行 → 不可做差（基线不存在）');
// 同一天建了档
prevSnapMark('sectorFlow', '20261007');
eq(prevSnapUsable('sectorFlow', '20261007'), true, 'B2 同一天 → 可做差');
// ⛔ 跨天：基线仍是昨天的
eq(prevSnapUsable('sectorFlow', '20261008'), false, 'B3 ⛔ 跨天 → 不可做差（昨天累计 vs 今天累计，两个周期）');
// 新的一天建档后恢复
prevSnapMark('sectorFlow', '20261008');
eq(prevSnapUsable('sectorFlow', '20261008'), true, 'B4 新一天建档后 → 可做差');
eq(prevSnapUsable('sectorFlow', '20261007'), false, 'B5 反过来拿旧日期问 → 也不可');

console.log('\n=== C. 未登记的池要报警，不许静默放行 ===');
const _err = console.error; let errMsg = '';
console.error = (m) => { errMsg += m; };
const unk = prevSnapUsable('notAPool', '20261007');
console.error = _err;
eq(unk, false, 'C1 未登记池 → 不可做差（不许默认放行）');
ok(/未登记的快照池/.test(errMsg), 'C2 未登记池要 console.error 报警');
const _err2 = console.error; let errMsg2 = '';
console.error = (m) => { errMsg2 += m; };
prevSnapMark('notAPool', '20261007');
console.error = _err2;
ok(/未登记的快照池/.test(errMsg2), 'C3 建档时未登记也要报警');

console.log('\n=== D. 面板可观测：基线是哪天建的，要看得见 ===');
prevSnapMark('sectorFlow', todayStr());
const st = prevSnapState();
ok(!!st.sectorFlow, 'D1 state 里有 sectorFlow');
eq(st.sectorFlow.day, todayStr(), 'D2 记录了基线所属日期');
eq(st.sectorFlow.usable, true, 'D3 今天建的 → usable=true');
ok(typeof st.sectorFlow.ts === 'number' && st.sectorFlow.ts > 0, 'D4 记录了墙上时间');
ok(!!st.sectorFlow.label, 'D5 有中文名');
// 模拟昨天建的档：usable 必须是 false（这就是「只在日志里说」的反面）
const stOld = (() => {
  prevSnapMark('sectorFlow', '19990101');
  return prevSnapState();
})();
eq(stOld.sectorFlow.usable, false, 'D6 ⛔ 基线是旧日期 → usable=false（面板能看出没在做差）');
eq(stOld.sectorFlow.day, '19990101', 'D7 旧日期照样如实报出来，不伪装成今天');

console.log('\n=== E. 反证：跨天做差会算出什么 ===');
// 昨天净流出 -2 亿，今天开盘才流入 1000 万 —— 拿两个周期做差
const prevDayClose = -2e8;   // 昨天收盘的当日累计
const todayNow = 1e7;        // 今天此刻的当日累计（真实只流入 1000 万）
const dCross = todayNow - prevDayClose;
ok(dCross >= 3e7, 'E1 反证：跨天做差得 ' + (dCross / 1e8).toFixed(2) + ' 亿 ≥ 3000 万门槛 → 会误报突增');
ok(todayNow < 3e7, 'E2 但今天真实流入只有 1000 万，根本没到门槛');
ok(dCross > todayNow * 5, 'E3 误报值是真实值的 ' + (dCross / todayNow).toFixed(1) + ' 倍');

console.log('\n=== F. 实际窗口随值返回（资金留存） ===');
eq(retainWinTxt(0), '', 'F1 0 秒 → 不标');
eq(retainWinTxt(null), '', 'F2 null → 不标');
eq(retainWinTxt(NaN), '', 'F3 NaN → 不标');
eq(retainWinTxt('abc'), '', 'F4 非数字 → 不标');
eq(retainWinTxt(30), '30秒', 'F5 30 秒 → 「30秒」');
eq(retainWinTxt(59), '59秒', 'F6 59 秒仍按秒标');
eq(retainWinTxt(60), '1分钟', 'F7 60 秒 → 「1分钟」');
eq(retainWinTxt(600), '10分钟', 'F8 600 秒 → 「10分钟」（满窗）');
eq(retainWinTxt(95), '2分钟', 'F9 95 秒 → 四舍五入「2分钟」');
// 同样的差值，窗口不同 = 完全不同的强度
ok(retainWinTxt(30) !== retainWinTxt(600), 'F10 ⛔ 30 秒与 10 分钟必须标出不同的窗口（同一个数不同强度）');

console.log('\n=== G. 源码断言 ===');
const stripC = (l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; };
const code = src.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);
const hcode = html.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);

ok(code.some(l => /const canDiff = prevSnapUsable\('sectorFlow'/.test(l)),
  'G1 板块突增做差前先问 prevSnapUsable');
ok(code.some(l => /prevSnapMark\('sectorFlow'/.test(l)),
  'G2 板块突增建档时记下时点');
// ⛔ 2026-10-27：canDiff 判据后来收进 pickNotableSectors(sec, prevFlow, canDiff, …) 的入参，
//    写成 `if (canDiff && prev != null && …)` —— 语义等价（canDiff=false 时一条 surge 都不产生），
//    旧断言只认 `if (canDiff) {` 这种块写法 → 假红。两种形态都认。
ok(code.some(l => /if \(canDiff\) \{/.test(l) || /if \(canDiff &&/.test(l)),
  'G3 ⛔ canDiff 为 false 时整段跳过（不是只跳过判空）');
// 不能只靠 prev != null（那只挡首次，挡不住跨天）
ok(code.some(l => /prev != null/.test(l)), 'G4 仍保留 prev != null 判空');
ok(code.some(l => /prevSnap: prevSnapState\(\)/.test(l)), 'G5 /api/state 下发 prevSnap');
ok(code.some(l => /retainWin = t1 > t0/.test(l)), 'G6 retain 随值返回实际窗口');
ok(code.some(l => /retainTxt/.test(l) && /return \{ \.\.\.c, retain/.test(l)),
  'G7 retainTxt 整句随值下发');
ok(hcode.some(l => /x\.retainTxt/.test(l)), 'G8 前端改读后端整句（不再只用裸数字）');

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_prevsnap: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
