'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {collectEcbFxRate:collect,projectEcbCsv:project,parseCsv}=require('../src/core/ecb-fx-daily');
const at=Date.parse('2025-02-10T16:00:00Z'),scope={currency:'USD',start:'2025-02-03',end:'2025-02-07'},cfg={...scope,now:at,clock:()=>at};
const csv=(value='1.2',note='safe')=>'KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,NOTE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2025-02-03,'+value+','+note+'\n';
const raw=csv(),wire=(body=raw,headers={})=>new Response(body,{headers:{'content-type':'text/csv',...headers}});
const call=fetchImpl=>collect({...cfg,fetchImpl});
test('batch38-01 closed CSV quotes must not concatenate malformed numeric values or empty rows',()=>{
 for(const value of ['"1".2','""1.2','"1.2"junk'])assert.throws(()=>project(csv(value),{...scope,observedAt:at}),/引号/);
 assert.throws(()=>project(raw+',,,,,,\n',{...scope,observedAt:at}),/不一致/);
 assert.deepEqual(parseCsv('a,b\r\n"x,y","a""b"\r\n"",""'),[['a','b'],['x,y','a"b'],['','']]);
 assert.equal(project(csv('"1.2"'),{...scope,observedAt:at}).rows[0].unitsPerEuro,1.2);
});
test('batch38-02 reject partial, missing status, hidden redirects and content range before reading',async()=>{
 for(const patch of [{status:206},{status:undefined},{redirected:true},{type:'opaqueredirect'},{url:'https://example.invalid/elsewhere'},{headers:new Headers({'content-range':'bytes 0-40/100'})}]){
  let reads=0;await assert.rejects(()=>call(async()=>({ok:true,status:200,...patch,body:(async function*(){reads++;yield Buffer.from(raw);})()})),/HTTP|重定向|部分/);assert.equal(reads,0);
 }
 assert.equal((await call(async()=>wire())).canTrade,false);
});
test('batch38-03 explicit invalid MIME and throwing response headers fail closed with sanitized diagnostics',async()=>{
 for(const ct of ['',123,{toString:()=> 'text/csv'}])await assert.rejects(()=>call(async()=>({ok:true,status:200,headers:{get:k=>k==='content-type'?ct:null},text:async()=>raw})),/不是CSV/);
 await assert.rejects(()=>call(async()=>({ok:true,status:200,headers:{get(){throw Error('private-marker');}},text:async()=>raw})),e=>/响应头/.test(e.message)&&!e.message.includes('private-marker'));
 assert.equal((await call(async()=>wire(raw,{'content-type':'application/vnd.ecb.data+csv; charset=UTF-8'}))).rows[0].unitsPerEuro,1.2);
});
test('batch38-04 declared length and single recognized content encoding verified',async()=>{
 for(const headers of [{'content-length':'1'},{'content-length':'999999'},{'content-length':'1e2'},{'content-length':'1','content-encoding':'custom'},{'content-encoding':'gzip, identity'}])await assert.rejects(()=>call(async()=>wire(raw,headers)),/长度|编码/);
 assert.equal((await call(async()=>wire(raw,{'content-encoding':'gzip','content-length':'32'}))).rows[0].unitsPerEuro,1.2);
 assert.equal((await call(async()=>wire(raw,{'content-length':String(Buffer.byteLength(raw))}))).rows[0].unitsPerEuro,1.2);
});
test('batch38-05 empty chunk flood bounded, nonbyte chunks rejected, valid split bytes retained',async()=>{
 let read=0;await assert.rejects(()=>call(async()=>({ok:true,status:200,body:(async function*(){for(let i=0;i<4200;i++){read++;yield Buffer.alloc(0);}yield Buffer.from(raw);})()})),/块数/);assert.equal(read,4097);
 await assert.rejects(()=>call(async()=>({ok:true,status:200,body:(async function*(){yield raw;})()})),/字节流/);
 const result=await call(async()=>({ok:true,status:200,body:(async function*(){yield Buffer.alloc(0);yield Buffer.from(raw.slice(0,10));yield Buffer.from(raw.slice(10));})()}));assert.equal(result.rows[0].unitsPerEuro,1.2);
});
test('batch38-06 corrupted UTF-8 and malformed decoded text cannot become valid evidence',async()=>{
 const damaged=Buffer.concat([Buffer.from(raw.slice(0,-1)),Buffer.from([0xff]),Buffer.from('\n')]);
 await assert.rejects(()=>call(async()=>wire(damaged)),/UTF-8/);
 await assert.rejects(()=>call(async()=>({ok:true,status:200,text:async()=>csv('1.2','\ud800')})),/UTF-8/);
 const r=await call(async()=>wire(csv('1.2','合法备注')));assert.equal(r.rows[0].unitsPerEuro,1.2);
});
test('batch38-07 reject clock rollback at any stage and preserve actual full receipt time',async()=>{
 let calls=0;await assert.rejects(()=>collect({...cfg,clock:()=>at-1,fetchImpl:async()=>{calls++;return wire();}}),/时钟/);assert.equal(calls,0);
 let i=0;const bad=[at,at+10,at+9,at+20,at+30];await assert.rejects(()=>collect({...cfg,clock:()=>bad[Math.min(i++,4)],fetchImpl:async()=>wire()}),/时钟/);
 i=0;const good=[at,at+10,at+20,at+30,at+40];const r=await collect({...cfg,clock:()=>good[Math.min(i++,4)],fetchImpl:async()=>wire()});assert.equal(r.observedAt,at+30);assert.equal(r.rows[0].collectorObservedAt,at+30);assert.equal(r.rows[0].quoteAt,null);assert.equal(r.verifiedLive,false);assert.equal(i,5);
});
test('batch38-08 independent deadline covers uncooperative headers and body, late data not projected',async()=>{
 for(const during of ['headers','body']){
  let release,signal,read=0;const gate=new Promise(r=>{release=r;});const watchdog=setTimeout(release,450);
  try{
   await assert.rejects(()=>collect({...cfg,timeoutMs:250,fetchImpl:async(_,opts)=>{signal=opts.signal;if(during==='headers')await gate;return {ok:true,status:200,body:(async function*(){if(during==='body')await gate;read++;yield Buffer.from(raw);})()};}}),/超时/);
   assert.equal(signal.aborted,true);release();await delay(20);assert.equal(read,during==='headers'?0:1);
  }finally{clearTimeout(watchdog);release();}
 }
});
