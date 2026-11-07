'use strict';
// 每日回测学习 · 归因分析（2026-10-14）
// ① 每日全市场基线（从 .kline_cache 算，隔离"环境 vs 模型"）
// ② auczt 按日 lift vs 当日市场基线
// ③ auczt 概率分档 × 时期；④ 市值档 × 时期；⑤ 信号日/次日市场环境分层；⑥ paths 结构
// ⛔ 反斜杠正则会被 Write 传输双重转义 → 全文用 [0-9] 字符类，禁 \d
const fs = require('fs');
const A = require('./analysis.js');
const snap = JSON.parse(fs.readFileSync('stocks_snapshot.json', 'utf8'));
const floatSh = new Map();
for (const r of snap.rows || []) {
  if (!r.code || !(r.price > 0) || !(r.floatCap > 0)) continue;
  floatSh.set(r.code, { fs: r.floatCap / r.price, name: r.name || '' });
}
const boards = JSON.parse(fs.readFileSync('stockBoards.json', 'utf8'));
const codeBoard = new Map();
if (Array.isArray(boards)) for (const [code, v] of boards) { if (v && v.boards && v.boards.length) codeBoard.set(code, v.boards[0].name); }
const dash = d => { const s = String(d || ''); return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : s; };

// ── ① 每日全市场基线 ──
const files = fs.readdirSync('.kline_cache').filter(f => f.endsWith('.json') && /^[0-9]{6}$/.test(f.slice(0, 6)));
const dayBase = {}, dayUp = {}, dayTot = {};
for (const f of files) {
  const code = f.slice(0, 6);
  const sh = floatSh.get(code); if (!sh) continue;
  let k; try { k = JSON.parse(fs.readFileSync('.kline_cache/' + f, 'utf8')); } catch { continue; }
  const nm = k.name || sh.name || '';
  if (A.isJunkName(nm)) continue;
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) continue;
  const rows = (k.rows || []).filter(r => r && r.close > 0);
  if (rows.length < 20) continue;
  const lp = A.limitPctOf(code, nm);
  for (let i = 0; i < rows.length - 1; i++) {
    const dt = rows[i].date, nx = rows[i + 1];
    const pct = (nx.close / rows[i].close - 1) * 100;
    if (!dayBase[dt]) dayBase[dt] = { n: 0, p3: 0, zt: 0 };
    dayBase[dt].n++;
    if (pct >= 3) dayBase[dt].p3++;
    if (pct >= lp - 0.3) dayBase[dt].zt++;
    dayTot[dt] = (dayTot[dt] || 0) + 1;
    if (pct > 0) dayUp[dt] = (dayUp[dt] || 0) + 1;
  }
}
console.log('=== ① 每日全市场基线（次日口径：D 收盘→D+1，清洗宇宙） ===');
for (const d of Object.keys(dayBase).filter(x => x >= '2026-09-25').sort()) {
  const b = dayBase[d];
  const ur = (dayUp[d] || 0) / (dayTot[d] || 1) * 100;
  console.log(`  ${d}: n=${b.n} 市场+3%率=${(b.p3 / b.n * 100).toFixed(1)}% 市场涨停率=${(b.zt / b.n * 100).toFixed(2)}% | 当日涨跌比=${ur.toFixed(0)}%`);
}

