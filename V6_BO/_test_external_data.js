'use strict';
// 守门测试：外部数据源接入（external_data.js）
// 核心纪律：① fetch 失败保留上次有效值、绝不抹空；② 两融/解禁/增减持/调研/舆情/汇率源不可达时诚实标记 error、不造假；
//          ③ fetchAll 键齐全（north/south/commodities/financials/margin）。
// ⛔ 网络细节断言（north/commodities 真取到数值）做成【条件软断言】——网络波动时只提示不计入失败，
//    避免把"出网抖动"误判成代码回归（参见 _test_datasource_fallback 基线）。mergeExt 语义与结构断言为硬断言。
const ext = require('./external_data.js');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// 1) mergeExt：抓失败保留上次有效值（核心纪律）
(() => {
  const prev = { time: 't0', items: { north: { sh: { dayNet: 1 }, sz: { dayNet: 2 }, date: '2026-10-12' } }, ok: { north: true }, fail: {} };
  const snap = { time: 't1', items: {}, ok: {}, fail: { north: '北向空' } };
  const m = ext.mergeExt(prev, snap);
  ok('mergeExt 失败保留 north 旧值(不抹空)', m.items.north && m.items.north.sh && m.items.north.sh.dayNet === 1 && !m.items.north.error);
  ok('mergeExt 失败不把旧值改写成 {error}', !(m.items.north && m.items.north.error));
})();

// 1b) mergeExt：保留旧值必须打 stale 标记（判不出不硬判，2026-10-29）
//     原实现把旧值原样塞回，而 merged.time 是**本次抓取时间** → 「新时间戳 + 旧数据」，
//     下游（/api/state → 面板/复盘/选股）无法区分这一项是今天的还是三天前的，
//     会把「北向资金停更三天」当成今日实时值用。
//     钉语义：数值一个不改 + 必须带 stale / staleSince(上次成功时间) / staleReason；恢复后自动清标记。
(() => {
  const prev = { time: '2026-10-26 15:00', items: { north: { sh: { dayNet: 7 }, date: '2026-10-26' } }, ok: {}, fail: {} };
  const snap = { time: '2026-10-29 10:00', items: {}, ok: {}, fail: { north: '超时' } };
  const m = ext.mergeExt(prev, snap);
  ok('保留旧值时数值一个都不改', m.items.north.sh.dayNet === 7 && m.items.north.date === '2026-10-26');
  ok('保留旧值必须打 stale=true（不许拿旧值冒充当日）', m.items.north.stale === true);
  ok('staleSince = 上次成功抓取时间（不是本次时间）', m.items.north.staleSince === '2026-10-26 15:00');
  ok('staleReason 记录失败原因，可追溯', m.items.north.staleReason === '超时');

  // 连续失败：staleSince 不许被刷新成今天（否则陈旧程度永远看不出来）
  const m2 = ext.mergeExt(m, { time: '2026-10-29 11:00', items: {}, ok: {}, fail: { north: '仍超时' } });
  ok('连续失败 staleSince 保持首次失败时点', m2.items.north.staleSince === '2026-10-26 15:00');

  // 恢复成功：stale 标记必须自动清除（不许永远挂着旧标记）
  const m3 = ext.mergeExt(m2, { time: '2026-10-29 12:00', items: { north: { sh: { dayNet: 9 }, date: '2026-10-29' } }, ok: { north: true }, fail: {} });
  ok('恢复成功后 stale 标记自动清除', m3.items.north.sh.dayNet === 9 && !('stale' in m3.items.north) && !('staleSince' in m3.items.north));
})();

