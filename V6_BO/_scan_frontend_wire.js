// 体检扫描器（2026-10-06）：面板「点了没反应」—— onclick/onchange 绑定的函数在页面里根本没有定义。
// 这类故障的表现最恶劣：按钮看得见、点得动、控制台一条报错都没有（除非正好开着 F12），
// 用户只会以为"这个功能坏了/还没做"，其实只是函数名拼错或被重构改掉了。
//
// ⚠️ 不能拿 stripNoise(整个 html) 来分析：HTML 属性里的引号会让它把整段 <script> 当成
//    字符串涂掉（第一版就是这么红的 —— "定义后从未调用" 报了 206 个，全是假的）。
//    正确做法：defs / 调用计数只在抽出来的 <script> 区块里统计，
//    onclick 属性名另外从原始 html 里抓。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
// 抽出所有 <script>…</script>（跳过带 src 的外链）
let script = '';
for (const mm of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) script += '\n' + mm[1];
const code = stripNoise(script, { keepStrings: true });

// ① 内联事件属性里调用的函数（从原始 html 抓；滤掉 if/for 这类内联表达式）
const KW = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'function', 'catch']);
const calls = new Map();
for (const mm of html.matchAll(/on(?:click|change|input|keyup|keydown|submit)\s*=\s*["']([A-Za-z_$][\w$]*)\s*\(/g)) {
  if (KW.has(mm[1])) continue;
  calls.set(mm[1], (calls.get(mm[1]) || 0) + 1);
}
// ② script 里定义了什么函数
const defs = new Set();
for (const mm of code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defs.add(mm[1]);
for (const mm of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function|async|\()/g)) defs.add(mm[1]);
for (const mm of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defs.add(mm[1]);

const missing = [...calls.keys()].filter(f => !defs.has(f)).sort();
console.log('内联事件绑定的函数共 ' + calls.size + ' 个（script 区定义 ' + defs.size + ' 个）');
console.log('\n❌ 绑定了但页面里没有定义（点了没反应）: ' + (missing.length ? missing.join(', ') : '无'));

// ⚠️ 这里**故意不做**「定义了但没被调用」的死代码清单：实测误报率高到没法看 ——
//    ① `const f = (c, d) => …` 里的箭头参数会被上面的定义正则当成函数定义名（c/d/i/k/n/t 全是）
//    ② stripNoise 遇到 /…/ 正则字面量时会一路涂到下一个 `/`，脚本被整段吞掉 →
//       明明到处在调用的 pageMsg / holdLoad 也会被判成"从没调用过"。
//    真要查死代码得换 AST（acorn），别用正则硬凑。
