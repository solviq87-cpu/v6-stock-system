// ds 轮守门：样本库里 `prob` 装的是不是概率 —— 评分与概率不许进同一套校准档
//   两个百分比（概率）与技术评分虽然都是 0~100，但**不是同一个东西**：
//   评分集中在 55~80、概率集中在 20~65；混档后那个"实测命中率"两头都不代表。
const fs = require('fs');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')'); }

const src = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

function slice(startMark, endMark) {
  const i = src.indexOf(startMark);
  if (i < 0) throw new Error('找不到起点: ' + startMark);
  const j = src.indexOf(endMark, i);
  if (j < 0) throw new Error('找不到终点: ' + endMark);
  return src.slice(i, j + endMark.length);
}
const line = (mark) => {
  const i = src.indexOf(mark);
  if (i < 0) throw new Error('找不到: ' + mark);
  const j = src.indexOf('\n', i);
  return src.slice(i, j);
};

const blkKind = slice('const PROB_KIND = {', '\n};');
const fnKindOf = slice('function probKindOf(type) {', '\n}\n');
const fnLabel = slice('function probKindLabel(type) {', '\n}\n');
const fnKeys = slice('function empKeysOf(prob, type) {', '\n}\n');
const fnState = slice('function probKindState() {', '\n}\n');
const lnBucket = line('const empBucketOf = ');
const lnGroup = line('const empGroupOf = ');
const lnChase = line('const EMP_CHASE = ');
const lnEarly = line('const EMP_EARLY = ');

const impl = new Function('S', 'console',
  lnChase + '\n' + lnEarly + '\n' + lnBucket + '\n' + lnGroup + '\n' +
  blkKind + '\n' + fnKindOf + '\n' + fnLabel + '\n' + fnKeys + '\n' + fnState +
  '\nreturn { PROB_KIND, probKindOf, probKindLabel, empKeysOf, probKindState };')({ learn: { signals: [] } }, console);
const { PROB_KIND, probKindOf, probKindLabel, empKeysOf, probKindState } = impl;

console.log('=== A. 登记表 ===');
['pool', 'trend'].forEach(k => {
  ok(!!PROB_KIND[k], 'A 登记了 ' + k);
  eq(PROB_KIND[k].kind, 'score', 'A ' + k + ' 是评分不是概率');
  ok(!!PROB_KIND[k].why && PROB_KIND[k].why.length > 8, 'A ' + k + ' 写了为什么不是概率');
  ok(!!PROB_KIND[k].label, 'A ' + k + ' 有中文名');
});

console.log('\n=== B. probKindOf 唯一出口 ===');
eq(probKindOf('pool'), 'score', 'B1 精选池 → 评分');
eq(probKindOf('trend'), 'score', 'B2 趋势票 → 评分');
eq(probKindOf('bigmoney'), 'prob', 'B3 大单 → 概率');
eq(probKindOf('pre'), 'prob', 'B4 埋伏 → 概率');
eq(probKindOf('xyz_unknown'), 'prob', 'B5 ⛔ 未登记的不许默认成评分（默认概率，保守方向）');
eq(probKindLabel('pool'), '精选池技术评分', 'B6 中文名可用');

console.log('\n=== C. 分档键：两套刻度各走各的 ===');
eq(empKeysOf(70, 'pool')[0], '评分:未启动类|65-74', 'C1 评分类查评分档');
eq(empKeysOf(70, 'pool')[1], '评分|65-74', 'C2 评分类的全局回落也是评分档');
eq(empKeysOf(70, 'buzhang')[0], '追高类|65-74', 'C3 追高类概率查概率档');
eq(empKeysOf(70, 'buzhang')[1], '全部|65-74', 'C4 概率类的全局回落是概率档');
eq(empKeysOf(70, 'bigmoney')[0], '未启动类|65-74', 'C3b 未启动类概率也走概率档（族群照旧，只是不混评分）');
ok(empKeysOf(70, 'pool')[0].indexOf('全部') < 0, 'C5 ⛔ 评分类绝不会去拿「全部|」概率档');
ok(empKeysOf(70, 'bigmoney')[0].indexOf('评分') < 0, 'C6 ⛔ 概率类绝不会去拿评分档');
eq(empKeysOf(30, 'trend')[0], '评分:未启动类|<45', 'C7 低分也走评分档');

