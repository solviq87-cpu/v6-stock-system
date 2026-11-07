'use strict';
// 用户「十四条」选股体系单测
// 核心要锁死的不是"算出来对不对"，而是**判不出来时不能装作判出来了**：
// ⑦⑭ 两条缺数据源（竞价分时的成交量拿不到），必须返回 unknown 并进 unknownList，
//       绝不能混进 miss（"不符合"）—— 把"没数据"显示成"不符合条件"会让人平白错过一只票。
// ⑫ 已于 2026-10-01 接入东财龙虎榜（见 _test_lhb.js 的三态用例），本文件不传 lhb
//       → 仍然是 unknown，这条断言因此依旧成立：缺数据时照样不许装作判过。
const M = require('./myrules.js');
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };
const sec = t => console.log('\n' + t);

function mkRows(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = fn(i);
    out.push({ date: 'd' + i, open: c, close: c, high: c * 1.02, low: c * 0.98, volume: 100000, amount: 100000 * c, pct: 0 });
  }
  return out;
}
// 一只"标准好票"：10元、流通市值70亿、板块热、竞价4.5%/1%换手、首板硬板大封单、堆量突破
function good(over) {
  const rows = mkRows(65, i => i < 60 ? 10 : 10 + (i - 59) * 0.15);   // 末尾抬升 → 多头/上升通道
  // 60~63 放量（堆量：5日均量/20日均量 >1.5）、60 日有一次涨停（涨停基因）
  for (let i = 60; i <= 63; i++) rows[i] = { ...rows[i], volume: 300000, amount: 3.3e6 };
  rows[60] = { ...rows[60], pct: 10 };
  // 最后一根：倍量（相对昨日 2 倍）+ 收盘 12.5 一举突破前面所有高点（过左峰）
  rows[64] = { ...rows[64], close: 12.5, high: 12.6, volume: 600000, amount: 7.5e6 };
  return Object.assign({
    stock: {
      code: '600418', name: '样板股份', price: 12.5, pct: 4.2, floatCap: 70e8,
      amount: 2.2e8, sealAmount: 3e8, limitUpCount: 1, breakCount: 0,
    },
    rows,
    sector: { name: '央国企改革', ztCount: 5, pct: 2.4 },
    auction: { auctionAmount: 70e8 * 0.01, auctionPct: 4.5 },           // 换手1% / 涨幅4.5%
    profitRatio: 35,
  }, over || {});
}

sec('① 标准好票应命中绝大多数条目');
{
  const r = M.evaluateOne(good(), {});
  ok('命中条数 ≥8（实测 ' + r.hits + '/' + r.known + '）', r.hits >= 8, JSON.stringify(r.hitList));
  ok('判定为符合体系', r.pass === true);
  ok('① 流通市值70亿命中', r.items[0].ok);
  ok('② 股价10.6元命中', r.items[1].ok);
  ok('③ 均线/通道命中', r.items[2].ok, r.items[2].note);
  ok('④ 涨停基因+堆量命中', r.items[3].ok, r.items[3].note);
  ok('⑤ 板块效应命中', r.items[4].ok, r.items[4].note);
  ok('⑥ 竞价换手+涨幅命中', r.items[5].ok, r.items[5].note);
}

sec('② 缺数据的三条必须是 unknown，不能算"不符合"');
{
  const r = M.evaluateOne(good(), {});
  const un = r.items.filter(x => x.unknown).map(x => x.i);
  ok('⑦ 竞价红绿柱 → unknown', un.indexOf(7) >= 0, JSON.stringify(un));
  ok('⑫ 龙虎榜游资 → unknown', un.indexOf(12) >= 0);
  ok('⑭ 竞价尾盘抢筹 → unknown', un.indexOf(14) >= 0);
  ok('unknown 不计入 miss', r.unknownList.every(i => r.missList.indexOf(i) < 0));
  ok('unknown 不计入命中率分母', r.known === r.hits + r.missList.length);
  ok('unknown 数量为 3', r.unknown === 3, String(r.unknown));
}

