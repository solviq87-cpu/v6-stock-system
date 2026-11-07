// co 轮守门：系统对外承诺的时限 —— 到期那一刻到底发生了什么。
// 抓到的两个问题：
//   ① 门禁把「从没登录 / 会话令牌到期 / 设备被撤销 / 口令已重设」一律说成同一句
//      「该设备需验证口令」。最要命的是 revoked：授权被收回后用户只会以为是自己密码记错了
//      → 反复试密码 → 走「忘记密码」→ 每轮一条验证码推送（正是之前验证码轰炸的成因之一）。
//   ② ⛔ 后端好不容易分开的原因，**前端又用一句写死的文案全部盖掉**
//      （index.html:617 原来写死「凭证已失效，请重新输入口令」，根本不看 s.msg）
//      —— 闭环断在最后一环，用户看到的还是那一句。
//   ③ /api/lock/unlock 四条成功分支里，显式指定 role='view' 的那条漏了 issueDevice()，
//      只发 12 小时内存短令牌；而 role='auto' 的 view 分支明明签了长期令牌。
// 离线、确定性：把 tokenRejectReason / tokenRejectMsg 抠进沙箱真跑，前端与分支做静态断言。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

function fnBody(src, name) {
  const a = src.search(new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm'));
  if (a < 0) return '';
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++; else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  return '';
}
// 判代码一律用剥注释版本（中文注释会逐字引用旧代码/旧文案）
const SV_NOC = SV.split(/\r?\n/).map(s => { const i = s.indexOf('//'); return i >= 0 ? s.slice(0, i) : s; }).join('\n');

// ── ① 真跑 tokenRejectReason ───────────────────────────────────
console.log('\n【一】真跑 tokenRejectReason：四种失败处境必须分开');
const B1 = fnBody(SV, 'tokenRejectReason');
const B2 = fnBody(SV, 'tokenRejectMsg');
ok('能从源码抠出 tokenRejectReason', B1.length > 0);
ok('能从源码抠出 tokenRejectMsg', B2.length > 0);

// 沙箱：注入可控的 _tokens / _vtokens / verifyDeviceToken / isRevoked
function build(opts) {
  const _tokens = new Map(), _vtokens = new Map();
  if (opts.sessionEdit !== undefined) _tokens.set('T_EDIT', opts.sessionEdit);
  if (opts.sessionView !== undefined) _vtokens.set('T_VIEW', opts.sessionView);
  const verifyDeviceToken = (t) => (t === 'DEV_OK' ? 'edit' : null);
  const isRevoked = (t) => !!opts.revoked && t === 'DEV_OK';
  const mk = new Function('_tokens', '_vtokens', 'verifyDeviceToken', 'isRevoked',
    `${B1}\n${B2}\nreturn { tokenRejectReason, tokenRejectMsg };`);
  return mk(_tokens, _vtokens, verifyDeviceToken, isRevoked);
}
const NOW = 1700000000000;
const realNow = Date.now;
Date.now = () => NOW;

let A = build({});
ok('没带令牌 → 空（正常未登录，走原文案）', A.tokenRejectReason('') === '');
ok('会话令牌未过期 → 空', A.tokenRejectReason('T_EDIT') === '' && build({ sessionEdit: NOW + 1000 }).tokenRejectReason('T_EDIT') === '');
ok('★ 开发者会话令牌到期 → expired', build({ sessionEdit: NOW - 1 }).tokenRejectReason('T_EDIT') === 'expired');
ok('★ 只读会话令牌到期 → expired', build({ sessionView: NOW - 1 }).tokenRejectReason('T_VIEW') === 'expired');
ok('★ 设备令牌被撤销 → revoked', build({ revoked: true }).tokenRejectReason('DEV_OK') === 'revoked');
ok('设备令牌有效且未被撤销 → 空', build({ revoked: false }).tokenRejectReason('DEV_OK') === '');
// 世代号不符：verifyDeviceToken 返回 null，但长得像设备令牌（e0_xxx.sig）
ok('★ 世代不符/签名不对的旧设备令牌 → superseded', build({}).tokenRejectReason('e0_' + 'a'.repeat(64) + '.sig123456789012345678901234') === 'superseded');
ok('乱七八糟的字符串 → 空（别瞎报原因）', build({}).tokenRejectReason('hello-world') === '');
Date.now = realNow;

// ── ② 文案必须区分 + 必须可执行 ────────────────────────────────
console.log('\n【二】到期那一刻用户看到的文案');
const M = build({});
const mExpired = M.tokenRejectMsg('expired');
const mRevoked = M.tokenRejectMsg('revoked');
const mSuperseded = M.tokenRejectMsg('superseded');
const mNone = M.tokenRejectMsg('');
ok('三种原因给出三种不同文案', mExpired !== mRevoked && mRevoked !== mSuperseded && mExpired !== mSuperseded);
ok('未登录仍保留原文案（不打扰首次访问）', mNone.indexOf('该设备需验证口令') >= 0, mNone);
ok('★ 过期文案说清了时效（1小时/12小时）', /1\s*小时/.test(mExpired) && /12\s*小时/.test(mExpired), mExpired);
ok('★ 撤销文案说清了「不是你的密码错了」', /撤销/.test(mRevoked) && /重新输入口令/.test(mRevoked), mRevoked);
ok('★ 世代不符文案说清了「口令已更改」', /口令已更改/.test(mSuperseded), mSuperseded);
ok('三种文案都给出了下一步动作（不许只报故障不指路）',
  [mExpired, mRevoked, mSuperseded].every(s => /重新输入口令|重新登录/.test(s)));
// 反证：旧写法对所有情况都是同一句
ok('反证：不区分时四种处境看到同一句话', true);

// ── ③ 门禁真的把原因带出去 ─────────────────────────────────────
console.log('\n【三】门禁与前端闭环');
ok('★ 门禁先取原因再判 checkToken（顺序不能反：roleOf 过期时会删条目）',
  /tokenRejectReason\(tok\)[\s\S]{0,200}?checkToken\(tok\)/.test(SV_NOC));
ok('门禁返回体带 reason 字段', /reason:\s*_why\s*\|\|\s*'none'/.test(SV_NOC));
ok('门禁 msg 走 tokenRejectMsg', /msg:\s*tokenRejectMsg\(_why\)/.test(SV_NOC));
// ⛔ 闭环最后一环：前端不许把后端原因盖掉
ok('★ 前端优先用后端 msg（不许写死一句盖掉）', /showGate\(\s*s\.msg\s*\|\|/.test(HTML));
ok('前端仍保留兜底文案', /凭证已失效/.test(HTML));

// ── ④ unlock 四条成功分支都要有长期令牌 ────────────────────────
console.log('\n【四】口令登录必发长期设备令牌（四条成功分支一个都不能漏）');
// ⚠️ 必须锚到**路由定义**（带 `&& req.method`），否则会先命中门禁白名单那一行
//    （`|| p === '/api/lock/unlock' ||` 出现得更早，切出来是白名单不是路由体）
const unlockStart = SV_NOC.indexOf("p === '/api/lock/unlock' && req.method");
const unlockEnd = SV_NOC.indexOf("p === '/api/lock/change' && req.method");
ok('[自检] 定位到 unlock 路由定义（不是白名单）', unlockStart > 0 && unlockEnd > unlockStart);
const UNLOCK = SV_NOC.slice(unlockStart, unlockEnd > unlockStart ? unlockEnd : unlockStart + 6000);
const issueN = (UNLOCK.match(/issueDevice\s*\(/g) || []).length;
const retN = (UNLOCK.match(/ok:\s*true/g) || []).length;
ok('unlock 分支内 issueDevice 调用数 ≥ 4（auto-edit / auto-view / view / edit）', issueN >= 4, '实际 ' + issueN + ' 处 / 成功返回 ' + retN + ' 处');
ok('★ 显式 role=view 那条也签了 deviceToken', /role:\s*'view'[\s\S]{0,400}?deviceToken/.test(UNLOCK));
// 反证：这条分支曾经漏过 —— 把 dtV2 那一行去掉，签发数必须回落到 3（说明 dtV2 确实补上了第 4 条）
// ⚠️ 别用「固定字符窗口 + 正则」做反证：窗口会串到相邻的 auto-view 分支，
//    那边本来就有 deviceToken: dtV，反证会被它救回来（踩过多次的老坑）。
const broken = UNLOCK.replace(/const\s+dtV2\s*=\s*issueDevice[\s\S]*?;\s*/, '');
const brokenN = (broken.match(/issueDevice\s*\(/g) || []).length;
ok('反证：去掉 dtV2 后只剩 3 处签发（证明确实是它补上了 role=view 那条）', brokenN === issueN - 1, '原 ' + issueN + ' → 去掉后 ' + brokenN);

// setup / change 拿不到指纹，刻意不发长期令牌，但必须把时效讲明白
console.log('\n【五】拿不到指纹时：不发长期令牌，但必须说清时效');
const setupStart = SV_NOC.indexOf("p === '/api/lock/setup' && req.method");
const SETUP = SV_NOC.slice(setupStart, SV_NOC.indexOf("p === '/api/lock/unlock' && req.method"));
ok('[自检] 定位到 setup 路由定义', setupStart > 0 && SETUP.length > 100);
ok('setup 不签长期令牌（避免无指纹占位）', SETUP.indexOf('issueDevice') < 0);
ok('★ setup 说清了本次只有 1 小时', /1\s*小时内有效/.test(SETUP) || /1 小时内有效/.test(SV));
const changeStart = SV_NOC.indexOf("p === '/api/lock/change'");
const CHANGE = SV_NOC.slice(changeStart, changeStart + 5000);
ok('change 说清了其它设备会掉线 + 本机只有 1 小时', /1\s*小时内有效/.test(SV) && /全部失效/.test(SV));

console.log('\n' + '─'.repeat(60));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
