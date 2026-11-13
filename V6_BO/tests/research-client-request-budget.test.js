'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {writeFile,readFile,access}=require('node:fs/promises');
const {dirname,resolve}=require('node:path'),Module=require('node:module');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const {fetchPublicStockHistory}=require('../src/core/public-stock-history');
const {fetchEastmoneySnapshot}=require('../src/core/eastmoney-market-snapshot');
const {createMarketRequestGovernor}=require('../src/core/market-request-governor');
const NOW=Date.parse('2026-11-12T16:00:00+08:00');
const EM='https://push2his.eastmoney.com/api/qt/stock/kline/get';
const TX='https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const em=()=>({rc:0,data:{code:'600000',market:1,name:'样本',klines:['2026-11-11,10,11,12,9,23,24680,1,2,3,4']}});
const tx=()=>({code:0,data:{sh600000:{day:[['2026-11-11','10','11','12','9','23']]}}});
const bytes=json=>({raw:Buffer.from(JSON.stringify(json))});
const item=(n=1)=>({f12:String(n).padStart(6,'0'),f13:0,f3:1,f124:Math.floor(NOW/1000)-12});
const page=(total,items)=>({ok:true,status:200,json:async()=>({data:{total,diff:items}})});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fakeClock(){
 let at=NOW,id=0;const timers=new Map();
 return {now:()=>at,setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,at:at+ms});return key;},clearTimeout:key=>timers.delete(key),
  tick:async ms=>{const end=at+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;at=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}at=end;await flush();}};
}

test('history and snapshot share one eastmoney start interval and retain the slot through body completion',async()=>{
 const clock=fakeClock(),governor=createMarketRequestGovernor(clock),historyBody=deferred(),snapshotBody=deferred(),starts=[];
 const history=fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:clock.now,requestGovernor:governor,requestJson:async()=>{starts.push(['history',clock.now()]);return historyBody.promise;}});
 const snapshot=fetchEastmoneySnapshot({now:NOW,clock:clock.now,requestGovernor:governor,fetchImpl:async()=>{starts.push(['snapshot',clock.now()]);return {ok:true,status:200,json:()=>snapshotBody.promise};}});
 assert.equal(governor.state(EM).active,1);assert.equal(governor.state(EM).queued,1);
 await clock.tick(1000);assert.equal(starts.length,1);
 historyBody.resolve(bytes(em()));await flush();
 assert.deepEqual(starts,[['history',NOW],['snapshot',NOW+1000]]);
 const later=fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:clock.now,requestGovernor:governor,requestJson:async()=>{starts.push(['history',clock.now()]);return bytes(em());}});
 await clock.tick(1000);assert.equal(starts.length,2,'unconsumed snapshot JSON still owns the active wire');
 snapshotBody.resolve({data:{total:1,diff:[item()]}});await flush();
 const [h,s,l]=await Promise.all([history,snapshot,later]);
 assert.deepEqual(starts,[['history',NOW],['snapshot',NOW+1000],['history',NOW+2000]]);
 assert.equal(h.stock.bars[0].knownAt,NOW+1000);assert.equal(l.stock.bars[0].knownAt,NOW+2000);
 assert.equal(s.samplingDurationMs,2000);assert.equal(s.stocks[0].vendorQuoteAt,NOW-12000);
 assert.equal(governor.state(EM).active,0);assert.equal(governor.state(EM).queued,0);
});

