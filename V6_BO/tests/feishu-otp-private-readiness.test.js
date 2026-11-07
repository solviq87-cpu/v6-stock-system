'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = src.indexOf("if (p === '/api/lock/forgot'");
const end = src.indexOf("if (p === '/api/lock/verify-code'", start);
const forgot = src.slice(start, end);
test('forgot-password requires SMS or private Feishu readiness instead of public or email', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(forgot, /if \(!smsGateway.ready && !feishuSecReady\(\)/);
  assert.doesNotMatch(forgot, /if \(!feishuReady\(\) && !mailReady\(\)\)/);
});
test('OTP dispatch is not falsely reported as confirmed delivery', () => {
  assert.match(forgot, /尚未确认送达/);
  assert.doesNotMatch(forgot, /验证码已推送到绑定手机/);
});
test('local OTP echo is gated behind explicit replica-only development setting', () => {
  assert.match(forgot, /QD_ALLOW_LOCAL_DEV_OTP === '1' && isReplica\(\) && isLocalReq\(req\)/);
});
