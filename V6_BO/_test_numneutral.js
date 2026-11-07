// dp 轮守门：同一个数，从算出来到说出来之间被改过几次
//   ⓵ 同一个「没取到」，不同字段不许有相反含义的兜底（profitRatio 给 0=最差档 / gap 给 0=已封板）
//   ⓶ 距涨停点数必须走真限幅（主板10/创业科创20/北交所30；ST 2026-04 起同主板），不许写死 10
//   ⓷ 送进模型的用中性兜底，面板展示的保留 null —— 不许拿中性值冒充真实数
//   ⓸ pct 取不到不许让概率变 NaN
const fs = require('fs');
const A = require('./analysis');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')'); }
function near(a, b, tol, m) { ok(Math.abs(a - b) <= tol, m + '  (got ' + a + ' want ~' + b + ')'); }

// ── 从源码切出真实实现（不复制，保证测的是线上那份） ──────────────────────
const src = fs.readFileSync('server.js', 'utf8');
function slice(startMark, endMark) {
  const i = src.indexOf(startMark);
  if (i < 0) throw new Error('找不到起点: ' + startMark);
  const j = src.indexOf(endMark, i);
  if (j < 0) throw new Error('找不到终点: ' + endMark);
  return src.slice(i, j + endMark.length);
}
const blockNumNeutral = slice('const NUM_NEUTRAL = {', '\n}\n');
const fnNumNeutral = slice('function numNeutral(key, raw) {', '\n}\n');
const fnNumGap = slice('function numGap(code, name, pctRaw) {', '\n}\n');
const fnNumGapRaw = slice('function numGapRaw(code, name, pctRaw) {', '\n}\n');

const body = blockNumNeutral + '\n' + fnNumNeutral + '\n' + fnNumGap + '\n' + fnNumGapRaw +
  '\nreturn { NUM_NEUTRAL, numNeutral, numGap, numGapRaw };';
const impl = new Function('A', 'console', 'Number', 'Number_isFinite', body)(A, console, Number, Number.isFinite);
const { NUM_NEUTRAL, numNeutral, numGap, numGapRaw } = impl;

console.log('\n=== A. 登记表完整性 ===');
['score', 'profitRatio', 'mainPct', 'zt90', 'turnover', 'gap'].forEach(k => {
  ok(!!NUM_NEUTRAL[k], '登记了字段 ' + k);
  if (NUM_NEUTRAL[k]) {
    ok(typeof NUM_NEUTRAL[k].neutral === 'number' && Number.isFinite(NUM_NEUTRAL[k].neutral), k + ' 的中性值是有限数字');
    ok(!!NUM_NEUTRAL[k].why && NUM_NEUTRAL[k].why.length > 8, k + ' 写了为什么是这个中性值');
    ok(!!NUM_NEUTRAL[k].label, k + ' 有中文名');
  }
});

console.log('\n=== B. numNeutral 出口行为 ===');
eq(numNeutral('score', 73), 73, 'B1 score 有值原样返回');
eq(numNeutral('score', 0), 0, 'B2 score 真 0 保留（0 是合法评分，不是没取到）');
eq(numNeutral('score', null), 50, 'B3 score 取不到 → 中性 50');
eq(numNeutral('score', undefined), 50, 'B4 score undefined → 中性 50');
eq(numNeutral('score', NaN), 50, 'B5 score NaN → 中性 50');
eq(numNeutral('profitRatio', null), 50, 'B6 ⛔ profitRatio 取不到必须是 50（中性），不是 0（全员套牢）');
eq(numNeutral('profitRatio', 0), 0, 'B7 profitRatio 真 0 保留（获利盘 0% 是真实观测）');
eq(numNeutral('profitRatio', 82.5), 82.5, 'B8 profitRatio 有值原样');
eq(numNeutral('mainPct', null), 0, 'B9 mainPct 中性 0（无流入无流出）');
eq(numNeutral('zt90', null), 0, 'B10 zt90 中性 0（无涨停基因是常态）');
eq(numNeutral('turnover', null), 0, 'B11 turnover 中性 0');
eq(numNeutral('gap', null), 8, 'B12 ⛔ gap 取不到必须是 8（中性），不是 0（已封板）');
eq(numNeutral('gap', 0), 0, 'B13 gap 真 0 保留（已封板是真实状态）');