for(const [status,retryAfter,cooldown] of [[429,'120',120000],[403,'60',900000]]){
 test(`snapshot HTTP ${status} stops later pages, aborts the response and blocks the history client`,async()=>{
  const clock=fakeClock(),governor=createMarketRequestGovernor(clock);let calls=0,restrictedSignal,parsedErrorBody=false;
  const result=fetchEastmoneySnapshot({now:NOW,clock:clock.now,pageSize:1,requestGovernor:governor,fetchImpl:async(_url,{signal})=>{
   if(++calls===1)return page(3,[item()]);
   restrictedSignal=signal;return {ok:false,status,headers:new Headers({'Retry-After':retryAfter}),json:async()=>{parsedErrorBody=true;throw Error('must not parse');}};
  }}).then(()=>assert.fail('must reject'),error=>error);
  await flush();await clock.tick(1000);const error=await result;
  assert.equal(error.code,'MARKET_RESTRICTED');assert.equal(error.status,status);assert.equal(error.resumeAt,NOW+1000+cooldown);
  assert.equal(calls,2);assert.equal(parsedErrorBody,false);assert.equal(restrictedSignal.aborted,true);
  let historyCalls=0;
  const blocked=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:clock.now,requestGovernor:governor,requestJson:async()=>{historyCalls++;return bytes(em());}});
  assert.equal(historyCalls,0);assert.equal(blocked.errors[0].code,'MARKET_RESTRICTED');assert.equal(blocked.errors[0].resumeAt,error.resumeAt);
  const fallback=await fetchPublicStockHistory({symbol:'600000'},{now:clock.now,requestGovernor:governor,requestJson:async target=>{historyCalls++;assert.equal(new URL(target).hostname,'web.ifzq.gtimg.cn');return bytes(tx());}});
  assert.equal(historyCalls,1);assert.equal(fallback.provider,'tencent');assert.equal(fallback.errors[0].status,status);
  assert.equal(governor.state(TX).cooldownLeftMs,0);
 });
}

test('Retry-After HTTP date and restricted raw bytes retain one supplier, receipt clock, schema and SHA',async()=>{
 const clock=fakeClock(),governor=createMarketRequestGovernor(clock),resumeAt=NOW+180000;
 const raw=Buffer.from(' \n{"error":"rate limit"}\r\n');let calls=0;
 const result=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:clock.now,requestGovernor:governor,requestJson:async()=>{calls++;return {raw,status:429,headers:{'Retry-After':new Date(resumeAt).toUTCString()}};}});
 assert.equal(calls,1);assert.equal(result.schemaVersion,1);assert.equal(result.status,'unknown');assert.deepEqual(result.stock.bars,[]);
 assert.equal(result.errors[0].code,'MARKET_RESTRICTED');assert.equal(result.errors[0].status,429);assert.equal(result.errors[0].resumeAt,resumeAt);
 assert.equal(result.provider,'eastmoney');assert.equal(result.provenance.provider,'eastmoney');assert.equal(result.stock.observedAt,NOW);assert.equal(result.retrievedAt,NOW);
 assert.deepEqual(Buffer.from(result.rawEvidence.data,'base64'),raw);assert.equal(result.rawHash,createHash('sha256').update(raw).digest('hex'));assert.equal(result.rawEvidence.sha256,result.rawHash);
 await clock.tick(180000);
 const recovered=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:clock.now,requestGovernor:governor,requestJson:async()=>{calls++;return bytes(em());}});
 assert.equal(calls,2);assert.equal(recovered.status,'observed-unverified');assert.equal(recovered.stock.bars[0].knownAt,resumeAt);
});

test('a backwards receipt clock cannot erase restriction status or resume time',async()=>{
 const governor=createMarketRequestGovernor({now:()=>NOW});let clock=NOW;
 const result=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>clock--,requestGovernor:governor,requestJson:async()=>({raw:Buffer.from('restricted'),status:403})});
 assert.equal(result.errors[0].code,'MARKET_RESTRICTED');assert.equal(result.errors[0].status,403);assert.equal(result.errors[0].resumeAt,NOW+900000);
 assert.equal(result.rawEvidence,undefined);assert.deepEqual(result.stock.bars,[]);
});

test('queue waiting cannot send another page after the snapshot sampling window expires',async()=>{
 const clock=fakeClock(),governor=createMarketRequestGovernor(clock);let calls=0;
 const result=fetchEastmoneySnapshot({now:NOW,clock:clock.now,pageSize:1,maxSamplingMs:500,requestGovernor:governor,fetchImpl:async()=>{calls++;return page(2,[item()]);}}).then(()=>assert.fail('must reject'),error=>error);
 await flush();await clock.tick(1000);
 assert.match((await result).message,/采样跨度超过限制/);assert.equal(calls,1);
});

test('snapshot Abort timeout starts at wire dispatch after queue waiting',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const clock=fakeClock(),governor=createMarketRequestGovernor(clock),hold=deferred();let calls=0,signal;
 const blocker=governor.run(EM,()=>hold.promise);
 const result=fetchEastmoneySnapshot({now:NOW,clock:clock.now,timeoutMs:100,requestGovernor:governor,fetchImpl:async(_url,options)=>{calls++;signal=options.signal;assert.equal(signal.aborted,false);return page(1,[item()]);}});
 t.mock.timers.tick(5000);assert.equal(calls,0);
 hold.resolve();await blocker;await clock.tick(1000);await result;
 assert.equal(calls,1);assert.equal(signal.aborted,true,'completed response releases its controller');
});

