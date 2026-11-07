// 守门：预测力口径唯一 —— 驱动决策的统计只认 sig.nd（cy 轮 · 角度「只在成功时才有意义的统计」）
//
// 一条样本身上有两个"回验结果"，混用是系统性的：
//   s.resolved = **信号当天**那根K线（resolveWithKline）→ 既成事实，不是预测力。
//     票发出信号时往往已经在涨甚至已封板 —— "当天涨停"只是把发生过的事再记一遍，
//     可兑现收益却是 0（2026-10-01 实测：存量 1752 条里 1152 条是这个口径）。
//   s.nd       = **信号日收盘 → 次日最高**（resolveNextDay）→ 这才是"提前发现、买了会赚"。
//
// ⛔ 后果不是"数字差一点"，是**决策翻转**：similarSelfOptimize 按 hitRate 的 25/55 两档决定
//    相似度门槛。本机真实样本实测：similar 旧口径(当天) 32% → 落在 25~55 中间"不动"；
//    新口径(次日) **61%** → 越过 55 → "跟得准、放宽多推"。同一批样本，两个相反的结论。
//    buzhang 同样：26% → 59%。
//
// 本套件把 ndHit / ndLu / bigMoneyStats 原样抠进沙箱真跑，并用"当天涨停、次日跌"的
// 样本做反证（旧口径算命中、新口径不算）。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m); } };

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });
const L = SV.split('\n');

