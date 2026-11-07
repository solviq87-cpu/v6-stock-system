// 源码包推送「副本闸」守门（2026-10-28 推送模块自治修复）
//
// 故障形态（源码实证 + 线上流水佐证）：srcPkgShip 绕过 pushAll 直连私密通道
// （L16565 直接 feishuProbe），因此 pushAll 内置的副本闸管不到它 —— 全项目其他推送
// 路径都有 `if (isReplica()) return;`（对照 L6581「副本只同步、不主动外发」），唯独这条没有。
// 后果：副本实例一旦触发，会把**含 token 的源码包链接**外发出去，违反推送红线且属安全敏感项。
// 本套件切出函数体真查，钉死：① 副本闸存在 ② 拦截落流水 ③ 副本分支不发（sent:false）
// ④ 旧写法反证（去掉闸即失守）。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}

// ── 从源码原样切出 srcPkgShip 函数体 ──
const iFn = SV.indexOf('async function srcPkgShip');
const iProbe = iFn < 0 ? -1 : SV.indexOf('feishuProbe(feishuSecId()', iFn);
const iEnd = iProbe < 0 ? -1 : SV.indexOf('\n}', iProbe);
const BODY = (iFn >= 0 && iEnd > iFn) ? SV.slice(iFn, iEnd + 2) : '';

ok('srcPkgShip 函数体可定位', BODY.length > 300, 'len=' + BODY.length);
ok('副本闸已补（isReplica()）', /isReplica\(\)/.test(BODY));
ok('副本拦截落流水（副本拦截(不外发)）', /副本拦截\(不外发\)/.test(BODY));
ok('副本分支不发送：return 且 sent:false',
  /isReplica\(\)[\s\S]{0,500}?return\s*\{[\s\S]{0,200}?sent:\s*false/.test(BODY));
ok('副本分支仍返回可用链接（能力不丢，仅不外发）',
  /isReplica\(\)[\s\S]{0,500}?url:\s*srcPkgUrl\(token\)/.test(BODY));
ok('闸位置在 feishuProbe 之前（先拦后发）',
  BODY.indexOf('isReplica()') >= 0 && BODY.indexOf('isReplica()') < BODY.indexOf('feishuProbe(feishuSecId()'));

// ── 旧写法反证：移除该闸后必须失守（证明断言真的钉住了它，不是碰巧命中别处）──
const stripped = BODY.replace(/if\s*\(\s*isReplica\(\)\s*\)\s*\{[\s\S]*?\n  \}/, '');
ok('旧写法反证（去掉该闸即失守）', !/isReplica\(\)/.test(stripped));

// ── 对照：全项目副本闸语义一致（L6581 那句是「return」、本处是「记流水+return」，
//    两者都不外发，只是本函数需要返回值，故写法不同但语义等价）──
ok('语义等价：主实例不受影响（闸只在副本为真时拦截）',
  /if\s*\(\s*isReplica\(\)\s*\)/.test(BODY) && !/if\s*\(\s*!isReplica\(\)\s*\)/.test(BODY));

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
