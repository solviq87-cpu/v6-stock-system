'use strict';
// 涨停复盘·详细原因单测（2026-10-09 fv 轮）：用户要求「涨停复盘详细标明涨停原因，可从同花顺拉」。
// ztThemesOf 从涨停股抽取同花顺详细题材词（优先 z.themes，兜底切分原始 reason）。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到起始: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j);
}
const fnSrc = grab('function ztThemesOf(z)', 'async function sectorSurgeScan');
const ztThemesOf = new Function(fnSrc + '\nreturn ztThemesOf;')();

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// ① 优先用已归并的 z.themes
ok('优先返回 z.themes', JSON.stringify(ztThemesOf({ themes: ['固态电池', '液冷服务器'], reason: '光伏' })) === JSON.stringify(['固态电池', '液冷服务器']));
// ② 兜底切分原始 reason（同花顺 reason_type 用 + 连接多题材）
ok('切分 + 连接的多题材', JSON.stringify(ztThemesOf({ reason: '固态电池+液冷服务器+水处理' })) === JSON.stringify(['固态电池', '液冷服务器', '水处理']));
// ③ 过滤单字/空（A 长度1被丢，电池/传媒保留）
ok('过滤单字题材', JSON.stringify(ztThemesOf({ reason: 'A+电池+传媒' })) === JSON.stringify(['电池', '传媒']));
// ④ 剥离引号
ok('剥离引号', JSON.stringify(ztThemesOf({ reason: '"固态电池"' })) === JSON.stringify(['固态电池']));
// ⑤ 无 reason 且无 themes → 空数组
ok('无原因返回空', ztThemesOf({}).length === 0);
// ⑥ z 为 null/undefined 不崩
ok('null/undefined 不崩返回空', ztThemesOf(null).length === 0 && ztThemesOf(undefined).length === 0);

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
