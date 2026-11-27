'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSessionIndexFeed}=require('../src/core/session-index-feed');
const {auditAuctionResonanceBasis}=require('../src/core/auction-resonance-basis');
const {fetchEastmoneyCurrentBoards}=require('../src/core/eastmoney-current-board-members');
const START=Date.parse('2026-11-26T10:00:00+08:00');
const session={day:'20261126',trading:true,openDay:true,minute:600};
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
function indexFixture(){
 let now=START,broken=false,calls=0;
 const feed=createSessionIndexFeed({clock:()=>{if(broken)throw Error('clock');return now;},
  primary:async()=>{calls++;return [{code:'1.000001',price:100,pct:1,quoteSource:'tencent-index',quoteAt:now-1000,receivedAt:now}];},backup:async()=>[]});
 return {feed,set:at=>{now=at;},broken:value=>{broken=value;},calls:()=>calls};
}
test('index clock rollback remains blocked until original high water, including repeated reads',async()=>{
 const f=indexFixture();f.feed.read(session);await flush();assert.equal(f.feed.read(session).indices.length,1);
 f.set(START-1000);assert.equal(f.feed.read(session).indices.length,0);await flush();
 f.feed.read(session);await flush();assert.equal(f.calls(),1);assert.equal(f.feed.read(session).indices.length,0);
 f.set(START+5000);f.feed.read(session);await flush();assert.equal(f.calls(),2);
 assert.equal(f.feed.read(session).indices.length,1);
});
test('throwing clock clears the index observation, keeps cooldown and recovers normally',async()=>{
 const f=indexFixture();f.feed.read(session);await flush();assert.equal(f.feed.read(session).indices.length,1);
 f.broken(true);assert.equal(f.feed.read(session).indices.length,0);
 f.broken(false);f.set(START+1000);f.feed.read(session);await flush();assert.equal(f.calls(),1);
 f.set(START+5000);f.feed.read(session);await flush();assert.equal(f.calls(),2);
 assert.equal(f.feed.read(session).indices[0].canTrade,false);
});
test('old session labels do not evict an already valid current-day index cache',async()=>{
 const f=indexFixture();f.feed.read(session);await flush();const prior=f.feed.read(session).indices[0];
 assert.equal(f.feed.read({...session,day:'20261125'}).indices.length,0);
 assert.equal(f.feed.read(session).indices[0].quoteAt,prior.quoteAt);assert.equal(f.calls(),1);
});
const auction=()=>({auction:{date:'20261126',time:'09:25:06',phase:3},
 now:Date.parse('2026-11-26T09:26:00+08:00'),stockSnapshotAt:Date.parse('2026-11-26T09:25:40+08:00'),
 calendarDay:'20261126',expectedDay:'20261126',stockSnapshotDay:'20261126'});
