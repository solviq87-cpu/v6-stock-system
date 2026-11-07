// 扫描器：ej 轮 —— 「内存泄漏与资源清理」
// 查三类：
//   ① 缓存是否有 TTL/上限清理
//   ② Map/Set 是否只 set 不 delete（无限增长）
//   ③ 定时器/锁是否在 finally 中释放
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== ej 轮：内存泄漏与资源清理扫描 ===\n');

// ── ① 缓存 TTL ──
console.log('【① 缓存 TTL 清理】');
let ej1 = 0;
const ttlPatterns = [
  { name: 'KLINE_MEM_TTL', re: /KLINE_MEM_TTL/ },
  { name: 'inflowHistory 10min', re: /inflowHistory.*delete|10\s*\*\s*60\s*\*\s*1000/ },
];
for (const p of ttlPatterns) {
  if (!p.re.test(SRC)) {
    console.log(`  ⚠️ ${p.name} 清理逻辑未找到`);
    ej1++;
  }
}
if (!ej1) console.log('  ✅ 主要缓存均有 TTL 清理');

// ── ② 只 set 不 delete 的 Map/Set ──
console.log('\n【② Map/Set 无限增长风险】');
let ej2 = 0;
// 找 "new Map()" / "new Set()" 的定义
const collections = [...SRC.matchAll(/(S\.\w+)\s*=\s*new\s+(Map|Set)\s*\(\)/g)];
for (const m of collections) {
  const name = m[1], type = m[2];
  // 检查是否有 delete/clear/size 上限
  const hasDelete = new RegExp(name + '\\.delete|delete ' + name.replace('S.', 'S\\.')).test(SRC);
  const hasClear = new RegExp(name + '\\.clear').test(SRC);
  const hasSizeCheck = new RegExp(name + '\\.size').test(SRC);
  // 已知有自然上限的集合：lastPx（全A几千只，覆盖写入）、ztCodes（每日重建）、secCodeMap（板块几百个）
  const naturalCap = /lastPx|ztCodes|secCodeMap/.test(name);
  if (!hasDelete && !hasClear && !hasSizeCheck && !naturalCap) {
    console.log(`  ⚠️ ${name} (${type}) 只 set 不 delete/clear，无 size 检查`);
    ej2++;
  }
}
if (!ej2) console.log('  ✅ Map/Set 均有清理或上限控制');

// ── ③ 锁/定时器释放 ──
console.log('\n【③ 锁与定时器释放】');
let ej3 = 0;
// _taskBusy 是否在 finally 中 delete
if (!/_taskBusy\.delete/.test(SRC)) {
  console.log('  ⚠️ _taskBusy 无清理');
  ej3++;
}
// guard 的 finally
if (!/finally\s*\{[^}]*_taskBusy\.delete/.test(SRC)) {
  console.log('  ⚠️ guard 未在 finally 中释放锁');
  ej3++;
}
if (!ej3) console.log('  ✅ 锁与定时器有释放');

const total = ej1 + ej2 + ej3;
console.log(`\n【结论】发现 ${total} 处资源清理问题`);
process.exit(total ? 1 : 0);
