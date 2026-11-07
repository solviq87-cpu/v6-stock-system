// 止盈分级单测：验证「越过止盈线不打扰 / 回撤3%提醒一次 / 回撤≥5%每30分钟」
// 直接调 verdict，不发任何真实推送。
const fs = require('fs'), path = require('path');
const HD = require('./holdings.js')({
  fs, path, dir: __dirname,
  S: { klines: new Map(), stocks: [], news: { badCodes: new Set() } },
  em: {}, sseSend() {}, sseSendEdit() {}, pushAll() {}
});

// 造一条持仓：成本 10，现价用 snap 传入
const HOLD = HD.raw;
HOLD.items = [{ code: '000001', name: '测试', cost: 10, shares: 1000, tags: [], locked: false }];
HOLD.takePct = 15;   // 止盈线 15%

// 近10日高点 20（第 5 根），其余都很低
const mkRows = hi => Array.from({ length: 10 }, (_, i) => ({ open: 12, close: 12, high: i === 5 ? hi : 12, low: 12 }));

function run(label, price) {
  const v = HD.verdict('000001', { price, pct: 0, name: '测试', mainInflow: 0 }, mkRows(20), { positionPct: null });
  const types = v.acts.map(a => `${a.type}${a.urgent ? '(urgent)' : ''}${a.once ? '(once)' : ''}${a.quiet ? '(quiet)' : ''}`);
  const dd = v.drawdown;
  console.log(`${label}\n  现价 ${price} | 回撤 ${dd}% | 等级 ${v.level}\n  建议: ${types.join(' , ') || '无'}`);
  const take = v.acts.find(a => a.type === '止盈');
  const ddAct = v.acts.find(a => a.type === '回撤提醒' || a.type === '回撤止盈');
  return { v, take, ddAct, dd };
}

console.log('止盈线 15%（成本10 → 15% = 11.5），近10日高点 20\n');

// ⛔ 2026-10-07 补：以前这些 ✅ / ❌ 只是**打印**出来的，没人统计 —— 全量总榜数不到任何标记，
//    按 0 断言计还不标红，等于这个脚本跑了多少年都没进过回归。现在统一走 ok() 并给出汇总行。
let P = 0, F = 0;
function ok(name, cond, note) {
  if (cond) P++; else F++;
  console.log((cond ? '✅ ' : '❌ ') + name + (note ? '  ' + note : ''));
}

let r;
// ① 浮盈 20%（价12）越过止盈线，但没有回撤（相对高点20是-40%？不对，价12本来就低于高点20）
//    注意：回撤是相对高点算的，价12 距高点20 回撤40% → 会触发回撤！改用低点场景
r = run('① 浮盈20%（价12，未回撤，高点=现价）', 12);
console.log('   期望: 只有「止盈」且 quiet（不推手机）\n');

// 重新造：高点 = 现价（无回撤）
HOLD.items[0].cost = 10;
function runAt(label, price, hi) {
  const v = HD.verdict('000001', { price, pct: 0, name: '测试', mainInflow: 0 }, mkRows(hi), { positionPct: null });
  const types = v.acts.map(a => `${a.type}${a.urgent ? '(urgent)' : ''}${a.once ? '(once)' : ''}${a.quiet ? '(quiet)' : ''}`);
  console.log(`${label}\n  现价 ${price} | 高点 ${hi} | 回撤 ${v.drawdown}% | 等级 ${v.level}\n  建议: ${types.join(' , ') || '无'}`);
  return v;
}
console.log('--- 正确场景：高点就是当前价（回撤 0） ---');
let v1 = runAt('② 浮盈20%（价12，高点12，回撤0）', 12, 12);
const t1 = v1.acts.find(a => a.type === '止盈');
ok('止盈 urgent + once（会推手机，且只推一次）', !!(t1 && t1.urgent && t1.once),
  `urgent=${!!(t1 && t1.urgent)} once=${!!(t1 && t1.once)}`);
ok('无回撤提醒（高点=现价时回撤为 0）', !v1.acts.some(a => a.type.startsWith('回撤')));
ok('卡片等级不标黄（赚钱的票仍是绿的）', v1.level === 'ok', 'level=' + v1.level);

console.log('--- 互斥检查：已回撤时不再重复推「止盈」（避免一票两条）---');
let v1b = runAt('②b 浮盈23%（价12.3，高点12.7，回撤3.1%）', 12.3, 12.7);
const hasBoth = v1b.acts.some(a => a.type === '止盈') && v1b.acts.some(a => a.type.startsWith('回撤'));
ok('⛔ 已回撤时不再重复推「止盈」（一票只一条）', !hasBoth);
ok('回撤 3% 时确实出了回撤类建议', v1b.acts.some(a => a.type.startsWith('回撤')));

console.log('--- 回撤 3%（应：once 一次提醒）---');
let v2 = runAt('③ 浮盈23%（价12.3，高点12.7，回撤≈3.1%）', 12.3, 12.7);
const d2 = v2.acts.find(a => a.type === '回撤提醒');
ok('回撤约 3% → 回撤提醒 once + urgent（只提醒一次）', !!(d2 && d2.once && d2.urgent),
  `once=${!!(d2 && d2.once)} urgent=${!!(d2 && d2.urgent)}`);

console.log('--- 回撤 5%（应：每30分钟重复提醒）---');
let v3 = runAt('④ 浮盈14%（价11.4，高点12，回撤5%）', 11.4, 12);
const d3 = v3.acts.find(a => a.type === '回撤止盈');
ok('回撤 5% → 回撤止盈非 once 且 urgent（每 30 分钟重复提醒）', !!(d3 && !d3.once && d3.urgent),
  `once=${!!(d3 && d3.once)} urgent=${!!(d3 && d3.urgent)}`);

console.log('--- 亏损时不应提示止盈回撤 ---');
HOLD.items[0].cost = 15;   // 现价低于成本 = 浮亏
let v4 = runAt('⑤ 浮亏（价12，成本15，高点20回撤40%）', 12, 20);
ok('⛔ 浮亏时不提示回撤类建议（已正确抑制）', !v4.acts.some(a => a.type.startsWith('回撤')));

console.log(`\n结果：${P} 通过 / ${F} 失败`);
process.exit(F ? 1 : 0);
