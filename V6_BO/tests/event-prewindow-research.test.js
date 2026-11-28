'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {preEventComparison}=require('../src/core/event-prewindow-research');
const dates=[];for(let t=Date.parse('2026-07-01T00:00:00Z');dates.length<90;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.push(new Date(t).toISOString().slice(0,10));
const close=d=>Date.parse(d+'T15:00:00+08:00');
function fixture(horizon=5){
 const publishedAt=close(dates[70])-3600000,event={symbol:'600000',publishedAt,firstKnownAt:publishedAt+86400000,recordedAt:publishedAt+86400000},stocks=new Map(),indices=new Map();
 for(const date of dates){const knownAt=close(date)+1000;stocks.set(date,{date,code:'600000',source:'source-stock',priceBasis:'unadjusted',open:10,close:11,corporateAction:false,knownAt});indices.set(date,{date,source:'source-index',open:100,close:105,knownAt,receivedAt:knownAt});}
 const input={event,dates,horizon,stockSource:'source-stock',indexSource:'source-index',calendarKnownAt:close(dates[0]),calendarHash:'a'.repeat(64),readStock:d=>stocks.get(d),readIndex:d=>indices.get(d)};return {input,stocks,indices,run:()=>preEventComparison(input)};
}
const safe=r=>{assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);assert.equal(r.preregistered,false);assert.equal(r.causalInferenceVerified,false);assert.equal(r.matchedIndustry,null);assert.equal(r.netAbnormalReturnPct,null);assert.equal(r.confidenceInterval,null);};
test('fixed pre-publication 20-session estimate and equal-horizon placebo use the same archived sources',()=>{const f=fixture(),r=f.run();safe(r);assert.equal(r.status,'descriptive-unverified');assert.equal(r.estimationDates.length,20);assert.equal(r.placeboDates.length,5);assert.equal(r.placeboDates.at(-1),dates[69]);assert.equal(r.cutoff,f.input.event.publishedAt);assert.ok(Math.abs(r.placeboGrossExcessPct-5)<1e-10);assert.ok(Math.abs(r.dailyGrossExcessMeanPct-5)<1e-10);assert.match(r.evidenceHash,/^[a-f0-9]{64}$/);});
test('the delayed event receipt cannot move the pre-event cutoff into the public event reaction',()=>{const f=fixture(),a=f.run();f.input.event.recordedAt+=86400000*10;assert.deepEqual(f.run(),a);});
test('60-session placebo needs all 60 prior sessions and 20-session estimation is independent',()=>{const f=fixture(60),r=f.run();assert.equal(r.placeboDates.length,60);assert.equal(r.estimationDates.length,20);f.input.dates=dates.slice(30);const missing=f.run();safe(missing);assert.equal(missing.reason,'pre-event-window-insufficient');assert.equal(missing.placeboGrossExcessPct,null);});
test('future-at-publication stock/index receipts, gaps, corporate actions and changed sources withhold placebo',()=>{for(const mutate of [f=>f.stocks.delete(dates[60]),f=>f.stocks.get(dates[60]).knownAt=f.input.event.publishedAt+1,f=>f.indices.get(dates[60]).receivedAt=f.input.event.publishedAt+1,f=>f.stocks.get(dates[60]).corporateAction=true,f=>f.stocks.get(dates[60]).corporateActionKnownAt=f.input.event.publishedAt+1,f=>f.stocks.get(dates[60]).corporateActionKnownAt=null,f=>f.stocks.get(dates[60]).knownAt=f.input.event.publishedAt,f=>f.stocks.get(dates[60]).source='other',f=>f.indices.get(dates[60]).date=dates[59],f=>f.indices.get(dates[60]).open=0]){const f=fixture();mutate(f);const r=f.run();safe(r);assert.equal(r.status,'unknown');assert.equal(r.placeboGrossExcessPct,null);}});
test('calendar must already be known, complete and ordered, not inferred from observed prices',()=>{for(const mutate of [f=>f.input.calendarKnownAt=f.input.event.publishedAt+1,f=>f.input.calendarHash='bad',f=>f.input.dates=[...dates,dates.at(-1)]]){const f=fixture();mutate(f);assert.equal(f.run().reason,'pre-event-calendar-unavailable');}});
test('unknown market benchmark never becomes a matched industry or net abnormal return',()=>{const f=fixture();f.input.indexSource=null;const r=f.run();safe(r);assert.equal(r.reason,'same-source-market-comparison-unavailable');assert.equal(r.placeboGrossExcessPct,null);});
test('neutral actual zeros remain zero, unknown cannot be replaced by zero and evidence version changes',()=>{const f=fixture();const a=f.run();for(const x of f.stocks.values())x.close=x.open;for(const x of f.indices.values())x.close=x.open;const b=f.run();assert.equal(b.placeboGrossExcessPct,0);assert.notEqual(b.evidenceHash,a.evidenceHash);f.stocks.delete(dates[69]);assert.equal(f.run().placeboGrossExcessPct,null);});

const {eventRegimeOverlay}=require('../src/core/event-prewindow-research');
function regimeFixture(){
 const f=fixture();const e=f.input.event,start=dates.findIndex(d=>Date.parse(d+'T09:30:00+08:00')>e.recordedAt),first=dates[start],second=dates[start+1];
 // Sixty prior sessions of declining prices, followed by a short rebound.
 dates.forEach((d,i)=>{const x=f.indices.get(d);x.open=200-i;x.close=199-i;});
 Object.assign(f.indices.get(first),{open:100,close:105});Object.assign(f.indices.get(second),{open:105,close:99});
 const args={...f.input,asOf:close(second)+10000};return {...f,args,first,second,run:()=>eventRegimeOverlay(args)};
}
test('long background is frozen before the event; single-day rebound and next-day fading remain short evidence',()=>{
 const f=regimeFixture(),v=f.run();assert.equal(v.status,'observed-unverified');assert.equal(v.longContext.direction,'downward-price-context');assert.equal(v.shortReaction.phase,'first-day-rise-faded');assert.equal(v.longContext.sessions,60);assert.ok(v.shortReaction.dayOneReturnPct>0);assert.ok(v.shortReaction.twoDayReturnPct<0);assert.equal(v.productionRegimeChanged,false);assert.equal(v.causalInferenceVerified,false);assert.equal(v.canTrade,false);
 f.args.asOf=close(f.first)+10000;const first=f.run();assert.deepEqual(first.longContext,v.longContext);assert.equal(first.shortReaction.phase,null);assert.equal(first.shortReaction.twoDayReturnPct,null);
});
test('late or missing long context never becomes bullish from a single-day rebound',()=>{
 const f=regimeFixture();f.indices.get(dates[40]).receivedAt=f.args.event.publishedAt+1;let v=f.run();assert.equal(v.longContext.direction,null);assert.equal(v.shortReaction.phase,'first-day-rise-faded');assert.equal(v.status,'partial-or-unknown');
 f.indices.delete(f.second);v=f.run();assert.equal(v.shortReaction.phase,null);assert.equal(v.shortReaction.twoDayReturnPct,null);
});
test('two-day context does not cross source identity or rely on post-cutoff evidence',()=>{
 const f=regimeFixture();f.indices.get(f.second).source='other';assert.equal(f.run().shortReaction.status,'first-session-observed');
 f.indices.get(f.first).receivedAt=f.args.asOf+1;assert.equal(f.run().shortReaction.status,'unknown');
 f.args.calendarKnownAt=f.args.event.publishedAt;assert.equal(f.run().status,'unknown');
});
