// 守门：K线补齐必须按「新鲜度」筛选，不能只按「文件存不存在」
// ────────────────────────────────────────────────────────────────────────
// 事故背景（2026-10-09 fy 轮，用户问「今日K线补齐了吗」）：
//   原实现 todo = uni.filter(c => !cached.has(c)) —— 只补**连文件都没有**的票。
//   实测 .kline_cache 5911 只：最新一根 10-09 只有 1217 只、10-08 1239 只、09-30 2672 只，
//   79% 的今日K线是陈旧的，而补齐器完全看不见这件事（它只认「有没有」，不认「新不新」）。
//   后果：用户 2026-10-08 要求的「15:30 之后所有数据全量最新」从未兑现。
// 钉的语义：
//   ① 已有缓存文件但收盘后再没写过的票 === 必须进 todo（这条是事故本体，必须假红）
//   ② 收盘后写过的不进 todo（不能变成每天无谓重拉全市场）
//   ③ 连文件都没有的长尾票仍然要补（不许为了修①把原有能力丢了）
//   ④ 待刷新(stale)优先于未缓存(missing) —— 今日数据比长尾历史更要紧
//   ⑤ 本轮一只都没补到时不跑 learnall（42万样本库 × 30秒一轮 = 空转拖死补齐）
// ⛔ 断言钉语义不钉字符串：改写法不算回归，把「陈旧票进 todo」这条拆了才算。
'use strict';
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');   // ⛔ 不许 require('./server.js') —— 那会把整站启起来

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// 剥注释（保留 `const APP_VER = ` 那行；这里用不到但保持一致）
const SV = fs.readFileSync('./server.js', 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l) && !l.startsWith('const APP_VER = ')).join('\n');

