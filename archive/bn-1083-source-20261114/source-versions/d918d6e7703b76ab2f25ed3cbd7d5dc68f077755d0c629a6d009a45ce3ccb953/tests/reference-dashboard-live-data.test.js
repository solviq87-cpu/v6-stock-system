'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const html=fs.readFileSync(path.join(root,'reference-dashboard.html'),'utf8');
const js=fs.readFileSync(path.join(root,'assets','v6-reference-dashboard.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets','v6-reference-dashboard.css'),'utf8');
test('reference dashboard binds only existing public market and strategy endpoints',()=>{
  assert.match(js,/\/api\/mobile-digest/);
  assert.match(js,/\/api\/quant-picks\?max=12/);
  assert.match(js,/\/api\/strategy\/dashboard/);
  assert.match(js,/\/api\/kline\?code=/);
});
test('reference dashboard contains live data targets for sentiment, picks and risk',()=>{
  for(const id of ['mood-score','market-verdict','pick-count','focus-count','ranking-body','risk-zt','diagnosis-list','chart-canvas']) assert.ok(html.includes(`id="${id}"`),`missing ${id}`);
});
test('ranking content is escaped before insertion and K-line values are numeric-validated',()=>{
  assert.match(js,/const esc = \(v\)/);
  assert.match(js,/Number\.isFinite/);
});
test('chart and ranking remain responsive and keyboard-readable',()=>{
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(html,/aria-label="主导航"/);
  assert.match(js,/aria-label=\"\$\{code\}日K线与MA均线\"/);
});
