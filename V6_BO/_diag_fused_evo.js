// 离线验证「学习融合到底有没有用」：拿线上真实的已回验样本，模拟"如果当时就用融合胜率推送"
// 口径：融合只看信号发生当天能拿到的信息（K线截至信号日、实测表取同期样本）→ 属于事前，不含未来函数。
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const cut = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); return SRC.slice(i, j); };
const empSrc = cut('const EMP_MIN_N = 20', 'function bigMoneySelfOptimize');
const laSrc = cut('// 给一只票算「自学 Probability」', '// 自学模型缓存');
const fuseSrc = cut('// 自学模型缓存', 'async function runLearnallIngest');
const LEARNALL = require('./learnall.js');
const A = require('./analysis.js');
const DB = LEARNALL.load();
const KLINE = path.join(__dirname, '.kline_cache');
const norm = d => String(d == null ? '' : d).replace(/-/g, '').replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3');

// 暂存区 2026-10-23 起搬到 ../stock-dashboard-artifacts/_deploy_tmp（ROOT 包体事故根治），先找发布包版本再找本地
const FILES = [path.join('..', 'stock-dashboard-artifacts', '_deploy_tmp', 'stats.json'), 'stats.json'];
let sigs = [];
for (const f of FILES) {
  try { const s = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); const a = s.signals || (s.learn && s.learn.signals); if (a && a.length) { sigs = a; console.log('样本来源:', f, a.length, '条'); break; } } catch {}
}
if (!sigs.length) { console.log('没找到样本'); process.exit(1); }
const nd = sigs.filter(s => s.nd && s.prob != null && !s.void);
console.log('可用（有次日口径 + 有模型概率）:', nd.length, '条 / 跨',
  new Set(nd.map(s => String(s.date).replace(/-/g, ''))).size, '个交易日');

const M = new Function('S', 'LEARNALL', 'A', 'laDb', 'console', `
${empSrc}
${laSrc}
${fuseSrc}
return { empTable, empInfo, fusedProb, empBucketOf, EMP_BUCKETS };
`)({ learn: { signals: sigs }, klines: new Map() }, LEARNALL, A, () => DB, { log() {} });

// K线缓存：按需读盘并做内存缓存
const KC = new Map();
function rowsAt(code, date) {
  if (KC.has(code)) return cut0(KC.get(code), date);
  try {
    const k = JSON.parse(fs.readFileSync(path.join(KLINE, code + '.json'), 'utf8'));
    if (!k || !Array.isArray(k.rows)) { KC.set(code, null); return null; }
    KC.set(code, k.rows);
    return cut0(k.rows, date);
  } catch { KC.set(code, null); return null; }
}
// 只保留信号日【当天及之前】的K线 —— 用信号日之后的数据算形态就是拿未来函数骗自己
function cut0(rows, date) {
  if (!rows) return null;
  const d = norm(date);
  const out = rows.filter(r => norm(r.date) <= d);
  return out.length >= 6 ? out : null;
}

let haveK = 0, empUsed = 0, laUsed = 0;
for (const s of nd) {
  const rows = rowsAt(s.code, s.date);
  if (rows) haveK++;
  const fz = M.fusedProb(s.code, s.name, rows, s.type, s.prob);
  s._fused = fz.prob;
  if (fz.emp != null) empUsed++;
  if (fz.la != null) laUsed++;
}
console.log(`能取到K线（自学可用）: ${haveK} 条 | 实测标定命中: ${empUsed} 条 | 自学形态命中: ${laUsed} 条`);

