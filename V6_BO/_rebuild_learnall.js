// 全市场重灌学习库（v3：新增 6 个趋势形态维度）
// 用法: node _rebuild_learnall.js           —— 用 .kline_cache 里所有票重灌
//       node _rebuild_learnall.js --dry     —— 只统计不写盘
// ⚠️ 维度变了（11 → 17），v2 的立方统计全部作废，必须整库重建（learnall.load 会因 VER 不符自动弃用旧库）
const fs = require('fs'), path = require('path');
const L = require('./learnall.js');
const A = require('./analysis.js');
const KLINE = path.join(__dirname, '.kline_cache');
const DRY = process.argv.includes('--dry');

const t0 = Date.now();
const files = fs.readdirSync(KLINE).filter(f => /^\d{6}\.json$/.test(f));
console.log(`K线缓存 ${files.length} 只，开始读取...`);
const rowsByCode = {};
let bad = 0;
for (const fn of files) {
  const code = fn.slice(0, 6);
  try {
    const k = JSON.parse(fs.readFileSync(path.join(KLINE, fn), 'utf8'));
    if (k && Array.isArray(k.rows) && k.rows.length >= 25) {
      rowsByCode[code] = { rows: k.rows, limitPct: A.limitPctOf(code, k.name || '') };
    } else bad++;
  } catch { bad++; }
}
const n = Object.keys(rowsByCode).length;
console.log(`可入库 ${n} 只（跳过 ${bad} 只：K线不足 25 根或读失败），耗时 ${Date.now() - t0}ms`);
if (!n) { console.log('没有可入库的票'); process.exit(1); }

if (DRY) { console.log('--dry 模式，不写盘'); process.exit(0); }

const db0 = L.load();
console.log(`当前库: ver=${db0.ver} n=${db0.n}（VER=${L.VER}，版本不符会自动弃用重建）`);
const t1 = Date.now();
const r = L.ingestAll(rowsByCode);
console.log('入库完成:', JSON.stringify(r).slice(0, 400));
console.log(`耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const db = L.load();
console.log(`新库: ver=${db.ver} n=${db.n} 覆盖${Object.keys(db.prog || {}).length}只 ` +
  `up3基准=${(db.base * 100).toFixed(2)}% zt基准=${((db.baseZt || 0) * 100).toFixed(2)}% ` +
  `立方键=${Object.keys(db.stat || {}).length}`);
console.log(`规则: up3 ${(db.rules && db.rules.up3) ? (db.rules.up3.single.length + db.rules.up3.pair.length) : 0} 条 / ` +
  `zt ${(db.rules && db.rules.zt) ? (db.rules.zt.single.length + db.rules.zt.pair.length) : 0} 条`);
if (db.rules && db.rules.zt && db.rules.zt.single.length) {
  console.log('zt 单维 TOP8:');
  for (const x of db.rules.zt.single.slice(0, 8)) console.log(`   ${x.txt}  n=${x.n}  ${x.rate}%  lift=${x.lift}`);
}
