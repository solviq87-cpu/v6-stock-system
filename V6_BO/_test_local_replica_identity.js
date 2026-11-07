// 守门：本机副本身份 + 双推隐患（2026-10-28 推送模块）
//
// 背景（2026-10-28 21:58 实测）：一次「用线上数据覆盖本地」的发布动作把本机
// ROOT/config.json 写成【线上那份】——线上 config 的 pushRole 在发版时已被
// _publish.py 剥掉…于是本机磁盘上的 config.json 一度变成「无 pushRole 键」形态。
// ⛔ 后果（server.js:7688 isReplica）：缺省值是 'primary'。缺 pushRole 键 = 本机自认 primary：
//   ① 定时推送不再被副本闸拦下 → 本机与线上【各推一遍】，手机收到两份；
//   ② syncUpstream 转发目标 = 自己 → 线上写操作自我回环。
//   本次实测侥幸没炸：覆盖发生在 21:58，而本机 8787 进程是 19:29 启动的
//   （config 启动期一次性加载，磁盘覆盖不立即影响运行中进程），内存态仍 replica；
//   22:13 _post_publish.py 写回 pushRole=replica 才恢复。窗口期约 15 分钟 ——
//   若这期间本机重启，就会真双推。
//
// ⛔ 判据必须按【实例形态】分流，不能一刀切要求 pushRole=replica：
//   · 配了 syncUpstream（把写操作转发给线上 primary）= 副本形态 → 必须显式 replica，
//     缺键即 primary 即双推，必须判红。
//   · 没配 syncUpstream = 独立/线上形态 → pushRole=primary 是**正确**的，
//     若此时也要求 replica，就是把线上 primary 判成错（假红）。
//   上一版守门就是一刀切要求 replica，会在线上 primary 容器里假红 —— 已修。
//
// ⛔ 判不出不硬判：config.json 不存在（干净克隆 / CI）→ 显式记「未验证」并跳过，
//   不填 0、不猜、不当通过。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CFG = path.join(ROOT, 'config.json');
let pass = 0, fail = 0, warn = 0, skip = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  —— ' + detail : '')); }
}
function warnMsg(name, detail) { warn++; console.log('⚠️ ' + name + (detail ? '  —— ' + detail : '')); }

if (!fs.existsSync(CFG)) {
  skip++;
  console.log('⚠️ 未验证：本地不存在 config.json（干净克隆 / CI 环境）—— 副本身份判不出，跳过');
  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败 / ' + warn + ' 警告 / ' + skip + ' 跳过');
  process.exit(0);
}

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); }
catch (e) {
  console.log('❌ config.json 解析失败：' + e.message + '（坏配置必须显式报错，不许当空配置放行）');
  console.log('\n0 通过 / 1 失败 / 0 警告 / 0 跳过');
  process.exit(1);
}

const isReplica = (c) => String((c && c.pushRole) || 'primary') === 'replica';
const su = (c) => (c && c.syncUpstream) || {};

// 形态判定：有 syncUpstream 且启用、且 url 指向别处 → 本机是副本
const isReplicaShape = !!(su(cfg).enabled && su(cfg).url);

console.log('=== 实例形态 ===');
console.log('   pushRole =', JSON.stringify(cfg.pushRole));
console.log('   syncUpstream =', su(cfg).enabled ? ('已启用 → ' + su(cfg).url) : '未启用');
console.log('   判定 =', isReplicaShape ? '副本形态（本机必须 replica）' : '独立/线上形态（primary 正确）');
console.log('');

if (isReplicaShape) {
  ok(Object.prototype.hasOwnProperty.call(cfg, 'pushRole'),
    '副本形态：config.json 显式带 pushRole 键（不许缺省 —— 缺省值是 primary，等于本机抢推送）');
  ok(isReplica(cfg),
    '副本形态：pushRole=replica（本机永远是副本，绝不能和线上抢推送）',
    '当前 pushRole=' + JSON.stringify(cfg.pushRole) + '；缺 pushRole 键会被 server.js:7688 判成 primary → 双推');
  ok(!!String(su(cfg).token || '').trim(),
    'syncUpstream 带令牌（转发不断流）',
    '缺失会导致副本的写操作推不上去');
  ok(/^https?:\/\//.test(String(su(cfg).url || '')),
    'syncUpstream.url 指向线上 primary（http/https 绝对地址）');
} else {
  warnMsg('独立/线上形态：本次不判 pushRole（线上 primary 缺 pushRole 键是正确的，判它就是假红）');
  warnMsg('独立/线上形态：本次不判 syncUpstream（独立实例本来就不转发）');
}

// ⛔ 三条反证：证明上面的判据不是恒绿
{
  const fake = { pushRole: undefined, syncUpstream: { enabled: true, url: 'https://x' } };
  ok(isReplica(fake) === false,
    '反证：缺 pushRole 键的形态判成 primary（双推形态被复现）');
  ok(isReplica({ pushRole: 'primary' }) === false,
    '反证：显式 pushRole=primary 同样判成 primary（不是只有缺键才炸）');
  ok(isReplica({ pushRole: 'replica' }) === true,
    '反证：显式 pushRole=replica 才放行');
}
{
  // 反证：形态判定本身不是恒真 —— 把 syncUpstream 关掉，形态必须翻成独立
  const off = { pushRole: 'primary', syncUpstream: { enabled: false, url: 'https://x' } };
  const shapeOff = !!(su(off).enabled && su(off).url);
  ok(shapeOff === false,
    '反证：syncUpstream 关闭 → 形态判成独立（不会把线上 primary 拉进副本判据）');
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败 / ' + warn + ' 警告 / ' + skip + ' 跳过');
process.exit(fail ? 1 : 0);
