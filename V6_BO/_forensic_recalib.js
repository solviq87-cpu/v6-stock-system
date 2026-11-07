// hv 轮取证③：纯净样本下学习库校准的预期值（离线复刻 recomputeBuckets，只读不改）
// 目的：标废 205 条非竞价窗口 auczt 后，paths 的 adj / buckets 的 corr 会变成什么？
//   ⛔ 所有判据函数从 server.js 现提取（单一事实源），复刻的是生产统计路径；
//      结果只是「下次 changed 触发重算时的预期值」，不等于已落盘的生产值。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
const grabConst = name => {
  const m = src.match(new RegExp('const ' + name + ' = [^;]+;'));
  if (!m) throw new Error('找不到常量 ' + name);
  return m[0];
};

const deps = [
  grabConst('MIN_LEARN_DAYS'),
  grabConst('POST_HOC_TYPES'),
  'const S = { marketBeta: ' + JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'marketBeta.json'), 'utf8'))) + ' };',
  'const _cl = (v, a, b) => Math.min(b, Math.max(a, v));',
  'const normDate = d => String(d || \'\').replace(/[^0-9]/g, \'\').replace(/^(\\d{4})(\\d{2})(\\d{2})$/, \'$1-$2-$3\');',
  grab(/function dayStats\(list\) \{/),
  grab(/function dayExpectMap\(res, globalBase\) \{/),
  grab(/function neutralRate\(list, expMap, globalBase\) \{/),
  grab(/function bearDominated\(list\) \{/),
  grab(/function learnCtx\(all\) \{/),
  grab(/const isBacktestSample = /),
  grab(/function isPostHocSample\(s\) \{/),
  'const isLiveSample = s => !isBacktestSample(s) && !isPostHocSample(s);',
  'const ndHit = s => !!(s && s.nd && s.nd.hit);',
  'return { dayStats, dayExpectMap, neutralRate, bearDominated, learnCtx, isLiveSample, ndHit, normDate, MIN_LEARN_DAYS };'
];
const M = new Function(deps.join('\n'))();

const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'stats.json'), 'utf8'));
const all = (j.signals || []).filter(s => s && s.resolved && !s.void);
const live = all.filter(M.isLiveSample);
console.log('已回验非 void 总数:', all.length, '；live（实盘口径）:', live.length);

const { GLOBAL, EXP } = M.learnCtx(live);
console.log('GLOBAL(日等权基准):', GLOBAL.toFixed(3), '；覆盖', M.dayStats(live).days, '个交易日');

// —— paths 复刻（与 recomputeBuckets 尾部同一公式）——
const aucztLive = live.filter(s => s.type === 'auczt');
console.log('\n其中 auczt live 样本:', aucztLive.length, '（纯净竞价窗口）');
const pathsNow = j.paths || {};
const agg = {};
for (const s of live) for (const f of (s.paths || [])) (agg[f] = agg[f] || []).push(s);
console.log('\n== auczt 相关因子的 adj：现值 → 纯净样本预期 ==');
const AUC_FACTORS = ['竞价涨幅黄金区', '竞价涨幅温和', '竞价涨幅强势', '竞价主力抢筹', '竞价额居前5%', '竞价额居前1%', '板块龙头', '昨日板块涨停效应', '小盘易拉', '利好催化', '连板惯性', '缺竞价抢筹'];
for (const f of AUC_FACTORS) {
  const list = agg[f];
  const cur = pathsNow[f];
  if (!list || !list.length) { console.log(`  ${f}: 无 live 样本（预期 adj=0·样本观察中） 现值=${cur ? cur.adj : '无'}`); continue; }
  const st = M.dayStats(list);
  const nr = (st.days >= M.MIN_LEARN_DAYS && list.length >= 12) ? M.neutralRate(list, EXP, GLOBAL) : null;
  let adj = 0, verdict;
  if (nr == null) { adj = 0; verdict = list.length < 12 ? `样本观察中（${list.length}条）` : `交易日不足（${st.days}天）·不下结论`; }
  else if (M.bearDominated(list)) { adj = Math.max(0, Math.min(5, Math.max(-5, (nr - 0.5) * 10))); verdict = adj > 0 ? '普跌日样本下仍超额·加权' : '普跌日主导·暂不降权'; }
  else { adj = Math.min(5, Math.max(-5, (nr - 0.5) * 10)); verdict = nr >= 0.65 ? '优·自动加权' : nr < 0.4 ? '差·自动降权' : '中性·维持'; }
  const curTxt = cur ? `n=${cur.n} adj=${cur.adj}` : '无';
  console.log(`  ${f}: 现值(${curTxt}) → 预期 n=${list.length} hit=${st.hit} rate=${(st.hit / list.length * 100).toFixed(0)}% neutral=${nr == null ? '判不出' : (nr * 100).toFixed(0) + '%'} adj=${adj.toFixed(1)}「${verdict}」`);
}

// —— buckets 复刻（corr = clamp(neutral/expect, 0.7, 1.15)）——
console.log('\n== 概率桶 corr：现值 → 纯净样本预期（auczt 只落 <70 桶）==');
const buckets = {};
for (const s of live) {
  if (s.prob == null) continue;
  const b = s.prob >= 90 ? '90+' : s.prob >= 85 ? '85-89' : s.prob >= 80 ? '80-84' : s.prob >= 70 ? '70-79' : '<70';
  (buckets[b] = buckets[b] || { n: 0, hit: 0, list: [] });
  buckets[b].n++; if (M.ndHit(s)) buckets[b].hit++;
  buckets[b].list.push(s);
}
const EXPECT = { '90+': 0.9, '85-89': 0.85, '80-84': 0.8, '70-79': 0.7, '<70': 0.5 };
for (const b of ['<70', '70-79', '80-84', '85-89', '90+']) {
  const v = buckets[b];
  const cur = (j.buckets || {})[b];
  if (!v || !v.n) { console.log(`  ${b}: 纯净样本 0 条（保持现值 corr=${cur ? cur.corr : '-'}）`); continue; }
  const nr = M.neutralRate(v.list, EXP, GLOBAL);
  const corr = nr == null ? 1 : +Math.min(1.15, Math.max(0.7, nr / (EXPECT[b] || 0.7))).toFixed(2);
  const aucN = v.list.filter(s => s.type === 'auczt').length;
  console.log(`  ${b}: 现值(n=${cur ? cur.n : 0} corr=${cur ? cur.corr : '-'}) → 纯净 n=${v.n}(auczt ${aucN}) hit=${v.hit} neutral=${nr == null ? '判不出' : (nr * 100).toFixed(0) + '%'} corr=${corr}`);
}
console.log('\n（口径说明：<70 桶期望按 recomputeBuckets 的 expect[b] 默认 0.5 复刻；实际以生产代码 expect 表为准）');
