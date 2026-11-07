/**
 * 守门测试：竞价 9:20/9:25 两次推送必达 + 重复推送根治（hg 轮，2026-10-14）
 *
 * 用户原话：「别光添加应用到模型中，还有竞价 9:20 和 9:25 两次推送不要忘记了，
 *            还有就是重复推送的问题，要改正」。
 *
 * 本轮修的五件事（每件都有守门钉死）：
 *   ① sentToday ③ 兜底补「起步早于应发点 → 放行」：旧逻辑在证据窗内一律按已发，
 *      早上发布/回收后起步的容器，竞价预览(9:20)与定稿(9:25)两条全被吞（"忘记了"的根因）。
 *   ② 竞价三处入口（预览/定稿/一进二·竞价确认）补 dueMin，轮询到点时不再被证据窗判「已发」。
 *   ③ 竞价预览先发后置位 + 竞价强势票(m2)跟着定稿的成功一起走（被拦不下发半条）。
 *   ④ 两把一进二锁正则互吃：日报锁 /一进二/ 吃掉竞价确认的流水 → 15:30 日报漏发；
 *      确认锁 /一进二·竞价确认/（无空格）匹配不上真实标题 → 重启重发（重复）。
 *   ⑤ 盘中推送双路径 4 秒连发：scanTrendUniverse 直推段绕过 INTRADAY 节流自己发，
 *      现在统一走 enqueueIntradayMsg，到点合并成一条。
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
function group(t) { console.log('\n── ' + t + ' ──'); }
// 大括号配平取函数体（注释/字符串已剥，正则相关不适用）
function bodyAt(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return '';
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(i, j + 1); }
  }
  return '';
}

console.log('\n=== 竞价 9:20/9:25 推送必达 + 重复推送根治守门（hg 轮）===\n');

group('[1] 竞价三处入口都带 dueMin（应发时刻）');
// 预览 9:20 / 定稿 9:25 / 一进二·竞价确认 9:25 —— 不传 dueMin 的入口在「启动 30 分钟
// 证据窗 + 零流水」下会被 sentToday ③ 一律判「已发」直接吞掉（发布/回收日的根因）。
ok(/sentToday\(auctionPrevDate, ds, \/竞价预览\/, 9 \* 60 \+ 20\)/.test(SV),
  '竞价预览（9:20 早班车）传 dueMin=9:20');
ok(/sentToday\(auctionSentDate, ds, AUC_FINAL_TITLE_RE, 9 \* 60 \+ 25\)/.test(SV),
  '竞价定稿（9:25）传 dueMin=9:25（标题判据走唯一入口 AUC_FINAL_TITLE_RE）');
ok(/sentToday\(yierAuctionSentDate, ds, \/一进二 · 竞价确认\/, 9 \* 60 \+ 25\)/.test(SV),
  '一进二·竞价确认（9:25）传 dueMin=9:25');

group('[1b] 定稿锁只认「定稿自己的标题」（2026-10-28 竞价模块自查）');
// 病根实证：9:15:04 起「🔥 竞价异动 · 连板梯队扫描」先 ✅ 送达，而旧锁「竞价异动|竞价补抓快照」
// 把它当成「定稿已发」→ 9:25 闸门第一道判据就 return，当天定稿 0 外发（1241 条流水里 0 次）。
const afmM = SV.match(/const AUC_FINAL_TITLE_RE = (\/.+\/);/);
ok(!!afmM, '源里有唯一入口常量 AUC_FINAL_TITLE_RE（五处共用，不许各写一份）');
const AFR = afmM ? new Function('return ' + afmM[1])() : /$^/;
ok(AFR.test('═══ 📯 9:25 竞价异动 · 龙头推断 ═══'),
  '定稿自己的标题命中（不命中 → 当天永远不认为自己发过 → 反复重推）');
ok(AFR.test('═══ 📯 9:25 竞价异动 · 龙头推断（手动补发） ═══'), '手动补发也算已发（不许补一条再自动发一条）');
ok(AFR.test('═══ 📯 竞价补抓快照（10:02:11） ═══'), '迟到补抓快照算已发（否则同一天推两份）');
ok(!AFR.test('═══ 🔥 竞价异动 · 连板梯队扫描 ═══'),
  '⛔ 反证：梯队扫描不许命中定稿锁（这正是当天定稿消失的根因）');
ok(!AFR.test('═══ 📯 竞价预览 · 9:20 不可撤单阶段 ═══'), '⛔ 反证：竞价预览不许命中');
ok(!AFR.test('═══ 🔥 竞价共振 · TOP3 ═══'), '⛔ 反证：竞价共振不许命中');
ok(!AFR.test('🩺 20261028 竞价定稿：今日推送 4 条'), '⛔ 反证：沉默诊断自己的标题不许命中');
// 五处共用：1 处定义 + ≥4 处引用
const _afmUse = (SV.match(/AUC_FINAL_TITLE_RE/g) || []).length;
ok(_afmUse >= 5, '定稿判据共用同一常量（定义 + 9:25 闸门/启动闭锁/沉默诊断/漏发体检表）', 'n=' + _afmUse);
ok(!/\/竞价异动\|竞价补抓快照\//.test(SV), '⛔ 旧宽尺子已无残留（它会吃掉梯队扫描的流水）');

group('[2] sentToday ③：起步早于应发点 → 放行（hg 轮新语义，真跑）');
const GRACE = Number((SV.match(/const LATE_BOOT_GRACE_MIN = (\d+);/) || [])[1] || 0);
ok(GRACE >= 15 && GRACE <= 60, '⛔ 源里 LATE_BOOT_GRACE_MIN 仍在 15~60（不放回整晚重发）', 'GRACE=' + GRACE);
const stStart = SRC.indexOf('function sentToday(memLock, ds, titleRe');
ok(stStart > 0, '能定位 sentToday');
const stSrc = bodyAt(SRC, 'function sentToday(memLock, ds, titleRe');
ok(stSrc.length > 400, 'sentToday 函数体完整切出', 'len=' + stSrc.length);
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
const DS = '20261014';
// ① hg 轮核心场景：交易日 9:15 发布（或 8:50 被回收后起步）→ 9:20:30 轮询到点时
//    容器只跑了 5 分钟、流水为空 → 旧逻辑判「已发」吞掉预览；新逻辑放行。
ok(mkSentToday(() => false, { bootAgoMs: 5 * 60 * 1000, bootHad: false, bootMin: 9 * 60 + 15, nowMin: 9 * 60 + 20 })('', DS, /竞价预览/, 9 * 60 + 20) === false,
  '① 容器 9:15 起步（早于 9:20 应发点）+ 零流水 + 证据窗内 → 放行（旧逻辑在这里吞掉竞价两条）');
// ② 同分钟启动：9:25:30 被回收后起步，bootMin == dueMin → 宽限窗内放行
ok(mkSentToday(() => false, { bootAgoMs: 2 * 60 * 1000, bootHad: false, bootMin: 9 * 60 + 25, nowMin: 9 * 60 + 25 })('', DS, /竞价异动|竞价补抓快照/, 9 * 60 + 25) === false,
  '② 容器与应发点同分钟起步 + 零流水 → 宽限窗内放行（竞价一分钟窗口，漏发=当天永久没有）');
// ③ 晚起步但已过宽限：仍按已发（防重复的边界不变）
ok(mkSentToday(() => false, { bootAgoMs: 3 * 60 * 1000, bootHad: false, bootMin: 10 * 60 + 20, nowMin: 11 * 60 })('', DS, /竞价异动|竞价补抓快照/, 9 * 60 + 25) === true,
  '③ 晚起步 95 分钟（远超 30 宽限）+ 零流水 → 仍按已发（不放回整晚重发）');
// ④ 没传 dueMin 的入口：行为一点不变（保守不重推）
ok(mkSentToday(() => false, { bootAgoMs: 5 * 60 * 1000, bootHad: false, bootMin: 9 * 60 + 15, nowMin: 9 * 60 + 20 })('', DS, /竞价预览/) === true,
  '④ 没传 dueMin → 维持原行为（新语义只影响显式传应发时刻的入口）');
// ⑤ 启动时有流水 → 不启用兜底，照落盘判据（证据齐全就按证据来）
ok(mkSentToday(() => false, { bootAgoMs: 5 * 60 * 1000, bootHad: true, bootMin: 9 * 60 + 15, nowMin: 9 * 60 + 20 })('', DS, /竞价预览/, 9 * 60 + 20) === false,
  '⑤ 启动时就有流水 → 不走兜底，按 pushedToday 判（未发=放行）');
ok(mkSentToday(() => true, { bootAgoMs: 5 * 60 * 1000, bootHad: true, bootMin: 9 * 60 + 15, nowMin: 9 * 60 + 20 })('', DS, /竞价预览/, 9 * 60 + 20) === true,
  '⑤b 启动时有流水且命中 → 已发（拦重推）');
// ⑥ 跑满 40 分钟 + 零流水 → 兜底本就该失效（今天真没推过，该发还得发）
ok(mkSentToday(() => false, { bootAgoMs: 40 * 60 * 1000, bootHad: false, bootMin: 9 * 60 + 15, nowMin: 9 * 60 + 56 })('', DS, /竞价预览/, 9 * 60 + 20) === false,
  '⑥ 已跑 40min + 零流水 → 未发（证据窗外，兜底不生效）');
// 反证：两条放行条件一起废掉（模拟旧代码）→ ① 必须回到「已发」，证明断言钉的是新行为
{
  const stOld = stSrc.replace(/_bootMin < dueMin/g, 'false')
    .replace(/if \(nowMin - dueMin < LATE_BOOT_GRACE_MIN\)/, 'if (false)');
  const mkOld = new Function('pushedToday', 'pushLogHasAnyToday', 'console', 'Date',
    'const _bootAt = ' + (Date.now() - 5 * 60 * 1000) + ';\n' +
    'const BOOT_EVIDENCE_MS = 30 * 60 * 1000;\n' +
    'const _bootMin = ' + (9 * 60 + 15) + ';\nconst LATE_BOOT_GRACE_MIN = ' + GRACE + ';\n' +
    'const _bootHadTodayLog = false;\nlet _bootNoEvidenceWarn = "";\n' +
    stOld + '\n; return sentToday;')(
    () => false, () => true, { warn() {}, error() {} },
    Object.assign(function () { return { getHours: () => 9, getMinutes: () => 20 }; }, { now: Date.now }));
  ok(mkOld('', DS, /竞价预览/, 9 * 60 + 20) === true,
    '⛔ 反证：放行条件失效 → 回到「已发」（复现"发布日竞价两条全被吞"的旧病）');
}

group('[3] 先发后置位：预览与 m2 都不许「先闭锁后推」');
// 竞价预览块（锚点：早班车注释 → 定稿注释）
const iPrev = SV.indexOf('竞价「早班车」预览');
const iFinal = SV.indexOf('竞价异动·龙头推断推送到手机');
ok(iPrev > 0 && iFinal > iPrev, '竞价预览块可定位');
const segPrev = SV.slice(iPrev, iFinal);
const iPvPush = segPrev.indexOf('pushAll(m, true, { private: true })');
const iPvLock = segPrev.indexOf('auctionPrevDate = ds');
ok(iPvPush > 0 && iPvLock > iPvPush,
  '⛔ 预览先发后置位（pushAll 在闭锁之前；旧写法先置位→被闸门拦下当天永久没有）',
  'push@' + iPvPush + ' lock@' + iPvLock);
ok(/if \(pushAll\(m, true, \{ private: true \}\) !== false\) auctionPrevDate = ds;/.test(segPrev),
  '预览按 pushAll 返回值置位（被拦下保留重试机会）');
// 竞价强势票 m2：必须藏在定稿推送的成功分支里（旧写法无条件 4 秒后发）
const iFinBody = SV.indexOf('const msg = buildAuctionAlertMessage(au, false);');
ok(iFinBody > 0, '定稿主推送可定位');
const segFin = SV.slice(iFinBody, iFinBody + 4000);
const iOk = segFin.indexOf('if (pushAll(msg, false, { private: true }) !== false) {');
ok(iOk >= 0, '定稿主推送按返回值分支');
// 从 if 起做花括号配平，确认 setTimeout(buildAuctionStrongMessage) 在成功块内
// ⚠️ 两个坑都踩过：① 必须从 `) !== false) {` 之后那个 { 起配平（if 头里的 `{ private: true }`
//    是 opts 对象，从它数起会提前收尾）；② `if (pushAll(msg, ...) !== false) {` 这句在
//    pushYiEr 里有一份一模一样的 —— 必须用 buildAuctionAlertMessage 锚定竞价定稿那一处。
{
  const iAuc = SRC.indexOf('const msg = buildAuctionAlertMessage(au, false);');
  const b = iAuc >= 0 ? SRC.slice(iAuc) : '';
  const lb = b.indexOf('{', b.indexOf(') !== false) {'));
  let d = 0, end = -1;
  for (let j = lb; j < b.length; j++) {
    if (b[j] === '{') d++;
    else if (b[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  const okBlk = end > 0 ? b.slice(0, end) : '';
  ok(/setTimeout\(\(\) => \{[\s\S]{0,400}?buildAuctionStrongMessage\(10\)/.test(okBlk),
    '⛔ 竞价强势票(m2)在定稿成功分支内（主推送被拦时不发半条）');
}
// 反向：m2 不许再出现在成功块之外（旧写法的位置）
{
  const afterIdx = SRC.indexOf('else console.log(\'[auction] 本轮推送被闸门拦下，保留今天重试机会（竞价强势票一并延后）\');');
  const tail = afterIdx > 0 ? SRC.slice(afterIdx, afterIdx + 600) : '';
  ok(!/setTimeout/.test(tail), '⛔ 拦下分支之后不再挂 m2 的 setTimeout（不会绕过主推送单独发出）');
}

group('[4] 两把一进二锁各认各的（日报锁不吃竞价确认，确认锁匹配真实标题）');
// 从源码里抓两把锁的正则源，用 RegExp 重建后对真实标题判定 —— 测的是源码里的正则本身
const lockRe = name => {
  const m = SV.match(new RegExp('let ' + name + ' = sentLockFromPushLog\\(/(.+?)/,'));
  return m ? new RegExp(m[1]) : null;
};
const reYier = lockRe('yierSentDate'), reYierAuc = lockRe('yierAuctionSentDate');
ok(!!reYier && !!reYierAuc, '两把锁的正则都能从源码抓出');
const T_DAILY = '═══ 🎯 一进二 · 次日连板潜力榜 ═══';
const T_AUC = '═══ 🎯 一进二 · 竞价确认 ═══';
ok(reYier && reYier.test(T_DAILY), '日报锁命中日报标题');
ok(reYier && !reYier.test(T_AUC),
  '⛔ 日报锁不命中竞价确认标题（旧 /一进二/ 命中 → 15:30 日报被 9:25 流水挡死，当天漏发）');
ok(reYierAuc && reYierAuc.test(T_AUC),
  '⛔ 确认锁命中真实标题（· 两旁有空格；旧正则无空格 → 落盘判据失效，重启重发）');
ok(reYierAuc && !reYierAuc.test(T_DAILY), '确认锁不命中日报标题（两把锁互不顶）');

group('[5] 竞价确认不再和定稿/强势票抢「竞价」额度（MSG_TYPE_RE 顺序铁律）');
const typeM = SV.match(/const MSG_TYPE_RE = \[([\s\S]*?)\n\];/);
ok(!!typeM, 'MSG_TYPE_RE 可解析');
const TYPES = [];
for (const m of (typeM ? typeM[1] : '').matchAll(/\[\/(.+?)\/,\s*'(.+?)'\]/g)) TYPES.push([new RegExp(m[1]), m[2]]);
const kindOf = head => { for (const [re, k] of TYPES) { if (re.test(head)) return k; } return '其它'; };
ok(kindOf('═══ 🎯 一进二 · 竞价确认 ═══') === '一进二',
  '⛔ 竞价确认标题归【一进二】类（旧顺序先命中 /竞价/ → 三条竞价消息抢 2 额度，总有一条被静默挤掉）');
ok(kindOf('═══ 📯 9:25 竞价异动 · 龙头推断 ═══') === '竞价', '定稿归【竞价】类');
ok(kindOf('═══ 🔥 竞价强势票 · 选股逻辑与涨停概率 ═══') === '竞价', '强势票归【竞价】类');
ok(kindOf('═══ 📯 竞价预览 · 9:20 不可撤单阶段 ═══') === '竞价预览', '预览归【竞价预览】类（长词在前未被抢）');
// ⛔ 2026-10-28：梯队扫描与共振从【竞价】桶拆出，各给各的额度 ——
//    否则 9:15 起梯队扫描先把【竞价: 2】吃满，9:25 定稿必被条数闸门拦下（且拦下也算「本轮终结」→ 闭锁照样打上）。
ok(kindOf('═══ 🔥 竞价异动 · 连板梯队扫描 ═══') === '竞价梯队',
  '⛔ 梯队扫描单列【竞价梯队】类（旧归【竞价】→ 9:15 起就吃掉 9:25 定稿的额度）');
ok(kindOf('═══ 🔥 竞价共振 · TOP3 ═══') === '竞价共振', '⛔ 共振单列【竞价共振】类');
ok(/竞价梯队:\s*\d+/.test(SV) && /竞价共振:\s*\d+/.test(SV),
  '两类都有 MSG_CAP 额度（没登记 = 默认只有 1 条，等于换了个地方卡死）');
ok(kindOf(T_DAILY) === '一进二', '一进二日报归【一进二】类');
// 顺序铁律：竞价确认那条必须排在 /竞价/ 之前
// ⚠️ 用 `[/` 前缀定位真实条目：数组切片里也含注释，注释里同样写着"竞价"二字，
//    直接 indexOf('/竞价/') 会先命中我自己写的注释（实测踩过）。
{
  const arr = (typeM ? typeM[1] : '');
  const iConf = arr.indexOf('[/一进二 · 竞价确认/,');
  const iJing = arr.indexOf('[/竞价/,');
  ok(iConf > 0 && iJing > 0 && iConf < iJing, '⛔ 长词在前：竞价确认条目排在 /竞价/ 之前（否则又被抢额度）',
    'conf@' + iConf + ' jing@' + iJing);
  // ⛔ 2026-10-28：同一条顺序铁律对梯队扫描 / 共振同样成立（它们都含「竞价」二字）
  const iTier = arr.indexOf('[/竞价异动 · 连板梯队扫描/,');
  const iRes = arr.indexOf('[/竞价共振/,');
  ok(iTier > 0 && iRes > 0 && iTier < iJing && iRes < iJing,
    '⛔ 长词在前：梯队扫描 / 共振都排在 /竞价/ 之前（否则被 /竞价/ 先命中，等于没拆）',
    'tier@' + iTier + ' res@' + iRes + ' jing@' + iJing);
}

group('[6] 盘中推送单一出口（治 10-13「四秒连发两条同标题」）');
ok(/const INTRADAY = \{ buf: new Map\(\), timer: null, lastSent: 0, firstAt: 0, parts: \[\] \};/.test(SV),
  'INTRADAY 增加 parts 暂存队列（直推段与信号快报在同一场 flush 合并）');
ok(/function enqueueIntradayMsg\(text, opt\) \{/.test(SRC), '统一出口 enqueueIntradayMsg 已定义');
ok(/INTRADAY\.parts\.splice\(0\)/.test(SRC), 'flushIntraday 合并直推段（同一节流、同一条消息）');
// scanTrendUniverse 里那段：必须走 enqueueIntradayMsg，不许再直推 pushAll
{
  const iPool = SRC.indexOf('poolMsgPart || trendMsgPart');
  ok(iPool > 0, '盘中直推段可定位');
  const segPool = SRC.slice(iPool, iPool + 900);
  ok(/enqueueIntradayMsg\(`═══ 📊 量化看盘·盘中推送 ═══/.test(segPool),
    '⛔ 直推段改走 enqueueIntradayMsg（不再绕过 3 分钟间隔自己发）');
  ok(!/pushAll\(`═══ 📊 量化看盘·盘中推送/.test(segPool),
    '⛔ 直推段里不再有裸 pushAll（两条路径各发各的 = 4 秒连发两条同标题）');
}
// 合并时去掉重复大标题 + undo/modDay 一起合并（占位退还语义不丢）
ok(/String\(p\.text \|\| ''\)\.replace\(\/\^═══ 📊 量化看盘·盘中推送 ═══\\n\?\/, ''\)/.test(SRC),
  '合并时剥掉直推段重复的大标题（一条消息一个头）');
ok(/if \(p\.opt && p\.opt\.undo\) opt\.undo = \(opt\.undo \|\| \[\]\)\.concat\(p\.opt\.undo\);/.test(SRC)
  && /opt\.modDay = \(opt\.modDay \|\| \[\]\)\.concat\(ms\);/.test(SRC),
  '⛔ undo/modDay 合并进同一次 pushAll（发送失败时占位照旧退回，语义不丢）');

group('[7] 漏发体检登记表含竞价两条（只检测告警，不补推）');
ok(/key: 'auctionPrev'[\s\S]{0,200}?dueMin: 9 \* 60 \+ 20[\s\S]{0,200}?heal: null/.test(SV),
  '竞价预览进体检表（heal:null —— 9:26 后自动补推是马后炮，gb 轮定过性）');
ok(/key: 'auctionFinal'[\s\S]{0,200}?dueMin: 9 \* 60 \+ 25[\s\S]{0,200}?heal: null/.test(SV),
  '竞价定稿进体检表（漏发变响亮：用户第一时间知道，可面板手动补发）');
ok(/健康告警: 5/.test(SV), '健康告警额度 3→5（五个必达模块各一条/天，不互相挤）');

group('[8] 工程纪律');
ok(!/\r/.test(SV), 'server.js 保持 LF（无 CRLF）');
const v = (SV.match(/APP_VER = '([^']+)'/) || [])[1];
ok(/^\d{8}[a-z]{2}$/.test(v || ''), '版本号格式正常', v);

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
console.log(fail === 0 ? '✅ 全部通过' : '❌ 有失败项');
process.exit(fail > 0 ? 1 : 0);