// 单行箭头（ndHit / ndLu）没有花括号，按行抓
function grabLine(re) {
  for (const l of L) if (re.test(l)) return l;
  throw new Error('没找到 ' + re);
}
// 多行函数（花括号配对）
function grab(re) {
  for (let i = 0; i < L.length; i++) {
    if (!re.test(L[i])) continue;
    let depth = 0, body = '';
    for (let j = i; j < L.length; j++) {
      body += L[j] + '\n';
      for (const ch of L[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && j >= i) break;
    }
    return body;
  }
  throw new Error('没找到 ' + re);
}
// ⚠️ 真跑用的函数体必须从**原始源码**抠（不能用 SV）：stripNoise 会把正则字面量
//   `/-/g` 里的 `/-/` 当噪声吃掉 → 抽出来变成 `.replace(   g, '')`，一执行就 ReferenceError。
const RL = SRC.split('\n');
function grabRaw(re) {
  for (let i = 0; i < RL.length; i++) {
    if (!re.test(RL[i])) continue;
    let depth = 0, body = '';
    for (let j = i; j < RL.length; j++) {
      body += RL[j] + '\n';
      for (const ch of RL[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && j >= i) break;
    }
    return body;
  }
  throw new Error('没找到 ' + re);
}
const S_NDHIT = grabLine(/^const ndHit = /);const S_NDLU = grabLine(/^const ndLu = /);
const S_BUCKET = grabLine(/^const bmBucket = /);
const S_BMSTAT = grab(/^function bigMoneyStats\(/);

// ── 沙箱：bigMoneyStats 的依赖用最小实现注入 ──────────────────────────
const S = { learn: { signals: [] } };
const isLiveSample = () => true;
const normDate = d => String(d == null ? '' : d).replace(/-/g, '');
// dayStats 用源码原样抠（它内部现在也走 ndHit）
const S_DAYSTATS = grab(/^function dayStats\(/);

const F = new Function('S', 'isLiveSample', 'normDate',
  S_NDHIT + '\n' + S_NDLU + '\n' + S_BUCKET + '\n' + S_DAYSTATS + '\n' + S_BMSTAT + '\n' +
  'return { ndHit, ndLu, bigMoneyStats, dayStats };');
const M = F(S, isLiveSample, normDate);

console.log('=== 真跑：ndHit / ndLu 只认 sig.nd ===');
ok(M.ndHit({ nd: { hit: true } }) === true, '① nd.hit=true → 命中');
ok(M.ndHit({ resolved: { hit: true } }) === false,
  '② ⛔ 只有 resolved.hit=true（当天口径）**不算命中** —— 既成事实不是预测力');
ok(M.ndHit({}) === false && M.ndHit(null) === false, '③ 空样本不炸，返回 false');
ok(M.ndLu({ resolved: { limitUp: true }, nd: { limitUp: false } }) === false,
  '④ 当天涨停但次日没涨停 → 不算"真涨停"（这正是旧口径虚高的来源）');

// ── hx 轮：auczt 是唯一例外（预测当日封板 → 用 resolved 回验）──
console.log('\n=== 真跑：auczt 例外口径 ===');
const dsAuczt = M.dayStats([
  { type: 'auczt', date: '2026-10-01', resolved: { limitUp: true } },
  { type: 'auczt', date: '2026-10-01', resolved: { limitUp: false } },
  { type: 'bigmoney', date: '2026-10-01', nd: { hit: true } },
]);
ok(dsAuczt.hit === 2, '⑤ auczt 用 resolved.limitUp，其它仍用 nd.hit（2 命中 / 3 条）');

// ── 真跑 bigMoneyStats：只统计有 nd 的样本 ────────────────────────────
console.log('\n=== 真跑 bigMoneyStats ===');
S.learn.signals = [
  // ① 只有 resolved（当天涨停）—— 次日还没走出来，不该进统计
  { type: 'bigmoney', prob: 80, date: '2026-10-01', ts: 1, resolved: { hit: true, limitUp: true } },
  // ② 有 nd，次日达标（当天也在涨 → 旧口径同样算命中）
  { type: 'bigmoney', prob: 80, date: '2026-10-02', ts: 2, resolved: { hit: true, limitUp: false }, nd: { hit: true, limitUp: true } },
  // ③ 有 nd，次日没达标（但当天是涨的 → 旧口径会算命中）
  { type: 'bigmoney', prob: 60, date: '2026-10-03', ts: 3, resolved: { hit: true, limitUp: false }, nd: { hit: false, limitUp: false } }
];
const st = M.bigMoneyStats();
ok(st.n === 2, `⑤ 只统计有 nd 的样本（实测 n=${st.n}，旧口径会把 3 条全算进去）`);
ok(st.hitRate === 50, `⑥ 命中率只按 nd 算（实测 ${st.hitRate}%，旧口径会是 100%）`);
ok(st.luRate === 50, `⑦ 真涨停率只按 nd 算（实测 ${st.luRate}%，旧口径会把①的当天涨停算进来）`);

// 反证：把口径换回 resolved，数字立刻虚高
const OLD = S_BMSTAT
  .replace(/s\.nd && !s\.void && isLiveSample\(s\)/, 's.resolved && isLiveSample(s)')
  .replace(/if \(ndLu\(s\)\) buckets\[b\]\.lu\+\+;/, 'if (s.resolved.limitUp) buckets[b].lu++;')
  .replace(/res\.filter\(ndLu\)/g, 'res.filter(s => s.resolved.limitUp)')
  .replace(/res\.filter\(ndHit\)/g, 'res.filter(s => s.resolved.hit)');
const F2 = new Function('S', 'isLiveSample', 'normDate', 'ndHit', 'ndLu',
  S_BUCKET + '\n' + S_DAYSTATS + '\n' + OLD + '\nreturn { bigMoneyStats };');
const M2 = F2(S, isLiveSample, normDate, M.ndHit, M.ndLu);
const old = M2.bigMoneyStats();
ok(old.n === 3 && old.hitRate === 100,
  `⑧ 反证：换回旧口径 → n=${old.n}、命中率 ${old.hitRate}%（把当天既成事实当预测业绩）`);
ok(old.hitRate - st.hitRate >= 30,
  `⑨ 反证：两种口径差 ${old.hitRate - st.hitRate} 个点 —— 足以翻转"放宽/收紧"的决策`);

// ── 静态：驱动决策与对外承诺的统计，不许再用 resolved.hit / resolved.limitUp ──
console.log('\n=== 静态：口径收口 ===');
// 白名单：这几处是**写** resolved 字段本身（转换/重算）或识别事后样本，不是拿它去做预测力判断
// ⛔ hx 轮新增：auczt 预测当日封板 → 用 resolved.limitUp 回验（唯一例外）。
const KEEP = [
  /maxGain: sig\.resolved\.maxGain, limitUp: sig\.resolved\.limitUp/,  // 历史回测样本把 resolved 转成 nd
  /s\.resolved && s\.resolved\.limitUp && \+\(s\.resolved\.maxGain/,   // isPostHocSample：识别"登记价就在板上"，必须用当天
  /if \(nh !== sg\.resolved\.hit\)/,                                   // 口径切换时重算 resolved.hit
  /s\.type === 'auczt' \? !!\(s\.resolved && s\.resolved\.limitUp\)/,   // hx 轮：auczt 唯一例外，用当日封板回验
  /isAuczt \? !!\(s\.resolved && s\.resolved\.limitUp\)/,              // empTable bump 内联 auczt 例外
  /s2\.type === 'auczt' \? !!\(s2\.resolved && s2\.resolved\.limitUp\)/  // pathStats 内联 auczt 例外
];
const bad = [];
L.forEach((l, i) => {
  if (!/resolved\.(hit|limitUp)/.test(l)) return;
  if (/^\s*\/\//.test(l.trim())) return;               // 注释里引用旧写法不算
  if (KEEP.some(re => re.test(l))) return;
  bad.push('L' + (i + 1) + ': ' + l.trim().slice(0, 90));
});
ok(bad.length === 0, `⑩ 除两处白名单外，源码里不再出现 resolved.hit / resolved.limitUp${
  bad.length ? ' → ' + bad.join(' | ') : ''}`);

// ⑪ 八处关键统计：nd 为默认口径，auczt 是唯一例外（用 resolved.limitUp）
const need = [
  ['bigMoneyStats 样本过滤', /s\.type === 'bigmoney' && s\.nd && !s\.void && isLiveSample\(s\)/],
  ['similarStats 样本过滤', /s\.type === 'similar' && s\.nd && !s\.void && isLiveSample\(s\)/],
  ['趋势闭环样本过滤', /filter\(s => s\.nd && !s\.void && isLiveSample\(s\)\)/],
  ['bmEmpBuckets（A/B 的 B 组）', /s\.type === 'bigmoney' && s\.nd && !s\.void && isLiveSample\(s\)/],
  ['dayStats 命中', /s\.type === 'auczt' \? !!\(s\.resolved && s\.resolved\.limitUp\) : !!\(s\.nd && s\.nd\.hit\)/],
  ['learnRate', /s\.type === 'auczt' \? !!\(s\.resolved && s\.resolved\.limitUp\) : !!\(s\.nd && s\.nd\.hit\)/],
  ['分档校准分桶', /s\.type === 'auczt' \? !!\(s\.resolved && s\.resolved\.limitUp\) : !!\(s\.nd && s\.nd\.hit\)/],
  ['条件加权 pathStats', /s2\.type === 'auczt' \? !!\(s2\.resolved && s2\.resolved\.limitUp\) : !!\(s2\.nd && s2\.nd\.hit\)/]
];
for (const [name, re] of need) ok(re.test(SV), `⑪ ${name} 已改用 nd 口径（auczt 例外）`);

// ⑪b 统一收口：所有 filter 里的 nd 统计入口必须显式挡 void
//   isLiveSample 只排除回测/事后样本，**不排 void** —— 实测库内 434 条 void 里 110 条仍带 nd
//   （43 条 even hit），漏挡就会把作废样本算进命中率。
{
  const miss = [...SV.matchAll(/filter\(s =>[^\n]*s\.nd && isLiveSample\(s\)[^\n]*/g)].map(m => m[0].trim());
  ok(miss.length === 0,
    `⑪b 统计入口一律挡 void（实测漏挡 ${miss.length} 处${miss.length ? ' → ' + miss[0].slice(0, 80) : ''}）`);
}

// ⑫ 两处 adjReview 的达标判据用 ndHit / ndLu / quality（不是 s.resolved && s.resolved.hit）
// ⛔ 2026-10-08 改判据：trendSelfOptimize 的复核改用 quality（strong+ok）作为真实命中率判据，
//    这是"不要只看上涨，还要看回落，综合评判"的一部分。正则跟着认新写法。
// ⛔ iq 轮（2026-10-17）：大单涨停闭环退役（bigMoneySelfOptimize→bigMoneyStatsRefresh），
//    adjReview 调用点从 3 处减到 2 处（相似 + 趋势）—— 计数跟着改，语义不变。
const revs = [...SV.matchAll(/adjReview\(([^;]*?)\)\s*;/g)].map(m => m[1]);
ok(revs.length === 2 && revs.every(r => /ndHit|ndLu|quality/.test(r)),
  `⑫ 两处复核的达标判据都走 ndHit / ndLu / quality（实测 ${revs.filter(r => /ndHit|ndLu|quality/.test(r)).length}/2）`);

// ⑬ 对外文案写"次日"就必须用 nd（typeHist）
const th = grab(/^function typeHist\(/);
ok(/次日涨≥/.test(th) && /ndHit|ndLu/.test(th) && !/s\.resolved\.hit/.test(th),
  '⑬ typeHist 文案承诺"次日涨≥N%"，数就必须是 nd 口径（不能拿当天既成事实兑现承诺）');

// ⑭ 口径修正要两边一起修（改 HIT_THR 时 resolved 与 nd 都要重算）
const fix = SV.match(/if \(sg\.nd && sg\.nd\.maxGain != null\)/);
ok(!!fix, '⑭ 命中口径切换时 nd 那一头也跟着重算（否则又变成两套数）');

// ── B2 轮：nd 开盘价三件套 + 幂等判据加严（否则存量旧 nd 永远补不进新字段） ──
console.log('\n=== 静态：resolveNextDay 开盘价三件套（B2 轮） ===');
const S_RND = grab(/^function resolveNextDay\(/);
ok(/open: hasOpen \? nxOpen : null/.test(S_RND), '⑮ nd 写 open（缺开盘价写 null，不拿 0 冒充）');
ok(/openGap: hasOpen \?/.test(S_RND) && /oneLine: hasOHL \?/.test(S_RND),
  '⑯ nd 写 openGap / oneLine（hasOHL 守门：缺 OHLC 写 null 不写 false，"没有数据"≠"不是一字板"）');
ok(/A\.isOneLineBoard\(/.test(S_RND), '⑰ 一字板判定走 analysis 唯一入口 isOneLineBoard（同一概念禁两份实现）');
ok(/sig\.nd && sig\.nd\.date === nd && sig\.nd\.openGap !== undefined/.test(S_RND),
  '⑱ 幂等判据含 openGap —— 只判 date 会把旧版 nd 永久跳过，开盘价三件套永远补不进去');

// ── 2026-10-28 学习闭环：深回验必须产出权威口径 nd ──────────────────────
// 实证 bug：resolveSignalsDeep 待验集合写 !s.resolved，而 resolved 是【当日】口径、
// 标定/学习只认【次日】口径 nd → "已 resolved 但仍缺 nd"的样本被永久排除在深回验外，
// 缓存里没它的K线就再也补不上（000078 ST海王 20261020 卡死为死样本）。
// 且补拉K线后只调 resolveWithKline（产 resolved），从不调 resolveNextDay → 深回验产不出 nd。
console.log('\n=== 静态+真跑：resolveSignalsDeep 深回验口径（2026-10-28 修） ===');
const S_DEEP = grab(/^async function resolveSignalsDeep\(/);
ok(/resolveNextDay\(/.test(S_DEEP),
  '⑲ ⛔ 深回验必须调 resolveNextDay —— 只调 resolveWithKline 产出的是 resolved(当日口径)，标定/学习不认');
ok(!/filter\(s => !s\.resolved && !s\.void\)/.test(S_DEEP),
  '⑳ ⛔ 旧判据「!s.resolved && !s.void」已废弃 —— 它把"已 resolved 但仍缺 nd"的样本永久排除（实证 000078 ST海王 20261020 卡死）');
const mNeed = S_DEEP.match(/const needsOutcome = ([^;]+);/);
ok(!!mNeed, '㉑ 待验判据抽为 needsOutcome（口径集中一处，不许散落重写）');
if (mNeed) {
  const needsOutcome = new Function('s', 'return (' + mNeed[1] + ')(s);');
  ok(needsOutcome({ type: 'similar', resolved: { hit: true } }) === true,
    '㉒ ⛔ 已 resolved 但缺 nd 的普通样本 → 仍须在待验集合内（否则永远验不上，成死样本）');
  ok(needsOutcome({ type: 'similar', nd: { hit: true } }) === false,
    '㉓ 已有 nd → 不再待验（幂等，不重复拉K线浪费额度）');
  ok(needsOutcome({ type: 'auczt', resolved: { limitUp: true } }) === false,
    '㉔ auczt 有 resolved 即算回验完成（唯一豁免口径，与 empTable L1758 一致）');
  ok(needsOutcome({ type: 'auczt' }) === true, '㉕ auczt 无 resolved 仍待验');
  ok(needsOutcome({ type: 'bigmoney', resolved: { hit: true } }) === true,
    '㉖ ⛔ 非 auczt 类型一律以 nd 为准，resolved 不算回验完成（aucres 等同理，不许误豁免）');
}
ok(/!s\.void && needsOutcome\(s\)/.test(S_DEEP), '㉗ void 作废样本一律不参与深回验（不进标定）');

// ── 2026-10-28 复查四修：未回验入分母 / 剪枝三套上限 / 跌停一刀切 / 死字段 ──────────
// 这四条的共同点：都不报错、面板照样有数，但**数是错的**，而且都在决策链上。
console.log('\n=== 2026-10-28 四修：分母口径 / 剪枝上限 / 跌停限幅 / 趋势死字段 ===');

// P1：recomputeBuckets 的实盘分母必须先过「有权威口径」
const S_RCB = grab(/^function recomputeBuckets\(/);
ok(/const liveAll = all\.filter\(isLiveSample\)/.test(S_RCB) && /const live = liveAll\.filter\(hasOutcome\)/.test(S_RCB),
  '㉘ ⛔ 实盘分母必须先过 hasOutcome —— 原写法 live=all.filter(isLiveSample) 把「次日还没验」的样本按 0 命中算进去');
const mHas = S_RCB.match(/const hasOutcome = ([^;]+);/);
ok(!!mHas, '㉙ 回验完成判据抽为 hasOutcome（与 resolveSignalsDeep.needsOutcome 严格互补）');
if (mHas) {
  const hasOutcome = new Function('s', 'return (' + mHas[1] + ')(s);');
  ok(hasOutcome({ type: 'similar', resolved: { hit: true } }) === false,
    '㉚ ⛔ 已 resolved 但缺 nd → 不进分母（实测 70/1352 条这样把命中率从 23.4% 稀释到 22%）');
  ok(hasOutcome({ type: 'similar', nd: { hit: false } }) === true,
    '㉛ 有 nd 即使没命中也必须进分母（不能只统计命中的那批）');
  ok(hasOutcome({ type: 'auczt', resolved: { limitUp: false } }) === true,
    '㉜ auczt 有 resolved 即算有结论（唯一豁免口径，与 empTable 一致）');
  ok(hasOutcome({ type: 'auczt' }) === false, '㉝ auczt 无 resolved 不进分母');
}
ok(/S\.learn\.pendingVerify = liveAll\.length - live\.length/.test(S_RCB),
  '㉞ 被剔掉的条数写入 pendingVerify（不再静默吞掉，面板/自检可见）');

// P2：剪枝上限必须单一真源
const S_SEED = grab(/^async function seedLearnFromHistory\(/);
ok(!/slice\(-1500\)/.test(S_SEED),
  '㉟ ⛔ slice(-1500) 已删 —— 它把 2600 条一次砍到 1500（−42%），且专切最老整天，正违反「绝不整体丢天」');
ok(/pruneSignals\(\)/.test(S_SEED), '㊱ 改调 pruneSignals()：按天均分 + 余额回补，上限单一真源');

// P3：跌停按该票实际限幅（20cm/30cm 不许按 -9.5 一刀切）
const S_PLS = grabRaw(/^function pushLearnStats\(/);
ok(/A\.limitPctOf\(s\.code, s\.name\)/.test(S_PLS), '㊲ 跌停按该票实际限幅判（创业板/科创板 20%、北交所 30%）');
ok(!/p <= -9\.5/.test(S_PLS), '㊳ ⛔ 硬编码 -9.5 已删');
ok(!/st\.n && st\.dn\+\+/.test(S_PLS), '㊴ 去掉恒真前缀 st.n &&（上一行刚 ++ 过，永远为真）');
{
  // 真跑：创业板 −13.11% 是"大跌"但不是跌停；主板 −9.9% 才是跌停
  const Afk = { limitPctOf: c => (String(c).startsWith('30') || String(c).startsWith('68') || String(c).startsWith('8')) ? 20 : 10 };
  const S3 = { learn: { signals: [
    { type: 'bigmoney', date: '2026-10-28', code: '301169', name: '创业板票', nd: { nextPct: -13.11 } },
    { type: 'bigmoney', date: '2026-10-28', code: '600001', name: '主板票', nd: { nextPct: -9.9 } }
  ] } };
  const F3 = new Function('S', 'A', '_pushLearnCache', S_PLS + '\nreturn { pushLearnStats };');
  const r3 = F3(S3, Afk, { t: 0, map: {} }).pushLearnStats();
  ok(r3.bigmoney && r3.bigmoney.dt === 1,
    `㊵ 真跑：dt=${r3.bigmoney && r3.bigmoney.dt}（−13.11% 创业板不算跌停、−9.9% 主板算；旧口径会是 2）`);
  // 反证：换回硬编码 -9.5
  const OLD3 = S_PLS.replace(/const lim = A\.limitPctOf\(s\.code, s\.name\);/, 'const lim = 10;');
  const r3o = new Function('S', 'A', '_pushLearnCache', OLD3 + '\nreturn { pushLearnStats };')(
    S3, Afk, { t: 0, map: {} }).pushLearnStats();
  ok(r3o.bigmoney.dt === 2, `㊶ 反证：换回一刀切 -9.5 → dt=${r3o.bigmoney.dt}，把创业板 −13.11% 记成跌停（dtRate 虚高→推送力度被多降档）`);
}

// P4：日报「趋势策略」行不许再读无人写入的死字段
const S_TST = grabRaw(/^function trendStats\(/);
ok(/const trend = trendStats\(\)/.test(SV), '㊷ 日报「趋势策略」行改用 trendStats() 就地统计');
ok(!/S\.learn\.trend\b/.test(SV),
  '㊸ ⛔ 死字段 S.learn.trend 不再被读（全项目无人写入 → trend.n>=5 恒 false，那一行从来没出现过）');
{
  const S4 = { learn: { signals: [
    { type: 'trend', date: '2026-10-28', nd: { hit: true, limitUp: true } },
    { type: 'trendsig', date: '2026-10-28', nd: { hit: false, limitUp: false } },
    { type: 'trend', date: '2026-10-27', resolved: { hit: true } },          // 缺 nd → 不进
    { type: 'pool', date: '2026-10-27', nd: { hit: true, limitUp: true } },   // 非趋势 → 不进
    { type: 'trend', date: '2026-10-26', nd: { hit: true, limitUp: true }, void: true }  // void → isLiveSample 之外，靠调用方
  ] } };
  const F4 = new Function('S', 'isLiveSample', 'normDate', 'ndLu', 'ndHit', 'MIN_LEARN_DAYS',
    S_DAYSTATS + '\n' + S_TST + '\nreturn { trendStats };');
  const t4 = F4(S4, isLiveSample, normDate, M.ndLu, M.ndHit, 5).trendStats();
  ok(t4.n === 2, `㊹ 真跑：趋势只认 trend/trendsig + 有 nd + 非 void（实测 n=${t4.n}，旧写法恒为 0 条）`);
  ok(t4.luRate === 50 && t4.hitRate === 50, `㊺ 涨停率/命中率按 nd 口径（实测 ${t4.luRate}% / ${t4.hitRate}%）`);
}

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail ? 1 : 0);
