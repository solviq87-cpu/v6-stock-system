// df 轮扫描器 3：找「开关型配置 —— 读得到、但没有任何路径能改它」
// 判据：server.js / holdings.js 里出现 `S.config.X` 的读取，且该键
//       ① public/index.html 里没有任何入口  ② 不在 /api/config 白名单 CFG_RANGE 里
//       ③ 全项目找不到写入点
//       → 用户永远只能拿到默认值，注释里若还承诺「可在面板关/调」，就是彻头彻尾的空头承诺。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const OTHERS = ['holdings.js', 'analysis.js', 'logic.js', 'em.js']
  .filter(f => fs.existsSync(path.join(ROOT, f)))
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const ALL = SRV + '\n' + OTHERS + '\n' + HTML;

const wl = new Set();
const m0 = SRV.match(/const CFG_RANGE = \{([\s\S]*?)\n\};/);
if (m0) for (const mm of m0[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)) wl.add(mm[1]);

const keys = new Map();
function add(k, file, ln) {
  if (!keys.has(k)) keys.set(k, []);
  keys.get(k).push(file + ':' + ln);
}
for (const [file, s] of [['server.js', SRV], ['holdings.js', OTHERS]]) {
  s.split('\n').forEach((ln, i) => {
    for (const mm of ln.matchAll(/S\.config\.([A-Za-z_$][\w$]*)/g)) add(mm[1], file, i + 1);
    for (const mm of ln.matchAll(/S\.config\[['"]([^'"]+)['"]\]/g)) add(mm[1], file, i + 1);
  });
}

console.log('══════ 「读得到但改不了」的开关型配置 ══════');
const rows = [];
for (const [k, where] of [...keys.entries()].sort()) {
  const inHtml = new RegExp('\\b' + k + '\\b').test(HTML);
  const inWl = wl.has(k);
  // 写入点：config.json 初始值不算（那是默认值不是"改"）；只算运行时赋值
  const writes = [];
  ALL.split('\n').forEach((ln, i) => {
    if (new RegExp('\\b' + k + '\\s*=(?!=)').test(ln) && !/^\s*\/\//.test(ln)) writes.push(i + 1);
  });
  if (inHtml || inWl || writes.length) continue;      // 有任一条路径能改 → 不算
  rows.push([k, where.slice(0, 4).join(' '), writes.length]);
}
for (const [k, w] of rows) console.log(`  ❌ ${k.padEnd(24)} 面板无入口 · 不在白名单 · 零写入点   读取点: ${w}`);
console.log(`  合计 ${keys.size} 个被读的 config 键，其中彻底无路径可改 ${rows.length} 个`);

// 顺带：承诺措辞（整行搜，含行内注释）
console.log('\n══════ 承诺措辞与同一行 / 上下 2 行里的 config 键 ══════');
const PROM = /可在面板|面板可|面板上(?:可|能|关|调|改|设)|可在设置|在面板里|可在\s*\/api\/config\s*(?:里)?调|可关掉|可关闭|可配|可调|可设|可改|可在盘后/;
const seen = new Set();
for (const [file, s] of [['server.js', SRV], ['holdings.js', OTHERS]]) {
  const L = s.split('\n');
  L.forEach((ln, i) => {
    if (!PROM.test(ln)) return;
    const ctx = L.slice(Math.max(0, i - 2), i + 3).join('\n');
    for (const mm of ctx.matchAll(/S\.config\.([A-Za-z_$][\w$]*)/g)) {
      const k = mm[1];
      const tag = file + ':' + (i + 1) + ':' + k;
      if (seen.has(tag)) continue; seen.add(tag);
      const inHtml = new RegExp('\\b' + k + '\\b').test(HTML);
      const inWl = wl.has(k);
      let writes = 0;
      ALL.split('\n').forEach(l2 => { if (new RegExp('\\b' + k + '\\s*=(?!=)').test(l2) && !/^\s*\/\//.test(l2)) writes++; });
      const bad = []; if (!inHtml) bad.push('面板无入口'); if (!inWl) bad.push('不在白名单'); if (!writes) bad.push('零写入点');
      console.log(`  ${bad.length ? '❌' : '✅'} ${file}:${i + 1} ${k.padEnd(22)} ${bad.join(' + ') || '路径齐备'}`);
    }
  });
}