test('default fetch and an explicit global fetch both use the default shared governor',async()=>{
 const originalFetch=globalThis.fetch;
 try{
  for(const explicit of [false,true]){
   const clock=fakeClock(),governor=createMarketRequestGovernor(clock);let calls=0;
   globalThis.fetch=async()=>page(2,[item(++calls)]);
   const filename=resolve(__dirname,'../src/core/eastmoney-market-snapshot.js'),compiled=new Module(filename,module);
   compiled.filename=filename;compiled.paths=Module._nodeModulePaths(dirname(filename));
   compiled.require=function(name){if(name==='./market-request-governor')return {...require('../src/core/market-request-governor'),marketRequests:governor};return Module.prototype.require.call(this,name);};
   compiled._compile(await readFile(filename,'utf8'),filename);
   const result=compiled.exports.fetchEastmoneySnapshot({now:NOW,clock:clock.now,pageSize:1,...(explicit?{fetchImpl:globalThis.fetch}:{})});
   await flush();assert.equal(calls,1);assert.equal(governor.state(EM).queued,1);
   await clock.tick(999);assert.equal(calls,1);await clock.tick(1);
   assert.equal((await result).pages,2);assert.equal(calls,2);
  }
 }finally{globalThis.fetch=originalFetch;}
});

test('pure injected adapters need no real one-second waits and keep exact successful evidence', {timeout:500},async()=>{
 let calls=0;const raw=Buffer.from(' \n'+JSON.stringify(em())+'\r\n');
 const h=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>NOW,requestJson:async()=>({raw})});
 const s=await fetchEastmoneySnapshot({now:NOW,pageSize:1,fetchImpl:async()=>page(3,[item(++calls)])});
 assert.equal(calls,3);assert.equal(s.samplingDurationMs,0);assert.equal(h.stock.bars[0].knownAt,NOW);
 assert.deepEqual(Buffer.from(h.rawEvidence.data,'base64'),raw);assert.equal(h.provenance.rawByteLength,raw.length);
});

// Compile the production transport with a complete execFile stub. Every other
// child-process method is absent, no subprocess is created, and real filesystem
// cleanup still runs. The suite also runs under the deny-egress preload.
async function curlFixture({raw=Buffer.from(' \n'+JSON.stringify(em())+'\r\n'),headers='HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n',exitCode=0,isolatedClock=false,cleanupFails=false,prepareDelayMs=0}={}){
 let at=NOW;const governor=createMarketRequestGovernor({now:()=>at});let call,calls=0;
 const execFile=()=>assert.fail('only promisified execFile is supported by this offline fixture');
 execFile[promisify.custom]=async(file,args,options)=>{
  assert.equal(file,'curl');assert.equal(++calls,1);assert.equal(options.encoding,'buffer');
  const body=args[args.indexOf('--output')+1];assert.ok(body);call={args,body,wireStartedAt:at};await writeFile(body,raw);
  const stdout=Buffer.from(headers,'latin1').subarray(0,options.maxBuffer),stderr=Buffer.alloc(0);
  if(exitCode||Buffer.byteLength(headers,'latin1')>options.maxBuffer)throw Object.assign(new Error('offline curl fixture failure'),{code:exitCode||'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',stdout,stderr});
  return {stdout,stderr};
 };
 const filename=resolve(__dirname,'../src/core/public-stock-history.js'),compiled=new Module(filename,module);
 compiled.filename=filename;compiled.paths=Module._nodeModulePaths(dirname(filename));
 compiled.require=function(name){
  if(name==='node:child_process')return {execFile};
  if(name==='./market-request-governor')return {...require('../src/core/market-request-governor'),marketRequests:governor};
  if(name==='node:fs/promises'&&(cleanupFails||prepareDelayMs))return {...require(name),
   ...(prepareDelayMs?{mkdtemp:async(...args)=>{at+=prepareDelayMs;return require(name).mkdtemp(...args);}}:{}),
   ...(cleanupFails?{rm:async(...args)=>{await require(name).rm(...args);throw Error('offline cleanup failure');}}:{})};
  return Module.prototype.require.call(this,name);
 };
 compiled._compile(await readFile(filename,'utf8'),filename);
 const result=await compiled.exports.fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>at,...(isolatedClock?{requestGovernor:governor}:{})});
 assert.equal(calls,1);await assert.rejects(access(dirname(call.body)),{code:'ENOENT'});
 return {result,state:governor.state(EM),call,raw};
}

