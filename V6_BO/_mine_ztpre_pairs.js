// 涨停前形态 · 组合规律挖掘（一次性分析脚本，不是单测）
// ztpre 库里只存了单维度统计（S:dim:bin），单因子最强也只有 8% 封板率。
// 真正能用的是**组合**：把两个维度交叉起来看，找那些"同时满足"时封板率最高的形态。
const fs = require('fs');
const path = require('path');
const Z = require('./ztpre.js');
const A = require('./analysis.js');

const CACHE = path.join(__dirname, '.kline_cache');
const files = fs.readdirSync(CACHE).filter(f => /^\d{6}\.json$/.test(f));

const T0 = Date.now();
const DIMS = Z.DIMS, DK = DIMS.map(d => d.key);
const base = { n: 0, zt: 0, hit: 0 };
const single = new Map();   // 'di:bi' -> [n,zt,hit]
const pair = new Map();     // 'diA:biA|diB:biB' -> [n,zt,hit]

const bump = (m, k, zt, hit) => {
  let e = m.get(k);
  if (!e) m.set(k, e = [0, 0, 0]);
  e[0]++; if (zt) e[1]++; if (hit) e[2]++;
};

let stocks = 0, samples = 0;
for (const fn of files) {
  const code = fn.slice(0, 6);
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(CACHE, fn), 'utf8')); } catch { continue; }
  const rows = (d && d.rows) || [];
  if (rows.length < 40) continue;
  const name = d.name || '';
  if (/ST|退/.test(name)) continue;
  const isLimitUp = pct => A.isLimitUp(code, name, pct);
  stocks++;
  for (let i = 30; i < rows.length - 1; i++) {
    if (!(Number(rows[i].close) > 2)) continue;
    const f = Z.extract(rows, i, {});
    if (!f) continue;
    const lb = Z.labelOf(rows, i, { isLimitUp });
    if (!lb) continue;
    base.n++; if (lb.zt) base.zt++; if (lb.hit) base.hit++;
    samples++;
    for (let di = 0; di < DK.length; di++) bump(single, di + ':' + f.keys[di].split(':')[2], lb.zt, lb.hit);
    for (let a = 0; a < DK.length; a++) {
      const ka = f.keys[a].split(':')[2];
      for (let b = a + 1; b < DK.length; b++) {
        bump(pair, a + ':' + ka + '|' + b + ':' + f.keys[b].split(':')[2], lb.zt, lb.hit);
      }
    }
  }
}
const bz = base.zt / base.n * 100, bh = base.hit / base.n * 100;
console.log(`\n样本 ${samples} 条 / ${stocks} 只票，耗时 ${((Date.now() - T0) / 1000).toFixed(1)}s`);
console.log(`基准：次日封板 ${bz.toFixed(2)}%   次日涨≥3% ${bh.toFixed(2)}%\n`);

function topPairs(minN) {
  const out = [];
  for (const [k, e] of pair) {
    if (e[0] < minN) continue;
    const rate = e[1] / e[0] * 100, hit = e[2] / e[0] * 100;
    if (rate <= bz) continue;
    const [A1, B1] = k.split('|');
    const [da, ba] = A1.split(':').map(Number);
    const [db2, bb] = B1.split(':').map(Number);
    out.push({
      txt: `${DIMS[da].name}=${DIMS[da].bins[ba][2]} × ${DIMS[db2].name}=${DIMS[db2].bins[bb][2]}`,
      n: e[0], rate: +rate.toFixed(2), lift: +(rate - bz).toFixed(2), mult: +(rate / bz).toFixed(1),
      hit: +hit.toFixed(1), hitLift: +(hit - bh).toFixed(1)
    });
  }
  out.sort((a, b) => b.mult - a.mult || b.n - a.n);
  return out;
}

for (const minN of [200, 500, 1000]) {
  const t = topPairs(minN);
  console.log(`══ 组合 TOP（样本≥${minN}，共 ${t.length} 条满足） ══`);
  t.slice(0, 12).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.txt}`);
    console.log(`    样本${String(r.n).padStart(6)}  封板 ${String(r.rate).padStart(5)}% (${r.mult}倍基准, +${r.lift}pp)  次日涨≥3% ${String(r.hit).padStart(5)}% (+${r.hitLift}pp)`);
  });
  console.log('');
}
