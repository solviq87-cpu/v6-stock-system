'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
test('private webhook disable message never claims public OTP fallback', () => {
  assert.match(src, /已停用安全通道（验证码及私密消息将停止发送，不会退回公共群）/);
  assert.doesNotMatch(src, /验证码改发群机器人|停用安全通道 → 退回群机器人/);
});
test('both webhook config inputs require exact Feishu HTTPS endpoint', () => {
  assert.match(src, /fv\.match\(\/\^https:/);
  assert.match(src, /sv\.match\(\/\^https:/);
  assert.match(src, /open\\\.feishu\\\.cn/);
});
test('private push remains isolated regardless of mustDeliver', () => {
  assert.match(src, /Private content is never eligible for a public fallback, including mustDeliver/);
  assert.match(src, /if \(opts && opts\.private\)/);
});
