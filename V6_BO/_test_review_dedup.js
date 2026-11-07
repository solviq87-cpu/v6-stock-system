/**
 * 守门测试：「每天一条」的推送不许重复推（2026-10-08 彻底修，用户反复投诉复盘一天推六遍）
 *
 * 病根：所有「每天一条」闭锁（reviewSentDate / auctionSentDate / nextPlanSentDate …）
 *       都是内存变量，每次重启清零；启动时虽用 sentLockFromPushLog 恢复一次，
 *       但那次没命中（标题没匹配 / 流水无 ✅ 记录）闭锁就是空的 → 重启后再推一遍。
 *       一天发几个版本 = 重复几遍（复盘 2min+8min 两次补发 × 重启 3 次 = 6 条）。
 *
 * 修法：抽唯一判据 sentToday(内存闭锁, 今天, 标题正则) —— 内存闭锁 **或** 落盘流水，
 *       任一为真即「今天已发」。所有「每天一条」入口统一走它。
 *
 * 本测试钉三件事：
 *   ① sentToday 的组合语义（真跑，注入 pushedToday 桩）
 *   ② pushedToday 落盘判据的语义（真跑，受控流水）—— 否则第二道闸形同虚设
 *   ③ 源码：各入口必须调用 sentToday，且不许再有裸判 `xxxSentDate !== ds`
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
// 剥注释用于取函数体/判真实代码（正则字面量会被抹 → 正则相关判定一律看原始 SV）
const SRC = SV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== 「每天一条」推送去重守门（不许重复推）===\n');

console.log('【① 源码：统一判据 sentToday 存在，各入口都走它】');
// ⛔ gk 轮：签名多了第 4 个可选参数 dueMin（该模块的应发时刻，分钟），
//    断言钉语义不钉字符串 —— 允许带与不带两种形式。
ok(/function sentToday\(memLock, ds, titleRe(,\s*dueMin)?\)/.test(SRC), 'sentToday 唯一判据函数已定义');

// 每个「每天一条」入口：必须调用 sentToday(对应闭锁, ds/todayStr(), 对应标题正则)
const ENTRIES = [
  { name: '每日复盘·自动定时器',   re: /sentToday\(reviewSentDate,\s*ds,\s*\/每日复盘\// },
  { name: '每日复盘·重启补发',     re: /sentToday\(reviewSentDate,\s*todayStr\(\),\s*\/每日复盘\// },
  { name: '次日作战计划',         re: /sentToday\(nextPlanSentDate,\s*ds,\s*\/次日作战计划\// },
  { name: '竞价异动',            re: /sentToday\(auctionSentDate,\s*ds,\s*AUC_FINAL_TITLE_RE/ },
  { name: '每日新闻汇总',         re: /sentToday\(digestSentDate,\s*ds,\s*\/每日新闻汇总\// },
  { name: '周末新闻汇总',         re: /sentToday\(weekendSentDate,\s*ds,\s*\/周末新闻汇总\// },
  { name: '全市场趋势扫描',       re: /sentToday\(tsScanDate,\s*ds,\s*\/全市场趋势扫描\// },
  { name: '连续收涨',            re: /sentToday\(suScanDate,\s*ds,\s*\/连续收涨\// },
  { name: '涨停前形态',          re: /sentToday\(zpScanDate,\s*ds,\s*\/涨停前形态\// },
  // ⛔ 这处原来写的是 `holidaySentDate === ds`（**等号**形式），收口时按 `!== ds` 扫描漏掉了它 →
  //    加进登记表，并在下面补一条「等号形式也不许裸判」的反证，防止同样形态再溜过去。
  { name: '假期要闻全景',        re: /sentToday\(holidaySentDate,\s*ds,\s*\/假期要闻全景\// },
  // ⛔⛔ fz 轮补登（2026-10-09 用户「飞书你又重复推送」）：这几个入口当时**根本没走 sentToday**，
  //    全是裸判内存变量（`S.reviewGoodPushedDate !== todayStr()` / `auctionPrevDate !== ds` /
  //    `bootCheckDate !== ds`）—— 内存一重启就清零 → 每次发布必定重发一遍，
  //    而上面那份登记表里没有它们，所以"不许裸判"这条从没管到。现在一并钉死。
  { name: '涨停复盘·好标的挖掘',  re: /sentToday\(S\.reviewGoodPushedDate,\s*todayStr\(\),\s*\/涨停复盘\|好标的挖掘\// },
  { name: '竞价预览',            re: /sentToday\(auctionPrevDate,\s*ds,\s*\/竞价预览\// },
  { name: '开盘自检',            re: /sentToday\(bootCheckDate,\s*ds,\s*\/开盘自检\// },
  // ⛔ hg 轮改判据（用户「重复推送要改正」）：日报锁只认自己的标题。旧写法 /一进二/ 会把
  //    9:25「一进二 · 竞价确认」的送达记录误判成"日报已发"→ 15:30 日报被漏掉。
  { name: '一进二',              re: /sentToday\(yierSentDate,\s*ds,\s*\/一进二 · 次日连板潜力榜\// },
  { name: '连板接力',            re: /sentToday\(erjinSanSentDate,\s*ds,\s*\/连板接力\// },
  { name: '学习日报',            re: /sentToday\(learnReportSentDate,\s*ds,\s*\/学习日报\// },
];
for (const e of ENTRIES) ok(e.re.test(SV), `${e.name} 入口走 sentToday（双判据）`);

// 反证：不许再有裸判「内存闭锁 !== ds」（会退化为只看内存、重启即失忆）
//   排除 sentToday 内部（它用 === ds 是判据本体，不是裸判）
const sentTodayBody = (() => {
  const i = SRC.indexOf('function sentToday(memLock, ds, titleRe');
  if (i < 0) return '';
  let d = 0;
  for (let j = SRC.indexOf('{', i); j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (d === 0) return SRC.slice(i, j + 1); }
  }
  return '';
})();
const outsideBody = SRC.split(sentTodayBody).join('');
// 形如 `xxxSentDate !== ds` 的裸判（排除 sentToday 体）
const bare = [...outsideBody.matchAll(/(\w+(?:Sent|Scan)Date)\s*!==\s*ds/g)].map(m => m[1]);
ok(bare.length === 0, '全项目无「裸判内存闭锁 !== ds」（不许退回只看内存）',
   bare.length ? '残留: ' + [...new Set(bare)].join('、') : '');
// ⛔ 等号形式同样不许裸判（`if (holidaySentDate === ds) return;` 就是这么漏掉的：
//    收口时只扫了 !== ds，这处用的是 === ds，语义完全一样也是只看内存）
const bareEq = [...outsideBody.matchAll(/(\w+(?:Sent|Scan)Date)\s*===\s*ds/g)].map(m => m[1]);
ok(bareEq.length === 0, '全项目无「裸判内存闭锁 === ds」（等号形式同样只看内存）',
   bareEq.length ? '残留: ' + [...new Set(bareEq)].join('、') : '');

console.log('\n【② 真跑：sentToday 双判据的组合语义】');
// 注入 pushedToday 桩（隔离测试 sentToday 组合逻辑；pushedToday 自身语义在③单独真跑）
const stStart = SRC.indexOf('function sentToday(memLock, ds, titleRe');
let d2 = 0, stEnd = -1;
for (let i = SRC.indexOf('{', stStart); i < SRC.length; i++) {
  if (SRC[i] === '{') d2++;
  else if (SRC[i] === '}') { d2--; if (d2 === 0) { stEnd = i + 1; break; } }
}
ok(stEnd > stStart, '能取到 sentToday 完整函数体');
const stSrc = SRC.slice(stStart, stEnd);
// new Function 返回的是函数本身，要再调一次（本项目已知坑）
// ⛔ fz 轮：sentToday 多了「今天零流水=证据随容器丢了」这条兜底（2026-10-09 发布即新容器导致当天日报全重发），
//    依赖 _bootAt / BOOT_EVIDENCE_MS / pushLogHasAnyToday 三个符号 —— 沙箱里少注入一个就是
//    ReferenceError（套件崩，不是红），所以这里必须一并补齐。默认 pushLogHasAnyToday 返回 true
//    （= 今天有流水、证据链成立），这样下面 ①~⑤ 五条原有断言的语义一点没变。
// ⛔⛔ gk 轮：又多了 _bootMin / LATE_BOOT_GRACE_MIN / new Date()（算"现在时刻"）三个依赖，
//    一并注入；nowMin 用 Date 桩控制（new 一个返回对象的构造函数即可覆盖 this）。
// ⛔⛔ gn 轮（2026-10-13）：LATE_BOOT_GRACE_MIN 沙箱值必须【随源读取】——gk 轮硬编码 120，
//    gn 轮把源改成 540（用户「复盘新闻推送说了八百遍」的根治：23:56 才被拉起的容器复盘
//    算完了却被 120 分钟窗挡死不推）后，沙箱与现实分叉，⑨ 那条断言等于在钉一个不再存在的值。
//    同时钉源里的宽限必须覆盖 15:30→23:59（510 分钟）整段，否则傍晚必达名不副实。
const GRACE = Number((SV.match(/const LATE_BOOT_GRACE_MIN = (\d+);/) || [])[1] || 0);
ok(GRACE >= 15 && GRACE <= 60,
  '⛔ 源里 LATE_BOOT_GRACE_MIN 须在 15~60 分钟（覆盖 15:47 刚错过场景，且不回退到 540 那种整晚重发）', 'GRACE=' + GRACE);
const mkSentToday = (pushedTodayStub, opt) => {
  const o = opt || {};
  const DateStub = (o.nowMin === undefined) ? Date : Object.assign(function () {
    return { getHours: () => Math.floor(o.nowMin / 60), getMinutes: () => o.nowMin % 60 };
  }, { now: Date.now });
  return new Function('pushedToday', 'pushLogHasAnyToday', 'console', 'Date',
    'const _bootAt = ' + (Date.now() - (o.bootAgoMs || 0)) + ';\n' +
    'const BOOT_EVIDENCE_MS = 30 * 60 * 1000;\n' +
    'const _bootMin = ' + (o.bootMin === undefined ? -1 : o.bootMin) + ';\n' +
    'const LATE_BOOT_GRACE_MIN = ' + GRACE + ';\n' +
    'const _bootHadTodayLog = ' + (o.bootHad !== false) + ';\n' +
    'let _bootNoEvidenceWarn = "";\n' +
    stSrc + '\n; return sentToday;')(
    pushedTodayStub,
    o.hasAnyToday || (() => true),
    { warn() {}, error() {} },
    DateStub);
};

const DS = '20261008';
// ① 内存闭锁命中 → true（不看流水也对）
ok(mkSentToday(() => false)(DS, DS, /x/) === true, '内存闭锁命中 → 已发（true）');
// ② 内存空但落盘流水命中 → true（这就是修好的关键：重启后靠流水拦住）
ok(mkSentToday(() => true)('', DS, /x/) === true, '内存空 + 落盘流水命中 → 已发（true，重启不再重推）');
// ③ 两者都无 → false（今天真没发，允许推）
ok(mkSentToday(() => false)('', DS, /x/) === false, '内存空 + 流水无 → 未发（false，允许推）');
// ④ 内存闭锁是昨天的值 → 不算今天已发
ok(mkSentToday(() => false)('20261007', DS, /x/) === false, '内存闭锁是昨天 → 不算今天已发（false）');
// ⑤ 没传标题正则时只靠内存闭锁（退化安全，不误判）
ok(mkSentToday(() => false)(DS, DS, null) === true, '未传正则时仍认内存闭锁（退化安全）');
// ⑥⑦ fz 轮：容器刚起来、今天一条流水都没有 = 证据随容器丢了 → 按已发处理，别把当天日报全重发一遍。
//     ⛔ 但只在「刚启动」成立：跑满 30 分钟还零流水，那是今天真没推过，该发还得发（否则 14:00 发布
//        会把 15:30 那份复盘一起吞掉）。
ok(mkSentToday(() => false, { bootAgoMs: 60 * 1000, bootHad: false })('', DS, /x/) === true,
  '刚启动(1min) + 启动时零流水 → 已发（证据丢了，不再重发当天日报）');
// ⛔ 判据看的是「启动那一刻」的快照：启动后自己发出去的流水不算证据，否则第一条之后兜底就失效
ok(mkSentToday(() => false, { bootAgoMs: 60 * 1000, bootHad: false, hasAnyToday: () => true })('', DS, /x/) === true,
  '⛔ 启动后自己发出的流水不算证据（第一条发出去兜底就失效 = 剩下几条照发）');
ok(mkSentToday(() => false, { bootAgoMs: 40 * 60 * 1000, bootHad: false })('', DS, /x/) === false,
  '⛔ 已跑 40min + 启动时零流水 → 未发（那是今天真没推过，不许把当天该发的那份吞掉）');

// ═══ ⑧~⑫ gk→gn 轮：晚起步放行（2026-10-12 线上实测复盘 15:40 前没送到）═══
// 病根：云端回收容器是常态。15:47 拉起的新容器流水为空 → ③ 恒真 → 「每日复盘」永远发不出去。
// 修法：容器起步时刻晚于该模块应发时刻、且仍在宽限窗内 → 放行（用户要求必达）。
// ⛔⛔ gn 轮（2026-10-13 用户「复盘新闻推送说了八百遍」）：宽限从 120 放宽到 540 分钟。
//    线上 10-12 全天 pushlog 0 条：15:30 之后每个新容器起步都晚于应发点 2 小时以上
//    （23:56 被拉起那次，复盘 23:58 算完了却没推，就差在 120 分钟窗上）。真正的防重复判据
//    不是起步时刻，而是落盘流水（② pushedToday，跨发布存活）—— 起步时刻只剩「有没有发送
//    机会」一个用途：晚于应发点起步 = 从没有过机会 → 放行。
const DUE = 15 * 60 + 30;   // 复盘应发 15:30
ok(mkSentToday(() => false, { bootAgoMs: 2 * 60 * 1000, bootHad: false, bootMin: 15 * 60 + 47, nowMin: 15 * 60 + 55 })('', DS, /每日复盘/, DUE) === false,
  '⑧ 容器 15:47 才起步（晚于 15:30 应发点）+ 零流水 + 刚过点 25min → 放行发送（复盘必达）');
// ⛔ hd 轮改判据：宽限从 540 收紧到 30 分钟。18:43 起步距 15:30 应发点 193 分钟 ≫ 30 宽限
//    → 现在【按已发】，不再放行。重复发的根就是"整晚兜底"；真漏发走面板手动补发。
//    仍覆盖合法场景：15:47 才起步（仅 17 分钟 < 30）继续放行（见 ⑧）。
ok(mkSentToday(() => false, { bootAgoMs: 3 * 60 * 1000, bootHad: false, bootMin: 18 * 60 + 43, nowMin: 18 * 60 + 50 })('', DS, /每日复盘/, DUE) === true,
  '⑨ 容器 18:43 才起步、已过点 3 小时远超 30 宽限 → 按已发（不再重发，根治"一天发好几遍"）');
// 宽限不是无限放行：晚起步 + 超过宽限窗 → 仍按已发（别把重复推送放回来）
ok(mkSentToday(() => false, { bootAgoMs: 2 * 60 * 1000, bootHad: false, bootMin: 10 * 60, nowMin: 18 * 60 + 31 })('', DS, /每日复盘/, 9 * 60 + 25) === true,
  '⑨b 晚起步但已过宽限窗（早间应发点 9:25 + 546min）→ 仍按已发（宽限有边界）');
// ⛔⛔ hg 轮改判据（用户「竞价 9:20 和 9:25 两次推送不要忘记了」）：起步【早于】应发点 +
//    零流水 → 放行。旧逻辑在这里按已发：15:05 被回收后起步的容器，15:30 复盘/9:20 竞价
//    全被吞（上一个实例在应发点之前就已死，当天这条它不可能发过，"零流水"=确实还没发）。
//    拦住它 = 当天必漏，且没有任何重复风险（旧实例死于应发点之前，发不出来）。
ok(mkSentToday(() => false, { bootAgoMs: 25 * 60 * 1000, bootHad: false, bootMin: 15 * 60 + 10, nowMin: 15 * 60 + 35 })('', DS, /每日复盘/, DUE) === false,
  '⑩ 容器 15:10 起步（早于 15:30 应发点）+ 零流水 + 30min 窗内 → 放行（上一个实例死于应发点前，不可能发过；拦住=必漏）');
ok(mkSentToday(() => false, { bootAgoMs: 2 * 60 * 1000, bootHad: false, bootMin: 15 * 60 + 47, nowMin: 15 * 60 + 55 })('', DS, /每日复盘/) === true,
  '⑪ 没传 dueMin 的入口 → 一律维持原行为（保守不重推，不因新参数改变别的模块）');
// 反证：把放行条件去掉（模拟旧代码）→ ⑧ 那条必须变红，证明断言真的在钉这个行为
// ⛔ hg 轮：放行条件现在是两条（起步早于应发点 / 晚起步但在宽限窗内），反证要一起废掉，
//    只废一条另一条仍会放行 → 反证本身会假红。
{
  const stOld = stSrc.replace(/_bootMin < dueMin/g, 'false')
    .replace(/if \(nowMin - dueMin < LATE_BOOT_GRACE_MIN\)/, 'if (false)');
  const mkOld = new Function('pushedToday', 'pushLogHasAnyToday', 'console', 'Date',
    'const _bootAt = ' + (Date.now() - 2 * 60 * 1000) + ';\n' +
    'const BOOT_EVIDENCE_MS = 30 * 60 * 1000;\n' +
    'const _bootMin = 947;\nconst LATE_BOOT_GRACE_MIN = ' + GRACE + ';\n' +
    'const _bootHadTodayLog = false;\nlet _bootNoEvidenceWarn = "";\n' +
    stOld + '\n; return sentToday;')(
    () => false, () => true, { warn() {}, error() {} },
    Object.assign(function () { return { getHours: () => 15, getMinutes: () => 55 }; }, { now: Date.now }));
  ok(mkOld('', DS, /每日复盘/, DUE) === true, '⑧ 反证：放行条件失效 → 回到「已发」（确认断言不是恒绿）');
}
// ⛔ 反证②：把宽限改回 120（>193 分钟，远大于 18:43 的 193）→ 18:43 仍判「已发」，
//    证明放行只发生在 nowMin-dueMin < 宽限 的窄窗内（而非整晚），与源里 30 一致。
{
  const stOld = stSrc.replace(/if \(nowMin - dueMin < LATE_BOOT_GRACE_MIN\)/, 'if (nowMin - dueMin < 120)');
  const mkOld = new Function('pushedToday', 'pushLogHasAnyToday', 'console', 'Date',
    'const _bootAt = ' + (Date.now() - 3 * 60 * 1000) + ';\n' +
    'const BOOT_EVIDENCE_MS = 30 * 60 * 1000;\n' +
    'const _bootMin = ' + (18 * 60 + 43) + ';\nconst LATE_BOOT_GRACE_MIN = ' + GRACE + ';\n' +
    'const _bootHadTodayLog = false;\nlet _bootNoEvidenceWarn = "";\n' +
    stOld + '\n; return sentToday;')(
    () => false, () => true, { warn() {}, error() {} },
    Object.assign(function () { return { getHours: () => 18, getMinutes: () => 50 }; }, { now: Date.now }));
  ok(mkOld('', DS, /每日复盘/, DUE) === true, '⑨ 反证：宽限退到 120（仍 >193）→ 18:43 仍判「已发」（放行只认窄窗）');
}

console.log('\n【③ 真跑：落盘判据 pushedToday 的语义】');
const pStart = SRC.indexOf('function pushedToday(titleRe) {');
ok(pStart > 0, '能定位 pushedToday 函数');
let d3 = 0, pEnd = -1;
for (let i = SRC.indexOf('{', pStart); i < SRC.length; i++) {
  if (SRC[i] === '{') d3++;
  else if (SRC[i] === '}') { d3--; if (d3 === 0) { pEnd = i + 1; break; } }
}
// hw 轮：pushedToday 现在调用 pushIsOutStatus；沙箱里没有它 → ReferenceError 被 catch 吞成「没记录」
const _iPis = SRC.indexOf('function pushIsOutStatus(st) {');
const _jPis = _iPis < 0 ? -1 : SRC.indexOf('\nfunction ', _iPis + 1);
const PIS_SRC = _iPis < 0 ? '' : SRC.slice(_iPis, _jPis > 0 ? _jPis : SRC.length);
if (!PIS_SRC) throw new Error('未找到 pushIsOutStatus（沙箱会静默失效，必须显式炸出来）');
const pSrc = PIS_SRC + '\n' + SRC.slice(pStart, pEnd);
const mkPushedToday = () => new Function('PUSH_LOG', 'todayStr', 'dayKeyOf', 'pushLogCoversToday',
  'dataCapOf', '_pushLogCapWarnDate', 'console', pSrc + '\n; return pushedToday;');

const DAY = 86400000, NOW = Date.now();
function _dayKeyOf(ts) {
  const dd = new Date(ts);
  return '' + dd.getFullYear() + String(dd.getMonth() + 1).padStart(2, '0') + String(dd.getDate()).padStart(2, '0');
}
const TODAY_KEY = _dayKeyOf(NOW);
const mk = (ts, status, title) => ({ ts, status, title });
const RT = '═══ 📊 每日复盘 · 2026-10-08 ═══';
function run(logs) {
  // ⛔ new Function 返回函数本身 → 再调一次才是结果
  const fn = mkPushedToday()(logs, () => TODAY_KEY, _dayKeyOf, () => true, () => 9999, '',
    { warn(){}, error(m){ console.log('    [sandbox err] ' + m); } });
  return fn(/每日复盘/);
}
ok(run([mk(NOW, '✅ 已送达', RT)]) === true, '今天✅送达且标题命中 → true（拦住重推）');
ok(run([mk(NOW - DAY, '✅ 已送达', RT)]) === false, '昨天的送达记录不算今天 → false');
ok(run([mk(NOW, '✅ 计算完成(dry 未发送)', RT)]) === false, '状态含「未发送」的试算不算送达 → false');
ok(run([mk(NOW, '🚫 条数闸门拦截', RT)]) === false, '非✅（被闸门拦下）不算送达 → false');
ok(run([mk(NOW, '✅ 已送达', '═══ 竞价异动 ═══')]) === false, '今天✅但标题不命中 → false（不误判）');
ok(run([mk(NOW - DAY, '✅ 已送达', RT), mk(NOW, '🚫 拦截', RT), mk(NOW, '✅ 已送达', RT)]) === true,
   '多条混合时有一条今天✅命中 → true');

console.log('\n【④ 真跑：✅ 送达记录必须**立即落盘**，不能等 3 秒节流】');
// 病根链条的最后一环：写盘原本一律 3 秒节流，复盘刚送达就发布重启 → ✅ 没落盘 → 两道闸一起瞎。
// 这里把 pushLog 函数体抠出来真跑，数 pushLogFlush 被调用几次。
const lStart = SRC.indexOf('function pushLog(status, text, extra) {');
ok(lStart > 0, '能定位 pushLog 函数');
let d4 = 0, lEnd = -1;
for (let i = SRC.indexOf('{', lStart); i < SRC.length; i++) {
  if (SRC[i] === '{') d4++;
  else if (SRC[i] === '}') { d4--; if (d4 === 0) { lEnd = i + 1; break; } }
}
const lSrc = SRC.slice(lStart, lEnd);
// 桩：数 flush 次数；setTimeout 只记录"被安排了"而不真跑（避免测试挂住）
function runPushLog(status) {
  let flush = 0, scheduled = 0;
  const PUSH_LOG = [];
  const fn = new Function('PUSH_LOG', 'dataCapOf', 'pushTitle', 'pushLogFlush', '_pushLogTimer',
    'setTimeout', 'clearTimeout', 'Object', 'Date', 'String',
    lSrc + '\n; return pushLog;')(
    PUSH_LOG, () => 500, () => 'T', () => { flush++; }, null,
    () => { scheduled++; return 1; }, () => {}, Object, Date, String);
  fn(status, 'text', null);
  return { flush, scheduled, len: PUSH_LOG.length };
}
const rOk = runPushLog('✅ 已送达');
ok(rOk.flush === 1 && rOk.scheduled === 0, '✅ 送达 → 立即落盘（flush=1，不再排节流）',
   `flush=${rOk.flush} scheduled=${rOk.scheduled}`);
const rDry = runPushLog('✅ 计算完成(dry 未发送)');
ok(rDry.flush === 0 && rDry.scheduled === 1, '「✅…未发送」试算不算送达 → 不落盘（走节流，别拿它当证据）',
   `flush=${rDry.flush} scheduled=${rDry.scheduled}`);
const rBlock = runPushLog('🚫 条数闸门');
ok(rBlock.flush === 0 && rBlock.scheduled === 1, '被闸门拦下 → 不落盘（走节流，它本就该重试）',
   `flush=${rBlock.flush} scheduled=${rBlock.scheduled}`);
ok(rOk.len === 1 && rBlock.len === 1, '无论哪条都照样进内存流水（落盘快慢不影响面板可查）');

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
