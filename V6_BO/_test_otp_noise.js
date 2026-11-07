// 验证码轰炸守门测试：确保「找回密码验证码」不会被副本实例发到用户手机上，
// 也不会一次连发好几条不同的码。
//
// 2026-10-02 实测真凶（不是"被踢下线"，是推送源搞错了）：
//   本地开发副本(pushRole=replica)的 pushlog.json 里有 **44 条**「开发者密码找回·身份验证」，
//   一阵连发 4~6 条、每次一个新码 —— 用户手机被验证码轰炸，且不知道该输哪个。
//   来源：① pushVerifyCode 带 essential:true（"连副本实例也照发"）绕过了副本拦截；
//         ② 每次调用都生成新码并立刻推一条，没有节流也没有复用。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('✅ ' + n); } else { fail++; console.log('❌ ' + n + (extra ? '  → ' + extra : '')); } };

console.log('── A. 副本实例绝不外发验证码 ──');

// 1) pushVerifyCode 必须先判 isReplica 并直接 return，不能走到 pushAll
const pv = s.slice(s.indexOf('function pushVerifyCode'), s.indexOf('// 把「访问链接 + 开发者密码 + 观看密码」'));
ok('pushVerifyCode 内有 isReplica() 早退分支',
  /if \(isReplica\(\)\) \{[\s\S]{0,400}?return;/.test(pv));
// 只看 isReplica 那个 if 块内部：块里必须只有 pushLog + return，绝不能出现 pushAll
const _i = pv.indexOf('if (isReplica()) {');
const _blk = _i >= 0 ? pv.slice(_i, pv.indexOf('\n  }', _i) + 4) : '';
ok('pushVerifyCode 副本分支只记 pushLog + return，块内无 pushAll',
  !!_blk && /pushLog\('副本拦截\(验证码不外发\)'/.test(_blk) && /return;/.test(_blk) && !/pushAll\(/.test(_blk));

// 2) 任何调用点都不许再带 essential:true —— 那个开关就是副本外发的元凶
ok('全文件已无 essential: true 调用点（副本外发开关已拆除）',
  !/essential:\s*true/.test(s.replace(/^\s*\/\/.*$/gm, '')));
// ⚠️ 正则要容得下结尾分号：加了 `;` 是好习惯，别为了迁就断言把分号退掉。
//    断言要看的是「第二参 force=true、第三参只有 private、注释说明不再带 essential」。
//    别忘了 `}` 后面还有一层函数调用的 `)` 再才是 `; //`
// ⛔ 2026-10-28 改钉：验证码现在带 { private: true, mustDeliver: true }
//    （mustDeliver = 「私密不通才允许退回公开」的白名单，只给验证码/登录授权码这类过时就废的消息；
//      非 mustDeliver 的推送私密发不出去只留痕不外发）。原来钉死 `{ private: true }` 精确收尾会假红。
ok('pushVerifyCode 的 pushAll 只带 private:true',
  /pushAll\([\s\S]{0,400}?true, \{ private: true(?:, mustDeliver: true)? \}\s*\)\s*;?\s*\/\/.*不再带 essential/.test(s));

// 3) 只读申请通知 / 重置密码通知同样不许副本外发（同批清理）
ok('只读申请通知不再带 essential',
  !/只读设备申请访问[\s\S]{0,200}?essential/.test(s));
ok('重置密码通知不再带 essential',
  !/开发者密码已通过手机号验证重置[\s\S]{0,220}?essential/.test(s));

console.log('\n── B. 连发节流：有效期内复用同一个码 ──');

// ⚠️ 用 "if (p === '/api/lock/..." 定位：裸字符串 'p === /api/lock/forgot' 在
//    路由白名单（isAuth 那一行）里也出现过，用裸串切片会截到一段空白，断言全假。
const fg = s.slice(s.indexOf("if (p === '/api/lock/forgot'"), s.indexOf("if (p === '/api/lock/verify-code'"));

// 4) 必须有"当前有效验证码"复用槽（CUR），不能每次都新生成
ok('forgot 复用未过期的验证码（CUR 槽位），不再每次生成新码',
  /_otp\.get\('CUR'\)/.test(fg) && /if \(cur && cur\.code && cur\.exp > now\) \{ code = cur\.code;/.test(fg));

// 5) 60 秒推送节流：同一个码 60 秒内不重复推
ok('同一验证码 60 秒内不重复推送',
  /if \(now - lastPush >= 60 \* 1000\)/.test(fg));

// 6) 复用/未重推时要明确告诉用户"用上一条"，别让人以为没发出来
ok('未重推时回执文案改为「用上一条」',
  /直接用上一条（未重复发送）/.test(fg));

// 7) 核销后必须清掉复用槽，否则旧码一直被复用
ok('验证码核销后清除 CUR（verify-code 分支）',
  /_otp\.delete\('CUR'\);\s*\/\/ 已核销/.test(s));
ok('找回完成后清除 CUR（reset-pwd 分支）',
  /_otp\.delete\('CUR'\);\s*\/\/ 找回已完成/.test(s));

console.log('\n── C. 真跑：本实例确为副本（修复生效的前提）──');
const http = require('http');
const getJSON = p => new Promise(r => {
  http.get({ host: '127.0.0.1', port: 8787, path: p, headers: { 'X-Forwarded-For': '223.104.10.20' } }, res => {
    let b = ''; res.on('data', d => b += d);
    res.on('end', () => { try { r(JSON.parse(b)); } catch { r(null); } });
  }).on('error', () => r(null));
});

(async () => {
  const st = await getJSON('/api/lock/status');
  if (!st) {
    console.log('⚠️  本地实例未启动，跳过真跑段（静态断言已覆盖）');
  } else {
    const cfgRole = (st.pushRole || (st.config && st.config.pushRole) || '');
    // ⛔ 这里是硬断言不是可选：本地实例一旦是 primary，定时推送会往手机发双份，
    //    验证码也会跟着外发 —— 就是本次事故的前提条件。
    //    注意：status 读的是【进程启动时加载的】config，改完 config.json 必须重启实例才生效。
    ok(`本地实例 pushRole=${cfgRole} —— 必须为 replica，否则副本拦截整个不生效`,
      cfgRole === 'replica');
    ok(`本地实例已加载新代码 appVer=${st.appVer}`, st.appVer === '20261002cs' || /^\d{8}[a-z]{2}$/.test(String(st.appVer)));
    // 本地副本的推送流水里不该再有「密码找回…已送达」（历史存量属修复前，只做提示不判失败）
    const pl = JSON.parse(fs.readFileSync(path.join(ROOT, 'pushlog.json'), 'utf8'));
    const arr = Array.isArray(pl) ? pl : (pl.items || pl.log || pl.list || []);
    const zc = arr.filter(x => /找回|验证码/.test(String(x.title || x.text || '')));
    const delivered = zc.filter(x => /已送达/.test(String(x.status || '')));
    console.log(`   本地 pushlog：密码找回类 ${zc.length} 条，其中「已送达」${delivered.length} 条` +
      (zc.length ? `（最后一条 ${(zc[zc.length - 1] || {}).time || ''}）` : ''));
    if (delivered.length) console.log('   ↑ 这些是修复前副本外发的存量；修复后本实例不再新增');
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
