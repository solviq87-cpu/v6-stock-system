// 守门测试：模拟盘不许按「陈旧价」卖出（2026-10-06）
// 背景：paperBuy 早就写明「休市日不买 —— 拿陈旧价买＝假成交」，但 paperCheck 只判了休市日，
//   **没判价格新鲜度**。持仓票若不在本次行情快照里（全A列表拉取失败/限流、停牌、代码已换），
//   价格会退回 pos.lastPrice（可能是昨天甚至更早的），然后照样算收益、照样判止盈/止损/到期换股
//   → 按一个根本没观察到的价格把持仓卖了，成交记录与收益率一起失真。
//   2026-10-06 本机实测正是全A拉取失败的状态，此时所有持仓都会用陈旧价过一遍判定。
// 本测试钉死：pm 里没有价时，只更新 lastPrice 做展示，**绝不触发任何卖出**。
'use strict';
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const SRC = fs.readFileSync('server.js', 'utf8');

// ───────── 1. 抽出 paperCheck 装进沙箱真跑 ─────────
const i0 = SRC.indexOf('function paperCheck(key, pm) {');
ok(i0 > 0, 'server.js 里存在 paperCheck');
const i1 = SRC.indexOf('\n}\n', i0);
const fnSrc = SRC.slice(i0, i1 + 3);
// paperCheck 内部依赖 linkedStop（收益联动止损），一并抽出来注入沙箱
const l0 = SRC.indexOf('function linkedStop(');
ok(l0 > 0, 'server.js 里存在 linkedStop（paperCheck 依赖它算保护线）');
const l1 = SRC.indexOf('\n}\n', l0);
const linkedStopSrc = SRC.slice(l0, l1 + 3);

// ⛔ 2026-10-28 补注入：2026-10-27 的「跌停卖不出」改动在 paperCheck 外部新增了
//    limitPctOfCode / isLimitDownPrice 两个函数并被 paperCheck 调用；沙箱抽取清单漏了它们
//    → 整套件 ReferenceError 崩（不是变红）。现一并抽出注入，并注入空 S.klines 让 isLimitDownPrice
//    走「判不出→不拦」分支，保住 stale 测试原语义（陈旧价/正常价均不被跌停锁误伤）。
const p0 = SRC.indexOf('function limitPctOfCode(code, name) {');
ok(p0 > 0, 'server.js 里存在 limitPctOfCode（跌停限幅分板）');
const p1 = SRC.indexOf('\n}\n', p0);
const limitPctSrc = SRC.slice(p0, p1 + 3);
const q0 = SRC.indexOf('function isLimitDownPrice(code, name, price) {');
ok(q0 > 0, 'server.js 里存在 isLimitDownPrice（跌停价判定）');
const q1 = SRC.indexOf('\n}\n', q0);
const limitDownSrc = SRC.slice(q0, q1 + 3);
// 2026-10-28 补注入：isLimitDownPrice 现调 preCloseOf（昨收主源）取昨收，沙箱须一并注入，
//   否则 ReferenceError 崩（不是变红）。fakeS 仍空 klines/无 stocks → preCloseOf 判不出 → 不误锁。
const pc0 = SRC.indexOf('function preCloseOf(code) {');
ok(pc0 > 0, 'server.js 里存在 preCloseOf（昨收主源）');
const pc1 = SRC.indexOf('\n}\n', pc0);
const preCloseSrc = SRC.slice(pc0, pc1 + 3);
const fakeS = { klines: new Map(), stocks: [] };   // 空 → 判不出 → 不误锁

const CFG = { name: '测试盘', tp: 0.08, sl: -0.03, expireDays: 2, maxPos: 5, initial: 100000 };
const ACC = { enabled: true, cash: 100000, realized: 0, positions: {}, trades: [] };
let sold = [];
// 真实 paperSell 会 delete acc.positions[code]，桩必须同样删除，否则"卖出后持仓清除"断言必然假红
const fakeSell = (key, code, price, reason) => { sold.push({ code, price, reason }); delete ACC.positions[code]; };
const fakeT1 = () => false;                       // 不锁 T+1，专门考卖出判定
const fakeTouch = () => {};
// ⛔ 2026-10-07 补注入：paperCheck 现在用 tradeDaysSince 算持有交易日。
//    本套件考的是【价格新鲜度】，持有天数的口径由 _test_timepoint_semantics.js 单独守门；
//    这里给一个按自然日折算的桩，保持本套件原有语义（"已持有 3 天 > expireDays 2"）不变。
//    ⚠️ 沙箱注入清单漏一个符号 = 整个套件 ReferenceError 崩掉（不是变红），踩过很多次。
const fakeTradeDaysSince = ts => Math.max(0, Math.floor((Date.now() - (Number(ts) || 0)) / 86400000));
let NOW = Date.parse('2026-10-06T13:00:00');
const FakeDate = { now: () => NOW };
// ⛔ gq 轮 Y7 补注入：paperCheck 现在调 effStopOf(cfg, code, price) 拿 ATR 动态基础止损线。
//    本套件考的是【价格新鲜度】不是 ATR，注入「判不出就回用户底线」的桩
//    （与真实 effStopOf 拿不到 K 线时的行为一致）—— 漏注入 = 套件 ReferenceError 崩掉，踩过很多次。
const fakeEffStop = cfg => Number(cfg.sl);

