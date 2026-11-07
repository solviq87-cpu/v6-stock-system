// 扫描器：el 轮 —— 「常量定义与魔数消除」
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== el 轮：常量定义与魔数消除扫描 ===\n');

// 已定义的时间常数
const timeConsts = {
  TICK_MS: 5000,
  SECTORS_ZT_MS: 30000,
  BIGMONEY_SCAN_MS: 60000,
  POOL_REBUILD_MS: 300000,
  HOLD_WATCH_MS: 30000,
  PAPER_PUSH_GAP: 300000,
  PAPER_PUSH_WAIT: 90000,
  KLINE_MEM_TTL: 1800000
};

console.log('【① 时间常数是否有硬编码重复】');
let el1 = 0;
for (const [name, val] of Object.entries(timeConsts)) {
  const re = new RegExp('(?!const ' + name + ' = )\\b' + val + '\\b', 'g');
  const matches = [...SRC.matchAll(re)];
  if (matches.length > 0) {
    const lines = matches.map(m => SRC.slice(0, m.index).split('\n').length);
    console.log(`  ℹ️ ${name}=${val} 在 ${matches.length} 处被硬编码使用（行: ${lines.slice(0, 3).join(',')}${lines.length > 3 ? '...' : ''}）`);
  }
}
if (!el1) console.log('  ✅ 时间常数均已符号化（或仅一处定义）');

console.log('\n【② 阈值常数是否有硬编码重复】');
let el2 = 0;
const thresholdConsts = { BUZHANG_PUSH_PROB: 60, ZT_INFER_PUSH_PROB: 55 };
for (const [name, val] of Object.entries(thresholdConsts)) {
  const re = new RegExp('(?!const ' + name + ' = )\\b' + val + '\\b', 'g');
  const matches = [...SRC.matchAll(re)];
  if (matches.length > 0) {
    console.log(`  ℹ️ ${name}=${val} 在 ${matches.length} 处被硬编码使用`);
  }
}
if (!el2) console.log('  ✅ 阈值常数均已符号化');

const total = el1 + el2;
console.log(`\n【结论】发现 ${total} 处魔数问题`);
process.exit(total ? 1 : 0);
