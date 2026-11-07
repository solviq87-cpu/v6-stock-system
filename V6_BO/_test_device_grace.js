// 设备重登宽限守门（dz+ 轮 · #291，2026-10-17）
// ── 为什么要有这套 ────────────────────────────────────────────────────
// 用户反复抱怨「频繁踢设备下线」。根因不是令牌过期，而是同一台设备换个标签页/换个
// 浏览器配置再登录时，issueDevice 按 fp 作废旧记录 → 旧令牌当场进 revoked 名单 →
// 另一个还开着的页面下一次请求就被判失效，弹回登录门。
// 修法：同 fp 重签 / 同 fp 去重给 24 小时宽限（revoked 词条带 graceUntil），
//      宽度期内 isRevoked 返回 false；到期自动按撤销处理。
// ⛔ 人工撤销（/api/lock/revoke）与一键清理（prune）**绝不宽限** —— 收回权限必须当场生效，
//    这套守门专门钉死「哪些路径有宽限、哪些没有」。
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
};
function span(sig) {
  const i = SRC.indexOf(sig);
  if (i < 0) return '';
  let depth = 0, j = SRC.indexOf('{', i);
  if (j < 0) return '';
  const start = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  return '';
}

// ── ① isRevoked / inDeviceGrace 真跑（注入 accessSecret 与 devDigest）────────
const codeRev = 'const _revokedBag = () => (accessSecret.revoked = accessSecret.revoked || {});\n'
  + span('const isRevoked = t =>') + '\n'
  + span('function inDeviceGrace(digest)') + '\n'
  + 'return { isRevoked, inDeviceGrace };';
ok('isRevoked / inDeviceGrace 可定位', span('const isRevoked = t =>').length > 100 && span('function inDeviceGrace(digest)').length > 80);
let mk = null;
try {
  mk = (secret) => new Function('accessSecret', 'devDigest', codeRev)(secret, (t) => 'D:' + t);
} catch (e) { console.error('沙箱构造失败:', e.message); process.exit(1); }

const NOW = Date.now();
const withBag = (bag) => mk({ revoked: bag });

ok('无词条 → 不算撤销', withBag({}).isRevoked('t1') === false);
ok('老格式（数字时间戳）= 永久撤销 → 仍然算撤销（不因本次改动把历史撤销放回活人）',
  withBag({ 'D:t1': NOW - 86400000 }).isRevoked('t1') === true);
ok('老格式（对象但无 graceUntil）= 永久撤销', withBag({ 'D:t1': { at: 'x', reason: 'y' } }).isRevoked('t1') === true);
ok('宽限中（graceUntil 在未来）→ 不算撤销（#291 的核心）',
  withBag({ 'D:t1': { reason: '同fp重签', graceUntil: NOW + 3600000 } }).isRevoked('t1') === false);
ok('宽限已到期（graceUntil 在过去）→ 恢复算撤销',
  withBag({ 'D:t1': { reason: '同fp重签', graceUntil: NOW - 1000 } }).isRevoked('t1') === true);
ok('graceUntil 是脏值（字符串/NaN）→ 按永久撤销处理，不放行',
  withBag({ 'D:t1': { graceUntil: 'abc' } }).isRevoked('t1') === true
  && withBag({ 'D:t1': { graceUntil: NaN } }).isRevoked('t1') === true);
ok('inDeviceGrace：宽限中 true', withBag({ 'D:t1': { graceUntil: NOW + 60000 } }).inDeviceGrace('D:t1') === true);
ok('inDeviceGrace：已到期 false', withBag({ 'D:t1': { graceUntil: NOW - 60000 } }).inDeviceGrace('D:t1') === false);
ok('inDeviceGrace：无词条 false', withBag({}).inDeviceGrace('D:t1') === false);

// ── ② 哪些路径给了宽限、哪些没给（结构断言，钉的是「谁来买得到宽限」）────────
const issueB = span('function issueDevice(meta, role)');
ok('issueDevice 可定位', issueB.length > 500);
ok('同 fp 重签 → 写 graceUntil（用户痛点的正解）',
  /reason: '同一设备\(fp\)重新签发[^']*'[^}]*graceUntil: Date\.now\(\) \+ DEVICE_GRACE_MS/.test(issueB));