// 按花括号配平抠函数体（⛔ 不许固定行号窗口）
function takeFn(headerRe) {
  const i = SV.search(headerRe);
  if (i < 0) return '';
  let d = 0, j = SV.indexOf('{', i);
  if (j < 0) return '';
  for (let k = j; k < SV.length; k++) {
    if (SV[k] === '{') d++;
    else if (SV[k] === '}') { d--; if (d === 0) return SV.slice(i, k + 1); }
  }
  return '';
}
const KB = takeFn(/async function klineBackfill\(limitN, days\) \{/);
ok('klineBackfill 抠得出来（不然下面全是空跑）', KB.length > 500, String(KB.length));

group('[1] 源码语义：todo 必须同时认 stale 与 missing');
ok('todo 里带 stale（陈旧票进补齐队列 —— 事故本体）', /stale/.test(KB) && /todo\s*=\s*\[[^\]]*stale/.test(KB));
ok('todo 里仍带 !cached（长尾未缓存票不能丢）', /!cached\.has\(c\)/.test(KB));
ok('stale 排在 !cached 前面（今日数据优先于长尾历史）',
  /uni\.filter\(c => stale\.has\(c\)\).*uni\.filter\(c => !cached\.has\(c\)\)/.test(KB));
ok('stale 由 mtime 判定（不是逐个读JSON，5911次stat才扛得住30秒一轮）', /mtimeMs/.test(KB));
ok('收盘时刻取 15:30（15:30 前补的不算今日已刷新）', /setHours\(15,\s*30/.test(KB));
ok('非交易日退到昨天（否则休市日会被判成"永远不新鲜"而无限重拉）', /-\s*86400000/.test(KB));

group('[2] 真跑：陈旧票必须被补，新鲜票不许被重拉');
// ── 造一个假缓存目录：000001 陈旧(昨天写的) / 000002 新鲜(刚才写的) / 000003 没文件 ──
// ⛔⛔ 时间漂红根治：klineBackfill 用真实 Date 算「今日 15:30 收盘线」当新鲜度阈值，
//    本测试若在 15:30 之前跑（凌晨/上午/盘初），"今天 15:30" 落在未来 → 刚写的文件反被判陈旧
//    → 「新鲜票不被重拉」假红（MEMORY §9 已知基线 kline_fresh 的成因）。现在注入固定锚点时钟
//    （10-13 16:00，交易日后、收盘后），让新鲜/陈旧判定与墙上时钟完全无关，任何时刻跑都同结果。
const RealDate = Date;
const ANCHOR = new RealDate(2026, 9, 13, 16, 0, 0, 0).getTime();   // 2026-10-13 16:00 本地
const DateStub = function (a) { return new RealDate(a === undefined ? ANCHOR : a); };
DateStub.now = () => ANCHOR; DateStub.prototype = RealDate.prototype;
DateStub.UTC = RealDate.UTC; DateStub.parse = RealDate.parse;
const NOW = ANCHOR;
const DAY = 86400000;
const files = {
  '000001.json': NOW - 3 * DAY,   // 陈旧 → 必须补
  '000002.json': NOW - 1000,      // 新鲜 → 不许补
};
const written = [];
const fsStub = {
  readdirSync: () => Object.keys(files),
  statSync: (p) => {
    const fn = String(p).split(/[\\/]/).pop();
    return { mtimeMs: files[fn] };
  },
  readFileSync: (p) => {
    if (String(p).indexOf('.universe_cache.json') >= 0) return JSON.stringify(['000001', '000002', '000003']);
    return '{}';
  },
  writeFileSync: (p) => { written.push(String(p).split(/[\\/]/).pop()); },
};
const pathStub = { join: (a, b) => './' + b };
let learnCalls = 0;
const emStub = {
  fetchKlineBulk: async (batch) => ({
    map: new Map(batch.map(c => [c, { name: '', rows: Array.from({ length: 40 }, (_, i) => ({ date: 'x' + i })) }])),
    fail: 0,
  }),
  fetchKline: async (c) => ({ name: '', rows: Array.from({ length: 40 }, (_, i) => ({ date: 'x' + i })) }),
};

let fn;
try {
  fn = new Function(
    'fs', 'path', '__dirname', 'KLINE_CACHE', 'em', 'isTradeDay', 'nameOfCode',
    'taskSet', 'outN', 'emptyWhyOf', 'runLearnallIngest', '_kbfProg', '_kbfBusy', 'Date',
    KB + '\nreturn klineBackfill;'
  )(
    fsStub, pathStub, '.', './.kline_cache', emStub,
    () => true,                                  // 今天是交易日
    (c) => 'N' + c,
    () => {}, (n) => n, () => '',
    async () => { learnCalls++; return { added: 1, total: 1 }; },
    { ok: false, error: '', day: '', scanned: 0, added: 0, fail: 0, lastTs: 0, elapsedMs: 0 },
    false,
    DateStub
  );
} catch (e) {
  console.log('  ⚠️ 注入失败（套件崩，不是变红）: ' + e.message);
}
ok('klineBackfill 注入成功（漏符号=套件崩，不等于红）', typeof fn === 'function');

(async () => {
  if (typeof fn !== 'function') { console.log('\n──── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ────'); process.exit(fail ? 1 : 0); }
  const r = await fn(2000, 60);
  ok('返回带 stale / missing 两个口径（日志里才看得见"真补完了"）',
    r && typeof r.stale === 'number' && typeof r.missing === 'number',
    JSON.stringify({ stale: r && r.stale, missing: r && r.missing }));
  ok('陈旧票 000001 被补（事故本体：已有文件也要刷）', written.indexOf('000001.json') >= 0, written.join(','));
  ok('新鲜票 000002 不被重拉（不能天天全市场重刷）', written.indexOf('000002.json') < 0, written.join(','));
  ok('未缓存长尾 000003 仍被补（修①不许丢③）', written.indexOf('000003.json') >= 0, written.join(','));
  ok('stale 计数 = 1（只有 000001 陈旧）', r && r.stale === 1, String(r && r.stale));
  ok('missing 计数 = 1（只有 000003 没文件）', r && r.missing === 1, String(r && r.missing));
  ok('本轮补到了 → 会灌学习（addedThis 与 learn 同源）', r && r.addedThis > 0 && learnCalls === 1,
    'addedThis=' + (r && r.addedThis) + ' learnCalls=' + learnCalls);

  group('[3] 空转：票都刷到今日时不许再灌学习');
  learnCalls = 0; written.length = 0;
  // 把两只都标成"新鲜"（模拟 15:30 后已刷完）
  files['000001.json'] = NOW - 1000;
  files['000003.json'] = NOW - 1000;
  fsStub.writeFileSync = (p) => { written.push(String(p).split(/[\\/]/).pop()); };
  fsStub.readdirSync = () => Object.keys(files);
  const r2 = await fn(2000, 60);
  ok('全是新鲜票 → 一只都不补', (r2 && r2.addedThis === 0) && written.length === 0,
    'addedThis=' + (r2 && r2.addedThis) + ' written=' + written.join(','));
  ok('没补到就不跑 learnall（42万样本库不该每30秒空转一次）', learnCalls === 0, 'learnCalls=' + learnCalls);

  console.log('\n──── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ────');
  process.exit(fail ? 1 : 0);
})();
