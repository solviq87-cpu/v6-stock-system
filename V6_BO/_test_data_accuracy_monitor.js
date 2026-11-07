'use strict';
// jy 轮守门 #327：数据准确性常态化监控——runDataAccuracyMonitor 能识别全A数量异常、
//   涨停池漏票、K线陈旧、模块归属日落后，并写入 push-log。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');

function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j + end.length);
}

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name); }
}

// 静态检查
ok('runDataAccuracyMonitor 函数存在', /function runDataAccuracyMonitor\(\)/.test(SRC));
ok('监控检查全A快照数量', /全A快照数量/.test(SRC));
ok('监控检查涨停池漏票', /涨停池疑似漏票/.test(SRC));
ok('监控检查 K线缓存新鲜度', /K线缓存陈旧/.test(SRC));
ok('在可信度自检定时器内调用', /runDataAccuracyMonitor\(\)/.test(SRC));

// 真跑：切出 dataStaleItems + runDataAccuracyMonitor
const parts = [
  grab('const todayStr = () => {', '\n};\n'),
  grab('function dataStaleItems() {', '\n}\n'),
  'let _dataAccDay = "";',                        // ms 轮：原写法靠它一路吞到 runDataAccuracyMonitor，
                                                  // 两函数间被并行空间插入 expectedReportSeason 后就捞不到了（ReferenceError）
  grab('function expectedReportSeason(t) {', '\n}\n'),
  grab('function runDataAccuracyMonitor() {', '\n}\n'),   // ⛔ 按函数名显式抓，别再依赖相邻关系
];
const code = parts.join('\n');

const S = {};
const A = {
  limitPctOf: () => 10,
  hasNoLimit: () => false,   // ⛔ 2026-10-28：巡检②用 A.hasNoLimit 排除新股无涨跌幅限制期
  // ⛔⛔ 2026-10-28 mq 轮：巡检②的判据换成 A.sealedAtLimit（严口径：收盘贴住涨停价）。
  //   沙箱必须把**真实实现**注入 —— 缺依赖会让 TypeError 被函数内 catch 吞成「漏票检查失败」，
  //   断言随即假红（本项目踩过多次的「沙箱缺模块级依赖」坑，修尺子时一律钉语义+留反证）。
  //   ⛔ 不手写复刻：复刻就是第二把尺子，迟早分叉。
  sealedAtLimit: require('./analysis.js').sealedAtLimit,
  // ⛔ 2026-10-28：巡检②新增「退市整理期股不计入涨停家数」闸门（A.countsInZtTally）——
  //   同一把尺子，同样注入真实实现。缺它 → TypeError 被 catch 吞成「漏票检查失败」→ 断言假红。
  countsInZtTally: require('./analysis.js').countsInZtTally,
};
const logs = [];
function pushLog(tag, line, meta) { logs.push({ tag, line, meta }); }
// ⛔ kv 轮（2026-10-24）：原写法用真实星期判交易日（`getDay()>=1 && <=5`），于是「周六/周日跑测试」时
//    runDataAccuracyMonitor 首行 `if (!isTradeDay(new Date())) return;` 直接返回 → 5 条断言全红。
//    那是**测试自身的日期依赖**，不是生产 bug（生产在休市日本就不该巡检）。
//    改为测试可控开关：交易日/休市日两种场景都钉住，跑到哪天结果都一致。
let TRADE_DAY = true;
function isTradeDay(d) { return TRADE_DAY === true; }

const api = new Function('S', 'A', 'isTradeDay', 'pushLog',
  code + '\nfunction resetDataAccDay(){ _dataAccDay = ""; }\nreturn { dataStaleItems, runDataAccuracyMonitor, resetDataAccDay, todayStr };')(S, A, isTradeDay, pushLog);

// ⛔ kv 轮：原测试把「正常情况」的归属日写死成 20261023 —— 到了 10-24 它天然"落后一天"，
//    于是「✅ 归属日无落后」变成硬编码过期导致的假红（生产没错，是夹具没跟日期走）。
//    现在正常场景取「今天」、异常场景取「昨天」，跑到哪天都成立。
const TODAY = api.todayStr();
const YDAY = (() => {
  const y = TODAY.slice(0, 4), m = +TODAY.slice(4, 6) - 1, d = +TODAY.slice(6, 8);
  const t = new Date(+y, m, d); t.setDate(t.getDate() - 1);
  const p = (n) => String(n).padStart(2, '0');
  return '' + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate());
})();

