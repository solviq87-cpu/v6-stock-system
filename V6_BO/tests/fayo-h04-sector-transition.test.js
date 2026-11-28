'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {bridgeExistingMarketSector:bridge}=require('../src/core/sector-breadth-market-bridge');
const {evaluateSectorRotation:evaluate}=require('../src/strategy/sector-rotation-history');
const dates=['2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10'];
const end=Date.parse(dates.at(-1)+'T10:04:00+08:00');
function make(day,{old=4,next=-2,replace=false,reverse=false,clock='10:03'}={}){
 const at=Date.parse(day+'T'+clock+':00+08:00'),startedAt=at-60000,stocks=[],sectors=[];
 for(let j=0;j<3;j++){
  const members=Array.from({length:5},(_,i)=>String(600001+j*100+i+(replace&&j===0&&i===4?50:0)));
  members.forEach((code,i)=>stocks.push({code,pctChange:[old,next,-3][j]+i*.1,vendorQuoteAt:at-5000}));
  sectors.push({category:'industry',code:'BK'+(j+1),name:['old','next','weak'][j],memberCount:5,members:reverse?[...members].reverse():members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',universeSize:stocks.length,stocks,
  startedAt:new Date(startedAt).toISOString(),retrievedAt:new Date(at).toISOString()};
 const membership={schemaVersion:1,source:'imported',provider:'licensed-industry-versioned',classificationVersion:'v1',
  tradeDate:day,observedAt:startedAt-60000,sectors};
 const b=bridge(snapshot,membership,{asOf:at});
 assert.equal(b.status,'imported-unverified');
 return {schemaVersion:1,mode:'dated-sector-research-only',status:b.status,tradeDate:day,observedAt:at,data:b,canTrade:false,verifiedLive:false};
}
const series=()=>dates.map((d,i)=>make(d,i<3?{}:{old:-2,next:4}));
const report=r=>evaluate(r,{tradeDates:dates,asOf:end});
const pair=(r,i)=>r.leadingSectorReplay.find(x=>x.category==='industry'&&x.to===dates[i]);
test('H04.5 imported frozen membership identity hashes the exact set, not order or quote count',()=>{
 const a=make(dates[0]),b=make(dates[0],{reverse:true}),c=make(dates[0],{replace:true});
 const pick=r=>r.data.study.sectors.find(s=>s.code==='BK1').memberSetHash;
 assert.equal(pick(a),crypto.createHash('sha256').update(JSON.stringify(['600001','600002','600003','600004','600005'])).digest('hex'));
 assert.equal(pick(a),pick(b));assert.notEqual(pick(a),pick(c));
});
test('H04.5 same frozen category population replays old and new broad leader without changing original ranks',()=>{
 const data=series(),before=JSON.stringify(data),r=report(data),p=pair(r,3);
 assert.equal(p.status,'descriptive-unverified');assert.equal(p.previous.code,'BK1');assert.equal(p.current.code,'BK2');
 assert.equal(p.changed,true);assert.equal(p.reason,'observed-leading-sector-switch');
 assert.equal(pair(r,1).changed,false);assert.equal(pair(r,4).changed,false);
 assert.equal(r.canTrade,false);assert.equal(r.rankingModified,false);assert.equal(p.canNotify,false);
 assert.equal(p.previous.observedAt,data[2].observedAt);assert.equal(p.current.observedAt,data[3].observedAt);
 assert.equal(JSON.stringify(data),before);
});
test('H04.5 equal-size member replacement invalidates exact history and the adjacent handover',()=>{
 const data=series();data[3]=make(dates[3],{old:-2,next:4,replace:true});
 const r=report(data);
 assert.equal(pair(r,3).reason,'frozen-sector-population-changed');
 assert.equal(r.sectors.find(s=>s.code==='BK1').fiveSession.reason,'membership-identity-changed');
});
test('H04.5 legacy or incomplete population retains old descriptive research but cannot certify a switch',()=>{
 const data=series();for(const row of data[2].data.study.sectors)delete row.memberSetHash;
 const r=report(data);
 assert.equal(pair(r,3).status,'unknown');
 const old=r.sectors.find(s=>s.code==='BK1').fiveSession;
 assert.equal(old.status,'descriptive-unverified');assert.equal(old.membershipIdentityStatus,'legacy-or-incomplete-set-evidence');
 const partial=series();partial[3].data.study.sectors[0].coveragePct=80;
 assert.equal(pair(report(partial),3).status,'unknown');
});
test('H04.5 same-score ties, missing adjacent session and different observation minute remain unknown',()=>{
 const tied=series();tied[3]=make(dates[3],{old:4,next:4});
 assert.equal(pair(report(tied),3).reason,'unique-broad-leader-unavailable');
 const gap=series();gap.splice(2,1);
 assert.equal(pair(report(gap),3).reason,'adjacent-session-archive-missing');
 const offset=series();offset[3]=make(dates[3],{old:-2,next:4,clock:'10:02'});
 assert.equal(pair(report(offset),3).reason,'classification-or-observation-minute-changed');
});
test('H04.5 replay at an earlier cut cannot know the later leader and explicitly rejects future input',()=>{
 const data=series(),at=data[2].observedAt;
 const earlier=evaluate(data.slice(0,3),{tradeDates:dates.slice(0,3),asOf:at});
 assert.equal(earlier.status,'imported-unverified');
 assert.ok(earlier.leadingSectorReplay.every(x=>x.changed!==true));
 assert.ok(earlier.leadingSectorReplay.every(x=>x.to<=dates[2]));
 assert.equal(evaluate(data,{tradeDates:dates,asOf:at}).status,'unknown');
});
