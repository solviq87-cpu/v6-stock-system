/**
 * 守门测试：复盘空池保护（2026-10-27）—— 空池不许错误覆盖旧复盘、不许谎报"今日无涨停"
 *
 * 病根：_computeReviewInner / refreshSectorsZT 尾部的空池分支，用 marketReady()
 *       （= S.stocks 是否曾加载过）当"今日真没涨停"的判据。S.stocks 盘中那份还在、
 *       但涨停池接口限流/超时返回空时，会把上一轮真复盘冲掉，并把"今日无涨停"当结论推出去。
 *
 * 修法：引入"确认空"信号 —— 只在涨停池接口本周期真的返回过（refreshSectorsZT 里
 *       r3.status==='fulfilled' 才记 S.ztPoolFetchedAt）且时间戳新鲜（20 分钟内）时，
 *       才写空壳（=今天真没涨停）；否则一律 staleMark('review','held') 沿用旧档、不推。
 *       三处推送（定时器 / 重启补发 / 手动补发）加闸门，旧档/非当日绝不冒充今天推。
 *       ⚠️ 2026-10-28 起手动补发的闸门细化为「真正未就绪」（held / 无归属日 / 计算失败 / 归属日对不上），
 *          不再用 reviewIsStale()——否则「📌 补发 · 数据日 X」分支永远不可达（详见 server.js 该段注释）。
 *
 * 本测试钉四件事：
 *   ① 静态：poolConfirmedEmpty 存在，两处空池覆盖分支都走它（不再裸用 marketReady）
 *   ② 静态：ztPoolFetchedAt 已初始化，且只在 r3 fulfilled 时记时间戳
 *   ③ 静态：三处复盘推送的闸门逐点钉死（手动补发必须用「真正未就绪」而非 reviewIsStale）
 *   ④ 动态：池确认空"函数语义（真跑，注入 marketReady/S/Date 桩）
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
// 剥注释用于取函数体/判真实代码（与 _test_review_dedup.js 同口径）
const SRC = SV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== 复盘空池保护守门（不许错误覆盖旧复盘 / 不许谎报"今日无涨停"）===\n');

console.log('【① 静态：两处空池覆盖分支必须走 poolConfirmedEmpty，不再裸用 marketReady】');
ok(/function poolConfirmedEmpty\(\)/.test(SV), 'poolConfirmedEmpty 判定函数已定义');
// 两处空壳覆盖都改成 poolConfirmedEmpty() 守卫（replace_all 后两处完全一致）
const _emptyGuards = (SV.match(/if \(poolConfirmedEmpty\(\)\) \{ S\.review = mkReviewShell\(\[\]\); staleMark\('review', 'empty'\);[^\}]*\}/g) || []);
ok(_emptyGuards.length >= 2, '两处空池覆盖分支都用 poolConfirmedEmpty() 守卫', '命中 ' + _emptyGuards.length + ' 处');
ok(!/if \(marketReady\(\)\) \{ S\.review = mkReviewShell\(\[\]\)/.test(SV), '空池覆盖不再裸用 marketReady()（杜绝"全A曾加载"误判为"今日无涨停"）');

console.log('\n【② 静态：ztPoolFetchedAt 已初始化，且只在 r3 fulfilled 时记时间戳】');
ok(/ztPoolFetchedAt:\s*0/.test(SV), 'S.ztPoolFetchedAt 已初始化为 0（默认"从未成功拉取"）');
// ⛔ 2026-10-28 改钉（谎报缺口）：原断言只要求「r3 fulfilled」——而 em.fetchZTPool 三源全空时
//    **也是 fulfilled**（返回 []），于是断言把「三源全空」当成了「接口确认今日无涨停」，
//    等于替谎报背书。新判据必须同时要求「返回非空数组」才算本周期成功。
ok(/const _r3ok = r3\.status === 'fulfilled' && Array\.isArray\(r3\.value\) && r3\.value\.length > 0;/.test(SV),
  '涨停池「本周期成功」判据 = fulfilled 且返回非空数组（fulfilled+[] 是三源全空的未确认态，不算成功）');
ok(/if \(_r3ok\) \{ S\.ztPoolFetchedAt = Date\.now\(\); S\.ztPoolFetchOk = true; \}/.test(SV), '只在 _r3ok（真拉到非空池）时才记时间戳，并置 ztPoolFetchOk=true');
ok(/S\.ztPoolFetchOk = false;[\s\S]{0,260}不判定「今日无涨停」/.test(SV), '未确认（三源全空/接口失败）时显式留痕，明示不判定「今日无涨停」');
ok(!/r3\.status !== 'fulfilled'\) S\.ztPoolFetchedAt/.test(SV), 'rejected（限流/超时/断网）绝不记时间戳（数据没回来就不算确认空）');

console.log('\n【③ 静态：三处复盘推送的闸门（旧档/非当日绝不冒充今天推）】');
// ⛔ 2026-10-28 硬化：原来只数 reviewIsStale() 出现次数 >= 3 —— 那把【函数定义行】和
//    【面板状态行 reviewStale: reviewIsStale()】也算成了推送闸门，是侥幸通过；而且它无法发现
//    「手动补发也用了 reviewIsStale()」这个真 bug（那会让 📌 补发分支永远不可达）。
//    → 改成按位置逐点钉死，且明确要求手动补发**不用** reviewIsStale。
ok(/if \(reviewIsStale\(\)\) \{ console\.log\('\[复盘\] 复盘非当日\/未就绪/.test(SV),
  '定时器推送前有 reviewIsStale() 闸门（旧档/非当日不推）');
ok(/if \(it\.length && !reviewIsStale\(\)\)/.test(SV),
  '重启补发推送前有 reviewIsStale() 闸门');
ok(/reviewStale: reviewIsStale\(\)/.test(SV),
  '面板状态仍上报 reviewStale（前端要标出"这是别的交易日的复盘"）');
ok(!/if \(reviewIsStale\(\)\) \{\s*pushLog\('⏳ 复盘数据未就绪/.test(SV),
  '手动补发**不再**用 reviewIsStale()（否则「📌 补发 · 数据日 X」分支永远不可达）');
ok(/const _rvStale = \(typeof staleOf === 'function'\) \? staleOf\('review'\)/.test(SV),
  '手动补发改用「真正未就绪」判据 staleOf(\'review\')');
ok(/_rvMisaligned/.test(SV) && /_crErr/.test(SV),
  '手动补发另加「计算失败(_crErr)」与「归属日对不上(_rvMisaligned)」两道判据（防旧内容顶包）');

console.log('\n【④ 动态：poolConfirmedEmpty 语义（真跑，注入桩）】');
// 抠 poolConfirmedEmpty 完整函数体
const pStart = SRC.indexOf('function poolConfirmedEmpty()');
ok(pStart > 0, '能定位 poolConfirmedEmpty 函数体');
let pd = 0, pEnd = -1;
for (let i = SRC.indexOf('{', pStart); i < SRC.length; i++) {
  if (SRC[i] === '{') pd++;
  else if (SRC[i] === '}') { pd--; if (pd === 0) { pEnd = i + 1; break; } }
}
ok(pEnd > pStart, '取到 poolConfirmedEmpty 完整函数体');
const pSrc = SRC.slice(pStart, pEnd);
function mkPoolConfirmedEmpty(marketReadyVal, fetchedAt, nowMs, okVal) {
  const DateStub = function () {}; DateStub.now = () => nowMs;
  return new Function('marketReady', 'S', 'Date', pSrc + '\n; return poolConfirmedEmpty;')(
    () => marketReadyVal, { ztPoolFetchedAt: fetchedAt, ztPoolFetchOk: okVal }, DateStub);
}
const NOW = 1700000000000;
const C = 20 * 60 * 1000;
// ① 接口本周期返回过 + 时间戳新鲜 + 全A在 → 确认空（允许写空壳/推"今日无涨停"）
ok(mkPoolConfirmedEmpty(true, NOW, NOW, true)() === true, '① 本周期返回+新鲜+有全A+ok → 确认空（true）');
// ② 时间戳陈旧（>20min）→ 不算确认空（数据可能过期，沿用旧档）
ok(mkPoolConfirmedEmpty(true, NOW - C - 1, NOW, true)() === false, '② 时间戳陈旧(>20min) → 非确认空（false，沿用旧档）');
// ③ 从未成功拉取（时间戳=0）→ 非确认空
ok(mkPoolConfirmedEmpty(true, 0, NOW, false)() === false, '③ 从未成功拉取 → 非确认空（false）');
// ④ 全A没回来（marketReady=false）→ 非确认空（数据未就绪）
ok(mkPoolConfirmedEmpty(false, NOW, NOW, true)() === false, '④ 全A未就绪 → 非确认空（false）');
// ⑤ 时间戳在 20min 内（边界内）→ 确认空
ok(mkPoolConfirmedEmpty(true, NOW - C + 1, NOW, true)() === true, '⑤ 时间戳恰在 20min 边界内 → 确认空（true）');
// ⑥ 本周期接口 rejected（ok=false）但旧时间戳仍新鲜 → 必须判非确认空（2026-10-28 修：
//   杜绝「接口挂+快照重建也无果」时误把「数据缺失」谎报成「今日无涨停」）
ok(mkPoolConfirmedEmpty(true, NOW, NOW, false)() === false, '⑥ 本周期rejected+旧时间戳新鲜 → 非确认空（false，不谎报）');

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
