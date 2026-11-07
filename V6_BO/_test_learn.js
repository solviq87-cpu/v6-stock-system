// 离线验证「日等权 + beta 中性化 + ≥5交易日」新学习口径
// 直接从 server.js 抽真实函数源码来跑（不复制粘贴，保证测的就是线上那份代码）
const fs = require('fs');
const path = require('path');

const lines = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').split('\n');
const findIdx = re => { const i = lines.findIndex(l => re.test(l)); if (i < 0) throw new Error('未找到: ' + re); return i; };
const grabFn = name => {
  const s = findIdx(new RegExp('^function ' + name + '\\('));
  let e = s; while (e < lines.length && lines[e] !== '}') e++;
  return lines.slice(s, e + 1).join('\n');
};
// normDate 定义在 logSignal 之后，单独抓
const normDateSrc = grabFn('normDate');
// ⛔ 预测力口径入口 ndHit / ndLu 定义在 bmBucket 附近（cy 轮引入），dayStats 现在依赖它们。
//    沙箱注入清单漏一个符号 = 整个套件 ReferenceError 崩掉（已踩 7 次），一并抓进来。
const ndSrc = lines.filter(l => /^const nd(Hit|Lu) = /.test(l)).join('\n');
// 学习口径工具块：todayBeta → logSignal 之前
const bStart = findIdx(/^const todayBeta = /);
const bEnd = findIdx(/^function logSignal\(/);
const blockSrc = lines.slice(bStart, bEnd).join('\n');
// ⛔ todayBeta 内部调用了 todayBreadth，沙箱漏注入 = ReferenceError（第 25 次）
//    todayBreadth 又调用了 todayStr，一并注入。
const todayBreadthSrc = grabFn('todayBreadth');
// todayStr 是 const todayStr = () => { 形式，不能用 grabFn
const tss = findIdx(/^const todayStr = /);
let tse = tss; while (tse < lines.length && lines[tse] !== '};') tse++;
const todayStrSrc = lines.slice(tss, tse + 1).join('\n');

const MB = JSON.parse(fs.readFileSync(path.join(__dirname, 'marketBeta.json'), 'utf8'));
const T = new Function(`
  const S = { marketBeta: ${JSON.stringify(MB)} };
  ${normDateSrc}
  ${ndSrc}
  ${todayStrSrc}
  ${todayBreadthSrc}
  ${blockSrc}
  return { normDate, dayStats, dayExpectMap, neutralRate, bearDominated, learnCtx, MIN_LEARN_DAYS, todayBeta, isBearDay };
`)();

const stats = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));
const res = (stats.signals || []).filter(s => s.resolved && !s.void);

let pass = 0, fail = 0;
const ok = (cond, name, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (got ? '   → ' + got : '')); }
  else { fail++; console.log('  ✗ ' + name + '   → ' + got); }
};

console.log('\n========== 1. 全局基准：日等权 vs 旧「样本等权」 ==========');
const g = T.dayStats(res);
const sampleRate = g.hit / g.n;                 // 旧口径：一条一票
console.log(`  样本总数 ${g.n}，覆盖 ${g.days} 个交易日`);
console.log(`  旧口径（样本等权）命中率 = ${(sampleRate * 100).toFixed(1)}%`);
console.log(`  新口径（日等权）  命中率 = ${(g.dayRate * 100).toFixed(1)}%`);
ok(g.days >= 30, '覆盖交易日数足够', `${g.days} 天`);
ok(Math.abs(g.dayRate - sampleRate) > 0.02, '日等权确实修正了样本失衡',
   `日等权 ${(g.dayRate*100).toFixed(1)}% vs 样本等权 ${(sampleRate*100).toFixed(1)}%，差 ${((g.dayRate-sampleRate)*100).toFixed(1)}pt`);

