'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parse,preflight,runOnce,main}=require('../scripts/sector-market-capture');
const {fetchEastmoneySnapshot}=require('../src/core/eastmoney-market-snapshot');
const start=Date.parse('2026-11-10T10:02:00+08:00');
const end=start+60000,finish=end+5000,day='2026-11-10';
const dates=['2026-11-06','2026-11-09',day];
function fixture(){
 const rows=[],stocks=[];
 const groups=[[2,3,4,4,5],[15,12,-1,-2,-3],[-4,-3,-2,-1,0]];
 for(let j=0;j<3;j++)for(let i=0;i<5;i++){
  const code=String(600001+j*100+i);
  rows.push({updateDate:'2026-11-09',code:'sh.'+code,
   industry:['硬件设备','数字经济','医疗服务'][j],
   industryClassification:'证监会行业分类'});
  stocks.push({code,pctChange:groups[j][i],vendorQuoteAt:end-5000});
 }
 const raw={schemaVersion:1,source:'baostock:query_stock_industry',
  completed:true,standard:'证监会行业分类',updateDate:'2026-11-09',
  observedAt:start-60000,declaredRows:15,rows};
 const snapshot={source:'eastmoney-clist-unverified-live',date:day,
  universeSize:15,startedAt:new Date(start).toISOString(),
  retrievedAt:new Date(end).toISOString(),stocks,verifiedLive:false};
 const calendar={source:'imported',tradeDates:dates};
 return {raw,snapshot,calendar};
}
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sec-cap-'));
 const rawFile=path.join(dir,'raw.json'),calFile=path.join(dir,'calendar.json'),
  root=path.join(dir,'research');
 const data=fixture();
 fs.writeFileSync(rawFile,JSON.stringify(data.raw));
 fs.writeFileSync(calFile,JSON.stringify(data.calendar));
 return {...data,dir,rawFile,calFile,root,
  preview:['preview',rawFile,calFile,root],
  collect:['collect',rawFile,calFile,root,'--allow-research-fetch']};
}
const clean=x=>fs.rmSync(x.dir,{recursive:true,force:true});
const inject=x=>({now:start,clock:()=>finish,fetchSnapshot:async()=>x.snapshot});
test('preflight is read-only, cannot make a provider request and exposes no licensed status',async()=>{
 const x=setup();let calls=0;
 try{
  const a=await main(x.preview,{now:start,fetchSnapshot:async()=>{calls++;throw Error('should not be called');}});
  assert.equal(a.status,'preflight-ready');assert.equal(a.verifiedLive,false);
  assert.equal(a.changed,false);assert.equal(calls,0);
  assert.equal(fs.existsSync(x.root),false);
  assert.throws(()=>parse(['collect',x.rawFile,x.calFile,x.root]),/--allow-research-fetch/);
  assert.throws(()=>parse(['preview',x.rawFile,x.calFile,x.root,'--allow-research-fetch']),/用法/);
  assert.equal(fs.existsSync(x.root),false);
 }finally{clean(x);}
});
test('explicit collect invokes existing snapshot once, publishes private immutable sector chain',async()=>{
 const x=setup();let calls=0;
 try{
  const options={...inject(x),fetchSnapshot:async()=>{
   calls++;return x.snapshot;
  }};
  const r=await main(x.collect,options);
  assert.equal(calls,1,'one market snapshot callback, no separate sector quote call');
  assert.equal(r.status,'capture-and-sector-research-published-unverified');
  assert.deepEqual(r.completedStages.map(x=>x.stage),['snapshot','membership','sector','rotation']);
  assert.equal(r.rankedSectors,3);
  assert.equal(r.sourceTimeCoveragePct,100);
  assert.equal(r.evaluatedThreeSession,0);
  assert.equal(r.evaluatedFiveSession,0);
  assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);assert.equal(r.verifiedLive,false);
  assert.equal(r.weightsChanged,false);
  const base=path.join(x.root,'snapshots',day,String(end)+'.json');
  const frozen=path.join(x.root,'members',day,String(end)+'.json');
  const sector=path.join(x.root,'sector-archive',day,String(end)+'.json');
  const rotation=path.join(x.root,'rotation-archive',day,String(end)+'.json');
  assert.equal(JSON.parse(fs.readFileSync(base,'utf8')).stocks.length,15);
  assert.equal(JSON.parse(fs.readFileSync(frozen,'utf8')).source,'imported');
  assert.equal(JSON.parse(fs.readFileSync(sector,'utf8')).data.study.rankedSectorCount,3);
  assert.equal(JSON.parse(fs.readFileSync(rotation,'utf8')).report.canTrade,false);
  for(const p of [base,frozen,sector,rotation])
   assert.equal(fs.statSync(p).mode&0o777,0o600);
  assert.equal(fs.existsSync(path.join(x.root,'.sector-capture.lock')),false);
  const r2=await main(x.collect,{...options,now:finish});
  assert.equal(r2.status,'blocked-capture-interval');
  assert.equal(calls,1,'subsequent same-minute collect is blocked before fetch');
 }finally{clean(x);}
});
test('actual Eastmoney parser is reused once; source f124 is not replaced with request time',async()=>{
 const x=setup();let networkCalls=0;
 try{
  const fakeFetch=async ()=>{
   networkCalls++;
   return {ok:true,json:async()=>({data:{total:15,diff:x.snapshot.stocks.map(s=>({
    f12:s.code,f13:0,f3:s.pctChange,f124:Math.floor(s.vendorQuoteAt/1000)
   }))}})};
  };
  const fetchSnapshot=opts=>fetchEastmoneySnapshot({...opts,
   fetchImpl:fakeFetch,pageSize:500,clock:()=>end});
  const r=await runOnce(parse(x.collect),{now:start,clock:()=>finish,fetchSnapshot});
  assert.equal(r.status,'capture-and-sector-research-published-unverified');
  assert.equal(networkCalls,1);
  const json=JSON.parse(fs.readFileSync(path.join(x.root,'snapshots',day,String(end)+'.json'),'utf8'));
  assert.equal(json.stocks[0].vendorQuoteAt,end-5000);
  assert.equal(json.sourceCoverage.present,15);
  assert.equal(json.verifiedLive,false);
 }finally{clean(x);}
});
test('missing, stale, future and mixed-day vendor quote timestamps block publishing',async()=>{
 const mutations=[
  a=>delete a.stocks[0].vendorQuoteAt,
  a=>a.stocks.forEach(s=>s.vendorQuoteAt=end-301000),
  a=>a.stocks.forEach(s=>s.vendorQuoteAt=end+1000),
  a=>a.date='2026-11-09'
 ];
 for(const mutate of mutations){
  const x=setup();
  try{
   mutate(x.snapshot);
   const result=await runOnce(parse(x.collect),inject(x));
   assert.ok(['blocked-unverified-market-coverage','blocked-collected-snapshot-time'].includes(result.status),result.status);
   assert.equal(fs.existsSync(path.join(x.root,'snapshots',day)),false);
  }finally{clean(x);}
 }
});
test('weekend, off-session, wrong calendar, incomplete or newer classification never fetch',async()=>{
 const x=setup();let calls=0;
 try{
  const fetchSnapshot=async()=>{calls++;throw Error('blocked before fetch');};
  const off=await runOnce(parse(x.collect),{now:Date.parse(day+'T12:15:00+08:00'),fetchSnapshot});
  assert.equal(off.status,'blocked-market-session');
  const weekend='2026-11-14';
  x.calendar.tradeDates=[...dates,weekend];
  fs.writeFileSync(x.calFile,JSON.stringify(x.calendar));
  const week=await runOnce(parse(x.collect),{now:Date.parse(weekend+'T10:02:00+08:00'),fetchSnapshot});
  assert.equal(week.status,'blocked-market-session');
  x.calendar.tradeDates=dates.slice(0,2);
  fs.writeFileSync(x.calFile,JSON.stringify(x.calendar));
  assert.equal((await runOnce(parse(x.collect),{now:start,fetchSnapshot})).status,'blocked-trading-calendar');
  fs.writeFileSync(x.calFile,JSON.stringify(fixture().calendar));
  x.raw.observedAt=start+1;fs.writeFileSync(x.rawFile,JSON.stringify(x.raw));
  assert.equal((await runOnce(parse(x.collect),{now:start,fetchSnapshot})).status,'blocked-classification');
  assert.equal(calls,0);
  assert.equal(fs.existsSync(x.root),false);
 }finally{clean(x);}
});
test('changed classification during slow provider request fails, with no source snapshot published',async()=>{
 const x=setup();
 try{
  const original=JSON.stringify(x.raw);
  const fetchSnapshot=async()=>{
   const edited=JSON.parse(original);
   edited.rows[0].industry='篡改后的行业';
   fs.writeFileSync(x.rawFile,JSON.stringify(edited));
   return x.snapshot;
  };
  const r=await runOnce(parse(x.collect),{now:start,clock:()=>finish,fetchSnapshot});
  assert.equal(r.status,'blocked-input-changed-before-archive');
  assert.equal(fs.existsSync(path.join(x.root,'snapshots')),false);
  assert.equal(fs.existsSync(path.join(x.root,'.sector-capture.lock')),false);
 }finally{clean(x);}
});
test('single-writer lock stops duplicate full-market fetch across runs',async()=>{
 const x=setup();let calls=0;
 try{
  fs.mkdirSync(x.root);fs.writeFileSync(path.join(x.root,'.sector-capture.lock'),'active');
  await assert.rejects(runOnce(parse(x.collect),{...inject(x),
   fetchSnapshot:async()=>{calls++;return x.snapshot;}}),/禁止并发/);
  assert.equal(calls,0);
  assert.equal(fs.readFileSync(path.join(x.root,'.sector-capture.lock'),'utf8'),'active');
 }finally{clean(x);}
});
test('partial checkpoint failure leaves immutable snapshot for independent audited recovery',async()=>{
 const x=setup();
 try{
  const sector=path.join(x.root,'sector-archive',day,String(end)+'.json');
  fs.mkdirSync(path.dirname(sector),{recursive:true});
  fs.writeFileSync(sector,'{"conflict":true}\n');
  await assert.rejects(runOnce(parse(x.collect),inject(x)),err=>{
   assert.equal(err.stage,'daily-sector-chain');
   assert.deepEqual(err.completedStages.map(s=>s.stage),['snapshot']);
   return /研究链拒绝发布|拒绝覆盖/.test(err.message);
  });
  const raw=JSON.parse(fs.readFileSync(path.join(x.root,'snapshots',day,String(end)+'.json'),'utf8'));
  assert.equal(raw.stocks.length,15);
  assert.equal(fs.readFileSync(sector,'utf8'),'{"conflict":true}\n');
  assert.equal(fs.existsSync(path.join(x.root,'.sector-capture.lock')),false);
 }finally{clean(x);}
});
test('symlink and public archive paths are blocked before any request',()=>{
 const x=setup();
 try{
  const link=path.join(x.dir,'alias');fs.symlinkSync(x.rawFile,link);
  assert.throws(()=>parse(['preview',link,x.calFile,x.root]),/符号链接/);
  assert.throws(()=>parse(['preview',x.rawFile,x.calFile,path.join(x.dir,'public','secret')]),/公开/);
  assert.throws(()=>parse(['preview',x.rawFile,x.calFile,x.dir]),/独立/);
 }finally{clean(x);}
});
