// df 轮扫描器 2：找「注释/文案里承诺了某个开关/配置，但代码里没有任何路径能兑现」
// 判据：注释里出现「可在面板 / 面板可 / 可在设置 / 在面板关 / 可在 /api/config 调 / 面板上调」等承诺措辞，
//       然后检查：①该键在 public/index.html 里有没有入口 ②在 CFG_RANGE 白名单里吗 ③有没有写入点
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const HD = fs.readFileSync(path.join(ROOT, 'holdings.js'), 'utf8');
const ALL = SRV + '\n' + HD + '\n' + HTML;

// 白名单
const wl = new Set();
const m0 = SRV.match(/const CFG_RANGE = \{([\s\S]*?)\n\};/);
if (m0) for (const mm of m0[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)) wl.add(mm[1]);

const PROMISE = /(可在面板|面板可|面板上(?:可|能|关|调|改|设)|可在设置|在面板里|可在\s*\/api\/config\s*(?:里)?调|面板里(?:可|能)|可由面板|面板关闭|可在面板关|面板上关|面板可调|可在面板上)/;
const KEYRE = /(?:S\.config\.([A-Za-z_$][\w$]*)|config\.([A-Za-z_$][\w$]*)|`?config\.([A-Za-z_$][\w$]*)`?|\b([a-z][A-Za-z]*[A-Z][A-Za-z]*)\b)/g;

const lines = SRV.split('\n');
const found = [];
lines.forEach((ln, i) => {
  if (!PROMISE.test(ln)) return;
  // 只看注释：行首 // 或 行尾 // 之后的那一小段（行内注释也算承诺）
  const ci = ln.indexOf('//');
  if (ci < 0) return;
  ln = ln.slice(ci);
  if (!PROMISE.test(ln)) return;
  // 抓这一行里的候选键
  const keys = new Set();
  for (const mm of ln.matchAll(/S\.config\.([A-Za-z_$][\w$]*)/g)) keys.add(mm[1]);
  for (const mm of ln.matchAll(/config\.([a-z][A-Za-z]*[A-Z][A-Za-z]*)/g)) keys.add(mm[1]);
  for (const mm of ln.matchAll(/`([a-z][A-Za-z]*[A-Z][A-Za-z]*)`/g)) keys.add(mm[1]);
  if (!keys.size) { found.push({ line: i + 1, key: '-', text: ln.trim().slice(0, 110), why: '承诺句里没抓到键名' }); return; }
  for (const k of keys) {
    const inHtml = new RegExp('\\b' + k + '\\b').test(HTML);
    const inWl = wl.has(k);
    const writes = (ALL.match(new RegExp('\\b' + k + '\\s*=', 'g')) || []).length;
    found.push({ line: i + 1, key: k, inHtml, inWl, writes, text: ln.trim().slice(0, 130) });
  }
});

console.log('══════ 注释里承诺「可在面板/设置里调」的键 ══════');
for (const f of found) {
  if (f.key === '-') { console.log(`  L${f.line}  (未抓到键)  ${f.text}`); continue; }
  const bad = [];
  if (!f.inHtml) bad.push('面板无入口');
  if (!f.inWl) bad.push('不在 /api/config 白名单');
  if (f.writes === 0) bad.push('全项目零写入点');
  const mark = bad.length ? '❌ ' + bad.join(' + ') : '✅';
  console.log(`  L${String(f.line).padEnd(6)} ${f.key.padEnd(22)} ${mark}`);
  console.log(`          ${f.text}`);
}
console.log(`\n  白名单(${wl.size}): ${[...wl].join(',')}`);

// ── 反向：白名单里的键，面板上有没有入口 ──────────────────────────
console.log('\n══════ 白名单里可调的键，面板上有没有入口 ══════');
for (const k of wl) {
  const inHtml = new RegExp('\\b' + k + '\\b').test(HTML);
  console.log(`  ${k.padEnd(22)} 面板入口: ${inHtml ? '有' : '❌ 无（只能手改 config.json / 打接口）'}`);
}
