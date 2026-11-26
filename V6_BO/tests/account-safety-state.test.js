'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {reconcileAccountSnapshot,defensiveStatus}=require('../src/core/account-safety-state');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-account-safety-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'pool.json');let now=Date.parse('2026-11-05T02:00:00Z');
 const make=()=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}}),app=make();app.initialize(100000);
 const day=()=>new Date(now+8*3600000).toISOString().slice(0,10);
 const order=(id='buy',extra={})=>({orderId:id,symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:day(),...extra});
 const quote=()=>({symbol:'600000',price:10,timestamp:now,tradeDate:day(),source:'simulated',suspended:false,tradable:true,volumeUnit:'shares',volume:1000000,upperLimit:11,lowerLimit:9});
 const change=fn=>{const s=app.read();fn(s);s.account.fingerprint=hash({cash:s.account.cash,positions:s.account.positions,events:s.account.events});delete s.fingerprint;s.fingerprint=hash(s);fs.writeFileSync(file,JSON.stringify(s));};
 return {root,file,app,make,order,quote,change,day,now:()=>now,advance:()=>{now+=86400000;}};
}
test('new original snapshots reconcile opening, fills, reservations and quantity flow without claiming external reconciliation',t=>{
 const x=fixture(t);x.app.submit(x.order());x.app.fill('buy','fill',x.quote());const before=fs.readFileSync(x.file);
 const r=x.app.reconcile();assert.equal(r.status,'consistent');assert.equal(r.quantityFlowVerified,true);assert.equal(r.completeExternalReconciliation,false);assert.equal(r.newExposureAllowed,true);
 assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(x.make().read().account.cash,98995);
});
for(const [label,mutate,pattern] of [
 ['detached retry index',s=>{s.account.eventHashes.fill='0'.repeat(64);},/FILL_IDEMPOTENCY|事件指纹/],
 ['orphan retry index',s=>{s.account.eventHashes.orphan='0'.repeat(64);},/幂等/],
 ['lot quantity drift',s=>{s.account.positions['600000'].lots[0].quantity=200;},/LOT_QUANTITY/],
 ['balanced lot and position drift',s=>{s.account.positions['600000'].lots[0].quantity=200;s.account.positions['600000'].quantity=200;},/POSITION_QUANTITY_FLOW/],
 ['unknown lot source',s=>{s.account.positions['600000'].lots[0].sourceEventId='missing';},/ORPHAN_PURCHASE_LOT/]
])test('original read and mutation reject '+label+' even with recomputed outer fingerprints',t=>{
 const x=fixture(t);x.app.submit(x.order());x.app.fill('buy','fill',x.quote());x.change(mutate);const before=fs.readFileSync(x.file);
 assert.throws(()=>x.app.read(),pattern);assert.throws(()=>x.app.submit(x.order('another')));assert.deepEqual(fs.readFileSync(x.file),before);
});
test('legacy snapshot without separately sealed opening remains compatible and reports the historical gap',t=>{
 const x=fixture(t);x.app.submit(x.order());x.app.fill('buy','fill',x.quote());x.change(s=>{delete s.reconciliationOpening;});
 const report=x.app.reconcile();assert.equal(report.internallyConsistent,true);assert.equal(report.quantityFlowVerified,false);assert.ok(report.missing.some(x=>x.includes('期初')));
 x.app.submit(x.order('second'));assert.ok(x.app.read().orders.second);
});
test('defensive restriction survives restart, blocks existing buy fills, and permits cancellation with CAS-approved release',t=>{
 const x=fixture(t);x.app.submit(x.order());const cash=x.app.read().account.cash;
 x.app.setDefensiveControl({expectedRevision:x.app.read().revision,state:'restricted',reason:'人工核对风险'});
 assert.equal(defensiveStatus(x.make().read()).state,'restricted');assert.throws(()=>x.app.fill('buy','blocked',x.quote()),/防御状态/);
 assert.equal(x.app.read().account.cash,cash);assert.equal(x.app.read().account.events.length,0);
 assert.throws(()=>x.app.setDefensiveControl({expectedRevision:1,state:'open',reason:'核对完成',acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'}),/版本冲突/);
 assert.throws(()=>x.app.setDefensiveControl({expectedRevision:x.app.read().revision,state:'open',reason:'核对完成'}),/明确审批/);
 assert.throws(()=>x.app.setDefensiveControl({expectedRevision:x.app.read().revision,state:'open',reason:'核对完成',acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'}),/撤销/);
 x.app.cancel('buy','cancel');x.app.setDefensiveControl({expectedRevision:x.app.read().revision,state:'open',reason:'已撤销并核对原账本',acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'});
 assert.equal(x.app.reconcile().defensive.state,'open');x.app.submit(x.order('next'));assert.ok(x.app.read().orders.next);
});
test('defensive mode retains original T+1 and allows a mature risk-reducing sale',t=>{
 const x=fixture(t);x.app.submit(x.order());x.app.fill('buy','b1',x.quote());
 x.app.setDefensiveControl({expectedRevision:x.app.read().revision,state:'restricted',reason:'控制新增敞口'});
 assert.throws(()=>x.app.submit(x.order('sell',{side:'sell'})),/T\+1/);
 x.advance();x.app.submit(x.order('sell',{side:'sell'}));x.app.fill('sell','s1',x.quote());
 assert.equal(x.app.read().account.positions['600000'].quantity,0);assert.equal(x.app.reconcile().defensive.state,'restricted');
});
test('original loss gate latches defense and release cannot bypass loss evidence or later original entry caps',t=>{
 const x=fixture(t);x.app.configure({expectedRevision:1,riskPolicy:{version:'loss',maxDailyLossPausePct:5}});
 const previousClose={observedThrough:'2026-11-04',priorEquity:90000,priorPeak:100000,previousEquity:100000};
 assert.throws(()=>x.app.submit(x.order(),{riskContext:{observedAt:x.now(),previousClose}}),/PREVIOUS_CLOSE_LOSS_LIMIT/);
 assert.equal(x.app.reconcile().defensive.state,'restricted');assert.equal(x.app.read().account.events.length,0);assert.equal(x.app.audit().total,1);
 assert.throws(()=>x.app.setDefensiveControl({expectedRevision:x.app.read().revision,state:'open',reason:'已检查',acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'}),/已导入/);
 x.app.configure({expectedRevision:x.app.read().revision,riskPolicy:{version:'cap',maxPositionPct:1}});
 assert.equal(x.app.reconcile().defensive.state,'restricted');
 x.app.setDefensiveControl({expectedRevision:x.app.read().revision,state:'open',reason:'已按原配置恢复并核对',acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'});
 assert.throws(()=>x.app.submit(x.order('large',{quantity:200}),{riskContext:{observedAt:x.now(),marks:{}}}),/SINGLE_POSITION_LIMIT/);
});
test('read-only service creates no directories, writes no rejection audit and rejects every mutation',t=>{
 const x=fixture(t),file=path.join(x.root,'missing','a.json');const app=createPaperApplicationService({file,readOnly:true});
 assert.throws(()=>app.read());assert.throws(()=>app.initialize(100));assert.throws(()=>app.submit(x.order()));assert.equal(fs.existsSync(path.dirname(file)),false);
 const before=fs.readFileSync(x.file),read=createPaperApplicationService({file:x.file,readOnly:true});assert.equal(read.reconcile().status,'consistent');assert.throws(()=>read.cancel('x','c'));
 assert.deepEqual(fs.readFileSync(x.file),before);assert.equal(fs.existsSync(x.file+'.audit.json'),false);
});
test('reservation disagreement restricts new exposure while original cancellation remains available',t=>{
 const x=fixture(t);x.app.submit(x.order('large',{quantity:9000}));
 x.app.configure({expectedRevision:x.app.read().revision,feeSchedules:[{version:'high',effectiveFrom:'2026-11-01',effectiveTo:null,feeBps:100,minFee:20000,sellTaxBps:5}]});
 assert.equal(reconcileAccountSnapshot(x.app.read()).newExposureAllowed,false);
 x.app.cancel('large','cancel');assert.equal(x.app.reconcile().newExposureAllowed,true);
});
