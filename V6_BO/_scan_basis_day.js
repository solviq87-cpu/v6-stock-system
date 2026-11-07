// 扫描器：谁在拿「K 线最后一根」当现价 / 涨幅？（本轮角度：模块之间的隐式执行顺序依赖）
//
// 这类写法的隐含前提是「K 线缓存已经回填到今天了」，而这个前提由另一路独立的定时器
// klineBackfill 负责 —— 没有任何机制保证它先跑完（盘中 9:15~15:10 甚至完全不补）。
// 一旦没跟上，下面这些位置给出的价就是上一交易日的，和同屏的实时行情对不上。
// 本扫描器只做清单，供人工逐条判断：是不是「展示给用户的价」？是就必须带日期标注。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const LINES = SV.split('\n');

// 取 K 线最后一根的典型写法
const PATTERNS = [
  { re: /rows\.length\s*-\s*1/, tag: 'rows[length-1]' },
  { re: /\.at\(-1\)/, tag: 'at(-1)' },
  { re: /rows\[rows\.length\s*-\s*1\]/, tag: 'rows[rows.length-1]' },
  { re: /last\(\s*rows\s*\)/, tag: 'last(rows)' },
  { re: /kl\[kl\.length\s*-\s*1\]/, tag: 'kl[length-1]' },
  { re: /k\.rows\.length\s*-\s*1/, tag: 'k.rows[length-1]' }
];

const HITS = new Map();
LINES.forEach((ln, i) => {
  const s = ln.trim();
  if (!s || s.charAt(0) === '/' || s.charAt(0) === '*') return;
  for (const p of PATTERNS) {
    if (!p.re.test(ln)) continue;
    const key = (i + 1) + '|' + p.tag;
    if (!HITS.has(key)) HITS.set(key, { line: i + 1, tag: p.tag, code: s.slice(0, 150) });
  }
});

// 已知「已标注基准日」的三个扫描器（有 basisOf / basisLine 保护）
const ANNOTATED = ['scanZtPre', 'scanTrendUniverse', 'scanSteadyUp'];
function enclosingFn(lineNo) {
  let name = '';
  for (let i = lineNo - 1; i >= 0; i--) {
    const m = LINES[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (m) { name = m[1]; break; }
  }
  return name;
}

console.log(`\n===== 拿「K线最后一根」当现价的位置：共 ${HITS.size} 处 =====\n`);
let annotated = 0, plain = 0;
for (const h of [...HITS.values()].sort((a, b) => a.line - b.line)) {
  const fn = enclosingFn(h.line);
  const isAnn = ANNOTATED.indexOf(fn) >= 0;
  if (isAnn) annotated++; else plain++;
  console.log(`${isAnn ? '[已标注基准日]' : '[  待人工复核 ]'} L${h.line}  ${fn || '(顶层/箭头)'}  ${h.tag}`);
  console.log(`     ${h.code}`);
}
console.log(`\n已标注 ${annotated} 处 / 待复核 ${plain} 处`);
console.log('判定口径：待复核的若是「展示给用户或参与下单的价格/涨幅」，必须补基准日标注；');
console.log('          只用于形态统计（回测、学习、打分）的可以不做，但文案里不许说成「现在」。');
