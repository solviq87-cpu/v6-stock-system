'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
test('observed regime research endpoint requires POST and editor access',()=>{
 const p=server.indexOf("if (p === '/api/research/observed-regime')");
 assert.ok(p>0);const block=server.slice(p,p+1250);
 assert.match(block,/req\.method !== 'POST'/);
 assert.match(block,/requireEditor\(res,req\.__tok,req\)/);
});
test('observed regime endpoint bounds payload and uses source-bound classification',()=>{
 const p=server.indexOf("if (p === '/api/research/observed-regime')");
 const block=server.slice(p,p+1600);
 assert.match(block,/1024\*1024/);assert.match(block,/stocks\.length>6000/);
 assert.match(block,/V6ClassifyObservedMarket\(snap/);
 assert.match(block,/verifiedLive:false/);
});
test('original strategy dashboard remains separate from research classification',()=>{
 assert.match(server,/if \(p === '\/api\/strategy\/dashboard'\)/);
 assert.match(server,/rankCandidates\(\{ stocks, market \}\)/);
});
