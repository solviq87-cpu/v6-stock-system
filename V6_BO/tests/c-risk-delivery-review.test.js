'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {digest}=require('../src/core/research-workspace-store');
const {createRiskAlertLifecycle,normalizeRiskReceipt}=require('../src/core/risk-alert-lifecycle');
const at=Date.parse('2026-11-27T10:00:00+08:00'),key={accountId:'pool',accountEpoch:'original-period'};
const risk=(extra={})=>({id:'risk-1',rootCauseId:'quote:600000',category:'data',object:{type:'stock',id:'600000'},
 severity:'warning',evidenceStatus:'missing',executionStatus:'blocked',status:'active',sourceAt:at,source:'original-quote-gate',
 facts:['原报价缺失'],impact:'当前账户估值待核',restrictions:['保留原限制'],checks:['原报价复核'],releaseConditions:['原证据恢复'],...extra});
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'c-risk-receipt-')),clock={at};
 const factory=()=>createRiskAlertLifecycle({root,clock:()=>clock.at,canWrite:()=>true}),store=factory();
 const observe=(rows=[risk()])=>store.observe({...key,risks:rows});
 const read=()=>store.read(key);
 const reserve=rootCauseId=>store.reserveDelivery({...key,rootCauseId});
 const receipt=(deliveryId,status,evidence,extra={})=>store.recordReceipt({...key,deliveryId,status,evidence,...extra});
 const advance=ms=>{clock.at+=ms;};
 const evidence=(receiptId='receiver-1',extra={})=>({receiptId,source:'isolated-receiver',receivedAt:clock.at,trustedReceiver:true,...extra});
 const filename=()=>path.join(root,fs.readdirSync(root).find(n=>n.endsWith('.json')));
 const rewrite=edit=>{const file=filename(),{fingerprint,...state}=JSON.parse(fs.readFileSync(file,'utf8'));edit(state);
  fs.writeFileSync(file,JSON.stringify({...state,fingerprint:digest(state)})+'\n');};
 return Promise.resolve().then(()=>fn({root,store,factory,observe,read,reserve,receipt,advance,evidence,rewrite,filename,clock}))
  .finally(()=>fs.rmSync(root,{recursive:true,force:true}));
}
test('C18.1 queue acceptance or unsupported receiver flag is not gateway acceptance',()=>{
 for(const input of [{ok:true,status:'queued'},{ok:true,status:'not-queued'},{ok:true,status:'receiver-confirmed'},
  {ok:true,status:'gateway-accepted',gatewayAccepted:false}]){
  const x=normalizeRiskReceipt(input);assert.equal(x.status,'unconfirmed');assert.equal(x.gatewayAccepted,false);assert.equal(x.receiverConfirmed,false);
 }
 assert.equal(normalizeRiskReceipt({ok:true,msg:'ok'}).status,'gateway-accepted');
});
test('C18.2 archive clock rollback cannot display a future receipt or release a reservation',()=>fixture(f=>{
 f.observe();const d=f.reserve('quote:600000');f.advance(2000);f.receipt(d.deliveryId,'gateway-accepted');
 const before=fs.readFileSync(f.filename(),'utf8');f.advance(-1000);
 assert.throws(()=>f.read(),/时钟回退/);assert.throws(()=>f.reserve('quote:600000'),/时钟回退/);
 assert.equal(fs.readFileSync(f.filename(),'utf8'),before);
}));
test('C18.2 resealed impossible receipt times fail closed, original archive is not repaired',()=>fixture(f=>{
 f.observe();const d=f.reserve('quote:600000');f.advance(1000);f.receipt(d.deliveryId,'gateway-accepted');
 f.rewrite(s=>{s.deliveries[0].receipts[0].at=at-1;});
 const before=fs.readFileSync(f.filename(),'utf8');assert.throws(()=>f.read(),/回执时序/);
 assert.throws(()=>f.reserve('quote:600000'),/回执时序/);assert.equal(fs.readFileSync(f.filename(),'utf8'),before);
}));
test('C18.2 one original event cannot have two reservations, even under a recomputed archive fingerprint',()=>fixture(f=>{
 f.observe();f.reserve('quote:600000');
 f.rewrite(s=>{s.deliveries.push({...s.deliveries[0],id:'a'.repeat(64)});});
 assert.throws(()=>f.read(),/投递记录损坏/);
}));
test('C18.3 a provider receiver receipt cannot be replayed for another event in the same account period',()=>fixture(f=>{
 f.observe();const a=f.reserve('quote:600000');
 f.advance(1000);f.observe([risk({severity:'critical'})]);const b=f.reserve('quote:600000');
 f.advance(1000);const e=f.evidence();f.receipt(a.deliveryId,'receiver-confirmed',e);
 const before=f.read().revision;
 assert.throws(()=>f.receipt(b.deliveryId,'receiver-confirmed',e),/其他事件/);
 assert.equal(f.read().revision,before);assert.equal(f.read().groups[0].notification.receiverConfirmed,false);
}));
test('C18.3 duplicate identical receiver evidence is idempotent even if wrapper reason changes',()=>fixture(f=>{
 f.observe();const d=f.reserve('quote:600000');f.advance(1000);const e=f.evidence();
 f.receipt(d.deliveryId,'receiver-confirmed',e,{reason:'original'});
 const before=f.read().revision;f.advance(1000);
 assert.equal(f.receipt(d.deliveryId,'receiver-confirmed',e,{reason:'changed wrapper'}).recorded,false);
 assert.equal(f.read().revision,before);
 assert.throws(()=>f.receipt(d.deliveryId,'receiver-confirmed',{...e,receivedAt:f.clock.at}),/时点冲突/);
}));
test('C18.3 explicitly mismatched account period or delivery identity cannot confirm a receipt',()=>fixture(f=>{
 f.observe();const d=f.reserve('quote:600000');f.advance(1000);
 for(const patch of [{accountId:'pre'},{accountEpoch:'old-period'},{deliveryId:'b'.repeat(64)},{eventId:'c'.repeat(64)}]){
  assert.throws(()=>f.receipt(d.deliveryId,'receiver-confirmed',f.evidence('receiver-1',patch)),/身份冲突/);
 }
 const result=f.receipt(d.deliveryId,'receiver-confirmed',f.evidence('receiver-1',{...key,deliveryId:d.deliveryId,eventId:d.eventId}));
 assert.equal(result.receiverConfirmed,true);
}));
test('C18.4 historical status cannot claim a confirmed delivery with no corresponding receipt',()=>fixture(f=>{
 f.observe();f.reserve('quote:600000');f.rewrite(s=>{s.deliveries[0].status='receiver-confirmed';});
 assert.throws(()=>f.read(),/状态与保留回执/);
}));
test('C18.4 contradictory gateway records stay uncertain; late timeout cannot erase a trusted receiver',()=>fixture(f=>{
 f.observe();const d=f.reserve('quote:600000');
 f.advance(1000);f.receipt(d.deliveryId,'gateway-accepted');
 f.advance(1000);assert.equal(f.receipt(d.deliveryId,'gateway-rejected').status,'unconfirmed');
 assert.equal(f.factory().read(key).groups[0].notification.status,'unconfirmed');
 f.advance(1000);f.receipt(d.deliveryId,'receiver-confirmed',f.evidence());
 f.advance(1000);assert.equal(f.receipt(d.deliveryId,'unconfirmed').status,'receiver-confirmed');
 assert.equal(f.factory().read(key).groups[0].notification.receiverConfirmed,true);
}));
test('C18.5 earlier incident delivery remains visible after escalation, detection and receipt times stay separate',()=>fixture(f=>{
 f.observe();f.advance(100);const a=f.reserve('quote:600000');
 f.advance(200);f.receipt(a.deliveryId,'gateway-accepted');
 f.advance(300);f.observe([risk({severity:'critical'})]);const b=f.reserve('quote:600000');
 f.advance(500);f.receipt(a.deliveryId,'receiver-confirmed',f.evidence('original-late',{receivedAt:at+400}));
 const g=f.factory().read(key).groups[0],r=g.notificationReview.rows;
 assert.equal(r.length,2);assert.equal(r[0].eventRecordedAt,at);assert.equal(r[0].reservedAt,at+100);
 assert.equal(r[0].gatewayAcceptedReceiptAt,at+300);assert.equal(r[0].receiverReceivedAt,at+400);
 assert.equal(r[0].receiverReceiptRecordedAt,at+1100);assert.equal(r[0].receiverObservationDelayMs,400);
 assert.equal(r[1].deliveryId,b.deliveryId);assert.equal(r[1].receiverReceivedAt,null);
 assert.equal(r[1].actualUserActionAt,null);assert.equal(r[1].actualAvoidedLoss,null);
 assert.equal(g.notificationReview.actualWarningEffectCertified,false);assert.equal(g.notification.status,'queued');
}));
test('C18.5 a station view is not receiver confirmation, and conflicting gateway times stay unknown',()=>fixture(f=>{
 f.observe();const d=f.reserve('quote:600000');f.advance(1000);f.receipt(d.deliveryId,'gateway-accepted');f.advance(1000);f.receipt(d.deliveryId,'gateway-rejected');
 const v=f.store.markViewed({...key,rootCauseId:'quote:600000',actor:'editor',expectedRevision:f.read().revision});
 const g=v.groups[0],r=g.notificationReview.rows[0];
 assert.equal(g.viewed,true);assert.equal(r.conflictingGatewayReceipts,true);assert.equal(r.gatewayAcceptedReceiptAt,null);
 assert.equal(r.receiverReceivedAt,null);assert.equal(r.actualUserActionAt,null);assert.equal(r.actualExecutableExitAt,null);
}));
test('C18.5 review retains all original events but limits the additional projection to sixteen rows',()=>fixture(f=>{
 f.observe();
 for(let i=0;i<10;i++){
  f.advance(1000);f.observe([risk({status:'resolved',evidenceStatus:'available',sourceAt:f.clock.at})]);
  f.advance(1000);f.observe([risk({sourceAt:f.clock.at})]);
 }
 const g=f.read().groups[0],v=g.notificationReview;
 assert.equal(g.events.length,21);assert.equal(v.totalEvents,21);assert.equal(v.shownEvents,16);assert.equal(v.omittedEvents,5);
 assert.equal(v.rows[0].eventId,g.events[5].id);assert.equal(v.rows.at(-1).eventId,g.events.at(-1).id);
 assert.ok(v.rows.every(r=>r.actualAvoidedLoss===null));
}));