// ① 正常情况
S.stocks = Array.from({ length: 5000 }, (_, i) => ({ code: String(600000 + i).padStart(6, '0'), name: 'T' + i, price: 10, preClose: 10, high: 10, low: 9.9, open: 9.95, pct: 0 }));
S.ztPool = S.stocks.slice(0, 5).map(s => ({ code: s.code, name: s.name }));
S.ztDay = TODAY;
S.sectorsDay = TODAY;
S.klines = new Map();
for (const z of S.ztPool) {
  S.klines.set(z.code, { rows: [{ date: TODAY.slice(0,4) + '-' + TODAY.slice(4,6) + '-' + TODAY.slice(6,8), close: 10 }] });
}
logs.length = 0;
api.resetDataAccDay();
api.runDataAccuracyMonitor();
ok('正常情况写入 pushLog', logs.length > 0);
ok('正常情况有 ✅ 全A数量', logs.some(l => /全A快照数量.*在合理区间/.test(l.line)));
ok('正常情况有 ✅ 涨停池一致', logs.some(l => /涨停池与快照涨幅口径一致/.test(l.line)));
ok('正常情况有 ✅ K线新鲜', logs.some(l => /K线缓存新鲜/.test(l.line)));
ok('正常情况有 ✅ 归属日无落后', logs.some(l => /各模块归属日无落后/.test(l.line)));

// ② 异常情况：全A过少 + 漏票 + K线陈旧 + 归属日落后
S.stocks = Array.from({ length: 100 }, (_, i) => ({ code: String(600000 + i).padStart(6, '0'), name: 'T' + i, price: 11, preClose: 10, high: 11, low: 10.5, open: 10.6, pct: 10 })); // 全部封在涨停价 11.00，但只前5只在 ztPool
S.ztPool = S.stocks.slice(0, 5).map(s => ({ code: s.code, name: s.name }));
S.ztDay = YDAY;
S.sectorsDay = YDAY;
S.klines = new Map();
for (const z of S.ztPool) {
  S.klines.set(z.code, { rows: [{ date: YDAY.slice(0,4) + '-' + YDAY.slice(4,6) + '-' + YDAY.slice(6,8), close: 10 }] });
}
logs.length = 0;
api.resetDataAccDay();
api.runDataAccuracyMonitor();
ok('异常情况发现全A数量异常', logs.some(l => /全A快照数量.*明显低于常态/.test(l.line)));
ok('异常情况发现涨停池漏票', logs.some(l => /涨停池疑似漏票/.test(l.line)));
ok('异常情况发现 K线陈旧', logs.some(l => /K线缓存陈旧/.test(l.line)));
ok('异常情况发现归属日落后', logs.some(l => /模块归属日落后/.test(l.line)));

// ③ 休市日：不巡检（⛔ 休市不是"数据新鲜"，拿休市当通过才是事故）
//    kv 轮补：以前这条靠"今天是周几"偶然成立，周六跑就假红；现在显式钉两种场景。
S.stocks = Array.from({ length: 5000 }, (_, i) => ({ code: String(600000 + i).padStart(6, '0'), name: 'T' + i, price: 10, preClose: 10, high: 10, low: 9.9, open: 9.95, pct: 0 }));
S.ztDay = TODAY;
S.sectorsDay = TODAY;
logs.length = 0;
api.resetDataAccDay();
TRADE_DAY = false;
api.runDataAccuracyMonitor();
ok('休市日不巡检（0 条日志，既不误报也不拿"没查"当干净）', logs.length === 0, String(logs.length));
TRADE_DAY = true;
logs.length = 0;
api.resetDataAccDay();
api.runDataAccuracyMonitor();
ok('⛔ 反证：同一份数据在交易日必须出巡检日志（休市分支不许吃掉正常路径）', logs.length > 0, String(logs.length));

