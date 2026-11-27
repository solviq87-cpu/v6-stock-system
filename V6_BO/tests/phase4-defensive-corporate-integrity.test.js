'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {reconcileAccountSnapshot:reconcile,assertAccountReconciliation,defensiveStatus,appendDefensiveEvent:append}=require('../src/core/account-safety-state');
const day='2026-11-27';
const book=()=>({revision:1,initialCash:100,account:{cash:100,positions:{},events:[],eventHashes:{}},orders:{}});
const restrict=b=>append(b,{state:'restricted',reason:'风险核对',at:100,reasonCodes:['MANUAL_DEFENSIVE_RESTRICTION'],approved:false});
const release=(b,at=200,approved=true)=>append(b,{state:'open',reason:'复核解除',at,reasonCodes:['APPROVED_DEFENSIVE_RELEASE'],approved});
const seal=payload=>({...payload,hash:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')});
function persistedRelease(b,at,approved){const last=b.defensiveControl.events.at(-1);const row=seal({state:'open',reason:'复核解除',reasonCodes:['APPROVED_DEFENSIVE_RELEASE'],at,actor:'authorized-editor',approved,accountRevision:b.revision,previousHash:last.hash});b.defensiveControl={version:1,state:'open',events:[...b.defensiveControl.events,row]};return b;}
function mismatch(b,code){const before=JSON.stringify(b),r=reconcile(b);assert.equal(r.status,'mismatch');assert.equal(r.internallyConsistent,false);assert.equal(r.newExposureAllowed,false);assert.ok(r.reasonCodes.includes(code),JSON.stringify(r));assert.throws(()=>assertAccountReconciliation(b),new RegExp(code));assert.equal(JSON.stringify(b),before);}
function corporate(eventId='corp-1'){return {eventId,symbol:'600000',shareDelta:0,cashDelta:0,effectiveDate:day};}
test('an absent legacy defensive control remains open but explicit malformed values never release defense',()=>{
 assert.equal(defensiveStatus(book()).state,'open');
 for(const value of [null,false,0,'',undefined,[],{}]){const b=book();b.defensiveControl=value;assert.throws(()=>defensiveStatus(b),/防御状态/);}
});
test('inherited defensive control is not a persisted approval record',()=>{
 const b=book();const inherited=book();restrict(inherited);Object.setPrototypeOf(b,{defensiveControl:inherited.defensiveControl});assert.throws(()=>defensiveStatus(b),/防御状态/);
});
test('a valid hash chain cannot be created by an unapproved defensive release',()=>{
 const b=book();restrict(b);const before=JSON.stringify(b);assert.throws(()=>release(b,200,false),/审批/);assert.equal(JSON.stringify(b),before);assert.equal(defensiveStatus(b).state,'restricted');
});
test('a persisted correctly hashed open event without explicit approval is rejected',()=>{
 const b=book();restrict(b);persistedRelease(b,200,false);assert.throws(()=>defensiveStatus(b),/审批|审计链/);
});
test('clock rollback cannot append a release or rewrite the existing defense',()=>{
 const b=book();restrict(b);const before=JSON.stringify(b);assert.throws(()=>release(b,99,true),/时间|时钟/);assert.equal(JSON.stringify(b),before);
});
test('persisted valid hashes cannot certify a regressed or invalid defense timestamp',()=>{
 for(const at of [99,0,null,100.5,'200']){const b=book();restrict(b);persistedRelease(b,at,true);assert.throws(()=>defensiveStatus(b),/时间|时钟|审计链/);}
});
test('legacy and legitimate restricted and approved open records remain valid including equal timestamps',()=>{
 for(const at of [100,200]){const b=book();restrict(b);assert.equal(defensiveStatus(b).state,'restricted');release(b,at,true);assert.equal(defensiveStatus(b).state,'open');const restored=JSON.parse(JSON.stringify(b));assert.equal(defensiveStatus(restored).state,'open');assert.equal(restored.defensiveControl.events.length,2);}
});
test('malformed corporate collections report a structured mismatch rather than throwing or vanishing',()=>{
 for(const rows of [null,{},false,'',1]){const b=book();b.corporateEvents=rows;mismatch(b,'INVALID_CORPORATE_EVENT');}
});
test('corporate event identity must be explicit, nonblank, valid and unique',()=>{
 for(const id of [undefined,null,0,'',' bad','bad space',{},'x'.repeat(101)]){const b=book();b.corporateEvents=[{...corporate(),eventId:id}];mismatch(b,'INVALID_CORPORATE_EVENT');}
 const b=book();b.corporateEvents=[corporate(),corporate()];mismatch(b,'INVALID_CORPORATE_EVENT');
});
test('valid corporate events and absent legacy corporate history remain compatible',()=>{
 for(const rows of [undefined,[],[corporate()]]){const b=book();if(rows!==undefined)b.corporateEvents=rows;assert.equal(reconcile(b).status,'consistent');}
});
test('nonrecord holding maps cannot masquerade as empty positions',()=>{
 for(const positions of [new Date(0),new Map(),new Set(),Object.create({fake:1})]){const b=book();b.account.positions=positions;mismatch(b,'INVALID_ACCOUNT_STRUCTURE');}
 const b=book();b.account.positions=Object.create(null);assert.equal(reconcile(b).status,'consistent');
});
test('terminal order identity is validated even without active reservations',()=>{
 for(const symbol of [undefined,null,[],['600000'],{},'bad']){const b=book();b.orders.a={order:{orderId:'a',side:'buy',symbol},state:{terminal:true,remainingQuantity:0},events:[]};mismatch(b,'INVALID_ORDER_IDENTITY');}
 for(const symbol of ['600000',600000,'000001']){const b=book();b.orders.a={order:{orderId:'a',side:'buy',symbol},state:{terminal:true,remainingQuantity:0},events:[]};assert.equal(reconcile(b).status,'consistent');}
});
