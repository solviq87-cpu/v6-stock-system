// ch 轮扫描器：同一条规则被复制到新位置时，前提（参数/闸门/兜底）有没有一起带过去
// 第一类：核心判定函数的**形参就是前提**——少传一个就静默退化，不报错
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

function stripComments(src) {
  return src.split('\n').map(line => {
    let from = 0;
    for (;;) {
      const i = line.indexOf('//', from);
      if (i < 0) return line;
      if (line[i - 1] === ':') { from = i + 2; continue; }
      const q = (line.slice(0, i).match(/'/g) || []).length;
      if (q % 2 === 1) { from = i + 2; continue; }
      return line.slice(0, i);
    }
  }).join('\n');
}

const PROD = ['server.js', 'holdings.js', 'analysis.js', 'em.js', 'learnall.js', 'ztpre.js', 'bazi.js', 'nextplan.js', 'myrules.js', 'logic.js', 'mailer.js']
  .filter(f => fs.existsSync(path.join(ROOT, f)));
const src = {};
for (const f of PROD) src[f] = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));

const RULES = [
  { fn: 'isLimitUp', need: 3, why: '限幅要按板块(code)+ST(name)判，少传一个就会把 20cm/ST 判错' },
  // ⚠️ fusedProb 第 6 个 target 是**刻意不传**的（见 server.js 里那段「默认 up3 是刻意的」注释）：
  //    融合值要和 emp 实测命中率同刻度（≥3% 口径），传 'zt' 反而量纲错。所以这里只要求 5 个。
  { fn: 'fusedProb', need: 5, why: '融合概率要实测档+learnall形态，少传会退化成裸模型概率（第6个target刻意留默认）' },
  { fn: 'basisOf', need: 3, why: '基准日要直方图+总数+期望交易日' },
  { fn: 'calcKDJ', need: 3, why: 'KDJ 要 rows 与三个周期参数' },
  { fn: 'trendHygiene', need: 3, why: '趋势体检要 rows+现价+流通市值，少传市值就等于没做市值门槛' },
];

// 按括号配对取出实参串（不含最外层括号），再按顶层逗号数参数个数
function arityOf(text, openIdx) {
  let d = 0, argStr = '';
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') { d++; if (d === 1) continue; }
    else if (ch === ')') { d--; if (d === 0) break; }
    argStr += ch;
  }
  let depth = 0, n = argStr.trim() ? 1 : 0, inStr = null;
  for (const ch of argStr) {
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) n++;
  }
  return { n, argStr: argStr.trim() };
}

for (const r of RULES) {
  console.log('\n===== ' + r.fn + '（' + r.why + '）=====');
  let defLine = '';
  for (const f of PROD) {
    const m = src[f].match(new RegExp('function\\s+' + r.fn + '\\s*\\(([^)]*)\\)'));
    if (m) { defLine = f + ' → (' + m[1].trim() + ')'; break; }
  }
  console.log('定义: ' + (defLine || '(没找到)'));
  const bad = [], good = [];
  for (const f of PROD) {
    const re = new RegExp(r.fn + '\\s*\\(', 'g');
    let m;
    while ((m = re.exec(src[f]))) {
      const openIdx = m.index + m[0].length - 1;
      // 跳过定义那一行
      if (new RegExp('function\\s+' + r.fn + '\\s*\\(').test(src[f].slice(Math.max(0, m.index - 20), m.index + 30))) continue;
      const { n, argStr } = arityOf(src[f], openIdx);
      const ln = src[f].slice(0, m.index).split('\n').length;
      const rec = f + ':' + ln + '  ' + r.fn + '(' + argStr.slice(0, 76) + ')';
      if (n < r.need) bad.push(rec + '   【只传 ' + n + '/' + r.need + '】'); else good.push(rec);
    }
  }
  console.log('✅ 传够 ' + good.length + ' 处：');
  good.forEach(g => console.log('   ' + g));
  console.log('⛔ 少传 ' + bad.length + ' 处：');
  bad.forEach(b => console.log('   ' + b));
}
