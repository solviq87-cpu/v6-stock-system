// 守门：缓存「缺当日行」必须按东财快照补齐（em.appendDayRow）
// ────────────────────────────────────────────────────────────────────────────────
// 事故（2026-10-28 mq 轮，用户「每个数字可信」）：
//   收盘后兜底源（ths）不给当日行 → klineBackfill 判「源滞后」不写盘 → 缓存末行永久停在昨天。
//   10-28 实测 66/74 只涨停池成员末行=10-27（001219 青岛食品 / 002636 金安国纪 / 002708 光洋股份 …），
//   而 reviewFlags 的 aboveMa5 / brokeHighHold / volPriceUp / rangePos / cci 全是用「最后一根」算的
//   → 复盘形态判定整片建立在陈旧行上（用户看到的是昨天的形态）。
// 为什么不能只靠 guardDayRow：它只处理「末行=今天但价格失真」（源码里对末行≠今天直接 return）。
// 钉的语义（⛔ 判不出就不补，宁缺不造）：
//   ① 末行=昨天 + 快照有今日真成交 + 末行收盘==快照前收 → 追加一根，价格/量/额/换手取快照真值
//   ② 末行=今天 → 不动（交给 guardDayRow 重建，不许重复追加）
//   ③ 盘中（<15:05）→ 不补（盘中快照价是实时价，补进去就是假行）
//   ④ 除权/停牌复牌（末行收盘 ≠ 快照前收）→ 不补，只记 adjMismatch
//   ⑤ 隔太久（>5 自然日）→ 不补（否则把隔了一个月接成连续两根，连板/形态全失真）
//   ⑥ 停牌（快照 volume=0）/ 快照里没这只票 / 无快照 → 不补
//   ⑦ src='em' 是权威源 → 它没写就是真没有，不补
'use strict';
const em = require('./em.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };
const group = t => console.log('\n── ' + t + ' ──');
const near = (a, b, eps) => Math.abs(Number(a) - Number(b)) <= (eps == null ? 0.011 : eps);

const NOW = new Date(2026, 9, 28, 18, 0, 0);      // 2026-10-28 18:00（收盘后）
const INTRADAY = new Date(2026, 9, 28, 14, 0, 0); // 同日盘中

// 历史行：amount/volume 反推均价 10 元 → 判为「手」
function rowsEnding(date, close) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push({ date: '2026-10-2' + (i + 1), open: 9.9, close: i === 2 ? close : 10,
      high: 10.2, low: 9.8, volume: 10000, amount: 10000000, amp: 4, pct: 0, chg: 0, turnover: 8 });
  }
  out[2].date = date;
  return out;
}
const REF = { code: '001219', name: '青岛食品', price: 10.95, open: 10.1, high: 11.0, low: 9.9,
  volume: 2000000, amount: 21000000, turnover: 12.5, pct: 9.5, preClose: 10 };
const MAP = new Map([['001219', REF]]);

group('[1] 缺当日行 → 按快照追加一根（价格/量/额/换手全取真值）');
{
  const k = { src: 'ths', rows: rowsEnding('2026-10-27', 10) };
  const n0 = k.rows.length;
  em.appendDayRow('001219', k, NOW, MAP);
  ok(k.rows.length === n0 + 1, '行数 +1（' + n0 + '→' + k.rows.length + '）');
  const r = k.rows[k.rows.length - 1];
  ok(r && r.date === '2026-10-28', '追加行日期 = 今天（' + (r && r.date) + '）');
  ok(r && r.close === REF.price, '收盘价严格等于快照 price（' + (r && r.close) + '）');
  ok(r && r.high === 11.0 && r.low === 9.9, '最高/最低取快照真值');
  ok(r && r.volume === 20000, 'volume 按「手」换算（2000000 股 → 20000 手，实测 ' + (r && r.volume) + '）');
  ok(r && r.amount === 21000000, '成交额取快照真值');
  ok(r && near(r.pct, 9.5), 'pct 取快照值（' + (r && r.pct) + '）');
  ok(r && near(r.chg, 0.95), 'chg = 收 - 前收（' + (r && r.chg) + '）');
  ok(r && r.rebuilt === true, '带 rebuilt 留痕（这一行不是数据源原文）');
  ok(k.dayRowAppended && k.dayRowAppended.from === '2026-10-27', 'k.dayRowAppended 记录补行来源');
}