// 1c) initExternalData 落盘失败不许静默（兜底不许静默铁律）
//     fetchAll 内部已逐源 try/catch，能抛出来的基本只剩 saveExt 落盘失败 ——
//     原 catch {} 空吞：内存有值、磁盘没存，重启后北向/两融整块丢，却查不到原因。
(() => {
  const src = require('fs').readFileSync('external_data.js', 'utf8');
  const body = (src.match(/function initExternalData\([\s\S]*?\n\}/) || [''])[0];
  const code = body.replace(/\/\/.*$/gm, '');  // ⛔ 剥注释再匹配：注释里会写「原 catch {} 空吞」，不剥会恒真
  ok('initExternalData 失败分支有留痕（不再空 catch）', /console\.warn/.test(code) && /_extSaveWarnAt/.test(code));
  ok('落盘失败留痕 60 秒限频（防每轮刷屏）', /60000/.test(code));
})();

// 2) mergeExt：无旧值 → 标记 error（诚实，不造假）
(() => {
  const m = ext.mergeExt({ time: '', items: {} }, { time: 't1', items: {}, ok: {}, fail: { margin: '源暂不可达' } });
  ok('mergeExt 无旧值→margin.error 诚实标记', m.items.margin && m.items.margin.error === '源暂不可达');
})();

// 3) mergeExt：新抓到覆盖旧值
(() => {
  const prev = { time: 't0', items: { north: { sh: { dayNet: 1 } } }, ok: {}, fail: {} };
  const snap = { time: 't1', items: { north: { sh: { dayNet: 99 }, sz: { dayNet: 5 }, date: '2026-10-13' } }, ok: { north: true }, fail: {} };
  const m = ext.mergeExt(prev, snap);
  ok('mergeExt 新抓到覆盖旧值', m.items.north.sh.dayNet === 99 && m.items.north.sz.dayNet === 5);
})();

// 4) fetchAll 结构：三源键齐全
(async () => {
  let snap;
  try { snap = await ext.fetchAll(); } catch (e) { snap = { items: {}, ok: {}, fail: {} }; }
  ok('fetchAll 含 north 键', 'north' in (snap.items || {}));
  ok('fetchAll 含 south 键(南向/港股通)', 'south' in (snap.items || {}));
  ok('fetchAll 含 commodities 键', 'commodities' in (snap.items || {}));
  ok('fetchAll 含 financials 键(财报季)', 'financials' in (snap.items || {}) || 'financials' in (snap.fail || {}));
  ok('fetchAll 含 margin 键(成功在 items / 失败在 fail)', 'margin' in (snap.items || {}) || 'margin' in (snap.fail || {}));

  // 网络可达时：north/south/commodities/financials 解析出数值；margin 诚实 fail（或 ok）
  if (snap.ok && snap.ok.north) {
    const n = snap.items.north;
    ok('north 解析出 sh/sz', n && n.sh && n.sz);
    ok('north.dayNet 为数字(元)', n && typeof n.sh.dayNet === 'number' && typeof n.sz.dayNet === 'number');
  } else { console.log('  · north 本次网络未取到（不计入失败，源可能波动）'); }
  if (snap.ok && snap.ok.south) {
    const so = snap.items.south;
    ok('south 解析出 dayNet(南向/港股通)', so && typeof so.dayNet === 'number');
  } else { console.log('  · south 本次网络未取到（不计入失败）'); }
  if (snap.ok && snap.ok.commodities) {
    const c = snap.items.commodities;
    ok('commodities 含 金/油/银', c && c.gold && c.oil && c.silver);
    ok('commodities 价格/涨跌为数字', c && typeof c.gold.price === 'number' && typeof c.oil.price === 'number' && typeof c.silver.price === 'number' && typeof c.gold.pct === 'number');
  } else { console.log('  · commodities 本次网络未取到（不计入失败）'); }
  if (snap.ok && snap.ok.financials) {
    const f = snap.items.financials;
    ok('financials 解析出 total/top', f && typeof f.total === 'number' && Array.isArray(f.top));
  } else { console.log('  · financials 本次网络未取到（不计入失败）'); }
  ok('margin 诚实(ok 有 或 fail 标记)', (snap.fail && snap.fail.margin) || (snap.ok && snap.ok.margin));

  console.log(`\n外部数据源守门：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
