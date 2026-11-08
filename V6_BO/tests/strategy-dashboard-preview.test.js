'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {catalogueFromSnapshot,createCatalogueHandler}=require('../src/server/strategy-dashboard-preview');
function fakeDeps(){
 return {
  scanUniverse:({stocks})=>({items:stocks.map(x=>({
    symbol:x.code,name:x.name,score:78,patternDate:'2026-11-06',tradable:true,
    quality:{usable:true,fresh:true},patterns:{checks:[
      {id:'red_three_soldiers',status:x.code==='000001'?'matched':'not_matched'}]}
  }))}),
  evaluateCandidate:({stock})=>({strategies:[{name:'trend',pass:stock.code==='000001'}],
    playbookAnalysis:{playbooks:[{id:'platform_breakout',status:stock.code==='000002'?'candidate':'not_matched'}]}})
 };
}
test('strategy catalogue returns per-stock evidence without cross attribution',()=>{
 const out=catalogueFromSnapshot({asOfMs:1794000000000,stocks:[
  {code:'000001',name:'测试A'},{code:'000002',name:'测试B'}]},fakeDeps());
 assert.equal(out.items.length,2);
 assert.deepEqual(out.items[0].matchedIds,['base:trend','pattern:red_three_soldiers']);
 assert.deepEqual(out.items[1].matchedIds,['playbook:platform_breakout']);
 assert.ok(out.catalog.some(s=>s.id==='planned:dual_momentum'&&s.status==='not-integrated'));
});
test('unconfigured snapshot exposes zero stocks, never demonstration picks',()=>{
 let status=0,body='',headers={};
 const response={setHeader:(k,v)=>headers[k]=v,writeHead:n=>status=n,end:s=>body=s};
 const route=createCatalogueHandler();
 assert.equal(route({method:'GET',url:'/api/dashboard-strategy-catalog'},response),true);
 assert.equal(status,200);
 assert.equal(JSON.parse(body).items.length,0);
 assert.equal(JSON.parse(body).source,'unconfigured');
 assert.equal(headers['cache-control'],'no-store');
 assert.equal(route({method:'POST',url:'/api/dashboard-strategy-catalog'},response),false);
});
test('invalid snapshot is an explicit error',()=>{
 assert.throws(()=>catalogueFromSnapshot({stocks:null},fakeDeps()),/snapshot.stocks/);
});
