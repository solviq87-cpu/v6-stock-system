/* _research_emp.js —— empTable 样本外校验（临时研究脚本，不进发布包）
 * 1) 逐字复刻 server.js empTable() 的过滤与分档逻辑，独立重算各档实测命中率；
 * 2) 泄漏审计：被排除样本是否真的没进分母、全部|档是否混入跨口径样本；
 * 3) 时间稳定性：每档按日期中位数拆前后半，看实测率是否随时间漂移；
 * 4) auczt 专项：当日(resolved) vs 次日(nd) 口径差，喂给 e) 任务。
 * 目的：标出 empTable「模型声称(档中值)」与「实测」之间的虚高/虚低档位与污染来源。
 */
const fs = require('fs');
const STAT = JSON.parse(fs.readFileSync('stats.json', 'utf8'));
const signals = STAT.signals || [];

// ── 从 server.js 逐字搬来的常量与函数 ──
const EMP_MIN_N = 20, EMP_MIN_DAYS = 5;
const EMP_BIG_N = 150, EMP_BIG_DAYS = 3;
const EMP_REFU_N = 80, EMP_REFU_DAYS = 2, EMP_REFU_GAP = 25;
const empMidOf = b => b === '75+' ? 80 : b === '65-74' ? 70 : b === '55-64' ? 60 : b === '45-54' ? 50 : 40;
const EMP_CHASE = new Set(['buzhang', 'ztprob', 'similar', 'fastin']);
const EMP_EARLY = new Set(['histzt', 'auczt', 'pre', 'pool', 'trendsig', 'bigmoney', 'bigmoney_repeat', 'trend', 'sector', 'bigmoney-B', 'yier', 'lianban']);
const EMP_BUCKETS = ['<45', '45-54', '55-64', '65-74', '75+'];
const PROB_KIND = { pool: { kind: 'score' }, trend: { kind: 'score' } };
function probKindOf(type) { const d = PROB_KIND[type]; return d ? d.kind : 'prob'; }
const empBucketOf = p => p >= 75 ? '75+' : p >= 65 ? '65-74' : p >= 55 ? '55-64' : p >= 45 ? '45-54' : '<45';
const empGroupOf = t => EMP_CHASE.has(t) ? '追高类' : (EMP_EARLY.has(t) ? '未启动类' : '其它');
function empKeysOf(prob, type) {
  const b = empBucketOf(prob), g = empGroupOf(type);
  return probKindOf(type) === 'prob' ? [g + '|' + b, '全部|' + b] : ['评分:' + g + '|' + b, '评分|' + b];
}
const POST_HOC_TYPES = new Set(['zt', 'review']);
const isBacktestSample = s => !!(s && s.resolved && s.resolved.mode === '历史回测');
function isPostHocSample(s) {
  if (!s || isBacktestSample(s)) return false;
  return POST_HOC_TYPES.has(s.type) || !!(s.resolved && s.resolved.limitUp && +(s.resolved.maxGain || 0) <= 0.5);
}
const isLiveSample = s => !isBacktestSample(s) && !isPostHocSample(s);

// ── 复刻 empTable 主循环 ──
const m = {};
const sk = { scanned: 0, live: 0, by: {} };
const bumpSkip = kk => { sk.by[kk] = (sk.by[kk] || 0) + 1; };
const bump = (k, s) => {
  const v = (m[k] = m[k] || { n: 0, hit: 0, lu: 0, strong: 0, ok: 0, fake: 0, _d: new Set(), _rows: [] });
  v.n++;
  const isAuczt = s.type === 'auczt';
  const hit = isAuczt ? !!(s.resolved && s.resolved.limitUp) : !!(s.nd && s.nd.hit);
  const limitUp = isAuczt ? !!(s.resolved && s.resolved.limitUp) : !!(s.nd && s.nd.limitUp);
  if (hit) v.hit++; if (limitUp) v.lu++;
  let quality = 'miss';
  if (isAuczt) { const r = s.resolved; if (r) quality = r.limitUp ? 'strong' : (r.hit ? 'ok' : 'miss'); }
  else { quality = (s.nd && s.nd.quality) || 'miss'; }
  if (quality === 'strong') v.strong++; else if (quality === 'ok') v.ok++; else if (quality === 'fake') v.fake++;
  if (s.date) v._d.add(String(s.date).replace(/-/g, ''));
  v._rows.push({ date: String(s.date || '').replace(/-/g, ''), type: s.type, isAuczt, prob: s.prob });
};
for (const s of signals) {
  sk.scanned++;
  const hasOutcome = s.type === 'auczt' ? !!(s.resolved) : !!(s.nd);
  if (!hasOutcome) { bumpSkip('empNoNd'); continue; }
  if (s.void) { bumpSkip('empVoid'); continue; }
  if (s.prob == null || !isFinite(s.prob)) { bumpSkip('empNoProb'); continue; }
  if (isBacktestSample(s)) { bumpSkip('empBacktest'); continue; }
  if (isPostHocSample(s)) { bumpSkip('empPostHoc'); continue; }
  sk.live++;
  const ks = empKeysOf(s.prob, s.type);
  bump(ks[0], s); bump(ks[1], s);
}
for (const k of Object.keys(m)) {
  const v = m[k];
  v.rate = Math.round(v.hit / v.n * 100);
  v.luRate = Math.round(v.lu / v.n * 100);
  v.strongRate = v.strong ? Math.round(v.strong / v.n * 100) : 0;
  v.okRate = v.ok ? Math.round(v.ok / v.n * 100) : 0;
  v.fakeRate = v.fake ? Math.round(v.fake / v.n * 100) : 0;
  v.realRate = Math.round((v.strong + v.ok) / v.n * 100);
  v.days = v._d.size;
  const b = k.split('|')[1];
  const strong = (v.n >= EMP_BIG_N && v.days >= EMP_BIG_DAYS);
  const normal = (v.n >= EMP_MIN_N && v.days >= EMP_MIN_DAYS);
  const gap = empMidOf(b) - v.rate;
  const refu = (v.n >= EMP_REFU_N && v.days >= EMP_REFU_DAYS && gap >= EMP_REFU_GAP);
  v.locked = (strong || normal || refu) ? null : `证据不足(${v.n}条/跨${v.days}日)`;
  v.evidence = strong ? '大样本' : (normal ? '常规' : (refu ? `强证伪(实测比模型低${gap>0?'+':''}${gap}%)` : '不足'));
  v.gap = gap; v.claimed = empMidOf(b); v.bucket = b; v.group = k.split('|')[0];
}

