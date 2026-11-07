/**
 * _lint_logic.js —— 源码逻辑缺陷静态扫描器 v2（AST 级，单遍 O(n)）
 *
 * 为什么需要它：node --check 只查语法，查不出真正会让程序崩的错误。
 * 本项目踩过的真坑（2026-10-02 cp 版）：/api/lock/unlock 里 try 块内 `const b`，
 * 出了 try 写 `b.name` → ReferenceError 直接打崩登录，node --check 全绿。
 *
 * 检测项：
 *   E1 🔴 块级作用域逃逸：let/const 声明在某块内、却在块外被引用（必崩 ReferenceError）
 *   E2 🔴 TDZ：let/const 声明之前就引用（必崩 ReferenceError）
 *   E3 🟠 找不到声明的标识符（排除全局内置后）
 *   E4 🟠 空 catch 吞异常（静默失败：依赖没注入表现为产出 0 只却不报错）
 *   E5 🟡 async 函数内调用 async 函数却没 await（拿到 Promise，判断静默失效）
 *   E6 🔴 require 相对路径指向不存在的文件（启动即崩）
 *   E7 🟡 非 null 比较用 == / !=
 *   E8 🟡 parseInt 未传 radix
 *   E9 ⚪ return/throw/break/continue 之后的不可达代码
 *   E10 🟡 正则字面量含 \r 或裸换行
 *
 * 用法：
 *   node _lint_logic.js               扫全部根目录 *.js
 *   node _lint_logic.js server.js     只扫指定文件
 *   node _lint_logic.js --html        额外扫 public/index.html 的内联 script
 */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = __dirname;
const BLOCK_TYPES = new Set(['BlockStatement', 'Program', 'ForStatement', 'ForInStatement',
  'ForOfStatement', 'SwitchCase', 'CatchClause', 'StaticBlock']);
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const GLOBALS = new Set(Object.getOwnPropertyNames(globalThis));
['require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer', 'console',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'fetch', 'crypto', 'globalThis', 'global',
  'undefined', 'NaN', 'Infinity', 'arguments', 'Promise', 'JSON', 'Math', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'Function', 'Intl', 'Reflect', 'Proxy', 'BigInt', 'Int8Array',
  'Uint8Array', 'Float64Array', 'AbortController', 'performance', 'structuredClone', 'document',
  'window', 'localStorage', 'sessionStorage', 'navigator', 'alert', 'location', 'history',
  'EventSource', 'WebSocket', 'requestAnimationFrame', 'HTMLElement', 'Node'
].forEach(n => GLOBALS.add(n));

function nearest(ancestors, types) {
  for (let i = ancestors.length - 1; i >= 0; i--) if (types.has(ancestors[i].type)) return ancestors[i];
  return null;
}

// ⚠️ acorn-walk 的 fullAncestor 传入的 ancestors 数组「包含 node 自身」，
//    所以父节点是 anc[len-2] 而不是 anc[len-1]（取错会把 node 自己当父节点 → 误报一片）。
function isRefPosition(node, parent, anc) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if ((parent.type === 'Property' || parent.type === 'PropertyDefinition' ||
    parent.type === 'MethodDefinition') && parent.key === node && !parent.computed) return false;
  if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
  if ((FN_TYPES.has(parent.type) || parent.type === 'ClassDeclaration' ||
    parent.type === 'ClassExpression') && parent.id === node) return false;
  if (parent.type === 'LabeledStatement' && parent.label === node) return false;
  if ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && parent.label === node) return false;
  if (/^(Import|Export)(Specifier|DefaultSpecifier|NamespaceSpecifier)$/.test(parent.type)) return false;
  if (parent.type === 'CatchClause' && parent.param === node) return false;
  if (parent.type === 'AssignmentPattern' && parent.left === node) return false;
  if (parent.type === 'RestElement' && parent.argument === node) return false;
  if (parent.type === 'ArrayPattern' || parent.type === 'ObjectPattern') {
    // 解构声明左侧：沿 ancestors 往上找，只要最终挂在 VariableDeclaration / 函数参数上就不是引用
    for (let i = anc.length - 2; i >= 0; i--) {
      const a = anc[i];
      if (a.type === 'VariableDeclarator' || FN_TYPES.has(a.type) ||
        a.type === 'AssignmentPattern' || a.type === 'CatchClause') return false;
      if (BLOCK_TYPES.has(a.type) || a.type === 'ExpressionStatement' ||
        a.type === 'AssignmentExpression' || a.type === 'CallExpression') break;
    }
  }
  return true;
}

