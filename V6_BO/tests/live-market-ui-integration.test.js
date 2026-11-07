'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/assets/research-workbench.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
test('single-request research control and result surfaces exist',()=>{
 for(const id of ['fetchLiveMarket','liveMarketPayload','liveMarketStatus','liveMarketSummary','liveMarketCandidates'])assert.ok(html.includes('id="'+id+'"'));
});
test('client invokes authenticated research endpoint and preserves source labels',()=>{
 assert.match(js,/fetch\('\/api\/research\/live-market'/);
 assert.match(js,/Authorization.*Bearer/);
 assert.match(js,/candidateScore/);assert.match(js,/quoteDate/);assert.match(js,/quoteTimeVerified|未认证为交易所实时行情/);
});
test('server joins only server-side candidates and enforces editor access',()=>{
 const i=server.indexOf("if (p === '/api/research/live-market')");assert.ok(i>0);
 const block=server.slice(i,i+900);assert.match(block,/requireEditor/);assert.match(block,/S\.candidatePool/);
 assert.doesNotMatch(block,/candidates:payload\.candidates/);
});
test('client rejects failures and escapes table cells',()=>{
 assert.match(js,/if\(!response\.ok\|\|!data\.ok\)/);
 assert.match(js,/esc\(x\.name\)/);assert.match(js,/esc\(x\.code\)/);
});
