'use strict';
// jy 轮守门：K线面板后续——MA60 中长期均线正确返回。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');

function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j + end.length);
}

const parts = [
  grab('function klineMaOf(rows) {', '\n}\n// 信号类型'),
];

const code = parts.join('\n');
const S = {};
const A = {};
const api = new Function('S', 'A', code + '\nreturn { klineMaOf };')(S, A);

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name); }
}

// 构造 70 根收盘价递增的K线
const rows = [];
for (let i = 1; i <= 70; i++) rows.push({ close: i });
const ma = api.klineMaOf(rows);

ok('klineMaOf 返回 ma60 字段', ma && Array.isArray(ma.ma60));
ok('ma60 长度与输入一致', ma.ma60.length === 70);
ok('ma60 前 59 位为 null（数据不足）', ma.ma60.slice(0, 59).every(v => v === null));
ok('ma60 第 60 位有值', ma.ma60[59] != null);
// 第60位 = (1+2+...+60)/60 = 30.5
ok('ma60 第 60 位计算正确', Math.abs(ma.ma60[59] - 30.5) < 1e-9);
ok('ma5/ma10/ma20 仍保留', Array.isArray(ma.ma5) && Array.isArray(ma.ma10) && Array.isArray(ma.ma20));

console.log(`\n──── 结果：${passed} 通过 / ${failed} 失败 ────\n`);
process.exit(failed ? 1 : 0);
