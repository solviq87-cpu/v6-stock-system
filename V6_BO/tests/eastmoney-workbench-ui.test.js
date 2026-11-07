'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/research.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/assets/research-workbench.js'),'utf8');
test('research workbench exposes on-demand public quote action and status',()=>{
 assert.match(html,/id="fetchLiveBreadth"/);assert.match(html,/id="liveBreadthStatus"/);assert.match(html,/id="liveBreadthSummary"/);
});
test('fetch action uses authenticated developer-only POST',()=>{
 assert.match(js,/fetch\('\/api\/research\/eastmoney-breadth'/);
 assert.match(js,/method:'POST'/);assert.match(js,/Authorization.*Bearer /);
});
test('feed failure and incomplete breadth cannot be shown as successful market conclusion',()=>{
 assert.match(js,/if\(!b\.usable\)/);assert.match(js,/行情宽度不可用/);assert.match(js,/联网行情失败/);
});
test('research UI labels public quote source and does not claim exchange-certified real-time',()=>{
 assert.match(html,/不自动推断涨跌停/);assert.match(js,/未认证为交易所实时行情/);
});
