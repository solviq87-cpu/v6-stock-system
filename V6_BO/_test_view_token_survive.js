// 守门：只读(view)设备令牌跨重启存活 + 仅 24h 空闲才被吊销（im 轮，2026-10-16）
// 钉语义不钉数字：用户要求「只读的设备除 24 小时不登陆外，不许挤掉」。
//   根因背景：view 登录走 issueDevice('view') 签发【自证设备令牌】(deviceToken)，
//   前端把它当会话令牌用；令牌自带 HMAC 签名（密钥 = machineKey，落盘 access.json 跨重启），
//   roleOf 用 verifyDeviceToken 验签即放行，不依赖重启即失的内存 _vtokens。
//   24h 空闲清理 expireIdleViewDevices 把空闲 view 设备写进 revoked 名单 → 下次 roleOf 判 isRevoked 即失效。
// 防回退：本测试在隔离 vm 里跑 server.js 真实鉴权函数（access.json 重定向到临时目录，绝不碰真实凭证），
//   ① 签发 view deviceToken；② 全新上下文「重启」后 roleOf 仍为 'view'（machineKey 跨重启存活）；
//   ③ 活跃设备不被 24h 清理误伤；④ 空闲 25h 的设备被 expireIdleViewDevices 吊销（roleOf===null）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-vt-'));
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// 关键隔离：把 server.js 的 __dirname 指向临时目录，access.json/qd_view.json 自然落在临时目录；
// 用真实 fs，atomicWrite 等落盘逻辑照常工作，能真实验证 machineKey 是否跨重启落盘。
const realRequire = require;
function fakeRequire(p) {
  if (p === 'http') return { createServer: () => { const s = { listen: () => s, on: () => s, close: () => {} }; return s; }, request: () => {}, get: () => {} };
  if (typeof p === 'string' && (p.startsWith('.') || p.startsWith('/') || p.startsWith('..'))) {
    const noop = () => undefined;
    return new Proxy(function () {}, { get: () => noop, apply: () => undefined, construct: () => ({}) });
  }
  return realRequire(p);
}
function loadCtx() {
  const sandbox = {
    require: fakeRequire, console, process, URL, Buffer, fs,
    setInterval: () => ({ unref() {}, ref() {} }), setTimeout: () => ({ unref() {}, ref() {} }), clearInterval: () => {}, clearTimeout: () => {},
    __dirname: TMP, __filename: path.join(TMP, 'server.js'), globalThis: null,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx, { filename: 'server.js' });
  return ctx;
}

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('✓ ' + n); } else { fail++; console.log('✗ ' + n + (extra ? '  → ' + extra : '')); } };

// 最小 access.json（带 salt/hash，否则 loadAccess 不装载）
fs.writeFileSync(path.join(TMP, 'access.json'), JSON.stringify({ salt: 'probe', hash: 'probe', devices: {}, view: { devices: {}, gen: 0 }, revoked: {}, gen: 0 }));

const ctx1 = loadCtx();
ok('vm 装载 server.js 成功（roleOf/issueDevice/expireIdleViewDevices 可用）',
  typeof ctx1.roleOf === 'function' && typeof ctx1.issueDevice === 'function' && typeof ctx1.expireIdleViewDevices === 'function');

const dt = ctx1.issueDevice({ name: '探针手机', ip: '10.0.0.5', fp: 'fp-probe-1' }, 'view');
ok('签发出 view deviceToken（形如 v<gen>_<hex>.<sig>）', /^v\d+_[0-9a-f]{64}\.[0-9a-f]+$/.test(dt), dt);
ok('重启前：roleOf(deviceToken) === "view"', ctx1.roleOf(dt) === 'view', 'roleOf=' + ctx1.roleOf(dt));

// 模拟重启：全新上下文从临时 access.json 重新装载
const ctx2 = loadCtx();
ok('重启后：roleOf(deviceToken) 仍为 "view"（自证令牌跨重启存活）', ctx2.roleOf(dt) === 'view', 'roleOf=' + ctx2.roleOf(dt));

