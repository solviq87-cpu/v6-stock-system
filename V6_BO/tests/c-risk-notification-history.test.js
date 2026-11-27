'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/risk-workbench-read-scope.mjs');
const at=Date.parse('2026-11-27T10:00:00+08:00'),id=n=>n.toString(16).padStart(64,'0');
const event=(n,kind='first-seen',offset=0)=>({id:id(n),kind,at:at+offset});
function row(e,extra={}){return {eventId:e.id,kind:e.kind,eventRecordedAt:e.at,status:'receiver-confirmed',deliveryId:id(1000+parseInt(e.id,16)),
 reservedAt:e.at+100,reservationDelayMs:100,firstReceiptRecordedAt:e.at+200,lastReceiptRecordedAt:e.at+500,gatewayAcceptedReceiptAt:e.at+200,
 conflictingGatewayReceipts:false,receiverReceivedAt:e.at+300,receiverReceiptRecordedAt:e.at+500,receiverObservationDelayMs:300,
 actualUserActionAt:null,actualExecutableExitAt:null,actualAvoidedLoss:null,...extra};}
function group(root='quote/600000',events=[event(1),event(2,'escalated',1000)]){
 const rows=events.slice(-16).map(e=>row(e)),last=rows.at(-1);
 return {rootCauseId:root,events,notificationEventId:last.eventId,notification:{status:last.status,deliveryId:last.deliveryId,eventId:last.eventId,
  rootCauseId:root,queuedAt:last.reservedAt,gatewayAccepted:true,receiverConfirmed:true},notificationReview:{totalEvents:events.length,shownEvents:rows.length,
  omittedEvents:events.length-rows.length,rows,canTrade:false,receiverConfirmationSupported:false,actualWarningEffectCertified:false}};
}
function fixture(groups=[group()]){return {protocol:'fayo-risk-workbench-v1',account:{id:'pool'},accountEpoch:id(4000),generatedAt:at+50000,
 alerts:{schemaVersion:1,accountId:'pool',accountEpoch:id(4000),revision:9,updatedAt:at+40000,canTrade:false,ledgerOwned:false,
 receiverConfirmationSupported:false,preferences:{},groups}};}
