// 守门测试：hv 轮竞价抓取时段闸（#232 同源漏修，2026-10-15）
//
// 事故还原：hu 轮修 #232 时 auctionCaptureAllowed 只补了"是不是交易日"，没判"是不是交易时段"。
//   服务凌晨重启（启动链 L11679 captureAuction(false) 无条件跑）照样放行：auctionPhase=0 →
//   auctionPxOf 走"开盘价"分支 → 拿**当日已实现的开盘价**冒充"竞价虚拟匹配价"落 auczt 信号。
//   本机实证：384 条 auczt 里 205 条 ts 不在 09:15~09:29（凌晨101/盘中80/盘前18/傍晚6），
//   事前/事后两种语义混进同一 type → paths/buckets 的"竞价因子命中率"名不副实 →
//   corr 被压到 0.7、36 个因子 adj 清一色负 → prob 中位 30 → 55 闸全灭（自我强化死循环）。
//
// 本轮钉四件事：
//   ① auctionCaptureAllowed 时段闸：交易日 + 08:30~15:30 才允许抓（凌晨/傍晚/盘前拒绝）
//   ② inferZTProb 落库窗口：只有 phase 1/2/3（09:15~09:30 真竞价窗口）才 logSignal('auczt')；
//      盘中补抓照样刷面板，只是不进学习库（数据口径与因子名对齐）
//   ③ captureAuction 函数体带闸（防有人删掉调用）
//   ④ 存量已标废：stats.json 里 auczt 非 void 样本的 ts 必须全部落在真竞价窗口内
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}