test('default curl transport reserves the singleton, preserves exact bytes and removes its temporary body',async()=>{
 const {result,state,call,raw}=await curlFixture();
 assert.equal(result.status,'observed-unverified');assert.equal(result.stock.bars[0].knownAt,NOW);
 assert.deepEqual(Buffer.from(result.rawEvidence.data,'base64'),raw);assert.equal(result.rawHash,createHash('sha256').update(raw).digest('hex'));
 assert.equal(state.active,0);assert.equal(state.queued,0);assert.ok(Number.isSafeInteger(state.lastStartAt));
 assert.equal(call.args.includes('--fail'),false);assert.equal(call.args.includes('--retry'),false);assert.equal(call.args.includes('--location'),false);
 assert.equal(call.args[call.args.indexOf('--max-filesize')+1],String(2*1024*1024));assert.equal(call.args[call.args.indexOf('--dump-header')+1],'-');
});

test('curl reserves its start after asynchronous temporary-directory preparation',async()=>{
 const {state,call,result}=await curlFixture({prepareDelayMs:2000});
 assert.equal(state.lastStartAt,NOW+2000);assert.equal(call.wireStartedAt,state.lastStartAt);assert.equal(result.stock.bars[0].knownAt,NOW+2000);
});

for(const [status,retryAfter,cooldown] of [[429,'120',120000],[403,'60',900000]]){
 test(`curl HTTP ${status} reads the final response Retry-After, retains error bytes and cleans temporary files`,async()=>{
  const raw=Buffer.from(` ${status} restricted\r\n`),headers=`HTTP/1.1 200 Connection established\r\nRetry-After: 9999\r\n\r\nHTTP/1.1 100 Continue\r\n\r\nHTTP/2 ${status}\r\nretry-after: ${retryAfter}\r\n\r\n`;
  const {result,state}=await curlFixture({raw,headers,isolatedClock:true});
  assert.equal(result.status,'unknown');assert.equal(result.errors[0].code,'MARKET_RESTRICTED');assert.equal(result.errors[0].status,status);assert.equal(result.errors[0].resumeAt,NOW+cooldown);
  assert.equal(state.cooldownUntil,NOW+cooldown);assert.deepEqual(Buffer.from(result.rawEvidence.data,'base64'),raw);
  assert.equal(result.provenance.rawByteLength,raw.length);assert.equal(result.stock.observedAt,NOW);
 });
}

test('curl body/header bounds and failed children still remove temporary files',async()=>{
 for(const options of [{raw:Buffer.alloc(2*1024*1024+1)},{headers:'HTTP/1.1 200 OK\r\nX-Large: '+'x'.repeat(70*1024)+'\r\n\r\n'},{exitCode:23}]){
  const {result,state}=await curlFixture(options);assert.equal(result.status,'unknown');assert.equal(result.stock.bars.length,0);assert.equal(state.active,0);
 }
});

test('a curl failure or oversized restriction body cannot hide a received HTTP 429',async()=>{
 for(const options of [{raw:Buffer.alloc(2*1024*1024+1)},{exitCode:63}]){
  const {result,state}=await curlFixture({...options,headers:'HTTP/2 429\r\nRetry-After: 120\r\n\r\n',isolatedClock:true});
  assert.equal(result.status,'unknown');assert.equal(result.errors[0].code,'MARKET_RESTRICTED');assert.equal(result.errors[0].resumeAt,NOW+120000);assert.equal(state.cooldownUntil,NOW+120000);
 }
});

test('a cleanup error cannot replace the supplier restriction or its resume time',async()=>{
 const {result,state}=await curlFixture({headers:'HTTP/2 403\r\nRetry-After: 1000\r\n\r\n',isolatedClock:true,cleanupFails:true});
 assert.equal(result.errors[0].code,'MARKET_RESTRICTED');assert.equal(result.errors[0].status,403);assert.equal(result.errors[0].resumeAt,NOW+1000000);assert.equal(state.cooldownUntil,NOW+1000000);
});
