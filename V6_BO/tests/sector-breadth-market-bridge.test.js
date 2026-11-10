'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {bridgeExistingMarketSector:bridge}=require('../src/core/sector-breadth-market-bridge');
const {researchLiveMarket}=require('../src/core/live-market-research');
const {runOnce,parse}=require('../scripts/sector-strength-research');
const end=Date.parse('2026-11-10T10:03:00+08:00'),start=end-60000,memberAt=start-60000;
function fixture(){
 const groups=[[2,3,4,4,5],[15,12,-1,-2,-3],[-4,-3,-2,-1,0]];
 const stocks=[],sectors=[];
 for(let j=0;j<3;j++){
  const members=[];
  for(let i=0;i<5;i++){
   const code=String(600001+j*100+i);
   members.push(code);
   stocks.push({code,pctChange:groups[j][i],vendorQuoteAt:end-5000});
  }
  sectors.push({code:'BK'+(j+1),name:['设备','计算','医疗'][j],
   category:'industry',members,memberCount:5});
 }
 return {
  market:{date:'2026-11-10',source:'eastmoney-clist-unverified-live',
   universeSize:15,startedAt:new Date(start).toISOString(),
   retrievedAt:new Date(end).toISOString(),stocks,verifiedLive:false},
  membership:{schemaVersion:1,source:'imported',provider:'licensed-industry-versioned',
   classificationVersion:'2026-11-10-main',
   tradeDate:'2026-11-10',observedAt:memberAt,sectors}
 };
}
test('reuse fifteen original-timestamp quotes; equal-weight proxy is explicitly not a sector index',()=>{
 const {market,membership}=fixture(),before=structuredClone({market,membership});
 const r=bridge(market,membership);
 assert.equal(r.status,'imported-unverified');
 assert.equal(r.freshQuotes,15);assert.equal(r.marketQuoteCoveragePct,100);
 assert.equal(r.returnMethod,'equal-weight-constituents-proxy');
 assert.equal(r.benchmarkMethod,'equal-weight-valid-constituents-universe');
 assert.equal(r.study.rankedSectorCount,3);
 assert.equal(r.study.sectors.find(x=>x.code==='BK1').rank,1);
 assert.equal(r.study.sectors.find(x=>x.code==='BK1').status,'partial-evidence');
 assert.equal(r.study.sectors.find(x=>x.code==='BK1').limitUpCount,null);
 assert.equal(r.verifiedLive,false);assert.equal(r.rankingModified,false);
 assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);
 assert.deepEqual({market,membership},before);
});
test('no f124 timestamp or stale quotes cannot use request timestamp as source time',()=>{
 const {market,membership}=fixture();
 delete market.stocks[0].vendorQuoteAt;
 const partly=bridge(market,membership);
 assert.equal(partly.status,'imported-unverified');
 assert.equal(partly.study.sectors.find(x=>x.code==='BK1').status,'unknown');
 assert.equal(partly.study.rankedSectorCount,0);
 for(let i=0;i<7;i++)market.stocks[i].vendorQuoteAt=end-400000;
 assert.equal(bridge(market,membership).reason,'fresh-market-quote-coverage-insufficient');
});
test('wrong-day, future, stale, fake source and missing classification version fail closed',()=>{
 const mutations=[
  x=>x.market.date='2026-11-09',
  x=>x.market.startedAt=new Date(end+1000).toISOString(),
  x=>x.market.retrievedAt=new Date(start-1000).toISOString(),
  x=>x.membership.observedAt=start+1000,
  x=>x.membership.tradeDate='2026-11-09',
  x=>x.membership.classificationVersion='mock',
  x=>x.membership.provider='simulated',
  x=>x.market.source='unverified-alternate',
  x=>x.market.stocks[0].source='other-provider'
 ];
 for(const mutate of mutations){
  const x=fixture();mutate(x);
  const r=bridge(x.market,x.membership);
  assert.equal(r.status,'unknown',r.reason);
  assert.equal(r.canTrade,false);
 }
});
test('duplicate members, wrong size and duplicate source quotes block publication',()=>{
 for(const mutate of [
  x=>x.membership.sectors[0].members[1]=x.membership.sectors[0].members[0],
  x=>x.membership.sectors[0].memberCount=99,
  x=>x.membership.sectors.push({...x.membership.sectors[0]}),
  x=>x.market.stocks[1].code=x.market.stocks[0].code
 ]){
  const x=fixture();mutate(x);
  assert.equal(bridge(x.market,x.membership).status,'unknown');
 }
});
test('one existing live research fetch optionally generates sector study; old contract unchanged',async()=>{
 const {market,membership}=fixture();let calls=0;
 const fetchSnapshot=async()=>{calls++;return market;};
 const old=await researchLiveMarket({now:end,fetchSnapshot});
 const current=await researchLiveMarket({now:end,fetchSnapshot,sectorMembership:membership});
 assert.equal(calls,2,'exactly one data-fetch callback per analysis, no sector-specific fetch');
 assert.equal(old.sectorBreadth,undefined);
 assert.equal(current.sectorBreadth.study.rankedSectorCount,3);
 assert.equal(current.breadth.breadthScore,old.breadth.breadthScore);
 assert.equal(current.rankingModified,old.rankingModified);
 assert.equal(current.candidateIntersection.matched,old.candidateIntersection.matched);
});
test('one-shot CLI writes immutable private research record, idempotent and refuses conflicting overwrite',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-'));
 try{
  const {market,membership}=fixture(),a=path.join(dir,'quote.json'),b=path.join(dir,'members.json'),o=path.join(dir,'report.json');
  fs.writeFileSync(a,JSON.stringify(market));fs.writeFileSync(b,JSON.stringify(membership));
  const conf=parse(['once',a,b,o]);
  assert.equal(runOnce(conf,{now:end}).changed,true);
  const report=JSON.parse(fs.readFileSync(o,'utf8'));
  assert.equal(report.status,'imported-unverified');assert.equal(report.data.study.rankedSectorCount,3);
  assert.equal(fs.statSync(o).mode&0o777,0o600);
  assert.equal(runOnce(conf,{now:end}).changed,false);
  membership.sectors[0].name='changed-without-version';
  fs.writeFileSync(b,JSON.stringify(membership));
  assert.throws(()=>runOnce(conf,{now:end}),/冲突|拒绝覆盖/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('watch refuses to promote yesterday or outdated intraday input as current',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-watch-'));
 try{
  const {market,membership}=fixture(),a=path.join(dir,'snapshot.json'),b=path.join(dir,'members.json');
  fs.writeFileSync(a,JSON.stringify(market));fs.writeFileSync(b,JSON.stringify(membership));
  const conf=parse(['watch',a,b,path.join(dir,'out'),'--interval','60000']);
  const old=runOnce(conf,{now:end+900000});
  assert.equal(old.status,'not-current-snapshot');assert.equal(old.changed,false);
  const fresh=runOnce(conf,{now:end+5000});
  assert.equal(fresh.changed,true);
  assert.equal(runOnce(conf,{now:end+5000}).changed,false);
  assert.equal(fs.readdirSync(path.join(dir,'out','2026-11-10')).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
