'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const fs=require('node:fs'),path=require('node:path'),{promisify}=require('node:util'),{createHash}=require('node:crypto');
const governors=require('../src/core/market-request-governor');
const NOW=Date.parse('2026-11-12T16:05:00+08:00'),EM='https://push2his.eastmoney.com';
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function clock(){let at=NOW,id=0;const timers=new Map();return {now:()=>at,stall:ms=>{at+=ms;},setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{at:at+ms,fn});return key;},clearTimeout:key=>timers.delete(key),
 async advance(ms){const end=at+ms;for(;;){await flush();const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;at=Math.max(at,next[1].at);timers.delete(next[0]);next[1].fn();}at=end;await flush();}};}
function payload(target){
 const u=new URL(target);
 if(u.hostname==='qt.gtimg.cn'){const f=Array(50).fill('');f[2]='600000';f[30]='20261112150000';f[47]='11';f[48]='9';return Buffer.from('v_sh600000="'+f.join('~')+'";');}
 if(u.hostname==='datacenter-web.eastmoney.com')return {success:true,result:{data:[],count:0,pages:0}};
 if(u.pathname.includes('Topic'))return {rc:0,data:{qdate:20261112,tc:0,pool:[]}};
 if(u.pathname.includes('daykline'))return {rc:0,data:{klines:['2026-11-12,100,1,2,3,4,5,6,7,8,9,10,11,12,13']}};
 const members=u.searchParams.get('fs')?.startsWith('b:');
 return {rc:0,data:{total:1,diff:[members?{f12:'600000',f13:1}:{f12:u.searchParams.get('fs')?.includes('t:2')?'BK1034':'BK1234',f14:'样本板块',f3:1,f6:100,f62:0,f124:(NOW-60000)/1000}]}};
}
function fixture({respond=target=>({json:payload(target)}),prepareDelayMs=0,cleanupFails=false}={}){
 const time=clock(),governor=governors.createMarketRequestGovernor({now:time.now,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout}),starts=[],files=new Map(),directories=new Set();let id=0;
 const fakeFS={async mkdtemp(){time.stall(prepareDelayMs);const dir='/offline-research/'+(++id);directories.add(dir);return dir;},async stat(file){if(!files.has(file))throw Error('missing fixture body');return {size:files.get(file).length};},async readFile(file){return files.get(file);},async rm(dir){directories.delete(dir);for(const name of files.keys())if(name.startsWith(dir+'/'))files.delete(name);if(cleanupFails)throw Error('fixture cleanup failed');}};
 const execFile=()=>assert.fail('the fixture only supports promisified curl');
 execFile[promisify.custom]=async(command,args,options)=>{
  assert.equal(command,'curl');assert.equal(args.includes('--fail'),false);assert.equal(args.includes('--retry'),false);assert.equal(args.includes('--location'),false);
  const target=args.at(-1),at=time.now();starts.push({target,at,options});
  const response=respond(target);if(response.gate)await response.gate;
  const raw=response.raw??(Buffer.isBuffer(response.json)?response.json:Buffer.from(' \n'+JSON.stringify(response.json??{})+'\r\n'));
  files.set(args[args.indexOf('--output')+1],raw);
  const headers=Buffer.from(response.headers??`HTTP/1.1 200 Connection established\r\nRetry-After: 9999\r\n\r\nHTTP/2 ${response.status??200}\r\nRetry-After: ${response.retryAfter??'0'}\r\n\r\n`);
  const stdout=headers.subarray(0,options.maxBuffer);
  if(response.failed||headers.length>options.maxBuffer)throw Object.assign(Error('fixture curl transfer failed'),{code:'fixture-wire-failed',stdout});
  return {stdout,stderr:Buffer.alloc(0)};
 };
 const load=(name,extra={})=>{
  const filename=path.resolve(__dirname,'../src/core',name),compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));
  compiled.require=function(name){
   if(name==='node:child_process')return {execFile};if(name==='node:fs/promises')return fakeFS;
   if(name==='node:perf_hooks')return {performance:{now:time.now}};
   if(name==='./market-request-governor')return {...governors,marketRequests:governor};
   if(Object.hasOwn(extra,name))return extra[name];return Module.prototype.require.call(this,name);
  };compiled._compile(fs.readFileSync(filename,'utf8'),filename);return compiled.exports;
 };
 const transport=load('research-curl-bytes.js'),extra={'./research-curl-bytes':transport};
 const api={context:load('public-market-context.js',extra),status:load('public-stock-status-evidence.js',extra),boards:load('eastmoney-current-board-members.js',extra)};
 async function settle(promise){let done=false,error,result;promise.then(r=>{done=true;result=r;},e=>{done=true;error=e;});for(let n=0;n<80&&!done;n++){await flush();if(!done)await time.advance(1000);}assert.equal(done,true,'fixture exceeded its bounded fake-clock schedule');if(error)throw error;return result;}
 return {...time,api,transport,governor,starts,files,directories,settle};
}
const collect=(h,kind)=>kind==='context'?h.api.context.fetchPublicContext({symbol:'600000'},{now:h.now,retainRawEvidence:true}):kind==='status'?h.api.status.fetchPublicStockStatusEvidence({symbol:'600000'},{now:h.now}):h.api.boards.fetchEastmoneyCurrentBoards({}, {now:h.now});

