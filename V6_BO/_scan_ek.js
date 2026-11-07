// 扫描器：ek 轮 —— 「前端面板与后端计算的同步机制」
// 查三类：
//   ① kick() 是否触发 SSE 更新
//   ② sseSend/sseSendEdit 是否正确区分广播与私密
//   ③ /api/refresh 响应是否回传被跳过模块的信息
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== ek 轮：前端面板与后端计算同步机制扫描 ===\n');

// ── ① kick 触发 SSE ──
console.log('【① kick 触发 SSE 更新】');
let ek1 = 0;
if (!/function kick\(/.test(SRC)) {
  console.log('  ⛔ kick() 不存在');
  ek1++;
} else {
  const kickMatch = SRC.match(/function kick\(\)\s*\{([\s\S]*?)\n\}/);
  const kickBody = kickMatch ? kickMatch[1] : '';
  if (!/sseSendEdit/.test(kickBody)) {
    console.log('  ⛔ kick() 未调用 sseSendEdit');
    ek1++;
  }
}
if (!ek1) console.log('  ✅ kick() 存在且触发 SSE');

// ── ② sseSend 与 sseSendEdit 区分 ──
console.log('\n【② sseSend 广播 vs sseSendEdit 私密】');
let ek2 = 0;
if (!/function sseSend\(/.test(SRC)) {
  console.log('  ⛔ sseSend 不存在');
  ek2++;
}
if (!/function sseSendEdit\(/.test(SRC)) {
  console.log('  ⛔ sseSendEdit 不存在');
  ek2++;
}
if (!ek2) console.log('  ✅ sseSend 与 sseSendEdit 均存在');

// ── ③ /api/refresh 回传 skipped ──
console.log('\n【③ /api/refresh 回传被跳过模块】');
let ek3 = 0;
const refreshMatch = SRC.match(/if\s*\(\s*p\s*===\s*['"]\/api\/refresh['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]\s*\)/);
if (refreshMatch) {
  const start = refreshMatch.index;
  let d = 0, block = '', started = false;
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { block = SRC.slice(start, j + 1); break; } }
  }
  if (!/skipped/.test(block)) {
    console.log('  ⛔ /api/refresh 未回传 skipped 字段');
    ek3++;
  }
} else {
  console.log('  ⛔ 找不到 /api/refresh POST');
  ek3++;
}
if (!ek3) console.log('  ✅ /api/refresh 回传 skipped 信息');

const total = ek1 + ek2 + ek3;
console.log(`\n【结论】发现 ${total} 处同步机制问题`);
process.exit(total ? 1 : 0);
