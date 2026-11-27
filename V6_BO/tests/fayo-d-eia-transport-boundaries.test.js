'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {collectEiaSpotDaily:collect,projectEiaJson:project}=require('../src/core/eia-spot-daily');
const tick=Date.parse('2025-02-10T16:00:00Z'),scope={series:'RWTC',start:'2025-02-03',end:'2025-02-07'},key='fixture-key-not-real-123456';
const cfg={...scope,apiKey:key,clock:()=>tick};
const data={response:{total:'1',frequency:'daily',dateFormat:'YYYY-MM-DD',data:[{period:'2025-02-03',series:'RWTC',units:'$/BBL',value:'72.5'}]}};
const raw=JSON.stringify(data);
const wire=(text=raw,headers={'content-type':'application/json'})=>new Response(text,{headers});
const p=x=>project(JSON.stringify(x),{...scope,observedAt:tick});
test('batch37-01 credential field aliases and percent-encoded keys rejected during raw projection',()=>{
 for(const field of ['api key','access token','api%5Fkey','%61uthorization','API%252DKEY'])assert.throws(()=>p({...data,metadata:{[field]:'redacted'}}),/凭据/);
 assert.equal(p({...data,metadata:{'data-source':'official','series-name':'WTI'}}).rows[0].value,72.5);
});
test('batch37-02 credential assignments and encoded echoes cannot enter raw evidence',async()=>{
 for(const note of ['Authorization: Bearer hidden','https://example.invalid/?api%5Fkey=redacted','{"access_token":"hidden"}','https://example.invalid/?api%255Fkey=hidden'])assert.throws(()=>p({...data,note}),/凭据/);
 const encoded=key.split('').map(c=>'%'+c.charCodeAt(0).toString(16)).join('');
 await assert.rejects(()=>collect({...cfg,fetchImpl:async()=>wire(JSON.stringify({...data,note:encoded}))}),/凭据/);
 assert.equal(p({...data,note:'USD per barrel'}).rows[0].value,72.5);
});
test('batch37-03 explicit malformed content type rejected before reading bytes',async()=>{
 for(const ct of ['',{toString:()=> 'application/json'},123]){
  let reads=0;await assert.rejects(()=>collect({...cfg,fetchImpl:async()=>({ok:true,status:200,headers:{get:k=>k==='content-type'?ct:null},body:(async function*(){reads++;yield Buffer.from(raw);})()})}),/JSON/);assert.equal(reads,0);
 }
 const r=await collect({...cfg,fetchImpl:async()=>wire(raw,{'content-type':'application/vnd.eia+json; charset=utf-8'})});assert.equal(r.rows[0].value,72.5);
});
test('batch37-04 unknown or multiple encodings cannot bypass wire length validation',async()=>{
 for(const encoding of ['unknown','gzip, identity',''])await assert.rejects(()=>collect({...cfg,fetchImpl:async()=>wire(raw,{'content-type':'application/json','content-encoding':encoding,'content-length':'1'})}),/编码/);
 const r=await collect({...cfg,fetchImpl:async()=>wire(raw,{'content-type':'application/json','content-encoding':'gzip','content-length':'32'})});assert.equal(r.rows[0].value,72.5);assert.equal(r.verifiedLive,false);
});
test('batch37-05 chunk flood bounded including zero-byte chunks',async()=>{
 let read=0;await assert.rejects(()=>collect({...cfg,fetchImpl:async()=>({ok:true,status:200,body:(async function*(){for(let i=0;i<4200;i++){read++;yield Buffer.alloc(0);}yield Buffer.from(raw);})()})}),/字节流/);assert.equal(read,4097);
 const r=await collect({...cfg,fetchImpl:async()=>({ok:true,status:200,body:(async function*(){yield Buffer.alloc(0);yield Buffer.from(raw);})()})});assert.equal(r.rows[0].value,72.5);
});
test('batch37-06 hard timeout even if fetch ignores AbortSignal; late headers never read',async()=>{
 let reads=0,signal;let release;const gate=new Promise(r=>{release=r;});
 // Release regardless of assertion outcome; original implementation cannot hang the runner.
 const watchdog=setTimeout(release,450);
 try{
  await assert.rejects(()=>collect({...cfg,timeoutMs:250,fetchImpl:async(_,opts)=>{signal=opts.signal;await gate;return {ok:true,status:200,body:(async function*(){reads++;yield Buffer.from(raw);})()};}}),/超时/);
  assert.equal(signal.aborted,true);release();await delay(20);assert.equal(reads,0);
 }finally{clearTimeout(watchdog);release();}
});
test('batch37-07 deadline covers incomplete response body even with ignored abort; late body cannot finish successfully',async()=>{
 let signal,finished=0;let release;const gate=new Promise(r=>{release=r;});const watchdog=setTimeout(release,450);
 try{
  await assert.rejects(()=>collect({...cfg,timeoutMs:250,fetchImpl:async(_,opts)=>{signal=opts.signal;return {ok:true,status:200,body:(async function*(){yield Buffer.from(raw.slice(0,10));await gate;yield Buffer.from(raw.slice(10));finished++;})()};}}),/超时/);
  assert.equal(signal.aborted,true);release();await delay(20);assert.equal(finished,0);
 }finally{clearTimeout(watchdog);release();}
});
test('batch37-08 clock must still be monotonic at final publication, without rewriting observation time',async()=>{
 let i=0;const rollback=[tick,tick+1,tick+2,tick+3,tick+2];
 await assert.rejects(()=>collect({...cfg,clock:()=>rollback[Math.min(i++,4)],fetchImpl:async()=>wire()}),/时钟/);
 i=0;const good=[tick,tick+1,tick+2,tick+3,tick+4];const r=await collect({...cfg,clock:()=>good[Math.min(i++,4)],fetchImpl:async()=>wire()});
 assert.equal(r.observedAt,tick+3);assert.equal(r.rows[0].collectorObservedAt,tick+3);assert.equal(r.rows[0].quoteAt,null);assert.equal(r.canTrade,false);assert.equal(i,5);
});
