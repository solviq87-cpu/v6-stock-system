'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDecisionFinancialCache}=require('../src/server/decision-financial-cache');
const A='600000',B='600001',C='600002',D='600003',E='600004';
const INITIAL=Date.parse('2026-11-25T10:00:00+08:00');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,timeout=5000){
 const deadline=Date.now()+timeout;
 while(!predicate()){if(Date.now()>=deadline)assert.fail('bounded asynchronous check did not finish');await delay(5);}
}
function data(code,at,value=12){
 return {symbol:code,source:'eastmoney-financials',datasets:{period:{receivedAt:at-1,
  rawHash:'a'.repeat(64),records:[{reportDate:'2026-09-30',values:{ROEJQ:value}}]}}};
}
function result(codes,at,value=12){
 return {byCode:Object.fromEntries(codes.map(code=>[code,data(code,at,value)])),missingByCode:{},checkedAt:at};
}
function held(){
 const calls=[];let running=0,maxRunning=0;
 const readAsync=(codes,options)=>{
  running++;maxRunning=Math.max(maxRunning,running);
  return new Promise((resolve,reject)=>calls.push({codes,options,resolve,reject})).finally(()=>running--);
 };
 return {calls,readAsync,maxRunning:()=>maxRunning};
}

test('page reads return immediately, coalesce codes and expose only completed independent evidence',async t=>{
 const h=held(),cache=createDecisionFinancialCache({clock:()=>INITIAL,readAsync:h.readAsync});t.after(()=>cache.close());
 const first=cache.read([A,A,'bad',B]);
 assert.deepEqual(first.byCode,{});assert.equal(first.missingByCode[A],'原始财报证据正在校验');
 assert.equal(Object.keys(first.missingByCode).length,2);assert.equal(h.calls.length,0,'no reader runs in the request stack');
 cache.read([B,A]);await until(()=>h.calls.length===1);assert.deepEqual(h.calls[0].codes,[A,B]);
 const checked={byCode:{[A]:data(A,INITIAL)},missingByCode:{[B]:'缺少已封存的单季财报回执'}};
 h.calls[0].resolve(checked);
 await until(()=>cache.read([A]).byCode[A]);
 const ready=cache.read([A,B]);assert.equal(ready.byCode[A].datasets.period.receivedAt,INITIAL-1);
 assert.equal(ready.missingByCode[B],checked.missingByCode[B]);assert.equal(ready.canTrade,false);assert.equal(ready.canNotify,false);
 ready.byCode[A].datasets.period.records[0].values.ROEJQ=999;
 checked.byCode[A].datasets.period.records[0].values.ROEJQ=777;
 assert.equal(cache.read([A]).byCode[A].datasets.period.records[0].values.ROEJQ,12,'responses cannot mutate the retained projection');
 assert.equal(h.calls.length,1);assert.equal(h.maxRunning(),1);
});

test('new codes queue during an active flight and bounded batches remain strictly serial',async t=>{
 const h=held(),cache=createDecisionFinancialCache({clock:()=>INITIAL,readAsync:h.readAsync,batchSize:2});t.after(()=>cache.close());
 cache.read([A,B]);await until(()=>h.calls.length===1);
 cache.read([C,D,E]);cache.read([C,E]);await delay(10);assert.equal(h.calls.length,1);
 h.calls[0].resolve(result([A,B],INITIAL));await until(()=>h.calls.length===2);
 assert.deepEqual(h.calls[1].codes,[C,D]);h.calls[1].resolve(result([C,D],INITIAL));
 await until(()=>h.calls.length===3);assert.deepEqual(h.calls[2].codes,[E]);
 h.calls[2].resolve(result([E],INITIAL));await until(()=>cache.read([E]).byCode[E]);
 assert.equal(Object.keys(cache.read([A,B,C,D,E]).byCode).length,5);assert.equal(h.maxRunning(),1);
});

test('expired projections disappear until revalidated and do not acquire a fresh source clock',async t=>{
 let now=INITIAL;const h=held(),cache=createDecisionFinancialCache({clock:()=>now,ttlMs:100,readAsync:h.readAsync});t.after(()=>cache.close());
 cache.read([A]);await until(()=>h.calls.length===1);h.calls[0].resolve(result([A],now));
 await until(()=>cache.read([A]).byCode[A]);now+=99;
 assert.equal(cache.read([A]).byCode[A].datasets.period.receivedAt,INITIAL-1);assert.equal(h.calls.length,1);
 now++;const expired=cache.read([A]);assert.deepEqual(expired.byCode,{});assert.equal(expired.missingByCode[A],'原始财报证据正在校验');
 await until(()=>h.calls.length===2);h.calls[1].resolve(result([A],now,13));
 await until(()=>cache.read([A]).byCode[A]);
 const value=cache.read([A]);assert.equal(value.byCode[A].datasets.period.records[0].values.ROEJQ,13);
 assert.equal(value.validationByCode[A].asOf,now);assert.equal(value.byCode[A].datasets.period.receivedAt,now-1);
});

