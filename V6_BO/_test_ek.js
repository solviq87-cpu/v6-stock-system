// 守门：ek 轮 —— 前端面板与后端计算同步机制
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 前端面板与后端计算同步机制（ek 轮）守门 ===\n');

// ---------- ① kick 触发 SSE ----------
console.log('【① kick 触发 SSE 更新】');
ok('kick 函数存在', /function kick\(/.test(SRC));
ok('kick 调用 sseSendEdit', /function kick\([\s\S]*?sseSendEdit/.test(SRC));
ok('kick 有 setTimeout 后台重算', /function kick\([\s\S]*?setTimeout/.test(SRC));

// ---------- ② SSE 双通道 ----------
console.log('\n【② SSE 广播 vs 私密通道】');
ok('sseSend 存在', /function sseSend\(/.test(SRC));
ok('sseSendEdit 存在', /function sseSendEdit\(/.test(SRC));
ok('sseSend 走 SSE 集合', /sseSend\(.*SSE/.test(SRC) || /_write\(SSE/.test(SRC));
ok('sseSendEdit 走 SSE_EDIT 集合', /sseSendEdit\(.*SSE_EDIT/.test(SRC) || /_write\(SSE_EDIT/.test(SRC));

// ---------- ③ /api/refresh 回传 skipped ----------
console.log('\n【③ /api/refresh 回传被跳过模块】');
const refreshMatch = SRC.match(/if\s*\(\s*p\s*===\s*['"]\/api\/refresh['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]\s*\)/);
if (refreshMatch) {
  const start = refreshMatch.index;
  let d = 0, block = '', started = false;
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { block = SRC.slice(start, j + 1); break; } }
  }
  ok('/api/refresh 回传 skipped', /skipped/.test(block));
  ok('/api/refresh 回传 note', /note/.test(block));
  ok('/api/refresh 回传 errors', /errors/.test(block));
} else {
  ok('/api/refresh 回传 skipped', false, '找不到 /api/refresh POST');
  ok('/api/refresh 回传 note', false, '找不到 /api/refresh POST');
  ok('/api/refresh 回传 errors', false, '找不到 /api/refresh POST');
}

// ---------- ④  holdings 变更触发 kick ----------
console.log('\n【④ 持仓变更触发面板刷新】');
ok('/api/holdings POST 成功后 kick', /kick\(\).*\n.*if.*rr\.ok|if.*rr\.ok.*kick\(\)/.test(SRC) || /rr\.ok.*\{[^}]*kick\(\)/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