// 未登记字段：要报错并回落，不许静默返回 0 冒充
const _err = console.error; let errMsg = '';
console.error = (m) => { errMsg += m; };
const unk = numNeutral('notAField', null);
console.error = _err;
ok(/未登记的字段/.test(errMsg), 'B14 未登记字段要 console.error 报警');
eq(unk, 0, 'B15 未登记字段回落 0（不崩）');

console.log('\n=== C. 反向兜底：profitRatio 与 gap 不许同向 ===');
// 这是本轮核心：两个字段的「没取到」都曾被写成 0，但 0 对它们的含义**相反**
const prN = NUM_NEUTRAL.profitRatio.neutral, gapN = NUM_NEUTRAL.gap.neutral;
ok(prN !== 0, 'C1 profitRatio 中性值不能是 0（0 = 全员套牢 = 最差档）');
ok(gapN !== 0, 'C2 ⛔ gap 中性值不能是 0（0 = 已封板 = 概率最高档）');
// 往模型里代入验证方向：取不到时两个都不该把概率推到极端
const base = { score: 50, mainPct: 0, profitRatio: prN, zt90: 0, sectorZT: 0, gap: gapN, turnover: 0, inflowStreakMin: 0 };
const pNeutral = A.limitUpProbability(base);
const pWorst = A.limitUpProbability(Object.assign({}, base, { profitRatio: 0, gap: 0 }));
ok(pNeutral < pWorst, 'C3 老写法（两个都给 0）把概率抬高到 ' + (pWorst * 100).toFixed(1) + '%，中性写法只有 ' + (pNeutral * 100).toFixed(1) + '%');
ok(pWorst / pNeutral > 2, 'C4 老写法与新写法差异显著（比值 ' + (pWorst / pNeutral).toFixed(2) + '），说明不是可忽略误差');

console.log('\n=== D. numGap 限幅正确（⛔ 原预选池写死 10） ===');
eq(numGap('600000', '浦发银行', 3), 7, 'D1 主板：10 - 3 = 7');
eq(numGap('300750', '宁德时代', 5), 15, 'D2 ⛔ 创业板：20 - 5 = 15（写死 10 会算成 5，白送 2.8 的 z）');
eq(numGap('688981', '中芯国际', 5), 15, 'D3 ⛔ 科创板：20 - 5 = 15');
eq(numGap('830799', '艾融软件', 5), 25, 'D4 ⛔ 北交所：30 - 5 = 25');
eq(numGap('600000', 'ST浦发', 2), 8, 'D5 主板 ST 与主板同限幅：10 - 2 = 8（2026-04 起 ±10%）');
eq(numGap('300750', 'ST宁德', 2), 18, 'D6 创业板 ST 仍 20%：20 - 2 = 18（板块优先、ST 其次）');
eq(numGap('600000', '浦发银行', -3), 13, 'D7 下跌票：10 - (-3) = 13（原 `Math.max(pct,0)` 会算成 10，少算 3 点）');
eq(numGap('600000', '浦发银行', 10), 0, 'D8 已封板：gap = 0');
eq(numGap('600000', '浦发银行', 10.04), 0, 'D9 已封板（1 位精度）：gap = 0');
// ⛔ 本轮主题：`|| 0` / Number(null) 会把「没取到」与「真涨 0%」混成一个数
ok(numGap('600000', '浦发银行', null) !== numGap('600000', '浦发银行', 0),
  'D10 ⛔ 「没取到」与「真涨 0%」必须算出不同的 gap（否则就是同一个数被改没了）');
eq(numGap('600000', '浦发银行', 0), 10, 'D11 真涨 0% → 距涨停 10 点');