console.log('\n=== D. 反证：混档会把校准系数算歪 ===');
// 概率 70 档：100 条命中 60（模型说 70%，实测 60%，略低但不离谱）
// 评分 70 分：100 条命中 20（技术面好 ≠ 次日涨 3%）
const probN = 100, probHit = 60, scoreN = 100, scoreHit = 20;
const mixed = Math.round((probHit + scoreHit) / (probN + scoreN) * 100);
const pure = Math.round(probHit / probN * 100);
eq(mixed, 40, 'D1 老写法混在一起：70 档实测 40%');
eq(pure, 60, 'D2 新写法概率档：实测 60%');
// calibratedProb 的期望：70-79 档期望 0.72
const expect70 = 0.72;
const corrMixed = Math.max(0.7, Math.min(1.15, mixed / 100 / expect70));
const corrPure = Math.max(0.7, Math.min(1.15, pure / 100 / expect70));
ok(corrMixed < 0.7 + 1e-9, 'D3 ⛔ 混档后 corr 被压到下限 ' + corrMixed.toFixed(2) + '（真概率 70 的票被系统性打折）');
ok(Math.abs(corrPure - 0.83) < 0.02, 'D4 分开后 corr 是 ' + corrPure.toFixed(2) + '（只按概率样本自己的表现打折）');
ok(corrPure - corrMixed > 0.1, 'D5 两种算法差 ' + (corrPure - corrMixed).toFixed(2) + ' —— 差出来的就是评分样本的白拉');
// 推一层：真概率 70 的票，两种算法下最终推送分分别是多少
const finalMixed = Math.round(70 * corrMixed), finalPure = Math.round(70 * corrPure);
ok(finalPure - finalMixed >= 8, 'D6 ⛔ 同一只票，混档把它从 ' + finalPure + '% 压到 ' + finalMixed + '%（差 ' + (finalPure - finalMixed) + ' 个点，可能刚好跌破 55 门槛）');
ok(finalMixed < 55 && finalPure >= 55, 'D7 ⛔ 后果：混档下这只票被 55 门槛挡掉，分开后正常推送');

console.log('\n=== E. 源码：三处下游都按刻度分流 ===');
const stripC = (l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; };
const code = src.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);
const hcode = html.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);

ok(code.some(l => /bump\(ks\[0\], s\)/.test(l)), 'E1 empTable 用 empKeysOf 分流');
ok(!code.some(l => /bump\(empGroupOf\(s\.type\) \+ '\|' \+ b, s\)/.test(l)), 'E2 ⛔ empTable 不再无差别塞进概率档');
ok(code.some(l => /if \(probKindOf\(s\.type\) !== 'prob'\) continue;/.test(l)), 'E3 ⛔ 概率校准桶（S.learn.buckets）排除评分类');
ok(code.some(l => /probKind: probKindOf\(type\)/.test(l)), 'E4 logSignal 落盘时留痕 probKind');
ok(code.some(l => /_old\.probKind = probKindOf\(type\)/.test(l)), 'E5 覆盖旧样本时 probKind 一起更新');
ok(code.some(l => /probKind: probKindState\(\)/.test(l)), 'E6 /api/state 下发 probKind');
// ⛔ dq 轮教训：新增下发键必须同轮接线前端
ok(hcode.some(l => /s\.probKind/.test(l)), 'E7 ⛔ 前端同轮接线（后端算了没人用＝白算）');
ok(code.some(l => /const ks = empKeysOf\(prob, type\)/.test(l)), 'E8 empProb 按刻度查档');

console.log('\n=== F. probKindState 出口 ===');
const st = probKindState();
ok(Array.isArray(st.kinds), 'F1 返回登记表');
eq(st.kinds.length, Object.keys(PROB_KIND).length, 'F2 每个登记项都下发');
ok(!!st.note && /评分/.test(st.note), 'F3 带一句人话说明');
ok(st.sampleN && typeof st.sampleN.prob === 'number', 'F4 统计了概率样本条数');
const S2 = { learn: { signals: [
  { prob: 70, probKind: 'score' }, { prob: 60, probKind: 'prob' },
  { prob: null, probKind: 'prob' }, { prob: 55, type: 'pool' }   // 旧样本没 probKind → 按 type 兜
] } };
const st2 = new Function('S', 'console',
  lnChase + '\n' + lnEarly + '\n' + lnBucket + '\n' + lnGroup + '\n' + blkKind + '\n' + fnKindOf + '\n' + fnKeys + '\n' + fnState +
  '\nreturn probKindState();')(S2, console);
eq(st2.sampleN.score, 2, 'F5 评分样本 2 条（含按 type 兜底那条）');
eq(st2.sampleN.prob, 1, 'F6 概率样本 1 条（prob=null 的不计）');

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_probkind: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
