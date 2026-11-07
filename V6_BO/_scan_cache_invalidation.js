// 体检扫描器：缓存与失效（2026-10-06）
//
// 列出全项目的缓存容器，并对每个缓存回答四个问题：
//   A. 命中键 与 写入键 是不是同一个东西（写 used 却和 d0 比 = 缓存永不命中）
//   B. 时间戳是不是取在 await 之前（TTL 起点被提前，数据到手时已经"老"了）
//   C. 有没有把「结果非空」当「算过了」（空结果永远不进缓存 = 每次重算）
//   D. 有没有无界增长（既没 TTL 也没清理/重置）
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const FILES = ['server.js', 'analysis.js', 'learnall.js', 'ztpre.js', 'em.js', 'holdings.js', 'logic.js', 'bazi.js'];
const src = {};
const code = {};
for (const f of FILES) {
  try { src[f] = fs.readFileSync(f, 'utf8'); code[f] = stripNoise(src[f], { keepStrings: true }); } catch { }
}

const out = [];
const say = s => { out.push(s); console.log(s); };

say('=== A. 缓存清单（声明形如 `let _X = { t: 0, ... }`）===');
const caches = [];
for (const f of FILES) {
  if (!code[f]) continue;
  const L = code[f].split('\n');
  L.forEach((l, i) => {
    const m = l.match(/^\s*(?:const|let|var)\s+(_?\w*[Cc]ache\w*|_?\w*Cache)\s*=\s*/);
    if (!m) return;
    caches.push({ f, name: m[1], line: i + 1, decl: l.trim().slice(0, 110) });
  });
}
caches.forEach(c => say(`  ${c.f}:${c.line}  ${c.decl}`));
say(`  共 ${caches.length} 个`);

say('\n=== B. 缓存命中条件（找 `if (... _X.<k> === <v> && ...）return _X.map`）===');
let hitN = 0;
for (const f of FILES) {
  if (!code[f]) continue;
  for (const m of code[f].matchAll(/if \([^;\n]*?(\w*[Cc]ache\w*)\.(\w+)[^;\n]*?\)\s*return \1\.\w+/g)) {
    hitN++; say(`  ${f}: ${m[0].slice(0, 130)}`);
  }
}
if (!hitN) say('  （未匹配到，手动核对 ztReasonCached / lhbMapCached / empTable / sectorRankMap）');

say('\n=== C. 把「结果非空」当「算过了」的写法（空结果永不进缓存）===');
let cN = 0;
for (const f of FILES) {
  if (!code[f]) continue;
  for (const m of code[f].matchAll(/\w*[Cc]ache\w*\.map\.length|\w*[Cc]ache\w*\.map\.size|Object\.keys\(\w*[Cc]ache\w*\.map\)\.length/g)) {
    cN++; say(`  ⚠️ ${f}: ${m[0]}`);
  }
}
say(`  ${cN} 处（0 = 干净；注意 sectorRankMap 的 map.size 属于「空表没意义」的合理用法，需人工判）`);

say('\n=== D. 异步函数里 `const now = Date.now()` 之后还有 await，却把 now 写成缓存时间戳 ===');
let dN = 0;
for (const f of FILES) {
  if (!code[f]) continue;
  const L = code[f].split('\n');
  for (let i = 0; i < L.length; i++) {
    if (!/async function\s+\w+/.test(L[i])) continue;
    let end = L.length;
    for (let j = i + 1; j < L.length; j++) if (/^(async )?function\s+\w+/.test(L[j])) { end = j; break; }
    const body = L.slice(i, end).join('\n');
    const iNow = body.indexOf('const now = Date.now();');
    if (iNow < 0) continue;
    if (!/[^_]t: now\b|\bt = now\b/.test(body)) continue;
    const iAwait = body.indexOf('await ');
    if (iAwait > iNow) { dN++; say(`  ⚠️ ${f}:${i + 1} ${L[i].trim().slice(0, 70)}`); }
  }
}
say(`  ${dN} 处（0 = 干净）`);

say('\n=== E. 无界增长：既没 TTL 也没清理/重置的模块级 Map/Set ===');
let eN = 0;
for (const f of FILES) {
  if (!code[f]) continue;
  const L = code[f].split('\n');
  L.forEach((l, i) => {
    const m = l.match(/^\s*(?:const|let|var)\s+(_[A-Za-z_$][\w$]*)\s*=\s*(new Map\(\)|new Set\(\))/);
    if (!m) return;
    const name = m[1];
    const re = new RegExp('\\b' + name + '\\b');
    const uses = L.reduce((a, x) => a + (re.test(x) ? 1 : 0), 0);
    const hasClear = new RegExp('\\b' + name + '\\.(delete|clear)\\s*\\(').test(code[f])
      || new RegExp('\\b' + name + '\\s*=\\s*new (Map|Set)').test(code[f]);
    const hasTtl = new RegExp('\\b' + name + '[\\s\\S]{0,400}?(Date\\.now\\(\\)|TTL|ttl)').test(code[f]);
    if (!hasClear && !hasTtl) { eN++; say(`  ⚠️ ${f}:${i + 1} ${name} (${m[2]}) 引用 ${uses} 次 —— 无清理也无 TTL`); }
  });
}
say(`  ${eN} 处（0 = 干净；有清理或有 TTL 的不列）`);

fs.writeFileSync('_scan_cache_invalidation.out.txt', out.join('\n'));
say('\n（已写入 _scan_cache_invalidation.out.txt）');
