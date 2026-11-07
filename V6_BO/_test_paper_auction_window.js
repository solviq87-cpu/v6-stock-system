// 守门测试：模拟盘自动买卖只走【连续竞价】，排除集合竞价两段（2026-10-27）
// 背景：isTradingTime() 窗口是 09:15-11:30 || 13:00-15:00，把开盘竞价(9:15-9:25)、收盘竞价(14:57-15:00)
//   整个包进去了。paperBuy / paperCheckAll 两道自动成交闸门只判 isTradingTime → 开盘竞价阶段行情接口
//   吐出的是竞价撮合/指示价（常因低开跳空被瞬间拉低），paperCheck 拿失真价判止盈止损 → 频繁在竞价阶段卖票。
//   修复：新增 isContinuousTrading()（连续竞价 9:30-11:30 || 13:00-14:57），两道闸门单独收紧到它；
//   isTradingTime 不动（tick/similar/pre/补涨龙/竞价快照等 11 处靠它抓竞价数据）。
// 本测试钉死：① 竞价两段返回 false、连续竞价返回 true；② 两道闸门已切到 isContinuousTrading（非 isTradingTime）。
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const SRC = fs.readFileSync('server.js', 'utf8');

// ───────── 1. 抽出 isContinuousTrading 装进沙箱真跑 ─────────
const i0 = SRC.indexOf('const isContinuousTrading = () => {');
ok(i0 > 0, 'server.js 里存在 isContinuousTrading');
const i1 = SRC.indexOf('\n};\n', i0);
const fnSrc = SRC.slice(i0, i1 + 3);

let CTRL_MIN = 0;                 // 受控的「当天分钟数」，驱动 FakeDate
const FakeDate = function () {
  this.getHours = () => Math.floor(CTRL_MIN / 60);
  this.getMinutes = () => CTRL_MIN % 60;
  this.getDay = () => 2;          // 周三，保证 isTradeDay 桩返回 true 时确为交易日
};
FakeDate.now = () => Date.now();
const fakeTradeDay = () => true;   // 桩：恒为交易日，只考时间窗

const isContinuousTrading = new Function('isTradeDay', 'Date', fnSrc + '\n; return isContinuousTrading;')(fakeTradeDay, FakeDate);

const cases = [
  ['开盘竞价 9:20', 9 * 60 + 20, false],
  ['开盘竞价 9:25（仍未连续）', 9 * 60 + 25, false],
  ['连续竞价开盘 9:30', 9 * 60 + 30, true],
  ['连续竞价 10:00', 10 * 60 + 0, true],
  ['上午收盘 11:30（连续内）', 11 * 60 + 30, true],
  ['午休 12:00', 12 * 60 + 0, false],
  ['下午开盘 13:00', 13 * 60 + 0, true],
  ['下午连续 14:00', 14 * 60 + 0, true],
  ['收盘竞价前 14:57（连续内）', 14 * 60 + 57, true],
  ['收盘竞价 14:58（已排除）', 14 * 60 + 58, false],
  ['收盘 15:00（已排除）', 15 * 60 + 0, false],
];
for (const [label, min, expect] of cases) {
  CTRL_MIN = min;
  const got = isContinuousTrading();
  ok(got === expect, `${label} → ${got}（期望 ${expect}）`);
}

// 非交易日：isTradeDay 返回 false 时，任何时刻都 false
const isContinuousTradingNF = new Function('isTradeDay', 'Date', fnSrc + '\n; return isContinuousTrading;')(() => false, FakeDate);
CTRL_MIN = 10 * 60 + 0;
ok(isContinuousTradingNF() === false, '非交易日 → 任何时刻 false');

// ───────── 2. 两道自动成交闸门已切到 isContinuousTrading ─────────
const buyGate = SRC.indexOf('function paperBuy(');
const buyBody = SRC.slice(buyGate, SRC.indexOf('\n}\n', buyGate));
ok(/if \(!isContinuousTrading\(\)\) return;/.test(buyBody), 'paperBuy 闸门已用 isContinuousTrading（不再用 isTradingTime）');
ok(!/if \(!isTradingTime\(\)\) return;/.test(buyBody), 'paperBuy 内不再残留 isTradingTime 闸门');

const checkAllGate = SRC.indexOf('function paperCheckAll(');
const checkAllBody = SRC.slice(checkAllGate, SRC.indexOf('\n}\n', checkAllGate));
ok(/if \(!isContinuousTrading\(\)\) return;/.test(checkAllBody), 'paperCheckAll 闸门已用 isContinuousTrading（不再用 isTradingTime）');
ok(!/if \(!isTradingTime\(\)\) return;/.test(checkAllBody), 'paperCheckAll 内不再残留 isTradingTime 闸门');

// ───────── 2.5 paperSell 本体也过连续竞价闸（买卖同一道，防御到底） ─────────
const sellIdx = SRC.indexOf('function paperSell(');
ok(sellIdx > 0, 'server.js 里存在 paperSell');
const sellBody = SRC.slice(sellIdx, SRC.indexOf('\n}\n', sellIdx));
ok(/if \(!isContinuousTrading\(\)\) return;/.test(sellBody), 'paperSell 本体已用 isContinuousTrading（盘前/竞价/午休/收盘后一律不卖）');
ok(!/if \(!isTradingTime\(\)\) return;/.test(sellBody), 'paperSell 内未用更宽的 isTradingTime');

// ───────── 3. isTradingTime 仍保留（其他 11 处依赖） ─────────
ok(/const isTradingTime = \(\) =>/.test(SRC), 'isTradingTime 定义仍在（tick/similar/pre/补涨龙/竞价快照等仍依赖）');

console.log(`\n[paper_auction_window] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