const bucket = p => p >= 75 ? '75+' : p >= 65 ? '65-74' : p >= 55 ? '55-64' : p >= 45 ? '45-54' : '<45';
function table(key) {
  const m = {};
  for (const s of nd) {
    const v = s[key]; if (v == null || !isFinite(v)) continue;
    const b = bucket(v); const o = (m[b] = m[b] || { n: 0, hit: 0, lu: 0 });
    o.n++; if (s.nd.hit) o.hit++; if (s.nd.limitUp) o.lu++;
  }
  return m;
}
function report(kRaw, kFz, title) {
const raw = table(kRaw), fz = table(kFz);
console.log('\n' + title);
console.log('档位        原值(模型)              融合(学后)             差值');
let wRaw = 0, wFz = 0, nRaw = 0, nFz = 0;
for (const b of M.EMP_BUCKETS) {
  const r = raw[b], f = fz[b];
  const rs = r ? `${String(r.n).padStart(4)}条 ${String(Math.round(r.hit / r.n * 100)).padStart(3)}%` : '         —          ';
  const fs2 = f ? `${String(f.n).padStart(4)}条 ${String(Math.round(f.hit / f.n * 100)).padStart(3)}%` : '         —          ';
  const d = (r && f) ? `${(Math.round(f.hit / f.n * 100) - Math.round(r.hit / r.n * 100) >= 0 ? '+' : '')}${Math.round(f.hit / f.n * 100) - Math.round(r.hit / r.n * 100)}` : '—';
  console.log(`${b.padEnd(8)} ${rs}     ${fs2}     ${d}`);
  if (r) { wRaw += r.hit; nRaw += r.n; }
  if (f) { wFz += f.hit; nFz += f.n; }
}
// 区分度 = 最高档与最低档命中率之差：光看总体命中率没意义，能把好坏分开才叫有用
const spread = m => {
  const v = M.EMP_BUCKETS.map(b => m[b]).filter(x => x && x.n >= 20).map(x => x.hit / x.n * 100);
  return v.length >= 2 ? Math.round(Math.max(...v) - Math.min(...v)) : null;
};
console.log(`\n总体命中率：原值 ${Math.round(wRaw / nRaw * 100)}%(${nRaw}条) → 融合 ${Math.round(wFz / nFz * 100)}%(${nFz}条)`);
console.log(`档位区分度（最高档−最低档，≥20条才算）：原值 ${spread(raw)} 点 → 融合 ${spread(fz)} 点`);
// 最关键的一问：按各自的最高档推送，谁更准？（最高档 = 你实际会优先看的那批）
const hiB = m => { for (let i = M.EMP_BUCKETS.length - 1; i >= 0; i--) { const b = m[M.EMP_BUCKETS[i]]; if (b && b.n >= 20) return b; } return null; };
const tr = hiB(raw), tf = hiB(fz);
console.log(`各自最高档：原值 ${tr ? Math.round(tr.hit / tr.n * 100) + '%(' + tr.n + '条)' : '-'} → 融合 ${tf ? Math.round(tf.hit / tf.n * 100) + '%(' + tf.n + '条)' : '-'}`);

// 最贴近真实决策的一问：**每天只推前 N 只**，按原值挑 vs 按融合挑，谁更能让你赚钱
console.log('\n每天只推前 N 只（模拟真实推送：额度有限，只能挑最看好的那几只）');
console.log('   N      按模型原值挑          按融合胜率挑');
for (const N of [1, 3, 5, 10]) {
  const byDay = {};
  for (const s of nd) (byDay[String(s.date).replace(/-/g, '')] = byDay[String(s.date).replace(/-/g, '')] || []).push(s);
  let rH = 0, rN = 0, fH = 0, fN = 0;
  for (const d of Object.keys(byDay)) {
    const list = byDay[d];
    if (list.length < 2) continue;
    for (const s of list.slice().sort((a, b) => b[kRaw] - a[kRaw]).slice(0, N)) { rN++; if (s.nd.hit) rH++; }
    for (const s of list.slice().sort((a, b) => b[kFz] - a[kFz]).slice(0, N)) { fN++; if (s.nd.hit) fH++; }
  }
  const p = (h, n) => `${String(Math.round(h / n * 100)).padStart(3)}% (${String(n).padStart(3)}只)`;
  console.log(`  ${String(N).padStart(2)}      ${p(rH, rN)}            ${p(fH, fN)}`);
}
}
report('prob', '_fused', '【A】全样本口径（实测表用全部样本建，含自评，偏乐观）');

// ── 严格版：逐日滚动（walk-forward）───────────────────────────────────────
// 评估第 d 天时，实测表只能用 d 【之前】的样本建 —— 这才是真正的事前，
// 不含"拿今天的答案去考今天的题"这种自欺。
const days = [...new Set(nd.map(s => String(s.date).replace(/-/g, '')))].sort();
const mkM = signals => new Function('S', 'LEARNALL', 'A', 'laDb', 'console', `
${empSrc}
${laSrc}
${fuseSrc}
return { fusedProb };
`)({ learn: { signals }, klines: new Map() }, LEARNALL, A, () => DB, { log() {} });
let cold = 0;
for (const d of days) {
  const prior = sigs.filter(s => String(s.date).replace(/-/g, '') < d);
  const Md = mkM(prior);
  for (const s of nd.filter(x => String(x.date).replace(/-/g, '') === d)) {
    const rows = rowsAt(s.code, s.date);
    const fz2 = Md.fusedProb(s.code, s.name, rows, s.type, s.prob);
    s._wf = fz2.prob;
    if (fz2.emp == null) cold++;
  }
}
console.log(`\n（滚动验证：${days.length} 个交易日逐日推进；其中 ${cold} 条在当天还拿不到实测证据，按"仅自学修正"处理）`);
report('prob', '_wf', '【B】逐日滚动口径（只用当天之前学到的东西 —— 这才是真本事）');