// ── 输出 1：跳过原因分布（分母透明度）──
console.log('=== 1) empTable 跳过原因分布（分母透明度）===');
console.log(`扫描总数=${sk.scanned}  进分母 live=${sk.live}`);
console.log('跳过明细:', JSON.stringify(sk.by, null, 0));

// ── 输出 2：全表（按 group/bucket 排序）──
console.log('\n=== 2) empTable 全表（复刻）===');
const order = { '未启动类': 0, '追高类': 1, '其它': 2, '全部': 3, '评分': 4 };
const keys = Object.keys(m).sort((a, b) => {
  const ga = a.split('|')[0], gb = b.split('|')[0];
  const oa = order[ga] ?? 9, ob = order[gb] ?? 9;
  if (oa !== ob) return oa - ob;
  return EMP_BUCKETS.indexOf(a.split('|')[1]) - EMP_BUCKETS.indexOf(b.split('|')[1]);
});
console.log('键'.padEnd(22), 'n'.padStart(5), '日'.padStart(4), '实测%'.padStart(6), 'lu%'.padStart(5), 'real%'.padStart(6), '强%'.padStart(5), 'ok%'.padStart(5), '假%'.padStart(5), '声称%'.padStart(6), '差'.padStart(5), '证据');
for (const k of keys) {
  const v = m[k];
  if (v.n < 3) continue; // 太小不列
  console.log(
    k.padEnd(22), String(v.n).padStart(5), String(v.days).padStart(4),
    String(v.rate).padStart(6), String(v.luRate).padStart(5), String(v.realRate).padStart(6),
    String(v.strongRate).padStart(5), String(v.okRate).padStart(5), String(v.fakeRate).padStart(5),
    String(v.claimed).padStart(6), String(v.gap).padStart(5),
    (v.locked ? 'LOCK' : (v.evidence || ''))
  );
}

// ── 输出 3：泄漏审计 —— 被排除类是否真没进分母；全部档跨口径混合 ──
console.log('\n=== 3) 泄漏审计 ===');
// 严格按 empTable 的入桶条件定义 inLive（含 void 排除），避免误报
const inLive = s => {
  const hasOutcome = s.type === 'auczt' ? !!(s.resolved) : !!(s.nd);
  if (!hasOutcome) return false;
  if (s.void) return false;
  if (s.prob == null || !isFinite(s.prob)) return false;
  if (isBacktestSample(s)) return false;
  if (isPostHocSample(s)) return false;
  return true;
};
let leakBacktest = 0, leakPostHoc = 0, leakVoid = 0;
for (const s of signals) {
  if (s.void && inLive(s)) leakVoid++;
  if (isBacktestSample(s) && inLive(s)) leakBacktest++;
  if (isPostHocSample(s) && inLive(s)) leakPostHoc++;
}
console.log(`本应被排除却进了 live 的：void=${leakVoid}  backtest=${leakBacktest}  postHoc=${leakPostHoc}  (应全为 0)`);
// 反向：empTable 实际入桶数 vs 严格 inLive 数，应相等
let strictLive = signals.filter(inLive).length;
console.log(`严格 inLive 计数=${strictLive}   empTable live=${sk.live}  (应相等)`);
// 全部|档 的口径混合（auczt=当日封板口径 vs 其它=次日命中口径）
console.log('\n「全部」档 口径混合（auczt 用当日、其它用次日，混在一起语义不清）：');
for (const b of EMP_BUCKETS) {
  const k = '全部|' + b; const v = m[k]; if (!v || !v._rows) continue;
  const auc = v._rows.filter(r => r.isAuczt).length;
  const oth = v._rows.length - auc;
  console.log(`  全部|${b}: 总${v.n} = auczt(当日口径)${auc} + 其它(次日口径)${oth}`);
}

