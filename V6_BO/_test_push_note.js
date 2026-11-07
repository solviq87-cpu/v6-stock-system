/**
 * 守门测试：/api/push-note 的「私密推送」开关（gl 轮，2026-10-12 用户原话「私密推送我」）
 *
 * 背景：用户要看一份只到自己手里的大盘结构研判。系统里所有定时推送都支持 private:true
 *   （配了私密机器人就只发私密、不再往群里发），唯独 /api/push-note 这条"开发者手动推一条"
 *   的入口写死了走主机器人（群）—— 想让内容只到本人手里，没有任何入口。
 *
 * 本测试钉四件事：
 *   ① private 是**显式 opt-in**：b.private === true，默认 false（不给老调用方换收件人）
 *   ② private 真的传进了 pushAll（不是声明了没用）
 *   ③ 原有闸门一行没少：requireEditor 鉴权 / 正文 4000 字上限 / 标题 40 字上限 / 空正文拒绝
 *   ④ 反证：把 private 传参删掉 → 断言必须红（证明不是在钉空气）
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
// 剥注释（本项目已知坑：两条正则硬删会吞真代码，这里用逐字符状态机）
function strip(src) {
  let out = '', st = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1] || '';
    if (st === 'code') {
      if (c === '/' && n === '/') { st = 'line'; i++; continue; }
      if (c === '/' && n === '*') { st = 'block'; i++; continue; }
      if (c === "'") { st = 'sq'; out += c; continue; }
      if (c === '"') { st = 'dq'; out += c; continue; }
      if (c === '`') { st = 'tpl'; out += c; continue; }
      out += c; continue;
    }
    if (st === 'line') { if (c === '\n') { st = 'code'; out += c; } continue; }
    if (st === 'block') { if (c === '*' && n === '/') { st = 'code'; i++; } continue; }
    if (st === 'sq') { out += c; if (c === '\\') { out += src[++i] || ''; continue; } if (c === "'") st = 'code'; continue; }
    if (st === 'dq') { out += c; if (c === '\\') { out += src[++i] || ''; continue; } if (c === '"') st = 'code'; continue; }
    if (st === 'tpl') { out += c; if (c === '\\') { out += src[++i] || ''; continue; } if (c === '`') st = 'code'; continue; }
  }
  return out;
}
const SRC = strip(SV);

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== /api/push-note 私密推送开关守门 ===\n');

// 取 /api/push-note 路由体（花括号配平，不许固定行号窗口）
const ROUTE = 'if (p === \'/api/push-note\' && req.method === \'POST\') {';
const rStart = SRC.indexOf(ROUTE);
ok(rStart >= 0, '能定位 /api/push-note 路由');
let rEnd = -1;
if (rStart >= 0) {
  let d = 0;
  for (let j = SRC.indexOf('{', rStart); j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (d === 0) { rEnd = j + 1; break; } }
  }
}
const body = (rStart >= 0 && rEnd > rStart) ? SRC.slice(rStart, rEnd) : '';
ok(body.length > 200, '能取到 push-note 完整路由体', 'len=' + body.length);

console.log('\n【① private 是显式 opt-in】');
ok(/nPriv\s*=\s*b\.private\s*===\s*true/.test(body),
  'private 由请求体显式打开（b.private === true），不是默认就走私密');
ok(/let nTok = '', text = '', title = '📢 通知', nPriv = false/.test(body) ||
   /nPriv\s*=\s*false/.test(body),
  'nPriv 默认 false —— 不给老调用方换收件人（行为不变）');

console.log('\n【② private 真的传进了 pushAll】');
// ⛔ 2026-10-28 改钉：force 以前写死 true（无条件穿透夜间静默，实测 00:39-08:23 外发 24 条），
//    现在第二参是 nForce（默认 false，调用方显式传 force:true 才穿透）。判据钉语义：
//    ① 第三参必须带 private: nPriv（private 真的接进去了）；
//    ② 第二参必须是变量 nForce 而不是字面量 true（写死 true = 夜间静默永久失效）。
ok(/pushAll\(`═══ \$\{title\} ═══\\n\$\{text\}`, nForce, \{ manual: true, private: nPriv \}\)/.test(body),
  'pushAll 收到 { manual: true, private: nPriv }（声明了不用 = 没接）');
ok(/nForce = b\.force === true;/.test(body) && !/pushAll\(`═══ \$\{title\} ═══\\n\$\{text\}`, true,/.test(body),
  'force 默认 false（不许写死 true 穿透夜间静默）');
ok(/private: nPriv/.test(body) && !/pushAll\([^)]*\{ manual: true \}\)/.test(body),
  '没有残留"只传 manual"的旧调用（否则 private 是个没人看的参数）');

console.log('\n【③ 原有闸门一行没少】');
ok(/if \(!requireEditor\(res, nTok, req\)\) return;/.test(body),
  'requireEditor 鉴权还在（这条是直接推到手机的，不许裸奔）');
ok(/String\(b\.text \|\| ''\)\.slice\(0, 4000\)/.test(body),
  '正文仍封顶 4000 字（飞书单条有上限，超了整条发不出去）');
ok(/String\(b\.title \|\| title\)\.slice\(0, 40\)/.test(body),
  '标题仍封顶 40 字');
ok(/if \(!text\.trim\(\)\) return json\(res, \{ ok: false, error: 'text 不能为空' \}\);/.test(body),
  '空正文仍被拒绝');
ok(/private: nPriv \}/.test(body) && /"private":\s*nPriv|private: nPriv\s*\}/.test(body),
  '返回值带 private 字段（调用方能确认这条到底走了哪条通道）');

console.log('\n【④ 反证：把 private 传参删掉，断言必须红】');
{
  // 精确反证：只剥掉 pushAll 的 private 传参与返回值的 private 字段，
  // 然后确认 pushAll 的 opts 里再也没有 private（证明②不是恒绿）。
  const broken = body.replace(/, private: nPriv/g, '');
  ok(/pushAll\([^)]*\{ manual: true \}\)/.test(broken) && !/pushAll\([^)]*private/.test(broken),
    '反证：删掉 private 传参后 pushAll 的 opts 里再也找不到它（证明②不是恒绿）');
}

console.log('\n合计 ' + (pass + fail) + ' 项：通过 ' + pass + '、失败 ' + fail + '\n');
process.exit(fail === 0 ? 0 : 1);
