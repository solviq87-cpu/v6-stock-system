// 状态锁配对扫描器（本轮角度：状态锁的获取与释放是否对称）。
// 守门测试 _test_lock_pairing.js 只钉住已确认修复的那几处；这个扫描器负责列全：
//   A. 手写锁清单（`XBusy = true` → 释放点在哪一行、是否在 finally 里）
//   B. guard 名清单（每个 guard 名被几路定时器使用 → 保护的是哪个重函数）
//   C. 同一个重函数是否被两把不同名字的锁包裹（真正的隐患）
//   D. 只 set 不 clear 的锁（获取了但找不到释放点）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const code = stripNoise(src);
// ⛔ stripNoise 默认连【字符串内容】一起抹掉，guard('breadth') 会变成 guard('       ')，
//    guard 名是字符串常量 → 必须 keepStrings 才能取出名字（长度不变，偏移量照样对齐）。
const codeK = stripNoise(src, { keepStrings: true });
const lines = src.split('\n');
const codeLines = code.split('\n');
const codeKLines = codeK.split('\n');

console.log('═══ A. 手写锁清单（获取 → 释放 → 是否 finally）═══');
let noRel = 0, notFinally = 0;
for (let i = 0; i < lines.length; i++) {
  const m = /(\w*[Bb]usy)\s*=\s*true/.exec(codeLines[i] || '');
  if (!m) continue;
  const name = m[1];
  let rel = -1;
  for (let j = i + 1; j < Math.min(i + 400, lines.length); j++) {
    if (new RegExp(name + '\\s*=\\s*false').test(codeLines[j] || '')) { rel = j; break; }
  }
  if (rel < 0) { noRel++; console.log(`  ${String(i + 1).padStart(5)}  ❌ ${name} 找不到释放点（永久卡死）`); continue; }
  const cur = lines[rel].trim(), prev = (lines[rel - 1] || '').trim();
  const inFinally = /^finally\s*\{/.test(cur) || /^\}\s*finally\s*\{?$/.test(prev) || /finally\s*\{/.test(cur);
  if (!inFinally) { notFinally++; console.log(`  ${String(i + 1).padStart(5)}  ⚠️ ${name} 释放点在行 ${rel + 1}，不在 finally：${cur.slice(0, 70)}`); }
  else console.log(`  ${String(i + 1).padStart(5)}  ✅ ${name} 释放点 行 ${rel + 1}（finally）`);
}
console.log(`  无释放点 ${noRel} 处 / 不在 finally ${notFinally} 处`);

// A2. 获取锁之后、进入 try 之前有没有提前退出 —— 那样 finally 压根不会执行，锁照样泄漏
//     （典型写法：if (X) return; XBusy = true; try { ... } finally { XBusy = false; }）
console.log('\n═══ A2. 获取 → try 之间是否夹了提前退出（finally 兜不住的那一段）═══');
let earlyOut = 0;
for (let i = 0; i < codeKLines.length; i++) {
  const m = /(\w*[Bb]usy)\s*=\s*true/.exec(codeKLines[i] || '');
  if (!m) continue;
  const name = m[1];
  let rel = -1;
  for (let j = i + 1; j < Math.min(i + 400, codeKLines.length); j++)
    if (new RegExp(name + '\\s*=\\s*false').test(codeKLines[j] || '')) { rel = j; break; }
  if (rel < 0) continue;
  const seg = codeKLines.slice(i + 1, rel).join('\n');
  const ti = seg.indexOf('try {');
  if (ti < 0) { earlyOut++; console.log(`  ${String(i + 1).padStart(5)}  ❌ ${name} 获取与释放之间找不到 try`); continue; }
  const before = seg.slice(0, ti).replace(/\/\/[^\n]*/g, '');
  if (/return|throw |process\.exit/.test(before)) {
    earlyOut++;
    console.log(`  ${String(i + 1).padStart(5)}  ⚠️ ${name} 进 try 前有提前退出：${before.trim().split('\n').filter(x => /return|throw|process/.test(x)).join(' | ').slice(0, 90)}`);
  }
}
console.log(earlyOut ? `  小计 ${earlyOut} 处可疑` : '  无（13 处都是「获取后紧接着 try」，finally 必然执行）');

console.log('\n═══ B. guard 名清单（每个名字被几路用、保护哪个重函数）═══');
const HEAVY = ['runLearnallIngest', 'seedLearnFromHistory', 'resolveSignalsDeep', 'computeBreadth',
  'refreshSectorsZT', 'rebuildPool', 'refreshGlobal', 'klineBackfill', 'runLearnCycle', '_bootSeed',
  'scanTrendUniverse', 'scanSteadyUp', 'scanZtPre', 'pullHoldingsDownstream', 'runViewIdleSweep', 'refreshNews'];
const offOf = i => src.split('\n').slice(0, i).join('\n').length + 1;
const byName = new Map(), byFn = new Map();
for (let i = 0; i < lines.length; i++) {
  // ⛔ 必须扫【剥掉注释】的 codeLines：APP_VER 那条超长注释里写满了 guard('breadth') / guard('learn')
  //    这类历史说明文字，扫原始行会把它们当成真实的调用点（实测行 26 / 6400 就是注释）。
  const gm = /guard\('([^']+)'/.exec(codeKLines[i] || '');
  if (!gm) continue;
  const name = gm[1];
  let body = '';
  const ref = /guard\('[^']+',\s*(\w+)\s*\)/.exec(codeKLines[i] || '');
  if (ref) body = ref[1];
  else {
    const st = offOf(i);
    const s = code.indexOf('{', st);
    if (s >= 0) {
      let d = 0, e = -1;
      for (let k = s; k < code.length; k++) {
        if (code[k] === '{') d++;
        else if (code[k] === '}') { d--; if (!d) { e = k; break; } }
      }
      // 函数体同样取剥注释后的 code，避免把注释里的函数名当成真实调用
      if (e > 0) body = codeK.slice(st, e + 1);
    }
  }
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(i + 1);
  for (const h of HEAVY) {
    if (new RegExp('\\b' + h + '\\s*\\(').test(body)) {
      if (!byFn.has(h)) byFn.set(h, new Set());
      byFn.get(h).add(name);
    }
  }
}
for (const [n, ls] of [...byName.entries()].sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${n.padEnd(18)} ${ls.length} 路（行 ${ls.join(',')}）`);

console.log('\n═══ C. 同一个重函数是否被两把不同名字的锁包裹 ═══');
let c = 0;
for (const [h, names] of byFn) {
  if (names.size > 1) { c++; console.log(`  ⚠️ ${h} → ${[...names].join(' / ')}`); }
}
console.log(c ? `  小计 ${c} 处（guard 按名字加锁，两个名字 = 两把互不相认的锁）` : '  无（每个重函数只有一把锁）');

console.log('\n═══ D. guard 包装器自身 ═══');
console.log(`  ${/finally \{ _taskBusy\.delete\(name\); \}/.test(src) ? '✅' : '❌'} finally 释放`);
console.log(`  ${/catch \(e\) \{ console\.error/.test(src) ? '✅' : '❌'} catch（防 unhandledRejection）`);
console.log(`  ${/Date\.now\(\) - at < 15 \* 60 \* 1000/.test(src) ? '✅' : '❌'} 15 分钟兜底`);
console.log('\n（扫描器只列事实、不做断言；定性结论与修复由 _test_lock_pairing.js 钉死。）');
