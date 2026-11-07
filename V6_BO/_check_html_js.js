const fs = require('fs');
const h = fs.readFileSync('public/index.html', 'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, bad = 0;
while ((m = re.exec(h))) {
  i++;
  const code = m[1];
  const line = h.slice(0, m.index).split('\n').length;
  try { new Function(code); console.log(`  脚本块 #${i}（起始行 ${line}）语法 OK，${code.length} 字符`); }
  catch (e) { bad++; console.log(`  ❌ 脚本块 #${i}（起始行 ${line}）: ${e.message}`); }
}
console.log(bad ? `  ${bad} 块有语法错误` : '  全部脚本块语法 OK');
