// dr 轮第一遍：系统说的数字，用户会怎么读 —— 「相对什么」写没写
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');
const lines = src.split('\n').filter(l => !l.startsWith('const APP_VER = '));

// ── A. 百分比表述：涨/跌/收益/最高/最低/涨幅 + % ──────────────────────────
console.log('=== A. 涨幅/收益类百分比表述（有没有说相对什么）===');
const A = [];
lines.forEach((l, i) => {
  if (!/%/.test(l)) return;
  if (!/涨|跌|收益|最高|最低|涨幅|跌幅|回撤|空间|幅度/.test(l)) return;
  if (!/\$\{|toFixed|\+/.test(l)) return;
  A.push({ n: i + 1, l: l.trim().slice(0, 170) });
});
console.log('A 类合计: ' + A.length + '（抽样 35）');
A.slice(0, 35).forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l));

// ── B. 「相对什么」的说明词 ───────────────────────────────────────────────
console.log('\n=== B. 文案里出现「相对/较/比/自/以来/昨收/成本」的说明 ===');
const B = [];
lines.forEach((l, i) => {
  if (/相对|较之|比上|自.*以来|昨收|成本价|买入价|较昨/.test(l) && /\$\{|%/.test(l)) B.push({ n: i + 1, l: l.trim().slice(0, 160) });
});
console.log('B 类合计: ' + B.length);
B.forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l));

// ── C. 「今日/当日」标签 vs 数据实际时刻 ──────────────────────────────────
console.log('\n=== C. 写「今日/当日/今天」的地方（数据是哪个时刻的）===');
const C = [];
lines.forEach((l, i) => {
  if (/今日|当日|今天/.test(l) && /\$\{|S\.[a-z]/.test(l)) C.push({ n: i + 1, l: l.trim().slice(0, 160) });
});
console.log('C 类合计: ' + C.length + '（抽样 30）');
C.slice(0, 30).forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l));

// ── D. 单位混用：同一句话里既有万又有亿 ───────────────────────────────────
console.log('\n=== D. 同一行既有「万」又有「亿」 ===');
const D = [];
lines.forEach((l, i) => {
  if (/万/.test(l) && /亿/.test(l) && /\$\{/.test(l)) D.push({ n: i + 1, l: l.trim().slice(0, 170) });
});
console.log('D 类合计: ' + D.length);
D.slice(0, 20).forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l));

// ── E. 区间 vs 点值：「最高/最低/最大/峰值」有没有说区间 ──────────────────
console.log('\n=== E. 最高/最低/峰值（区间还是点值？有没有标窗口）===');
const E = [];
lines.forEach((l, i) => {
  if (/最高|最低|峰值|最大|最小|peak/.test(l) && /\$\{|toFixed/.test(l)) E.push({ n: i + 1, l: l.trim().slice(0, 165) });
});
console.log('E 类合计: ' + E.length + '（抽样 25）');
E.slice(0, 25).forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l));

// ── F. 百分比点 vs 百分比：gap/差/点 的表述 ───────────────────────────────
console.log('\n=== F. 「点/个百分点」表述（百分比点 ≠ 百分比）===');
const F = [];
lines.forEach((l, i) => {
  if (/(个点|百分点|\}点|低\$\{|高\$\{)/.test(l) && /\$\{/.test(l)) F.push({ n: i + 1, l: l.trim().slice(0, 165) });
});
console.log('F 类合计: ' + F.length);
F.slice(0, 20).forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l));

// ── G. 前端面板：数字旁边有没有单位/基准说明 ──────────────────────────────
const html = fs.readFileSync('public/index.html', 'utf8');
const H = html.split('\n').filter(l => !l.startsWith('const APP_VER = '));
console.log('\n=== G. 前端「今日/当日」标签 ===');
const G = [];
H.forEach((l, i) => {
  if (/今日|当日|今天/.test(l) && /\$\{/.test(l)) G.push({ n: i + 1, l: l.trim().slice(0, 160) });
});
console.log('G 类合计: ' + G.length);
G.slice(0, 20).forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l));
