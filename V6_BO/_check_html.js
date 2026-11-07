// 校验 public/index.html 里的内联 <script> 块语法
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, i = 0, err = 0;
while ((m = re.exec(html))) {
  i++;
  const attrs = m[1] || '';
  const code = m[2];
  if (!code.trim()) continue;
  if (/src\s*=/.test(attrs)) continue;
  const line = html.slice(0, m.index).split('\n').length;
  try {
    new Function(code);
    console.log(`OK   #${i}  起始行 ${line}  长度 ${code.length}`);
  } catch (e) {
    err++;
    console.log(`ERR  #${i}  起始行 ${line}: ${e.message}`);
  }
}
// 校验 onclick 里引用的全局函数是否已定义
const fns = new Set();
const fre = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
let f;
while ((f = fre.exec(html))) fns.add(f[1]);
const gre = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function|\()/g;
while ((f = gre.exec(html))) fns.add(f[1]);
const calls = new Set();
const cre = /on(?:click|change|input|submit|keyup|keydown)\s*=\s*"([^"]*)"/g;
while ((f = cre.exec(html))) {
  const inner = f[1];
  const cre2 = /([A-Za-z_$][\w$]*)\s*\(/g;
  let g;
  while ((g = cre2.exec(inner))) calls.add(g[1]);
}
const builtin = new Set(['if','for','while','switch','return','typeof','alert','confirm','prompt','parseInt','parseFloat','Number','String','Boolean','Math','JSON','Date','Array','Object','setTimeout','setInterval','console','event','this','encodeURIComponent','decodeURIComponent','isNaN','requestAnimationFrame','fetch','localStorage','location','document','window','navigator','new','catch','try','else','function','super','void','delete','in','of','instanceof']);
const missing = [...calls].filter(c => !fns.has(c) && !builtin.has(c));
console.log('\n内联脚本块: ' + i + ' 个，语法错误: ' + err + ' 个');
console.log('HTML 内联事件引用但未定义的函数: ' + (missing.length ? missing.join(', ') : '（无）'));
process.exit(err ? 1 : 0);
