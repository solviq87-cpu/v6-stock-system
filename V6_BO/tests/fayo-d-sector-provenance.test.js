'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bridgeExistingMarketSector:bridge}=require('../src/core/sector-breadth-market-bridge');
const {auditSnapshotQuoteTimes:audit}=require('../src/core/market-snapshot-quote-time');
const day='2026-11-26',end=Date.parse(day+'T10:00:00+08:00'),start=end-10000;
const stamp=t=>new Date(t).toISOString();
function fixture(){
 const codes=Array.from({length:5},(_,i)=>String(600001+i));
 return {snapshot:{date:day,source:'eastmoney-clist-unverified-live',universeSize:5,startedAt:stamp(start),retrievedAt:stamp(end),stocks:codes.map(code=>({code,pctChange:2,vendorQuoteAt:end-1000}))},membership:{schemaVersion:1,source:'imported',provider:'original-membership',classificationVersion:'v1',tradeDate:day,observedAt:start-1000,sectors:[{category:'industry',code:'BK1',name:'行业',members:codes,memberCount:5}]}};
}
function reject(mutate,reason){const {snapshot,membership}=fixture();mutate(snapshot,membership);const r=bridge(snapshot,membership,{asOf:end});assert.equal(r.status,'unknown');assert.equal(r.reason,reason);assert.equal(r.canTrade,false);assert.equal(r.study,null);}
test('01 timezone-free start cannot bypass original capture parser',()=>reject(s=>{s.startedAt=stamp(start).slice(0,-1);},'snapshot-clock-session-invalid'));
test('02 timezone-free receipt cannot bypass original capture parser',()=>reject(s=>{s.retrievedAt=stamp(end).slice(0,-1);},'snapshot-clock-session-invalid'));
test('03 noncanonical offset start cannot qualify sector ranking',()=>reject(s=>{s.startedAt=day+'T09:59:50.000+08:00';},'snapshot-clock-session-invalid'));
test('04 noncanonical offset receipt cannot qualify sector ranking',()=>reject(s=>{s.retrievedAt=day+'T10:00:00.000+08:00';},'snapshot-clock-session-invalid'));
test('05 whitespace-only membership provider cannot establish provenance',()=>reject((s,m)=>{m.provider='   ';},'membership-version-or-point-in-time-invalid'));
test('06 whitespace-only membership version cannot establish identity',()=>reject((s,m)=>{m.classificationVersion='   ';},'membership-version-or-point-in-time-invalid'));
test('07 explicitly synthetic market snapshot cannot supply genuine observations',()=>reject(s=>{s.synthetic=true;},'existing-market-snapshot-invalid'));
test('08 explicitly simulated member archive cannot establish a frozen universe',()=>reject((s,m)=>{m.simulated=true;},'membership-version-or-point-in-time-invalid'));
test('09 mocked sector membership cannot be laundered by projection',()=>reject((s,m)=>{m.sectors[0].mock=true;},'membership-members-invalid'));
for(const [n,flag] of ['synthetic','simulated','fixture','mock','testSample'].entries()){
 test(String(n+10).padStart(2,'0')+' marked '+flag+' quote cannot count as a fresh member',()=>reject(s=>{s.stocks[0][flag]=true;},'fresh-market-quote-coverage-insufficient'));
}
test('15 conflicting security alias cannot select a different symbol',()=>reject(s=>{s.stocks[0].symbol='600999';},'duplicated-or-malformed-market-symbol'));
test('16 explicit quote source conflict cannot enter sector breadth',()=>reject(s=>{s.stocks[0].quoteSourceConflict=true;},'fresh-market-quote-coverage-insufficient'));
test('17 a sparse member array cannot fabricate membership completeness',()=>reject((s,m)=>{delete m.sectors[0].members[0];},'membership-members-invalid'));
test('control: valid original capture, frozen membership and zero returns remain read-only',()=>{
 const {snapshot,membership}=fixture();snapshot.stocks[0].pctChange=0;const before=JSON.stringify({snapshot,membership});const r=bridge(snapshot,membership,{asOf:end});assert.equal(r.status,'imported-unverified');assert.equal(r.freshQuotes,5);assert.equal(r.canTrade,false);assert.equal(r.study.sectors[0].flatCount,1);assert.equal(JSON.stringify({snapshot,membership}),before);assert.equal(audit(snapshot,{asOf:end}).recentSourceTimeCount,5);
});
test('control: original future-at-receipt and duplicate guards remain fail-closed',()=>{
 reject(s=>{s.stocks[0].vendorQuoteAt=end+1;},'fresh-market-quote-coverage-insufficient');
 reject(s=>{s.stocks[1].code=s.stocks[0].code;},'duplicated-or-malformed-market-symbol');
});
