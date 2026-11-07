// 组合规律挖掘 II：以「刚突破20日高」为条件的细分 + 全样本反向（该躲的）形态
const fs = require('fs');
const path = require('path');
const Z = require('./ztpre.js');
const A = require('./analysis.js');

const CACHE = path.join(__dirname, '.kline_cache');
const files = fs.readdirSync(CACHE).filter(f => /^\d{6}\.json$/.test(f));
const DIMS = Z.DIMS, DK = DIMS.map(d => d.key);
const BRK = DK.length - 1;   // 'brk' 是最后一维

const bump = (m, k, zt, hit) => { let e = m.get(k); if (!e) m.set(k, e = [0, 0, 0]); e[0]++; if (zt) e[1]++; if (hit) e[2]++; };

const all = { n: 0, zt: 0, hit: 0 };
const cond = new Map();      // 条件：brk=1 下，各维各档 -> [n,zt,hit]
const worst = new Map();     // 全样本：单维各档（用于找反向）

for (const fn of files) {
  const code = fn.slice(0, 6);
  let d; try { d = JSON.parse(fs.readFileSync(path.join(CACHE, fn), 'utf8')); } catch { continue; }
  const rows = (d && d.rows) || [];
  if (rows.length < 40) continue;
  const name = d.name || '';
  if (/ST|退/.test(name)) continue;
  const isLimitUp = pct => A.isLimitUp(code, name, pct);
  for (let i = 30; i < rows.length - 1; i++) {
    if (!(Number(rows[i].close) > 2)) continue;
    const f = Z.extract(rows, i, {}); if (!f) continue;
    const lb = Z.labelOf(rows, i, { isLimitUp }); if (!lb) continue;
    all.n++; if (lb.zt) all.zt++; if (lb.hit) all.hit++;
    const bi = di => Number(f.keys[di].split(':')[2]);
    for (let di = 0; di < DK.length; di++) bump(worst, di + ':' + bi(di), lb.zt, lb.hit);
    if (bi(BRK) === 1) for (let di = 0; di < BRK; di++) bump(cond, di + ':' + bi(di), lb.zt, lb.hit);
  }
}
const bz = all.zt / all.n * 100, bh = all.hit / all.n * 100;
console.log(`\n全样本 ${all.n} 条｜基准封板 ${bz.toFixed(2)}%｜基准涨≥3% ${bh.toFixed(2)}%\n`);

function dump(m, title, minN, mode) {
  const rows = [];
  for (const [k, e] of m) {
    if (e[0] < minN) continue;
    const [di, bi] = k.split(':').map(Number);
    rows.push({ txt: `${DIMS[di].name}=${DIMS[di].bins[bi][2]}`, n: e[0], rate: +(e[1] / e[0] * 100).toFixed(2), hit: +(e[2] / e[0] * 100).toFixed(1) });
  }
  rows.sort((a, b) => mode === 'best' ? b.rate - a.rate : a.rate - b.rate);
  console.log(`══ ${title}（样本≥${minN}）══`);
  rows.slice(0, 10).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.txt.padEnd(28)} 样本${String(r.n).padStart(5)}  封板 ${String(r.rate).padStart(5)}% (${(r.rate / bz).toFixed(1)}倍)  涨≥3% ${String(r.hit).padStart(5)}%`);
  });
  console.log('');
}
dump(cond, '已「刚突破20日高」的票，再看哪一项最能加分', 300, 'best');
dump(worst, '全样本里最该躲的形态（封板率最低）', 2000, 'worst');
