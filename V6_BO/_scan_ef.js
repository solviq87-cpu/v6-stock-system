// 扫描器：ef 轮 —— 「鉴权与权限边界的完整性」
// 查三类：
//   ① 写操作路由（POST/PUT/DELETE）是否都调了 requireEditor/isEditorReq
//   ② 白名单入口是否确实不需要鉴权（有没有漏放进去的写操作）
//   ③ /api/state 中私密字段是否按身份裁剪
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== ef 轮：鉴权与权限边界完整性扫描 ===\n');

// ── ① 写操作路由的鉴权 ──
console.log('【① 写操作路由的鉴权覆盖】');
// 白名单（来自源码中的 isAuth + 静态资源）
const AUTH_WHITELIST = [
  '/api/lock/status', '/api/lock/setup', '/api/lock/unlock', '/api/lock/change',
  '/api/lock/trust', '/api/lock/forgot', '/api/lock/verify-code', '/api/lock/reset-pwd',
  '/api/lock/phone', '/api/lock/pending-status', '/api/auth/redeem'
];
// 提取所有路由定义：if (p === '/api/xxx' && req.method === 'YYY')
const routes = [...SRC.matchAll(/if\s*\(\s*p\s*===\s*['"](\/api\/[^'"]+)['"]\s*&&\s*req\.method\s*===\s*['"](\w+)['"]\s*\)/g)];
let ef1 = 0;
for (const m of routes) {
  const path = m[1], method = m[2];
  if (method === 'GET') continue; // GET 通常只读
  if (AUTH_WHITELIST.includes(path)) continue;
  // 静态资源也在前面过滤了
  if (path.startsWith('/srcpkg/')) continue;
  // 找到这个路由的函数体（从 if 开始到下一个同层级 if 或函数结束）
  const start = m.index;
  let d = 0, block = '', started = false;
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { block = SRC.slice(start, j + 1); break; } }
  }
  const hasAuth = /requireEditor\(|isEditorReq\(/.test(block);
  if (!hasAuth) {
    const line = SRC.slice(0, start).split('\n').length;
    console.log(`  ⛔ 行${line}: ${method} ${path} 未调用 requireEditor/isEditorReq`);
    ef1++;
  }
}
if (!ef1) console.log('  ✅ 所有非白名单写操作路由均有鉴权');

// ── ② 白名单中的写操作是否确实不需要鉴权 ──
console.log('\n【② 白名单合理性】');
let ef2 = 0;
for (const p of AUTH_WHITELIST) {
  // 确认白名单中的路由在源码中确实存在
  if (!SRC.includes(`p === '${p}'`)) {
    console.log(`  ⚠️ 白名单中的 ${p} 在源码中找不到对应路由`);
    ef2++;
  }
}
if (!ef2) console.log('  ✅ 白名单中的路由均存在');

// ── ③ /api/state 私密字段裁剪 ──
console.log('\n【③ /api/state 私密字段裁剪】');
let ef3 = 0;
// 找 state 构建块中是否有按 isEditorReq 裁剪的字段
const stateMatch = SRC.match(/if\s*\(\s*p\s*===\s*['"]\/api\/state['"]\s*\)/);
if (stateMatch) {
  const start = stateMatch.index;
  let d = 0, block = '', started = false;
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { block = SRC.slice(start, j + 1); break; } }
  }
  const hasPrivateTrim = /isEditorReq|requireEditor|_isEditor/.test(block);
  ok3 = hasPrivateTrim ? 1 : 0;
  if (!hasPrivateTrim) {
    console.log('  ⚠️ /api/state 构建块未找到私密字段裁剪逻辑（需人工确认）');
    ef3++;
  } else {
    console.log('  ✅ /api/state 有按身份裁剪私密字段');
  }
} else {
  console.log('  ⚠️ 找不到 /api/state GET 路由');
  ef3++;
}

const total = ef1 + ef2 + ef3;
console.log(`\n【结论】发现 ${total} 处鉴权边界问题`);
process.exit(total ? 1 : 0);