group('[2] 末行已经是今天 → 不动（重建归 guardDayRow，绝不追加第二根）');
{
  const k = { src: 'ths', rows: rowsEnding('2026-10-28', 10) };
  const n0 = k.rows.length;
  em.appendDayRow('001219', k, NOW, MAP);
  ok(k.rows.length === n0, '行数不变');
  ok(!k.dayRowAppended, '不留补行痕迹');
  // 反证：这个场景正是 guardDayRow 的地盘 —— 它会重建而不是追加
  ok(typeof em.guardDayRow === 'function', 'guardDayRow 仍在（两条路径分工明确，不是互相替代）');
}

group('[3] 盘中不补（快照价=实时价，补进去就是假行）');
{
  const k = { src: 'ths', rows: rowsEnding('2026-10-27', 10) };
  const n0 = k.rows.length;
  em.appendDayRow('001219', k, INTRADAY, MAP);
  ok(k.rows.length === n0, '14:00 调用 → 行数不变');
}

group('[4] 除权/停牌复牌：末行收盘 ≠ 快照前收 → 一个字不动');
{
  const k = { src: 'ths', rows: rowsEnding('2026-10-27', 8) };   // 前复权后末行 8，快照前收 10
  const n0 = k.rows.length;
  em.appendDayRow('001219', k, NOW, MAP);
  ok(k.rows.length === n0, '口径对不上 → 不补');
  ok(k.dayRowAdjMismatch && k.dayRowAdjMismatch.refPreClose === 10, '打 adjMismatch 留痕（可被巡检数出来）');
}

group('[5] 隔太久（>5 自然日）不补：不许把隔了一个月接成连续两根');
{
  const k = { src: 'ths', rows: rowsEnding('2026-10-15', 10) };
  const n0 = k.rows.length;
  em.appendDayRow('001219', k, NOW, MAP);
  ok(k.rows.length === n0, '10-15 → 10-28（13 天）不补');
  // 反证：同一票只隔 1 天就补 —— 差别只在日期间隔
  const k2 = { src: 'ths', rows: rowsEnding('2026-10-27', 10) };
  em.appendDayRow('001219', k2, NOW, MAP);
  ok(k2.rows.length === 4, '反证：10-27 隔 1 天 → 照常补');
}

group('[6] 停牌 / 无快照 / 快照没这只票 / 权威源 → 都不补');
{
  const k1 = { src: 'ths', rows: rowsEnding('2026-10-27', 10) };
  em.appendDayRow('001219', k1, NOW, new Map([['001219', Object.assign({}, REF, { volume: 0 })]]));
  ok(k1.rows.length === 3, '快照 volume=0（停牌）→ 不补');

  const k2 = { src: 'ths', rows: rowsEnding('2026-10-27', 10) };
  em.appendDayRow('001219', k2, NOW, null);
  ok(k2.rows.length === 3 || k2.rows.length === 3, '无快照（null）→ 不补');

  const k3 = { src: 'ths', rows: rowsEnding('2026-10-27', 10) };
  em.appendDayRow('001219', k3, NOW, new Map());
  ok(k3.rows.length === 3 && k3.dayRowUnverified === true, '快照里没这只票 → 不补 + 打 unverified');

  const k4 = { src: 'em', rows: rowsEnding('2026-10-27', 10) };
  em.appendDayRow('001219', k4, NOW, MAP);
  ok(k4.rows.length === 3, "src='em'（权威源）→ 不补");

  const k5 = { rows: rowsEnding('2026-10-27', 10) };
  em.appendDayRow('001219', k5, NOW, MAP);
  ok(k5.rows.length === 3, '无 src（没标源）→ 不补（不猜）');
}

group('[7] 快照自身不自洽（high < close）→ 不补');
{
  const k = { src: 'ths', rows: rowsEnding('2026-10-27', 10) };
  em.appendDayRow('001219', k, NOW, new Map([['001219', Object.assign({}, REF, { high: 10.5 })]]));
  ok(k.rows.length === 3, 'high 10.5 < close 10.95 → 不信快照，不补');
}

group('[8] 计数可观测（巡检/面板能数出今天补了多少根）');
{
  const st = em.dayGuardStats();
  ok(typeof st.appended === 'number' && st.appended >= 1, 'dayGuardStats().appended 有计数（' + st.appended + '）');
  ok(Array.isArray(st.lastAppended), 'lastAppended 是可读流水');
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
