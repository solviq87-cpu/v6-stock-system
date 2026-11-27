'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditQuoteSourceWindow:audit}=require('../src/core/quote-source-window-quality');
const {auditSnapshotQuoteTimes:quoteAudit,classifyQuoteTime}=require('../src/core/market-snapshot-quote-time');
const {createMarketSourceCadence}=require('../src/core/market-source-cadence');
const at=Date.parse('2026-11-26T10:00:00+08:00'),slots=[at,at+60000,at+120000];
const report=slot=>({schemaVersion:1,mode:'two-source-public-quote-diagnostic',code:'600001',asOf:new Date(slot+1000).toISOString(),source1:'tencent',source2:'eastmoney',canTrade:false,canNotify:false,certifiedLive:false,exchangeVerified:false,providerLicensed:false,calendarVerified:false,status:'sources-agree-unverified',discrepancyBps:0,quoteAt:slot,quoteTimeGapMs:0,sourceStatuses:['tencent','eastmoney'].map(provider=>({provider,status:'fresh-unverified',quoteAt:slot}))});
const sample=()=>({registeredAt:at-1000,asOf:at+180000,expectedSlots:[...slots],observations:slots.map(slotAt=>({slotAt,report:report(slotAt)}))});
const changed=fn=>{const x=sample();fn(x.observations[0].report,x);return audit(x);};
const assertBlocked=fn=>assert.equal(changed(fn).status,'blocked');
test('01 synthetic diagnostic report cannot count as a real observation',()=>{for(const k of ['synthetic','simulated','fixture','mock','testSample'])assertBlocked(r=>r[k]=true);});
test('02 extra authority flags contradict a research-only diagnostic',()=>{for(const k of ['canTrain','verifiedLive','canAutoSelectProvider','releaseReady'])assertBlocked(r=>r[k]=true);});
test('03 synthetic provider rows cannot count toward fresh coverage',()=>{for(const k of ['synthetic','simulated','fixture','mock','testSample'])assertBlocked(r=>r.sourceStatuses[0][k]=true);});
test('04 provider-row execution or certification claims are rejected',()=>{for(const k of ['canTrade','canNotify','providerLicensed','exchangeVerified'])assertBlocked(r=>r.sourceStatuses[0][k]=true);});
test('05 contradictory provider aliases cannot pass the exact-source pair contract',()=>{for(const k of ['id','source','quoteSource','quoteProvider'])assertBlocked(r=>r.sourceStatuses[0][k]='eastmoney');});
test('06 provider row cannot claim a different security',()=>{for(const k of ['code','symbol'])assertBlocked(r=>r.sourceStatuses[0][k]='600002');});
test('07 incomplete pair cannot carry a numerical alignment claim',()=>{
 assertBlocked(r=>{Object.assign(r,{status:'insufficient-fresh-sources',quoteAt:null,discrepancyBps:null,quoteTimeGapMs:0});Object.assign(r.sourceStatuses[1],{status:'unavailable',quoteAt:null});});
});
test('08 outside-session report cannot carry a numerical alignment claim',()=>{
 const x=sample(),base=Date.parse('2026-11-26T08:00:00+08:00');
 x.registeredAt=base-1000;x.asOf=base+180000;x.expectedSlots=[base,base+60000,base+120000];
 x.observations=x.expectedSlots.map(slotAt=>({slotAt,report:{...report(slotAt),status:'outside-weekday-session-window',quoteAt:null,discrepancyBps:null,quoteTimeGapMs:0,sourceStatuses:[]}}));
 assert.equal(audit(x).status,'blocked');
});
test('09 sparse predeclared slots cannot fabricate a denominator',()=>{
 const x=sample();delete x.expectedSlots[2];x.observations.pop();assert.equal(audit(x).status,'blocked');
});
const midnight=Date.parse('2026-11-27T00:00:00+08:00'),day='2026-11-26',row={code:'600001',vendorQuoteAt:midnight-1000};
test('10 previous-day original quote cannot become fresh on next-day receipt',()=>{
 const r=classifyQuoteTime(row,{requestDate:day,retrievedAt:midnight,originalRetrievedAt:midnight});assert.equal(r.quoteTimeStatus,'historical-snapshot');assert.equal(r.quoteAt,row.vendorQuoteAt);
});
test('11 valid original receipt remains historical when audited across midnight',()=>{
 const r=classifyQuoteTime(row,{requestDate:day,retrievedAt:midnight,originalRetrievedAt:midnight-500});assert.equal(r.quoteTimeStatus,'historical-snapshot');assert.equal(r.quoteAt,row.vendorQuoteAt);
});
test('12 duplicate security observations cannot inflate fresh quote coverage',()=>{
 const r=quoteAudit({date:day,retrievedAt:new Date(at).toISOString(),stocks:[{code:'600001',vendorQuoteAt:at},{code:'600001',vendorQuoteAt:at},{code:'600002',vendorQuoteAt:at}]});
 assert.equal(r.total,3);assert.equal(r.recentSourceTimeCount,1);assert.equal(r.counts['duplicate-symbol'],2);
});
test('13 invalid freshness thresholds must be rejected even for empty observations',()=>{
 const x={date:day,retrievedAt:new Date(at).toISOString(),stocks:[]};for(const invalid of [NaN,0,-1,300001,1.5])assert.throws(()=>quoteAudit(x,{maxAgeMs:invalid}),/时钟|阈值/);
});
test('14 invalid cadence intervals cannot dispatch or reserve a successful observation',async()=>{
 let calls=0;const read=createMarketSourceCadence(()=>at),collect=()=>++calls;
 for(const interval of [NaN,Infinity,-1,1.5,'1000']){const r=await read('source','session',interval,collect);assert.equal(r.status,'rejected');assert.equal(r.finishedAt,null);}
 assert.equal(calls,0);assert.equal((await read('source','session',1000,collect)).value,1);
});
test('15 invalid cadence identities cannot create slots or invoke a collector',async()=>{
 let calls=0;const read=createMarketSourceCadence(()=>at),collect=()=>++calls;
 for(const [key,session] of [[null,'s'],['','s'],['p',null],['p',''],[{},'s'],['p',{}]]){const r=await read(key,session,1000,collect);assert.equal(r.status,'rejected');assert.equal(r.finishedAt,null);}
 assert.equal(calls,0);assert.equal((await read('p','s',1000,collect)).value,1);
});
test('16 invalid collector cannot reserve cooldown or poison a subsequent valid request',async()=>{
 const read=createMarketSourceCadence(()=>at);for(const collector of [null,undefined,{},123]){const r=await read('p','s',1000,collector);assert.equal(r.status,'rejected');assert.equal(r.finishedAt,null);}
 assert.equal((await read('p','s',1000,()=>7)).value,7);
});
test('controls: valid reports and original same-day time boundaries remain research-only',()=>{
 const result=audit(sample());assert.equal(result.status,'limited-alignment-unverified');assert.equal(result.pair.timeAlignedPairs,3);assert.equal(result.canTrade,false);
 const recent=classifyQuoteTime({vendorQuoteAt:at-90000},{requestDate:day,retrievedAt:at});assert.equal(recent.quoteTimeStatus,'recent-source-unverified');assert.equal(recent.canTrade,false);
 const stale=classifyQuoteTime({vendorQuoteAt:at-90001},{requestDate:day,retrievedAt:at});assert.equal(stale.quoteTimeStatus,'stale-source-time');
 const x=sample();Object.assign(x.observations[0].report,{status:'insufficient-fresh-sources',quoteAt:null,discrepancyBps:null,quoteTimeGapMs:undefined});Object.assign(x.observations[0].report.sourceStatuses[1],{status:'unavailable',quoteAt:null});assert.notEqual(audit(x).status,'blocked');
});
