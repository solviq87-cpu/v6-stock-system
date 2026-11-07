// 守门测试：「找回密码」不得把本人自己的设备全部踢下线（用户反馈「总弹密码找回」的根因）
//
// 事故复盘：
//   /api/lock/reset-pwd 原本 devices:{} + gen:+1 双管齐下，
//   源码注释却写着「设备令牌保留，本人常用设备不受影响」—— 注释是假的。
//   后果是一条自我强化的死循环：
//     找回 → 手机上那枚长期令牌当场作废 → 下次打开又是登录页（页面底部挂着「🔑 忘记开发者密码？」）
//          → 再点找回 → 再重置 → 再把自己踢掉 ……
//   实测线上世代号已被推到第 4 代，正好对应这条循环。
//
// 语义区分（本文件锁死的就是这个区分）：
//   找回密码 = 本人用绑定手机号验证后换一把自己忘掉的钥匙 → 不该踢人（默认）
//   主动改密 = 怀疑钥匙外泄，明确换锁                → 必须全网下线（change(edit) / kick=true）
//
// 之所以用「源码静态断言」而不是真跑一遍 HTTP：真跑会把本机 access.json 的口令改掉，
// 一旦测试中途失败，本机/发布脚本的口令就留在了错的状态，代价太大。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '✅ ' : '❌ ') + m); };

const srv = read('server.js');
const html = read('public/index.html');

// 截取 reset-pwd 路由整段（下一个同级 if 路由之前）
const cut = (src, startMark, endMark) => {
  const i = src.indexOf(startMark);
  if (i < 0) return '';
  const j = src.indexOf(endMark, i + startMark.length);
  return j < 0 ? src.slice(i) : src.slice(i, j);
};
// 去掉行注释再断言：事故复盘写进注释里的 `devices:{}` 字面量会把「不得出现」的断言误伤。
const strip = src => src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
const resetBlk = strip(cut(srv, "if (p === '/api/lock/reset-pwd'", "if (p === '/api/lock/bind-phone'"));
const changeBlk = strip(cut(srv, "if (p === '/api/lock/change'", '// ---------------- 只读设备'));

console.log('=== ① 找回密码：不踢设备、不 bump 世代 ===');
ok(resetBlk.length > 500, '能截到 reset-pwd 整段代码（' + resetBlk.length + ' 字符）');
ok(!/gen:\s*_devGenBump\(/.test(resetBlk), 'reset-pwd 不得【无条件】bump 世代号');
ok(/gen:\s*kick\s*\?\s*_devGenBump\('edit'\)\s*:\s*keepGen/.test(resetBlk),
  '世代号只在显式 kick（全网下线）时才 +1，默认沿用原值');
ok(!/devices:\s*\{\}/.test(resetBlk), '不得【无条件】清空设备台账 devices:{}');
ok(/devices:\s*kick\s*\?\s*\{\}\s*:\s*keepDevices/.test(resetBlk), '设备台账只在 kick 时才清空，默认保留');
ok(/revoked:\s*keepRevoked/.test(resetBlk),
  'revoked 名单必须接着传下去（否则被手动撤销过的旧令牌会"复活"回台账）');
ok(/issueDevice\(/.test(resetBlk), '找回的这台设备当场签发长期令牌（省掉前端二次 trust 的往返）');
ok(/deviceToken:\s*devTok/.test(resetBlk), '响应体带上 deviceToken，前端可直接 applyToken');
ok(/keptDevices/.test(resetBlk) && /已授权设备保持登录/.test(resetBlk), '返回里明确告知"多少台设备保持登录"');
ok(/kick\s*=\s*\(\s*b\.kick\s*===\s*true\s*\|\|/.test(resetBlk), 'kick 开关可被前端/面板显式打开');

console.log('\n=== ② 主动改密：必须全网下线（防止有人把两条一起"顺手"改掉）===');
ok(/gen:\s*_devGenBump\('edit'\)/.test(changeBlk), 'change(edit) 仍然 bump 世代号 → 旧令牌作废');
ok(/devices:\s*\{\}/.test(changeBlk), 'change(edit) 仍然清空设备台账');

console.log('\n=== ③ 前端：找回入口不再无条件挂在登录页上 ===');
const gateBlk = cut(html, 'function showGate(msg)', 'async function gateSubmit');
ok(gateBlk.length > 300, '能截到 showGate 整段（' + gateBlk.length + ' 字符）');
ok(/id="gateForgot"[^>]*display:none/.test(gateBlk), '「忘记开发者密码」按钮初始隐藏');
ok(/fgMaybeShow\(\)/.test(gateBlk), 'showGate 每次都调 fgMaybeShow 决定是否露出');
const fgBlk = cut(html, 'async function fgMaybeShow', 'function showForgot');
ok(/btn\.style\.display\s*=\s*FG\.bound\s*\?\s*''\s*:\s*'none'/.test(fgBlk),
  '只有查到已绑定找回手机号才显示该入口');
ok(/fgReset[\s\S]*r\.deviceToken[\s\S]*applyToken/.test(cut(html, 'async function fgReset', '// ───────── 实时通道')),
  'fgReset 优先用 reset-pwd 直接回的 deviceToken 进入');

console.log('\n=== ④ 上线后能自查（不用再靠猜）===');
const stBlk = cut(srv, "if (p === '/api/lock/status')", "if (p === '/api/lock/setup'");
ok(/gen:\s*Number\(\(accessSecret && accessSecret\.gen\)/.test(stBlk), 'lock/status 对开发者返回当前世代号');
ok(/viewGen/.test(stBlk), '同时返回只读世代号');
ok(/role0 === 'edit'/.test(stBlk), '世代号只对已验证的开发者可见（不对匿名者暴露）');

console.log(`\n通过 ${pass} / ${pass + fail}`);
if (fail) process.exit(1);
