'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reviewCrossMarketLead}=require('../src/core/cross-market-lead-review');
const dates=[];for(let t=Date.parse('2026-09-28T00:00:00Z');dates.length<45;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.push(new Date(t).toISOString().slice(0,10));
const offset=d=>d<'2026-11-01'?'-04:00':'-05:00';
const openCN=d=>Date.parse(d+'T09:30:00+08:00'),closeCN=d=>Date.parse(d+'T15:00:00+08:00');
function fixture(){
 const cal=(market,ds)=>({status:'observed',source:'supplied-calendar-'+market,knownAtMs:Date.parse('2026-09-01T00:00:00Z'),days:ds,openAtByDay:Object.fromEntries(ds.map(d=>[d,d+(market==='US'?'T09:30:00'+offset(d):'T09:30:00+08:00')])),closeAtByDay:Object.fromEntries(ds.map(d=>[d,d+(market==='US'?'T16:00:00'+offset(d):'T15:00:00+08:00')]))});
 const F=cal('US',dates),C=cal('CN',dates),admitted=[];let price=100;
 const bar=(s,d,open,close,received)=>({...s,day:d,adjustment:'hfq',open,close,consensusKnownAt:received,suspended:false,canTrade:false,supportingSources:['source-a','source-b']});
 const leader={market:'US',code:'SPX',source:'us-provider',currency:'USD'},target={market:'CN',code:'000985',source:'cn-provider',currency:'CNY'};
 // China day's prior foreign return alternates. Training label majority up;
 // first holdout follows prior foreign change, last holdout opposes it.
 for(let i=0;i<dates.length;i++){const d=dates[i],old=price;price*=i%2?1.01:.99;admitted.push(bar(leader,d,old,price,Date.parse(F.closeAtByDay[d])+1000));const dir=i<23?1:i<33?((i-1)%2?1:-1):((i-1)%2?-1:1);admitted.push(bar(target,d,100,100+dir,closeCN(d)+1000));}
 const plan={leader,target,registeredAt:closeCN(dates[22])+2000,trainStart:dates[2],trainEnd:dates[22],testStart:dates[23],testEnd:dates[42]};
 return {plan,calendars:{US:F,CN:C},admitted,asOf:closeCN(dates.at(-1))+1000};
}
test('F08.1/F08.6 fixed foreign close-to-next-CN-session, DST calendar and two untouched comparison windows',()=>{
 const f=fixture(),r=reviewCrossMarketLead(f);assert.equal(r.status,'descriptive-holdout-comparison');assert.equal(r.training.baselineDirection,1);assert.equal(r.holdouts.length,2);assert.equal(r.holdouts[0].leaderMatches,10);assert.equal(r.holdouts[1].leaderMatches,0);assert.equal(r.relationshipReversal,true);assert.equal(r.leadingConfirmed,false);assert.equal(r.preregistered,false);assert.equal(r.canTrade,false);
 for(const p of r.holdouts.flatMap(x=>x.pairs)){assert.ok(p.signalKnownAt<p.targetOpenAt);assert.ok(p.targetKnownAt>=p.targetCloseAt);assert.ok(p.foreignDate<p.targetDate);}
 const pairs=r.holdouts.flatMap(x=>x.pairs);assert.equal(new Set(pairs.map(p=>p.foreignDate)).size,pairs.length);
});
test('late original receipts, missing session bars and duplicate source rows cannot be replaced with another day',()=>{
 const f=fixture(),r=reviewCrossMarketLead(f),first=r.holdouts[0].pairs[0],bar=f.admitted.find(x=>x.market==='US'&&x.day===first.foreignDate);bar.consensusKnownAt=first.targetOpenAt;
 f.admitted.push({...f.admitted.find(x=>x.market==='CN'&&x.day===r.holdouts[0].pairs[1].targetDate)});
 const q=reviewCrossMarketLead(f);assert.ok(q.holdouts[0].missing>=2);assert.ok(q.unknownRows.some(x=>x.targetDate===first.targetDate));assert.ok(!q.holdouts[0].pairs.some(x=>x.targetDate===first.targetDate));
});
test('foreign holiday never repeats the same observation as two independent signals',()=>{
 const f=fixture(),d=f.calendars.US.days[26];f.calendars.US.days=f.calendars.US.days.filter(x=>x!==d);const q=reviewCrossMarketLead(f);
 const rows=q.holdouts.flatMap(x=>x.pairs);assert.equal(new Set(rows.map(r=>r.foreignDate)).size,rows.length);assert.ok(q.unknownRows.some(x=>x.reason==='foreign-session-already-used'));
});
test('no configuration, missing time, future calendar, changed source or overlap cannot certify a relationship',()=>{
 assert.equal(reviewCrossMarketLead({}).status,'not-configured');for(const mutate of [f=>delete f.calendars.US.closeAtByDay[dates[25]],f=>f.plan.registeredAt=openCN(dates[24]),f=>f.plan.testStart=dates[20],f=>f.plan.target.source='other',f=>f.calendars.US.knownAtMs=f.asOf,f=>f.admitted.filter(r=>r.market==='US').forEach(r=>r.supportingSources=['same','same'])]){const f=fixture();mutate(f);const r=reviewCrossMarketLead(f);assert.notEqual(r.status,'descriptive-holdout-comparison');assert.equal(r.leadingConfirmed,false);}
});

test('F17.4 same-session dual-source admitted joint movement does not establish common causation',()=>{
 const f=fixture(),date=dates[24],cutoff=closeCN(date)+5000,series=[{code:'000985',kind:'broad-index',source:'cn-provider'},{code:'510300',kind:'industry-etf',source:'cn-provider'}];
 const plan={date,registeredAt:openCN(date)-1000,thresholdPct:3,series};
 const admitted=series.map(s=>({market:'CN',code:s.code,day:date,adjustment:'hfq',source:s.source,currency:'CNY',open:100,close:95,consensusKnownAt:closeCN(date)+1000,suspended:false,canTrade:false,supportingSources:['a','b']}));
 const comparisons=series.map(s=>({market:'CN',code:s.code,day:date,adjustment:'hfq',status:'admitted',independentSources:2}));
 const read=()=>require('../src/core/cross-market-lead-review').reviewCommonAssetShock({plan,calendar:f.calendars.CN,gate:{admitted,comparisons},asOf:cutoff});
 let r=read();assert.equal(r.shock,'common-down-observation');assert.equal(r.causalInferenceVerified,false);assert.equal(r.canTrade,false);
 admitted[1].close=101;assert.equal(read().shock,'no-joint-threshold-observation');
 comparisons[1].status='source-value-or-time-conflict';r=read();assert.equal(r.shock,null);assert.equal(r.status,'incomplete-source-evidence');
 comparisons[1].status='admitted';admitted[1].supportingSources=['a','a'];assert.equal(read().shock,null);
});
