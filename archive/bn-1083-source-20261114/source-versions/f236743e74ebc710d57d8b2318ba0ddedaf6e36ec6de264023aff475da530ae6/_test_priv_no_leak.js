#!/usr/bin/env node
/**
 * 守门：私密推送失败不得退回公开群（_test_priv_no_leak.js，2026-10-28）
 *
 * 事故（2026-10-28 09:16-09:17，实测流水 channel='飞书(退回)' 8 条）：
 *   早盘私密机器人被飞书限频 → pushAll 私密分支【明确拒绝也退回群机器人】，
 *   于是「竞价共振 TOP3」「封板哨兵」「板块暴动」这些本该只本人可见的行情内容
 *   被实实在在发进了公开群。根因是那条兜底（原为验证码时效性设计）对所有 private 消息生效。
 *
 * 用户铁律：所有推送默认走私密通道，发群必须在调用点显式 {public:true}。
 *   私密失败退回群 = 未经显式同意的外发，比「今天少推一条」严重得多（宁可不推，不可错推）。
 *
 * 本守门钉死：
 *   A. 私密分支两条失败路径（明确拒绝 / 代码级异常）都必须先过 `opts.mustDeliver` 门；
 *   B. 非 mustDeliver 的不外发分支必须 _release（退回额度/去重，下一轮继续走私密补推）；
 *   C. mustDeliver 只准出现在验证码类调用点（secText / 登录授权码），防被滥用作"想发群就带上"。
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ← ' + extra : '')); }
}

// 按大括号配对抓 pushAll 的私密分支（显式锚点，不靠"吞到下一个顶层 }"）
function grabBrace(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return '';
  let depth = 0, seen = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

const priv = grabBrace(src, 'if (opts && opts.private && privReady()) {');
console.log('\n=== A. 私密分支两条失败路径都要过 mustDeliver 门 ===');
ok('抓到私密分支代码段', priv.length > 500, '长度=' + priv.length);
ok('明确拒绝分支有 mustDeliver 门', /if\s*\(!\s*\(opts\s*&&\s*opts\.mustDeliver\)\)/.test(priv));
ok('门出现两次（拒绝 + 异常路径）', (priv.match(/if\s*\(!\s*\(opts\s*&&\s*opts\.mustDeliver\)\)/g) || []).length === 2,
  '实际=' + (priv.match(/if\s*\(!\s*\(opts\s*&&\s*opts\.mustDeliver\)\)/g) || []).length);

console.log('\n=== B. 旧写法反证（不加门就退回群 → 失守）===');
// 旧写法：紧跟着 console.error('[priv] ... 退回群机器人') 后直接 feishuSend，中间没有 mustDeliver 门
ok('不存在「无条件退回群」的 feishuSend 直通写法',
  !/\[priv\][^\n]*退回群机器人:'[^\n]*\n\s*pushLog\([^\n]*\n\s*feishuSend\(/.test(priv));
ok('非 mustDeliver 分支会 _release（避免当天永久丢条）',
  /_release\('私密通道拒收且按私密策略不外发'\)/.test(priv) && /_release\('私密通道异常且按私密策略不外发'\)/.test(priv));
ok('非 mustDeliver 分支记流水「私密未送达·不外发」',
  (priv.match(/🔒 私密未送达·不外发/g) || []).length >= 2);

console.log('\n=== C. mustDeliver 只用在验证码类（防滥用）===');
const allMust = src.match(/mustDeliver:\s*true/g) || [];
ok('mustDeliver:true 调用点恰好 4 处（3 处找回验证码 + 1 处登录授权码）', allMust.length === 4, '实际=' + allMust.length);
ok('登录授权码带 mustDeliver', /登录授权码[\s\S]{0,260}mustDeliver:\s*true/.test(src));
ok('找回验证码 secText 带 mustDeliver', /pushAll\(secText,[^\n]*mustDeliver:\s*true\s*\}\)/.test(src));
// 行情类调用点绝不允许带 mustDeliver（否则等于给自己开后门往群里发）
const risky = ['封板哨兵', '板块暴动', '竞价共振', '冲板预警', '起涨哨兵', '每日复盘', '模拟盘动态'];
risky.forEach(k => {
  const re = new RegExp('pushAll\\(`[^`]*' + k + '[\\s\\S]{0,400}?mustDeliver:\\s*true');
  ok('行情类「' + k + '」不带 mustDeliver', !re.test(src));
});

console.log('\n=== D. 私密永远优先于群（原有语义不许被改坏）===');
ok('私密分支结尾仍 return true（绝不再往下走群+邮箱）', /return true;[\s\S]{0,120}?绝不再往下走群机器人/.test(priv) || /绝不再往下走群机器人/.test(priv));

console.log('\n=== E. push-note 不再默认穿透夜间静默（半夜骚扰防线）===');
const pn = grabBrace(src, "p === '/api/push-note'");
ok('抓到 push-note 代码段', pn.length > 200, '长度=' + pn.length);
ok('force 取自请求体（b.force === true）', /nForce\s*=\s*b\.force\s*===\s*true/.test(pn));
ok('旧写法反证：pushAll 的 force 不再是写死 true',
  !/pushAll\(`═══ \$\{title\} ═══\\n\$\{text\}`, true,/.test(pn));
ok('pushAll 的 force 参数用 nForce', /pushAll\([^)]*nForce,\s*\{\s*manual:\s*true/.test(pn));
ok('响应体回报 force 实况（可排障）', /force:\s*nForce/.test(pn));

console.log('\n' + (fail === 0
  ? `✅ 私密不外泄守门：${pass} 通过 / 0 失败`
  : `❌ 私密不外泄守门：${pass} 通过 / ${fail} 失败`));
process.exit(fail === 0 ? 0 : 1);
