// 扫描器：系统里"造出来就该消失"的东西，有没有人负责收尸（cn 轮）
// ① 内存容器（Map/Set/对象）声明后有没有 .delete/.clear/重建
// ② 一次性凭据（resetToken/otp/pending/srcpkg）有没有过期清理
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = path.join(ROOT, 'server.js');
const src = fs.readFileSync(SV, 'utf8');
const lines = src.split(/\r?\n/);

// 剥注释（JS 里 \r 也是行终止符，用 indexOf('//')）
function stripLine(s) {
  let out = '', i = 0, q = null;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      out += c;
      if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') break;
    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    out += c; i++;
  }
  return out;
}
const code = lines.map(stripLine).join('\n');

// ---- ① 内存容器 ----
// 只认顶层（行首无缩进）声明，避免抓到函数内临时变量
const declRe = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(new\s+(?:Map|Set)\s*\(\s*\)|\{\s*\})/;
const decls = [];
lines.forEach((raw, idx) => {
  const s = stripLine(raw);
  const m = s.match(declRe);
  if (m) decls.push({ name: m[1], kind: m[2].indexOf('Map') >= 0 ? 'Map' : (m[2].indexOf('Set') >= 0 ? 'Set' : 'Obj'), line: idx + 1 });
});

// 统计每个标识符的"回收"动作
function countRe(name) {
  const esc = name.replace(/\$/g, '\\$');
  const pats = [
    new RegExp('\\b' + esc + '\\.delete\\s*\\(', 'g'),
    new RegExp('\\b' + esc + '\\.clear\\s*\\(', 'g'),
    new RegExp('\\b' + esc + '\\s*=\\s*new\\s+(?:Map|Set)\\s*\\(', 'g'),
    new RegExp('\\b' + esc + '\\s*=\\s*\\{\\s*\\}', 'g'),
  ];
  return pats.map(p => (code.match(p) || []).length);
}

console.log('=== ① 顶层内存容器：声明后有没有回收动作 ===');
console.log('容器名'.padEnd(28), '类型', ' delete clear 重建');
const orphans = [];
for (const d of decls) {
  const [del, clr, re] = countRe(d.name);
  const total = del + clr + re;
  const flag = total === 0 ? '  <<< 从不回收' : '';
  console.log(String(d.name).padEnd(30), d.kind.padEnd(4), String(del).padStart(4), String(clr).padStart(5), String(re).padStart(4), flag);
  if (total === 0) orphans.push(d);
}
console.log('\n从不回收的容器数 =', orphans.length);
console.log(orphans.map(o => `${o.name}(L${o.line})`).join(', '));

// ---- ② 一次性凭据 / 有生命周期的东西 ----
console.log('\n=== ② 一次性凭据与临时产物：有没有过期清理 ===');
const probes = [
  ['resetToken', /resetToken/gi],
  ['otp 验证码', /otp|devCode|verifyCode/gi],
  ['pending 表', /pending/gi],
  ['srcpkg 令牌', /srcpkg|\.srcpkg/gi],
  ['corrupt 留档', /corrupt/gi],
  ['holdings_bak', /holdings_bak/gi],
  ['tmp 文件', /_tmp|\.tmp\b/gi],
  ['revoked 名单', /revoked|_revokedBag/gi],
  ['SSE 连接', /sseClients|_sseConns|res\.writeHead.*event-stream/gi],
  ['去重表', /dedup|_lastPush|_bzLastPush/gi],
  ['inflight', /_inflight/gi],
];
for (const [label, re] of probes) {
  const hits = (code.match(re) || []).length;
  const kw = /\b(expire|ttl|过期|超时|清理|delete|clear|sweep|prune|shift|splice|unlink|rm\b)/i;
  // 找同一批行里有没有过期/清理关键词
  let guarded = 0;
  lines.forEach((raw, i) => {
    const s = stripLine(raw);
    if (re.test(s) && kw.test(s)) guarded++;
  });
  console.log(String(label).padEnd(16), '出现', String(hits).padStart(4), ' 行内带清理语义', String(guarded).padStart(3), guarded === 0 ? '  <<< 无' : '');
}

// ---- ③ 磁盘侧：有没有 unlink / rmSync ----
console.log('\n=== ③ 磁盘删除调用点 ===');
const rmRe = /\b(unlinkSync|rmSync|unlink|rmdir|renameSync)\s*\(/g;
const rmHits = [];
lines.forEach((raw, i) => {
  const s = stripLine(raw);
  if (rmRe.test(s)) rmHits.push((i + 1) + ': ' + s.trim().slice(0, 110));
  rmRe.lastIndex = 0;
});
console.log('删除类调用共', rmHits.length, '处');
rmHits.slice(0, 30).forEach(h => console.log('  ', h));

// ---- ④ 落盘流水型文件有没有上限 ----
console.log('\n=== ④ 落盘流水：有没有条数上限 ===');
const flowFiles = ['pushlog.json', '.holdings_ops.json', 'learn_history.json', 'stats.json', 'news.json', 'review.json'];
for (const f of flowFiles) {
  const re = new RegExp(f.replace(/\./g, '\\.'), 'g');
  const n = (code.match(re) || []).length;
  // 找它附近有没有 slice/limit/cap
  let cap = 0;
  lines.forEach((raw) => {
    const s = stripLine(raw);
    if (re.test(s) && /\b(slice\s*\(\s*0\s*,\s*\w+|CAP|limit|MAX_|cap)\b/.test(s)) cap++;
    re.lastIndex = 0;
  });
  console.log(String(f).padEnd(24), '引用', String(n).padStart(3), ' 带上限语义', String(cap).padStart(2), cap === 0 ? '  <<< 无上限' : '');
}