const build = src => new Function('PAPER_CFG', 'PAPER', 'paperSell', 'paperT1Locked', 'paperTouch', 'tradeDaysSince', 'Date', 'effStopOf', 'S',
  limitPctSrc + '\n' + preCloseSrc + '\n' + limitDownSrc + '\n' + linkedStopSrc + '\n' + src + '\n; return paperCheck;'
)({ pool: CFG }, { pool: ACC }, fakeSell, fakeT1, fakeTouch, fakeTradeDaysSince, FakeDate, fakeEffStop, fakeS);
const paperCheck = build(fnSrc);

// ⛔ 接线断言：paperCheck 内必须引用 isLimitDownPrice（跌停锁已接），防止日后重构把它摘掉又无人发现
ok(/isLimitDownPrice\(/.test(fnSrc), 'paperCheck 内已接跌停锁（isLimitDownPrice 引用存在）');

const mkPos = (code, buyPrice, lastPrice) => {
  ACC.positions[code] = { code, name: 'X' + code, buyPrice, shares: 1000, buyTs: NOW - 3 * 86400000, peak: 0, lastPrice };
};

// ① 有真实行情价且已跌破止损 → 正常卖出（不能把正常功能也一起关掉）
sold = [];
ACC.positions = {};
mkPos('600000', 10, 10);
paperCheck('pool', new Map([['600000', 9.5]]));   // 现价 9.5 = -5%，止损 -3%
ok(sold.length === 1 && sold[0].code === '600000', '有真实价且跌破止损 → 正常卖出（防护不能误伤正常功能）');
ok(/止损/.test(sold[0] && sold[0].reason || ''), '卖出理由正确标注为止损');

// ② 快照里没有这只票（lastPrice 是 3 天前的低价）→ 不许卖
sold = [];
ACC.positions = {};
mkPos('600001', 10, 9.0);                          // 陈旧价 9.0 = -10%，远破止损
paperCheck('pool', new Map());                     // 本次快照里没有任何价
ok(sold.length === 0, '⚠️ 快照无价 → 即使陈旧价显示 -10% 也**绝不出手**（核心断言）');
ok(ACC.positions['600001'].lastPrice === 9.0, '无真实价时仍记录 lastPrice（面板不丢显示）');
ok(ACC.positions['600001'].pxStale === true, '该持仓被打上 pxStale 标记（面板可提示"价格陈旧"）');

// ③ 同一只票，快照恢复后能正常卖出（不是永久卡死）
sold = [];
paperCheck('pool', new Map([['600001', 9.4]]));
ok(sold.length === 1, '快照恢复真实价后 → 正常卖出（不是永久冻结持仓）');
ok(ACC.positions['600001'] === undefined, '卖出后持仓已清除');

// ④ 陈旧价"看起来止盈"时也不许卖（别以为只有止损方向有风险）
sold = [];
ACC.positions = {};
mkPos('600002', 10, 11.5);                         // 陈旧价 11.5 = +15%，远超止盈 8%
paperCheck('pool', new Map());
ok(sold.length === 0, '陈旧价显示 +15% 也不许止盈卖出（两个方向都不许用假价成交）');

// ⑤ 到期换股同样不许用陈旧价触发
sold = [];
ACC.positions = {};
mkPos('600003', 10, 10.1);                         // 陈旧价 +1%（<2%），且已持有 3 天 > expireDays 2
paperCheck('pool', new Map());
ok(sold.length === 0, '到期换股也不许用陈旧价触发');

// ⑥ 反向证明：把「无真实价就不卖」这行删掉，陈旧价就会成交
const broken = fnSrc.replace(/if \(!live\) \{[^}]*\}\s*\n?/, '');
ok(broken !== fnSrc, '反向证明：删掉新鲜度守门后代码确实变了（说明守门真实存在）');
const paperCheckBroken = build(broken);
sold = [];
ACC.positions = {};
mkPos('600004', 10, 9.0);
paperCheckBroken('pool', new Map());
ok(sold.length === 1, '反向证明：删掉守门后，陈旧价 9.0 立刻触发卖出（正是本次要堵的假成交）');

// ───────── 2. 买入端已有同类闸门，两端原则必须一致 ─────────
// ⛔⛔ gn 轮改判据（2026-10-13，用户「非交易时间买卖股票说了八百遍」）：这道闸门原来只判
//    **休市日**（isTradeDay），交易日收盘后/开盘前/午休照常按陈旧收盘价"买入"（假成交）。
//    现在收紧到 isTradingTime()（isTradeDay && 交易时段，更严、休市日天然包含）。
//    断言改钉新语义：买入端第一道闸门必须是交易时段口径，且窗口要够大到越过开头的中文注释。
const buyIdx = SRC.indexOf('function paperBuy(');
// mp 轮：闸门从 isTradingTime 再收紧到 isContinuousTrading（排除集合竞价两段），语义只强不弱
ok(/if \(!(?:isTradingTime|isContinuousTrading)\(\)\) return;/.test(SRC.slice(buyIdx, buyIdx + 3000)), '⛔ 买入端有时间闸门（非交易时段/集合竞价不自动买入，不许按陈旧价成交）');

console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
process.exit(fail ? 1 : 0);
