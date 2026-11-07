// 守门测试：#232 非交易日幽灵信号（2026-10-15 hu 轮）
//
// 事故还原：2026 国庆 10-01 01:38 服务启动，启动链里的 captureAuction 没有交易日闸，
//   拿 09-30 的陈旧快照冒充"当日竞价"，落了一批 date=节假日的样本 —— 实测 156 条
//   （auczt 64 + pool 57 + buzhang 12 + similar 8 + zt 6 + trend 5 + bigmoney 4），
//   其中 152 条还被张冠李戴"回验"成节后首个交易日的结局。而存量迁移只判周末
//   （getDay 0/6）且跳过 resolved → 这 156 条永久留在命中率分母里，自学习越学越偏。
//
// 本轮钉三件事：
//   ① markNonTradeDaySamples：判据=isTradeDay（法定假日+周末全覆盖），且不看 resolved
//      （非交易日登记的样本，"回验"本身也是错位的，标废与它有没有 resolved 无关）
//   ② auctionCaptureAllowed：非交易日 captureAuction 直接跳过（源头不再造幽灵）
//   ③ 迁移调用点必须在 isTradeDay 定义之后 —— isTradeDay 函数体读后置 const MARKET_HOLIDAYS，
//      模块初始化期调用会撞 TDZ（hi 轮同款坑：ReferenceError 被 catch 吞→迁移静默失效）
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

