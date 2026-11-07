// 持仓清空提醒「降噪」守门测试（2026-10-06 用户："不用总推持仓已清空"）
// 实测 10/5 凌晨 00:16~03:50 手机收到十几条「🗑 持仓已清空」，其中 00:57:34/00:57:36、
// 02:32:06/02:32:06 是相隔 2 秒的【成对重复】。两个原因叠加：
//   ① 副本实例照样外发：本机面板点清空 → 副本 pushAll 因 _manual 放行发出一条，
//      同时 syncUpstream 把这次操作转发到线上再执行一次 → 线上又发一条。
//   ② 没有任何节流：短时间内反复清空（误触连点 / 脚本循环）就一条一条刷。
// 修法：副本闭嘴 + 30 分钟节流。⚠️ 留痕(commit)必须照常，不能因为不推送就不记账 ——
// 面板「变更记录」还能一键还原，这才是这条提醒的真正兜底。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const h = fs.readFileSync(path.join(ROOT, 'holdings.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}

// 1) isReplica 注入链：server.js 传进去，holdings.js 接得住（缺任一环 = 副本照发，噪声减半失败）
ok('server.js 把 isReplica 注入持仓模块', /createHoldings\(\{[^}]*isReplica/.test(s));
ok('holdings.js 从 dep 接住 isReplica', /const \{[^}]*isReplica[^}]*\} = dep;/.test(h));

// 2) 副本不推
ok('clearAll 判副本后不外发', /const _repl = typeof isReplica === 'function' \? isReplica\(\) : false;/.test(h));
ok('副本分支明确写明"线上那条才是权威"', /_repl\)[\s\S]{0,200}线上那条才是权威/.test(h));

// 3) 30 分钟节流
ok('clearAll 有 30 分钟节流变量', /let _lastClearPushAt = 0;/.test(h));
ok('节流窗口为 30 分钟', /_now - _lastClearPushAt < 30 \* 60 \* 1000/.test(h));
ok('命中节流时只留痕不刷手机', /清空提醒 30 分钟内已发过，本次只留痕、不再刷手机/.test(h));

// 4) ⛔ 留痕必须在推送判断【之前】：不能因为省推送就不记账，否则一键还原失效
const iCommit = h.indexOf("commit('clear', before, HOLD.items");
const iRepl = h.indexOf('const _repl = typeof isReplica');
ok('commit 留痕排在降噪判断之前（一键还原不受影响）', iCommit >= 0 && iRepl > iCommit);

// 5) 只在真的清掉了持仓时才谈推送（n>0 前置条件仍在）
ok('n>0 才进推送分支（空仓清空不发）', /if \(n > 0\) \{\s*\n\s*commit\('clear'/.test(h));

for (const f of ['server.js', 'holdings.js']) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  ok(f + ' 保持 LF（无 CRLF）', buf.indexOf(Buffer.from('\r\n')) === -1);
}

console.log(`\n持仓清空降噪守门：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
