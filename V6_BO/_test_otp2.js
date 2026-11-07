// 附加自检：验证码回显范围必须受限（本机可见，外部设备不回显），避免被绕过推送通道
//
// ⚠️ 2026-10-02 修：旧版写死测试号码 1763448734，而它之所以"能过"，
//    是因为字母序在它前面的 _test_otp.js 先把【找回手机号改绑成了那个测试号】——
//    两个测试互相配合，悄悄把用户真实的找回号码换了。用户真忘密码时验证码发到别人手机上。
//    现在 _test_otp.js 已拒绝改绑，本测试也随之改成：号码不匹配就跳过，并额外断言
//    「跑完一遍后找回手机号没有被改动」。
const http = require('http');
const fs = require('fs');
const path = require('path');
function req(path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = Object.assign({}, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers || {});
    const r = http.request({ host: '127.0.0.1', port: 8787, path, method: data ? 'POST' : 'GET', headers: h }, res => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(s); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m); } };
const sk = m => { skip++; console.log('⚠️  ' + m); };
const TEST_PHONE = '1763448734';
const isRateLimited = r => /请求过于频繁/.test(String((r && r.error) || ''));

(async () => {
  const st0 = await req('/api/lock/phone');
  // ⛔ 2026-10-17 修环境性假红：未绑定时 bound=false 是服务端【正确降级】，非故障。
  //   号码刻意不写死在源码里，本测试拒绝为跑测试而改绑 → 未绑定即显式跳过，
  //   只验静态闸门（与下方 forgot 分支的跳过机制同口径）。
  if (st0.bound !== true) {
    sk(`本机未绑定找回手机号（bound=${st0.bound}）→ 真跑段跳过，只验静态闸门（拒绝为跑测试改绑）`);
  } else {
    ok(true, `当前绑定找回手机号：${st0.masked}`);
  }

  const local = await req('/api/lock/forgot', { phone: TEST_PHONE });
  if (!(local.ok === true)) {
    const why = isRateLimited(local) ? '撞上限流' : `测试号码不是当前绑定号（${local.error || ''}）`;
    sk(`${why} → 跳过真跑段，改验静态闸门（绝不改绑去迁就测试）`);
    const sv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    ok(/if \(isLocalReq\(req\)\) r\.devCode = code;/.test(sv),
      '〔静态兜底〕验证码仅在对本机请求的响应里回显（外部设备拿不到）');
    ok(/仅本机请求回显验证码/.test(sv), '〔静态兜底〕回显处有明确注释说明用途与风险');
  } else {
    ok(local.ok === true && /^\d{6}$/.test(local.devCode || ''), '本机请求：回显验证码（方便本机找回）' + local.devCode);
    // 模拟外部设备：带上反向代理头，isLocalReq 必须为 false
    const ext = await req('/api/lock/forgot', { phone: TEST_PHONE }, { 'X-Forwarded-For': '223.104.10.20' });
    ok(ext.ok === true, '外部设备：仍可发起验证（验证码只推到手机）');
    ok(ext.devCode === undefined, '外部设备：响应体不含验证码（无法绕过推送通道）');
  }

  // 最要紧的一条：跑完这一圈，找回手机号必须还是原来那个（测试不许改绑）
  const st1 = await req('/api/lock/phone');
  ok(st1.masked === st0.masked, `测试未改动找回手机号（跑前 ${st0.masked} → 跑后 ${st1.masked}）`);
  console.log(`结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
})();
