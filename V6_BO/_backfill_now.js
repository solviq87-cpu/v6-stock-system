// 全市场 K 线一次性补齐：直接写 .kline_cache，不启服务
const fs = require('fs'), path = require('path');
const em = require('./em.js');
const KLINE = path.join(__dirname, '.kline_cache');
const uni = JSON.parse(fs.readFileSync('.universe_cache.json', 'utf8')).map(String).filter(x => /^\d{6}$/.test(x));
// 名字表：腾讯源不返回 name，这里用 universe 里能拿到的 + 已缓存文件的 name 兜底
const nameMap = new Map();
for (const fn of fs.readdirSync(KLINE)) {
  const m = /^(\d{6})\.json$/.exec(fn); if (!m) continue;
  try { const j = JSON.parse(fs.readFileSync(path.join(KLINE, fn), 'utf8')); if (j && j.name) nameMap.set(m[1], j.name); } catch {}
}
const cached = new Set();
for (const fn of fs.readdirSync(KLINE)) { const m = /^(\d{6})\.json$/.exec(fn); if (m) cached.add(m[1]); }
let todo = uni.filter(c => !cached.has(c));
console.log(`票池 ${uni.length} 已缓存 ${cached.size} 待补 ${todo.length}`);
(async () => {
  const t0 = Date.now();
  let total = 0, totalFail = 0;
  const ROUND = 800;
  while (todo.length) {
    const batch = todo.slice(0, ROUND);
    const r = await em.fetchKlineBulk(batch, 60, 12);
    for (const [code, k] of r.map) {
      if (!k.name) k.name = nameMap.get(code) || '';
      try { fs.writeFileSync(path.join(KLINE, code + '.json'), JSON.stringify(k)); total++; } catch {}
    }
    totalFail += r.fail || 0;
    const done = total;
    console.log(`  本轮 ${batch.length} → 写入 ${r.added} 失败 ${r.fail} | 累计补 ${total} | 剩余 ${todo.length - batch.length} | ${((Date.now()-t0)/1000).toFixed(0)}s`);
    todo = todo.slice(ROUND);
    if (!r.added && todo.length) { console.log('  本轮零产出，暂停 5s 后退避重试'); await new Promise(r2 => setTimeout(r2, 5000)); }
  }
  const after = fs.readdirSync(KLINE).filter(f => /^\d{6}\.json$/.test(f)).length;
  console.log(`✅ 完成：写入 ${total} 只，失败 ${totalFail} 只，缓存 ${after}/${uni.length} = ${(after/uni.length*100).toFixed(1)}%，耗时 ${((Date.now()-t0)/1000).toFixed(0)}s`);
})();
