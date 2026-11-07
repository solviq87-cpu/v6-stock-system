// 离线跑「连续收涨」扫描（与 server.js scanSteadyUp 同判据）
const fs = require('fs'), path = require('path');
const A = require('./analysis.js');
const LEARNALL = require('./learnall.js');
const KLINE = path.join(__dirname, '.kline_cache');
const DB = LEARNALL.load();

const files = fs.readdirSync(KLINE).filter(f => /^\d{6}\.json$/.test(f));
const out = [];
const REJ = { zt: 0, lb: 0, run: 0, gentle: 0, cum: 0, ma20: 0, rows: 0 };
for (const fn of files) {
  const code = fn.slice(0, 6);
  let k; try { k = JSON.parse(fs.readFileSync(path.join(KLINE, fn), 'utf8')); } catch { continue; }
  const rows = k && k.rows;
  if (!rows || rows.length < 25) { REJ.rows++; continue; }
  const i = rows.length - 1, name = k.name || code;
  const limitPct = A.limitPctOf(code, name);
  const last = rows[i];
  if ((last.pct || 0) >= limitPct - 0.5) { REJ.zt++; continue; }
  let lb = 0;
  for (let j = i; j >= 1; j--) { if ((rows[j].pct || 0) >= limitPct - 0.5) lb++; else break; }
  if (lb >= 4) { REJ.lb++; continue; }
  let run = 0;
  for (let j = i; j >= 1; j--) { const c0 = rows[j].close, c1 = rows[j - 1].close; if (c0 > 0 && c1 > 0 && c0 > c1) run++; else break; }
  if (run < 3) { REJ.run++; continue; }
  const seg = rows.slice(i - run + 1, i + 1);
  if (!seg.every(r => (r.pct || 0) > 0 && (r.pct || 0) <= 7)) { REJ.gentle++; continue; }
  if (seg.some(r => (r.pct || 0) < -3)) { REJ.gentle++; continue; }
  const c0 = rows[i - run].close, c1 = rows[i].close;
  if (!(c0 > 0)) continue;
  const cum = +((c1 / c0 - 1) * 100).toFixed(1);
  if (cum < 2 || cum > 25) { REJ.cum++; continue; }
  const closes = rows.map(r => r.close).filter(v => v > 0);
  if (closes.length < 21) continue;
  const ma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const ma20p = closes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  if (!(c1 > ma20) || !(ma20 >= ma20p * 0.998)) { REJ.ma20++; continue; }
  let s5 = 0, s20 = 0;
  for (let j = Math.max(0, i - 4); j <= i; j++) s5 += rows[j].volume || 0;
  for (let j = Math.max(0, i - 19); j <= i; j++) s20 += rows[j].volume || 0;
  const vt = s20 > 0 ? +((s5 / 5) / (s20 / 20)).toFixed(2) : 1;
  let ztP = null, why = '';
  try {
    const f = LEARNALL.extractFeatures(rows, i, { limitPct });
    if (f) { const pz = LEARNALL.predictML(f, DB, 'zt'); if (pz) { ztP = +(pz.p * 100).toFixed(1); why = pz.rules ? pz.rules.slice(0, 2).map(r => `${r.txt}(${r.n}例→${r.rate}%)`).join('、') : ''; } }
  } catch {}
  out.push({ code, name, price: last.close, pct: +(last.pct || 0).toFixed(2), run, cum, volTrend: vt, ztP, why });
}
out.sort((a, b) => (b.run - a.run) || ((b.ztP || 0) - (a.ztP || 0)));
console.log(`全市场 ${files.length} 只 → 连续收涨入选 ${out.length} 只`);
console.log('淘汰原因:', JSON.stringify(REJ));
console.log('\n═══ TOP 15 ═══');
console.log('名次 名称(代码)         现价   今涨%  连涨  累计%  量能  学后封板%');
out.slice(0, 15).forEach((x, i) => {
  console.log(`${String(i + 1).padStart(3)}  ${(x.name + '(' + x.code + ')').padEnd(17)} ${String(x.price).padStart(7)} ${String(x.pct).padStart(6)} ${String(x.run).padStart(4)} ${String(x.cum).padStart(6)} ${String(x.volTrend).padStart(5)} ${String(x.ztP == null ? '-' : x.ztP).padStart(8)}`);
});
console.log('\n连涨天数分布:');
const byRun = {}; for (const x of out) byRun[x.run] = (byRun[x.run] || 0) + 1;
console.log(' ', JSON.stringify(byRun));
