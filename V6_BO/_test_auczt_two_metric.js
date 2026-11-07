'use strict';
// jy 轮守门：auczt 双口径——empTable 同时统计当日封板率与次日+3%命中率。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');

function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j + end.length);
}

const parts = [
  grab('const EMP_MIN_N = 20', 'EMP_REFU_GAP = 25;'),
  grab('const empMidOf =', '\n'),
  grab('const EMP_CHASE = new Set', '\n'),
  grab('const EMP_EARLY = new Set', '\n'),
  grab('const EMP_BUCKETS = [', '\n'),
  grab('const empBucketOf =', '\n'),
  grab('const empGroupOf =', '\n'),
  grab('const PROB_KIND = {', '\n};'),
  grab('function probKindOf(type) {', '\n}\n'),
  grab('function empKeysOf(prob, type) {', '\n}\n'),
  grab('const POST_HOC_TYPES = new Set', '\n'),
  grab('const isBacktestSample =', '\n'),
  grab('function isPostHocSample(s) {', '\n}\n'),
  grab('const isLiveSample =', '\n'),
  grab('function ppTxt(v, signed) {', '\n}\n'),
  grab('let _empCache = {', '\n'),
  grab('const SKIP_RULE = {', '\n};'),
  grab('const _skipTally = ', '\n'),
  grab('function skipAdd(kind, n) {', '\n}\n'),
  grab('const AUCZT_PROB_HONEST_MAX = 20;', '\n'),
  grab('function isRetiredProbScale(s) {', '\n}\n'),
  grab('function empTable() {', '\n}\n'),
  grab('function empProb(prob, type) {', '\n}\n'),
  grab('function empNdProb(prob, type) {', '\n}\n'),
];

const code = parts.join('\n');
const S = {};
const api = new Function('S', code + '\nfunction resetEmpCache(){ _empCache = { t:0, map:{}, done:false }; }\nreturn { empTable, empProb, empNdProb, resetEmpCache };')(S);

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name); }
}

// 构造 auczt 信号：prob=20（诚实刻度），当日封板一半，次日 hit 一半
function aucztSigs(n, hitN, ndHitN, days) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      type: 'auczt', prob: 20, void: false,
      date: '202610' + String((i % days) + 10).padStart(2, '0'),
      resolved: { limitUp: i < hitN, maxGain: 5 },
      nd: { hit: i < ndHitN, limitUp: false },
    });
  }
  return out;
}

// 20 条 auczt，当日封板 10 条，次日 hit 12 条，跨 5 日
S.learn = { signals: aucztSigs(20, 10, 12, 5) };
// 重置缓存
api.resetEmpCache();
const t = api.empTable();

ok('empTable 生成 auczt|<45 档', !!t['auczt|<45']);
ok('auczt|<45 n=20', t['auczt|<45'] && t['auczt|<45'].n === 20);
ok('auczt|<45 当日封板率 50%', t['auczt|<45'] && t['auczt|<45'].luRate === 50);
ok('empTable 生成 auczt-nd|<45 档', !!t['auczt-nd|<45']);
ok('auczt-nd|<45 n=20', t['auczt-nd|<45'] && t['auczt-nd|<45'].n === 20);
ok('auczt-nd|<45 次日+3%率 60%', t['auczt-nd|<45'] && t['auczt-nd|<45'].rate === 60);

ok('empProb(auczt) 返回当日封板率', api.empProb(20, 'auczt') === 50);
ok('empNdProb(auczt) 返回次日+3%率', api.empNdProb(20, 'auczt') === 60);
ok('empNdProb 非 auczt 返回 null', api.empNdProb(20, 'histzt') === null);

// 证据不足时 empNdProb 返回 null
S.learn.signals = aucztSigs(3, 1, 1, 1);
api.resetEmpCache();
ok('证据不足时 empNdProb 返回 null', api.empNdProb(20, 'auczt') === null);

console.log(`\n──── 结果：${passed} 通过 / ${failed} 失败 ────\n`);
process.exit(failed ? 1 : 0);