// 常量对齐：真表从 server.js 现抓（抄一份就测不到表被改）
const holSrc = (src.match(/const MARKET_HOLIDAYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
const wdSrc = (src.match(/const MARKET_WORKDAYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
if (!holSrc || !wdSrc) { console.log('  ❌ 抓不到 MARKET_HOLIDAYS/MARKET_WORKDAYS 常量'); process.exit(1); }

const mkAllowed = () => new Function([
  'const holidayTableWarn = () => {};',
  wdSrc, holSrc,
  grab(/function isTradeDay\(d\) \{/),
  grab(/function auctionCaptureAllowed\(now\) \{/),
  'return auctionCaptureAllowed;'
].join('\n'))();

console.log('\n=== hv 轮竞价抓取时段闸守门 ===\n');

// ① auctionCaptureAllowed 时段闸（源头闸门）
const allowed = mkAllowed();
ok('交易日 09:20（竞价中）允许', allowed(new Date(2026, 9, 14, 9, 20)) === true);
ok('交易日 09:29（撮合完成前最后一秒）允许', allowed(new Date(2026, 9, 14, 9, 29)) === true);
ok('交易日 09:30（已开盘·盘中补抓设计内）允许', allowed(new Date(2026, 9, 14, 9, 30)) === true);
ok('交易日 12:11（午间补抓）允许', allowed(new Date(2026, 9, 14, 12, 11)) === true);
ok('交易日 15:30（收盘边界）允许', allowed(new Date(2026, 9, 14, 15, 30)) === true);
ok('交易日 15:31（收盘后）拒绝', allowed(new Date(2026, 9, 14, 15, 31)) === false);
ok('交易日 17:08（傍晚）拒绝', allowed(new Date(2026, 9, 14, 17, 8)) === false);
ok('交易日 01:04（凌晨重启）拒绝', allowed(new Date(2026, 9, 14, 1, 4)) === false);
ok('交易日 03:06（凌晨）拒绝', allowed(new Date(2026, 9, 14, 3, 6)) === false);
ok('交易日 08:29（盘前 1 分钟）拒绝', allowed(new Date(2026, 9, 14, 8, 29)) === false);
ok('交易日 08:30（盘前边界）允许', allowed(new Date(2026, 9, 14, 8, 30)) === true);
ok('交易日 09:10（盘前·时段闸放行刷面板，落库由 phase 闸把守）', allowed(new Date(2026, 9, 14, 9, 10)) === true);
// 交易日闸不回归（hu 轮 #232 的判据仍生效）
ok('法定假日(10-01 周四)09:20 仍拒绝（交易日闸不回归）', allowed(new Date(2026, 9, 1, 9, 20)) === false);
ok('周六 09:20 仍拒绝', allowed(new Date(2026, 9, 10, 9, 20)) === false);
ok('周日 01:04 仍拒绝', allowed(new Date(2026, 9, 11, 1, 4)) === false);
ok('无参调用返回布尔（取当前时间，不崩）', typeof allowed() === 'boolean');

// ② captureAuction 函数体带闸（防有人删掉调用）
const capBody = grab(/async function captureAuction\(force\) \{/);
ok('captureAuction 函数体调用 auctionCaptureAllowed（源头闸门在）', /auctionCaptureAllowed\(\)/.test(capBody));

// ③ inferZTProb 落库窗口：只有 phase 1/2/3 才 logSignal('auczt')
const probBody = grab(/function inferZTProb\(\) \{/);
ok('inferZTProb 函数体含 phase 1/2/3 窗口判据', /S\.auction\.phase === 1 \|\| S\.auction\.phase === 2 \|\| S\.auction\.phase === 3/.test(probBody));
ok('inferZTProb 函数体仍落 logSignal(\'auczt\'', /logSignal\('auczt'/.test(probBody));
// 旧写法反证：logSignal 必须被 phase 判据包住（函数体里 logSignal 出现在 phase 断言之后）
const iPhase = probBody.search(/S\.auction\.phase === 1/);
const iLog = probBody.search(/logSignal\('auczt'/);
ok('logSignal 调用排在 phase 判据之后（被窗口条件包住）', iPhase >= 0 && iLog > iPhase);
// 落库窗口与 auctionPhase 的 phase 1/2/3 边界同源：phase 定义里三段覆盖 09:15:00~09:29:59
const phBody = grab(/function auctionPhase\(d\) \{/);
ok('auctionPhase 三段边界 9:15/9:20/9:25 未动', /9 \* 3600 \+ 15 \* 60/.test(phBody) && /9 \* 3600 \+ 20 \* 60/.test(phBody) && /9 \* 3600 \+ 25 \* 60/.test(phBody));

// ④ 存量已标废：stats.json 里 auczt 非 void 样本 ts 必须全部落在 09:15~09:29
//    （两个闸门各司其职：时段闸管"抓不抓"，phase 1/2/3 管"落不落库"——
//     09:10 这类盘前抓取时段闸放行（刷面板有 pxSrc 标注），落库闸把守）
const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));
const aucLive = (st.signals || []).filter(s => s && s.type === 'auczt' && !s.void);
let offWin = 0, badTs = 0;
for (const s of aucLive) {
  if (!(s.ts > 0)) { badTs++; continue; }
  const t = new Date(s.ts);
  const sec = t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
  if (sec < 9 * 3600 + 15 * 60 || sec >= 9 * 3600 + 30 * 60) offWin++;
}
ok(`存量 auczt 非 void 样本 ${aucLive.length} 条 ts 全在真竞价窗口（09:15~09:29）`, offWin === 0, offWin + ' 条在窗口外');
ok('存量 auczt 样本 ts 无缺失', badTs === 0);
// ⛔⛔ hv+1 轮（2026-10-15）修时变性假红：原断言冻结绝对条数（aucLive.length === 179），
//    而 auczt 是**每个交易日 09:15~09:30 持续累积**的活数据 —— replica 一跑就 +N
//    （本次实测 179→195，总榜天天红，与 _test_trend_channel ①段同款「钉数字不钉语义」）。
//    正确语义是**动态**的：a) 工具流水(.offauction_ops.json)记录标了 N 条 → 当前 void
//    存量 ≥ N（void 只增不减：markNonTradeDaySamples 等自动标废只会叠加，不会回退）；
//    b) 线上发布包不带该流水文件，退回 hv 轮已知下限 205（随包 stats.json 就是标废后的版本）；
//    c) 非 void 存量 > 0（闸门没有把真竞价样本误标废——过度标废检测）。
const _opsLedger = (() => { try { const o = JSON.parse(fs.readFileSync(path.join(__dirname, '.offauction_ops.json'), 'utf8')); return Array.isArray(o) ? o[0] : o; } catch { return null; } })();
const _wroteN = Math.max(205, (_opsLedger && _opsLedger.wrote) || 0);
const aucVoid = (st.signals || []).filter(s => s && s.type === 'auczt' && s.void);
ok(`标废工具记录 ${_wroteN} 条 ≤ 当前 void 存量 ${aucVoid.length} 条（void 只增不减）`,
  aucVoid.length >= _wroteN, '记录=' + _wroteN + ' 存量=' + aucVoid.length);
ok('非 void 存量 > 0（闸门没把真竞价样本误标废）', aucLive.length > 0, '实际 ' + aucLive.length);

// ⑤ 一次性标废工具的判据与 inferZTProb 同一把尺子（文件存在 + 从 server.js 现提取 auctionPhase）
const toolSrc = fs.readFileSync(path.join(__dirname, '_void_offauction.js'), 'utf8');
ok('_void_offauction.js 从 server.js 现提取 auctionPhase（不另抄判据）', /function auctionPhase/.test(toolSrc) && /phaseOf/.test(toolSrc));
ok('_void_offauction.js 默认干跑 --write 才落盘', /process\.argv\.includes\('--write'\)/.test(toolSrc));
ok('_void_offauction.js 只动 auczt 一类', /s\.type !== 'auczt'/.test(toolSrc));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
