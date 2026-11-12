'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {main,parse,preview,runOnce}=require('../scripts/sector-daily-chain');
const tradeDate='2026-11-10',end=Date.parse('2026-11-10T10:03:00+08:00'),
 start=end-60_000,observedAt=start-60_000,now=end+5_000;
const tradeDates=['2026-11-06','2026-11-09','2026-11-10'];
function fixture(){
 const groups=[[2,3,4,4,5],[15,12,-1,-2,-3],[-4,-3,-2,-1,0]];
 const rows=[],stocks=[];
 const labels=['硬件设备','数字经济','医疗服务'];
 for(let j=0;j<3;j++)for(let i=0;i<5;i++){
  const symbol=String(600001+j*100+i);
  stocks.push({code:symbol,pctChange:groups[j][i],vendorQuoteAt:end-5000});
  rows.push({updateDate:'2026-11-09',code:'sh.'+symbol,
   industry:labels[j],industryClassification:'证监会行业分类'});
 }
 return {
  snapshot:{date:tradeDate,source:'eastmoney-clist-unverified-live',
   universeSize:15,startedAt:new Date(start).toISOString(),
   retrievedAt:new Date(end).toISOString(),verifiedLive:false,stocks},
  raw:{schemaVersion:1,source:'baostock:query_stock_industry',
   collectionMode:'current-provider-snapshot',historicalMembershipVerified:false,
   completed:true,standard:'证监会行业分类',updateDate:'2026-11-09',
   observedAt,declaredRows:15,rows},
  calendar:{source:'imported',tradeDates}
 };
}
function prepare(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-chain-'));
 const args=['preview',path.join(dir,'industry.json'),path.join(dir,'market.json'),
  path.join(dir,'calendar.json'),path.join(dir,'member.json'),
  path.join(dir,'sector-archive'),path.join(dir,'rotation-archive')];
 const x=fixture();
 fs.writeFileSync(args[1],JSON.stringify(x.raw));
 fs.writeFileSync(args[2],JSON.stringify(x.snapshot));
 fs.writeFileSync(args[3],JSON.stringify(x.calendar));
 return {dir,args,market:x.snapshot,raw:x.raw,calendar:x.calendar};
}
function cleanup(x){fs.rmSync(x.dir,{recursive:true,force:true});}
test('preview checks the entire pipeline without modifying even one file',()=>{
 const x=prepare();
 try{
  const before=fs.readdirSync(x.dir).sort(),report=main(x.args,{now});
  assert.equal(report.status,'preview-ready');
  assert.equal(report.classificationVersion.startsWith('baostock-csrc-'),true);
  assert.equal(report.rankedSectors,3);
  assert.equal(report.sourceQuoteCoveragePct,100);
  assert.equal(report.canTrade,false);assert.equal(report.verifiedLive,false);
  assert.equal(report.changed,false);assert.deepEqual(report.completedStages,[]);
  assert.deepEqual(fs.readdirSync(x.dir).sort(),before);
 }finally{cleanup(x);}
});
test('apply publishes each checkpoint once, rerun is idempotent and never trades',()=>{
 const x=prepare();
 try{
  const conf=parse(['apply',...x.args.slice(1)]);
  const first=runOnce(conf,{now});
  assert.equal(first.status,'research-chain-published-unverified');
  assert.equal(first.changed,true);
  assert.deepEqual(first.completedStages.map(z=>z.stage),['membership','sector','rotation']);
  assert.equal(first.evaluatedThreeSession,0,'two past dates have no real archives');
  assert.equal(first.evaluatedFiveSession,0);
  assert.equal(first.canTrade,false);assert.equal(first.canNotify,false);
  const actual=fs.readFileSync(x.args[4],'utf8');
  const membership=JSON.parse(actual);
  assert.equal(membership.provenance.providerLicenseIndependentlyVerified,false);
  const sectorPath=path.join(x.args[5],tradeDate,String(end)+'.json');
  const rotationPath=path.join(x.args[6],tradeDate,String(end)+'.json');
  const dated=JSON.parse(fs.readFileSync(sectorPath,'utf8'));
  assert.equal(dated.data.study.rankedSectorCount,3);
  assert.equal(dated.memberIdentity.status,'identity-frozen-unverified');
  assert.equal(dated.memberIdentity.sectors.length,3);
  assert.equal(dated.memberIdentity.sectors.every(x=>/^[a-f0-9]{64}$/.test(x.memberSha256)),true);
  assert.equal(dated.memberIdentity.canTrain,false);
  assert.equal(JSON.parse(fs.readFileSync(rotationPath,'utf8')).report.canTrade,false);
  for(const p of [x.args[4],sectorPath,rotationPath])
   assert.equal(fs.statSync(p).mode&0o777,0o600);
  const again=runOnce(conf,{now});
  assert.equal(again.changed,false);
  assert.deepEqual(again.completedStages.map(z=>z.changed),[false,false,false]);
 }finally{cleanup(x);}
});
test('stale, previous-day and future snapshots fail before writing any checkpoint',()=>{
 const x=prepare();
 try{
  for(const testNow of [end+600001,end-1,Date.parse('2026-11-11T10:03:00+08:00')]){
   const r=runOnce(parse(['apply',...x.args.slice(1)]),{now:testNow});
   assert.equal(r.status,'blocked-quote-freshness');
   assert.equal(r.completedStages.length,0);
   assert.equal(fs.existsSync(x.args[4]),false);
   assert.equal(fs.existsSync(x.args[5]),false);
  }
 }finally{cleanup(x);}
});
test('missing, reordered or future trading sessions cannot be used to mint 3-day evidence',()=>{
 const x=prepare();
 try{
  for(const dates of [['2026-11-10'],['2026-11-09','2026-11-06','2026-11-10'],
   ['2026-11-06','2026-11-09','2026-11-11']]){
   fs.writeFileSync(x.args[3],JSON.stringify({source:'imported',tradeDates:dates}));
   const r=main(['apply',...x.args.slice(1)],{now});
   assert.equal(r.status,'blocked-calendar');
   assert.equal(fs.existsSync(x.args[4]),false);
  }
 }finally{cleanup(x);}
});
test('invalid classification and quote source reject the chain before state changes',()=>{
 const x=prepare();
 try{
  x.raw.observedAt=start+1;
  fs.writeFileSync(x.args[1],JSON.stringify(x.raw));
  const invalid=main(['apply',...x.args.slice(1)],{now});
  assert.equal(invalid.status,'blocked-membership');
  assert.equal(fs.existsSync(x.args[4]),false);
  x.raw.observedAt=observedAt;
  fs.writeFileSync(x.args[1],JSON.stringify(x.raw));
  delete x.market.stocks[0].vendorQuoteAt;
  fs.writeFileSync(x.args[2],JSON.stringify(x.market));
  const missing=main(['apply',...x.args.slice(1)],{now});
  assert.equal(missing.status,'blocked-sector-evidence');
  assert.equal(fs.existsSync(x.args[4]),false);
 }finally{cleanup(x);}
});
test('immutable evidence conflict stops at preflight; partial failure can resume safely',()=>{
 const x=prepare();
 try{
  const conf=parse(['apply',...x.args.slice(1)]);
  fs.writeFileSync(x.args[4],'{"conflict":true}\n');
  assert.equal(runOnce(conf,{now}).status,'blocked-conflicting-membership');
  assert.equal(fs.existsSync(x.args[5]),false);
  fs.unlinkSync(x.args[4]);
  const badRotation=path.join(x.args[6],tradeDate,String(end)+'.json');
  fs.mkdirSync(path.dirname(badRotation),{recursive:true});
  fs.writeFileSync(badRotation,'{"untrusted":true}\n');
  assert.throws(()=>runOnce(conf,{now}),err=>{
   assert.equal(err.stage,'rotation');
   assert.deepEqual(err.completedStages.map(s=>s.stage),['membership','sector']);
   return /拒绝覆盖/.test(err.message);
  });
  assert.equal(fs.existsSync(x.args[4]),true);
  assert.equal(fs.existsSync(path.join(x.args[5],tradeDate,String(end)+'.json')),true);
  assert.equal(fs.readFileSync(badRotation,'utf8'),'{"untrusted":true}\n');
  fs.unlinkSync(badRotation);
  const recovered=runOnce(conf,{now});
  assert.equal(recovered.status,'research-chain-published-unverified');
  assert.deepEqual(recovered.completedStages.map(s=>s.changed),[false,false,true]);
  assert.equal(fs.existsSync(x.args[4]+'.sector-chain.lock'),false);
 }finally{cleanup(x);}
});
test('symlinks, input/output nesting and concurrent writer lock are rejected',()=>{
 const x=prepare();
 try{
  const alias=path.join(x.dir,'link');fs.symlinkSync(x.args[1],alias);
  assert.throws(()=>parse(['preview',alias,...x.args.slice(2)]),/符号链接/);
  assert.throws(()=>parse(['preview',...x.args.slice(1,6),x.args[5]+'/rotation']),/分开|嵌套/);
  fs.writeFileSync(x.args[4]+'.sector-chain.lock','another-process');
  assert.throws(()=>main(['apply',...x.args.slice(1)],{now}),/已有同日研究流程/);
  assert.equal(fs.existsSync(x.args[4]),false);
 }finally{cleanup(x);}
});