test('invalidation during a flight discards that generation and queues its replacement once',async t=>{
 let now=INITIAL;const h=held(),cache=createDecisionFinancialCache({clock:()=>now,readAsync:h.readAsync});t.after(()=>cache.close());
 cache.read([A]);await until(()=>h.calls.length===1);now+=10;
 assert.equal(cache.invalidate(A),true);cache.invalidate(A);assert.equal(cache.invalidate(B),false);
 h.calls[0].resolve(result([A],INITIAL,99));await until(()=>h.calls.length===2);
 assert.deepEqual(cache.read([A]).byCode,{});assert.equal(h.calls[1].options.now,now);
 h.calls[1].resolve(result([A],now,14));await until(()=>cache.read([A]).byCode[A]);
 assert.equal(cache.read([A]).byCode[A].datasets.period.records[0].values.ROEJQ,14);
 assert.equal(h.calls.length,2);assert.equal(h.maxRunning(),1);
});

test('clock rollback cannot reuse a later verification or a later pending response',async t=>{
 let now=INITIAL;const h=held(),cache=createDecisionFinancialCache({clock:()=>now,readAsync:h.readAsync});t.after(()=>cache.close());
 cache.read([A]);await until(()=>h.calls.length===1);now-=100;
 cache.read([A]);h.calls[0].resolve(result([A],INITIAL,99));await until(()=>h.calls.length===2);
 assert.equal(h.calls[1].options.now,now);assert.deepEqual(cache.read([A]).byCode,{});
 h.calls[1].resolve(result([A],now));await until(()=>cache.read([A]).byCode[A]);now--;
 assert.deepEqual(cache.read([A]).byCode,{});await until(()=>h.calls.length===3);
 h.calls[2].resolve(result([A],now));await until(()=>cache.read([A]).byCode[A]);
 assert.equal(cache.read([A]).validationByCode[A].asOf,now);
});

test('capacity pins pending work, limits input and allows later cache eviction without expanding workers',async t=>{
 const h=held(),cache=createDecisionFinancialCache({clock:()=>INITIAL,readAsync:h.readAsync,maxEntries:3,batchSize:2});t.after(()=>cache.close());
 const many=Array.from({length:90},(_,i)=>String(600000+i));
 const projection=cache.read(many);
 assert.equal(Object.keys(projection.missingByCode).length,50);assert.match(projection.missingByCode[D],/队列已满/);
 await until(()=>h.calls.length===1);assert.deepEqual(h.calls[0].codes,[A,B]);
 h.calls[0].resolve(result([A,B],INITIAL));await until(()=>h.calls.length===2);assert.deepEqual(h.calls[1].codes,[C]);
 cache.read([A]);cache.read([D]);h.calls[1].resolve(result([C],INITIAL));await until(()=>h.calls.length===3);
 assert.deepEqual(h.calls[2].codes,[D]);assert.ok(cache.read([A]).byCode[A]);h.calls[2].resolve(result([D],INITIAL));
 await until(()=>cache.read([D]).byCode[D]);assert.equal(h.maxRunning(),1);
 assert.throws(()=>createDecisionFinancialCache({timeoutMs:55001}),/边界/);
 assert.throws(()=>createDecisionFinancialCache({maxEntries:61}),/边界/);
 assert.throws(()=>createDecisionFinancialCache({batchSize:11}),/边界/);
});

test('reader failures are private, back off, and reject mismatched or future returned evidence',async t=>{
 let now=INITIAL;const h=held(),cache=createDecisionFinancialCache({clock:()=>now,retryMs:100,readAsync:h.readAsync});t.after(()=>cache.close());
 cache.read([A]);await until(()=>h.calls.length===1);h.calls[0].reject(Error('/private/archive secret details'));
 await until(()=>cache.read([A]).validationByCode[A].status==='error');
 let projection=cache.read([A]);assert.match(projection.missingByCode[A],/暂不可用/);assert.doesNotMatch(JSON.stringify(projection),/private|secret/);
 now+=99;cache.read([A]);await delay(10);assert.equal(h.calls.length,1);now++;
 cache.read([A]);await until(()=>h.calls.length===2);h.calls[1].resolve({byCode:{[A]:data(B,now)},missingByCode:{}});
 await until(()=>cache.read([A]).validationByCode[A].status==='error');assert.deepEqual(cache.read([A]).byCode,{});
 now+=100;cache.read([A]);await until(()=>h.calls.length===3);
 const future=result([A],now);future.byCode[A].datasets.period.receivedAt=now+1;h.calls[2].resolve(future);
 await until(()=>cache.read([A]).validationByCode[A].status==='error');assert.deepEqual(cache.read([A]).byCode,{});
});

