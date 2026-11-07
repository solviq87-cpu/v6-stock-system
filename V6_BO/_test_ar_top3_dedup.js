// 竞价共振 Top3 推送去重守门（2026-10-27 mp 轮自治修复）
//
// 故障形态（当日 pushlog 实证）：「═══ 🔥 竞价共振 · TOP3 ═══」一天真外发 92 次。
// 根因：旧去重只比对「上一次推送的 ordered codes 三元组」——竞价 9:15-9:25 每秒跳变 +
// 板块强度盘中抖动，相邻 91 次推送里 67 次代码集合都变了，ordered 比对形同虚设。
// 修法三件套（全部收在本函数内，调用点零改动）：
//   ① 排序集合签名：同组换序 = 同签名，不重推
//   ② 60 分钟冷却：冷却窗口内集合抖动不算「确有变化」（与相似走势 60 分钟去重同尺）
//   ③ 当日 5 条封顶：少而精背板，防竞价跳变 + 全天漂移叠加漏网
// 本套件把函数体原样切出来真跑，钉死以上语义 + 旧判据不许回潮。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}

// ── 从源码原样切出（常量 + 状态 + 函数一体，保证测的就是线上的那一版） ──
const iA = SV.indexOf('const AR_PUSH_GAP');
const iCall = SV.indexOf('pushAll(text, false, { private: true });', iA);
const iB = iCall < 0 ? -1 : SV.indexOf('\n}', iCall);
const SRC = (iA >= 0 && iB > iA) ? SV.slice(iA, iB + 2) : '';
ok('AR_PUSH_GAP→pushAll 函数体可定位', SRC.length > 400);
ok('旧 ordered-triple 判据已拆除（codes.every 不许回潮', !/codes\.every\(\(c, i\)/.test(SRC));
ok('三件套齐全（集合签名/冷却/封顶）',
  /_arLastPush\.sig === sig/.test(SRC) && /AR_PUSH_GAP/.test(SRC) && /AR_PUSH_DAY_MAX/.test(SRC));

// ── 沙箱真跑：受控时钟 + 推送计数器 ──
// ⚠️ 2026-10-28 21:55（竞价模块给 pushAuctionResonanceTop3 加 9:30 硬停）之后本套件崩溃：
//    产品侧新增 `const _arNow = new Date(); if (_arNow.getHours()*60+_arNow.getMinutes() >= 9*60+30) return;`
//    而沙箱 FakeDate 只有 now()/toLocaleTimeString() → `_arNow.getHours is not a function`，
//    抛在第 ① 条断言之前（整套 0 断言，不是假红而是直接崩）。
//    修法**不回退产品改动**（9:30 硬停本身是对的：正文取 auctionPct = 9:25 冻结快照，
//    11:26 / 14:48 还发等于拿早盘竞价结论冒充盘中信号），而是把沙箱桩补成**两个独立时钟**：
//      · Date.now()  → T   （受控时钟）= 冷却窗口 / 当日封顶的计时基准
//      · new Date()  → WALL（墙钟）   = 9:30 外发硬停的判定基准
//    两者解耦后，去重三件套能在窗口内反复推进 T 测冷却与封顶（不被墙钟打断），
//    同时新增 ⑤ 组单独钉住「9:30 后不外发」，并留旧写法反证（剥掉硬停 → 同一场景会外发）。
let T = new Date(2026, 9, 27, 9, 15, 0).getTime();      // 受控时钟：冷却/封顶
let WALL = new Date(2026, 9, 27, 9, 15, 0).getTime();   // 墙钟：9:30 硬停判定
class FakeDate {
  static now() { return T; }
  constructor() { this.t = WALL; }
  getHours() { return new Date(this.t).getHours(); }
  getMinutes() { return new Date(this.t).getMinutes(); }
  toLocaleTimeString() { return '09:15:00'; }
}
let sends = [];
function mk(todayStr, srcOverride) {
  sends = [];
  const fn = new Function('pushAll', 'todayStr', 'Date',
    (srcOverride || SRC) + '\nreturn pushAuctionResonanceTop3;');
  return fn((text) => { sends.push(text); }, todayStr || (() => '20261027'), FakeDate);
}
const it = (codes) => codes.map((code, i) => ({
  code, name: '票' + code, auctionPct: 3 + i, pct: 3 + i, score: 50 - i, sector: '测试板块'
}));

// ① 同组同序：第二次调用不重推
{
  const f = mk(); T = +new Date(2026, 9, 27, 9, 15, 0);
  f(it(['000810', '000678', '600094'])); f(it(['000810', '000678', '600094']));
  ok('同组同序不重复推', sends.length === 1, '实际 ' + sends.length);
}
// ①b 同组换序（旧判据的漏网形态）：不重推
{
  const f = mk(); T = +new Date(2026, 9, 27, 9, 15, 0);
  f(it(['000810', '000678', '600094']));
  T += 61 * 60000;   // 就算过了冷却，同组换序也不该重推
  f(it(['600094', '000678', '000810']));
  ok('同组换序不重复推（顺序抖动不算变化）', sends.length === 1, '实际 ' + sends.length);
}
// ② 竞价跳变复现：9:15-9:25 每分钟集合全换 → 只推 1 次
{
  const f = mk(); T = +new Date(2026, 9, 27, 9, 15, 0);
  const pools = [
    ['000810', '000678', '600094'], ['600094', '001318', '603089'], ['603089', '603028', '603719'],
    ['603028', '001219', '600278'], ['600838', '603028', '603089'], ['603028', '001219', '600838'],
  ];
  for (let m = 0; m < 10; m++) { f(it(pools[m % pools.length])); T += 60000; }
  ok('竞价窗口 10 轮跳变只推 1 次（当日 92 条的故障形态被钉死）', sends.length === 1, '实际 ' + sends.length);
}
// ②b 冷却过后集合确有变化 → 允许推第 2 条
{
  const f = mk(); T = +new Date(2026, 9, 27, 9, 15, 0);
  f(it(['000810', '000678', '600094']));
  T += 61 * 60000;
  f(it(['000999', '000678', '600094']));
  ok('冷却过后集合变化 → 推第 2 条', sends.length === 2, '实际 ' + sends.length);
}
// ③ 当日封顶 5：跨冷却持续变化，最多 5 条
{
  const f = mk(); T = +new Date(2026, 9, 27, 9, 15, 0);
  let seq = 0;
  for (let k = 0; k < 12; k++) {
    const codes = [String(600000 + seq), String(600001 + seq), String(600002 + seq)];
    seq += 10;
    f(it(codes));
    T += 61 * 60000;
  }
  ok('当日封顶 5 条（12 轮跨冷却变化也只推 5 次）', sends.length === 5, '实际 ' + sends.length);
}
// ④ 跨天重置：新日期恢复 1 条额度，且昨天推过的同组今天可再推
{
  let day = '20261027';
  const f = mk(() => day);
  T = +new Date(2026, 9, 27, 9, 15, 0);
  f(it(['000810', '000678', '600094']));
  day = '20261028'; T = +new Date(2026, 9, 28, 9, 15, 0);
  f(it(['000810', '000678', '600094']));
  ok('跨天重置：同组新一天可再推 1 条', sends.length === 2, '实际 ' + sends.length);
}

// ⑤ 9:30 外发硬停（2026-10-28 竞价模块新增）：竞价时段外不外发
//   正文取的 auctionPct 是 9:25 那一档冻结快照，11:26 / 14:48 还发等于拿早盘竞价结论冒充盘中信号。
{
  const f = mk();
  T = +new Date(2026, 9, 27, 9, 15, 0); WALL = +new Date(2026, 9, 27, 9, 15, 0);
  f(it(['000810', '000678', '600094']));
  ok('竞价时段内（9:15）正常外发 1 条', sends.length === 1, '实际 ' + sends.length);
}
// ⑤b 墙钟推到 10:16（今日实测：11:26 / 14:48 各发过一条马后炮）→ 不外发
{
  const f = mk();
  T = +new Date(2026, 9, 27, 10, 16, 0); WALL = +new Date(2026, 9, 27, 10, 16, 0);
  f(it(['000810', '000678', '600094']));
  ok('⛔ 9:30 之后不再外发竞价共振（早盘结论不许冒充盘中信号）', sends.length === 0, '实际 ' + sends.length);
}
// ⑤c 边界：9:29 放行、9:30 拦下（硬停口径钉在 9:30，不是 9:31 也不是 10:00）
{
  const f1 = mk();
  T = +new Date(2026, 9, 27, 9, 29, 0); WALL = +new Date(2026, 9, 27, 9, 29, 0);
  f1(it(['000810', '000678', '600094']));
  ok('边界：9:29 仍放行', sends.length === 1, '实际 ' + sends.length);
  const f2 = mk();
  T = +new Date(2026, 9, 27, 9, 30, 0); WALL = +new Date(2026, 9, 27, 9, 30, 0);
  f2(it(['000810', '000678', '600094']));
  ok('边界：9:30 起拦下', sends.length === 0, '实际 ' + sends.length);
}
// ⑤d 反证：把 9:30 硬停那两行从源码里剥掉 → 同一场景又会外发（证明该断言真在咬东西）
{
  const stripped = SRC
    .replace(/^\s*const _arNow = new Date\(\);\s*$/m, '')
    .replace(/^\s*if \(_arNow\.getHours\(\)[\s\S]*?return;\s*$/m, '');
  ok('反证前提：硬停两行已从副本里剥掉', stripped !== SRC && !/_arNow/.test(stripped));
  const f = mk(undefined, stripped);
  T = +new Date(2026, 9, 27, 10, 16, 0); WALL = +new Date(2026, 9, 27, 10, 16, 0);
  f(it(['000810', '000678', '600094']));
  ok('⛔ 反证：没有硬停时 10:16 会外发（旧行为被复现）', sends.length === 1, '实际 ' + sends.length);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
