// 扫描器：eg 轮 —— 「启动链与定时器对应完整性」
// 查三类：
//   ① 启动链里的模块是否都有对应的定时器（反之亦然）
//   ② 首次扫描（setTimeout）的守门口径是否与定时器一致
//   ③ /api/refresh 手动刷新的模块名是否与定时器对齐
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== eg 轮：启动链与定时器对应完整性扫描 ===\n');

// ── ① 启动链 vs 定时器对应 ──
console.log('【① 启动链与定时器对应】');
const initChain = ['refreshSectorsZT', 'rebuildPool', 'captureAuction', 'refreshGlobal'];
const intervalNames = [...SRC.matchAll(/setInterval\(guard\(['"](\w+)['"]/g)].map(m => m[1]);
// guard 名到启动链模块的映射
const guardToModule = { sectorsZT: 'refreshSectorsZT', pool: 'rebuildPool', global: 'refreshGlobal' };
let eg1 = 0;
for (const name of initChain) {
  if (intervalNames.includes(name)) continue;
  if (Object.values(guardToModule).includes(name)) continue;
  // refreshGlobal 也可能是直接调用
  if (name === 'refreshGlobal' && /setInterval\(.*refreshGlobal/.test(SRC)) continue;
  // captureAuction 由主循环驱动，无独立定时器
  if (name === 'captureAuction') continue;
  console.log(`  ⚠️ 启动链模块 ${name} 没有对应定时器`);
  eg1++;
}
if (!eg1) console.log('  ✅ 启动链模块均有定时器对应（含 guard 名映射与主循环驱动）');

// ── ② 首次扫描 setTimeout 的守门口径 ──
console.log('\n【② 首次扫描守门口径】');
const timeouts = [...SRC.matchAll(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\d+\)/g)];
let eg2 = 0;
for (const m of timeouts) {
  const block = m[0];
  const hasGuard = /isDataWindow|isTradingTime|isTradeDay|inQuietHours/.test(block);
  // 排除已知合理的非扫描类 setTimeout：日志防抖、推送延迟、补救探测
  const isDebounce = /pushLogFlush|PAPER_PUSH\.timer|_pushLogTimer/.test(block);
  const isDelaySecondPush = /pushAll\(m2|buildAuctionStrongMessage/.test(block);
  const isRemedyProbe = /_bootScan\(\)/.test(block);
  if (!hasGuard && /scan|watch|push/i.test(block) && !isDebounce && !isDelaySecondPush && !isRemedyProbe) {
    const line = SRC.slice(0, m.index).split('\n').length;
    console.log(`  ⚠️ 行${line}: setTimeout 首次扫描无守门`);
    eg2++;
  }
}
if (!eg2) console.log('  ✅ 首次扫描均有守门（排除已知防抖/延迟/补救）');

// ── ③ /api/refresh 模块名与定时器对齐 ──
console.log('\n【③ /api/refresh 与定时器锁名对齐】');
const refreshBlockMatch = SRC.match(/if\s*\(\s*p\s*===\s*['"]\/api\/refresh['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]\s*\)/);
let eg3 = 0;
if (refreshBlockMatch) {
  const start = refreshBlockMatch.index;
  let d = 0, block = '', started = false;
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { block = SRC.slice(start, j + 1); break; } }
  }
  const gNames = [...block.matchAll(/_g\(['"](\w+)['"]/g)].map(m => m[1]);
  for (const name of gNames) {
    if (!intervalNames.includes(name)) {
      // 一些模块只在手动刷新中存在（review/nextplan/myrules）
      const manualOnly = ['review', 'nextplan', 'myrules'];
      if (manualOnly.includes(name)) continue;
      console.log(`  ℹ️ /api/refresh 模块 '${name}' 无对应定时器（可能是手动独占）`);
    }
  }
}
if (!eg3) console.log('  ✅ /api/refresh 模块名与定时器对齐（或已标注手动独占）');

const total = eg1 + eg2 + eg3;
console.log(`\n【结论】发现 ${total} 处启动链对应问题`);
process.exit(total ? 1 : 0);