const compactB = span('function compactDeviceRegistry()');
ok('compactDeviceRegistry 同 fp 去重 → 写 graceUntil（启动清理不该把刚发版的用户登出）',
  /reason: '启动清理:同fp去重[^']*'[^}]*graceUntil: Date\.now\(\) \+ DEVICE_GRACE_MS/.test(compactB));
ok('DEVICE_GRACE_MS = 24 小时（不是分钟也不是 7 天）', /const DEVICE_GRACE_MS = 24 \* 3600000;/.test(SRC));
const touchB = span('function touchDevice(t, role, ip)');
ok('touchDevice 宽限期内不补占位（否则台账凭空多一条马上消失的幽灵）',
  /if \(inDeviceGrace\(d\)\) return;/.test(touchB));
// ⛔ 顺序也有语义：判据必须排在「清同 IP 旧占位」之前。
//    写成先清后 return 的话，一条宽限中的令牌来一次请求就会白掉同 IP 的另一条占位。
{
  const iG = touchB.indexOf('if (inDeviceGrace(d)) return;');
  const iC = touchB.indexOf('for (const k of Object.keys(bag))');
  ok('宽限判据排在「清同 IP 旧占位」之前（先清后 return 会白掉一条）', iG > 0 && iC > iG);
}
// 真跑：宽限令牌不动台账，普通令牌照旧清旧占位并补一条（对照组）
{
  const gSrc = span('function inDeviceGrace(digest)');
  const mkTd = (acc) => new Function('accessSecret', 'viewStore', 'devDigest', 'saveAccess', '_devTouch',
    gSrc + '\n' + touchB + '\nreturn touchDevice;')(acc, () => null, (s) => 'D:' + s, () => {}, new Map());
  const mkAcc = (revoked) => ({
    devices: { OLD: { name: '已授权设备（自动恢复）', ip: '1.1.1.1', role: 'edit', ts: Date.now(), restored: true } },
    revoked: revoked || {},
  });
  const a1 = mkAcc({ 'D:g1': { reason: '同fp重签', graceUntil: Date.now() + 3600000 } });
  mkTd(a1)('g1', 'edit', '1.1.1.1');
  ok('真跑·宽限中的令牌：不建占位', !a1.devices['D:g1']);
  ok('真跑·宽限中的令牌：同 IP 旧占位不动（连清理都不该做）', !!a1.devices.OLD);
  const a2 = mkAcc({});
  mkTd(a2)('t2', 'edit', '1.1.1.1');
  ok('真跑·普通令牌：照常清旧占位并补一条（对照组，证明上面两条不是"什么都不做"）',
    !a2.devices.OLD && !!a2.devices['D:t2']);
}

const revokeB = span("if (p === '/api/lock/revoke' && req.method === 'POST')");
ok('人工撤销路径可定位', revokeB.length > 300);
ok('⛔ 人工撤销不宽限（收回权限必须当场生效）', !/graceUntil/.test(revokeB));
const devB = span("if (p === '/api/lock/devices' && req.method === 'POST')");
ok('一键清理路径可定位', devB.length > 300);
ok('⛔ 一键清理（prune）不宽限', !/graceUntil/.test(devB));
const expB = span('function expireIdleViewDevices(now, opts)');
ok('⛔ 只读空闲过期不宽限（那是策略清理，不是重登）', !/graceUntil/.test(expB));

