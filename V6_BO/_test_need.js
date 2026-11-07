// 守门 · di 轮：同一个「够了 / 达标」，在系统里是不是同一把尺子
//   本轮角度：全项目到处都在判"够不够"，而这些门槛散在 11 种写法里 ——
//   K 线 5/6/8/12/21/25/30/40/45/60/100 根、评分线 75、胜率门 55、市值 50 亿……
//   最隐蔽的是评分本身：入池只要 5 根，而评分的分项（获利盘 5 根、90 日涨停基因 90 根）
//   在短数据下天然残缺 —— 同一个 62 分，A 票是「8 项全算过」的 62，B 票是「只算过 4 项」的 62，
//   两者同池排序、同比那条「评分线 75」，量的是两把不同的尺子且从头到尾没人说。
//   修法：门槛登记进 NEED_RULE（含「不够时怎么办」onLess），评分随分返回 basis，
//   并由 scoreNoteOf 唯一出口把「这份分是几根 K 线、按多少满分算的」如实说给用户。
const fs = require('fs');
const D = __dirname;
const A = require('./analysis');
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const AV = fs.readFileSync(D + '/analysis.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SVS = strip(SV), AVS = strip(AV);

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };

// ── 沙箱：把 server.js 里的 NEED_RULE 整块切出来真跑 ─────────────────────
const NEED_SRC = cut(SV, 'const NEED_RULE = {', 'let _rollbackMsg = null;');
const R = new Function(NEED_SRC + '\nreturn { NEED_RULE, needOf, needLess, scoreNoteOf, needRuleState };')();

// ── 造 K 线 ─────────────────────────────────────────────────────────────
const mk = n => Array.from({ length: n }, (_, i) => ({
  date: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), open: 10, high: 10.5, low: 9.5,
  close: 10 + i * 0.01, volume: 1e6, pct: 1.2, turnover: 5
}));
// ⛔ gm 轮：zt5 是新增的第 9 项分维度，调用方传了才计入满分（没传进 missing、不计 avail）
const call = (rows, pr) => A.scoreStock({
  rows, profitRatio: pr, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 1, zt5: 1
});

// ════════ 【A】NEED_RULE 登记表 ════════
console.log('【A】NEED_RULE：每个「够不够」都必须登记，并声明不够时怎么办');
{
  const ks = Object.keys(R.NEED_RULE);
  ok('登记表非空', ks.length >= 8, '实得 ' + ks.length);
  const ONLESS = ['skip', 'null', 'partial', 'zero'];
  for (const k of ks) {
    const d = R.NEED_RULE[k];
    ok(k + ' 的 n 是正整数', Number.isInteger(d.n) && d.n > 0, String(d.n));
    ok(k + ' 的 onLess 合法', ONLESS.indexOf(d.onLess) >= 0, d.onLess);
    ok(k + ' 有 note 说明', typeof d.note === 'string' && d.note.length > 0);
  }
  for (const k of ['pool', 'profit', 'backtest', 'zt90'])
    ok('关键尺子 ' + k + ' 已登记', ks.indexOf(k) >= 0);
  // ⛔ 钉住「两把尺子」这个事实本身：学习/回测的样本门槛比入池门槛严 9 倍，
  //    而评分线正是用那批严样本学出来的 —— 不许有人悄悄把这两个数改成一致就当修好了。
  ok('回测门槛(45) 严于入池门槛(5) 且已登记', R.needOf('backtest') === 45 && R.needOf('pool') === 5,
    R.needOf('backtest') + ' / ' + R.needOf('pool'));
}

