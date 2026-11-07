// cg 轮：后端 /api/state 下发的字段 vs 前端实际读取的字段，是否分叉
// ⛔ 顶层键必须按括号深度解析：同一行写两个键（`now: Date.now(), trading: ...`）
//    与简写键（`pool,`）用「行首缩进 + 冒号」的正则都会漏掉。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const anchor = SV.indexOf("if (p === '/api/state') {");
const rel = SV.slice(anchor, anchor + 40000);
const jStart = rel.indexOf('return json(res, {');
const bStart = rel.indexOf('{', jStart);
let depth = 0, jEnd = -1;
for (let i = bStart; i < rel.length; i++) {
  const ch = rel[i];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { jEnd = i; break; } }
}
const block = rel.slice(bStart, jEnd + 1);

// 深度解析顶层键：在 depth===1 时，遇到 `,` 或 `}` 结束一个条目；条目里第一个 `:` 前即键名
function topKeys(block) {
  const keys = [];
  let d = 0, seg = '', inStr = null, prevPrev = '';
  for (let i = 0; i < block.length; i++) {
    const ch = block[i], prev = i > 0 ? block[i - 1] : '';
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
      seg += ch; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; seg += ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') d++;
    if (ch === '}' || ch === ')' || ch === ']') d--;
    if (d === 1 && (ch === ',' || (ch === '}' && i === block.length - 1))) {
      const k = seg.split(':')[0].replace(/[\s'"`]/g, '').replace(/^[\s\S]*?([A-Za-z_$][\w$]*)$/, '$1');
      if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.push(k);
      seg = ''; continue;
    }
    if (d >= 1) seg += ch;
  }
  return keys;
}
const keys = topKeys(block);
const uniq = [...new Set(keys)];
console.log('后端 /api/state 顶层键：' + uniq.length + ' 个');
console.log('  ' + uniq.join(', '));
const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
console.log('\n⛔ 重复声明的键：' + (dup.length ? dup.join(', ') : '0 处'));

// 前端读取（只取 <script> 区块，且排除明显是别的对象/局部变量的）
const scriptOnly = HTML.slice(HTML.indexOf('<script'), HTML.lastIndexOf('</script>'));
const reads = new Set();
let m; const RE = /\bs\.([A-Za-z_$][\w$]*)/g;
while ((m = RE.exec(scriptOnly))) reads.add(m[1]);
const readArr = [...reads].sort();
console.log('\n前端 s.xxx 读取：' + readArr.length + ' 个');

const notInPayload = readArr.filter(k => !uniq.includes(k));
console.log('\n⛔ 前端读了但 payload 顶层没有（静默 undefined，' + notInPayload.length + '）：');
for (const k of notInPayload) {
  const line = scriptOnly.split('\n').find(l => new RegExp('\\bs\\.' + k + '\\b').test(l));
  console.log('   s.' + k + '   ← ' + (line || '').trim().slice(0, 130));
}

const notInHtml = uniq.filter(k => !new RegExp('\\.' + k + '\\b').test(scriptOnly));
console.log('\n（参考）后端给了前端没用到的键（' + notInHtml.length + '）：' + notInHtml.join(', '));