sec('②b ⑦⑭ 接入竞价分时后应参与判定（不再 unknown，且能区分命中/不命中）');
{
  const ticks = { preClose: 10, bars: [
    { t: '09:15', price: 10.1, high: 10.1, low: 10.0, vol: 50 },
    { t: '09:16', price: 10.15, high: 10.15, low: 10.1, vol: 80 },
    { t: '09:20', price: 10.2, high: 10.2, low: 10.15, vol: 120 },
    { t: '09:23', price: 10.3, high: 10.3, low: 10.2, vol: 300 },
    { t: '09:24', price: 10.35, high: 10.35, low: 10.3, vol: 400 },
    { t: '09:25', price: 10.4, high: 10.4, low: 10.35, vol: 500 },
  ] };
  const r = M.evaluateOne(good({ aucTicks: ticks }), {});
  const it7 = r.items.find(x => x.i === 7), it14 = r.items.find(x => x.i === 14);
  ok('⑦ 有分时数据 → 非 unknown', it7 && it7.unknown !== true, JSON.stringify(it7));
  ok('⑦ 红柱多于绿柱 → 命中', it7 && it7.ok === true, it7 && it7.note);
  ok('⑭ 有分时数据 → 非 unknown', it14 && it14.unknown !== true, JSON.stringify(it14));
  ok('⑭ 尾盘上翘+放量 → 命中', it14 && it14.ok === true, it14 && it14.note);
  // 有分时数据但没达标：必须是 known（不命中），绝不能退化成 unknown
  const flat = { preClose: 10, bars: [
    { t: '09:15', price: 10.0, vol: 100 }, { t: '09:20', price: 10.0, vol: 100 }, { t: '09:25', price: 10.0, vol: 100 },
  ] };
  const r2 = M.evaluateOne(good({ aucTicks: flat }), {});
  const i7 = r2.items.find(x => x.i === 7), i14 = r2.items.find(x => x.i === 14);
  ok('⑦ 红绿持平 → 不命中但仍 known（非 unknown）', i7 && i7.ok === false && i7.unknown !== true, JSON.stringify(i7));
  ok('⑭ 价不上翘 → 不命中但仍 known（非 unknown）', i14 && i14.ok === false && i14.unknown !== true, JSON.stringify(i14));
}

sec('③ 排除项：4 连板以上直接出局（命中再多也不行）');
{
  const r = M.evaluateOne(good({ stock: { code: '600418', name: '样板股份', price: 12.5, pct: 4.2, floatCap: 70e8, amount: 2.2e8, sealAmount: 3e8, limitUpCount: 4, breakCount: 0 } }), {});
  ok('4连板被判出局', r.pass === false);
  ok('出局理由写在 excluded 里', r.excluded.length > 0 && /连板/.test(r.excluded[0]), JSON.stringify(r.excluded));
  const r5 = M.evaluateOne(good({ stock: { code: '600418', name: '样板股份', price: 12.5, pct: 4.2, floatCap: 70e8, amount: 2.2e8, sealAmount: 3e8, limitUpCount: 3, breakCount: 0 } }), {});
  ok('3连板不算超限', r5.excluded.length === 0);
}

sec('④ 各条边界');
{
  const cap = v => M.evaluateOne(good({ stock: { code: '600418', name: '样板股份', price: 12.5, pct: 4.2, floatCap: v, amount: 2.2e8, sealAmount: 3e8, limitUpCount: 1, breakCount: 0 } }), {}).items[0];
  ok('流通市值 30亿 不符（<50）', cap(30e8).ok === false);
  ok('流通市值 70亿 符合', cap(70e8).ok === true);
  ok('流通市值 200亿 不符（>100）', cap(200e8).ok === false);
  const px = v => M.evaluateOne(good({ stock: { code: '600418', name: '样板股份', price: v, pct: 4.2, floatCap: 70e8, amount: 2.2e8, sealAmount: 3e8, limitUpCount: 1, breakCount: 0 } }), {}).items[1];
  ok('股价 39.9 符合', px(39.9).ok === true);
  ok('股价 55 不符', px(55).ok === false);
  // 缺流通市值不能判成"不符合"
  ok('缺流通市值 → unknown 而非 miss', cap(0).unknown === true);
}