// ════════ 【B】唯一读取口 ════════
console.log('【B】needOf / needLess 唯一读取口');
{
  ok('needOf(pool) = 5', R.needOf('pool') === 5);
  ok('needOf(ztpre) = 40', R.needOf('ztpre') === 40);
  ok('needOf(weekly) = 60', R.needOf('weekly') === 60);
  ok('未登记的键返回 0 而不是 NaN/undefined', R.needOf('不存在的键') === 0, String(R.needOf('不存在的键')));
  ok('needLess(zt90) = partial', R.needLess('zt90') === 'partial');
  ok('needLess(pool) = skip', R.needLess('pool') === 'skip');
  ok('未登记的键 onLess 为空串', R.needLess('不存在的键') === '');
  const st = R.needRuleState();
  ok('needRuleState 下发全部键', Object.keys(st).length === Object.keys(R.NEED_RULE).length);
  ok('needRuleState 每键带 n/onLess/note',
    Object.keys(st).every(k => st[k].n > 0 && st[k].onLess && st[k].note));
}

// ════════ 【C】scoreStock 的 basis（真跑） ════════
console.log('【C】评分必须随分返回 basis（几根 K 线、按多少满分算的）');
{
  const full = call(mk(100), 0.8);
  ok('长数据：basis 存在', full.basis && typeof full.basis === 'object');
  ok('长数据：rows 记的是真实根数', full.basis.rows === 100, String((full.basis || {}).rows));
  ok('长数据：missing 为空', (full.basis.missing || []).length === 0, JSON.stringify(full.basis.missing));
  ok('长数据：partial 为空（窗口都够）', (full.basis.partial || []).length === 0, JSON.stringify(full.basis.partial));
  // gm 轮：满分 94 → 98（新增近5日涨停基因 10 分 + 量能结构 5 分；3日上涨/换手排名/90日涨停 各让出权重）
  ok('长数据：avail 是满分 98', full.basis.avail === 98, String(full.basis.avail));
  ok('长数据：分数仍是有限数（回归）', Number.isFinite(full.score) && full.score > 0, String(full.score));

  const short = call(mk(6), null);
  ok('短数据(6根)：rows = 6', short.basis.rows === 6);
  ok('短数据：获利盘算不出 → 进 missing（不是按 0 计分）',
    (short.basis.missing || []).indexOf('获利筹码') >= 0, JSON.stringify(short.basis.missing));
  ok('短数据：avail 少了获利盘那 15 分', short.basis.avail === 98 - 15, String(short.basis.avail));
  ok('短数据：90日涨停基因记进 partial',
    (short.basis.partial || []).some(x => x.indexOf('90日涨停基因') === 0), JSON.stringify(short.basis.partial));
  ok('短数据：zt90Win 是实际窗口', short.basis.zt90Win === 6, String(short.basis.zt90Win));
  ok('短数据：分数仍是有限数（不许因缺项变 NaN）', Number.isFinite(short.score), String(short.score));

  const tiny = call(mk(2), null);
  ok('极短数据(2根)：近3日上涨记进 partial',
    (tiny.basis.partial || []).some(x => x.indexOf('近3日上涨') === 0), JSON.stringify(tiny.basis.partial));

  const none = A.scoreStock({});
  ok('⛔ 无 K 线：score 是 null 不是 0', none.score === null, String(none.score));
  ok('无 K 线：basis.rows = 0', none.basis && none.basis.rows === 0);
  ok('无 K 线：missing 明写「全部（无K线）」',
    (none.basis.missing || []).join('').indexOf('无K线') >= 0, JSON.stringify(none.basis.missing));
}

// ════════ 【D】scoreNoteOf：把「够不够」如实说出来 ════════
console.log('【D】scoreNoteOf 唯一出口：数据不足时必须明说');
{
  ok('完整数据 → 不打扰（空串）', R.scoreNoteOf(62, call(mk(100), 0.8).basis) === '');
  const nt = R.scoreNoteOf(40, call(mk(6), null).basis);
  ok('短数据 → 说了几根 K 线', nt.indexOf('K线仅6根') >= 0, nt);
  ok('短数据 → 说了满分按多少计', nt.indexOf('满分按') >= 0, nt);
  ok('短数据 → 说了哪一项窗口不足', nt.indexOf('90日涨停基因') >= 0, nt);
  ok('无 K 线 → 明说「未评分」，不许显示成 0 分',
    R.scoreNoteOf(null, A.scoreStock({}).basis).indexOf('未评分') >= 0);
  ok('basis 缺失 → 返回空串不炸', R.scoreNoteOf(62, undefined) === '');
}