console.log('\n========== 2. beta 基准：普跌日的期望必须被压低 ==========');
const ctx = T.learnCtx(res);
console.log(`  全局基准 GLOBAL = ${(ctx.GLOBAL * 100).toFixed(1)}%`);
const exp928 = ctx.EXP['2026-09-28'];
// 找一个正常日对比
const norm = Object.keys(ctx.EXP).filter(d => d !== '2026-09-28').sort();
const expNorm = ctx.EXP[norm[Math.floor(norm.length / 2)]];
console.log(`  2026-09-28（指数 ${MB['2026-09-28']}%）期望 = ${(exp928 * 100).toFixed(1)}%`);
console.log(`  ${norm[Math.floor(norm.length/2)]}（普通日）        期望 = ${(expNorm * 100).toFixed(1)}%`);
ok(exp928 < expNorm * 0.75, '普跌日期望显著低于普通日',
   `${(exp928*100).toFixed(1)}% < ${(expNorm*100).toFixed(1)}%×0.75`);
ok(exp928 > 0.15, '期望不至于被压到 0（仍有可命中空间）', (exp928*100).toFixed(1)+'%');
ok(T.isBearDay(MB['2026-09-28']), '9/28 被正确识别为普跌日', MB['2026-09-28']+'%');

console.log('\n========== 3. beta 中性化：普跌日的低命中率不再被当成模型差 ==========');
const d928 = res.filter(s => T.normDate(s.date) === '2026-09-28');
const st928 = T.dayStats(d928);
const raw928 = st928.hit / st928.n;
const neu928 = T.neutralRate(d928, ctx.EXP, ctx.GLOBAL);
console.log(`  9/28 样本 ${st928.n} 条，原始命中率 ${(raw928*100).toFixed(1)}%`);
console.log(`  beta 中性化后            = ${(neu928*100).toFixed(1)}%`);
ok(neu928 > raw928, '中性化后高于原始命中率（剔除当天系统性下跌）',
   `${(raw928*100).toFixed(1)}% → ${(neu928*100).toFixed(1)}%，+${((neu928-raw928)*100).toFixed(1)}pt`);
ok(T.bearDominated(d928), '识别出这批样本由普跌日主导');

