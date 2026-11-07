// 返回值契约扫描器（本轮角度：返回值的契约是否处处成立）。
// 项目里大量用「返回值」判定成败，最典型的是 `if (pushAll(...) !== false) xxxSentDate = ds;`
// —— 判定「今天这条发没发出去」，发不出去就留着下轮重试。这类契约一旦断裂，表现是：
// 消息其实被闸门拦下了，调用方却当它发成功了，把「今天已发」的闭锁打上 → 当天永久消失。
// 断裂的典型形态：**同一个函数，有的分支 return false，有的分支裸 return（= undefined）** ——
// `undefined !== false` 为真，于是「没发出去」被当成「发出去了」。
// 本扫描器把每个函数的 return 形态列出来，标出这类混用，并列出它的判定型调用点。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const { stripNoise } = require('./_codescan.js');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const code = stripNoise(src);          // 等长：注释/字符串/正则都涂成空格，括号配对与 return 抽取都不受干扰
const raw = src.split('\n');

// ── 找出顶层函数块 ──────────────────────────────────────────────────────────
const SIG = /^(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>))/;
const fns = [];
for (let i = 0; i < raw.length; i++) {
  const m = SIG.exec(code.split('\n')[i] || '');
  if (!m) continue;
  const name = m[1] || m[2];
  // 从签名行起找第一个 {（箭头函数可能换行），再做括号配对
  let s = -1, line = i;
  for (; line < Math.min(i + 3, raw.length); line++) {
    const cl = code.split('\n')[line] || '';
    const p = cl.indexOf('{');
    if (p >= 0) { s = src.split('\n').slice(0, line).join('\n').length + 1 + p; break; }
  }
  if (s < 0) continue;                       // 单行箭头函数（无块），跳过
  let depth = 0, e = -1;
  for (let k = s; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}') { depth--; if (!depth) { e = k; break; } }
  }
  if (e < 0) continue;
  fns.push({ name, line: i + 1, body: code.slice(s, e + 1) });
}

// 嵌套函数（内层 function / 箭头函数）的范围 —— 它们内部的 return 属于内层，不算本函数的返回值
function nestedRanges(body) {
  const rs = [];
  const pats = [/\bfunction\s*[\w$]*\s*\([^)]*\)\s*\{/g, /\([^()]*\)\s*=>\s*\{/g, /[\w$]+\s*=>\s*\{/g];
  for (const p of pats) {
    let m;
    while ((m = p.exec(body))) {
      const s = m.index + m[0].length - 1;      // 指向 '{'
      let d = 0, e = -1;
      for (let k = s; k < body.length; k++) {
        if (body[k] === '{') d++;
        else if (body[k] === '}') { d--; if (!d) { e = k; break; } }
      }
      if (e > 0) rs.push([s, e]);
    }
  }
  return rs;
}

// ── 收集每个函数的 return 形态（只看本层的 return）──────────────────────────
function classify(body) {
  const kinds = new Set();
  const nested = nestedRanges(body);
  const re = /\breturn\s*(?:([^;\n][^;\n]*?)\s*)?[;\n]/g;
  let m;
  while ((m = re.exec(body))) {
    // 落在嵌套函数里 → 跳过（那不是本函数的返回值）
    if (nested.some(([a, b]) => m.index > a && m.index < b)) continue;
    const v = (m[1] || '').trim();
    if (!v) { kinds.add('裸return(undefined)'); continue; }
    if (/^(false)$/.test(v)) kinds.add('false');
    else if (/^(true)$/.test(v)) kinds.add('true');
    else if (/^(null)$/.test(v)) kinds.add('null');
    else if (/^(undefined)$/.test(v)) kinds.add('undefined');
    else if (/^-?\d/.test(v)) kinds.add('数字');
    else if (/^[`'"]/.test(v)) kinds.add('字符串');
    else if (/^\{/.test(v)) kinds.add('对象');
    else if (/^\[/.test(v)) kinds.add('数组');
    else kinds.add('表达式/变量');
  }
  // 末尾没有兜底 return → 存在「跑到底返回 undefined」的路径
  const tail = body.slice(Math.max(0, body.lastIndexOf('}') - 400));
  if (!/\breturn\b/.test(tail.split(/\n/).slice(-6).join('\n'))) kinds.add('无兜底return');
  return kinds;
}

console.log('═══ A. 返回值形态混用（既有 return false，又有裸 return / undefined 路径）═══');
let a = 0;
const suspects = [];
for (const f of fns) {
  const k = classify(f.body);
  const hasFalse = k.has('false');
  const hasUndef = k.has('裸return(undefined)') || k.has('无兜底return') || k.has('undefined');
  if (hasFalse && hasUndef) {
    a++; suspects.push(f.name);
    console.log(`  ⚠️ 行 ${f.line} ${f.name}()  → ${[...k].join(' / ')}`);
  }
}
console.log(a ? `  小计 ${a} 个函数` : '  无');

console.log('\n═══ B. false 与 null / undefined 混用（调用方 `!r` 与 `!== false` 会得出相反结论）═══');
let b = 0;
for (const f of fns) {
  const k = classify(f.body);
  if (k.has('false') && (k.has('null') || k.has('undefined'))) {
    b++; console.log(`  ⚠️ 行 ${f.line} ${f.name}()  → ${[...k].join(' / ')}`);
  }
}
console.log(b ? `  小计 ${b} 个函数` : '  无');

// ── C. 判定型调用点：谁在用返回值下判断 ─────────────────────────────────────
console.log('\n═══ C. 判定型调用点（`!== false` / `=== false` / `if(!fn())` 等）═══');
// 允许一层嵌套括号（`pushAll(buildReviewMessage(), true) !== false` 这种）
const JUDGE = /([A-Za-z_$][\w$]*)\s*\((?:[^()]|\([^()]*\))*\)\s*(?:!==\s*false|===\s*false|!==\s*true|===\s*true)/g;
const seen = new Map();
for (let i = 0; i < raw.length; i++) {
  const cl = code.split('\n')[i] || '';
  let m;
  while ((m = JUDGE.exec(cl))) {
    const k = m[1] + ' @' + (i + 1);
    if (!seen.has(m[1])) seen.set(m[1], []);
    seen.get(m[1]).push(i + 1);
  }
}
for (const [name, lines] of seen) {
  const f = fns.find(x => x.name === name);
  const kinds = f ? [...classify(f.body)].join(' / ') : '(非顶层函数/外部)';
  console.log(`  ${name}() 判定点 ${lines.length} 处（行 ${lines.slice(0, 8).join(',')}）→ 返回形态: ${kinds}`);
}

console.log('\n═══ D. pushAll 的返回值语义自检（契约最重的一个函数）═══');
const pa = fns.find(x => x.name === 'pushAll');
if (pa) {
  const kinds = classify(pa.body);
  console.log('  pushAll() 返回形态: ' + [...kinds].join(' / '));
  console.log('  契约（见函数上方注释）：false = 值得下轮重试；true = 本轮终结');
  console.log('  ⛔ 注意：`!== false` 只在【确实返回 false 的分支】上才表示"被拦下"；');
  console.log('     条数闸门 / 副本拦截 / 无通道 这三类拦下都返回 true（重试无用），');
  console.log('     调用方若把它们当成"已发出"而闭锁，那条消息当天就真没了。');
}
console.log('\n（扫描器只列事实；定性结论与修复由 _test_return_contract.js 钉死。）');
