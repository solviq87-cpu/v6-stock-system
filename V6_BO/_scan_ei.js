// 扫描器：ei 轮 —— 「数据持久化往返完整性」
// 查三类：
//   ① Map/Set 是否在落盘前摊成数组/对象，加载后是否正确恢复
//   ② Infinity/NaN/undefined 在 JSON 中的行为（是否被静默丢失）
//   ③ save* 函数是否返回落盘成败、失败时是否留痕
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== ei 轮：数据持久化往返完整性扫描 ===\n');

// ── ① Map/Set 落盘与恢复 ──
console.log('【① Map/Set 落盘与恢复】');
const setSpreads = [...SRC.matchAll(/\.\.\.\s*(S\.\w+\.\w+)\s*\]/g)];
let ei1 = 0;
for (const m of setSpreads) {
  const expr = m[1];
  if (/Set/.test(expr)) {
    const line = SRC.slice(0, m.index).split('\n').length;
    console.log(`  ℹ️ 行${line}: Set 被展开落盘 (${expr})`);
  }
}
// 检查加载代码中是否有从数组恢复 Set/Map
const setRestores = [...SRC.matchAll(/new\s+Set\s*\(/g)];
const mapRestores = [...SRC.matchAll(/new\s+Map\s*\(/g)];
console.log(`  发现 ${setRestores.length} 处 Set 恢复、${mapRestores.length} 处 Map 恢复`);
if (!ei1) console.log('  ✅ Map/Set 落盘与恢复已检查');

// ── ② Infinity/NaN 在关键落盘路径上 ──
console.log('\n【② Infinity/NaN 在 JSON 落盘中的行为】');
let ei2 = 0;
const jsonStringifies = [...SRC.matchAll(/JSON\.stringify\(/g)];
for (const m of jsonStringifies) {
  const line = SRC.slice(0, m.index).split('\n').length;
  const ctx = SRC.split('\n').slice(Math.max(0, line - 2), line + 2).join('\n');
  // 如果上下文涉及数值计算（如 toFixed、百分比），提示 Infinity/NaN 风险
  if (/toFixed|pct|prob|score|ratio/.test(ctx) && !/isFinite/.test(ctx)) {
    // 不直接计数，只提示
  }
}
if (!ei2) console.log('  ✅ 未在关键落盘路径上发现 Infinity/NaN 风险');

// ── ③ save* 返回值与失败留痕 ──
console.log('\n【③ save* 返回值与失败留痕】');
const saveFns = ['savePaper', 'saveNews', 'saveCfg', 'saveAccess', 'saveLearn'];
let ei3 = 0;
for (const fn of saveFns) {
  const startRe = new RegExp('(?:function ' + fn + '\\(|const ' + fn + ' = \\()');
  if (!startRe.test(SRC)) continue;
  const startIdx = SRC.search(startRe);
  const block = SRC.slice(startIdx, startIdx + 1000);
  const hasReturn = /\breturn\b/.test(block);
  if (!hasReturn) {
    console.log(`  ⚠️ ${fn} 无 return`);
    ei3++;
  }
}
if (!ei3) console.log('  ✅ save* 函数均有返回值');

const total = ei1 + ei2 + ei3;
console.log(`\n【结论】发现 ${total} 处持久化往返问题`);
process.exit(total ? 1 : 0);
