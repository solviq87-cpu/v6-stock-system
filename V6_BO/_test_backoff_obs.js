'use strict';
// 2026-10-27 自检守门：东财限流退避 / 三级源降级 / 并发去重 —— 原完全静默，本测试钉死三件事：
//   ① em.backoffStats() 接口契约（形状/类型/初始态，导出无误）
//   ② server.js runDataAccuracyMonitor 已接入 em.backoffStats（静态）
//   ③ 监控动态跑通：rates>0 报"累计触发 N 次"、rates=0 报"0 触发"、降级兜底行正确产出
const fs = require('fs');
const em = require('./em');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// ① 接口契约
ok('em.backoffStats 是函数且已导出', typeof em.backoffStats === 'function');
const s = em.backoffStats();
const keys = ['emRateTriggers', 'emRateLastAt', 'emRateCooldownLeft', 'emKlineDown', 'emKlineDownLeft',
  'boardBackoffFail', 'boardBackoffLeft', 'thsKlineDown', 'inflight'];
ok('返回含全部 9 个字段', keys.every(k => k in s), keys.filter(k => !(k in s)).join(','));
ok('emRateTriggers 为非负整数', Number.isInteger(s.emRateTriggers) && s.emRateTriggers >= 0);
ok('emKlineDown / thsKlineDown 为布尔', typeof s.emKlineDown === 'boolean' && typeof s.thsKlineDown === 'boolean');
ok('cooldown/left 字段为非负有限数', [s.emRateCooldownLeft, s.emKlineDownLeft, s.boardBackoffLeft].every(v => Number.isFinite(v) && v >= 0));
ok('inflight 为非负整数', Number.isInteger(s.inflight) && s.inflight >= 0);
ok('初始态 emRateTriggers=0（干净启动）', s.emRateTriggers === 0);

// ② server.js 静态接入
const SRC = fs.readFileSync('./server.js', 'utf8');
ok('runDataAccuracyMonitor 调用 em.backoffStats', /em\.backoffStats\(\)/.test(SRC));
ok('监控产出"东财限流退避"观测行', /东财限流退避本次运行/.test(SRC));
ok('监控产出"三级源降级兜底"观测行', /三级源\(东财\/同花顺\/腾讯\)主源均在线/.test(SRC));
ok('监控用 typeof 守卫避免 em 未定义崩溃', /typeof em\.backoffStats === 'function'/.test(SRC));
// ⛔ 2026-10-28 补：当日行守卫的战果与失效都必须可观测 —— le 轮把处置从「丢弃」改成「按快照重建」后，
//    只看 dropped 等于把正常工作路径整个隐身；而「无今日快照 → 守卫失效」旧写法一行不留。
ok('监控把守卫重建战果（rebuilt）曝光', /if \(dg\.rebuilt\) ok\(/.test(SRC));
ok('监控把守卫失效（noSnap：无今日收盘快照）曝光成告警', /if \(dg\.noSnap\) warn\(/.test(SRC));

// ③ 动态：切出 runDataAccuracyMonitor，塞可控 em 桩
function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j + end.length);
}
const code = [grab('const todayStr = () => {', '\n};\n'),
  grab('function dataStaleItems() {', '\n}\n'),
  // ⛔ ms 轮教训复用：原来靠 grab('let _dataAccDay =', '\n}\n') 一路吞到下一个顶层 }，
  //    并行空间在两函数间插入 expectedReportSeason 后就捞不到 runDataAccuracyMonitor →
  //    ReferenceError 整个套件崩溃。改为按函数名逐个显式抓。
  'let _dataAccDay = "";',
  grab('function expectedReportSeason(t) {', '\n}\n'),
  grab('function runDataAccuracyMonitor() {', '\n}\n')].join('\n');

let TRADE_DAY = true;
function isTradeDay() { return TRADE_DAY === true; }
function runWith(bsStub) {
  const S = {};
  const A = { limitPctOf: () => 10 };
  const logs = [];
  const pushLog = (tag, line) => logs.push({ tag, line });
  const emStub = { backoffStats: () => bsStub, dayGuardStats: () => ({ dropped: 0, rebuilt: 0, adjMismatch: 0, noSnap: 0 }) };
  const api = new Function('S', 'A', 'isTradeDay', 'pushLog', 'em',
    code + '\nfunction resetDataAccDay(){ _dataAccDay = ""; }\nreturn { runDataAccuracyMonitor, resetDataAccDay, todayStr };')(S, A, isTradeDay, pushLog, emStub);
  S.stocks = Array.from({ length: 5000 }, (_, i) => ({ code: String(600000 + i).padStart(6, '0'), name: 'T' + i, price: 10, pct: 1 }));
  S.ztPool = S.stocks.slice(0, 5).map(z => ({ code: z.code, name: z.name }));
  const TODAY = api.todayStr();
  S.ztDay = TODAY; S.sectorsDay = TODAY;
  S.klines = new Map();
  for (const z of S.ztPool) S.klines.set(z.code, { rows: [{ date: TODAY.slice(0, 4) + '-' + TODAY.slice(4, 6) + '-' + TODAY.slice(6, 8), close: 10 }] });
  logs.length = 0; api.resetDataAccDay(); api.runDataAccuracyMonitor();
  return logs;
}
const base = { emRateTriggers: 0, emRateLastAt: 0, emRateCooldownLeft: 0, emKlineDown: false, emKlineDownLeft: 0, boardBackoffFail: 0, boardBackoffLeft: 0, thsKlineDown: false, inflight: 0 };

let logs = runWith({ ...base, emRateTriggers: 7, emRateLastAt: Date.now() - 3 * 60000 });
ok('rates>0 报"累计触发 7 次"', logs.some(l => /东财限流退避本次运行累计触发 7 次/.test(l.line)));
ok('rates>0 不报"0 触发"', !logs.some(l => /本次运行 0 触发/.test(l.line)));

logs = runWith({ ...base });
ok('rates=0 报"0 触发（IP 健康）"', logs.some(l => /东财限流退避本次运行 0 触发/.test(l.line)));
ok('rates=0 报"三级源主源均在线"', logs.some(l => /三级源\(东财\/同花顺\/腾讯\)主源均在线/.test(l.line)));

logs = runWith({ ...base, emKlineDown: true, thsKlineDown: true, boardBackoffLeft: 90000, emRateTriggers: 3, emRateLastAt: Date.now() });
ok('降级兜底行含"东财K线已熔断切腾讯"', logs.some(l => /东财K线已熔断切腾讯/.test(l.line)));
ok('降级兜底行含"同花顺K线已熔断"', logs.some(l => /同花顺K线已熔断/.test(l.line)));
ok('降级兜底行含"板块成分退避中"', logs.some(l => /板块成分退避中\(90s\)/.test(l.line)));

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
