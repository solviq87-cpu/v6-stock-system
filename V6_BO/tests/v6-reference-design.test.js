const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const desktop = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'public/mobile.html'), 'utf8');
const desktopCss = fs.readFileSync(path.join(root, 'public/assets/v6-reference-ui.css'), 'utf8');
const mobileCss = fs.readFileSync(path.join(root, 'public/assets/v6-mobile-reference.css'), 'utf8');
test('desktop loads dedicated reference theme after existing styles', () => {
  assert.match(desktop, /v6-reference-ui\.css\?v=20261105ref1/);
  assert.ok(desktop.indexOf('v6-reference-ui.css') > desktop.indexOf('v6-design.css'));
});
test('desktop navigation exposes existing business sections only', () => {
  const shell=fs.readFileSync(path.join(root,'public/assets/terminal-dashboard.js'),'utf8');
  for (const href of ['#v6-stock', '#v6-plan', '#v6-paper', '#v6-market', '#holdSec1', '/m']) assert.ok((desktop+shell).includes(href), href);
  assert.ok(shell.includes('#workspace-settings'),'settings entry owns the retained release/settings controls');
  for (const id of ['v6-stock','v6-plan','v6-paper','v6-market','holdSec1','v6-release']) assert.ok(desktop.includes(`id="${id}"`), id);
});
test('desktop theme contains dark terminal, left rail and responsive breakpoints', () => {
  assert.match(desktopCss, /\.v6-quick-nav\{position:fixed/);
  assert.match(desktopCss, /linear-gradient\(145deg/);
  assert.match(desktopCss, /@media\(max-width:900px\)/);
});
test('mobile loads reference theme and keeps original mobile runtime', () => {
  assert.match(mobile, /v6-mobile-reference\.css\?v=20261105ref1/);
  assert.match(mobile, /async function load\(\)/);
  assert.match(mobile, /function switchTab|switchTab\(/);
});
test('mobile bottom navigation uses real page destinations', () => {
  const foot = mobile.slice(mobile.indexOf('<div class="foot"'), mobile.indexOf('</div>\n\n<script>', mobile.indexOf('<div class="foot"')));
  for (const href of ['/m', '/picks.html', './#v6-market', './#v6-paper', './#holdSec1', '/#v6-release']) assert.ok(foot.includes(`href="${href}"`), href);
  assert.equal((foot.match(/<a /g)||[]).length,7);
  assert.match(mobile, /href="\/research\.html#decisionWorkspace"/); // Original developer workbench remains reachable.
  assert.match(foot, /onclick="manualMobileRefresh\(\)"/);
  assert.match(mobile, /function manualMobileRefresh\(\)/);
});
test('both themes preserve reduced motion and visible focus treatment', () => {
  assert.match(desktopCss, /prefers-reduced-motion/);
  assert.match(mobileCss, /prefers-reduced-motion/);
  assert.match(desktopCss, /focus-visible/);
});