// ── ② auczt 按日 vs 当日基线 ──
const st = JSON.parse(fs.readFileSync('stats.json', 'utf8'));
const sigs = (st.signals || []).filter(s => !s.void && s.nd);
const auc = sigs.filter(s => s.type === 'auczt');
const kcache = new Map();
function krows(code) {
  if (kcache.has(code)) return kcache.get(code);
  let r = null;
  try { const j = JSON.parse(fs.readFileSync('.kline_cache/' + code + '.json', 'utf8')); r = j.rows || null; } catch {}
  kcache.set(code, r); return r;
}
function feats(s) {
  const k = krows(s.code); if (!k) return null;
  const i = k.findIndex(r => String(r.date).replace(/-/g, '') === String(s.date).replace(/-/g, '')); if (i < 0) return null;
  const c = k[i].close;
  const sh = floatSh.get(s.code);
  const capYi = sh ? +(c * sh.fs / 1e8).toFixed(1) : null;
  const win = k.slice(Math.max(0, i - 19), i + 1);
  const lo = Math.min(...win.map(r => r.low)), hi = Math.max(...win.map(r => r.high));
  const rangePos = hi > lo ? +((c - lo) / (hi - lo) * 100).toFixed(0) : null;
  const v5 = k.slice(Math.max(0, i - 5), i).reduce((a, r) => a + r.volume, 0) / Math.min(5, i);
  const volRatio = v5 > 0 ? +(k[i].volume / v5).toFixed(2) : null;
  let zt5 = 0; const lp = A.limitPctOf(s.code, s.name);
  for (let q = Math.max(1, i - 5); q < i; q++) { const p = (k[q].close / k[q - 1].close - 1) * 100; if (p >= lp - 0.3) zt5++; }
  return { capYi, rangePos, volRatio, zt5, board: codeBoard.get(s.code) || null };
}
for (const s of auc) { const f = feats(s); if (f) Object.assign(s, { _f: f }); }
const aucF = auc.filter(s => s._f);
console.log(`\n=== ② auczt 按日 vs 当日市场基线（n=${aucF.length}） ===`);
const byDate = {};
for (const s of aucF) { const d = String(s.date); (byDate[d] = byDate[d] || []).push(s); }
for (const d of Object.keys(byDate).sort()) {
  const arr = byDate[d]; const n = arr.length;
  const p3 = arr.filter(s => s.nd.nextPct >= 3).length / n * 100;
  const lim = arr.filter(s => s.nd.limitUp).length / n * 100;
  const mb = dayBase[dash(arr[0].nd.date)];
  const mP3 = mb ? mb.p3 / mb.n * 100 : null, mZt = mb ? mb.zt / mb.n * 100 : null;
  const avgProb = arr.reduce((a, s) => a + (s.prob || 0), 0) / n;
  const avgCap = arr.reduce((a, s) => a + (s._f.capYi || 0), 0) / n;
  console.log(`  ${d}: n=${n} +3%:${p3.toFixed(1)}% 涨停:${lim.toFixed(1)}% | 次日市场+3%:${mP3 == null ? '—' : mP3.toFixed(1) + '%'} 涨停:${mZt == null ? '—' : mZt.toFixed(2) + '%'} | lift(+3%):${mP3 == null ? '—' : (p3 - mP3).toFixed(1) + 'pp'} | 均prob=${avgProb.toFixed(0)} 均市值=${avgCap.toFixed(0)}亿`);
}

// ── ③ 概率分档 × 时期 ──
console.log('\n=== ③ auczt 概率分档 × 时期 ===');
const early = aucF.filter(s => ['20260929', '20260930'].includes(String(s.date)));
const recent = aucF.filter(s => ['20261008', '20261009', '20261012'].includes(String(s.date)));
function pb(arr, lo, hi) { const b = arr.filter(s => (s.prob || 0) >= lo && (s.prob || 0) < hi); const n = b.length; if (!n) return 'n=0'; return `n=${n} +3%:${(b.filter(s => s.nd.nextPct >= 3).length / n * 100).toFixed(0)}% 涨停:${(b.filter(s => s.nd.limitUp).length / n * 100).toFixed(0)}%`; }
for (const [lo, hi] of [[0, 30], [30, 40], [40, 55], [55, 100]]) {
  console.log(`  prob[${lo},${hi}) 早期: ${pb(early, lo, hi)} | 近期: ${pb(recent, lo, hi)}`);
}
console.log(`  prob 均/中位: 早期 ${(early.reduce((a, s) => a + (s.prob || 0), 0) / early.length).toFixed(1)}/${early.map(s => s.prob || 0).sort((a, b) => a - b)[Math.floor(early.length / 2)]} | 近期 ${(recent.reduce((a, s) => a + (s.prob || 0), 0) / recent.length).toFixed(1)}/${recent.map(s => s.prob || 0).sort((a, b) => a - b)[Math.floor(recent.length / 2)]}`);

