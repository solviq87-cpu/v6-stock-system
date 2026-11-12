'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const root=process.env.V6_FIELD_PROVENANCE_TEST_ROOT||path.resolve(__dirname,'..');
const {createPaperApplicationService}=require(path.join(root,'src/core/paper-application-service'));
const source=fs.readFileSync(path.join(root,'server.js'),'utf8'),now=Date.parse('2026-11-06T02:00:00Z'),old=now-86400000;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function quote(stockPatch={},cached=true){
 const stock={code:'600000',name:'fixture',price:8,preClose:10,volume:100,quoteSource:'old-stock-list',quoteAt:old,receivedAt:old+500,...stockPatch};
 const tick={p:10,t:now,quoteSource:'fresh-price-cache',quoteAt:now-1000,receivedAt:now-500,mode:'public-live-unverified'};
 const context={S:{stocks:[stock],stocksAt:now,lastPx:new Map(cached?[['600000',tick]]:[])},Date:{now:()=>now},require:require('node:module').createRequire(path.join(root,'server.js'))};
 vm.createContext(context);
 const begin=source.indexOf('function paperAuthorityQuotes()'),end=source.indexOf('refreshPaperAuthority();',begin);
 const limitBegin=source.indexOf('function limitPctOfCode('),limitEnd=source.indexOf('// ⛔ 2026-10-28 修（用户「读代码找别的问题」复查）',limitBegin);
 vm.runInContext(source.slice(limitBegin,limitEnd),context);vm.runInContext(source.slice(begin,end),context);
 return {q:context.paperAuthorityQuotes()['600000'],stock,tick};
}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-fields-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'pool.json'),make=()=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:d=>d==='2026-11-06'},maxParticipationPct:1});
 const app=make();app.adoptLegacy({initial:100000,cash:100000,realized:0,enabled:true,positions:{},trades:[]});
 const trade={t:now,side:'买入',code:'600000',price:10,shares:100,amount:1000,fee:5,pnl:null,reason:'mixed field fixture'};
 const input={...app.legacy(),cash:98995,positions:{'600000':{code:'600000',shares:100,buyTs:now,buyPrice:10,basis:1005}},trades:[trade]};
 return {app,make,file,input,trade,save:q=>app.saveLegacy(input,app.read().revision,{quotes:{'600000':q}})};
}
function rewrite(file,book){book.account.fingerprint=hash({cash:book.account.cash,positions:book.account.positions,events:book.account.events});delete book.fingerprint;book.fingerprint=hash(book);fs.writeFileSync(file,JSON.stringify(book));}
test('actual authority to saveLegacy preserves fresh cache price separately from old stock-row volume, limits and missing status',t=>{
 const {q}=quote(),x=fixture(t),book=x.save(q),event=book.account.events[0],meta=event.fillEvidence.inputProvenance;
 assert.equal(q.price,10);assert.equal(q.quoteAt,now-1000);assert.equal(meta.price.origin,'S.lastPx');assert.equal(meta.price.quoteAt,q.quoteAt);
 assert.equal(meta.price.receivedAt,now-500);assert.equal(meta.price.source,'fresh-price-cache');
 assert.equal(meta.volume.rawValue,100);assert.equal(meta.volume.value,10000);assert.equal(meta.volume.source,'old-stock-list');
 assert.equal(meta.volume.quoteAt,null);assert.equal(meta.volume.receivedAt,null);assert.equal(meta.volume.rowQuoteAt,old);assert.equal(meta.volume.rowReceivedAt,old+500);
 assert.equal(meta.volume.timeScope,'row-metadata-only');assert.equal(meta.limits.preClose.value,10);assert.equal(meta.limits.preClose.rowQuoteAt,old);
 assert.equal(meta.limits.rule.limitPct,.1);assert.equal(meta.limits.upperLimit,11);assert.equal(meta.limits.lowerLimit,9);
 assert.equal(meta.status.suspended.rawBoolean,null);assert.equal(meta.status.suspended.present,false);assert.equal(meta.status.suspended.defaulted,true);assert.equal(meta.status.suspended.value,false);
 assert.equal(meta.status.tradable.rawBoolean,null);assert.equal(meta.status.tradable.value,true);assert.equal(meta.status.tradable.quoteAt,null);
 assert.equal(book.account.cash,98995);assert.equal(book.account.positions['600000'].quantity,100);assert.equal(event.fillEvidence.canTrade,false);assert.equal(book.brokerConnected,false);
 assert.deepEqual(x.make().read().account.events[0].fillEvidence.inputProvenance,meta);
 q.inputProvenance.volume.rowQuoteAt=now;assert.equal(x.make().read().account.events[0].fillEvidence.inputProvenance.volume.rowQuoteAt,old);
});
test('unknown stock-row clocks and imported row mode stay unknown instead of borrowing price or list receipt time',t=>{
 const {q}=quote({quoteAt:undefined,receivedAt:undefined,quoteSource:undefined,mode:'imported',suspended:0,tradable:'false'}),x=fixture(t);
 const meta=x.save(q).account.events[0].fillEvidence.inputProvenance;
 assert.equal(meta.price.quoteAt,now-1000);assert.equal(meta.price.receivedAt,now-500);
 for(const row of [meta.volume,meta.limits.preClose,meta.status.suspended,meta.status.tradable]){
  assert.equal(row.source,null);assert.equal(row.mode,'imported');assert.equal(row.quoteAt,null);assert.equal(row.receivedAt,null);
  assert.equal(row.rowQuoteAt,null);assert.equal(row.rowReceivedAt,null);
 }
 assert.equal(meta.status.suspended.rawType,'number');assert.equal(meta.status.suspended.defaulted,true);assert.equal(meta.status.suspended.value,false);
 assert.equal(meta.status.tradable.rawType,'string');assert.equal(meta.status.tradable.defaulted,true);assert.equal(meta.status.tradable.value,true);
});
test('full-stock price fallback records its own row and explicit status without authenticating other fields at the price clock',t=>{
 const {q}=quote({name:'*STfixture',preClose:'10',price:10,quoteAt:now-1000,receivedAt:now-500,suspended:false,tradable:true},false),x=fixture(t);
 const meta=x.save(q).account.events[0].fillEvidence.inputProvenance;
 assert.equal(meta.price.origin,'S.stocks');assert.equal(meta.price.source,'old-stock-list');assert.equal(meta.price.quoteAt,now-1000);
 assert.equal(meta.volume.quoteAt,null);assert.equal(meta.volume.rowQuoteAt,now-1000);
 assert.equal(meta.status.suspended.rawBoolean,false);assert.equal(meta.status.suspended.present,true);assert.equal(meta.status.suspended.defaulted,false);
 assert.equal(meta.status.tradable.rawBoolean,true);assert.equal(meta.status.tradable.defaulted,false);
 assert.equal(meta.limits.rule.name,'*STfixture');assert.equal(meta.limits.rule.limitPct,.05);assert.equal(q.upperLimit,10.5);assert.equal(q.lowerLimit,9.5);
 assert.equal(meta.limits.preClose.rawValue,'10');assert.equal(meta.limits.preClose.value,10);
});
test('participation still consumes the stock-row volume and source/status evidence does not change existing acceptance thresholds',t=>{
 const accepted=quote().q,rejected=quote({volume:1}).q;
 assert.equal(accepted.price,rejected.price);assert.equal(accepted.quoteAt,rejected.quoteAt);
 assert.equal(accepted.inputProvenance.volume.value,10000);assert.equal(rejected.inputProvenance.volume.value,100);
 const first=fixture(t);assert.equal(first.save(accepted).account.cash,98995);
 const second=fixture(t),before=fs.readFileSync(second.file);assert.throws(()=>second.save(rejected),/量参与率/);assert.deepEqual(fs.readFileSync(second.file),before);
});
test('new nested field metadata participates in fingerprints, schema checks and order-account cross checks',t=>{
 const x=fixture(t),book=x.save(quote().q),original=JSON.stringify(book),a=book.account.events[0],id=a.orderId;
 a.fillEvidence.inputProvenance.volume.rowQuoteAt=now;rewrite(x.file,book);assert.throws(()=>x.make().read(),/证据/);
 const mismatch=JSON.parse(original),changed=mismatch.account.events[0].fillEvidence;
 changed.inputProvenance.volume.rowQuoteAt=old+1;delete changed.fingerprint;changed.fingerprint=hash(changed);
 rewrite(x.file,mismatch);assert.throws(()=>x.make().read(),/订单与资金成交报价证据不一致/);
 const forged=JSON.parse(original),proof=forged.account.events[0].fillEvidence;
 proof.inputProvenance.volume.quoteAt=now-1000;delete proof.fingerprint;proof.fingerprint=hash(proof);
 forged.orders[id].events[0].fillEvidence=JSON.parse(JSON.stringify(proof));
 forged.account.eventHashes[a.eventId]=hash({orderId:id,fill:forged.orders[id].events[0],tradeDate:'2026-11-06'});
 rewrite(x.file,forged);assert.throws(()=>x.make().read(),/来源/,'row price time cannot be laundered into a field-specific clock even with recomputed hashes');
});
test('unbounded, unknown-version and conflicting field metadata fail atomically',t=>{
 for(const patch of [meta=>{meta.schemaVersion=2;},meta=>{meta.extra='x'.repeat(9000);},meta=>{meta.price.value=10.1;},meta=>{meta.status.tradable.value=false;}]){
  const x=fixture(t),q=quote().q,before=fs.readFileSync(x.file);patch(q.inputProvenance);
  assert.throws(()=>x.save(q),/来源/);assert.deepEqual(fs.readFileSync(x.file),before);
 }
});
test('old fill evidence without per-field metadata retains original hashes and manual request retry semantics',t=>{
 const x=fixture(t),order={orderId:'manual-old',symbol:'600000',side:'buy',quantity:100,limitPrice:11,tradeDate:'2026-11-06'};
 const q={symbol:'600000',tradeDate:'2026-11-06',timestamp:now-1000,source:'simulated',quoteSource:'research-input',suspended:false,tradable:true,volumeUnit:'shares',volume:10000,price:10,lowerLimit:9,upperLimit:11};
 x.app.submit(order);const book=x.app.fill(order.orderId,'old-field-format',q),event=book.orders[order.orderId].events[0];
 for(const e of [event,book.account.events[0]]){delete e.fillEvidence.inputProvenance;delete e.fillEvidence.fingerprint;e.fillEvidence.fingerprint=hash(e.fillEvidence);}
 book.account.eventHashes[event.eventId]=hash({orderId:order.orderId,fill:event,tradeDate:event.date});rewrite(x.file,book);
 const before=fs.readFileSync(x.file),r=x.make().read();assert.equal(r.account.events[0].fillEvidence.inputProvenance,undefined);
 assert.equal(x.make().fill(order.orderId,event.eventId,q).revision,r.revision);assert.deepEqual(fs.readFileSync(x.file),before);
});
