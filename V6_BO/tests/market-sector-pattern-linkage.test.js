'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluateLinkage,buildLinkagePools}=require('../src/strategy/market-sector-pattern-linkage');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {scanUniverse:scanV2}=require('../src/strategy/research-v2-universe-scanner');
const date='2026-02-04',now=Date.parse(date+'T08:00:00Z'),observedAt=now-300000;
const market={tradeDate:date,observedAt,source:'人工导入的市场广度',breadthScore:72,coverage:.92};
const sector={tradeDate:date,observedAt,source:'人工导入的行业相对强度',name:'样本板块',relativeStrengthScore:85};
function stock(){
 const bars=Array.from({length:35},(_,i)=>({
  date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
  open:10,high:10.2,low:9.8,close:10,volume:1000000,amount:120000000
 }));
 bars.splice(-3,3,
  {...bars.at(-3),open:9.8,close:10.1,low:9.7,high:10.15},
  {...bars.at(-2),open:9.95,close:10.3,low:9.8,high:10.35},
  {...bars.at(-1),open:10.1,close:10.5,low:9.9,high:10.55});
 return {symbol:'600001',name:'测试个股',feed:{source:'imported',timestamp:now},market:'main',bars};
}
const ctx={market,sectors:{'600001':sector}};
test('market and sector can reinforce ONE A-share strategy in research while leaving original score and candidate gate intact',()=>{
 const base=stock();
 for(const scanner of [scanUniverse,scanV2]){
  const before=scanner({stocks:[base],now});
  const after=scanner({stocks:[base],now,market:{linkage:ctx}});
  const old=before.items[0],item=after.items[0];
  assert.equal(item.score,old.score);
  assert.equal(item.tradable,old.tradable);
  assert.equal(item.patterns.positiveCount,old.patterns.positiveCount);
  assert.ok(item.patterns.positiveCount>=1);
  assert.equal(item.linkageResearch.positiveContextCount,2);
  assert.equal(item.linkageResearch.multipleDomainSupport,true);
  assert.equal(item.linkageResearch.marketStatus,'observed-unverified');
  assert.equal(item.linkageResearch.sectorStatus,'observed-unverified');
  assert.equal(item.linkageResearch.scoreBonus,0);
  assert.equal(item.linkageResearch.canTrade,false);
  assert.deepEqual(after.linkagePools['市场板块同向观察池'].map(x=>x.symbol),['600001']);
  assert.equal(before.items[0].linkageResearch.marketStatus,'unknown');
 }
});
test('no evidence, stale/future evidence or invalid coverage never turns into a fabricated positive signal',()=>{
 const s=stock(),args={symbol:s.symbol,bars:s.bars,patterns:{positiveCount:1,riskCount:0},quality:{usable:true},asOf:now};
 const missing=evaluateLinkage(args);
 assert.equal(missing.positiveContextCount,0);
 assert.equal(missing.marketStatus,'unknown');
 assert.equal(missing.sectorStatus,'unknown');
 for(const invalid of [
  {market:{...market,tradeDate:'2026-02-03'},sectors:ctx.sectors},
  {market:{...market,observedAt:now+1000},sectors:ctx.sectors},
  {market:{...market,observedAt:now-3600000},sectors:ctx.sectors},
  {market:{...market,coverage:.1},sectors:ctx.sectors},
  {market:{...market,breadthScore:null},sectors:ctx.sectors},
  {market:{...market,breadthScore:'72'},sectors:ctx.sectors}
 ]){
  const result=evaluateLinkage({...args,linkage:invalid});
  assert.equal(result.marketStatus,'stale-or-invalid');
  assert.equal(result.positiveContextCount,1,'valid sector is separate from invalid market');
 }
});
test('bearish market and weak sector do not cancel bullish stock recognition; they produce explicit risk conflicts',()=>{
 const s=stock();
 const result=evaluateLinkage({symbol:s.symbol,bars:s.bars,quality:{usable:true},patterns:{positiveCount:3,riskCount:1},
  linkage:{market:{...market,breadthScore:30},sectors:{'600001':{...sector,relativeStrengthScore:20}}},asOf:now});
 assert.equal(result.technicalHitCount,3);
 assert.equal(result.positiveContextCount,0);
 assert.equal(result.weakContextCount,2);
 assert.equal(result.riskConflict,true);
 assert.ok(result.risks.some(x=>x.includes('板块')));
 assert.ok(result.risks.some(x=>x.includes('K线')));
 const p=buildLinkagePools([{symbol:s.symbol,name:s.name,quality:{usable:true,fresh:true,simulated:false},blockedBySafety:false,linkageResearch:result}]);
 assert.deepEqual(p['多维风险核对池'].map(x=>x.symbol),[s.symbol]);
 assert.equal(p['市场板块同向观察池'].length,0);
});
test('cross-domain sectors are per symbol and must match the same trade date',()=>{
 const s=stock();const args={symbol:s.symbol,bars:s.bars,patterns:{positiveCount:1,riskCount:0},quality:{usable:true},asOf:now};
 const wrong=evaluateLinkage({...args,linkage:{market,sectors:{'000001':sector}}});
 assert.equal(wrong.sectorStatus,'unknown');
 assert.equal(wrong.positiveContextCount,1);
 const mixed=evaluateLinkage({...args,linkage:{market,sectors:{'600001':{...sector,tradeDate:'2026-02-03'}}}});
 assert.equal(mixed.sectorStatus,'stale-or-invalid');
 assert.equal(mixed.multipleDomainSupport,false);
});
test('unusable history and simulated data cannot join cross-domain bullish research pool',()=>{
 const s=stock(),r=evaluateLinkage({symbol:s.symbol,bars:s.bars,patterns:{positiveCount:1,riskCount:0},
 quality:{usable:true},linkage:ctx,asOf:now});
 const variants=[
 {quality:{usable:false,fresh:true,simulated:false},blockedBySafety:false},
 {quality:{usable:true,fresh:true,simulated:true},blockedBySafety:false},
 {quality:{usable:true,fresh:true,simulated:false},blockedBySafety:true}
 ];
 for(const fields of variants){
  const pools=buildLinkagePools([{symbol:s.symbol,name:s.name,linkageResearch:r,...fields}]);
  assert.equal(pools['市场板块同向观察池'].length,0);
 }
});
test('research screen exposes distinct market and sector evidence without asserting a real-time feed',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
 const script=fs.readFileSync(path.join(__dirname,'../public/assets/research-workbench.js'),'utf8');
 assert.match(html,/id="linkagePools"/);
 assert.match(script,/linkageResearch/);
 assert.match(script,/marketStatus/);
 assert.match(script,/sectorStatus/);
 assert.match(script,/未经过|未经独立|未经认证|未经独立核实/);
});
