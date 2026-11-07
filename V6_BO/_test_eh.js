// 守门：eh 轮 —— 推送文案与消息幂等性
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 推送文案与消息幂等性（eh 轮）守门 ===\n');

// ---------- ① healSignArtifact 存在且在启动时执行 ----------
console.log('【① healSignArtifact 自愈】');
ok('healSignArtifact 函数存在', /function healSignArtifact\(/.test(SRC));
ok('healSignArtifact 在启动时执行', /healSignArtifact\(\);/.test(SRC));
ok('healSignArtifact 修正 +- 模式', /replace\(\/ \\\+\(-\[\\d\.\]\+\)\/g/.test(SRC));
ok('healSignArtifact 修正后落盘', /saveLearnHistory\(\)/.test(SRC));

// ---------- ② pushedToday 幂等性 ----------
console.log('\n【② pushedToday 幂等性】');
ok('pushedToday 存在', /function pushedToday\(/.test(SRC));
// ⛔ fz 轮换判据：原判据钉的是 `indexOf('✅') !== 0` 这个**字面量**，而 fz 轮把它改成
//    「✅ 开头 **或** 送达结果未知」才算已外发（超时/断连发的那条也算外发过，否则换 worker 就重推），
//    写法变成 `=== 0` 后旧正则失配 → 假红。语义没退：仍然只认"已经外发过"这两类，
//    「发送失败/未配置/闸门拦截/静默」一律不算（见下面"排除未发送"与 _test_push_unknown.js [4] 组）。
// hw 轮：判据从 pushedToday 内联收口到共享函数 pushIsOutStatus（与 pushLog 同一把尺子），
//   所以「✅ 开头 / 送达结果未知 / 排除未发送」三条语义现在都写在那个函数里。
ok('pushedToday 只认「已外发过」：✅ 开头 或 送达结果未知',
  /function pushIsOutStatus\(st\)/.test(SRC) && /pushIsOutStatus\(_st\)/.test(SRC)
  && /\\u2705'\) === 0/.test(SRC) && /送达结果未知/.test(SRC));
ok('pushedToday 排除未发送', /indexOf\('未发送'\)/.test(SRC));
ok('pushedToday 有容量告警', /pushLogCoversToday/.test(SRC));
ok('sentLockFromPushLog 存在', /function sentLockFromPushLog\(/.test(SRC));

// ---------- ③ 关键推送闭锁变量 ----------
console.log('\n【③ 关键推送闭锁变量】');
ok('reviewSentDate 存在', /reviewSentDate/.test(SRC));
ok('nextPlanSentDate 存在', /nextPlanSentDate/.test(SRC));
ok('auctionSentDate 存在', /auctionSentDate/.test(SRC));
ok('digestSentDate 存在', /digestSentDate/.test(SRC));
ok('weekendSentDate 存在', /weekendSentDate/.test(SRC));

// ---------- ④ pushAll 降级与状态记录 ----------
console.log('\n【④ pushAll 真实结果记录】');
ok('pushAll 有 _pushLast 记录', /_pushLast\s*=/.test(SRC));
ok('pushAll 返回布尔或对象', /return\s+(?:true|false|_pushLast)/.test(SRC));
ok('pushLast() 暴露给 state', /pushLast:\s*pushLast\(\)/.test(SRC));

// ---------- ⑤ 私密推送标记 ----------
console.log('\n【⑤ 私密推送标记】');
ok('pushAll 支持 opts.private', /opts\.private|private:\s*true/.test(SRC));
ok('pushAll 支持 opts.sseEdit', /opts\.sseEdit|sseEdit:\s*true/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
