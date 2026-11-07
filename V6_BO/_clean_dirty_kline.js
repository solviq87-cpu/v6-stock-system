// 一次性工具（不进发布包）：清理 .kline_cache 里「volume=0 但 close 有效」的脏柱。
// 背景（2026-10-19 it2）：is 轮数据源故障时，同花顺对「当天成交未结算」的票返回 close 有值但
//   volume=0 的半成品柱，被 fetchKlineThs 的 `+f[5] || 0` 写成 0、又被 klineRows 的「只看日期」
//   落盘判据写进缓存（本机实测 38 只票、全是 10-19 那根）。这些柱 close 也可能是盘中价非收盘价，
//   整根不可信。而 klineRows 缓存是「只升不降」——源现在最新退回 10-16，不会自动覆盖 10-19 脏柱，
//   必须手动清除。
// 用法：node _clean_dirty_kline.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '.kline_cache');
const bakDir = path.join(__dirname, '.kline_dirty_bak');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });

const isDirty = r => +r.close > 0 && !(+r.volume > 0);
let cleanedFiles = 0, cleanedBars = 0;
const ops = [];

for (const f of files) {
  const fp = path.join(dir, f);
  let k;
  try { k = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
  const rows = k.rows || [];
  const dirty = rows.filter(isDirty);
  if (!dirty.length) continue;
  fs.writeFileSync(path.join(bakDir, f), JSON.stringify(k));          // 先备份原始文件
  k.rows = rows.filter(r => !isDirty(r));                             // 再删脏柱
  fs.writeFileSync(fp, JSON.stringify(k));
  cleanedFiles++; cleanedBars += dirty.length;
  ops.push({ code: f.replace('.json', ''), removed: dirty.map(r => r.date) });
}

fs.writeFileSync(path.join(__dirname, '.kline_dirty_ops.json'),
  JSON.stringify({ ts: Date.now(), cleanedFiles, cleanedBars, ops }, null, 2));
console.log(`清理完成：${cleanedFiles} 只票 / ${cleanedBars} 根脏柱`);
console.log('备份目录：.kline_dirty_bak/   流水：.kline_dirty_ops.json');
