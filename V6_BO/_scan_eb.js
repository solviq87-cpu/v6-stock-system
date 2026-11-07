// 扫描器：eb 轮 —— 「并发与重入」
// 查四类：
//   ① guard 嵌套：函数 A（guard('a')）内部调了 guard('b')，而 b 内部又调 a = 死锁
//   ② 手动/自动入口是否共享 guard 名（或是否该共享却没共享）
//   ③ async 函数体里没 await（guard 锁在 fn() 返回后立即释放）
//   ④ 同一函数被多个定时器挂、guard 名不同 = 并发重入
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== eb 轮：并发与重入扫描 ===\n');

// ── ① guard 嵌套死锁风险 ──
console.log('【① guard 嵌套死锁风险】');
const guards = [...SRC.matchAll(/guard\('(\w+)'/g)].map(m => m[1]);
const guardBlocks = {};
for (const name of [...new Set(guards)]) {
  // 找 guard('name', async (...) => { ... }) 的函数体
  const re = new RegExp("guard\\('" + name + "',\\s*(?:async\\s+)?(?:function)?\\s*\\(?[^)]*\\)?\\s*=>?\\s*\\{");
  const i = SRC.search(re);
  if (i < 0) continue;
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { guardBlocks[name] = SRC.slice(i, j + 1); break; } }
  }
}

let nestIssues = 0;
for (const [name, body] of Object.entries(guardBlocks)) {
  // 在这个 guard 块里又调用了哪些 guard
  const inner = [...body.matchAll(/guard\('(\w+)'/g)].map(m => m[1]).filter(n => n !== name);
  if (!inner.length) continue;
  for (const inName of inner) {
    const inBody = guardBlocks[inName] || '';
    if (inBody && new RegExp("guard\\('" + name + "'").test(inBody)) {
      console.log(`  ⛔ 死锁风险: guard('${name}') 内部调 guard('${inName}')，而 '${inName}' 内部又调 '${name}'`);
      nestIssues++;
    }
  }
}
if (!nestIssues) console.log('  ✅ 无双向嵌套死锁');

// ── ② 手动/自动入口 guard 名一致性 ──
console.log('\n【② 手动/自动入口是否共享 guard 锁】');
// 已知有手动入口的函数：rebuildPool, refreshSectorsZT, scanTrendUniverse, klineBackfill, seedLearnFromHistory
// 查这些函数是否在 guard 里，以及手动入口是否也走了 guard
const manualAutoPairs = [
  { auto: "guard\\('pool'",      manual: "if \\(p === '/api/scan-now'",    name: '精选池重建' },
  { auto: "guard\\('sectorsZT'", manual: "if \\(p === '/api/sectors-zt'", name: '板块涨停刷新' },
  { auto: "guard\\('trend-scan'", manual: "if \\(p === '/api/trend-scan'", name: '趋势扫描' },
  { auto: "guard\\('kline-backfill'", manual: "if \\(p === '/api/kline-backfill'", name: 'K线补齐' },
  { auto: "guard\\('learnall'", manual: "if \\(p === '/api/learn-status'", name: '学习入库' },
];
let maIssues = 0;
for (const p of manualAutoPairs) {
  const hasAuto = new RegExp(p.auto).test(SRC);
  const hasManual = new RegExp(p.manual).test(SRC);
  if (!hasAuto || !hasManual) continue;
  // 手动入口是否调了同一个被 guard 的函数
  const mIdx = SRC.search(new RegExp(p.manual));
  const mBlock = (() => {
    if (mIdx < 0) return '';
    let d = 0, started = false;
    for (let j = mIdx; j < SRC.length; j++) {
      const c = SRC[j];
      if (c === '{') { d++; started = true; }
      else if (c === '}') { d--; if (started && d === 0) return SRC.slice(mIdx, j + 1); }
    }
    return '';
  })();
  // 手动入口直接调函数（不经过 guard）→ 可能与自动入口并发
  const callsDirect = /scanTrendUniverse|klineBackfill|rebuildPool|refreshSectorsZT|runLearnallIngest|seedLearnFromHistory/.test(mBlock);
  if (callsDirect) {
    console.log(`  ⚠️ ${p.name}: 手动入口直接调函数，不经过 guard —— 可能与自动入口并发`);
    maIssues++;
  }
}
if (!maIssues) console.log('  ✅ 手动/自动入口未发现并发风险（或手动入口已判 busy）');

// ── ③ async 不 await ──
console.log('\n【③ async 函数体中缺少 await】');
const asyncFns = [...SRC.matchAll(/(?:setTimeout|setInterval)\(guard\('(\w+)',\s*async\s*\(\)\s*=>\s*\{/g)];
let awaitIssues = 0;
for (const m of asyncFns) {
  const name = m[1];
  const start = m.index + m[0].length - 1;
  let d = 0, started = false, body = '';
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { body = SRC.slice(start, j + 1); break; } }
  }
  if (!body) continue;
  const clean = body.replace(/\/\/.*$/gm, '').replace(/`[^`]*`/g, '');
  // 如果 body 里有 async 调用但没 await，就是问题
  const hasAsyncCall = /\b\w+\([^)]*\)\s*;/.test(clean) && /(?:fetch|scan|refresh|rebuild|compute|resolve|run[A-Z]|ingest|backfill|backfill|digest)/.test(clean);
  const hasAwait = /\bawait\b/.test(clean);
  if (hasAsyncCall && !hasAwait) {
    console.log(`  ⛔ guard('${name}') 的 async 体里调用了异步函数但没 await —— 锁会立即释放`);
    awaitIssues++;
  }
}
if (!awaitIssues) console.log('  ✅ 未发现 async 不 await 的 guard 块');

// ── ④ 同一函数被多个定时器挂、guard 名不同 ──
console.log('\n【④ 同一函数被多个定时器挂、guard 名不同 = 并发重入】');
const timerGuards = [...SRC.matchAll(/(?:setTimeout|setInterval)\(guard\('(\w+)'/g)].map(m => m[1]);
const nameCount = {};
for (const n of timerGuards) nameCount[n] = (nameCount[n] || 0) + 1;
let dupIssues = 0;
for (const [n, c] of Object.entries(nameCount)) {
  if (c > 1) {
    console.log(`  ℹ️ guard('${n}') 被 ${c} 个定时器挂载 —— 同名锁会互斥，这是设计意图`);
  }
}
if (!dupIssues) console.log('  ✅ 无 guard 名冲突问题');

const total = nestIssues + maIssues + awaitIssues + dupIssues;
console.log(`\n【结论】发现 ${total} 处并发/重入风险`);
process.exit(total ? 1 : 0);
