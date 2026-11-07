// df 轮扫描器：找「声明了但没有任何一条路径会去兑现」的东西
// ① 配置项：只写不读（设了没人用 = 承诺了没路径）/ 只在初始对象里出现、全项目零引用
// ② 映射表常量：表里声明的键，全项目找不到读取点
// ③ 导出的函数：模块 return 出去、全项目没人调
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const FILES = ['server.js', 'holdings.js', 'analysis.js', 'logic.js', 'em.js', 'push.js', 'ztpre.js']
  .filter(f => fs.existsSync(path.join(ROOT, f)));
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const src = {};
for (const f of FILES) src[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
const all = Object.values(src).join('\n');
const html = HTML;

// ── ① S.config 的键 ───────────────────────────────────────────────
const keyRef = new Map();   // key -> {read:[], write:[], init:bool}
function note(k, kind, where) {
  if (!keyRef.has(k)) keyRef.set(k, { read: [], write: [], init: false });
  const e = keyRef.get(k);
  if (kind === 'init') e.init = true; else e[kind].push(where);
}
for (const [f, s] of Object.entries(src)) {
  // S.config.xxx = ...   /  S.config['xxx'] = ...
  const reW = /S\.config\.([A-Za-z_$][\w$]*)\s*=(?!=)|S\.config\[['"]([^'"]+)['"]\]\s*=(?!=)/g;
  let m;
  while ((m = reW.exec(s))) { const k = m[1] || m[2]; note(k, 'write', f + ':' + s.slice(0, m.index).split('\n').length); }
  const reR = /S\.config\.([A-Za-z_$][\w$]*)|S\.config\[['"]([^'"]+)['"]\]/g;
  while ((m = reR.exec(s))) {
    const k = m[1] || m[2];
    const ln = f + ':' + s.slice(0, m.index).split('\n').length;
    // 判是不是赋值左边：看匹配后面紧跟的是否 = 且不是 ==
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 3);
    if (/^\s*=(?!=)/.test(after)) continue;   // 写点，已在上面记过
    note(k, 'read', ln);
  }
}
// 初始对象里的键（server.js 顶部 `config: { ... }`）
const initM = src['server.js'].match(/config:\s*\{([\s\S]{0,900}?)\}/);
if (initM) for (const mm of initM[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) note(mm[1], 'init', 'init');

console.log('══════ ① S.config 键的读写体检 ══════');
const rows = [...keyRef.entries()].sort((a, b) => a[0].localeCompare(b[0]));
let dead = 0, initOnly = 0;
for (const [k, e] of rows) {
  const nR = e.read.length, nW = e.write.length;
  let flag = '';
  if (nR === 0 && nW === 0 && e.init) { flag = '❗只在初始对象里，全项目零引用'; initOnly++; }
  else if (nR === 0 && nW > 0) { flag = '❌ 只写不读（设了没人用）'; dead++; }
  else if (nW === 0 && nR > 0 && !e.init) { flag = '⚠️ 只读不写（永远拿默认值）'; }
  if (flag) console.log(`  ${k.padEnd(24)} read=${nR} write=${nW}  ${flag}`);
}
console.log(`  合计 ${rows.length} 个键；只写不读 ${dead}；零引用 ${initOnly}\n`);

// ── ② 常量映射表：声明的键有没有被读 ──────────────────────────────
console.log('══════ ② 常量映射表的键有没有读取点 ══════');
const TABLES = ['MOD_DAY_CAP', 'MSG_CAP', 'PROB_DEF', 'PROB_KIND_OF_TYPE', 'CFG_RANGE'];
for (const t of TABLES) {
  const m = all.match(new RegExp('const\\s+' + t + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\};'));
  if (!m) { console.log(`  ${t}: 没找到定义`); continue; }
  const body = m[1];
  const keys = [...body.matchAll(/^\s{2}(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm)]
    .map(x => x[1] || x[2] || x[3]).filter(Boolean);
  const noRef = keys.filter(k => {
    const re = new RegExp('[\\[.,\\{]\\s*[\'"]' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\'"]|\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b(?=\\s*[:\\]\\),])', 'g');
    const hits = (all.match(re) || []).length;
    return hits <= 1;   // 只有表里那一次
  });
  console.log(`  ${t}: ${keys.length} 键，找不到独立读取点的 ${noRef.length}${noRef.length ? ' → ' + noRef.join(',') : ''}`);
}

// ── ③ 面板按钮 / 导出函数的死入口 ─────────────────────────────────
console.log('\n══════ ③ 面板 onclick 的函数有没有定义 ══════');
const fns = new Set([...html.matchAll(/on(?:click|change|keydown|input)\s*=\s*"([^"]*)"/g)]
  .flatMap(x => [...x[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(y => y[1])));
const htmlJs = html.replace(/<!--[\s\S]*?-->/g, '');
const undef = [...fns].filter(n => !new RegExp('function\\s+' + n + '\\b|\\b' + n + '\\s*=\\s*(?:async\\s*)?(?:function|\\()|const\\s+' + n + '\\b|let\\s+' + n + '\\b').test(htmlJs));
console.log(`  面板内联事件函数 ${fns.size} 个；找不到定义 ${undef.length}${undef.length ? ' → ' + undef.join(',') : ''}`);

console.log('\n══════ ④ 模块导出但全项目没人调的函数 ══════');
const expAll = [...src['holdings.js'].matchAll(/^\s{4}([a-zA-Z_$][\w$]*)[,:]|\breturn\s*\{([\s\S]{0,600}?)\};/g)];
const expNames = new Set();
for (const m of [...src['holdings.js'].matchAll(/([A-Za-z_$][\w$]*)\s*,\s*(?=[A-Za-z_$\s]*\n?\s*\};)/g)]) expNames.add(m[1]);
const hdExports = ['ops', 'snapshots', 'restore', 'purgeOps', 'applyRemoteRemoval', 'addRemoteItem', 'lastAddAt', 'lastRemoveAt',
  'add', 'update', 'remove', 'removeMany', 'clearAll', 'lock', 'setLocked', 'setMute', 'setTags', 'PRESET_TAGS', 'normTags',
  'setCapital', 'setThresholds', 'compute', 'watch', 'checkNow', 'verdict'];
const hdDead = hdExports.filter(n => {
  const uses = (all.match(new RegExp('HD\\.' + n + '\\b', 'g')) || []).length;
  return uses === 0;
});
console.log(`  holdings 导出 ${hdExports.length} 个；HD.xxx 零调用 ${hdDead.length}${hdDead.length ? ' → ' + hdDead.join(',') : ''}`);
