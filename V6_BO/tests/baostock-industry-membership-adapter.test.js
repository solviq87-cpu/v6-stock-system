'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process');
const {adaptBaoStockIndustryMembership:adapt}=
 require('../src/core/baostock-industry-membership-adapter');
const {bridgeExistingMarketSector:bridge}=
 require('../src/core/sector-breadth-market-bridge');
const {runOnce}=require('../scripts/normalize-baostock-industry');
const tradeDate='2026-11-10';
const end=Date.parse('2026-11-10T10:03:00+08:00'),start=end-60000,observedAt=start-60000;
function fixture(){
 const groups=[[2,3,4,4,5],[15,12,-1,-2,-3],[-4,-3,-2,-1,0]];
 const rows=[],stocks=[];
 const labels=['硬件设备','数字经济','医疗服务'];
 for(let j=0;j<3;j++){
  for(let i=0;i<5;i++){
   const symbol=String(600001+j*100+i);
   stocks.push({code:symbol,pctChange:groups[j][i],vendorQuoteAt:end-5000});
   rows.push({updateDate:'2026-11-09',code:'sh.'+symbol,
    industry:labels[j],industryClassification:'证监会行业分类'});
  }
 }
 const snapshot={date:tradeDate,source:'eastmoney-clist-unverified-live',
  universeSize:15,startedAt:new Date(start).toISOString(),
  retrievedAt:new Date(end).toISOString(),verifiedLive:false,stocks};
 const classification={schemaVersion:1,source:'baostock:query_stock_industry',
  completed:true,collectionMode:'current-provider-snapshot',
  historicalMembershipVerified:false,standard:'证监会行业分类',updateDate:'2026-11-09',
  observedAt,declaredRows:15,rows};
 return {snapshot,classification};
}
test('full BaoStock classifier -> frozen sector bridge keeps provider and quote sources separate',()=>{
 const input=fixture(),before=structuredClone(input);
 const converted=adapt(input.classification,input.snapshot);
 assert.equal(converted.status,'imported-unverified');
 assert.equal(converted.sectorCount,3);
 assert.equal(converted.membership.provider,'baostock:query_stock_industry');
 assert.equal(converted.membership.observedAt,observedAt);
 assert.equal(converted.membership.provenance.quoteSource,input.snapshot.source);
 assert.equal(converted.membership.provenance.classificationDate,'2026-11-09');
 const r=bridge(input.snapshot,converted.membership);
 assert.equal(r.status,'imported-unverified');
 assert.equal(r.study.rankedSectorCount,3);
 assert.equal(r.returnMethod,'equal-weight-constituents-proxy');
 assert.equal(r.study.sectors.find(s=>s.name==='硬件设备').rank,1);
 assert.equal(r.membershipProvider,'baostock:query_stock_industry');
 assert.equal(r.canTrade,false);assert.equal(r.verifiedLive,false);
 assert.deepEqual(input,before);
});
test('source independent of row ordering; stable classification fingerprint',()=>{
 const input=fixture();
 const one=adapt(input.classification,input.snapshot);
 input.classification.rows.reverse();input.snapshot.stocks.reverse();
 const two=adapt(input.classification,input.snapshot);
 assert.deepEqual(one.membership,two.membership);
});
test('row duplication, mixed standard and changed version fail closed',()=>{
 for(const tweak of [
  x=>x.classification.rows[1].code=x.classification.rows[0].code,
  x=>x.classification.rows[1].industryClassification='申万一级行业',
  x=>x.classification.rows[1].updateDate='2026-11-08',
  x=>x.classification.declaredRows=500,
  x=>x.classification.completed=false,
  x=>x.classification.source='unknown'
 ]){
  const x=fixture();tweak(x);assert.equal(adapt(x.classification,x.snapshot).status,'unknown');
 }
});
test('classification collected after the quote starts, old or future membership never joins',()=>{
 const a=fixture();a.classification.observedAt=start+1;
 assert.equal(adapt(a.classification,a.snapshot).reason,'classification-completeness-standard-or-freeze-invalid');
 const b=fixture();b.classification.updateDate='2026-10-01';
 b.classification.rows.forEach(x=>x.updateDate='2026-10-01');
 assert.equal(adapt(b.classification,b.snapshot).reason,'industry-version-too-old');
 const c=fixture();c.classification.updateDate='2026-11-11';
 c.classification.rows.forEach(x=>x.updateDate='2026-11-11');
 assert.equal(adapt(c.classification,c.snapshot).status,'unknown');
});
test('market mappings must be complete, not a partial group engineered to look strong',()=>{
 const a=fixture();a.snapshot.universeSize=30;
 assert.equal(adapt(a.classification,a.snapshot).reason,'dated-complete-quote-snapshot-required');
 const b=fixture();b.classification.rows.splice(0,5);b.classification.declaredRows=10;
 assert.equal(adapt(b.classification,b.snapshot).status,'unknown');
});
test('alternative explicitly labeled primary industry standard is handled without mixing standards',()=>{
 const x=fixture();
 x.classification.standard='申万一级行业';
 x.classification.rows.forEach(y=>y.industryClassification='申万一级行业');
 const r=adapt(x.classification,x.snapshot);
 assert.equal(r.status,'imported-unverified');
 assert.ok(r.membership.classificationVersion.includes('-sw1-'));
});
test('normalization creates one immutable private file and never overwrites a conflicting version',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-bs-industry-'));
 try{
  const {snapshot,classification}=fixture();
  const one=path.join(dir,'raw.json'),two=path.join(dir,'market.json'),out=path.join(dir,'frozen.json');
  fs.writeFileSync(one,JSON.stringify(classification));
  fs.writeFileSync(two,JSON.stringify(snapshot));
  const first=runOnce([one,two,out]);
  assert.equal(first.status,'prepared-unverified');assert.equal(first.changed,true);
  assert.equal(fs.statSync(out).mode&0o777,0o600);
  assert.equal(runOnce([one,two,out]).changed,false);
  classification.rows[0].industry='其他';
  fs.writeFileSync(one,JSON.stringify(classification));
  assert.equal(runOnce([one,two,out]).status,'blocked',
   'one-member modification leaves fewer than 3 valid industries');
  const rejected=cp.spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/normalize-baostock-industry.js'),one,two,out],{encoding:'utf8',timeout:10000});
  assert.equal(rejected.status,2,'blocked classification must set nonzero CLI status');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('BaoStock collector refuses network before SDK login unless explicitly authorized',()=>{
 const script=path.resolve(__dirname,'../scripts/collect-baostock-industry.py');
 const dest=path.join(os.tmpdir(),'v6-unapproved-bao-'+process.pid+'.json');
 const r=cp.spawnSync('python3',[script,'--output',dest],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,1);
 assert.equal(fs.existsSync(dest),false);
});

test('BaoStock collector never requests historical classification by a date argument',()=>{
 const script=fs.readFileSync(path.resolve(__dirname,'../scripts/collect-baostock-industry.py'),'utf8');
 assert.match(script,/bs\.query_stock_industry\(\)/);
 assert.doesNotMatch(script,/bs\.query_stock_industry\(date\s*=/);
 assert.match(script,/"collectionMode": "current-provider-snapshot"/);
 assert.match(script,/"historicalMembershipVerified": False/);
});

test('consumer rejects legacy or falsely historical BaoStock classification bundles',()=>{
 for(const tweak of [
  x=>delete x.classification.collectionMode,
  x=>x.classification.collectionMode='historical-as-of-date',
  x=>delete x.classification.historicalMembershipVerified,
  x=>x.classification.historicalMembershipVerified=true
 ]){
  const x=fixture();tweak(x);
  assert.equal(adapt(x.classification,x.snapshot).status,'unknown');
 }
 const input=fixture();
 const ok=adapt(input.classification,input.snapshot);
 assert.equal(ok.membership.provenance.collectionMode,'current-provider-snapshot');
 assert.equal(ok.membership.provenance.historicalMembershipVerified,false);
});
