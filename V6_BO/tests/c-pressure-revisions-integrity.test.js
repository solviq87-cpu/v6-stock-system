'use strict';
// Synthetic replay fixtures: no live feed, account or execution permission.
const test=require('node:test'),assert=require('node:assert/strict');
const mod=import('../public/nova/shortline/pressure.mjs');
const code='600000',day='2026-11-20',t=Date.parse(day+'T15:16:00+08:00'),close=Date.parse(day+'T15:00:00+08:00');
const fact=(extra={})=>({id:'goodwill/'+code,code,category:'商誉',source:'披露资料',description:'原财报字段',eventDay:'2026-09-30',
 publishedAt:t-10,knownAt:t,expires:'2027-09-30',verified:true,value:35,unit:'%净资产',riskTag:'高商誉（≥30%净资产）',...extra});
const report=(facts,extra={})=>({code,day,knownAt:t,clues:[],facts,coverage:[],chipSeries:[],...extra});
const tag='压力·高商誉（≥30%净资产）';
const bar=(extra={})=>({code,date:day,period:'日K',priceBasis:'unadjusted',high:10,low:9,close:9.5,volume:1000,volumeUnit:'shares',knownAt:t,availableAt:t,chipPeak:9.8,chipSource:'原字段',...extra});
const chip=(extra={})=>({id:'chip/'+day+'/raw',code,date:day,kind:'raw',source:'原始筹码',peak:10,close:9.5,knownAt:t,...extra});
test('C7.1 missing or invalid archive receipt must not feed risk or historical learning',async()=>{
 const a=await mod;for(const knownAt of [null,0,-1,1.5,'1',close-86400000]){
  const r=report([fact()],{knownAt});const s={};a.mergePressureHistory(s,r);
  assert.equal((s.pressureHistory||[]).length,0);
  assert.equal(a.addPressureRiskFacts(r,code,t,new Map()).size,0);
  assert.deepEqual(a.pressureLearningTags({pressureHistory:[r]},{code,date:day},t),[]);
 }
});
test('C7.1 malformed row container and unknown receipt cannot enter the archive',async()=>{
 const a=await mod,s={};a.mergePressureHistory(s,report([null,fact({knownAt:0}),fact({knownAt:t+1}),fact()],{clues:{},coverage:null}));
 assert.equal(s.pressureHistory[0].facts.length,1);assert.equal(s.pressureHistory[0].facts[0].knownAt,t);
});
test('C7.1 original valid report retains its initial evidence and excludes another security',async()=>{
 const a=await mod,s={},r=report([fact(),fact({code:'600001'})]);a.mergePressureHistory(s,r);
 assert.equal(s.pressureHistory[0].facts.length,1);assert.ok(a.addPressureRiskFacts(r,code,t,new Map()).has('56:5'));
 assert.ok(a.pressureLearningTags(s,{code,date:day},t).includes(tag));
});
test('C7.2 conflicting equal-clock fact versions remain unknown regardless of order',async()=>{
 const a=await mod,one=fact(),two=fact({value:5,riskTag:''});
 for(const facts of [[one,two],[two,one]]){
  const r=report(facts),s={};a.mergePressureHistory(s,r);assert.equal(s.pressureHistory[0].facts.length,2);
  assert.equal(a.addPressureRiskFacts(r,code,t,new Map()).size,0);
  assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t),[]);
 }
});
test('C7.2 exact repeats of contradictory archive revisions stay bounded; later valid revision resolves only forward',async()=>{
 const a=await mod,s={},r=report([fact(),fact({value:5,riskTag:''})]);
 a.mergePressureHistory(s,r);for(let i=0;i<5;i++)a.mergePressureHistory(s,r);
 assert.equal(s.pressureHistory[0].facts.length,2);
 a.mergePressureHistory(s,report([fact({knownAt:t+1000})],{knownAt:t+1000}));
 assert.equal(s.pressureHistory[0].facts.length,3);
 assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t),[]);
 assert.ok(a.pressureLearningTags(s,{code,date:day},t+1000).includes(tag));
});
test('C7.2 unchanged later receipt does not refresh the first known time',async()=>{
 const a=await mod,s={};a.mergePressureHistory(s,report([fact()]));a.mergePressureHistory(s,report([fact({knownAt:t+1000})],{knownAt:t+1000}));
 assert.equal(s.pressureHistory[0].facts.length,1);assert.equal(s.pressureHistory[0].facts[0].knownAt,t);
});
test('C7.2 future correction does not change earlier risk; newer withdrawal does not revive an older positive',async()=>{
 const a=await mod,s={},newer=fact({knownAt:t+1000,retracted:true});
 a.mergePressureHistory(s,report([fact()]));a.mergePressureHistory(s,report([newer],{knownAt:t+1000}));
 assert.ok(a.pressureLearningTags(s,{code,date:day},t).includes(tag));assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t+1000),[]);
});
test('C7.3 whitespace provenance, withdrawal and impossible expiry are not confirmed facts',async()=>{
 const a=await mod;for(const patch of [{source:' '},{description:' '},{withdrawn:true},{retracted:true},{eventDay:'2026-12-01',expires:day},{id:''}]){
  const f=fact(patch);assert.equal(a.confirmedFact(f,code,day,t),false);assert.equal(a.addPressureRiskFacts(report([f]),code,t,new Map()).size,0);
 }
});
test('C7.3 goodwill label must agree with actual numeric value and unit',async()=>{
 const a=await mod;for(const patch of [{value:5},{value:null},{value:'35'},{unit:'元'}]){
  const f=fact(patch);assert.equal(a.confirmedFact(f,code,day,t),false);assert.equal(a.addPressureRiskFacts(report([f]),code,t,new Map()).size,0);
  assert.deepEqual(a.pressureLearningTags({pressureHistory:[report([f])]},{code,date:day},t),[]);
 }
});
test('C7.3 genuine threshold equality and provider-declared low-risk revision preserve evidence',async()=>{
 const a=await mod;assert.ok(a.addPressureRiskFacts(report([fact({value:30})]),code,t,new Map()).has('56:5'));
 const low=fact({value:29,riskTag:''});assert.equal(a.confirmedFact(low,code,day,t),true);assert.equal(a.addPressureRiskFacts(report([low]),code,t,new Map()).size,0);
});
test('C7.4 unfinished daily bar receipt cannot be advanced to close by the projector',async()=>{
 const a=await mod;assert.deepEqual(a.chipHistory([bar({knownAt:close-1,availableAt:close-1})],code,day,t),[]);
});
test('C7.4 explicit unknown or preclose chip receipt cannot be replaced by daily bar clock',async()=>{
 const a=await mod;for(const chipKnownAt of [null,close-1,'invalid',0])assert.deepEqual(a.chipHistory([bar({chipKnownAt})],code,day,t),[]);
});
test('C7.4 contradictory raw locked ratio or peak remains unknown',async()=>{
 const a=await mod;for(const other of [bar({lockedRatio:90}),bar({chipPeak:8})]){
  for(const rows of [[bar({lockedRatio:10}),other],[other,bar({lockedRatio:10})]])assert.deepEqual(a.chipHistory(rows,code,day,t),[]);
 }
});
test('C7.4 explicit conflicting units cannot be silently deduplicated',async()=>{
 const a=await mod;assert.deepEqual(a.chipHistory([bar(),bar({volumeUnit:'lots'})],code,day,t),[]);
});
test('C7.4 future chip correction is invisible while valid raw chip receipt is retained',async()=>{
 const a=await mod,b=bar(),later=bar({chipPeak:1,chipKnownAt:t+1});
 const original=a.chipHistory([b],code,day,t);assert.equal(original.length,1);assert.equal(original[0].knownAt,t);
 assert.deepEqual(a.chipHistory([b,later],code,day,t),original);assert.deepEqual(a.chipHistory([later,b],code,day,t),original);
});
test('C7.4 valid later chip receipt retains the actual time rather than the daily bar time',async()=>{
 const a=await mod;const r=a.chipHistory([bar({chipKnownAt:t+1000})],code,day,t+1000);
 assert.equal(r.length,1);assert.equal(r[0].knownAt,t+1000);assert.equal(r[0].peak,9.8);
});
test('C7.5 chip learning requires real date, type, source and close-time receipt',async()=>{
 const a=await mod;for(const patch of [{date:'2026-11-19x'},{kind:'invented'},{source:' '},{knownAt:close-1},{withdrawn:true}]){
  const s={pressureHistory:[report([],{chipSeries:[chip(patch)]})]};
  assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t),[]);
 }
});
test('C7.5 conflicting raw-chip revisions do not generate a learning label',async()=>{
 const a=await mod;const s={pressureHistory:[report([],{chipSeries:[chip(),chip({peak:8})]})]};
 assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t),[]);
});
test('C7.5 a wrong security cannot shadow valid same-id evidence; future target dates remain unknown',async()=>{
 const a=await mod,s={pressureHistory:[report([],{chipSeries:[chip({code:'600001',peak:8}),chip()]})]};
 assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t),['筹码·原始峰下方收盘']);
 assert.deepEqual(a.pressureLearningTags(s,{code,date:'2026-11-21'},t),[]);
});
test('C7.5 valid raw/estimated labels and original first receipt stay distinct',async()=>{
 const a=await mod;for(const kind of ['raw','estimate']){
  const s={pressureHistory:[report([],{chipSeries:[chip({kind})]})]};
  assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t),['筹码·'+(kind==='raw'?'原始':'估算')+'峰下方收盘']);
 }
});

test('C7.2 late same-clock contradiction after repeated receipt compression remains unknown',async()=>{
 const a=await mod,s={},low=fact({value:5,riskTag:''}),high=fact({knownAt:t+1000});
 a.mergePressureHistory(s,report([low]));
 a.mergePressureHistory(s,report([{...low,knownAt:t+1000}],{knownAt:t+1000}));
 assert.equal(s.pressureHistory[0].facts.length,1);
 assert.equal(s.pressureHistory[0].facts[0].knownAt,t);
 a.mergePressureHistory(s,report([high],{knownAt:t+2000}));
 assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t+1000),[]);
 assert.equal(a.addPressureRiskFacts(s.pressureHistory[0],code,t+1000,new Map()).size,0);
 a.mergePressureHistory(s,report([{...high,knownAt:t+3000}],{knownAt:t+3000}));
 assert.deepEqual(a.pressureLearningTags(s,{code,date:day},t+1000),[]);
 assert.ok(a.pressureLearningTags(s,{code,date:day},t+3000).includes(tag));
});
