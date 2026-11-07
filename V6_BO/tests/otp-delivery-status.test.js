'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const sender = s.slice(s.indexOf('function pushVerifyCode('), s.indexOf('// 把「访问链接', s.indexOf('function pushVerifyCode(')));
const forgot = s.slice(s.indexOf("if (p === '/api/lock/forgot'"), s.indexOf("if (p === '/api/lock/otp-delivery'"));
const status = s.slice(s.indexOf("if (p === '/api/lock/otp-delivery'"), s.indexOf("if (p === '/api/lock/verify-code'"));
test('OTP private delivery reports pending/accepted/failed/unknown without public fallback', () => {
 assert.match(sender, /onDelivery\('accepted'|onDelivery\(status/);
 assert.match(sender, /'failed'/);
 assert.match(sender, /'unknown'/);
 assert.doesNotMatch(sender, /feishuSend\(|pushAll\(/);
});
test('OTP delivery state follows live ticket and is exposed without OTP code', () => {
 assert.match(forgot, /deliveryStatus: 'not_sent'/);
 assert.match(forgot, /deliveryStatus = 'pending'/);
 assert.match(forgot, /active\.ip === ip && active\.exp > Date\.now\(\)/);
 assert.match(status, /rec\.ip !== clientIp\(req\)/);
 assert.match(status, /rec\.exp <= Date\.now\(\)/);
 assert.doesNotMatch(status, /code: rec\.code|devCode/);
});
test('OTP delivery route included in authentication request handling', () => {
 assert.match(s, /p === '\/api\/lock\/otp-delivery' \|\| p === '\/api\/lock\/verify-code'/);
});