sec('⑤ 竞价换手/涨幅的黄金区');
{
  const auc = (amt, p) => M.evaluateOne(good({ auction: { auctionAmount: amt, auctionPct: p } }), {}).items[5];
  ok('换手1.0% + 涨幅4.5% 命中', auc(70e8 * 0.01, 4.5).ok === true);
  ok('换手0.3%（<0.6）不命中', auc(70e8 * 0.003, 4.5).ok === false);
  ok('换手3%（>1.5）不命中', auc(70e8 * 0.03, 4.5).ok === false);
  ok('涨幅8%（>6）不命中', auc(70e8 * 0.01, 8).ok === false);
  const noAuc = M.evaluateOne(good({ auction: null }), {}).items[5];
  ok('无竞价数据 → unknown（非交易时段不该被判不符合）', noAuc.unknown === true);
}

sec('⑥ 四个"比"的阈值与算式');
{
  const r = M.evaluateOne(good(), {});
  const it = r.items[7];
  ok('⑧ 四个比都能算出来', it.ok != null && !it.unknown, JSON.stringify(it.val));
  ok('note 里写了完整计算式（便于用户核对口径）', /竞流比.*封流比.*封成比.*竞昨比/.test(it.note), it.note);
  // 封单不足 → 封流比/封成比 拉垮
  const weak = M.evaluateOne(good({ stock: { code: '600418', name: '样板股份', price: 12.5, pct: 4.2, floatCap: 70e8, amount: 2.2e8, sealAmount: 1e6, limitUpCount: 1, breakCount: 0 } }), {});
  ok('封单极小时 ⑧ 不命中', weak.items[7].ok === false, weak.items[7].note);
}

sec('⑦ 倍量过左峰');
{
  const r = M.evaluateOne(good(), {});
  ok('⑬ 命中（2倍量 + 破60日高）', r.items[12].ok === true, r.items[12].note);
  const flat = mkRows(65, () => 10);
  const r2 = M.evaluateOne(good({ rows: flat }), {});
  ok('无倍量无突破时不命中', r2.items[12].ok === false, r2.items[12].note);
}

sec('⑧ 批次扫描与排序');
{
  const a = good({ stock: { code: '600001', name: '甲', price: 12.5, pct: 4.2, floatCap: 70e8, amount: 2.2e8, sealAmount: 3e8, limitUpCount: 1, breakCount: 0 } });
  const b = good({ stock: { code: '600002', name: '乙', price: 90, pct: 4.2, floatCap: 700e8, amount: 2.2e8, sealAmount: 3e8, limitUpCount: 1, breakCount: 0 } });
  const s = M.scan([b, a], {});
  ok('命中多的排前面', s.all[0].hits >= s.all[1].hits, s.all.map(x => x.hits).join(','));
  const s2 = M.scan([a, b], {});
  ok('换入池顺序结果不变（稳定排序）', s.all.map(x => x.code).join() === s2.all.map(x => x.code).join());
  ok('空池不炸', M.scan([], {}).count === 0);
  ok('单只票格式化不炸且含条号', /\[1\]/.test(M.formatOne(s.all[0])));
}

sec('⑨ 阈值可调（你的尺子你自己改）');
{
  const r = M.evaluateOne(good({ stock: { code: '600418', name: '样板股份', price: 12.5, pct: 4.2, floatCap: 200e8, amount: 2.2e8, sealAmount: 3e8, limitUpCount: 1, breakCount: 0 } }), { capHi: 300 });
  ok('把市值上限调到300亿后 ① 命中', r.items[0].ok === true);
  const r2 = M.evaluateOne(good(), { minHits: 99 });
  ok('minHits 提到 99 后不达标', r2.pass === false);
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
