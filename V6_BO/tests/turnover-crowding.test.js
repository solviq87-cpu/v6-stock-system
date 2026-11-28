'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTurnoverCrowding}=require('../src/core/turnover-crowding');
const times=[];for(let t=Date.parse('2026-09-01T10:02:00+08:00');times.length<23;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))times.push(t);
const codes=['000001','000002','000003','000004'];
const snap=(at,amounts=[25,25,25,25],patch={})=>({date:new Date(at+28800000).toISOString().slice(0,10),source:'eastmoney-clist-unverified-live',universeSize:4,
 startedAt:new Date(at-10000).toISOString(),retrievedAt:new Date(at).toISOString(),sourceCoverage:{monetaryUnit:'provider-CNY-unverified'},
 stocks:amounts.map((amount,i)=>({code:codes[i],amount,pctChange:1,vendorQuoteAt:at-2000-i*1000})),...patch});
const observe=(r,s,opts={})=>r.observe(s,{asOf:Date.parse(s.retrievedAt),...opts});
function seed(r=createTurnoverCrowding(),count=20){for(let i=0;i<count;i++){const v=observe(r,snap(times[i]));assert.equal(v.status,'insufficient-history');assert.equal(v.referenceDays,i);}return r;}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
const noRank=(v,status)=>{assert.equal(v.status,status);assert.equal(v.empiricalPercentile,null);assert.equal(v.canTrade,false);assert.equal(v.canNotify,false);};
test('cold start preserves current HHI but never fabricates historical percentile',()=>{
 const v=observe(createTurnoverCrowding(),snap(times[0],[0,10,20,70]));noRank(v,'insufficient-history');close(v.currentHHI,.54);assert.equal(v.referenceDays,0);assert.equal(v.slot,120);
});
test('20 prior observed days produce empirical rank with independent point-in-time references',()=>{
 const v=observe(seed(),snap(times[20],[0,0,0,100]));assert.equal(v.status,'observed-unverified');assert.equal(v.empiricalPercentile,100);assert.equal(v.referenceDays,20);
 assert.equal(v.historicalMin,.25);assert.equal(v.historicalMax,.25);assert.equal(v.currentHHI,1);assert.equal(new Set(v.references.map(x=>x.date)).size,20);
 assert.ok(v.references.every(x=>x.end<v.startedAt&&x.memberHash===v.memberHash&&x.slot===v.slot));assert.equal(v.canTrade,false);assert.equal(v.canNotify,false);
});
test('ties are midrank, not a false extreme',()=>{assert.equal(observe(seed(),snap(times[20])).empiricalPercentile,50);});
test('missing amount, zero total, overflow, duplicate, mixed unit and incomplete coverage withhold HHI',()=>{
 for(const change of [s=>delete s.stocks[0].amount,s=>s.stocks[0].amount=null,s=>s.stocks[0].amount=-1,s=>s.stocks[0].amount='1',s=>s.stocks.forEach(x=>x.amount=0),s=>s.stocks.forEach(x=>x.amount=Number.MAX_VALUE),s=>s.stocks[1].code=s.stocks[0].code,s=>s.sourceCoverage.monetaryUnit='USD',s=>s.universeSize=5,s=>s.stocks[0].source='other']){
  const s=snap(times[0]);change(s);const v=observe(createTurnoverCrowding(),s);noRank(v,'invalid-or-incomplete-snapshot');assert.equal(v.currentHHI,null);
 }
});
test('stale, future, synthetic, conflicted and out-of-session quotes stay unavailable',()=>{
 for(const change of [s=>s.stocks[0].vendorQuoteAt=times[0]-90001,s=>s.stocks[0].vendorQuoteAt=times[0]+1,s=>s.stocks[0].synthetic=true,s=>s.stocks[0].sourceConflict=true,s=>s.stocks[0].suspended=true,s=>s.stocks[0].pctChange=null,s=>s.stocks[0].symbol='000099',s=>s.startedAt=new Date(times[0]-180000).toISOString(),s=>s.source='other']){
  const s=snap(times[0]);change(s);noRank(observe(createTurnoverCrowding(),s),'invalid-or-incomplete-snapshot');
 }
 const weekend=Date.parse('2026-09-05T10:02:00+08:00'),lunch=Date.parse('2026-09-01T12:02:00+08:00');
 for(const at of [weekend,lunch])noRank(observe(createTurnoverCrowding(),snap(at)),'invalid-or-incomplete-snapshot');
});
test('same-size different roster and different time slot cannot borrow history',()=>{
 let r=seed(),s=snap(times[20]);s.stocks[3].code='000099';noRank(observe(r,s),'insufficient-history');
 r=seed();const v=observe(r,snap(times[20]+300000));noRank(v,'insufficient-history');assert.equal(v.referenceDays,0);
});
test('duplicate exact replay does not add history; later same-slot samples do not replace frozen baseline',()=>{
 const r=seed(),s=snap(times[20]),v=observe(r,s);assert.equal(v.empiricalPercentile,50);assert.deepEqual(observe(r,s),v);
 noRank(observe(r,snap(times[20]+20000,[0,0,0,100])),'slot-already-frozen');
 const next=observe(r,snap(times[21]));assert.equal(next.referenceDays,20);assert.equal(next.references.at(-1).turnoverHHI,.25);
});
test('contradictory same completion and same original quote correction invalidate frozen slot',()=>{
 let r=seed(),s=snap(times[20]);observe(r,s);noRank(observe(r,snap(times[20],[0,0,0,100])),'disputed-slot');noRank(observe(r,s),'disputed-slot');
 assert.equal(observe(r,snap(times[21])).referenceDays,19);
 r=seed();observe(r,s);const changed=snap(times[20]+1000,[0,0,0,100]);changed.stocks.forEach((x,i)=>x.vendorQuoteAt=s.stocks[i].vendorQuoteAt);
 noRank(observe(r,changed),'disputed-slot');
});
test('out-of-order and future capture cannot poison history watermark',()=>{
 const r=seed();noRank(observe(r,snap(times[3])),'out-of-order');noRank(observe(r,snap(times[22]),{asOf:times[20]}),'invalid-or-incomplete-snapshot');
 assert.equal(observe(r,snap(times[20])).referenceDays,20);
});
test('history retains only prior 20 observed dates, returned evidence is detached',()=>{
 const r=seed(),v=observe(r,snap(times[20]));v.references[0].turnoverHHI=99;const next=observe(r,snap(times[21]));assert.equal(next.references.length,20);
 assert.equal(next.references[0].date,snap(times[1]).date);assert.ok(next.references.every(x=>x.turnoverHHI===.25));
});
const membership=at=>({schemaVersion:1,source:'imported',provider:'official-industry',classificationVersion:'v2026',tradeDate:snap(at).date,observedAt:at-20000,sectors:[
 {category:'industry',code:'I01',name:'行业甲',members:codes.slice(0,2),memberCount:2},{category:'industry',code:'I02',name:'行业乙',members:codes.slice(2),memberCount:2},
 {category:'concept',code:'C01',name:'概念重叠',members:codes,memberCount:4}]});
test('complete disjoint frozen industries produce turnover shares and HHI without concept double-count',()=>{
 const v=observe(createTurnoverCrowding(),snap(times[0],[10,20,30,40]),{membership:membership(times[0])});const i=v.industry;
 assert.equal(i.status,'observed-unverified');close(i.industryHHI,.58);assert.equal(i.industryCount,2);close(i.topIndustries[0].share,.7);assert.equal(i.topIndustries[0].code,'I02');assert.equal(i.canTrade,false);
});
test('overlap, outside members, missing classification and late evidence cannot produce industry HHI',()=>{
 for(const change of [m=>m.sectors[1].members[0]='000001',m=>m.sectors[1].members[0]='000099',m=>m.sectors.splice(1,1),m=>m.observedAt=times[0],m=>delete m.classificationVersion,m=>m.sectors[1].code='I01']){
  const m=membership(times[0]);change(m);const v=observe(createTurnoverCrowding(),snap(times[0]),{membership:m});assert.equal(v.industry.status,'unavailable');assert.equal(v.industry.industryHHI,null);assert.equal(v.currentHHI,.25);
 }
});
