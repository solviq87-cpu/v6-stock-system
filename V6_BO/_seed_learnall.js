// 自学模型全量回填（_seed_learnall.js）
// ---------------------------------------------------------------------------
// 为什么需要它：learnall 的模型是**增量**维护的（每只票按"最后一条已计数的K线日期"续跑），
// 日常只需跑当天新增。但每次发版重建、或首次上线都是从空库开始 —— 只靠每天收盘那点增量，
// 模型要几个月才够用，而选股在样本不足时会整段跳过「自学历修正」（server.js 里 laBase<=0 就 break）。
// 这个脚本把磁盘上的历史K线一次性喂给模型，让它从上线第一分钟就有料。
//
// 用法：node _seed_learnall.js [K线缓存目录 默认 .kline_cache]
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./learnall.js');
const A = require('./analysis.js');

const DIR = process.argv[2] || path.join(__dirname, '.kline_cache');
const limitPctOf = code => { try { return A.limitPctOf(code, ''); } catch { return 10; } };

let files = [];
try { files = fs.readdirSync(DIR).filter(f => /^\d{6}\.json$/.test(f)); } catch {}
if (!files.length) { console.error('没有找到K线缓存：' + DIR); process.exit(1); }

console.log('开始回填，共 ' + files.length + ' 个K线文件…');
const t0 = Date.now();
const rowsByCode = {};
let skipped = 0;
for (const f of files) {
  const code = f.slice(0, 6);
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!d || !Array.isArray(d.rows) || d.rows.length < 6) { skipped++; continue; }
    rowsByCode[code] = { rows: d.rows, limitPct: limitPctOf(code) };
  } catch { skipped++; }
}
const old = (() => { try { return JSON.parse(fs.readFileSync(L.FILE, 'utf8')); } catch { return null; } })();
console.log(`可读K线 ${Object.keys(rowsByCode).length} 只（跳过 ${skipped}）`);
if (old && old.ver !== L.VER) console.log(`旧库是 v${old.ver || 1}：特征是损坏的常数（字段名对不上），将被弃用重建`);

const r = L.ingestAll(rowsByCode);
console.log('──────────────────────────────');
console.log(`回填完成：新增 ${r.added} 条，累计 ${r.total} 条样本（跳过无日期 ${r.skippedNoDate} 只）`);
console.log(`全市场基准：次日涨≥${L.LABEL_THR}% ${(r.base * 100).toFixed(2)}% ｜ 次日封板 ${(r.baseZt * 100).toFixed(2)}%`);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('\n机器自己挖出来的「次日涨≥3%」Top 规律：');
for (const x of (old || {}, JSON.parse(fs.readFileSync(L.FILE, 'utf8')).rules.up3.single || []).slice(0, 8))
  console.log(`  ▪ ${x.txt}：${x.n}例 → ${x.rate}%（${x.lift}倍）`);
console.log('机器自己挖出来的「次日封板」Top 规律：');
for (const x of (JSON.parse(fs.readFileSync(L.FILE, 'utf8')).rules.zt.single || []).slice(0, 8))
  console.log(`  ▪ ${x.txt}：${x.n}例 → ${x.rate}%（${x.lift}倍）`);
const sz = fs.statSync(L.FILE).size;
console.log(`\n${L.FILE} 体积 ${(sz / 1024).toFixed(1)} KB`);