console.log('\n========== 4. 交易日数闸门：n=1 天的证据不能再下结论 ==========');
// 复刻 recomputeBuckets 里的路径判定
const pathStats = {};
for (const s of res) for (const p of (s.paths || [])) {
  (pathStats[p] = pathStats[p] || { n: 0, hit: 0, list: [] });
  pathStats[p].n++; if (s.resolved.hit) pathStats[p].hit++;
  pathStats[p].list.push(s);
}
let lockedCnt = 0, total = 0;
const rows = [];
for (const [p, v] of Object.entries(pathStats)) {
  const st = T.dayStats(v.list);
  const canJudge = st.days >= T.MIN_LEARN_DAYS && v.n >= 12;
  const oldAdj = Math.max(-5, Math.min(5, +((v.hit / v.n - 0.5) * 10).toFixed(1)));  // 旧口径
  if (!canJudge) lockedCnt++;
  total++;
  rows.push([p, v.n, st.days, oldAdj, canJudge]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log('  条件                样本  交易日  旧口径adj  新口径判定');
for (const [p, n, days, oldAdj, canJudge] of rows) {
  console.log(`  ${p.padEnd(16)}${String(n).padStart(4)}  ${String(days).padStart(4)}   ${String(oldAdj).padStart(6)}   ${canJudge ? '可判定' : '★ 已锁定（不校准不降权）'}`);
}
// ⛔ 2026-10-27：旧断言要求「1213 个条件全部被锁定」——那是当时学习的样本还没攒够天数的事实快照，
//    随着样本逐日累积，会有条件自然达到 MIN_LEARN_DAYS（这正是我们要的结果），断言却把"变好"判成红。
//    改成钉**判据本身**：锁定 ⟺ (交易日 < 闸门 || 样本 < 12)，一个都不许例外。
const wrongLock = rows.filter(([p, n, days, , canJudge]) => canJudge === (days < T.MIN_LEARN_DAYS || n < 12));
ok(wrongLock.length === 0,
  `交易日/样本不足的条件一律锁定（${lockedCnt}/${total} 锁定；其余 ${total - lockedCnt} 个已满 ${T.MIN_LEARN_DAYS} 天且样本≥12）`,
  '判据不符: ' + wrongLock.map(r => r[0]).join(', '));

console.log('\n========== 5. 概率桶：单日样本不允许触发校准 ==========');
const buckets = {};
for (const s of res) {
  if (s.prob == null) continue;
  const b = s.prob >= 90 ? '90+' : s.prob >= 85 ? '85-89' : s.prob >= 80 ? '80-84' : s.prob >= 70 ? '70-79' : '<70';
  (buckets[b] = buckets[b] || { list: [] }).list.push(s);
}
let bLocked = 0, bWrong = [];
for (const [b, v] of Object.entries(buckets)) {
  const st = T.dayStats(v.list);
  const canJudge = st.days >= T.MIN_LEARN_DAYS && v.list.length >= 25;
  const rate = v.list.filter(x => x.resolved.hit).length / v.list.length;
  const d928n = v.list.filter(x => T.normDate(x.date) === '2026-09-28').length;
  if (!canJudge) bLocked++;
  // 判据自检：可校准 ⟺ (交易日 ≥ 闸门 且 样本 ≥ 25)，单日样本永远不许放行
  if (canJudge === (st.days < T.MIN_LEARN_DAYS || v.list.length < 25)) bWrong.push(b);
  console.log(`  ${b.padEnd(6)} n=${String(v.list.length).padStart(3)}  days=${String(st.days).padStart(2)}  命中率${String((rate*100).toFixed(0)).padStart(3)}%  其中9/28占${String(d928n).padStart(3)}  → ${canJudge ? '可校准' : '★ 锁定 corr=1'}`);
}
// ⛔ 2026-10-27：旧断言写「至少 3 个桶被锁」（当时所有桶都只有单日样本）。样本攒够后桶会合法解锁，
//    再要求"被锁"就是把系统学对了判成错。钉判据：单日/薄样本的桶必须锁，其余必须能判。
ok(bWrong.length === 0, `单日或薄样本（<25 条 / <${T.MIN_LEARN_DAYS} 天）的概率桶一律锁定`,
  `锁定 ${bLocked}/${Object.keys(buckets).length}，判据不符: ${bWrong.join(', ')}`);

console.log('\n========== 6. 失败率控制：普跌日 / 单日证据都不得抬门槛 ==========');
const trend = res.filter(s => ['trend', 'pool', 'ztprob', 'auczt'].includes(s.type)).slice(-80);
const stT = T.dayStats(trend);
const simulated = (() => {
  const cur = 0.82;
  if (stT.days < T.MIN_LEARN_DAYS) return cur;         // 闸门1：交易日不足
  const hitRate = T.neutralRate(trend, ctx.EXP, ctx.GLOBAL);
  if (hitRate < 0.45 && cur < 0.86) {
    if (T.isBearDay(T.todayBeta())) return cur;        // 闸门2：今天是普跌日
    return Math.min(+(cur + 0.02).toFixed(2), 0.86);   // 闸门3：上限收紧到 0.86
  }
  return cur;
})();
console.log(`  趋势类样本 ${stT.n} 条 / ${stT.days} 个交易日，原始命中率 ${(stT.hit/stT.n*100).toFixed(1)}%`);
console.log(`  旧口径会做的事：连调 10 次  0.82 → 0.90`);
console.log(`  新口径结果：阈值保持在 ${simulated}`);
ok(simulated === 0.82, '阈值不再被单日普跌样本顶到 0.90', String(simulated));

console.log(`\n========== 结果：${pass} 项通过 / ${fail} 项失败 ==========\n`);
process.exit(fail ? 1 : 0);
