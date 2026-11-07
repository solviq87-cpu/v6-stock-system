// dg 轮扫描器：同一个配置键在不同读取入口下，兜底默认值是不是同一个数
// 判据：把「键 → (入口, 默认值)」列成表。同一个键出现两个不同默认值 = 分叉：
//   展示端说 8、实现端按 12 走 → 面板那句话从头错到尾，且不报错（与 de 轮同一类病，只是这次藏在默认值里）。
// 顺带扫：① 同一个语义的数字在多处各写一份（没走常量）② `S.config.X || N` 这种会吃掉 0 的老写法残留
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const F = ['server.js', 'holdings.js', 'analysis.js', 'logic.js', 'em.js']
  .filter(x => fs.existsSync(path.join(ROOT, x)));

const rows = new Map();     // key -> [{file,line,mode,def}]
function add(k, file, ln, mode, def) {
  if (!rows.has(k)) rows.set(k, []);
  rows.get(k).push({ file, line: ln, mode, def });
}

for (const f of F) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  src.split('\n').forEach((ln, i) => {
    const no = ln.replace(/\/\/.*$/, '');            // 去行注释（行内也算，注释里会引用旧值）
    // ① _govCfg('k', N)
    for (const m of no.matchAll(/_govCfg\(\s*'([^']+)'\s*,\s*([-\d.]+)\s*\)/g)) add(m[1], f, i + 1, '_govCfg', m[2]);
    // ② S.config.k || N  /  S.config.k ?? N
    for (const m of no.matchAll(/S\.config\.([A-Za-z_$][\w$]*)\s*(?:\|\||\?\?)\s*([-\d.]+)/g)) add(m[1], f, i + 1, '||', m[2]);
    // ③ +(S.config.k || N)
    for (const m of no.matchAll(/\+\(\s*S\.config\.([A-Za-z_$][\w$]*)\s*(?:\|\||\?\?)\s*([-\d.]+)\s*\)/g)) add(m[1], f, i + 1, '+(||)', m[2]);
    // ④ cfgSetOf('k') —— 默认值来自 CFG_SET.def（不算分叉，只登记入口）
    for (const m of no.matchAll(/cfgSetOf\(\s*'([^']+)'\s*\)/g)) add(m[1], f, i + 1, 'cfgSetOf', 'CFG_SET.def');
    // ⑤ _clampInt(..., N) 之类：只登记，人工看
  });
}

console.log('══════ 同一个键在不同入口的兜底默认值 ══════');
const keys = [...rows.keys()].sort();
let fork = 0;
for (const k of keys) {
  const list = rows.get(k);
  const nums = [...new Set(list.filter(x => x.def !== 'CFG_SET.def').map(x => x.def))];
  const mark = nums.length > 1 ? `❌ 分叉(${nums.join(' vs ')})` : (nums.length === 1 ? '✅' : '·');
  if (nums.length > 1) fork++;
  console.log(`  ${k.padEnd(22)} ${mark.padEnd(18)} 入口 ${list.length} 处`);
  for (const x of list) console.log(`        ${x.file}:${x.line}  ${x.mode} → ${x.def}`);
}
console.log(`\n  合计 ${keys.length} 个键，默认值分叉 ${fork} 个`);

// ── 同一语义的数字是否散落多处（没走常量）──────────────────────────────
console.log('\n══════ 高频兜底数字：有几处各写了一份 ══════');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').split('\n');
const tally = new Map();
SRV.forEach((ln, i) => {
  const no = ln.replace(/\/\/.*$/, '');
  for (const m of no.matchAll(/_govCfg\(\s*'[^']+'\s*,\s*([-\d.]+)\s*\)/g)) {
    const key = m[1];
    if (!tally.has(key)) tally.set(key, []);
    tally.get(key).push(i + 1);
  }
});
for (const [n, ls] of [...tally.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (ls.length >= 2) console.log(`  默认值 ${n.padEnd(6)} 出现 ${ls.length} 处：行 ${ls.join(',')}`);
}
