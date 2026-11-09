const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const desktop = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'public/mobile.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/assets/v6-reference-precision.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/assets/v6-reference-precision.js'), 'utf8');
test('desktop reference hero binds only existing live application state', () => {
  for (const id of ['v6RefMarket','v6RefMood','v6RefPool','v6RefStrategy','v6RefDate']) assert.ok(desktop.includes(`id="${id}"`), id);
  for (const id of ['mkt','tickinfo','moodBox','poolInfo','strategySummary']) assert.ok(js.includes(`'${id}'`), id);
  assert.match(js, /Asia\/Shanghai/);
});
test('desktop reference composition has five responsive live summary tiles', () => {
  assert.match(desktop, /v6-reference-hero/);
  assert.match(desktop, /v6-ref-metrics/);
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(min-width:1100px\)/);
});
test('mobile reference header and horizontal feature navigation are present', () => {
  for (const id of ['v6-mobile-logo','v6-mobile-reference-nav','v6-mobile-actions']) assert.ok(mobile.includes(id) || css.includes(id), id);
  for (const href of ['/research.html','./#v6-strategy','./#v6-plan','./#v6-market','./#v6-paper']) assert.ok(mobile.includes(`href="${href}"`), href);
});
test('mobile bottom dock has seven real destinations and refresh action', () => {
  const start = mobile.indexOf('class="bar v6-mobile-bottom-nav"');
  const end = mobile.indexOf('</div>\n</div>', start);
  const dock = mobile.slice(start, end);
  assert.equal((dock.match(/<a\s/g)||[]).length, 7);
  assert.match(dock, /onclick="manualMobileRefresh\\(\\)"/);
  assert.match(mobile, /function manualMobileRefresh\\(\\)/);
  assert.match(css, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
});
test('new reference layer is loaded after prior styles without removing legacy runtime', () => {
  assert.match(desktop, /v6-reference-precision\.css\?v=20261105ref3/);
  assert.match(mobile, /v6-reference-precision\.css\?v=20261105ref3/);
  assert.match(desktop, /v6-reference-precision\.js\?v=20261105ref3/);
  assert.match(mobile, /async function load\(\)/);
  assert.match(mobile, /function switchTab|switchTab\(/);
});