console.log('\n=== E. pct 取不到不许污染概率成 NaN ===');
eq(numGap('600000', '浦发银行', null), 8, 'E1 pct null → 中性 8（不是 NaN）');
eq(numGap('600000', '浦发银行', undefined), 8, 'E2 pct undefined → 中性 8');
eq(numGap('600000', '浦发银行', NaN), 8, 'E3 pct NaN → 中性 8');
eq(numGap('600000', '浦发银行', 'abc'), 8, 'E4 pct 非数字串 → 中性 8');
const pNaN = A.limitUpProbability(Object.assign({}, base, { gap: numGap('600000', '浦发银行', null) }));
ok(Number.isFinite(pNaN), 'E5 中性兜底后概率仍是有限数字');
// 反证：老写法把「取不到」喂进去会怎样。两条路都不是 NaN，而是**两种不同但都错的数**：
//   ① undefined 参与减法 = NaN，但模型写的是 `Math.max(f.gap || 0, 0)`，NaN 是 falsy
//      → 被 `|| 0` 悄悄兜成 0 = 「已封板」= 概率最高档。不报错、不 NaN，最隐蔽。
//   ② null 参与减法 = 10 - 0 = 10（null 被强制成 0）→ 被当成「今天涨 0%」。
const pOldUndef = A.limitUpProbability(Object.assign({}, base, { gap: +(10 - undefined).toFixed(1) }));
const pSealed = A.limitUpProbability(Object.assign({}, base, { gap: 0 }));
const pFlat = A.limitUpProbability(Object.assign({}, base, { gap: 10 }));
ok(Number.isFinite(pOldUndef), 'E6 老写法碰 undefined 不产生 NaN（NaN 被 `f.gap || 0` 兜掉了）');
eq(pOldUndef, pSealed, 'E6b ⛔ 于是「距涨停未知」被当成「已封板」，概率 = 最高档 ' + (pSealed * 100).toFixed(1) + '%');
ok(pOldUndef > pNeutral * 2, 'E6c 这比中性写法高出 ' + (pOldUndef / pNeutral).toFixed(1) + ' 倍几率比');
eq(+(10 - null).toFixed(1), 10, 'E7 反证：老写法碰 null 被当成「涨 0%」→ gap=10');
ok(Math.abs(A.limitUpProbability(Object.assign({}, base, { gap: +(10 - null).toFixed(1) })) - pFlat) < 1e-12,
  'E7b 「没取到」与「真平盘」在老写法下算出同一个概率（' + (pFlat * 100).toFixed(1) + '%）');

console.log('\n=== F. numGapRaw：面板用，取不到返回 null 不编数 ===');
eq(numGapRaw('600000', '浦发银行', 3), 7, 'F1 有值原样');
eq(numGapRaw('600000', '浦发银行', null), null, 'F2 ⛔ 取不到返回 null（显示 -），不许编一个 8 说出去');
eq(numGapRaw('600000', '浦发银行', NaN), null, 'F3 NaN → null');
eq(numGapRaw('300750', '宁德时代', 5), 15, 'F4 创业板真限幅');
// 两个出口的关系：raw 为 null 时，numNeutral 兜底成中性；raw 有值时两者一致
eq(numNeutral('gap', numGapRaw('600000', '浦发银行', null)), 8, 'F5 raw=null → 模型侧兜底 8');
eq(numNeutral('gap', numGapRaw('600000', '浦发银行', 3)), 7, 'F6 raw=7 → 模型侧就是 7');
eq(numGap('300750', '宁德时代', 5), numGapRaw('300750', '宁德时代', 5), 'F7 有值时两个出口同值');

console.log('\n=== G. 源码断言：不许再有老写法 ===');
const isVer = (l) => l.startsWith('const APP_VER = ');
// ⛔ 源码断言必须剥注释：本轮新增的 NUM_NEUTRAL 注释里逐字引用了被改掉的旧写法
//    （`poolItem ? poolItem.score : 50`），不剥就会假红。
const stripC = (l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; };
const lines = src.split('\n');
const code = lines.filter(l => !isVer(l)).map(stripC);
ok(!code.some(l => /gap:\s*10\s*-\s*Math\.max/.test(l)), 'G1 不再有写死 `gap: 10 - Math.max(...)`');
ok(!code.some(l => /limitPctOf\([^)]*\)\s*-\s*s\.pct/.test(l)), 'G2 不再有 `limitPctOf(...) - s.pct` 裸算（NaN 会传播）');
ok(!code.some(l => /poolItem\s*\?\s*poolItem\.profitRatio\s*\|\|\s*0\s*:\s*0/.test(l)), 'G3 不再有 profitRatio 缺数据给 0');
ok(!code.some(l => /poolItem\s*\?\s*poolItem\.score\s*:\s*50/.test(l)), 'G4 score 中性值也收进登记表（不再散在调用点）');

