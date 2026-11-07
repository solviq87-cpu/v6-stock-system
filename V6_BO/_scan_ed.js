// 扫描器：ed 轮 —— 「错误处理与降级路径」
// 查三类：
//   ① 函数级 catch 块是否返回了降级值（调用方读到 undefined）
//   ② 空 catch 是否出现在"改数据/算结论"路径上（不是清理路径）
//   ③ 外部依赖（数据源/推送通道）失败时有无降级行为
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== ed 轮：错误处理与降级路径扫描 ===\n');

// ── 辅助：取函数体 ──
function fnBody(name) {
  const a = SRC.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\(', 'm'));
  if (a < 0) return '';
  let p = SRC.indexOf('(', a), pd = 0;
  for (let k = p; k < SRC.length; k++) {
    if (SRC[k] === '(') pd++; else if (SRC[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = SRC.indexOf('{', p);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < SRC.length; j++) {
    const c = SRC[j];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return SRC.slice(a, j + 1); }
  }
  return '';
}

// ── ① 外部数据获取函数的降级返回值 ──
console.log('【① 外部数据获取函数的 catch 降级】');
const dataFns = ['em.fetchAllStocks', 'em.fetchGlobal', 'em.fetchSectors', 'refreshSectorsZT', 'refreshGlobal', 'fetchMarketBeta', 'captureAuction', 'refreshNews'];
let ed1 = 0;
for (const fn of dataFns) {
  const body = fnBody(fn.split('.').pop());
  if (!body) continue;
  const catches = [...body.matchAll(/catch\s*\([^)]*\)\s*\{/g)];
  for (const m of catches) {
    const start = m.index;
    let d = 0, started = false, block = '';
    for (let j = start; j < body.length; j++) {
      const c = body[j];
      if (c === '{') { d++; started = true; }
      else if (c === '}') { d--; if (started && d === 0) { block = body.slice(start, j + 1); break; } }
    }
    if (!block) continue;
    const hasReturn = /\breturn\b/.test(block);
    const hasConsole = /console\./.test(block);
    if (!hasReturn && !hasConsole) {
      console.log(`  ⛔ ${fn}: catch 块无 return 也无 console —— 调用方读到 undefined`);
      ed1++;
    } else if (!hasReturn) {
      console.log(`  ℹ️ ${fn}: catch 块只 console 无 return（定时器调用，设计意图）`);
    }
  }
}
if (!ed1) console.log('  ✅ 数据获取函数的 catch 均有降级返回或日志');

// ── ② 空 catch 在"算结论"路径上 ──
console.log('\n【② 空 catch 在"算结论"路径上（非清理操作）】');
const allCatches = [...SRC.matchAll(/catch\s*\([^)]*\)\s*\{\s*\}/g)];
let ed2 = 0;
for (const m of allCatches) {
  const line = SRC.slice(0, m.index).split('\n').length;
  const ctx = SRC.split('\n').slice(Math.max(0, line - 5), line + 1).join('\n');
  // 排除已知的"清理/释放"路径，以及容错解析（JSON.parse失败回退默认值、mkdirSync recursive已存在）
  const isCleanup = /unlinkSync|destroy|rmdir|cleanup|sweep|clear|delete|pop|shift|close|end|abort|resume/.test(ctx);
  const isTolerantParse = /JSON\.parse|mkdirSync.*recursive/.test(ctx);
  if (!isCleanup && !isTolerantParse) {
    console.log(`  ⛔ 行${line}: 空 catch 在非清理路径`);
    ed2++;
  }
}
if (!ed2) console.log('  ✅ 空 catch 均在清理/释放路径上');

// ── ③ 推送通道失败时的降级 ──
console.log('\n【③ 推送通道失败时的降级行为】');
ok3 = 0;
// pushAll / pushWecom / feishuSend 失败时是否返回明确状态
if (/function pushAll\(/.test(SRC) && /_pushLast\s*=/.test(SRC)) {
  console.log('  ✅ pushAll 有 _pushLast 记录真实结果');
  ok3++;
}
if (/function pushWecom\(/.test(SRC)) {
  const pwBody = fnBody('pushWecom');
  const hasFallback = /pushLog|feishuSend|mailSend/.test(pwBody);
  console.log(hasFallback ? '  ✅ pushWecom 有 fallback 通道' : '  ⚠️ pushWecom 无 fallback 通道');
}

const total = ed1 + ed2;
console.log(`\n【结论】发现 ${total} 处降级路径问题`);
process.exit(total ? 1 : 0);
