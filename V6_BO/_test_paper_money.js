// 守门测试：模拟盘「钱的逻辑」不许再错（2026-10-06 体检修的两处真 bug）
// ① 买入预算漏扣手续费 → 现金能被买成负数（面板出现"剩余现金 -5 元"）：
//    旧式 budget = min(cash, equity/maxPos*0.98) 最多就等于现金，A 股整手取整后 cost 常常
//    正好等于 budget（现金 1000、股价 10 → 100 股 = 1000 元整），再减 5 元最低佣金 → 现金 -5。
// ② 收益联动止损是条死分支：linkedStop(cfg, profit) 用【当前收益】当锚，返回值恒为
//    profit - tp*0.4 < profit，而判定是 profit <= 返回值 → **恒 false**，保护线从来没生效过。
//    修法：锚换成【收益峰值 pos.peak】。
// 不依赖网络：直接从 server.js 源码抓出这两段原样跑。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

function grabBlock(startStr, endStr) {
  const a = src.indexOf(startStr), b = src.indexOf(endStr, a);
  if (a < 0 || b < 0) throw new Error('找不到块：' + startStr);
  return src.slice(a, b + endStr.length);
}
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}

console.log('\n=== 模拟盘资金/止损守门 ===\n');

// ---------- ① 源码结构：锚必须是 peak，不能是 profit ----------
console.log('【① 收益联动止损：锚点】');
ok('linkedStop 形参名为 peak（不再吃当前收益）', /function linkedStop\(cfg, peak/.test(src));
// gq 轮 Y7：第三参 baseStop（ATR 动态放宽后的基础止损线，缺省 cfg.sl）——
//   语义仍是「锚是峰值不是当前收益」，peak 必须出现在第二位
ok('paperCheck 传的是 pos.peak（+ATR 基础线）', /const stop = linkedStop\(cfg, pos\.peak, effStopOf\(cfg, pos\.code, price\)\);/.test(src));
// 只看真代码：server.js 的 APP_VER 版本说明和函数头注释里都会提到旧写法，按行删注释会误伤
// （本测试第一版就是这么红的），必须用 _codescan 的 stripNoise 把注释/字符串/正则整体涂掉。
const { stripNoise } = require('./_codescan');
const srcCode = stripNoise(src);
ok('没有残留 linkedStop(cfg, profit) 死分支', !/linkedStop\(cfg,\s*profit\)/.test(srcCode));
ok('判定改为 profit <= stop（不是拿返回值现算）', /else if \(profit <= stop\) paperSell/.test(src));
ok('买入时初始化 peak: 0', /peak: 0,/.test(src));
ok('巡检时峰值只上不下', /if \(profit > pos\.peak\) pos\.peak = profit;/.test(src));
ok('peak 非数字时兜底为 0', /if \(!Number\.isFinite\(pos\.peak\)\) pos\.peak = 0;/.test(src));
ok('卖出理由带峰值（面板能看懂为什么在这里卖）', /峰值\$\{\(pos\.peak \* 100\)\.toFixed\(1\)\}%.{0,40}现收益/.test(src));

// ---------- ② linkedStop 行为 ----------
console.log('\n【② linkedStop 数值行为】');
const SRC_LINKED = grab(/^function linkedStop\(cfg, peak, baseStop\) \{/m);
// ⚠️ 不能直接 eval 成逗号表达式：外层 const linkedStop 还在 TDZ，直接 eval 会撞
//    "Cannot access 'linkedStop' before initialization"。用 new Function 包一层就没事。
const linkedStop = new Function(SRC_LINKED + '\n; return linkedStop;')();
const CFG = { tp: 0.08, sl: -0.03 }; // A·跟单盘
ok('peak=0.07（≥75%止盈位）→ 保护线 0.038（回吐一个身位就走）', Math.abs(linkedStop(CFG, 0.07) - 0.038) < 1e-9, '实际 ' + linkedStop(CFG, 0.07));
ok('peak=0.05（≥50%止盈位）→ 保本 +0.5%', linkedStop(CFG, 0.05) === 0.005, '实际 ' + linkedStop(CFG, 0.05));
ok('peak=0.01（没涨到一半）→ 固定止损 -3%', linkedStop(CFG, 0.01) === -0.03, '实际 ' + linkedStop(CFG, 0.01));
ok('peak=undefined/NaN → 退到固定止损，不得抛错', linkedStop(CFG, undefined) === -0.03 && linkedStop(CFG, NaN) === -0.03);
ok('峰值越高保护线越高（单调递增）', linkedStop(CFG, 0.09) > linkedStop(CFG, 0.07) && linkedStop(CFG, 0.07) > linkedStop(CFG, 0.05));

// ---------- ③ 移动止损真的会触发（旧写法恒不触发） ----------
console.log('\n【③ 移动止损触发场景】');
// 场景：涨到 7%（peak=0.07）后回落
const stopAt7 = linkedStop(CFG, 0.07); // 0.038
ok('从 7% 回落到 3.8% → 触发离场', 0.038 <= stopAt7, '保护线 ' + stopAt7);
ok('从 7% 只回落到 4.5% → 不触发（不该被震出去）', !(0.045 <= stopAt7), '保护线 ' + stopAt7);
ok('从 7% 一路跌到 0.4% → 更该早就触发', 0.004 <= stopAt7);
// 反证：旧写法 profit <= profit - tp*0.4 恒 false
let firedOld = 0;
for (const p of [0.06, 0.07, 0.001, -0.02]) if (p <= p - CFG.tp * 0.4) firedOld++;
ok('反证：旧「profit <= profit - tp*0.4」写法 0/4 触发（死分支实锤）', firedOld === 0, '触发 ' + firedOld);

// ---------- ④ 买入预算：手续费必须先扣 ----------
console.log('\n【④ 买入预算与手续费】');
// ⛔ dv 轮：出局分支里插入了 skipAdd 计数 → 结束标记与断言都改成钉语义（判定式 → continue）
const SRC_BUDGET = grabBlock('    const gross = Math.min(acc.cash', "buyOverCash'); continue; }");
ok('源码用 gross→budget 两步（先扣费再取整手）', /const gross = Math\.min\(acc\.cash/.test(SRC_BUDGET) && /const budget = Math\.max\(0, gross - Math\.max\(5, gross \* 0\.00025\)\)/.test(SRC_BUDGET));
ok('源码有兜底：cost + fee > 现金就跳过', /if \(cost \+ fee > acc\.cash\)[\s\S]{0,60}?continue;/.test(SRC_BUDGET));

// 把这段塞进一个可返回的函数里跑（源码里的 continue ⇒ 跳过这只票）
// 源码里有 paperEquity(key, pm) 调用，这里用注入的 equity 顶掉
// ⛔ 2026-10-28 补：源码整手计算改为 paperLotOf(c.code)，沙箱须注入 paperLotOf 与 c 桩（默认主板100股），
//    否则片段引用未定义符号会 ReferenceError 崩（与 stale 测试同源的坑）。科创板整手由 _test_paper_lot.js 单独守门。
const SRC_LOT = grab(/^function paperLotOf\(code\) \{/m);
const buyMath = new Function('acc', 'price', 'cfg', 'equity',
  'const skipAdd = function(){ return 0; };' // dv 轮：片段里的出局分支会计数，沙箱补个空实现
  + 'const key = "pool", pm = null;' // 源码片段里还引用了这两个，补上占位
  + 'const paperEquity = function(){ return equity; };'
  + 'var c = { code: "600000" };' // 默认主板，整手100；科创板扫描由 _test_paper_lot.js 另测
  + SRC_LOT + '\n'
  + SRC_BUDGET.replace(/continue;/g, 'return null;')
  + ' return { shares: shares, cost: cost, fee: fee, cashAfter: +(acc.cash - cost - fee).toFixed(2) };');

const mkAcc = cash => ({ cash: cash });
const cfg5 = { maxPos: 5 };
// 旧式预算（复刻 bug，用于反证）
function oldBuy(cash, price, equity, maxPos) {
  const budget = Math.min(cash, equity / maxPos * 0.98);
  const shares = Math.floor(budget / price / 100) * 100;
  if (shares < 100) return null;
  const cost = +(shares * price).toFixed(2);
  const fee = Math.max(5, cost * 0.00025);
  return { shares: shares, cost: cost, fee: fee, cashAfter: +(cash - cost - fee).toFixed(2) };
}

// 反证：旧写法在「现金正好够整手」时把现金买成负数
const oldBad = oldBuy(1000, 10, 100000, 5);
ok('反证：旧写法 现金1000/股价10 → 买成 ' + (oldBad && oldBad.cashAfter) + ' 元（负数实锤）', !!oldBad && oldBad.cashAfter < 0, JSON.stringify(oldBad));
const newSame = buyMath(mkAcc(1000), 10, cfg5, 100000);
ok('新写法同一场景：宁可不买，也不许现金为负', newSame === null || newSame.cashAfter >= 0, JSON.stringify(newSame));

// 全组合不变量扫描
let neg = 0, checked = 0;
for (const cash of [300, 500, 1000, 1005, 1234, 5000, 20000, 100000]) {
  for (const price of [2.8, 3.5, 10, 27.86, 100, 188.5]) {
    for (const equity of [cash, 100000, 500000]) {
      const r = buyMath(mkAcc(cash), price, cfg5, equity);
      checked++;
      if (r && (r.cashAfter < 0 || r.cost + r.fee > cash + 1e-9 || r.shares % 100 !== 0 || r.shares < 100)) neg++;
    }
  }
}
ok('全组合扫描（' + checked + ' 组）买后现金永不为负 / 永为整手', neg === 0, '违例 ' + neg);

// 正常买入仍要能成交（别因为扣费把买入全卡死）
let bought = 0;
for (const cash of [5000, 20000, 100000]) {
  for (const price of [3.5, 10, 27.86, 100]) {
    if (buyMath(mkAcc(cash), price, cfg5, cash * 5)) bought++;
  }
}
ok('资金充裕时正常成交（' + bought + '/12 组买入成功，没被扣费逻辑卡死）', bought >= 11, '成功 ' + bought);

// 手数符合 A 股 100 股整手
// 净值 10 万 / 5 仓 → 每仓毛预算 19600，扣 5 元佣金后 19595 → 10 元股价买 1900 股（19000 元）
const r1 = buyMath(mkAcc(20000), 10, cfg5, 100000);
ok('净值10万/5仓/股价10 → 单笔 1900 股 · 19000 元（整手且不超毛预算）',
  !!r1 && r1.shares === 1900 && Math.abs(r1.cost - 19000) < 1e-6 && r1.cost + r1.fee <= 19600, JSON.stringify(r1));

// ---------- ⑤ 峰值跨巡检累积（移动止损的核心） ----------
console.log('\n【⑤ 峰值累积语义】');
// 模拟一串价格：涨到 7% 再回落，peak 必须停在 7% 不再下移
let peak = 0;
const buyPx = 10;
for (const px of [10.2, 10.5, 10.7, 10.6, 10.4, 10.38, 10.2]) {
  const profit = px / buyPx - 1;
  if (profit > peak) peak = profit;
}
ok('涨到 7% 后回落，峰值锁定 7%（不随回落下降）', Math.abs(peak - 0.07) < 1e-9, 'peak=' + peak);
ok('回落到 3.8% 时按峰值保护线触发', 0.038 <= linkedStop(CFG, peak));
ok('回落到 5% 时仍不动（保护线 3.8%）', !(0.05 <= linkedStop(CFG, peak)));

// ---------- ⑥ 节流落盘（峰值要能活过重启） ----------
console.log('\n【⑥ 峰值/最新价落盘】');
ok('有 paperTouch 节流落盘函数', /function paperTouch\(\)/.test(src));
ok('节流 60 秒（不许每 tick 写文件）', /if \(now - _paperSaveT < 60000\) return;/.test(src));
ok('paperCheck 末尾调用节流落盘', /if \(Object\.keys\(acc\.positions\)\.length\) paperTouch\(\);/.test(src));

console.log('\n模拟盘资金/止损守门：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
