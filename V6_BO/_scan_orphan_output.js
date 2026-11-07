// cr 轮扫描器：系统里那些「算出来就没人再看过」的数。
// 角度：复盘/学习/宽度/情绪/各种扫描结果，花了很大代价（拉全A行情 + 逐票K线）算出来，
//   但到底有没有消费者？面板有没有显示、推送有没有引用、落盘后有没有人读回。
//   白算的不仅浪费数据源请求（还容易把自己打进限流），更因为"没人看"而长期带着错误不被发现。
// 判消费的四个出口：
//   ① 前端 index.html 读（s.xxx / 事件回调）
//   ② /api/state 或专用接口输出（间接：前端通过 state 读）
//   ③ 推送文案引用（模板字符串里出现）
//   ④ 落盘后被读回（writeFileSync 有对应的 readFileSync）
// 只列候选，不自动判定；改之前先读上下文。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const SV_NOC = SV.split(/\r?\n/).map(s => { const i = s.indexOf('//'); return i >= 0 ? s.slice(0, i) : s; }).join('\n');

// ── ① 顶层状态容器 S.xxx 的赋值点（生产结果的地方）──
const prod = new Map();   // name -> [{line, text}]
SV_NOC.split('\n').forEach((L, i) => {
  const m = L.match(/(?:^|[^.\w$])S\.([A-Za-z_$][\w$]*)\s*=(?!=)/);
  if (!m) return;
  const n = m[1];
  if (!prod.has(n)) prod.set(n, []);
  prod.get(n).push({ line: i + 1, text: L.trim().slice(0, 120) });
});

// ── /api/state 的输出清单（间接消费者：前端通过 s.xxx 读）──
const stIdx = SV_NOC.indexOf("p === '/api/state'");
const STATE_BODY = stIdx > 0 ? SV_NOC.slice(stIdx, stIdx + 22000) : '';
const inState = name => new RegExp('(^|[^\\w$.])' + name + '\\s*:').test(STATE_BODY) ||
  new RegExp('(^|[^\\w$.])' + name + '\\s*,').test(STATE_BODY);

// ── 推送文案里是否引用（pushAll / pushLog 的正文里出现 S.xxx）──
const usedInPush = name => {
  const re = new RegExp('(^|[^\\w$.])S\\.' + name + '\\b');
  let n = 0;
  SV_NOC.split('\n').forEach(L => {
    if (!/pushAll\(|pushLog\(|pushPaperDigest|msg:\s|title:/.test(L)) return;
    if (re.test(L)) n++;
  });
  return n;
};
// ── 前端是否读 ──
const usedInHtml = name => {
  // ⛔ 别把 `.` 排除掉：前端读的正是 `s.xxx` / `d.xxx`，排除点会全部漏判（实测 14 个全假红）
  const re = new RegExp('(^|[^\\w$])' + name + '\\b');
  return re.test(HTML);
};
// ── 落盘后有没有被读回 ──
const fileOf = name => {
  // 找形如 xx_FILE / XX_FILE 常量里含该名字的
  const m = SV_NOC.match(new RegExp('const\\s+([A-Z_]*' + name.toUpperCase() + '[A-Z_]*)_FILE\\s*='));
  return m ? m[1] : null;
};

const rows = [];
for (const [name, hits] of prod) {
  const state = inState(name);
  const html = usedInHtml(name);
  const push = usedInPush(name);
  rows.push({ name, n: hits.length, state, html, push, line: hits[0].line, sample: hits[0].text });
}

console.log('=== ① 算出来但【没有任何出口】的容器（★ 白算嫌疑）===');
const orphan = rows.filter(r => !r.state && !r.html && !r.push);
console.log(`共 ${rows.length} 个结果容器，其中零出口 ${orphan.length} 个：\n`);
for (const r of orphan.sort((a, b) => b.n - a.n)) {
  console.log(`  ★ S.${r.name}  赋值 ${r.n} 处  L${r.line}  ${r.sample}`);
}

console.log('\n=== ② 只进 /api/state，但前端根本没读（间接白算）===');
const stateOnly = rows.filter(r => r.state && !r.html && !r.push);
console.log(`共 ${stateOnly.length} 个：\n`);
for (const r of stateOnly.sort((a, b) => b.n - a.n)) {
  console.log(`  · S.${r.name}  赋值 ${r.n} 处  L${r.line}  ${r.sample}`);
}

console.log('\n=== ③ 有消费者的（对照组，确认扫描器没瞎判）===');
const wired = rows.filter(r => r.html || r.push);
console.log(`共 ${wired.length} 个（前 12 条）：`);
for (const r of wired.slice(0, 12)) console.log(`  ✓ S.${r.name}  html=${r.html} push=${r.push} state=${r.state}`);

// ── ④ 落盘了但从没被读回的文件 ──
console.log('\n=== ④ 写了盘但全项目没人读回的文件 ===');
const files = new Set();
SV_NOC.replace(/path\.join\(__dirname,\s*'([^']+)'\)/g, (_, f) => { files.add(f); return _; });
SV_NOC.replace(/const\s+([A-Z_]+_FILE)\s*=\s*path\.join\(__dirname,\s*'([^']+)'\)/g, (_, c, f) => { files.add(f); return _; });
const unread = [];
for (const f of files) {
  if (!/\.(json|csv|txt|log)$/.test(f)) continue;
  const w = new RegExp("writeFileSync\\([^)]*" + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(SV_NOC);
  const r = new RegExp("readFileSync\\([^)]*" + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(SV_NOC);
  if (w && !r) unread.push(f);
}
console.log(unread.length ? unread.map(f => '  ★ ' + f).join('\n') : '  （无：写过的文件都有读回点）');

// ── ⑤ 定义了但从未被调用的函数（最纯粹的"算了没人看"）──
console.log('\n=== ⑤ 定义了但从未被调用的函数 ===');
const defs = [];
LINES.forEach((L, i) => {
  const m = L.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) defs.push({ name: m[1], line: i + 1 });
});
// ⛔ 正则里不许排除 `.`：调用点大量是 `...auctionScoreOf(x, ` / `A.effProb(` 这种，
//    排除点会把它们全判成未调用（实测一次假报 7 个里面 3 个是这个坑）。
const dead = [];
for (const d of defs) {
  const re = new RegExp('(^|[^\\w$])' + d.name + '\\s*\\(', 'g');
  let n = 0;
  LINES.forEach(L => { n += (L.match(re) || []).length; });
  const self = (LINES[d.line - 1].match(re) || []).length;
  if (n - self === 0) dead.push(d);
}
console.log(`顶层函数 ${defs.length} 个，零调用 ${dead.length} 个：`);
for (const d of dead) console.log(`  ★ ${d.name}  L${d.line}`);
console.log('  ⚠️ 通过 setTimeout/setInterval/guard 传【函数引用】（不带括号）的不算死代码，需人工确认');

console.log('\n（扫描器只列候选；"赋值 N 处"多、且零出口的，优先人工复核）');
