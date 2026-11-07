'use strict';
// 一次性补齐 2026-10-13 日K（服务端补齐器 15:30 前只刷新前 1200 只，其余要等收盘后）
// 与 _backfill_now.js 的区别：按【新鲜度】筛（最后一日 != 2026-10-13 才补），不是按「有没有文件」。
const fs = require('fs'), path = require('path');
const em = require('./em.js');
const KLINE = path.join(__dirname, '.kline_cache');
const TARGET = '2026-10-13';
const uni = JSON.parse(fs.readFileSync('.universe_cache.json', 'utf8')).map(String).filter(x => /^[0-9]{6}$/.test(x));
const todo = [];
for (const c of uni) {
  const p = path.join(KLINE, c + '.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const rows = j.rows || [];
    if (rows.length && rows[rows.length - 1].date === TARGET) continue;
  } catch {}
  todo.push(c);
}
console.log(`票池 ${uni.length}，缺 ${TARGET} 日K ${todo.length} 只`);
(async () => {
  const t0 = Date.now();
  let total = 0, fail = 0;
  const ROUND = 600;
  while (todo.length) {
    const batch = todo.slice(0, ROUND);
    let r;
    try { r = await em.fetchKlineBulk(batch, 60, 6); } catch (e) { r = { map: new Map(), fail: batch.length }; }
    for (const [code, k] of (r.map || new Map())) {
      try { fs.writeFileSync(path.join(KLINE, code + '.json'), JSON.stringify(k)); total++; } catch {}
    }
    fail += r.fail || 0;
    console.log(`  本轮 ${batch.length} → 写入 ${(r.map || new Map()).size} 失败 ${r.fail || 0} | 累计 ${total} | 剩余 ${todo.length - batch.length} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    todo.splice(0, ROUND);
    if (!(r.map || new Map()).size && todo.length) { console.log('  本轮零产出，退避 5s'); await new Promise(x => setTimeout(x, 5000)); }
  }
  let after = 0;
  for (const c of uni) { try { const j = JSON.parse(fs.readFileSync(path.join(KLINE, c + '.json'), 'utf8')); const rows = j.rows || []; if (rows.length && rows[rows.length - 1].date === TARGET) after++; } catch {} }
  console.log(`✅ 完成：写入 ${total} 失败 ${fail}，现有 ${TARGET} 日K ${after}/${uni.length}，耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
