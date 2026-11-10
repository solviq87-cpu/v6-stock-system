'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectPublicQuoteEndpoints:inspect}=
 require('../src/core/public-quote-endpoint-health');
const now=Date.parse('2026-11-10T13:58:00+08:00');
function raw(id,quoteAt=now){
 if(id==='eastmoney')return JSON.stringify({rc:0,data:{
  f57:'600519',f43:1440.03,f60:1444.99,f47:16477,f86:Math.floor(quoteAt/1000)}});
 const fields=Array(33).fill('');
 if(id==='tencent'){
  fields[2]='600519';fields[3]='1440.41';fields[4]='1444.99';fields[6]='16476';
  fields[30]=new Date(quoteAt+8*3600000).toISOString().replace(/[-:T]/g,'').slice(0,14);
  return 'v_sh600519="'+fields.join('~')+'";';
 }
 fields[2]='1444.99';fields[3]='1440.41';fields[8]='1647600';
 fields[30]='2026-11-10';fields[31]='13:58:00';
 return 'var hq_str_sh600519="'+fields.join(',')+'";';
}
const source=url=>url.includes('gtimg')?'tencent':url.includes('eastmoney')?'eastmoney':'sina';
const good=async url=>new Response(raw(source(url)));
test('three sources are queried in parallel without credentials, price transformations or trading permission',async()=>{
 const calls=[];
 const pending=[];
 const promise=inspect({code:'600519',clock:()=>now,
  fetchImpl:(url,opts)=>new Promise(resolve=>{
   calls.push({url,opts});pending.push({url,resolve});
  })});
 // The three providers should start before any response arrives.
 assert.equal(calls.length,3);
 assert.ok(calls.every(x=>x.opts.method==='GET'&&x.opts.redirect==='manual'));
 assert.ok(calls.every(x=>x.opts.headers===undefined));
 for(const p of pending)p.resolve(await good(p.url));
 const r=await promise;
 assert.equal(r.providers.length,3);
 assert.ok(r.providers.every(x=>x.status==='fresh-source-unverified'));
 assert.equal(r.providers.find(x=>x.provider==='eastmoney').price,1440.03);
 assert.equal(r.providers.find(x=>x.provider==='eastmoney').previousClose,1444.99);
 assert.equal(r.providers.find(x=>x.provider==='tencent').price,1440.41);
 assert.equal(r.verifiedLive,false);
 assert.equal(r.providerLicensed,false);
 assert.equal(r.canTrade,false);
});
test('Eastmoney 302 to delayed host is reported and never followed',async()=>{
 const calls=[];
 const r=await inspect({code:'600519',clock:()=>now,providers:['eastmoney'],
  fetchImpl:async(url,options)=>{
   calls.push({url,redirect:options.redirect});
   return new Response('',{status:302,headers:{location:'https://push2delay.eastmoney.com/private-secret'}});
  }});
 assert.equal(calls.length,1);
 assert.equal(calls[0].redirect,'manual');
 assert.equal(r.providers[0].status,'redirect-refused');
 assert.equal(r.providers[0].httpStatus,302);
 assert.equal(r.providers[0].price,null);
 assert.equal(JSON.stringify(r).includes('private-secret'),false);
});
test('403 and 429 remain independent denials and are never retried',async()=>{
 const calls=[];
 const r=await inspect({code:'600519',clock:()=>now,
  fetchImpl:async(url)=>{const id=source(url);calls.push(id);
   if(id==='sina')return new Response('',{status:403});
   if(id==='eastmoney')return new Response('',{status:429});
   return good(url);
  }});
 assert.equal(calls.length,3);
 assert.equal(r.providers[0].status,'fresh-source-unverified');
 assert.equal(r.providers[1].status,'rate-limited');
 assert.equal(r.providers[1].httpStatus,429);
 assert.equal(r.providers[2].status,'access-denied');
 assert.equal(r.providers[2].httpStatus,403);
 assert.equal(r.canTrade,false);
});
test('invalid provider format and oversized upstream bodies are not trusted',async()=>{
 const r=await inspect({code:'600519',clock:()=>now,
  fetchImpl:async url=>source(url)==='eastmoney'
   ?new Response('{malformed json')
   :source(url)==='sina'
    ?new Response('X'.repeat(65537))
    :good(url)});
 assert.equal(r.providers[0].status,'fresh-source-unverified');
 assert.equal(r.providers[1].status,'invalid-quote');
 assert.equal(r.providers[2].status,'response-too-large');
 assert.equal(r.providers[1].price,null);
 assert.equal(r.providers[2].price,null);
});
test('timeout is bounded even if an injected transport ignores AbortSignal',async()=>{
 const r=await inspect({code:'600519',clock:()=>now,providers:['eastmoney','tencent'],
  timeoutMs:100,fetchImpl:(url)=>url.includes('eastmoney')
   ?new Promise(()=>{}) :good(url)});
 assert.equal(r.providers[0].status,'timeout');
 assert.equal(r.providers[1].status,'fresh-source-unverified');
 assert.equal(r.providers[0].price,null);
});
test('outside continuous auction windows no source is requested',async()=>{
 let requests=0;
 const r=await inspect({code:'600519',clock:()=>Date.parse('2026-11-10T12:00:00+08:00'),
  fetchImpl:async()=>{requests++;return good('https://qt.gtimg.cn');}});
 assert.equal(requests,0);
 assert.equal(r.status,'outside-weekday-session-window');
 assert.ok(r.providers.every(x=>x.status==='not-requested'));
});
test('crossing 15:00 market close turns observations into dated snapshots',async()=>{
 let virtualNow=Date.parse('2026-11-10T14:59:59+08:00');
 const r=await inspect({code:'600519',providers:['eastmoney'],
  clock:()=>virtualNow,
  fetchImpl:async()=>{
   const resp=new Response(raw('eastmoney',virtualNow));
   virtualNow=Date.parse('2026-11-10T15:00:01+08:00');
   return resp;
  }});
 assert.equal(r.providers[0].status,'dated-snapshot');
 assert.equal(r.providers[0].price,1440.03);
 assert.equal(r.canTrade,false);
});
test('bad code, duplicate providers, hostile provider names and invalid timeout reject before requests',async()=>{
 let requests=0;
 const fetchImpl=async()=>{requests++;throw Error('should not fetch');};
 for(const input of [
  {code:'000001&test=1'},{code:'600519',providers:['sina','sina']},
  {code:'600519',providers:['ifind']},{code:'600519',timeoutMs:10001}
 ]){
  await assert.rejects(()=>inspect({...input,clock:()=>now,fetchImpl}));
 }
 assert.equal(requests,0);
});

test('opaque redirect is refused without inspecting Location or treating it as a network failure',async()=>{
 const calls=[];
 const r=await inspect({code:'600519',clock:()=>now,providers:['eastmoney'],
  fetchImpl:async(url,opts)=>{
   calls.push({url,redirect:opts.redirect});
   return {type:'opaqueredirect',status:0,ok:false,headers:{
    get(){throw Error('redirect headers must never be read');}
   }};
  }});
 assert.equal(calls.length,1);
 assert.equal(calls[0].redirect,'manual');
 assert.equal(r.providers[0].status,'redirect-refused');
 assert.equal(r.providers[0].httpStatus,null);
 assert.equal(r.providers[0].price,null);
 assert.equal(r.canTrade,false);
});