test('all three default context transports share one supplier wire budget and keep exact evidence bytes/clocks',async()=>{
 const h=fixture(),reports=await h.settle(Promise.all(['context','status','boards'].map(kind=>collect(h,kind))));
 const eastmoney=h.starts.filter(r=>r.target.includes('eastmoney.com'));
 assert.ok(eastmoney.length>=7);for(let i=1;i<eastmoney.length;i++)assert.ok(eastmoney[i].at-eastmoney[i-1].at>=1000);
 assert.equal(h.starts.filter(r=>r.target.includes('gtimg.cn')).length,1);
 const [context,status,boards]=reports;
 assert.equal(context.schemaVersion,1);assert.equal(context.marketFlow.records[0].mainNetInflow,100);assert.equal(context.marketFlow.sourceTimestamp,null);
 assert.equal(status.schemaVersion,1);assert.equal(status.priceLimits.quoteAt,Date.parse('2026-11-12T15:00:00+08:00'));assert.equal(status.priceLimits.preopenObserved,false);
 assert.equal(boards.catalogue.records[0].quoteAt,NOW-60000);
 for(const report of reports)for(const ref of report.rawEvidence){const raw=Buffer.from(ref.data??ref.rawBase64,'base64');assert.equal(createHash('sha256').update(raw).digest('hex'),ref.sha256??ref.rawHash);assert.equal(raw.length,ref.byteLength??ref.bytes);assert.ok((ref.receivedAt??ref.observedAt)>=report.startedAt);}
 assert.equal(h.directories.size,0);assert.equal(h.files.size,0);
});

test('context parses UTF8 separately from exact wire-byte hashing and retains its raw string adapter API',async()=>{
 const raw=Buffer.concat([Buffer.from('{"rc":0,"data":{"klines":[]},"extra":"'),Buffer.from([0xff]),Buffer.from('"}')]);
 const h=fixture({respond:target=>target.includes('daykline')?{raw}:{json:payload(target)}});
 const direct=await h.api.context.requestPublicJson(EM+'/api/qt/stock/fflow/daykline/get');assert.equal(typeof direct.raw,'string');assert.deepEqual(direct.rawBytes,raw);
 const result=await h.settle(collect(h,'context')),proof=result.rawEvidence.find(r=>r.source==='eastmoney:marketFlow');
 assert.deepEqual(Buffer.from(proof.data,'base64'),raw);assert.equal(proof.byteLength,raw.length);assert.equal(proof.sha256,createHash('sha256').update(raw).digest('hex'));assert.equal(result.marketFlow.rawHash,proof.sha256);
});

for(const kind of ['context','status','boards'])for(const status of [429,403])test(`${kind} HTTP ${status} stops same-family pages/fallback and preserves the restriction body`,async()=>{
 const raw=Buffer.from(' \n{"error":"restricted"}\r\n'),h=fixture({respond:target=>target.includes('eastmoney.com')?{status,retryAfter:'120',raw}:{json:payload(target)}});
 const report=await h.settle(collect(h,kind));
 assert.equal(h.starts.filter(r=>r.target.includes('eastmoney.com')).length,1);
 const errors=report.errors.filter(e=>(e.errorCode??e.code)==='MARKET_RESTRICTED');assert.ok(errors.length);assert.ok(errors.every(e=>e.status===status&&e.resumeAt===NOW+(status===429?120000:900000)));
 const proof=report.rawEvidence.find(e=>(e.source??'').startsWith('eastmoney'));assert.ok(proof);assert.deepEqual(Buffer.from(proof.data??proof.rawBase64,'base64'),raw);
 if(kind==='boards'){assert.equal(report.catalogue.complete,false);assert.ok(errors.every(e=>e.code!=='MARKET_RESTRICTED'),'board code identity remains separate from errorCode');}
 if(kind==='status'){assert.equal(h.starts.filter(r=>r.target.includes('gtimg.cn')).length,1);assert.equal(report.dividendEvents.status,'unknown');assert.equal(report.priceLimits.limitUpPrice,11);}
 assert.equal(h.directories.size,0);
});

