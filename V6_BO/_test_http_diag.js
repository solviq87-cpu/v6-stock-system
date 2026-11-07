// -*- coding: utf-8 -*-
// 守门测试：/api/diag 自检快照（退避观测 HTTP 暴露）
// 覆盖：① buildSelfCheck 结构与字段；② em 缺函数时的兜底不崩；③ server.js 静态接入。
const em = require('./em');
const { buildSelfCheck } = require('./diag_snapshot');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } }

console.log('=== ① buildSelfCheck 结构 ===');
const s = buildSelfCheck(em);
ok('ok=true', s.ok === true);
ok('at 为时间戳', typeof s.at === 'number');
ok('backoff 已采集', s.backoff && typeof s.backoff === 'object');
ok('backoff.emRateTriggers 字段存在', s.backoff && 'emRateTriggers' in s.backoff);
ok('backoff.thsKlineDown 字段存在', s.backoff && 'thsKlineDown' in s.backoff);
ok('backoff.inflight 字段存在', s.backoff && 'inflight' in s.backoff);
ok('dayGuard 已采集', s.dayGuard && typeof s.dayGuard === 'object');
ok('financial 已采集', s.financial && typeof s.financial === 'object');
ok('financial.season = 2026-09-30（最新季）', s.financial && s.financial.season === '2026-09-30');

console.log('=== ② em 缺函数时兜底不崩 ===');
const s2 = buildSelfCheck({});
ok('缺 em 不抛错、ok=true', s2 && s2.ok === true);
ok('缺 backoffStats 时 backoff=null', s2.backoff === null);
ok('缺 dayGuardStats 时 dayGuard=null', s2.dayGuard === null);

console.log('=== ③ server.js 静态接入 /api/diag ===');
const src = fs.readFileSync('server.js', 'utf8');
ok("server.js require('./diag_snapshot')", src.includes("require('./diag_snapshot')"));
ok('server.js 含 /api/diag 分支并调用 buildSelfCheck(em)', src.includes("/api/diag") && src.includes('buildSelfCheck(em)'));
// ⛔ 2026-10-27 mp 轮改钉：原来钉「路由体内必须有 if (!isLocalReq(req))」。
//    实际设计口径（server.js 17300 注释明文）是「本机 & 已登录设备可见，未登录外网被门禁挡回」——
//    即靠跨设备门禁保护，而不是在路由里再拦一次本机。路由内守住 isLocalReq 会把
//    已授权的手机/异地设备一起挡掉，与设计相反。现在钉真正的契约：
//    ① /api/diag 不得进 isAuth 白名单（否则外网无令牌就能看诊断快照）；
//    ② 路由体不做任何身份放行（不出现 isLocalReq 例外）。
{
  const gi = src.indexOf('const isAuth');
  const ge = gi < 0 ? -1 : src.indexOf('if (!isAsset && !isAuth', gi);
  const GATE = gi < 0 ? '' : src.slice(gi, ge > gi ? ge : gi + 3000);
  ok('/api/diag 不在门禁白名单（外网无令牌必被挡回）', GATE.indexOf("'/api/diag'") < 0);
  ok('反证：若把 /api/diag 塞进白名单，上一条会红（白名单切片非空时可检出）', GATE.length > 0);
  ok('/api/diag 路由体内不做本机例外（身份交给门禁统一判）',
    !/if \(p === '\/api\/diag'\) \{[\s\S]{0,200}?isLocalReq\(req\)/.test(src));
}

console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