// ── ④ 市值档 × 时期 ──
console.log('\n=== ④ auczt 市值档 × 时期 ===');
function cb(arr, lo, hi) { const b = arr.filter(s => (s._f.capYi || 0) >= lo && (s._f.capYi || 0) < hi); const n = b.length; if (!n) return 'n=0'; return `n=${n} +3%:${(b.filter(s => s.nd.nextPct >= 3).length / n * 100).toFixed(0)}% 涨停:${(b.filter(s => s.nd.limitUp).length / n * 100).toFixed(0)}%`; }
for (const [lo, hi] of [[0, 30], [30, 100], [100, 500], [500, 100000]]) {
  console.log(`  市值[${lo},${hi})亿 早期: ${cb(early, lo, hi)} | 近期: ${cb(recent, lo, hi)}`);
}
console.log(`  市值中位: 早期 ${early.map(s => s._f.capYi).sort((a, b) => a - b)[Math.floor(early.length / 2)]}亿 | 近期 ${recent.map(s => s._f.capYi).sort((a, b) => a - b)[Math.floor(recent.length / 2)]}亿`);

// ── ⑤ 信号日×次日 涨跌比分层 ──
console.log('\n=== ⑤ auczt 按「信号日涨跌比×次日涨跌比」分层 ===');
const urOf = d => { const x = dayTot[d] ? (dayUp[d] || 0) / dayTot[d] * 100 : null; return x; };
const regime = u => u == null ? '?' : u < 40 ? '普跌' : u < 60 ? '震荡' : '普涨';
for (const s of aucF) { s._su = urOf(dash(s.date)); s._nu = urOf(dash(s.nd.date)); }
for (const combo of [['普涨', '普涨'], ['普涨', '普跌'], ['普跌', '普涨'], ['普跌', '普跌'], ['震荡', '震荡'], ['震荡', '普涨'], ['震荡', '普跌']]) {
  const b = aucF.filter(s => regime(s._su) === combo[0] && regime(s._nu) === combo[1]);
  if (!b.length) continue;
  const n = b.length;
  console.log(`  信号日${combo[0]}→次日${combo[1]}: n=${n} +3%:${(b.filter(s => s.nd.nextPct >= 3).length / n * 100).toFixed(0)}% 涨停:${(b.filter(s => s.nd.limitUp).length / n * 100).toFixed(0)}%`);
}

// ── ⑥ paths 结构 ──
console.log('\n=== ⑥ auczt paths 命中结构（早期 vs 近期，占比%） ===');
function pathStat(arr) {
  const m = {};
  for (const s of arr) for (const p of (s.paths || [])) m[p] = (m[p] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / arr.length * 100).toFixed(0)}%`).join(' ');
}
console.log('  早期:', pathStat(early));
console.log('  近期:', pathStat(recent));

// ── ⑦ yier/lianban 简版归因（n 小，只看按日+环境） ──
console.log('\n=== ⑦ yier/lianban 按日（nd 口径） ===');
for (const t of ['yier', 'lianban']) {
  const arr = sigs.filter(s => s.type === t);
  const bd = {};
  for (const s of arr) { const d = String(s.date); (bd[d] = bd[d] || []).push(s); }
  for (const d of Object.keys(bd).sort()) {
    const a = bd[d], n = a.length;
    const wnd = a.filter(s => s.nd);
    console.log(`  ${t} ${d}: n=${n} 已回填${wnd.length}` + (wnd.length ? ` +3%:${(wnd.filter(s => s.nd.nextPct >= 3).length / wnd.length * 100).toFixed(0)}% 涨停:${(wnd.filter(s => s.nd.limitUp).length / wnd.length * 100).toFixed(0)}%` : '（待回填）'));
  }
}