test('a context restriction blocks later default status/board calls while Tencent retains its independent budget',async()=>{
 const h=fixture({respond:target=>target.includes('eastmoney.com')?{status:429,retryAfter:new Date(NOW+180000).toUTCString(),raw:Buffer.from('restricted')}:{json:payload(target)}});
 await h.settle(collect(h,'context'));const count=h.starts.length;
 await h.settle(Promise.all([collect(h,'status'),collect(h,'boards')]));
 assert.equal(h.starts.length,count+1);assert.ok(h.starts.at(-1).target.includes('gtimg.cn'));assert.equal(h.governor.state(EM).cooldownUntil,NOW+180000);
});

test('a body still transferring retains its supplier slot across another default client',async()=>{
 const gate=deferred();let first=true;const h=fixture({respond:target=>{const reply={json:payload(target),...(first?{gate:gate.promise}:{})};first=false;return reply;}});
 const one=h.api.context.requestPublicJson(EM+'/api/qt/stock/fflow/daykline/get');await flush();
 const two=h.api.status.requestPublicStockStatusRaw('https://qt.gtimg.cn/q=sh600000');
 const three=h.api.context.requestPublicJson('https://push2ex.eastmoney.com/getTopicZTPool');
 await h.advance(1000);assert.equal(h.starts.filter(r=>r.target.includes('eastmoney.com')).length,1);
 gate.resolve();await h.settle(Promise.all([one,two,three]));assert.equal(h.directories.size,0);
});

test('asynchronous preparation precedes wire reservation and queued cancellation/deadlines send nothing',async()=>{
 const prep=fixture({prepareDelayMs:2000});await prep.transport.requestResearchBytes(EM+'/fixture');assert.equal(prep.starts[0].at,prep.governor.state(EM).lastStartAt);assert.equal(prep.starts[0].at,NOW+2000);
 for(const cancelled of [true,false]){
  const h=fixture(),gate=deferred(),hold=h.governor.run(EM,()=>gate.promise),controller=new AbortController();
  const pending=h.transport.requestResearchBytes(EM+'/fixture',{signal:controller.signal,beforeStart:()=>{if(h.now()>NOW+500)throw Error('collection deadline');}}).then(()=>assert.fail('must reject'),e=>e);
  await flush();if(cancelled)controller.abort();gate.resolve();await hold;await h.advance(1000);const error=await pending;
  assert.match(error.message,cancelled?/取消/:/deadline/);assert.equal(h.starts.length,0);assert.equal(h.directories.size,0);
 }
});

test('bounded failed transfers and cleanup cannot hide received restrictions; the final header controls Retry-After',async()=>{
 for(const reply of [{raw:Buffer.alloc(2*1024*1024+1)},{failed:true,raw:Buffer.from('partial')},{headers:'HTTP/2 429\r\nX-Large: '+'x'.repeat(70000),raw:Buffer.from('body')}]){
  const h=fixture({respond:()=>({status:429,retryAfter:'120',...reply})});const error=await h.transport.requestResearchBytes(EM+'/fixture').then(()=>assert.fail('must reject'),e=>e);
  assert.equal(error.code,'MARKET_RESTRICTED');assert.ok(error.resumeAt>=NOW+60000);assert.equal(h.directories.size,0);
 }
 const h=fixture({cleanupFails:true,respond:()=>({status:403,retryAfter:'1000',raw:Buffer.from('denied')})});const error=await h.transport.requestResearchBytes(EM+'/fixture').then(()=>assert.fail('must reject'),e=>e);
 assert.equal(error.code,'MARKET_RESTRICTED');assert.equal(error.resumeAt,NOW+1000000);assert.equal(h.directories.size,0);
});

test('pure injected adapters have no real delay and optional HTTP status still stops further same-family work',async()=>{
 let calls=0;const {fetchPublicContext}=require('../src/core/public-market-context');
 const report=await fetchPublicContext({}, {now:()=>NOW,retainRawEvidence:true,requestJson:async()=>{calls++;return {raw:'denied',status:429,headers:{'Retry-After':'120'}};}});
 assert.equal(calls,1);assert.equal(report.errors.length,3);assert.ok(report.errors.every(e=>e.code==='MARKET_RESTRICTED'));
});
