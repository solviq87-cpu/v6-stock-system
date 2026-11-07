// dp 轮第三遍：哪些字段的「取不到给 0」里，0 其实不是中性值 —— 按字段分组统计
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');
const stripC = (l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; };
const lines = src.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);

// 0 是中性（无 = 零量）的字段：这类给 0 没问题
const OK_ZERO = new Set(['mainInflow', 'mainPct', 'zt90', 'turnover', 'superNet', 'bigNet', 'midNet', 'smallNet',
  'pct', 'delta', 'volume', 'amount', 'n', 'hit', 'days', 'main', 'big', 'super', 'sealAmount', 'fund3dSum', 'count']);
// 0 是最差档 / 最高档（不是中性）的字段
const BAD_ZERO = new Set(['score', 'prob', 'profitRatio', 'rate', 'riseProb', 'hitRate', 'conf', 'confidence',
  'winRate', 'probC', 'probRaw', 'strength', 'quality', 'health', 'breadth']);

const stat = {};
lines.forEach((l, i) => {
  const re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\|\|\s*0\b/g;
  let m;
  while ((m = re.exec(l)) !== null) {
    const f = m[1].split('.').pop();
    if (!stat[f]) stat[f] = { n: 0, kind: OK_ZERO.has(f) ? 'ok' : BAD_ZERO.has(f) ? 'BAD' : '?', lines: [] };
    stat[f].n++;
    if (stat[f].lines.length < 3) stat[f].lines.push(i + 1);
  }
});

const rows = Object.entries(stat).sort((a, b) => b[1].n - a[1].n);
console.log('=== 参与「取不到给 0」的字段（按次数） ===');
console.log('字段'.padEnd(18) + '次数'.padEnd(6) + '判定');
rows.slice(0, 45).forEach(([f, v]) => {
  console.log(f.padEnd(18) + String(v.n).padEnd(6) + (v.kind === 'BAD' ? '⛔ 0 不是中性' : v.kind === 'ok' ? 'ok（0=零量）' : '? 待判'));
});

console.log('\n=== ⛔ 命中「0 不是中性」的字段明细 ===');
let bad = 0;
rows.filter(([f, v]) => v.kind === 'BAD').forEach(([f, v]) => {
  bad += v.n;
  console.log('\n-- ' + f + '（' + v.n + ' 处）行 ' + v.lines.join(','));
  v.lines.forEach(ln => console.log('   ' + src.split('\n')[ln - 1].trim().slice(0, 150)));
});
console.log('\nBAD 合计: ' + bad + ' 处');

console.log('\n=== ? 待判字段（出现 >=3 次的） ===');
rows.filter(([f, v]) => v.kind === '?' && v.n >= 3).forEach(([f, v]) => {
  console.log('-- ' + f + '（' + v.n + ' 处）行 ' + v.lines.join(','));
  v.lines.forEach(ln => console.log('   ' + src.split('\n')[ln - 1].trim().slice(0, 150)));
});

// 专门看：概率类字段被 || 0 后参与比较（推送门槛）—— 取不到等于「0% 概率」= 永不推送
console.log('\n=== 概率类字段被 || 0 后参与比较 ===');
let pc = 0;
lines.forEach((l, i) => {
  if (/\b(prob|probC|probRaw|riseProb|hitRate|rate)\b\s*\|\|\s*0/.test(l) && /[<>]=?/.test(l)) {
    pc++; console.log(String(i + 1).padStart(6) + '  ' + l.trim().slice(0, 160));
  }
});
console.log('合计: ' + pc);
