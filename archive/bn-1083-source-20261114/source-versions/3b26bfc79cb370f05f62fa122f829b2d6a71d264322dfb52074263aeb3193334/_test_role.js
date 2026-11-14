// 复现：模拟手机（外部设备）用「开发者密码」登录后的权限与持仓可见性
const http = require('http');
function api(method, p, body, xff) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = Object.assign({ 'X-Forwarded-For': xff || '223.104.10.20' }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {});
    const r = http.request({ host: '127.0.0.1', port: 8787, path: p, method, headers }, res => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(s); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const ok = (c, m) => console.log((c ? '✅ ' : '❌ ') + m);
(async () => {
  // ⚠️ DEV 是硬编码 fixture，用户一旦在面板上改过开发者密码就失效；
  //    发版时本地 access.json 还会被临时换成线上版本，同样会让 fixture 过期。
  //    过期的表现是"密码错误"，不是权限问题 → 显式跳过并改用静态闸门兜底，别误报红灯。
  const DEV = 'QDDEV26KT99', VIEW = 'VAHXUBjSGR';
  const fs = require('fs');
  const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
  let tok = '';   // ⚠️ 必须在 if/else 块外声明：fixture 过期时会走跳过分支，
                  //    但第 4 节仍引用它 —— 写在块里就是 ReferenceError（node --check 查不出）
  let _capBefore = 0;   // 同上：测试改动的「总资金」原值，结尾要还原成它（不是写死 0）
  const devExpired = u => u && u.ok === false && /密码错误|口令/.test(String(u.error || ''));
  const staticRoleGate = () => {
    ok(/function requireEditor/.test(SV), '静态闸门：requireEditor 存在（只读身份改不了东西）');
    ok(/readOnly: true/.test(SV), '静态闸门：敏感接口对只读身份返回 readOnly');
  };

  console.log('=== 1. 模拟手机：开发者密码登录 ===');
  const u = await api('POST', '/api/lock/unlock', { password: DEV, role: 'edit' });
  if (devExpired(u)) {
    console.log(`⚠️  跳过：硬编码的开发者密码 fixture 已过期（服务端返回「${u.error}」），` +
      `不是角色/权限问题。发版会短暂把本地 access.json 换成线上版本，` +
      `要恢复这三项请把本地口令重设为 ${DEV}，或同步本文件 DEV 常量。`);
    staticRoleGate();
  } else {
    ok(u.ok === true, '开发者密码登录：' + JSON.stringify(u).slice(0, 80));
    tok = u.token;
    const st = await api('GET', '/api/lock/status?token=' + tok);
    ok(st.role === 'edit', `服务端认定身份 = ${st.role}（local=${st.local}）`);
    const hd = await api('GET', '/api/holdings?token=' + tok);
    ok(hd.ok === true, '开发者应能看到持仓：' + (hd.ok ? `共 ${(hd.items || []).length} 只` : hd.error));
    // ⛔ 2026-10-06：这里写死 100000、结尾又写死还原成 0 —— 用户真实总资金是多少
    //   根本没管，跑一次测试就被改成 0（还会转发到线上）。改成先读原值、测完还原原值。
    _capBefore = (hd && hd.summary && hd.summary.capital) || 0;
    const wr = await api('POST', '/api/holdings', { token: tok, action: 'capital', capital: 100000, _noSync: true });
    ok(wr.ok === true, '开发者应能写持仓：' + (wr.ok ? wr.msg : wr.error));
  }

  console.log('\n=== 2. 怀疑点：如果用户停留在「观看」标签页输入了开发者密码 ===');
  const u2 = await api('POST', '/api/lock/unlock', { password: DEV, role: 'view' });
  ok(u2.ok === false, '结果应为失败：' + (u2.error || ''));
  console.log('   ↑ 若页面当时选中「观看密码」页签，用户看到的就是这句「观看密码错误」');

  console.log('\n=== 3. 观看密码登录后不得越权 ===');
  const v = await api('POST', '/api/lock/unlock', { password: VIEW, role: 'view' });
  const vtok = v.token;
  if (!vtok) {
    // ⚠️ 2026-10-02：VIEW 是本测试里硬编码的观看密码常量，用户一旦在面板上重设过观看密码，
    //    这个常量就过期了 —— 表现为三项全红，但**不是权限漏洞**，是 fixture 过期。
    //    重设真密码来迁就测试会改掉用户正在用的口令，不做；改成显式跳过 + 静态闸门兜底。
    console.log(`⚠️  跳过：硬编码的观看密码 fixture 已过期（服务端返回「${v.error || ''}」），` +
      `不是权限问题。要恢复这三项请重设观看密码后同步本文件 VIEW 常量。`);
    const sv = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
    ok(/\/api\/holdings[\s\S]{0,400}?hidden: true/.test(sv), '〔静态兜底〕只读身份读持仓必须返回 hidden:true 而不是数据');
    // holdings 写路由（/api/holdings POST）必须第一关就调 requireEditor，否则只读能改持仓
    ok(/p === '\/api\/holdings' && req\.method === 'POST'\) \{[\s\S]{0,300}?if \(!requireEditor\(res, tok, req\)\) return;/.test(sv),
      '〔静态兜底〕持仓写路由首关 requireEditor（只读被拒 readOnly:true）');
    ok(/function requireEditor\(/.test(sv), '〔静态兜底〕写操作统一走 requireEditor 闸门');
  } else {
    const vst = await api('GET', '/api/lock/status?token=' + vtok);
    ok(vst.role === 'view', '观看身份 = view');
    const vhd = await api('GET', '/api/holdings?token=' + vtok);
    ok(vhd.ok === false && vhd.hidden === true, '只读必须看不到持仓：' + (vhd.error || ''));
    // ⛔ 2026-10-07 补 _noSync：这一句的目的是「验证只读会被拒绝」，正常分支根本不会写。
    //    但**万一鉴权哪天被改坏**，它就会真的把 600000 写进持仓，还会经 syncUpstream 推到线上 ——
    //    一个断言失败的同时顺手污染了生产数据，事后极难追。越权试探同样必须隔离。
    const vwr = await api('POST', '/api/holdings', { token: vtok, action: 'add', item: { code: '600000', cost: 10, shares: 100 }, _noSync: true });
    ok(vwr.ok === false && vwr.readOnly === true, '只读写操作被拒：' + (vwr.error || ''));
  }

  console.log('\n=== 4. 已记住的设备令牌身份归类 ===');
  const tr = await api('POST', '/api/lock/trust', { password: DEV, name: 'test-phone', role: 'edit' });
  if (!tr || !tr.deviceToken) {
    console.log('⚠️  跳过第 4 节：开发者密码 fixture 已过期，拿不到设备令牌（同一原因）');
  } else {
  const dtok = tr.deviceToken;
  const dst = await api('GET', '/api/lock/status?token=' + dtok);
  ok(dst.role === 'edit', '开发者设备令牌 → ' + dst.role);
  const dh = await api('GET', '/api/holdings?token=' + dtok);
  ok(dh.ok === true, '该设备可见持仓');
  const rv = await api('POST', '/api/lock/revoke', { token: tok, id: require('crypto').createHash('sha256').update(dtok).digest('hex').slice(0, 8) });
  ok(rv.ok === true, '清理测试设备：撤销 ' + (rv.revoked || 0) + ' 台');
  }
  // 还原成**读到的原值**（不是写死 0），且不转发线上
  if (tok) await api('POST', '/api/holdings', { token: tok, action: 'capital', capital: _capBefore, _noSync: true });
})();
