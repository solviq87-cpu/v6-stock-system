// 体检扫描器：降级 / 缺省值的语义一致性（2026-10-06 新角度）
//
// 与「静默失败（空 catch）」不同：那一类是**异常被吞**，这一类是**没有异常、正常 return 了一个值**，
// 但同一个「算不出来 / 不适用 / 数据不足」的概念，在不同函数里返回的东西互不相同：
//     null / undefined / 0 / 50 / {} / [] / '' / false
// 调用方往往用 `if (x)`、`+(x || 0)`、`x > 0`、`x ?? 0` 去接，于是：
//   · 返回 0 的"算不出来"会被当成"算出来了，值是 0" → 参与排序/比较/展示，假数据混进榜
//   · 返回 null 的被 `+(x||0)` 变成 0 → 同上
//   · 返回 undefined 的被 `x > 0` 判 false → 也可能让闸门静默失效
//   · 同一字段在两个分支返回不同类型（number vs null），前端一渲染就出 NaN / null 字样
//
// 本扫描器找两类证据：
//   A. 同一个函数体内**混用**多种"空值"返回（return null / return 0 / return; / return {} ...）
//   B. 全项目里"概率 / 分数 / 比例"这类数值函数的返回空值口径不一致（列出各自返回什么）
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const FILES = ['analysis.js', 'server.js', 'learnall.js', 'ztpre.js', 'holdings.js', 'em.js', 'logic.js', 'myrules.js', 'nextplan.js'];

// 抓顶层函数体（行首 function / async function，到下一个行首 } 为止）
function topFuncs(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    const body = [lines[i]];
    while (j < lines.length && !/^}/.test(lines[j])) { body.push(lines[j]); j++; }
    body.push('}');
    out.push({ name: m[1], start: i + 1, text: body.join('\n') });
  }
  return out;
}

const EMPTY = [
  [/return\s+null\s*;/g, 'null'],
  [/return\s+undefined\s*;/g, 'undefined'],
  [/return\s*;/g, 'undefined(裸return)'],
  [/return\s+0\s*;/g, '0'],
  [/return\s+-1\s*;/g, '-1'],
  [/return\s+\{\s*\}\s*;/g, '{}'],
  [/return\s+\[\s*\]\s*;/g, '[]'],
  [/return\s+''\s*;/g, "''"],
  [/return\s+false\s*;/g, 'false'],
];

console.log('══ A. 同一函数内混用多种「空值」返回 ══\n');
let hits = 0;
for (const f of FILES) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const code = stripNoise(src);
  for (const fn of topFuncs(code)) {
    const kinds = new Set();
    for (const [re, label] of EMPTY) if (re.test(fn.text)) kinds.add(label);
    if (kinds.size >= 2) {
      hits++;
      console.log(`  ${f}:${fn.start}  ${fn.name}()  →  ${[...kinds].join(' / ')}`);
    }
  }
}
if (!hits) console.log('  （无）');

console.log('\n══ B. 概率 / 分数 / 比例 类函数的空值口径 ══\n');
const NUMFN = /(prob|Prob|score|Score|rate|Rate|ratio|Ratio|pct|Pct|pctOf|slope|ma\d?|bull|conf|Conf|weight|Weight|lift|Lift|adj|Adj|corr|gap|Gap|streak|rank)/;
const rows = [];
for (const f of FILES) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const code = stripNoise(src);
  for (const fn of topFuncs(code)) {
    if (!NUMFN.test(fn.name)) continue;
    const kinds = new Set();
    for (const [re, label] of EMPTY) if (re.test(fn.text)) kinds.add(label);
    if (kinds.size) rows.push({ f, name: fn.name, line: fn.start, kinds: [...kinds].join('/') });
  }
}
// 按"函数名概念"归组，看同族函数口径是否一致
const byConcept = new Map();
for (const r of rows) {
  const key = r.name.replace(/^(calc|compute|get|build|make|of)/, '').toLowerCase().slice(0, 14);
  if (!byConcept.has(key)) byConcept.set(key, []);
  byConcept.get(key).push(r);
}
for (const [k, v] of [...byConcept.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const kinds = new Set(v.map(x => x.kinds));
  if (v.length >= 2 && kinds.size >= 2) {
    console.log(`  ⚠️ 概念族「${k}」口径不一致：`);
    for (const x of v) console.log(`       ${x.f}:${x.line} ${x.name}() → ${x.kinds}`);
  }
}
if (![...byConcept.values()].some(v => v.length >= 2 && new Set(v.map(x => x.kinds)).size >= 2)) console.log('  （无同族不一致）');

console.log('\n══ C. 调用方对可能为空的返回值的判定方式 ══\n');
let srvo = '';
try { srvo = stripNoise(fs.readFileSync('server.js', 'utf8')); } catch { }
const pats = [
  [/\+\(\s*\w+\s*\|\|\s*0\s*\)/g, '+(x||0)（null→0，会把"算不出来"当 0 参与运算）'],
  [/\w+\s*==\s*null\s*\?/g, 'x==null?（正确区分）'],
  [/\w+\s*!=\s*null\s*&&/g, 'x!=null&&（正确区分）'],
  [/Number\.isFinite\(/g, 'Number.isFinite（正确区分）'],
  [/!\w+\s*\)/g, '!x（0 与 null 同路，看不出差别）'],
];
for (const [re, label] of pats) {
  const n = (srvo.match(re) || []).length;
  console.log(`  ${label}  →  ${n} 处`);
}