function patternIds(pn, out) {
  if (!pn) return out;
  if (pn.type === 'Identifier') out.push(pn);
  else if (pn.type === 'ObjectPattern') pn.properties.forEach(pr => patternIds(pr.value || pr.argument, out));
  else if (pn.type === 'ArrayPattern') pn.elements.forEach(e => patternIds(e, out));
  else if (pn.type === 'AssignmentPattern') patternIds(pn.left, out);
  else if (pn.type === 'RestElement') patternIds(pn.argument, out);
  return out;
}

function parse(src) {
  try { return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: true }); }
  catch (e) {
    try { return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
    catch (e2) { return { __err: e2.message }; }
  }
}

function lintFile(file, src) {
  const t0 = Date.now();
  const issues = [];
  const add = (code, node, msg) => issues.push({ code, line: node && node.loc ? node.loc.start.line : 0, msg });
  const ast = parse(src);
  if (ast.__err) { add('E0', null, '解析失败: ' + ast.__err); return { issues, ms: Date.now() - t0 }; }

  const decls = [];                 // 所有声明
  const byName = new Map();         // name -> decl[]
  const asyncFnNames = new Set();
  const addDecl = (d) => {
    decls.push(d);
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  };

  // ── Pass 1：收集声明 + 顺带做不需要作用域解析的检查 ──────────────
  walk.fullAncestor(ast, (node, _st, anc) => {
    const parent = anc.length >= 2 ? anc[anc.length - 2] : null;
    const line = node.loc ? node.loc.start.line : 0;

    if (node.type === 'VariableDeclarator') {
      const kind = (parent && parent.kind) || 'var';
      const block = nearest(anc, BLOCK_TYPES);
      const fn = nearest(anc, FN_TYPES);
      patternIds(node.id, []).forEach(id =>
        addDecl({ name: id.name, block, fn, start: id.start, kind, line: id.loc ? id.loc.start.line : line, node: id }));
    }
    if (FN_TYPES.has(node.type)) {
      if (node.id && node.type === 'FunctionDeclaration') {
        const fn = nearest(anc, FN_TYPES);
        addDecl({ name: node.id.name, block: nearest(anc, BLOCK_TYPES), fn, start: node.start, kind: 'var', line: node.id.loc.start.line, node: node.id });
      } else if (node.id) {
        // 命名函数表达式（如 module.exports = function createHoldings(dep){}）：
        // 名字只在函数体自身作用域内可见
        addDecl({ name: node.id.name, block: node, fn: node, start: node.start, kind: 'param', line: node.id.loc.start.line, node: node.id });
      }
      if (node.async && node.id) asyncFnNames.add(node.id.name);
      (node.params || []).forEach(p => patternIds(p, []).forEach(id =>
        addDecl({ name: id.name, block: node, fn: node, start: id.start, kind: 'param', line: id.loc.start.line, node: id })));
    }
    if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.id) {
      addDecl({ name: node.id.name, block: nearest(anc, BLOCK_TYPES), fn: nearest(anc, FN_TYPES), start: node.start, kind: 'var', line: node.id.loc.start.line, node: node.id });
    }
    if (node.type === 'CatchClause') {
      if (node.param) patternIds(node.param, []).forEach(id =>
        addDecl({ name: id.name, block: node, fn: node, start: id.start, kind: 'param', line: id.loc.start.line, node: id }));
    }
    // E4 空 catch 分级：吞掉"含函数调用的 try"才是真危险（功能静默失效），
    // 只用来兜底 JSON.parse / 取属性的空 catch 属正常防御写法，降级单列不刷屏。
    if (node.type === 'TryStatement' && node.handler && node.handler.body &&
      node.handler.body.type === 'BlockStatement' && node.handler.body.body.length === 0) {
      let hasCall = false;
      try {
        walk.simple(node.block, { CallExpression() { hasCall = true; }, AwaitExpression() { hasCall = true; } });
      } catch (e) { hasCall = true; }
      const ln = node.handler.loc ? node.handler.loc.start.line : line;
      if (hasCall) add('E4', node.handler, `空 catch 吞异常（第 ${ln} 行）且 try 内有函数调用 → 出错完全静默：本项目踩过，依赖没注入表现为"产出 0 只却不报错"`);
      else add('E4b', node.handler, `空 catch 兜底（第 ${ln} 行），try 内无调用，属防御写法`);
    }
    if (node.type === 'CallExpression') {
      const cal = node.callee;
      if (cal && cal.type === 'Identifier' && cal.name === 'require' && node.arguments[0] &&
        node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string' &&
        node.arguments[0].value.startsWith('.')) {
        const rel = node.arguments[0].value;
        const target = path.resolve(path.dirname(file), rel);
        const ok = fs.existsSync(target) || fs.existsSync(target + '.js') ||
          fs.existsSync(path.join(target, 'index.js')) || fs.existsSync(target + '.json');
        if (!ok) add('E6', node, `require("${rel}") 指向的文件不存在（${target}）→ 启动即崩`);
      }
      if (cal && cal.type === 'Identifier' && cal.name === 'parseInt' && node.arguments.length < 2)
        add('E8', node, `parseInt() 未传 radix（第 ${line} 行）→ "08" 之类会被当八进制`);
      if (cal && cal.type === 'Identifier' && asyncFnNames.has(cal.name) &&
        !(parent && (parent.type === 'AwaitExpression' || parent.type === 'ReturnStatement'))) {
        const inAsync = nearest(anc, FN_TYPES);
        if (inAsync && inAsync.async)
          add('E5', node, `async 函数 ${cal.name}() 被调用却没 await（第 ${line} 行）→ 拿到的是 Promise，判断会静默失效`);
      }
    }
    if (node.type === 'BinaryExpression' && (node.operator === '==' || node.operator === '!=')) {
      const lit = [node.left, node.right].find(s => s.type === 'Literal' && (s.value === null || s.value === undefined));
      if (!lit) add('E7', node, `用 "${node.operator}" 做非 null 比较（第 ${line} 行）→ 隐式转换可能判错`);
    }
    if ((node.type === 'BlockStatement' || node.type === 'SwitchCase' || node.type === 'Program')) {
      const list = node.type === 'SwitchCase' ? node.consequent : node.body;
      for (let i = 0; i < list.length - 1; i++) {
        const t = list[i].type;
        if (t === 'ReturnStatement' || t === 'ThrowStatement' || t === 'ContinueStatement' || t === 'BreakStatement')
          add('E9', list[i + 1], `${t} 之后的第 ${list[i + 1].loc.start.line} 行代码不可达`);
      }
    }
    if (node.type === 'Literal' && node.regex && typeof node.regex.pattern === 'string') {
      if (/\\r/.test(node.regex.pattern) || /[\n\u2028\u2029]/.test(node.regex.pattern))
        add('E10', node, `正则字面量含 \\r 或裸换行（第 ${line} 行）→ JS 正则里 \\r 是行终止符，行为与预期不符`);
    }
  }, walk.base, null);

  // ── Pass 2：Identifier 引用解析（E1/E2/E3）───────────────────────
  const pb = new Set(), fns = new Set();
  walk.fullAncestor(ast, (node, _st, anc) => {
    if (node.type !== 'Identifier') return;
    const parent = anc.length >= 2 ? anc[anc.length - 2] : null;
    if (!isRefPosition(node, parent, anc)) return;

    pb.clear(); fns.clear();
    for (const a of anc) { if (BLOCK_TYPES.has(a.type)) pb.add(a); if (FN_TYPES.has(a.type)) fns.add(a); }
    const selfFn = nearest(anc, FN_TYPES);
    const refBlock = nearest(anc, BLOCK_TYPES);   // 引用所在的最近块（用于判定真 TDZ）

    const cands = byName.get(node.name);
    if (!cands) {
      if (!GLOBALS.has(node.name))
        add('E3', node, `标识符 "${node.name}" 在本文件任何作用域都找不到声明 → 运行时可能是 ReferenceError（笔误或漏声明）`);
      return;
    }
    // 候选限定：声明的块在当前路径上，或声明所属函数在当前路径上（同函数不同块）
    let hit = null, escaped = null, tdz = null;
    for (let i = 0; i < cands.length; i++) {
      const d = cands[i];
      const inPath = pb.has(d.block);
      const sameFn = (d.kind === 'var') ? (d.fn === selfFn || fns.has(d.fn)) : (d.fn === selfFn || fns.has(d.fn));
      if (!inPath && !sameFn) continue;
      if (d.kind === 'var' || d.kind === 'param') { hit = d; continue; }   // 函数作用域，合法
      if (inPath) {
        if (d.start <= node.start) { if (!hit || d.start > hit.start) hit = d; }
        // 只有「同一块内、引用在声明之前」才是真 TDZ。
        // 真 TDZ 必须同时满足：同一块内 + 同一个函数（箭头函数表达式体不是块，
        // 若不要求同函数，会把"函数内引用顶层 const"这种合法的延迟执行误判成 TDZ）
        else if (d.block === refBlock && d.fn === selfFn) { if (!tdz) tdz = d; }
        // 声明在外层块（典型：顶层 const，函数体内引用）—— 函数调用时早已初始化，合法。
        else { if (!hit) hit = d; }
      } else if (sameFn) {
        if (!escaped) escaped = d;   // 同函数的另一个块里声明 → 块外引用
      }
    }
    if (hit) return;
    if (escaped) {
      add('E1', node, `块级作用域逃逸：变量 "${node.name}" 是 ${escaped.kind} 声明在第 ${escaped.line} 行的块内，` +
        `却在第 ${node.loc.start.line} 行块外被引用 → 运行时必崩 ReferenceError（本项目 /api/lock/unlock 踩过同款坑）`);
    } else if (tdz) {
      add('E2', node, `TDZ：变量 "${node.name}" 在第 ${tdz.line} 行才用 ${tdz.kind} 声明，此处（第 ${node.loc.start.line} 行）提前引用 → ReferenceError`);
    } else if (!GLOBALS.has(node.name)) {
      add('E3', node, `标识符 "${node.name}" 在当前作用域链上找不到有效声明（第 ${node.loc.start.line} 行）`);
    }
  }, walk.base, null);

  return { issues, ms: Date.now() - t0 };
}