// 6 个调用点：3 处 limitUpProbability 先算可空值再兜底（numNeutral('gap', ...)），
//    预选池分析 1 处（numNeutral('gap', numGapRaw(...))），盘中强势 1 处（numNeutral('gap', gapToLimit)），
//    预选池构造 1 处直接算（numGap(...)）
const gapCall = code.filter(l => /numNeutral\('gap'/.test(l)).length;
const gapDirect = code.filter(l => /numGap\(/.test(l) && !/function numGap/.test(l)).length;
eq(gapCall + gapDirect, 6, 'G5 6 个 gap 调用点全走唯一出口（got ' + gapCall + '+' + gapDirect + '）');
ok(gapCall === 5 && gapDirect === 1, 'G5b 5 处走 numNeutral/numGapRaw 兜底 + 预选池构造 1 处走 numGap（got ' + gapCall + '/' + gapDirect + '）');
// model 侧的字段出口：同一个字段在 4 个点用同一个函数
['score', 'profitRatio', 'zt90', 'mainPct', 'turnover'].forEach(k => {
  const n = code.filter(l => new RegExp("numNeutral\\('" + k + "'").test(l)).length;
  ok(n >= 4, 'G6 ' + k + ' 至少 4 个调用点走同一出口（got ' + n + '）');
});
// 距涨停文案不许再把 null 打出去
ok(!code.some(l => /\$\{x\.gapToLimit\}%/.test(l)), 'G7 文案不再直接打 ${x.gapToLimit}%（null 会显示 "null%"）');
ok(code.some(l => /x\.gapToLimit != null \? x\.gapToLimit \+ '%' : '-'/.test(l)), 'G8 文案取不到时说 -');

console.log('\n=== H. 中性值本身站得住 ===');
// profitRatio 中性 50：代入模型看贡献，应当接近「全市场一半人套牢」的直觉
const zAt = (pr) => 0.02 * Math.min(pr, 95);
near(zAt(NUM_NEUTRAL.profitRatio.neutral), 1.0, 0.01, 'H1 获利盘 50% 贡献约 +1.0 的 z');
near(zAt(0), 0, 0.001, 'H2 获利盘 0% 贡献 0（老写法等于抹掉了这一项）');
// gap 中性 8：贡献应为负（距涨停还远），不能是 0
const zgAt = (g) => -0.28 * Math.max(g, 0);
near(zgAt(NUM_NEUTRAL.gap.neutral), -2.24, 0.01, 'H3 距涨停 8 点贡献 -2.24 的 z');
eq(zgAt(0), 0, 'H4 距涨停 0 点不扣分（已封板，老写法等于默认全部已封板）');
ok(NUM_NEUTRAL.gap.neutral >= 5 && NUM_NEUTRAL.gap.neutral <= 12, 'H5 gap 中性值落在合理区间 5~12');

console.log('\n=== I. 两套「0~100 的分」不许共用一条中性值说明 ===');
ok(!!NUM_NEUTRAL.auctionScore, 'I1 竞价分单独登记（不与 score 共用）');
ok(NUM_NEUTRAL.auctionScore && NUM_NEUTRAL.score && NUM_NEUTRAL.auctionScore !== NUM_NEUTRAL.score,
  'I2 auctionScore 与 score 是两条独立记录');
eq(numNeutral('auctionScore', null), 50, 'I3 竞价分取不到 → 中性 50');
eq(numNeutral('auctionScore', 0), 0, 'I4 竞价分真 0 保留');
eq(numNeutral('auctionScore', 65), 65, 'I5 竞价分有值原样');
// 竞价分 → 涨停概率：老写法把取不到压到基准 18%，中性写法约 49%
const ztOf = (sc) => 18 + sc * 0.62;
near(ztOf(numNeutral('auctionScore', null)), 49, 0.01, 'I6 中性竞价分 → 涨停概率约 49%');
near(ztOf(0), 18, 0.01, 'I7 反证：老写法把「取不到」当成 0 分 → 概率只有 18%');
ok(ztOf(numNeutral('auctionScore', null)) > ztOf(0) * 2, 'I8 两者差一倍以上，说明不是可忽略的取整误差');

console.log('\n=== J. 源码：同一个字段不许被 `||` 链换三种来源 ===');
ok(!code.some(l => /score:\s*c\.score\s*\|\|\s*c\.prob\s*\|\|\s*0/.test(l)),
  'J1 ⛔ 不再有 `score: c.score || c.prob || 0`（概率冒充评分 + 真 0 被跳过）');
ok(code.some(l => /c\.score != null \? c\.score : numNeutral\('score', null\)/.test(l)),
  'J2 持仓评分：取不到走中性值，显式判空（真 0 保留）');
ok(!code.some(l => /let prob = 18 \+ \(x\.score \|\| 0\)/.test(l)),
  'J3 竞价分 → 概率不再把取不到当 0 分');
ok(code.some(l => /numNeutral\('auctionScore', x\.score\)/.test(l)),
  'J4 竞价分 → 概率走登记表中性值（hz 轮四段映射，不再固定 18+sc*0.62）');

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_numneutral: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