// ── ③ 「还剩几个交易日」纯函数真跑 ────────────────────────────────────
const tdlSrc = span('function tradeDaysLeft(fromTs, now, budgetMs, tradeFn)');
const timSrc = span('function tradeIdleMs(fromTs, now, tradeFn)');
ok('tradeIdleMs / tradeDaysLeft 可定位', timSrc.length > 300 && tdlSrc.length > 200, timSrc.length + '/' + tdlSrc.length);
// ⛔ 沙箱必须把被调用的兄弟函数一起注入：tradeDaysLeft 第一行就是
//    `Number(budgetMs) - tradeIdleMs(fromTs, now, toTrade)`，只注入本体 → new Function 里
//    ReferenceError → 整套件当场崩。（dz 轮同款：守门沙箱新符号必须注入）
//    tradeIdleMs / tradeDaysLeft 内部都用 `tradeFn || isTradeDay` 兜底，所以再把 isTradeDay 注入成形参，
//    默认分支就能真跑；显式传 tradeFn 的用例照旧走形参。
// ⛔ 这里注入的 isTradeDay 是"只认周末"的替身（不查法定假日表），只为把算术钉死 ——
//    真节假日表由 server.js 自己的 _test_trade_idle / _test_next_trade_day 覆盖，别重复造第二份日历。
const weekendClosed = (d) => { const w = d.getDay(); return w !== 0 && w !== 6; };
const tradeDaysLeft = new Function('isTradeDay', timSrc + '\n' + tdlSrc + '\nreturn tradeDaysLeft;')(weekendClosed);
ok('两个函数默认口径都是 isTradeDay（不是自然日）—— 面板说"还剩 N 个交易日"必须与清理同尺',
  /const toTrade = tradeFn \|\| isTradeDay;/.test(tdlSrc)
  && /const toTrade = tradeFn \|\| isTradeDay;/.test(timSrc)
  && /- tradeIdleMs\(fromTs, now, toTrade\)/.test(tdlSrc));
const DAY = 86400000;
const allTrade = () => true;
const noTrade = () => false;
// 用纯粹的「每天都开市」口径把算术本身钉死
const T0 = new Date(2026, 9, 1, 9, 30).getTime();   // 2026-10-01 09:30 本地
ok('预算已耗尽 → 0（不是负数）', tradeDaysLeft(T0, T0 + 30 * 3600000, 24 * 3600000, allTrade) === 0);
ok('刚用过 0 小时、预算 24h → 约 1 个交易日',
  tradeDaysLeft(T0, T0, 24 * 3600000, allTrade) === 1, String(tradeDaysLeft(T0, T0, 24 * 3600000, allTrade)));
ok('用了 12 小时、预算 24h → 还剩 1 个交易日',
  tradeDaysLeft(T0, T0 + 12 * 3600000, 24 * 3600000, allTrade) === 1);
ok('预算 72h、刚用过 → 3 个交易日（按整日累计）',
  tradeDaysLeft(T0, T0, 72 * 3600000, allTrade) === 3);
ok('一天都不开市 → 0（不会算出无穷大，也不会死循环）',
  tradeDaysLeft(T0, T0, 24 * 3600000, noTrade) === 0,
  String(tradeDaysLeft(T0, T0, 24 * 3600000, noTrade)));
ok('判不出（tradeFn 抛错）不算崩：一律按非交易日，返回 0',
  tradeDaysLeft(T0, T0, 24 * 3600000, () => { throw new Error('x'); }) === 0);
// 真实口径：2026-10-17 是周六 → 从今天起算的下一个交易日是 10-19（周一）
{
  const sat = new Date(2026, 9, 17, 12, 0).getTime();
  const real = tradeDaysLeft(sat, sat, 24 * 3600000);
  ok('真实日历：周六起算 24h 预算只数到下一个交易日（≥1）', real >= 1 && real <= 2, String(real));
}

// ── ④ 接口给面板的「剩 N 个交易日」字段 ────────────────────────────────
const devGetB = span("if (p === '/api/lock/devices' && req.method === 'GET')");
ok('/api/lock/devices 可定位', devGetB.length > 300);
ok('只读设备下发 idleLeftDays（前端不自己算天数，避免两套口径）',
  /it\.idleLeftDays = tradeDaysLeft\(/.test(devGetB));
ok('口径与清理一致：走 viewIdleMs() 而不是写死 24',
  /viewIdleMs\(\)/.test(devGetB) && /tradeDaysLeft\(it\.ts, Date\.now\(\), _im\)/.test(devGetB));

// ── ⑤ 前端必须真的显示这个字段 ──────────────────────────────────────────
const HTML = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
ok('前端渲染只读设备的「约 N 个交易日后自动清理」', /约 \$\{d\.idleLeftDays\} 个交易日后自动清理/.test(HTML));
ok('前端对已超期设备显式标红（不是静默显示 0 天）', /已超期，下次清理即移除/.test(HTML));
ok('前端不自己算天数（只消费后端字段）', !/tradeDaysLeft/.test(HTML));

console.log(`[device_grace] ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