// 常量对齐：直接从 server.js 抓真表，不许测试里另抄一份（抄了就测不到表被改）
const holSrc = (src.match(/const MARKET_HOLIDAYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
const wdSrc = (src.match(/const MARKET_WORKDAYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
if (!holSrc || !wdSrc) { console.log('  ❌ 抓不到 MARKET_HOLIDAYS/MARKET_WORKDAYS 常量'); process.exit(1); }
const HOL = new Function(holSrc + '\nreturn MARKET_HOLIDAYS;')();
const mkIsTradeDay = () => new Function('now', [
  'const holidayTableWarn = () => {};',   // 打桩：表过期告警与判据无关
  wdSrc, holSrc,
  grab(/function isTradeDay\(d\) \{/),
  'return isTradeDay(now);'
].join('\n'));

const mkAllowed = () => new Function([
  'const holidayTableWarn = () => {};',
  wdSrc, holSrc,
  grab(/function isTradeDay\(d\) \{/),
  grab(/function auctionCaptureAllowed\(now\) \{/),
  'return auctionCaptureAllowed;'
].join('\n'))();
const mkMark = () => new Function([
  'const holidayTableWarn = () => {};',
  wdSrc, holSrc,
  grab(/function isTradeDay\(d\) \{/),
  grab(/function markNonTradeDaySamples\(sigs\) \{/),
  'return markNonTradeDaySamples;'
].join('\n'))();

console.log('\n=== #232 非交易日幽灵信号守门 ===\n');

// ① isTradeDay 常量对齐：2026 国庆 7 天全在表里（10/8 起照常开市）
let holOk = true;
for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']) {
  if (!HOL.has(d)) { holOk = false; console.log('   缺 ' + d); }
}
ok('MARKET_HOLIDAYS 含 2026 国庆 10-01~10-07', holOk);
ok('MARKET_HOLIDAYS 不含 10-08（节后首个交易日）', !HOL.has('2026-10-08'));
const isTrade = mkIsTradeDay();
ok('isTradeDay(10-08 周四)=true', isTrade(new Date(2026, 9, 8)) === true);
ok('isTradeDay(10-01 周四·法定假日)=false', isTrade(new Date(2026, 9, 1)) === false);
ok('isTradeDay(10-10 周六·补班日但交易所休市)=false', isTrade(new Date(2026, 9, 10)) === false);

// ② auctionCaptureAllowed 语义（源头闸门）
const allowed = mkAllowed();
ok('交易日(10-08 周四 9:20)允许重算竞价', allowed(new Date(2026, 9, 8, 9, 20)) === true);
ok('交易日(09-30 周三 9:20)允许重算竞价', allowed(new Date(2026, 8, 30, 9, 20)) === true);
ok('法定假日工作日(10-01 周四 1:38)跳过', allowed(new Date(2026, 9, 1, 1, 38)) === false);
ok('法定假日工作日(10-02 周五)跳过', allowed(new Date(2026, 9, 2, 9, 20)) === false);
ok('法定假日工作日(10-05 周一)跳过', allowed(new Date(2026, 9, 5, 9, 20)) === false);
ok('法定假日工作日(10-06 周二)跳过', allowed(new Date(2026, 9, 6, 9, 20)) === false);
ok('周六(10-10)跳过', allowed(new Date(2026, 9, 10, 9, 20)) === false);
ok('周日(10-11)跳过', allowed(new Date(2026, 9, 11, 9, 20)) === false);
ok('无参调用返回布尔（取当前时间，不崩）', typeof allowed() === 'boolean');

// ③ captureAuction 函数体确实带闸（防有人删掉调用）
const capBody = grab(/async function captureAuction\(force\) \{/);
ok('captureAuction 函数体调用 auctionCaptureAllowed（源头闸门在）', /auctionCaptureAllowed\(\)/.test(capBody));

// ④ markNonTradeDaySamples 语义（存量自愈）
const mark = mkMark();
const sig = (date, extra) => Object.assign({ type: 'auczt', date, code: '600000', price: 10 }, extra);
let arr;
arr = [sig('20261001'), sig('20261002'), sig('20261005'), sig('20261006')];
let n = mark(arr);
ok('国庆 4 个"工作日"假日的样本全部标废', arr.every(s => s.void === true) && n === 4);
arr = [sig('20261003'), sig('20261004'), sig('20261010')];   // 周六/周日（旧逻辑就覆盖的）
n = mark(arr);
ok('周末样本标废（不回归旧行为）', arr.every(s => s.void === true) && n === 3);
arr = [sig('20260930'), sig('20261008'), sig('20261009')];   // 真交易日
n = mark(arr);
ok('真交易日样本不动', arr.every(s => s.void !== true) && n === 0);
arr = [sig('20261001', { resolved: { date: '2026-10-08', nextPct: 1.85, hit: true } })];
n = mark(arr);
ok('已 resolved 的假日样本照样标废（回验本身错位）', arr[0].void === true && n === 1);
arr = [sig('20261001'), sig('20261001')];
n = mark(arr);
const n2 = mark(arr);
ok('重跑幂等（第一次 2、第二次 0）', n === 2 && n2 === 0);
arr = [{ date: '', type: 'x' }, { type: 'x' }, { date: '2026-10-0', type: 'x' }, { date: null, type: 'x' }];
n = mark(arr);
ok('date 缺失/畸形的样本跳过不崩', n === 0 && arr.every(s => s.void !== true));
arr = [sig(20261001)];   // 数字日期：String() 归一后仍是合法 8 位且是节假日
n = mark(arr);
ok('数字日期按字面含义处理（20261001=节假日→标废）', n === 1 && arr[0].void === true);
ok('入参 null 返回 0 不崩', mark(null) === 0);
ok('入参 undefined 返回 0 不崩', mark(undefined) === 0);
arr = [sig('20261001'), sig('20261008'), sig('20261012', { void: true })];
n = mark(arr);
ok('混合批次只标非交易日且不重复计已 void', n === 1 && arr[0].void === true && arr[1].void !== true);

// ⑤ 结构断言：迁移调用点必须在 isTradeDay 定义之后（TDZ 防回归，hi 轮同款坑）
const iDef = src.indexOf('function isTradeDay(');
const iCall = src.indexOf('markNonTradeDaySamples(S.learn.signals)');
ok('迁移调用点存在', iCall >= 0);
ok('迁移调用点在 isTradeDay 定义之后（TDZ 防回归）', iDef >= 0 && iCall > iDef);
const markBody = grab(/function markNonTradeDaySamples\(sigs\) \{/);
ok('markNonTradeDaySamples 不看 resolved（旧条件已去除）', !/s\.resolved/.test(markBody));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