// ── 主流程 ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const wantHtml = argv.includes('--html');
const only = argv.filter(a => !a.startsWith('-'));
let files = only.length ? only : fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.js') && f !== '_lint_logic.js').sort();

const SEV = { E0: '🔴', E1: '🔴', E2: '🔴', E6: '🔴', E3: '🟠', E4: '🟠', E5: '🟡', E7: '🟡', E8: '🟡', E10: '🟡', E9: '⚪', E4b: '⚪' };
const NAME = { E1: '块级作用域逃逸(必崩)', E2: 'TDZ提前引用(必崩)', E3: '未声明标识符', E4: '空catch吞异常(高危)', E4b: '空catch兜底(无害)', E5: 'async未await', E6: 'require路径不存在(必崩)', E7: '==比较', E8: 'parseInt无radix', E9: '不可达代码', E10: '正则含\\r', E0: '解析失败' };

const report = [];
let total = 0, slow = [];
for (const f of files) {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) continue;
  let src = fs.readFileSync(fp, 'utf8');
  let { issues, ms } = lintFile(fp, src);
  if (ms > 3000) slow.push(f + '(' + ms + 'ms)');

  if (f.endsWith('.html')) {
    const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m, idx = 0;
    while ((m = re.exec(src))) {
      idx++;
      const r = lintFile(fp + '#s' + idx, m[1]);
      const off = src.slice(0, m.index).split('\n').length - 1;
      r.issues.forEach(i => { i.line += off; issues.push(i); });
    }
  }
  if (issues.length) { report.push({ file: f, iss: issues }); total += issues.length; }
}

const byCode = {};
report.forEach(r => r.iss.forEach(i => (byCode[i.code] = byCode[i.code] || []).length));
// 修正统计
const cnt = {};
report.forEach(r => r.iss.forEach(i => cnt[i.code] = (cnt[i.code] || 0) + 1));

console.log('═'.repeat(70));
console.log(`逻辑缺陷静态扫描 v2 —— 扫 ${files.length} 个文件，发现 ${total} 处可疑`);
console.log('═'.repeat(70));
if (slow.length) console.log('（慢文件：' + slow.join(', ') + '）');
if (!total) { console.log('✅ 未发现可疑逻辑问题'); process.exit(0); }
console.log('\n【汇总】');
Object.keys(cnt).sort().forEach(c => console.log(`  ${SEV[c]} ${c} ${NAME[c]} : ${cnt[c]} 处`));
console.log('\n【明细】');
report.forEach(r => {
  console.log(`\n── ${r.file} ──`);
  r.iss.sort((a, b) => a.code.localeCompare(b.code) || a.line - b.line)
    .forEach(i => console.log(`  ${SEV[i.code]} ${i.code} L${i.line}: ${i.msg}`));
});