const history=async f=>(await api).projectRiskNotificationHistory(f);
const old=(f)=>f.alerts.groups[0].notificationReview.rows[0];
test('C19.1 exact same-account historical notification projection preserves timing without claiming action',async()=>{
 const f=fixture(),before=JSON.stringify(f),r=await history(f);assert.equal(r.status,'historical-only');assert.equal(r.totalGroups,1);
 const x=r.groups[0].rows[0];assert.equal(x.eventRecordedAt,at);assert.equal(x.reservedAt,at+100);assert.equal(x.receiverReceivedAt,at+300);
 assert.equal(x.receiverReceiptRecordedAt,at+500);assert.equal(x.actualAvoidedLoss,null);assert.equal(x.actualUserActionAt,null);
 assert.equal(r.actualWarningEffectCertified,false);assert.equal(r.canTrade,false);assert.equal(JSON.stringify(f),before);
});
test('C19.1 private history needs original account, epoch, observed clock and full-account scope',async()=>{
 for(const edit of [f=>f.alerts.accountId='pre',f=>f.alerts.accountEpoch=id(5),f=>f.selectedCode='600000',f=>f.alerts.updatedAt=f.generatedAt+1,
 f=>f.alerts.updatedAt=null,f=>f.alerts.receiverConfirmationSupported=true,f=>f.alerts.canTrade=true]){
  const f=fixture();edit(f);const r=await history(f);assert.equal(r.status,'unknown');assert.equal(r.totalGroups,null);assert.deepEqual(r.groups,[]);
 }
});
test('C19.2 exact bounded suffix, event identity and chronology are required',async()=>{
 for(const edit of [g=>g.notificationReview.shownEvents++,g=>g.notificationReview.omittedEvents++,g=>g.notificationReview.rows.reverse(),
 g=>g.notificationReview.rows[0].kind='resolved',g=>g.events[1].id=g.events[0].id,g=>g.events[1].at=g.events[0].at-1,g=>g.notificationEventId=id(8)]){
  const f=fixture();edit(f.alerts.groups[0]);const r=await history(f);assert.equal(r.status,'partial');assert.equal(r.groups[0].status,'unknown');
 }
});
test('C19.2 old producer remains compatible and unknown rather than pretending no history',async()=>{
 const f=fixture();delete f.alerts.groups[0].notificationReview;
 const r=await history(f);assert.equal(r.status,'partial');assert.equal(r.groups[0].status,'unknown');assert.equal(r.totalGroups,1);
 const empty=fixture([]);empty.alerts.updatedAt=null;const z=await history(empty);assert.equal(z.status,'historical-only');assert.equal(z.totalGroups,0);
});
test('C19.3 event, reservation, gateway and receiver clocks cannot be reversed or future dated',async()=>{
 for(const patch of [{reservedAt:at-1},{reservationDelayMs:99},{firstReceiptRecordedAt:at+600},{lastReceiptRecordedAt:at+50001},
 {gatewayAcceptedReceiptAt:at+199},{receiverReceivedAt:at+501},{receiverReceiptRecordedAt:at+199},{receiverObservationDelayMs:301},{receiverReceivedAt:null}]){
  const f=fixture();Object.assign(old(f),patch);assert.equal((await history(f)).groups[0].status,'unknown');
 }
});
test('C19.3 rejected or unknown result cannot retain a fake receiver or conflicting acceptance clock',async()=>{
 for(const patch of [{status:'gateway-rejected'},{status:'unconfirmed'},{status:'not-queued'},{conflictingGatewayReceipts:true}]){
  const f=fixture();Object.assign(old(f),patch);assert.equal((await history(f)).groups[0].status,'unknown');
 }
 const f=fixture();Object.assign(old(f),{status:'unconfirmed',conflictingGatewayReceipts:true,gatewayAcceptedReceiptAt:null,
 receiverReceivedAt:null,receiverReceiptRecordedAt:null,receiverObservationDelayMs:null});
 const r=await history(f);assert.equal(r.groups[0].rows[0].status,'unconfirmed');assert.equal(r.groups[0].rows[0].gatewayAcceptedReceiptAt,null);
});
test('C19.4 latest history row must match the existing notification receipt identity and confirmation state',async()=>{
 for(const patch of [{deliveryId:id(9999)},{eventId:id(9999)},{rootCauseId:'quote/600001'},{queuedAt:at},{status:'queued'},{receiverConfirmed:false},{gatewayAccepted:false}]){
  const f=fixture();Object.assign(f.alerts.groups[0].notification,patch);assert.equal((await history(f)).groups[0].status,'unknown');
 }
});
test('C19.4 duplicate receipt across roots hides both conflicting projections but not independent roots',async()=>{
 const a=group(),b=group('quote/600001',[event(3)]),c=group('quote/600002',[event(4)]);
 b.notificationReview.rows[0].deliveryId=a.notificationReview.rows[0].deliveryId;b.notification.deliveryId=b.notificationReview.rows[0].deliveryId;
 const r=await history(fixture([a,b,c]));assert.equal(r.status,'partial');assert.equal(r.groups[0].status,'unknown');assert.equal(r.groups[1].status,'unknown');assert.equal(r.groups[2].rows.length,1);
});
test('C19.5 no action or avoided-loss claim enters projection and arbitrary provider fields are removed',async()=>{
 for(const patch of [{actualUserActionAt:at+300},{actualExecutableExitAt:at+400},{actualAvoidedLoss:1}]){
  const f=fixture();Object.assign(old(f),patch);assert.equal((await history(f)).groups[0].status,'unknown');
 }
 const f=fixture();old(f).providerSecret='not-for-display';old(f).canAuthorize=true;
 const r=await history(f);assert.equal(Object.hasOwn(r.groups[0].rows[0],'providerSecret'),false);assert.equal(Object.hasOwn(r.groups[0].rows[0],'canAuthorize'),false);
});
test('C19.5 bounded display retains omission counts and never invents complete review',async()=>{
 const groups=Array.from({length:21},(_,i)=>group('root/'+i,Array.from({length:17},(_,j)=>event(20*i+j+1,j?'escalated':'first-seen',j*1000))));
 const r=await history(fixture(groups));assert.equal(r.totalGroups,21);assert.equal(r.groups.length,20);assert.equal(r.omittedGroups,1);
 assert.ok(r.groups.every(g=>g.totalEvents===17&&g.rows.length===16&&g.omittedEvents===1));assert.equal(r.actualWarningEffectCertified,false);
});
test('C19.3 ordinary unsent, queued and timed-out original events do not become confirmed deliveries',async()=>{
 const e=event(1),g=group('quote/600000',[e]),f=fixture([g]),x=g.notificationReview.rows[0];
 for(const status of ['queued','unconfirmed']){
  Object.assign(x,{status,firstReceiptRecordedAt:null,lastReceiptRecordedAt:null,gatewayAcceptedReceiptAt:null,
   receiverReceivedAt:null,receiverReceiptRecordedAt:null,receiverObservationDelayMs:null});
  Object.assign(g.notification,{status,receiverConfirmed:false,gatewayAccepted:false});
  assert.equal((await history(f)).groups[0].rows[0].status,status);
 }
 Object.assign(x,{status:'not-queued',deliveryId:null,reservedAt:null,reservationDelayMs:null});
 g.notification={status:'not-queued',deliveryId:null,receiverConfirmed:false,gatewayAccepted:false};
 assert.equal((await history(f)).groups[0].rows[0].status,'not-queued');
 x.reservedAt=at+100;assert.equal((await history(f)).groups[0].status,'unknown');
});
