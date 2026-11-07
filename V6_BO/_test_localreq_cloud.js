// io 轮守门（H1 修复）：isLocalReq 必须支持通过 QD_CLOUD=1 显式关闭"回环免密"。
// 角度：isLocalReq 把 socket 对端是 127.0.0.1 直接判为开发者(edit)。若托管反向代理
//       以 loopback 转发公网流量，则所有外部请求都会被免密 → 整站鉴权绕过。
//       加 QD_CLOUD=1 开关，让部署方在云端强制关闭回环免密（本地开发不受影响）。
// 离线、确定性：源码字面量守门 + 提取 isLocalReq 真跑。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

console.log('\n【① 源码字面量：isLocalReq 内含 QD_CLOUD 关闭回环免密】');
{
  ok('⛔ isLocalReq 识别 QD_CLOUD 开关',
    /function isLocalReq\(req\)\s*\{[\s\S]{0,500}?if \(process\.env\.QD_CLOUD === '1'\) return false;/.test(SV));
}

console.log('\n【② 提取 isLocalReq 真跑：QD_CLOUD=1 时回环请求也不免密】');
{
  const m = /function isLocalReq\(req\)\s*\{[\s\S]{0,8000}?\n\}/.exec(SV);
  ok('⛔ 能抠出 isLocalReq 函数体', !!m);
  if (m) {
    const fn = new Function('req', 'process', m[0] + '\nreturn isLocalReq(req);');
    const loopReq = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' } };
    const envOn = { env: { QD_CLOUD: '1' } };
    const envOff = { env: {} };
    ok('QD_CLOUD=1 → 回环请求返回 false（不免密）', fn(loopReq, envOn) === false);
    ok('QD_CLOUD 未设 → 回环请求仍返回 true（本地开发不受影响）', fn(loopReq, envOff) === true);
    // 外部 IP 无论 QD_CLOUD 如何都应返回 false
    const extReq = { socket: { remoteAddress: '203.0.113.9' }, headers: { host: 'example.com' } };
    ok('外部 IP → false（QD_CLOUD=1）', fn(extReq, envOn) === false);
    ok('外部 IP → false（QD_CLOUD 未设）', fn(extReq, envOff) === false);
  }
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