// ════════ 【E】源码契约：不许有第二份写法 ════════
console.log('【E】源码契约');
{
  // ⛔ 锚点不能用注释行（剥注释版里它已被抹成空行）
  const body = cut(AVS, 'function scoreStock(o) {', 'function limitUpProbability');
  ok('⛔ scoreStock 里不再有「没数据给 0 分」', body.indexOf('score: 0') < 0);
  ok('scoreStock 返回 basis', body.indexOf('basis:') >= 0);
  ok('scoreStock 记 missing', body.indexOf('missing.push') >= 0);
  ok('scoreStock 记 partial', body.indexOf('partial.push') >= 0);
  ok('server.js 精选池把 basis 存进池内项', SVS.indexOf('basis: _scoreBasis') >= 0);
  // ⛔ 2026-10-28 改钉：分数变量改名 score → scoreAdj（精选池改用「校准后分数」出说明，
  //    与参与排序的那把尺子同源）。原来钉字面量 scoreNoteOf(score, …) 会假红，
  //    判据改成钉语义：scoreNoteOf 必须拿 basis 一起算、且用的是同一个分数变量。
  ok('server.js 精选池生成 scoreNote',
    /scoreNoteOf\(\s*score(?:Adj)?\s*,\s*_scoreBasis\s*\)/.test(SVS));
  ok('/api/state 下发 needRule', SVS.indexOf('needRule: needRuleState(),') >= 0);
  ok('前端渲染 scoreNote 标记', HV.indexOf('snTag') >= 0);
  ok('前端处理 score 为 null 的情形', HV.indexOf('x.score == null ? \'-\' : x.score') >= 0);
  // ⛔ 反证：旧实现给 0 分，0 是一个"看起来有效的分" —— 会参与排序、会去比评分线
  ok('反证：旧实现把「没判」伪装成有效分', Number.isFinite(new Function('rows', 'return rows.length ? 62 : 0;')([])));
  ok('新实现：没判就是没判（不是有限数）', !Number.isFinite(A.scoreStock({}).score));
  const full = call(mk(100), 0.8), short = call(mk(6), null);
  ok('反证：短数据票的满分确实更低（同一条评分线 75 量的是两把尺子）',
    short.basis.avail < full.basis.avail, short.basis.avail + ' < ' + full.basis.avail);
}

// ════════ 【F】跨模块：同一份 K 线在不同模块够不够 ════════
console.log('【F】跨模块：同一份 K 线在 A 模块够、在 B 模块不够');
{
  const n = 6;
  ok('6 根：精选池判「够」', n >= R.needOf('pool'), 'pool=' + R.needOf('pool'));
  ok('6 根：涨停前扫描判「不够」', n < R.needOf('ztpre'), 'ztpre=' + R.needOf('ztpre'));
  ok('6 根：回测/学习判「不够」', n < R.needOf('backtest'), 'backtest=' + R.needOf('backtest'));
  ok('6 根：周线金叉判「不够」', n < R.needOf('weekly'), 'weekly=' + R.needOf('weekly'));
  ok('⛔ 这四把尺子确实不同（本轮要治的病）',
    R.needOf('pool') < R.needOf('ztpre') && R.needOf('ztpre') < R.needOf('weekly'));
  ok('且每一把都在表里有 note 解释为什么是这个数',
    ['pool', 'ztpre', 'weekly', 'backtest'].every(k => (R.NEED_RULE[k] || {}).note));
}

console.log('\n' + (FAIL ? '❌ ' + FAIL + ' / ' + N + ' 失败' : '✅ 全部通过 ' + N + ' 条断言'));
process.exit(FAIL ? 1 : 0);