// ── 输出 4：时间稳定性（按日期中位数拆前后半）──
console.log('\n=== 4) 时间稳定性（每档 n>=40，按日期中位数拆前后半）===');
for (const k of keys) {
  const v = m[k]; if (!v._rows || v.n < 40) continue;
  const ds = v._rows.map(r => r.date).filter(Boolean).sort();
  const mid = ds[Math.floor(ds.length / 2)];
  const early = v._rows.filter(r => r.date <= mid);
  const late = v._rows.filter(r => r.date > mid);
  const rateOf = rows => {
    let hit = 0;
    for (const r of rows) {
      const s = signals.find(x => x.type === r.type && String(x.date || '').replace(/-/g, '') === r.date && x.prob === r.prob);
      // 近似：用 rows 里已记录的 isAuczt 反推 hit 不便，改为直接重算
    }
    return null;
  };
  // 直接重算 early/late 命中
  const recalc = rows => {
    let n = 0, hit = 0;
    for (const r of rows) {
      const cand = signals.filter(x => String(x.date || '').replace(/-/g, '') === r.date && x.type === r.type && x.prob === r.prob);
      for (const s of cand) {
        const hasO = s.type === 'auczt' ? !!(s.resolved) : !!(s.nd);
        if (!hasO || s.void || s.prob == null || !isFinite(s.prob) || isBacktestSample(s) || isPostHocSample(s)) continue;
        n++;
        const h = s.type === 'auczt' ? !!(s.resolved && s.resolved.limitUp) : !!(s.nd && s.nd.hit);
        if (h) hit++;
      }
    }
    return n ? Math.round(hit / n * 100) : null;
  };
  const er = recalc(early), lr = recalc(late);
  const diff = (er != null && lr != null) ? (lr - er) : null;
  if (diff != null && Math.abs(diff) >= 15)
    console.log(`  ⚠️ ${k}: 前半${er}%(n=${early.length}) 后半${lr}%(n=${late.length}) 漂移${diff>0?'+':''}${diff} → 不稳定`);
}

// ── 输出 5：auczt 专项（当日 vs 次日）──
console.log('\n=== 5) auczt 专项：当日(resolved) vs 次日(nd) 口径差 ===');
const auc = signals.filter(s => s.type === 'auczt');
const byB = {};
for (const s of auc) {
  if (s.prob == null || !isFinite(s.prob)) continue;
  const b = empBucketOf(s.prob);
  byB[b] = byB[b] || { n: 0, dUp: 0, ndHit: 0, ndUp: 0, ndOK: 0 };
  byB[b].n++;
  if (s.resolved && s.resolved.limitUp) byB[b].dUp++;
  if (s.nd) { if (s.nd.hit) byB[b].ndHit++; if (s.nd.limitUp) byB[b].ndUp++; if (s.nd.quality === 'ok') byB[b].ndOK++; }
}
for (const b of EMP_BUCKETS) {
  const r = byB[b]; if (!r || !r.n) continue;
  console.log(`  auczt|${b} (n=${r.n}): 当日封板${Math.round(r.dUp/r.n*100)}%  次日命中${Math.round(r.ndHit/r.n*100)}%  次日封板${Math.round(r.ndUp/r.n*100)}%  声称(档中值)${empMidOf(b)}%`);
}

// ── 输出 6：虚高/虚低总表 ──
console.log('\n=== 6) 虚高/虚低档位汇总（claimed 档中值 vs 实测，仅证据足够档）===');
let hi = [], lo = [];
for (const k of keys) {
  const v = m[k]; if (v.locked || v.n < EMP_MIN_N) continue;
  if (v.gap >= 10) hi.push(`${k}: 声称${v.claimed}% 实测${v.rate}% 差+${v.gap}`);
  if (v.gap <= -10) lo.push(`${k}: 声称${v.claimed}% 实测${v.rate}% 差${v.gap}`);
}
console.log('虚高(模型说高、实测低):'); hi.forEach(x => console.log('  ' + x));
console.log('虚低(模型说低、实测高):'); lo.forEach(x => console.log('  ' + x));
if (!hi.length) console.log('  （无 ≥10 点虚高档）');
if (!lo.length) console.log('  （无 ≥10 点虚低档）');
