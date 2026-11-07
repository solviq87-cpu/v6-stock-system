'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'reference-dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'assets', 'v6-reference-dashboard.js'), 'utf8');
test('reference index endpoint requests the four expected mainland indices', () => {
  for (const code of ['sh000001','sz399001','sz399006','sh000688']) assert.ok(server.includes(code), `missing ${code}`);
  assert.match(server, /p === '\/api\/reference-indexes'/);
  assert.match(server, /source: 'tencent-qt'/);
});
test('index endpoint validates current and previous close and reports missing values', () => {
  assert.match(server, /Number\.isFinite\(current\).*current <= 0/);
  assert.match(server, /Number\.isFinite\(previous\).*previous <= 0/);
  assert.match(server, /missing: codes\.filter/);
  assert.match(server, /指数行情源超时/);
});
test('desktop and mobile index cards are populated only from the index endpoint', () => {
  assert.match(js, /get\('\/api\/reference-indexes'\)/);
  assert.match(js, /quote \? num\(quote\.price\) : '--'/);
  assert.match(js, /指数数据暂不可用/);
  assert.match(html, /data-index="kc50"/);
});
test('index feed state is included in the dashboard connection status', () => {
  assert.match(js, /指数 \$\{states\[3\]\}/);
  assert.match(html, /source-state/);
});
