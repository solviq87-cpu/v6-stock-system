// dp 轮第二遍：同一个数在链路上被加工几道 —— 找「加工后语义变了却没说出去」的点
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');
const L = src.split('\n');

function strip(line) {
  const i = line.indexOf('//');
  return i >= 0 ? line.slice(0, i) : line;
}
const isVerLine = (l) => l.startsWith('const APP_VER = ');

// ── A. gap 系：所有 gap / gapToLimit 的来源与消费 ─────────────────────────
console.log('=== A. gap 来源（可能 NaN 的算术） ===');
L.forEach((raw, i) => {
  if (isVerLine(raw)) return;
  const l = strip(raw);
  if (/gap(ToLimit)?\s*[:=]/.test(l)) console.log(String(i + 1).padStart(6) + '  ' + l.trim().slice(0, 150));
});
console.log('\n=== A2. gap 消费（参与比较/算术） ===');
let gapUse = 0;
L.forEach((raw, i) => {
  if (isVerLine(raw)) return;
  const l = strip(raw);
  if (/gap/.test(l) && !/gap(ToLimit)?\s*[:=]/.test(l) && /[<>]=?|Math\.|[-+*\/]/.test(l)) {
    gapUse++; console.log(String(i + 1).padStart(6) + '  ' + l.trim().slice(0, 150));
  }
});
console.log('gap 消费处合计: ' + gapUse);

// ── B. toFixed 之后又被拿去算（精度已被改过一次） ─────────────────────────
console.log('\n=== B. toFixed 结果参与算术/比较（同一个数被改过一道再算） ===');
const bHits = [];
L.forEach((raw, i) => {
  if (isVerLine(raw)) return;
  const l = strip(raw);
  // 形如 +(x).toFixed(n) 之后本行还有算术或比较
  const m = l.match(/\+\s*\(?([^;]*?)\.toFixed\((\d)\)\)?\s*([<>+\-*\/]=?|\)|\s)/);
  if (!m) return;
  const after = l.slice(l.indexOf(m[0]) + m[0].length);
  if (/[<>]=?[^=]|\*|\-|\+|Math\./.test(after) && !/^\s*$/.test(after)) {
    bHits.push({ n: i + 1, line: l.trim().slice(0, 160) });
  }
});
bHits.forEach(h => console.log(String(h.n).padStart(6) + '  ' + h.line));
console.log('B 类合计: ' + bHits.length);

// ── C. 参与算术但来源是 || 0 / || null（null 与真 0 混成一个） ───────────
console.log('\n=== C. `|| 0` 出现在算术/比较里（null→0 后与真 0 无法区分） ===');
const cHits = [];
L.forEach((raw, i) => {
  if (isVerLine(raw)) return;
  const l = strip(raw);
  if (!/\|\|\s*0\b/.test(l)) return;
  // 同行有比较或算术
  if (/[<>]=?[^=]|\*|\/|Math\./.test(l)) cHits.push({ n: i + 1, line: l.trim().slice(0, 160) });
});
console.log('C 类合计: ' + cHits.length + ' （抽样 40）');
cHits.slice(0, 40).forEach(h => console.log(String(h.n).padStart(6) + '  ' + h.line));

// ── D. 概率/比率类字段被 ×100 后又 toFixed(0)（两次加工） ────────────────
console.log('\n=== D. ×100 后 toFixed(0)（同一个比例被改两道） ===');
const dHits = [];
L.forEach((raw, i) => {
  if (isVerLine(raw)) return;
  const l = strip(raw);
  if (/\*\s*100/.test(l) && /toFixed\(0\)/.test(l)) dHits.push({ n: i + 1, line: l.trim().slice(0, 160) });
});
console.log('D 类合计: ' + dHits.length + ' （抽样 25）');
dHits.slice(0, 25).forEach(h => console.log(String(h.n).padStart(6) + '  ' + h.line));

// ── E. 前端二次加工（index.html 里 toFixed） ─────────────────────────────
const html = fs.readFileSync('public/index.html', 'utf8');
const H = html.split('\n');
console.log('\n=== E. 前端渲染时 toFixed（后端已定过精度，前端又定一次） ===');
let eN = 0;
H.forEach((raw, i) => {
  if (raw.startsWith('const APP_VER = ')) return;
  const l = strip(raw);
  if (/\.toFixed\(/.test(l)) { eN++; if (eN <= 20) console.log(String(i + 1).padStart(6) + '  ' + l.trim().slice(0, 150)); }
});
console.log('E 类合计: ' + eN);

// ── F. NaN 传播风险：参与算术的字段没有 Number.isFinite 保护 ─────────────
console.log('\n=== F. 减法/除法直接吃字段（pct/price/close 等，null 即 NaN） ===');
const fHits = [];
L.forEach((raw, i) => {
  if (isVerLine(raw)) return;
  const l = strip(raw);
  if (/\)\s*-\s*[A-Za-z_$][\w$]*\.pct\b/.test(l) || /\.pct\s*\)?\s*-\s/.test(l)) fHits.push({ n: i + 1, line: l.trim().slice(0, 160) });
});
console.log('F 类合计: ' + fHits.length);
fHits.slice(0, 25).forEach(h => console.log(String(h.n).padStart(6) + '  ' + h.line));
