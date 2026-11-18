'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = (name) => fs.readFileSync(path.join(root,name),'utf8');

test('all four UI enhancements mount in one repo without replacing original app, account or quote guards', () => {
 for (const name of [
  'public/assets/feature-hub.js','public/assets/reference-portal.js',
  'public/assets/review-event-evidence.js','public/assets/mobile-review-bridge.js',
  'public/nova/terminal-workbench.js','public/assets/app.js',
  'server.js','em.js',
  'src/core/six-photo-backups.js'
 ]) assert.ok(fs.existsSync(path.join(root,name)),name);
 const loader = read('public/assets/original-workspace.js');
 assert.match(loader,/reference-portal\.js/);
 assert.match(loader,/live-home\.js/);
 assert.match(loader,/mobile-review-bridge\.js/);
 const reviewLoader = read('public/assets/ui-navigation.js');
 assert.match(reviewLoader,/review-event-evidence\.js/);
});

test('no second quote source or account write path is added by review and mobile presentation layers',()=>{
 for (const name of [
  'public/assets/reference-portal.js',
  'public/assets/mobile-review-bridge.js',
  'public/assets/review-event-evidence.js',
  'public/nova/terminal-workbench.js'
 ]) {
  const src=read(name);
  assert.doesNotMatch(src,/\/api\/(?:trade|orders?|paper\/execute)\b/,name);
 }
 const mobile=read('public/assets/mobile-review-bridge.js');
 const portal=read('public/assets/reference-portal.js');
 assert.doesNotMatch(mobile,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
 assert.doesNotMatch(portal,/\bfetch\s*\(|setInterval\s*\(/);
 assert.match(mobile,/getElementById\('ztMeta'\)/);
 assert.match(portal,/getElementById\(entry\.id\)/);
});

test('review source rankings and each distinct stock record are visible, without fabricating total count',()=>{
 const src=read('public/assets/reference-portal.js');
 for (const id of ['mainline','ztBySector','sectors']) assert.ok(src.includes("id:'"+id+"'"));
 assert.match(src,/const shown=new Set\(\)/);
 assert.match(src,/reviewSource\?\.querySelectorAll\('\.rvc'\)/);
 assert.match(src,/dataset\.reviewCode=code/);
 assert.match(src,/\.rv-evidence-trigger/);
 assert.doesNotMatch(src,/slice\(0,12\)/);
 assert.match(src,/不代表全市场涨停清单已独立核实/);
});

test('separate evidence remains permission-gated, time-grounded and not claimed as price-causality',()=>{
 const evidence=read('public/assets/review-event-evidence.js');
 assert.match(evidence,/15:00:00\+08:00/);
 assert.match(evidence,/Authorization:'Bearer '\+auth/);
 assert.match(evidence,/题材标签不得冒充已核实的涨停原因/);
 assert.match(evidence,/getRelToken/);
 assert.match(evidence,/reviewCutoff/);
 assert.match(evidence,/source-declared-unverified|verified:false/);
});

test('mobile uses existing login and digest and supports 402 CSS px plus desktop detail route',()=>{
 const mobile=read('public/mobile.html');
 const css=read('public/assets/mobile-review-bridge.css');
 const js=read('public/assets/mobile-review-bridge.js');
 assert.match(mobile,/id="gate"/);
 assert.match(mobile,/id="app"/);
 assert.match(mobile,/api\/mobile-digest/);
 assert.match(css,/min-width:390px/);
 assert.match(css,/max-width:430px/);
 assert.match(js,/\/#v6-review/);
 assert.match(js,/\/#sectors/);
 assert.match(js,/\/#holdSec1/);
 assert.match(js,/source:retained\?/);
});

test('FAYO terminal restores multi-module navigation and offline never caches private APIs',()=>{
 const nova=read('public/nova/app.js');
 const sw=read('public/sw.js');
 const terminal=read('public/nova/terminal-workbench.js');
 assert.match(nova,/terminal-workbench\.js/);
 assert.match(nova,/renderTerminalOverview/);
 assert.match(nova,/V6 原业务功能导航/);
 assert.match(terminal,/renderTerminalOverview/);
 assert.match(terminal,/仅按当前复盘明细的题材归组/);
 assert.match(sw,/\/nova\/terminal-workbench\.js/);
 assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
 assert.match(sw,/event\.respondWith\(networkOnly\(request\)\)/);
});
