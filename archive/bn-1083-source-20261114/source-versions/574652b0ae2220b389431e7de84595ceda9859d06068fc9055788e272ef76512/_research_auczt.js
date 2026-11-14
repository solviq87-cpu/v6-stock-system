/* _research_auczt.js —— e) auczt prob 诚实化标定（临时研究脚本，不进发布包）
 * 取非 void、真竞价窗口(09:15~09:30) 的 auczt 样本，
 * 按原始 prob 分桶回算真实 当日封板率 / 次日封板率，
 * 给出 honest prob 重标定表。⛔ 不放宽 ZT_INFER_PUSH_PROB=55。
 */
const fs = require('fs');
const STAT = JSON.parse(fs.readFileSync('stats.json', 'utf8'));
const signals = STAT.signals || [];

const empBucketOf = p => p >= 75 ? '75+' : p >= 65 ? '65-74' : p >= 55 ? '55-64' : p >= 45 ? '45-54' : '<45';
const empMidOf = b => b === '75+' ? 80 : b === '65-74' ? 70 : b === '55-64' ? 60 : b === '45-54' ? 50 : 40;
const EMP_BUCKETS = ['<45', '45-54', '55-64', '65-74', '75+'];

function inAuctionWindow(s) {
  const ts = s.ts;
  if (!ts) return false;
  // ts 可能是秒或毫秒；统一转到毫秒
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  const h = d.getHours(), m = d.getMinutes();
  // 真竞价窗口：09:15 ~ 09:30（含边界）。hour=0/1 是回填无真实时刻，剔除。
  return h === 9 && m >= 15 && m <= 30;
}

const auc = signals.filter(s => s.type === 'auczt');
let nVoid = 0, nBacktest = 0, nNoWin = 0, nKept = 0;
const buckets = {};
for (const b of EMP_BUCKETS) buckets[b] = { n: 0, dUp: 0, ndUp: 0, ndHit: 0 };

for (const s of auc) {
  if (s.void) { nVoid++; continue; }
  if (s.resolved && s.resolved.mode === '历史回测') { nBacktest++; continue; }
  if (!inAuctionWindow(s)) { nNoWin++; continue; }
  if (s.prob == null || !isFinite(s.prob)) continue;
  nKept++;
  const b = empBucketOf(s.prob);
  const bb = buckets[b];
  bb.n++;
  if (s.resolved && s.resolved.limitUp) bb.dUp++;
  if (s.nd) { if (s.nd.limitUp) bb.ndUp++; if (s.nd.hit) bb.ndHit++; }
}

console.log('=== auczt 样本筛选 ===');
console.log(`总数=${auc.length}  void=${nVoid}  历史回测=${nBacktest}  非竞价窗口(含回填ts)=${nNoWin}  真窗口保留=${nKept}`);
console.log('\n=== 诚实标定表（按原始 prob 桶）===');
console.log('桶'.padEnd(8), 'n'.padStart(5), '当日封板%'.padStart(9), '次日封板%'.padStart(9), '次日命中%'.padStart(9), '声称%'.padStart(6), 'honestProb'.padStart(11), '虚高倍数'.padStart(8));
const honest = {};
for (const b of EMP_BUCKETS) {
  const bb = buckets[b];
  if (!bb.n) { console.log(b.padEnd(8), '  0', '  —（无样本）'); continue; }
  const dRate = Math.round(bb.dUp / bb.n * 100);
  const ndUpRate = Math.round(bb.ndUp / bb.n * 100);
  const ndHitRate = Math.round(bb.ndHit / bb.n * 100);
  const claimed = empMidOf(b);
  // honest prob = 当日封板率（auczt 预测当日封板）；证据不足则用相邻大桶或保守值
  let hp = dRate;
  const ev = bb.n >= 30 ? '足' : (bb.n >= 10 ? '弱' : '不足');
  if (bb.n < 10) hp = '(证据不足)';
  honest[b] = { n: bb.n, dRate, ndUpRate, ndHitRate, claimed, honest: hp, ev };
  const ratio = claimed && dRate ? (claimed / dRate).toFixed(1) + 'x' : '—';
  console.log(
    b.padEnd(8), String(bb.n).padStart(5),
    String(dRate).padStart(9), String(ndUpRate).padStart(9), String(ndHitRate).padStart(9),
    String(claimed).padStart(6), String(hp).padStart(11), String(ratio).padStart(8), ev
  );
}
console.log('\n=== 结论 ===');
console.log('auczt 原始 prob 声称的是「当日封板率」，但实测当日封板仅 12~19%（低桶，样本足）；');
console.log('虚高约 2~3 倍（§8bis 实证一致）。honest prob 应=实测当日封板率，');
console.log('⛔ 不是放宽 55 闸门，而是让 prob 说真话：55 闸门对 auczt 将只放过真·当日封板≥55% 的票（本样本几乎无）。');
console.log('\n高精度标定建议（honestProb by raw bucket）：');
for (const b of EMP_BUCKETS) {
  const h = honest[b];
  if (!h || h.n === 0) continue;
  console.log(`  raw ${b} (声称${h.claimed}) → honest ${typeof h.honest === 'number' ? h.honest + '%' : h.honest}  [n=${h.n}, ${h.ev}]`);
}