// 活跃设备不被 24h 清理误伤
ctx2.roleOf(dt);
ctx2.expireIdleViewDevices(Date.now());
ok('重启后+活跃：24h 清理不吊销刚用过的设备', ctx2.roleOf(dt) === 'view', 'roleOf=' + ctx2.roleOf(dt));

// 模拟 24h 空闲：把磁盘台账里该 view 设备的 ts 拨回 25h 前，再从磁盘重载一个上下文（刚启动、设备 25h 没活跃过的进程）
const af = JSON.parse(fs.readFileSync(path.join(TMP, 'access.json'), 'utf8'));
const dig = crypto.createHash('sha256').update(String(dt)).digest('hex');
let found = false;
for (const k of Object.keys((af.view && af.view.devices) || {})) {
  if (k === dig) { af.view.devices[k].ts = Date.now() - 25 * 3600 * 1000; found = true; }
}
ok('能在台账里定位该 view 设备摘要', found, 'digest=' + dig.slice(0, 8));
fs.writeFileSync(path.join(TMP, 'access.json'), JSON.stringify(af));
const ctx3 = loadCtx();
// ⛔⛔ 2026-10-17 修时变性假红（memory 教训 11 同款第三例）：viewIdleKeys 默认走
//   「节假日除外」语义 —— tradeIdleMs 只累计【交易日】时长（2026-10-03 用户要求
//   「节假日除外」，注释见 tradeIdleMs 上方）。周六/周日/长假跑本测试时，拨回 25h
//   物理时间跨了休市日，计入的空闲时长 < 24h 阈值 → 设备「吊销不了」。那不是生产的
//   bug，是测试用错了口径：viewIdleKeys 本来就预留了 opts.isTradeDay 注入点
//   （「抽出来就是为了能在守门测试里直接注入验证」）。两个口径分别钉、都与运行日无关：
//   ① 全休市日注入 → 25h 物理时间也【不吊销】（用户「节假日除外」需求本身，防误伤）；
//   ② 全交易日注入 → 25h 物理时间【吊销】（吊销链路本身工作）。
// ⛔⛔ 还有个 2026-10-17 实测踩过的坑：roleOf 对自证令牌会 touchDevice【刷新台账活跃
//   时间并落盘】——吊销前拿 roleOf 试探「还没被吊销」，会把 ts 从 25h 前刷成现在，
//   下一个吊销断言必然假红。所以「有没有被吊销」一律看 expireIdleViewDevices 的
//   返回值 removed，不拿 roleOf 试探；roleOf 只在吊销后取一次（验 isRevoked 生效）。
const r1 = ctx3.expireIdleViewDevices(Date.now() + 1, { isTradeDay: () => false });
ok('节假日除外语义：25h 物理时间跨休市日 → 不吊销（用户 2026-10-03 需求）',
  r1 && r1.removed === 0, JSON.stringify(r1));
const r2 = ctx3.expireIdleViewDevices(Date.now() + 1, { isTradeDay: () => true });
ok('24h 空闲后：expireIdleViewDevices 吊销该设备', r2 && r2.removed === 1, JSON.stringify(r2));
const roleAfter = ctx3.roleOf(dt);
ok('吊销后 roleOf 为 null（isRevoked 名单生效）', roleAfter === null, 'roleOf=' + roleAfter);
// 吊销落盘跨重启：revoked 名单与 access.json 同口径落盘，新上下文里 isRevoked 仍生效
const ctx4 = loadCtx();
const role4 = ctx4.roleOf(dt);
ok('吊销落盘跨重启：新上下文 roleOf 仍为 null（revoked 名单持久化）',
  role4 === null, 'roleOf=' + role4);

console.log(`_test_view_token_survive: ${pass} 通过 / ${fail} 失败`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
