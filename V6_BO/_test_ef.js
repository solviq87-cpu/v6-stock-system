// 守门：ef 轮 —— 鉴权与权限边界的完整性
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 鉴权与权限边界完整性（ef 轮）守门 ===\n');

// ---------- ① requireEditor / isEditorReq 定义规范 ----------
console.log('【① requireEditor / isEditorReq 定义】');
ok('isEditorReq 存在', /function isEditorReq\(/.test(SRC));
ok('isEditorReq 用 req.__tok 兜底', /req\.__tok/.test(SRC));
ok('requireEditor 存在', /function requireEditor\(/.test(SRC));
ok('requireEditor 返回 false 时已写响应', /json\(res,\s*\{[^}]*locked:\s*true/.test(SRC));

// ---------- ② isLocalReq 只看 socket 地址 ----------
console.log('\n【② isLocalReq 本机判据】');
const localMatch = SRC.match(/function isLocalReq\(req\)\s*\{([\s\S]*?)\n\}/);
const localBody = localMatch ? localMatch[1] : '';
ok('isLocalReq 存在', localBody.length > 20);
ok('isLocalReq 不采信 x-forwarded 头',
  !/x-forwarded-for|x-real-ip/.test(localBody) || /remoteAddress/.test(localBody),
  '本机判据若看请求头可被客户端伪造');

// ---------- ③ 白名单完整 ----------
console.log('\n【③ 白名单完整性】');
const wlMatch = SRC.match(/const isAuth\s*=\s*([\s\S]*?)(?:;|\n\s*if\s*\()/);
ok('isAuth 白名单存在', !!wlMatch);
if (wlMatch) {
  const wlBody = wlMatch[1];
  const expected = ['status','setup','unlock','change','trust','forgot','verify-code','reset-pwd','phone','pending-status','redeem'];
  for (const k of expected) {
    ok(`白名单包含 ${k}`, wlBody.includes(k));
  }
}

// ---------- ④ /api/state 私密字段裁剪 ----------
console.log('\n【④ /api/state 私密字段裁剪】');
// 私密字段：holdings / paper 等只读不能看
ok('/api/state 有 isEditorReq 裁剪',
  /if\s*\(\s*p\s*===\s*['"]\/api\/state['"]\s*\)/.test(SRC));
// 更精确：state 块里 holdings/paper 是否被条件包裹
const stateBlockMatch = SRC.match(/if\s*\(\s*p\s*===\s*['"]\/api\/state['"]\s*\)\s*\{/);
if (stateBlockMatch) {
  const start = SRC.indexOf(stateBlockMatch[0]);
  let d = 0, block = '', started = false;
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { block = SRC.slice(start, j + 1); break; } }
  }
  // holdings 不在 /api/state 返回体中（独立路由 /api/holdings 有鉴权），注释中提到不算
  ok('holdings 不在 state 返回键中（独立路由已鉴权）', !/holdings\s*:/.test(block));
  // paper 用 _stEdit（即 isEditorReq）裁剪
  ok('state 块里 paper 用 _stEdit 裁剪', /_stEdit/.test(block) && /paper:\s*_stEdit/.test(block));
} else {
  ok('state 块里 holdings 有条件保护', false, '找不到 /api/state 块');
  ok('state 块里 paper 有条件保护', false, '找不到 /api/state 块');
}

// ---------- ⑤ 门禁在路由处理之前 ----------
console.log('\n【⑤ 门禁顺序】');
const handleMatch = SRC.match(/function handle\(req, res, u, body\)\s*\{([\s\S]*?)\n\}/);
const handleBody = handleMatch ? handleMatch[1] : '';
ok('handle 函数存在', handleBody.length > 50);
if (handleBody) {
  const authIndex = handleBody.indexOf('isAuth');
  const routeIndex = handleBody.indexOf("p === '/api/");
  ok('门禁（isAuth）在路由分发之前', authIndex >= 0 && routeIndex >= 0 && authIndex < routeIndex,
    '门禁必须在路由处理之前，否则写操作路由先执行再鉴权');
}

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
