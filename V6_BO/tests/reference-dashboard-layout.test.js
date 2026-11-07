'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/reference-dashboard.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/assets/v6-reference-dashboard.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/assets/v6-reference-dashboard.js'), 'utf8');
test('reference dashboard includes desktop top navigation and left sidebar', () => {
  assert.match(html, /class="topbar"/); assert.match(html, /class="sidebar"/); assert.match(css, /\.sidebar\{position:fixed/);
});
test('reference dashboard reproduces six desktop market cards and four summary panels', () => {
  assert.equal((html.match(/class="panel index"/g)||[]).length, 4);
  assert.match(html, /class="panel gauge"/); assert.match(html, /class="panel environment"/);
  assert.match(html, /class="panel ai-summary"/); assert.match(html, /class="panel strategy-count"/);
  assert.match(html, /class="panel risk"/); assert.match(html, /class="panel strategy-performance"/);
});
test('reference dashboard includes ranking, chart, diagnosis and mobile seven-item dock', () => {
  assert.match(html, /class="panel ranking"/); assert.match(html, /class="panel chart-panel"/); assert.match(html, /class="panel diagnosis"/);
  assert.equal((html.match(/class="ai" href=/g)||[]).length, 1);
  assert.match(html, /class="mobile-dock"/);
  assert.equal((html.match(/<small>(首页|自选股|行情|AI|模拟交易|风控|我的)<\/small>/g)||[]).length, 7);
});
test('mobile layout hides fourth index, adds risk card and aligns chart with diagnosis', () => {
  assert.match(css, /\.index:nth-child\(4\)\{display:none\}/);
  assert.match(css, /\.mobile-risk\{display:block/);
  assert.match(css, /\.right-stack\{grid-template-columns:1fr 1fr/);
});
test('preview labels data as unavailable rather than fabricating market values', () => {
  assert.match(html, /等待行情接口/); assert.match(html, /等待真实情绪数据/); assert.match(html, /等待真实 K 线数据/);
  assert.doesNotMatch(html, /3,078\.56|9,692\.34|1,784\.50|269\.80/);
});
test('reference preview links to existing V6 functional routes', () => {
  for (const route of ['/research.html','/#v6-strategy','/#v6-plan','/#v6-paper','/#v6-market','/#holdSec1']) assert.ok(html.includes(route), route);
  assert.match(js, /Asia\/Shanghai/);
});
