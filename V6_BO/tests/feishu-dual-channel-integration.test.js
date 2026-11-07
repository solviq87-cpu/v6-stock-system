const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
test('private/public webhook environment overrides are wired', () => {
 assert.match(s, /process\.env\.V6_FEISHU_PRIVATE_WEBHOOK/);
 assert.match(s, /process\.env\.V6_FEISHU_PUBLIC_WEBHOOK/);
 assert.match(s, /process\.env\.V6_FEISHU_PRIVATE_SECRET/);
});
test('OTP never uses public fallback', () => {
 const section=s.slice(s.indexOf('function pushVerifyCode('), s.indexOf('function pushVerifyCode(')+1450);
 assert.match(section, /feishuSecReady\(\)/);
 assert.match(section, /feishuProbe\(feishuSecId\(\)/);
 assert.doesNotMatch(section, /feishuSend\(|pushAll\(/);
});