test('timeout aborts work, ignores late success and never overlaps an uncooperative injected reader',async t=>{
 const h=held(),cache=createDecisionFinancialCache({clock:()=>INITIAL,timeoutMs:20,readAsync:h.readAsync});t.after(()=>cache.close());
 cache.read([A]);await until(()=>h.calls.length===1);
 await until(()=>cache.read([A]).validationByCode[A].status==='error');
 assert.match(cache.read([A]).missingByCode[A],/超时/);assert.equal(h.calls[0].options.signal.aborted,true);
 cache.read([B]);await delay(5);assert.equal(h.calls.length,1);
 h.calls[0].resolve(result([A],INITIAL,99));await until(()=>h.calls.length===2);
 assert.deepEqual(cache.read([A]).byCode,{});h.calls[1].resolve(result([B],INITIAL));
 await until(()=>cache.read([B]).byCode[B]);assert.equal(h.maxRunning(),1);
});

test('close cancels queued and active work and does not publish any late result',async()=>{
 const h=held(),cache=createDecisionFinancialCache({clock:()=>INITIAL,readAsync:h.readAsync,batchSize:1});
 cache.read([A,B]);await until(()=>h.calls.length===1);await cache.close();
 assert.equal(h.calls[0].options.signal.aborted,true);h.calls[0].resolve(result([A],INITIAL));await delay(10);
 assert.equal(h.calls.length,1);assert.match(cache.read([A,B]).missingByCode[A],/已停止/);assert.equal(cache.invalidate(A),false);
 await cache.close();
});

test('real worker reads a nonexistent archive without creating files or directories',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-financial-cache-empty-'));
 const evidenceRoot=path.join(tmp,'evidence'),observationRoot=path.join(tmp,'observations'),now=Date.now();
 const cache=createDecisionFinancialCache({evidenceRoot,observationRoot,clock:()=>now});
 t.after(async()=>{await cache.close();fs.rmSync(tmp,{recursive:true,force:true});});
 assert.equal(cache.read([A]).missingByCode[A],'原始财报证据正在校验');
 await until(()=>cache.read([A]).validationByCode[A].status==='ready');
 const projection=cache.read([A]);assert.deepEqual(projection.byCode,{});assert.match(projection.missingByCode[A],/尚无已封存/);
 assert.equal(fs.existsSync(evidenceRoot),false);assert.equal(fs.existsSync(observationRoot),false);
});

test('real worker keeps original receipt clocks and invalidation rechecks changed raw bytes',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-financial-cache-raw-'));
 const evidenceRoot=path.join(tmp,'evidence'),observationRoot=path.join(tmp,'observations');
 const {parseFinancials}=require('../src/core/public-stock-financials');
 const {archiveRawEvidence}=require('../src/core/stock-observation-research');
 const {freezeResearchEvidenceBundle}=require('../src/core/research-evidence-bundle');
 const crypto=require('node:crypto'),receivedAt=Date.now()-1000;
 const rows=[{SECURITY_CODE:A,SECUCODE:A+'.SH',CURRENCY:'CNY',REPORT_DATE:'2025-09-30',NOTICE_DATE:'2025-10-30',UPDATE_DATE:'2025-10-30',ROEJQ:7}];
 const raw=Buffer.from(JSON.stringify({success:true,result:{data:rows}}));
 const period=parseFinancials(raw,{symbol:A,kind:'period',receivedAt});
 const ref=archiveRawEvidence(observationRoot,{encoding:'base64',data:raw.toString('base64'),
  sha256:crypto.createHash('sha256').update(raw).digest('hex'),byteLength:raw.length});
 freezeResearchEvidenceBundle(evidenceRoot,{symbol:A,provider:'eastmoney',priceBasis:'unadjusted',decisionAt:Date.now(),
  observationHash:'c'.repeat(64),history:null,marketContext:{financials:{symbol:A,source:'eastmoney-financials',datasets:{period}}},
  stockStatus:null,sectorContext:null,sourceRefs:[{...ref,source:period.source,url:null,receivedAt}],trigger:'isolated-cache-regression'});
 const cache=createDecisionFinancialCache({evidenceRoot,observationRoot});
 t.after(async()=>{await cache.close();fs.rmSync(tmp,{recursive:true,force:true});});
 cache.read([A]);await until(()=>cache.read([A]).byCode[A]);
 assert.equal(cache.read([A]).byCode[A].datasets.period.receivedAt,receivedAt);
 const file=path.join(observationRoot,'source-responses',period.rawHash+'.json'),tampered=Buffer.from(raw);tampered[tampered.length-2]=32;
 fs.writeFileSync(file,tampered);cache.invalidate(A);
 assert.deepEqual(cache.read([A]).byCode,{});
 await until(()=>cache.read([A]).validationByCode[A].status==='ready');
 const failed=cache.read([A]);assert.deepEqual(failed.byCode,{});assert.match(failed.missingByCode[A],/原始财报.*(哈希|SHA256|完整性|校验)/);
 assert.deepEqual(fs.readFileSync(file),tampered,'read-only validation never repairs or overwrites the source');
});
