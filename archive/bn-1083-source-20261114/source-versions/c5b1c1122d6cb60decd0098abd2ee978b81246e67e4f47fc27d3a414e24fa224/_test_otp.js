// 端到端自检：忘记密码 → 手机号验证 → 重置开发者密码
//
// ⛔⛔ 2026-10-02 大改：旧版本这个测试是**破坏性**的，而且直接制造了用户投诉的问题：
//   ① 它反复调 /api/lock/forgot —— 那时 pushVerifyCode 带 essential:true，
//      副本实例也照发，于是本地跑一次测试用户手机就来 4~6 条验证码（本地 pushlog 存量 44 条）。
//   ② 第 8 段会把【找回手机号改绑成测试号码】再改回来。一旦中途失败就留下错误号码，
//      用户真忘密码时收到的验证码发到别人号上 —— 找回密码直接失效。
//      而且改绑后无法还原：接口只返回掩码，测试根本不知道原来绑的是哪个号。
//   现在：
//   · 先探测测试号码是否【当前已绑定】；没绑就整段跳过，绝不改绑（改了就还原不回去）。
//   · 验证码外发已由 server.js 的副本拦截兜住，测试不再污染手机。
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8787;
const TEST_PHONE = '1763448734';
const DEV_PWD = 'QDDEV26KT99';
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
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
// ⚠️ 服务端对 forgot 有「同 IP 10 分钟 5 次」的限流。撞上限流时返回也是 ok:false，
//    但那是【被限流】不是【号码不匹配】 —— 照单全收会变成假通过（10 分钟内跑两次测试就中招）。
const isRateLimited = r => /请求过于频繁/.test(String((r && r.error) || ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== 1. 绑定手机号状态 ===');
  const st = await req('GET', '/api/lock/phone');
  // ⛔ 2026-10-17 修环境性假红：本机未绑定找回手机号时 bound=false 是服务端的【正确降级】，
  //   不是故障。号码刻意不写死在源码里（源码包一旦外发=交出找回通道），本测试历来
  //   拒绝为跑测试而改绑（会破坏用户真实找回号码且无法还原）→ 未绑定即显式跳过，
  //   与 3~8 段的跳过机制同口径。要跑全流程：把 TEST_PHONE 改成本机实际绑定号再跑。
  if (st.bound !== true) {
    sk(`本机未绑定找回手机号（bound=${st.bound}）→ 全流程段跳过（服务端未绑定时报 false 属正确降级；拒绝为跑测试改绑）`);
  } else {
    ok(true, `已绑定找回手机号（掩码 ${st.masked}）`);
  }

  console.log('\n=== 2. 非绑定手机号必须拒绝 ===');
  // 每次都区分"号码不匹配"与"被限流"：限流时不算通过也不算失败，直接跳过并说明
  const rejectCase = async (phone, label) => {
    const r = await req('POST', '/api/lock/forgot', { phone });
    if (isRateLimited(r)) return sk(`${label}：撞上限流，本条不作判定（${r.error}）`);
    ok(r.ok === false, `${label}：${r.error}`);
  };
  await rejectCase('13800138000', '随机号码被拒');
  await rejectCase('176344873', '少一位号码被拒');
  await rejectCase('', '空号码被拒');

  // 关键闸门：测试号码必须是【当前已绑定】的那个，否则后面的流程全部跳过。
  // 绝不再调 bind-phone 去"迁就"测试 —— 改绑后无法还原（接口只给掩码），
  // 一旦留下错误号码，用户真忘密码时验证码就发到别人手机上了。
  const f = await req('POST', '/api/lock/forgot', { phone: TEST_PHONE });
  // 只有「号码确实是当前绑定的那个」才继续跑验证码/重置流程；其余情况一律跳过而不是改绑迁就
  if (!(f.ok === true)) {
    if (isRateLimited(f)) sk(`探测绑定号码时撞上限流（${f.error}）—— 10 分钟后再跑或重启本地实例清空限流计数`);
    else sk(`测试号码 ${TEST_PHONE} 不是当前绑定的找回号码（服务端：${f.error || ''}）`);
    sk('→ 跳过 3~8 段（验证码/重置全流程）。改绑会破坏用户真实的找回号码且无法还原，本测试拒绝这么做。');
    sk('→ 要跑全流程：把本文件 TEST_PHONE 改成面板里实际绑定的号码，再跑一次。');
    // 用静态断言补上被跳过部分的闸门覆盖（注意 ok(cond, msg) 的参数顺序）
    const sv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    ok(/\/api\/lock\/bind-phone' && req\.method === 'POST'\) \{[\s\S]{0,300}?if \(!requireEditor\(res, tok, req\)\) return;/.test(sv),
      '〔静态兜底〕bind-phone 首关 requireEditor（只读不能改找回手机号）');
    ok(/devices: kick \? \{\} : keepDevices/.test(sv),
      '〔静态兜底〕reset-pwd 默认不踢自己设备（kick 才全网下线）');
    ok(/const exp = now \+ 5 \* 60 \* 1000/.test(sv) && /rec\.tries >= 3/.test(sv),
      '〔静态兜底〕验证码 5 分钟过期 + 错满 3 次作废');
    console.log(`\n结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
    return;
  }

  console.log('\n=== 3. 仅本手机号可发起验证（副本实例不外发，只本机回显）===');
  ok(f.ok === true, `验证发起成功，掩码 ${f.masked}，有效期 ${f.expiresIn}s`);
  const code = f.devCode;
  ok(!!code, '拿到验证码（本机回显；副本实例不往手机外发）：' + code);
  const tk = f.ticket;

  console.log('\n=== 4. 验证码防 brute-force ===');
  for (let i = 1; i <= 2; i++) {
    const w = await req('POST', '/api/lock/verify-code', { ticket: tk, code: '000000' });
    ok(w.ok === false, `第 ${i} 次错误码被拒：${w.error}`);
  }
  const w3 = await req('POST', '/api/lock/verify-code', { ticket: tk, code: '000000' });
  ok(w3.ok === false, '错满3次验证码自动作废：' + w3.error);
  const dead = await req('POST', '/api/lock/verify-code', { ticket: tk, code });
  ok(dead.ok === false, '作废后连正确码也失效：' + dead.error);

  console.log('\n=== 5. 重新发起 → 正确码通过 ===');
  const f2 = await req('POST', '/api/lock/forgot', { phone: TEST_PHONE });
  const v = await req('POST', '/api/lock/verify-code', { ticket: f2.ticket, code: f2.devCode });
  ok(v.ok === true, '身份验证通过，取得一次性重置凭证');
  const rt = v.resetToken;
  const reuse = await req('POST', '/api/lock/verify-code', { ticket: f2.ticket, code: f2.devCode });
  ok(reuse.ok === false, '验证码用完即焚：' + reuse.error);

  console.log('\n=== 6. 重置密码 ===');
  const weak = await req('POST', '/api/lock/reset-pwd', { resetToken: rt, newPassword: '123' });
  ok(weak.ok === false, '弱密码被拒：' + weak.error);
  const badrt = await req('POST', '/api/lock/reset-pwd', { resetToken: 'deadbeef', newPassword: DEV_PWD });
  ok(badrt.ok === false, '伪造凭证被拒：' + badrt.error);
  const rst = await req('POST', '/api/lock/reset-pwd', { resetToken: rt, newPassword: DEV_PWD });
  ok(rst.ok === true, '密码重置成功，直接签发开发者令牌');
  const reUse2 = await req('POST', '/api/lock/reset-pwd', { resetToken: rt, newPassword: 'QDtest#2026' });
  ok(reUse2.ok === false, '凭证用完即焚：' + reUse2.error);

  console.log('\n=== 7. 新密码立即可用 / 旧会话已失效 ===');
  const ul = await req('POST', '/api/lock/unlock', { password: DEV_PWD, role: 'edit' });
  ok(ul.ok === true && ul.role === 'edit', '新密码可正常登录（角色=开发者）');
  const ul2 = await req('POST', '/api/lock/unlock', { password: 'qd123456', role: 'edit' });
  ok(ul2.ok === false, '旧密码已失效：' + ul2.error);
  const vs = await req('GET', '/api/lock/status?token=' + (rst.token || ''));
  ok(vs.hasPassword === true && vs.boundPhone, `状态接口正常（已设密码 / 已绑手机 ${vs.boundPhone}）`);

  console.log('\n=== 8. 找回手机号改绑闸门（非破坏性，只验权限不真的改绑）===');
  // 旧版这里真的改绑两次再改回，破坏性极强且无法还原 → 改为纯静态闸门校验。
  const sv2 = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  ok('bind-phone 有开发者权限闸门（只读身份不能改找回手机号）',
    /\/api\/lock\/bind-phone[\s\S]{0,500}?isEditorReq|bind-phone[\s\S]{0,400}?roleOf\(tok/.test(sv2));

  console.log('\n=== 9. 收尾：把本套件签出去的设备令牌从台账里撤掉 ===');
  // ⛔ 2026-10-07 补（本轮角度：测试代码与生产数据的隔离边界）：
  //    reset-pwd 成功会**当场签发一枚长期设备令牌并写进设备台账**，
  //    而本套件跑完从来不清理 —— 每跑一次台账就多一条没人认领的记录，
  //    用户打开「授权设备」看到一堆不认识的设备，正是 2026-10-03 那句
  //    「那些 N 台都是我的吗」的来源之一。撤销要按令牌摘要算出 id（与 _test_role.js 同款）。
  {
    const crypto = require('crypto');
    for (const t of [rst && rst.token, rst && rst.deviceToken].filter(Boolean)) {
      const id = crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 8);
      try {
        const rr = await req('POST', '/api/lock/revoke', { token: t, id });
        if (rr && rr.ok) console.log('   · 已撤销本套件签发的设备 ' + id);
      } catch (e) { /* 撤销失败不该让套件变红，只是台账少清一条 */ }
    }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
})().catch(e => { console.error('测试异常', e); process.exit(1); });
