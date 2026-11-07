'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {quoteSnapshotFields:copy,quoteObservationView:view}=require('../src/core/quote-observation-view');
const {dashboardView}=require('../src/core/dashboard-view');
const now=Date.parse('2026-11-07T02:00:00+08:00');
const row={code:'600519',name:'样本',price:10,pct:1,quoteAt:now-1000,quoteSource:'tencent',receivedAt:now};
test('pool copy preserves the exact observation and excludes provider raw/private fields',()=>{
 const input={...row,secret:'DO_NOT_COPY',canTrade:true};const before=structuredClone(input);
 assert.deepEqual(copy(input),{quoteAt:row.quoteAt,quoteSource:'tencent',receivedAt:now});assert.deepEqual(input,before);
 assert.equal(copy({...row,canTrade:false}).canTrade,false);assert.equal(copy(input).canTrade,undefined);
});
test('missing evidence is not manufactured from receipt, current clock or another quote',()=>{
 const fields=copy({code:row.code,price:9,receivedAt:now});assert.equal(fields.quoteAt,null);assert.equal(fields.quoteSource,null);
 const d=dashboardView({candidatePool:[{...fields,code:row.code,price:9}],stocks:[row],stocksAt:now,lastPx:new Map([[row.code,{p:10,quoteAt:now,quoteSource:'tencent'}]])},null,now);
 assert.equal(d.rows[0].quoteStatus,'unknown');assert.equal(d.rows[0].price,9);
});
test('pool transfer retains stale and future timestamps for truthful display without refreshing them',()=>{
 for(const [quoteAt,status] of [[now-15000,'recent-unverified'],[now-15001,'stale'],[now+1,'future']]){
  const fields=copy({...row,quoteAt});assert.equal(fields.quoteAt,quoteAt);assert.equal(view({...row,...fields},now).quoteStatus,status);
 }
});
test('malformed provider metadata and invalid price cannot become verified pool observations',()=>{
 for(const patch of [{quoteAt:String(now)},{quoteAt:now+.1},{quoteAt:0},{quoteSource:{}},{quoteSource:' '},{price:Infinity},{price:0},{price:'10'}]){
  assert.equal(view({...row,...patch,...copy({...row,...patch})},now).quoteStatus,'unknown');
 }
});
// Run the actual price+metadata prefix from each production pool constructor.
for(const [label,marker] of [['精选池','scored.push({\n'],['连阳池','if (t && t.steadyRun) syRaw.push({'],['趋势池','trend.push({']]){
 test(label+' production constructor keeps price and provider evidence bound to the same source row',()=>{
  const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
  const start=source.indexOf(marker);assert.ok(start>=0);const body=source.slice(start+marker.length);
  const end=body.indexOf('\n',body.indexOf('code: s.code'));assert.ok(end>=0);
  const prefix=body.slice(0,end);assert.match(prefix,/quoteSnapshotFields\(s\)/);
  const c={s:{...row},require:id=>{assert.equal(id,'./src/core/quote-observation-view');return {quoteSnapshotFields:copy};}};vm.createContext(c);
  const pooled=vm.runInContext('({'+prefix+'})',c);
  assert.equal(pooled.price,row.price);assert.equal(pooled.quoteAt,row.quoteAt);assert.equal(pooled.quoteSource,row.quoteSource);
  c.s.price=99;c.s.quoteAt=now;assert.equal(pooled.price,10);assert.equal(pooled.quoteAt,now-1000);
  const d=dashboardView({candidatePool:[pooled],stocks:[c.s],stocksAt:now},null,now+15001);
  assert.equal(d.rows[0].quoteStatus,'stale');assert.equal(d.rows[0].price,10);assert.equal(d.rows[0].canTrade,false);
 });
}
