'use strict';
// 渠道健壮性（fw 轮）：网络错误分类 classifyNetErr 单测。
// 限流(rate)须走全局冷却；瞬时出网(egress)走快速重试+抖动；其它(坏 json 等)立即抛不重试。
const { classifyNetErr } = require('./em');
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

ok('限流(rate) → rate', classifyNetErr('http 429 rate limit') === 'rate');
ok('限流(中文) → rate', classifyNetErr('被限流了') === 'rate');
ok('socket hang up → egress', classifyNetErr('socket hang up') === 'egress');
ok('ECONNRESET → egress', classifyNetErr('Error: ECONNRESET') === 'egress');
ok('timeout → egress', classifyNetErr('timeout qt.gtimg.cn') === 'egress');
ok('ETIMEDOUT → egress', classifyNetErr('connect ETIMEDOUT') === 'egress');
ok('ENOTFOUND → egress', classifyNetErr('getaddrinfo ENOTFOUND') === 'egress');
ok('ECONNREFUSED → egress', classifyNetErr('ECONNREFUSED 127.0.0.1') === 'egress');
ok('坏 json（其它） → other', classifyNetErr('bad json from https://x') === 'other');
ok('未知错误 → other', classifyNetErr('something weird') === 'other');
// 边界：egress 关键字不能误吞限流
ok('rate 优先于 socket', classifyNetErr('rate limited socket busy') === 'rate');

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
