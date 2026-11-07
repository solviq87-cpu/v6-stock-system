// 把全市场的「前窗特征 + 次日标签」缓存成一份文件。
// extract() 挺贵（全市场约 46s），调参要反复跑，缓存一次后面几秒就能迭代。
const fs = require('fs');
const path = require('path');
const Z = require('./ztpre.js');
const A = require('./analysis.js');

const CACHE = path.join(__dirname, '.kline_cache');
// 输出改到工件目录：这份 16MB 特征缓存不进发布包，放 ROOT 里只会撑包体（2026-10-23 包体事故）
const OUT = path.join(__dirname, '..', 'stock-dashboard-artifacts', 'cache', '.ztpre_feat.json');
if (fs.existsSync(OUT)) { console.log('已存在缓存，跳过（删掉 cache/.ztpre_feat.json 可重建）'); process.exit(0); }

const files = fs.readdirSync(CACHE).filter(f => /^\d{6}\.json$/.test(f));
const T0 = Date.now();
const out = {};
for (const fn of files) {
  const code = fn.slice(0, 6);
  let d; try { d = JSON.parse(fs.readFileSync(path.join(CACHE, fn), 'utf8')); } catch { continue; }
  const rows = (d && d.rows) || [];
  if (rows.length < 40) continue;
  const name = d.name || '';
  if (/ST|退/.test(name)) continue;
  const list = [];
  const isLimitUp = pct => A.isLimitUp(code, name, pct);
  for (let i = 30; i < rows.length - 1; i++) {
    if (!(Number(rows[i].close) > 2)) continue;
    const f = Z.extract(rows, i, {}); if (!f) continue;
    const lb = Z.labelOf(rows, i, { isLimitUp }); if (!lb) continue;
    list.push([f.keys.join(','), lb.zt ? 1 : 0, lb.hit ? 1 : 0]);
  }
  if (list.length) out[code] = list;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
let n = 0, z = 0; for (const c of Object.keys(out)) for (const s of out[c]) { n++; z += s[1]; }
console.log(`缓存完成：${Object.keys(out).length} 只票 / ${n} 条样本 / 封板 ${(z / n * 100).toFixed(2)}% / 耗时 ${((Date.now() - T0) / 1000).toFixed(0)}s`);
