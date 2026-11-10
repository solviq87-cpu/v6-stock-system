'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {bridgeExistingMarketSector}=require('../src/core/sector-breadth-market-bridge');
const {evaluateSectorRotation:evaluate}=require('../src/strategy/sector-rotation-history');
const {runOnce,parse}=require('../scripts/sector-rotation-history');
const dates=['2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10'];
function make(day,{hot=4,cold=-2,version='stable-membership-v1',clock='10:03'}={}){
 const end=Date.parse(day+'T'+clock+':00+08:00'),start=end-60000;
 const groups=[[hot,hot+.1,hot+.2,hot+.3,hot+.4],
  [cold,cold,cold,cold,cold],
  [-3,-2,-1,-2,-1]];
 const stocks=[],sectors=[];
 for(let j=0;j<3;j++){
  const members=[];
  for(let i=0;i<5;i++){
   const code=String(600001+j*100+i);
   members.push(code);
   stocks.push({code,pctChange:groups[j][i],vendorQuoteAt:end-5000});
  }
  sectors.push({code:'BK'+(j+1),name:['强势板块','基准板块','疲弱板块'][j],
   category:'industry',memberCount:5,members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',universeSize:15,
  startedAt:new Date(start).toISOString(),retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',provider:'licensed-industry-versioned',
  classificationVersion:version,tradeDate:day,observedAt:start-60000,sectors};
 const b=bridgeExistingMarketSector(snapshot,membership,{asOf:end});
 assert.equal(b.status,'imported-unverified',b.reason);
 return {schemaVersion:1,mode:'dated-sector-research-only',status:b.status,
  tradeDate:day,observedAt:b.observedAt,data:b,reason:null,
  canTrade:false,verifiedLive:false,weightsChanged:false};
}
const all=()=>dates.map(d=>make(d));
const end=Date.parse('2026-11-10T10:04:00+08:00');
test('five explicit sessions classify broad sustained strength, preserve source and no orders',()=>{
 const records=all(),before=JSON.stringify(records);
 const r=evaluate(records,{tradeDates:dates,asOf:end});
 assert.equal(r.status,'imported-unverified');
 assert.equal(r.evaluatedThreeSession,3);
 assert.equal(r.evaluatedFiveSession,3);
 const s=r.sectors.find(x=>x.code==='BK1');
 assert.equal(s.threeSession.label,'three-session-broad-strength');
 assert.equal(s.fiveSession.label,'five-session-broad-strength');
 assert.deepEqual(s.threeSession.calendarDates,dates.slice(-3));
 assert.equal(s.threeSession.observations.length,3);
 assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);
 assert.equal(r.rankingModified,false);assert.equal(r.verifiedLive,false);
 assert.equal(JSON.stringify(records),before,'研究函数不得修改任何嵌套输入字段');
});
test('warming and cooling labels reflect same-sector breadth, not a prediction',()=>{
 const warm=all();warm[2]=make(dates[2],{hot:-2});
 warm[3]=make(dates[3],{hot:1});
 const w=evaluate(warm,{tradeDates:dates,asOf:end}).sectors.find(x=>x.code==='BK1');
 assert.equal(w.threeSession.label,'three-session-warming');
 const cool=all();cool[4]=make(dates[4],{hot:-3});
 const c=evaluate(cool,{tradeDates:dates,asOf:end}).sectors.find(x=>x.code==='BK1');
 assert.equal(c.threeSession.label,'three-session-cooling');
});
test('not enough explicitly confirmed trading dates never claims five-day trend',()=>{
 const selected=all().slice(-3),r=evaluate(selected,{tradeDates:dates.slice(-3),asOf:end});
 assert.equal(r.evaluatedThreeSession,3);
 assert.equal(r.evaluatedFiveSession,0);
 assert.equal(r.sectors.find(x=>x.code==='BK1').fiveSession.status,'unknown');
 assert.equal(r.sectors.find(x=>x.code==='BK1').fiveSession.reason,'explicit-calendar-too-short');
});
test('missing holiday-adjacent session never skips the observation and calls it consecutive',()=>{
 const r=evaluate(all().filter(x=>x.tradeDate!=='2026-11-09'),{tradeDates:dates,asOf:end});
 assert.equal(r.evaluatedThreeSession,0);
 assert.equal(r.evaluatedFiveSession,0);
 assert.equal(r.sectors.find(x=>x.code==='BK1').threeSession.reason,
  'missing-or-invalid-matched-sector-session');
});
test('provider, calendar, identity or intraday time changes cannot be smoothed over',()=>{
 const cases=[
  records=>records[0].data.quoteProvider='other',
  records=>records[0].tradeDate='2026-11-03',
  records=>records[0].observedAt=end+600000,
  records=>records[0].data.study.sectors[0].category='illegal',
  records=>records[0].data.marketQuoteCoveragePct=70,
  records=>records[0].data.study.observedAt=0,
  records=>records[0].data.classificationVersion='other-version',
  records=>records[0].data.study.sectors[0].memberCount=6
 ];
 for(const mutate of cases){
  const records=all();mutate(records);
  const r=evaluate(records,{tradeDates:dates,asOf:end});
  if(r.status==='unknown')assert.equal(r.canTrade,false);
  else{
   const sector=r.sectors.find(x=>x.code==='BK1');
   assert.equal(sector.fiveSession.status,'unknown');
  }
 }
 assert.equal(evaluate(all(),{tradeDates:['2026-11-04','2026-11-06','2026-11-05'],asOf:end}).status,'unknown');
 const off=all();off[0]=make(dates[0],{clock:'14:45'});
 assert.equal(evaluate(off,{tradeDates:dates,asOf:end}).reason,'intraday-snapshot-times-not-aligned');
});
test('immutable archive runner creates idempotent private daily output, conflict blocks rewrite',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sector-rotation-'));
 try{
  const archive=path.join(dir,'archive'),output=path.join(dir,'output');
  fs.mkdirSync(archive);fs.mkdirSync(output);
  const cal=path.join(dir,'calendar.json');
  fs.writeFileSync(cal,JSON.stringify({source:'imported',tradeDates:dates}));
  for(const r of all()){
   const p=path.join(archive,r.tradeDate);fs.mkdirSync(p);
   fs.writeFileSync(path.join(p,String(r.observedAt)+'.json'),JSON.stringify(r));
  }
  const conf=parse(['once',archive,cal,output]);
  const a=runOnce(conf,{now:end}),b=runOnce(conf,{now:end});
  assert.equal(a.changed,true);assert.equal(b.changed,false);
  assert.equal(a.evaluatedFiveSession,3);
  const file=path.join(output,dates.at(-1),String(all().at(-1).observedAt)+'.json');
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(saved.report.canTrade,false);
  assert.match(saved.integrity,/^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const corrupted=all()[0];corrupted.data.study.sectors[0].score-=10;
  fs.writeFileSync(path.join(archive,dates[0],String(corrupted.observedAt)+'.json'),
   JSON.stringify(corrupted));
  assert.throws(()=>runOnce(conf,{now:end}),/拒绝覆盖/);
  assert.equal(runOnce({...conf,mode:'watch'},{now:end+86400000}).status,'not-current-trading-day');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI refuses symlink path and future calendar; no source files means no publication',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sector-rot-guard-'));
 try{
  const archive=path.join(dir,'archive'),out=path.join(dir,'output'),cal=path.join(dir,'calendar.json');
  fs.mkdirSync(archive);fs.mkdirSync(out);
  fs.writeFileSync(cal,JSON.stringify({source:'imported',tradeDates:dates}));
  const conf=parse(['once',archive,cal,out]);
  assert.equal(runOnce(conf,{now:end}).status,'latest-session-archive-missing');
  const link=path.join(dir,'alias');fs.symlinkSync(archive,link);
  assert.throws(()=>parse(['once',link,cal,out]),/符号链接/);
  fs.writeFileSync(cal,JSON.stringify({source:'imported',tradeDates:[...dates,'2026-11-11']}));
  assert.throws(()=>runOnce(conf,{now:end}),/之后/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
