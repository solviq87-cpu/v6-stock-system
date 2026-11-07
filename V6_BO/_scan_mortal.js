// 扫描器：所有「造出来」的落盘产物，有没有对应的「收尸」（cn 轮）
// 思路：收集全项目所有写文件点（writeFileSync / atomicWrite / renameSync / mkdirSync），
//       再收集所有删除点（unlinkSync / rmSync / rmdirSync），
//       两者按文件名做差集 → 「只生不死」的产物。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const FILES = fs.readdirSync(ROOT).filter(f => /^_?(server|holdings|analysis|nextplan|em|logic|learnall|ztpre|bazi|paper|news|push)\w*\.js$/.test(f));
if (!FILES.includes('server.js')) FILES.push('server.js');

function stripLine(s) {
  let out = '', i = 0, q = null;
  while (i < s.length) {
    const c = s[i];
    if (q) { out += c; if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') break;
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    out += c; i++;
  }
  return out;
}

// 写点：抓出现的字符串字面量文件名（.json / 目录常量）
const WRITE_RE = /\b(?:atomicWrite|writeFileSync|renameSync|mkdirSync|createWriteStream)\s*\(/;
const DEL_RE = /\b(?:unlinkSync|rmSync|rmdirSync)\s*\(/;

const writes = [];   // {file, line, code}
const dels = [];     // {line, code, target}
const dirConst = {}; // 目录常量 -> 实际目录名

for (const f of FILES) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  const lines = src.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const s = stripLine(raw);
    if (!s.trim()) return;
    // 目录常量：const XXX = path.join(__dirname, '.xxx');
    const dm = s.match(/^\s*const\s+([A-Z_][A-Z0-9_]*)\s*=\s*path\.join\([^)]*?,\s*'([^']+)'\s*\)/);
    if (dm) dirConst[dm[1]] = dm[2];
    if (WRITE_RE.test(s)) writes.push({ file: f, line: i + 1, code: s.trim().slice(0, 140) });
    if (DEL_RE.test(s)) dels.push({ file: f, line: i + 1, code: s.trim().slice(0, 140) });
  });
}

console.log('=== 目录常量 ===');
for (const [k, v] of Object.entries(dirConst)) console.log(' ', k, '->', v);

console.log('\n=== 写点（' + writes.length + ' 处）涉及的文件/目录 ===');
const wTargets = new Map();
for (const w of writes) {
  // 提取形如 'xxx.json' 或 目录常量 或 path.join(...) 里的字面量
  const lits = [...w.code.matchAll(/'([^']*\.(?:json|zip|tmp|md|txt))'/g)].map(m => m[1]);
  const consts = [...w.code.matchAll(/\b([A-Z_][A-Z0-9_]*)\b/g)].map(m => m[1]).filter(x => dirConst[x]);
  const all = [...new Set([...lits, ...consts.map(c => dirConst[c])])];
  for (const t of all) {
    if (!wTargets.has(t)) wTargets.set(t, []);
    wTargets.get(t).push(w.file + ':' + w.line);
  }
}
for (const [t, ls] of [...wTargets.entries()].sort()) {
  console.log('  ', String(t).padEnd(26), '×' + ls.length, ' ', ls.slice(0, 3).join(' '));
}

console.log('\n=== 删除点 ===');
console.log('共 ' + dels.length + ' 处');
for (const d of dels) console.log('  ', d.file + ':' + d.line, '|', d.code.slice(0, 120));

console.log('\n=== 「只生不死」清单（写了但全项目没有任何删除路径）===');
const delBlob = dels.map(d => d.code).join('\n');
let orphan = 0;
for (const [t, ls] of [...wTargets.entries()].sort()) {
  // .tmp 由 atomicWrite 自己在失败分支 unlink，且同名的 .tmp 会被反复复用 → 不算
  const base = t.replace(/\.tmp$/, '');
  const isTmp = /\.tmp$/.test(t);
  // 删除点里有没有提到这个产物（或其目录常量）
  const dirKey = Object.entries(dirConst).find(([k, v]) => v === t);
  const hit = delBlob.indexOf(t) >= 0 || (dirKey && delBlob.indexOf(dirKey[0]) >= 0) || delBlob.indexOf(base) >= 0;
  if (!hit && !isTmp) {
    console.log('  ⚠️', String(t).padEnd(26), '写于', ls.slice(0, 3).join(' '));
    orphan++;
  }
}
console.log('\n只生不死产物数 =', orphan);