test('auction date labels must be valid dates and match actual current and receipt dates',()=>{
 const good=auction();assert.equal(auditAuctionResonanceBasis(good).eligibleForAuctionEvidence,true);
 for(const label of ['20260230',20261126,'20261125']){
  const x={...good,calendarDay:label,expectedDay:label,stockSnapshotDay:label,auction:{...good.auction,date:label}};
  const r=auditAuctionResonanceBasis(x);assert.equal(r.eligibleForAuctionEvidence,false);
 }
 const wrongReceipt={...good,stockSnapshotAt:Date.parse('2026-11-25T15:00:00+08:00')};
 assert.equal(auditAuctionResonanceBasis(wrongReceipt).eligibleForAuctionEvidence,false);
});
test('future auction phase or a phase later than the stock snapshot cannot enter evidence',()=>{
 for(const x of [{...auction(),auction:{date:'20261126',time:'09:29:59',phase:3}},
  {...auction(),stockSnapshotAt:Date.parse('2026-11-26T09:24:00+08:00')},
  {...auction(),auction:{date:'20261126',time:['09:25:06'],phase:3}}]){
  assert.equal(auditAuctionResonanceBasis(x).eligibleForAuctionEvidence,false);
 }
 const good=auditAuctionResonanceBasis(auction());assert.equal(good.providerQuoteAt,null);
 assert.equal(good.capturedAt,null);assert.equal(good.executedAmountCertified,false);
});
const NOW=Date.parse('2026-11-26T16:05:00+08:00'),QUOTE=Date.parse('2026-11-26T15:00:00+08:00');
const wrap=x=>({raw:JSON.stringify(x)}),page=diff=>({rc:0,data:{total:diff.length,diff}});
function boards({members=[{f12:'600001',f13:1},{f12:'000001',f13:0}],flows=['2026-11-26,0,1,2,3,-3,0,0,0,0,0,0,0,0,0']}={}){
 return fetchEastmoneyCurrentBoards({boards:[{category:'industry',code:'BK1034'}]},{
  now:NOW,requestJson:async target=>{
   const u=new URL(target),query=u.searchParams.get('fs');
   if(u.pathname.includes('daykline'))return wrap({rc:0,data:{code:'BK1034',market:90,klines:flows}});
   if(query.startsWith('b:'))return wrap(page(members));
   return wrap(page([{f12:query.includes('t:2')?'BK1034':'BK1234',f14:'sample',f3:1,f62:0,f6:10000,f124:QUOTE/1000}]));
  }});
}
test('explicit Shanghai and Shenzhen member market contradictions prevent complete membership',async()=>{
 for(const members of [[{f12:'600001',f13:0}],[{f12:'000001',f13:1}]]){
  const r=await boards({members}),b=r.boards[0];
  assert.equal(b.membershipComplete,false);assert.equal(b.members,null);
  assert.equal(r.classificationVersion,null);assert.equal(r.dailyHistoryEligible,false);
 }
 const r=await boards();assert.equal(r.boards[0].membershipComplete,true);
 assert.equal(r.boards[0].members.length,2);assert.equal(r.canTrade,false);
});
test('an empty selected-board member page is not complete membership',async()=>{
 const r=await boards({members:[]});assert.equal(r.boards[0].membershipComplete,false);
 assert.equal(r.boards[0].members,null);assert.equal(r.dailyHistoryEligible,false);
 assert.equal(r.classificationVersion,null);
});
test('dated missing main funds remain unknown and true zero is not a missing value',async()=>{
 const r=await boards({flows:['2026-11-26,-,1,2,3,-3,0,0,0,0,0,0,0,0,0']});
 const f=r.boards[0].flowHistory;assert.equal(f.status,'unknown');assert.equal(f.records.length,1);
 assert.equal(f.records[0].mainNetInflow,null);assert.equal(f.coverage.knownMainNetInflowDates,0);
 const z=(await boards()).boards[0].flowHistory;
 assert.equal(z.status,'observed-unverified');assert.equal(z.records[0].mainNetInflow,0);
 assert.equal(z.coverage.knownMainNetInflowDates,1);
});
test('partial funds coverage preserves original dates and masks implausible ratio fields',async()=>{
 const r=await boards({flows:['2026-11-25,-,1,2,3,-3,0,0,0,0,0,0,0,0,0','2026-11-26,0,1,2,3,-3,101,-101,100,-100,0,0,0,0,0']});
 const f=r.boards[0].flowHistory;assert.equal(f.status,'partial-evidence');
 assert.equal(f.coverage.returnedDates,2);assert.equal(f.coverage.knownMainNetInflowDates,1);
 assert.equal(f.coverage.missingMainNetInflowDates,1);
 const q=f.records[1];assert.equal(q.mainNetInflowPct,null);assert.equal(q.smallNetInflowPct,null);
 assert.equal(q.midNetInflowPct,100);assert.equal(q.bigNetInflowPct,-100);
 assert.equal(q.superNetInflowPct,0);assert.equal(q.knownAt,NOW);
 assert.equal(f.historicalMembershipVerified,false);
});