// ④ 漏票判据两处口径（⛔ 2026-10-28 mq 轮）：
//    a) 严口径：收盘必须贴住涨停价（A.sealedAtLimit）。触板未封（最高 11.00、收 10.99）不是漏票，
//       旧写法「涨幅 ≥ 限幅-0.05」天天把它报出来 —— 10-28 603699 纽威股份 实况（收 38.39 / 板 38.40）。
//    b) 新股无涨跌幅限制期：封在 10% 价位也不算涨停，不许报漏票（保住 2026-10-28 早先修的那道闸）。
{
  const mk = () => Array.from({ length: 5000 }, (_, i) => ({ code: String(600000 + i).padStart(6, '0'), name: 'T' + i, price: 10, preClose: 10, high: 10, low: 9.9, open: 9.95, pct: 0 }));
  const dstr = d => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  const setup = (row, noLimitCodes) => {
    S.stocks = mk();
    S.stocks[0] = row;
    S.ztPool = S.stocks.slice(1, 6).map(s => ({ code: s.code, name: s.name }));   // 池里没有它
    S.ztDay = TODAY; S.sectorsDay = TODAY;
    S.klines = new Map();
    for (const z of S.ztPool) S.klines.set(z.code, { rows: [{ date: dstr(TODAY), close: 10 }] });
    A.hasNoLimit = c => (noLimitCodes || []).includes(String(c));
    logs.length = 0; api.resetDataAccDay(); api.runDataAccuracyMonitor();
  };
  // a) 触板未封：pct 9.9 已过「限幅-0.05」，旧口径必报 → 新口径不许报
  setup({ code: '600998', name: '触板未封', price: 10.99, preClose: 10, high: 11.00, low: 10.5, open: 10.6, pct: 9.9 }, []);
  ok('触板未封（收 10.99 / 涨停价 11.00）不报漏票', !logs.some(l => /涨停池疑似漏票/.test(l.line)),
    logs.filter(l => /漏票/.test(l.line)).map(l => l.line).join(' | '));
  // 反证：同一只票真封在 11.00 → 必须报
  setup({ code: '600998', name: '真封板', price: 11, preClose: 10, high: 11, low: 10.5, open: 10.6, pct: 10 }, []);
  ok('⛔ 反证：收在 11.00（涨停价）必须报漏票（严口径没把判据整体关掉）', logs.some(l => /涨停池疑似漏票/.test(l.line)));
  // b) 新股无限制期：同一行价格 11.00，但属无涨跌幅限制期 → 不报
  setup({ code: '600999', name: '新股N', price: 11, preClose: 10, high: 11, low: 10.6, open: 10.7, pct: 10 }, ['600999']);
  ok('新股无涨跌幅限制期不报漏票', !logs.some(l => /涨停池疑似漏票/.test(l.line)));
  setup({ code: '600999', name: '新股N', price: 11, preClose: 10, high: 11, low: 10.6, open: 10.7, pct: 10 }, []);
  ok('⛔ 反证：同票在有限制期必须报漏票（新股闸门没被严口径顶掉）', logs.some(l => /涨停池疑似漏票/.test(l.line)));
  A.hasNoLimit = () => false;
}

// ④b 退市整理期股不计入涨停家数（⛔ 2026-10-28 用户定调「不计入」）：它们封板也不进池，
//    巡检不许天天报「疑似漏票」——但绝不能顺手把判据整体关掉，所以留一条反证（改名后必须报）。
{
  const mk = () => Array.from({ length: 5000 }, (_, i) => ({ code: String(600000 + i).padStart(6, '0'), name: 'T' + i, price: 10, preClose: 10, high: 10, low: 9.9, open: 9.95, pct: 0 }));
  const dstr = d => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  const setup = row => {
    S.stocks = mk();
    S.stocks[0] = row;
    S.ztPool = S.stocks.slice(1, 6).map(s => ({ code: s.code, name: s.name }));
    S.ztDay = TODAY; S.sectorsDay = TODAY;
    S.klines = new Map();
    for (const z of S.ztPool) S.klines.set(z.code, { rows: [{ date: dstr(TODAY), close: 10 }] });
    A.hasNoLimit = () => false;
    logs.length = 0; api.resetDataAccDay(); api.runDataAccuracyMonitor();
  };
  const row = (name) => ({ code: '002731', name, price: 0.28, preClose: 0.25, high: 0.28, low: 0.24, open: 0.25, pct: 12 });
  setup(row('萃华退'));
  ok('退市整理期股（真封板、不在池里）不报漏票 —— 不计家数是设计如此', !logs.some(l => /涨停池疑似漏票/.test(l.line)),
    logs.filter(l => /漏票/.test(l.line)).map(l => l.line).join(' | '));
  setup(row('萃华珠宝'));
  ok('⛔ 反证：同价同代码、名字去掉「退」→ 必须报漏票（判据没被整体关掉）', logs.some(l => /涨停池疑似漏票/.test(l.line)));
}

// ⑤ 涨停池为空时 K线新鲜度必须显式说「判不出」（⛔ 2026-10-28 补：旧写法三个分支全不进、一行不留，
//    看报告的人无法区分「K线全新鲜」与「压根没抽样」）
{
  S.stocks = Array.from({ length: 5000 }, (_, i) => ({ code: String(600000 + i).padStart(6, '0'), name: 'T' + i, price: 10, pct: 1 }));
  S.ztPool = []; S.ztDay = TODAY; S.sectorsDay = TODAY; S.klines = new Map();
  logs.length = 0; api.resetDataAccDay(); api.runDataAccuracyMonitor();
  ok('涨停池为空时 K线新鲜度显式报「判不出」而非静默跳过', logs.some(l => /K线新鲜度无法抽样/.test(l.line)), logs.map(l => l.line).join(' | '));
}

console.log(`\n──── 结果：${passed} 通过 / ${failed} 失败 ────\n`);
process.exit(failed ? 1 : 0);
