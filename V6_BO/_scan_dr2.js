// dr 补扫：找出所有「在数字前写死 + 号」的地方（不判断正负 → 负数打成 +-3.2）
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');
const lines = src.split('\n');

// 剥掉 // 注释，避免注释里的字面量干扰
const clean = lines.map(l => {
  const i = l.indexOf('//');
  return i >= 0 ? l.slice(0, i) : l;
});

let n = 0;
clean.forEach((l, idx) => {
  // 找 +${ ... } 且前面不是三元判断
  const re = /\+?\$\{/g;
  let m;
  while ((m = re.exec(l))) {
    const s = m.index;
    const pre = l.slice(Math.max(0, s - 20), s + m[0].length);
    // 三元安全写法形如 ? '+' : ''}${x  或 > 0 ? '+' : ''}${
    if (/\?\s*'\+'\s*:\s*''\}\}\s*\$\{/.test(l.slice(Math.max(0, s - 16), s + 4))) continue;
    if (!m[0].startsWith('+')) continue;
    // 排除字符串拼接的 + 如 'abc' + ${}
    const before = l.slice(Math.max(0, s - 1), s);
    if (/['"`\w)\]]/.test(before)) continue;   // 前面是引号/标识符 → 是拼接符不是正号
    n++;
    console.log('L%d: %s', idx + 1, l.trim().slice(0, 160));
  }
});
console.log('--- 写死正号候选 %d 处', n);

console.log('\n=== 前端 index.html ===');
const h = fs.readFileSync('public/index.html', 'utf8').split('\n');
const hc = h.map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; });
let m2 = 0;
hc.forEach((l, idx) => {
  const re = /\+?\$\{/g;
  let m;
  while ((m = re.exec(l))) {
    if (!m[0].startsWith('+')) continue;
    const before = l.slice(Math.max(0, m.index - 1), m.index);
    if (/['"`\w)\]]/.test(before)) continue;
    if (/\?\s*'\+'\s*:\s*''\}\}\s*\$\{/.test(l.slice(Math.max(0, m.index - 16), m.index + 4))) continue;
    m2++;
    console.log('L%d: %s', idx + 1, l.trim().slice(0, 160));
  }
});
console.log('--- 前端写死正号候选 %d 处', m2);
