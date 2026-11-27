'use strict';
// C closeout: exercise the original producer and reader in one isolated
// synthetic account. Native node:test uses real private temporary files,
// SHA-256 and the existing account equity/report builders. No external send.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createRiskAlertLifecycle,QUEUE_CONFIRMATION_MS}=require('../src/core/risk-alert-lifecycle');
const {buildAccountEquityEvidence}=require('../src/core/account-equity-evidence');
const {buildRiskWorkbench,filterRiskWorkbench}=require('../src/core/risk-workbench');
const ui=import('../public/nova/risk-workbench-read-scope.mjs');
const BASE=Date.parse('2026-11-27T10:00:00+08:00');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const syntheticBook=(initialCash=100000)=>{
 const account={cash:initialCash,positions:{},events:[]};
 account.fingerprint=hash(account);
 const book={schemaVersion:1,revision:1,initialCash,paperOnly:true,brokerConnected:false,account,orders:{},archives:[]};
 return {...book,fingerprint:hash(book)};
};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'c-closeout-notification-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const book=syntheticBook(),before=JSON.stringify(book),clock={at:BASE},accountId='pool';
 const equity=()=>buildAccountEquityEvidence({book,accountId,now:clock.at});
 const key={accountId,accountEpoch:equity().accountEpoch};
 const factory=()=>createRiskAlertLifecycle({root,clock:()=>clock.at,canWrite:()=>true});
 const store=factory(),risk=(extra={})=>({id:'risk-original-1',rootCauseId:'quote/600000',category:'data',
  object:{type:'security',id:'600000',label:'合成测试证券'},severity:'warning',evidenceStatus:'missing',
  executionStatus:'blocked',status:'active',sourceAt:clock.at,source:'original-quote-gate',
  facts:['原报价缺失'],impact:'当前估值待核对',restrictions:['保留原限制'],
  checks:['重新核验原报价'],releaseConditions:['取得新有效证据'],...extra});
 const read=(instance=store)=>instance.read({...key,actor:'editor-fixture'});
 const report=(alerts=read(),instanceEquity=equity())=>buildRiskWorkbench({accountId,now:clock.at,equity:instanceEquity,alerts});
 const project=async (r=report())=>(await ui).projectRiskNotificationHistory(r);
 const file=()=>path.join(root,fs.readdirSync(root).find(n=>n.endsWith('.json')));
 const disk=()=>fs.readFileSync(file(),'utf8');
 const observe=(rows=[risk()])=>store.observe({...key,risks:rows,complete:true});
 const reserve=(rootCauseId='quote/600000')=>store.reserveDelivery({...key,rootCauseId});
 const receipt=(delivery,status,evidence,extra={})=>store.recordReceipt({...key,deliveryId:delivery.deliveryId,status,evidence,...extra});
 const advance=ms=>{clock.at+=ms;};
 const receiver=(receiptId,extra={})=>({receiptId,source:'synthetic-receiver',trustedReceiver:true,receivedAt:clock.at,...extra});
 const unchanged=()=>assert.equal(JSON.stringify(book),before,'read-only notification chain never changes account input');
 return {root,book,clock,key,factory,store,risk,equity,read,report,project,disk,observe,reserve,receipt,advance,receiver,unchanged};
}
const group=(r,root='quote/600000')=>r.groups.find(g=>g.rootCauseId===root);
const row=(r,i=0)=>group(r).rows[i];
function historical(r){
 assert.equal(r.status,'historical-only');
 assert.equal(r.canTrade,false);assert.equal(r.actualWarningEffectCertified,false);
 for(const g of r.groups)for(const x of g.rows){
  assert.equal(x.actualUserActionAt,null);assert.equal(x.actualExecutableExitAt,null);assert.equal(x.actualAvoidedLoss,null);
 }
}
test('C25 closeout real producer empty and unsent event pass the original report and client reader',async t=>{
 const f=fixture(t),empty=await f.project();historical(empty);assert.equal(empty.totalGroups,0);
 f.observe();const actual=f.report(),p=await f.project(actual);
 historical(p);assert.equal(p.totalGroups,1);assert.equal(row(p).status,'not-queued');
 assert.equal(row(p).eventId,actual.alerts.groups[0].events[0].id);
 assert.equal(row(p).deliveryId,null);assert.equal(actual.readOnly,true);
 assert.equal(actual.canTrade,false);assert.equal(actual.writesAccount,false);f.unchanged();
});
test('C25 closeout queued timeout keeps the reservation and cannot renew or fabricate a delivery',async t=>{
 const f=fixture(t);f.observe();f.advance(100);const delivery=f.reserve();
 const stored=f.disk(),before=await f.project();historical(before);
 assert.equal(row(before).status,'queued');assert.equal(row(before).reservationDelayMs,100);
 f.advance(QUEUE_CONFIRMATION_MS+1);
 const late=await f.project(f.report(f.read(f.factory())));historical(late);
 assert.equal(row(late).status,'unconfirmed');assert.equal(row(late).deliveryId,delivery.deliveryId);
 assert.equal(row(late).firstReceiptRecordedAt,null);assert.equal(f.reserve().reserved,false);
 assert.equal(f.disk(),stored);f.unchanged();
});
test('C25 closeout contradictory gateway receipts and later trusted receiver remain separate original facts',async t=>{
 const f=fixture(t);f.observe();const d=f.reserve();
 f.advance(100);f.receipt(d,'gateway-accepted');
 let p=await f.project();historical(p);assert.equal(row(p).status,'gateway-accepted');
 assert.equal(row(p).gatewayAcceptedReceiptAt,BASE+100);assert.equal(row(p).receiverReceivedAt,null);
 f.advance(100);f.receipt(d,'gateway-rejected');
 p=await f.project();historical(p);assert.equal(row(p).status,'unconfirmed');
 assert.equal(row(p).conflictingGatewayReceipts,true);assert.equal(row(p).gatewayAcceptedReceiptAt,null);
 f.advance(100);const evidence=f.receiver('r-1',{receivedAt:BASE+250});
 f.receipt(d,'receiver-confirmed',evidence);
 p=await f.project();historical(p);assert.equal(row(p).status,'receiver-confirmed');
 assert.equal(row(p).receiverReceivedAt,BASE+250);assert.equal(row(p).receiverReceiptRecordedAt,BASE+300);
 assert.equal(row(p).conflictingGatewayReceipts,true);assert.equal(row(p).gatewayAcceptedReceiptAt,null);
 const revision=f.read().revision;f.advance(100);
 assert.equal(f.receipt(d,'receiver-confirmed',evidence).recorded,false);assert.equal(f.read().revision,revision);
 f.receipt(d,'unconfirmed');p=await f.project(f.report(f.read(f.factory())));historical(p);
 assert.equal(row(p).status,'receiver-confirmed');assert.equal(row(p).receiverReceivedAt,BASE+250);f.unchanged();
});
test('C25 closeout escalation retains old receipt and never marks the new incident received',async t=>{
 const f=fixture(t);f.observe();f.advance(100);const first=f.reserve();
 f.advance(100);f.receipt(first,'gateway-accepted');f.advance(100);
 f.observe([f.risk({severity:'critical'})]);const latest=f.reserve();
 f.advance(200);f.receipt(first,'receiver-confirmed',f.receiver('old',{receivedAt:BASE+250}));
 const r=f.report(f.read(f.factory())),p=await f.project(r);historical(p);
 assert.equal(group(p).totalEvents,2);assert.equal(row(p).deliveryId,first.deliveryId);
 assert.equal(row(p).receiverReceivedAt,BASE+250);assert.equal(row(p,1).deliveryId,latest.deliveryId);
 assert.equal(row(p,1).status,'queued');assert.equal(row(p,1).receiverReceivedAt,null);
 assert.equal(r.alerts.groups[0].notification.status,'queued');f.unchanged();
});
test('C25 closeout station view is not receiver confirmation or actual user trading action',async t=>{
 const f=fixture(t);f.observe();const d=f.reserve();f.advance(200);f.receipt(d,'gateway-accepted');
 const viewed=f.store.markViewed({...f.key,rootCauseId:'quote/600000',actor:'editor-fixture',expectedRevision:f.read().revision});
 assert.equal(viewed.groups[0].viewed,true);
 const p=await f.project(f.report(viewed));historical(p);
 assert.equal(row(p).status,'gateway-accepted');assert.equal(row(p).receiverReceivedAt,null);
 assert.equal(viewed.groups[0].restrictionsStillApply,true);f.unchanged();
});
test('C25 closeout same source receipt cannot be reused across original incidents',async t=>{
 const f=fixture(t);
 f.observe([f.risk(),f.risk({id:'risk-original-2',rootCauseId:'quote/600001',object:{type:'security',id:'600001'},severity:'critical'})]);
 const a=f.reserve(),b=f.reserve('quote/600001');f.advance(200);
 const ev=f.receiver('unique');f.receipt(a,'receiver-confirmed',ev);
 const before=f.disk();assert.throws(()=>f.receipt(b,'receiver-confirmed',ev),/其他事件/);
 assert.equal(f.disk(),before);
 const p=await f.project();historical(p);assert.equal(group(p,'quote/600000').rows[0].status,'receiver-confirmed');
 assert.equal(group(p,'quote/600001').rows[0].status,'queued');f.unchanged();
});
test('C25 closeout full-account projection requires same epoch and never enters the selected-stock history',async t=>{
 const f=fixture(t);f.observe();const r=f.report(),p=await f.project(r);historical(p);
 const {projectRiskNotificationHistory}=await ui;
 const narrowed=filterRiskWorkbench(r,'600000');
 assert.equal(projectRiskNotificationHistory(narrowed).status,'unknown');
 const mismatched=JSON.parse(JSON.stringify(r));mismatched.alerts.accountId='pre';
 assert.equal(projectRiskNotificationHistory(mismatched).status,'unknown');
 assert.throws(()=>f.report(mismatched.alerts),/原账户不一致/);
 const newEquity=buildAccountEquityEvidence({book:syntheticBook(200000),accountId:'pool',now:f.clock.at});
 assert.throws(()=>f.report(r.alerts,newEquity),/原账户期间不一致/);
 const newArchive=f.store.read({accountId:'pool',accountEpoch:newEquity.accountEpoch});
 const fresh=f.report(newArchive,newEquity),z=projectRiskNotificationHistory(fresh);
 historical(z);assert.equal(z.totalGroups,0);assert.equal(r.alerts.groups.length,1);f.unchanged();
});
test('C25 closeout rollback and corrupted projections do not become a verified empty history',async t=>{
 const f=fixture(t);f.observe();f.advance(100);const d=f.reserve();f.advance(100);f.receipt(d,'gateway-accepted');
 const good=f.report(),before=f.disk(),bad=JSON.parse(JSON.stringify(good));
 bad.alerts.groups[0].notificationReview.rows[0].actualAvoidedLoss=1;
 const p=await f.project(bad);assert.equal(p.status,'partial');assert.equal(group(p).status,'unknown');
 f.advance(-1);assert.throws(()=>f.read(),/时钟回退/);assert.equal(f.disk(),before);
 const noArchive=await f.project(f.report(null));
 assert.equal(noArchive.status,'unknown');assert.equal(noArchive.totalGroups,null);f.unchanged();
});
test('C25 closeout bounded recent event history keeps omitted count and all original archived events',async t=>{
 const f=fixture(t);f.observe();
 for(let i=0;i<10;i++){
  f.advance(1000);f.observe([f.risk({status:'resolved',evidenceStatus:'available'})]);
  f.advance(1000);f.observe();
 }
 const r=f.report(f.read(f.factory())),p=await f.project(r);historical(p);
 assert.equal(r.alerts.groups[0].events.length,21);assert.equal(group(p).totalEvents,21);
 assert.equal(group(p).shownEvents,16);assert.equal(group(p).omittedEvents,5);
 assert.equal(row(p).eventId,r.alerts.groups[0].events[5].id);
 assert.equal(group(p).rows.at(-1).eventId,r.alerts.groups[0].events.at(-1).id);f.unchanged();
});
