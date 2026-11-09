'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeCurrentPicks}=require('../src/core/quant-picks-eod-freeze');
const {evaluateForward}=require('../src/core/forward-signal-observer');
const {publish,main}=require('../scripts/freeze-quant-picks');
const at=(day,clock='16:03:00')=>Date.parse(day+'T'+clock+'+08:00');
const day='2026-11-09',now=at(day,'16:04:00');
function fixture(){
 const market={
  schemaVersion:1,feed:{source:'imported',provider:'unit-test-source-not-externally-certified',
   datasetId:'private-same-day-close',priceBasis:'unadjusted'},
  asOf:day,observedAt:at(day,'16:03:30'),
  calendar:['2026-11-02',day],stocks:[
   {symbol:'600001',corporateActions:[],bars:[
    {date:'2026-11-02',close:8,volume:100,suspended:false},
    {date:day,close:10,volume:200,suspended:false}]},
   {symbol:'000002',corporateActions:[],bars:[
    {date:'2026-11-02',close:18,volume:100,suspended:false},
    {date:day,close:20,volume:200,suspended:false}]}
  ]
 };
 const candidates={
  asOf:at(day),board:'all',totalScanned:5000,count:2,items:[
   {code:'600001',name:'甲',price:999,score:100,
    hit:[{id:1,text:'条件1：经快照核对的原始证据'},{id:2,text:'条件2：不同命中规则'}],hitIds:[1,2]},
   {code:'000002',name:'乙',price:1000,hit:[{id:3,text:'条件3：原始命中证据'}],hitIds:[3]}
  ]
 };
 return {candidates,market};
}
function temp(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-picks-freeze-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
}
test('same-day fresh candidates become 3 immutable research signals with separately sourced closes',()=>{
 const {candidates,market}=fixture();
 const frozen=freezeCurrentPicks(candidates,market,{now});
 assert.equal(frozen.mode,'frozen-forward-signal-cohort');
 assert.equal(frozen.signals.length,3);
 assert.equal(frozen.prospectiveCertified,false);
 assert.equal(frozen.canTrade,false);
 assert.deepEqual(frozen.signals.map(x=>x.baselineClose),[10,10,20],
  'ignore quote/score fields; use authorized EOD market close only');
 assert.deepEqual(frozen.signals.map(x=>x.system),['manual','manual','manual']);
 assert.ok(frozen.signals.every(x=>x.signalDate===day&&x.signalAt===candidates.asOf));
 assert.notEqual(frozen.signals[0].signalId,frozen.signals[1].signalId,
  'same symbol with different matched conditions stays separate');
 assert.equal(evaluateForward(frozen,market,{now}).records.length,3,
  'frozen JSON must satisfy the unchanged forward observer contract');
});
test('stale, prior-day, future or before-16:00 candidates fail closed',()=>{
 const {candidates,market}=fixture();
 for(const change of [
  {asOf:at(day,'15:59:59')},
  {asOf:at(day,'15:58:00')},
  {asOf:at('2026-11-06','16:03:00')},
  {asOf:now+1000},
  {asOf:now-5*60*1000-1},
  {locked:true},
  {simulated:true},
  {isMock:true},
  {ok:false},
  {items:[]},
  {count:0}
 ])assert.throws(()=>freezeCurrentPicks({...candidates,...change},market,{now}));
 assert.throws(()=>freezeCurrentPicks(candidates,market,{now:at(day,'15:59:59')}));
});
test('market EOD evidence must be imported, same-day, later than candidate and complete',()=>{
 const {candidates,market}=fixture();
 const variations=[
  {feed:{...market.feed,source:'fixture'}},
  {feed:{...market.feed,source:'simulated'}},
  {feed:{...market.feed,priceBasis:'adjusted'}},
  {asOf:'2026-11-06'},
  {observedAt:candidates.asOf-1},
  {observedAt:now+1000},
  {calendar:['2026-11-02']}
 ];
 for(const change of variations)
  assert.throws(()=>freezeCurrentPicks(candidates,{...market,...change},{now}));
 const missing=structuredClone(market);missing.stocks[0].bars[1].close=null;
 assert.throws(()=>freezeCurrentPicks(candidates,missing,{now}));
 const suspended=structuredClone(market);suspended.stocks[0].bars[1].suspended=true;
 assert.throws(()=>freezeCurrentPicks(candidates,suspended,{now}));
 const wrong=structuredClone(market);wrong.stocks[0].bars[1].volume=0;
 assert.throws(()=>freezeCurrentPicks(candidates,wrong,{now}));
});
test('mismatched reasons, duplicate codes, duplicate conditions and invalid fields are rejected',()=>{
 const {candidates,market}=fixture();
 const variants=[
  [{code:'600001',hit:[{id:1,text:'ok'},{id:1,text:'duplicate'}]}],
  [{code:'600001',hit:[{id:1,text:'ok'}]},{code:'600001',hit:[{id:2,text:'ok'}]}],
  [{code:'600001',hit:[]}],
  [{code:'600001',hit:[{id:7,text:'unsupported rule'}]}],
  [{code:'600001',hit:[{id:1,text:'ok'}],hitIds:[2]}],
  [{code:'600001',hit:[{id:1,text:'ok'}],hitIds:[1,2]}],
  [{code:'BADCODE',hit:[{id:1,text:'ok'}]}]
 ];
 for(const items of variants)assert.throws(()=>freezeCurrentPicks(
  {...candidates,items,count:Math.max(items.length,1)},market,{now}));
 const many=structuredClone(candidates);
 many.items=[{code:'600001',hit:Array.from({length:30},(_,i)=>({
  id:i+1,text:'condition'+i}))}];
 assert.throws(()=>freezeCurrentPicks(many,market,{now}),
  'unknown condition identifiers must not be silently accepted');
});
test('CLI publishes a new private 0600 file, never overwrites, never persists token',t=>{
 const root=temp(t),{candidates,market}=fixture();
 candidates.token='SENSITIVE_DO_NOT_PERSIST';
 const candidateFile=path.join(root,'candidates.json'),marketFile=path.join(root,'market.json');
 const outFile=path.join(root,'private','frozen.json');
 fs.writeFileSync(candidateFile,JSON.stringify(candidates));
 fs.writeFileSync(marketFile,JSON.stringify(market));
 const args={candidatesFile:candidateFile,marketFile,outFile,now};
 const result=publish(args);
 assert.equal(result.ok,true);assert.equal(result.signalCount,3);
 assert.equal(fs.statSync(outFile).mode&0o777,0o600);
 const raw=fs.readFileSync(outFile,'utf8');
 assert.ok(!raw.includes(candidates.token));
 assert.deepEqual(JSON.parse(raw).signals.map(s=>s.baselineClose),[10,10,20]);
 assert.throws(()=>publish(args),/EEXIST/);
 assert.equal(fs.readFileSync(outFile,'utf8'),raw);
 assert.throws(()=>main([]),/用法/);
 const link=path.join(root,'alias');fs.symlinkSync(path.join(root,'private'),link,'dir');
 assert.throws(()=>publish({...args,outFile:path.join(link,'more.json')}),/符号链接/);
 assert.throws(()=>publish({...args,outFile:path.join(root,'public','picks.json')}),/公开/);
});
