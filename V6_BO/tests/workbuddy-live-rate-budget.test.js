'use strict';
// Fully offline VM checks. Source evaluation is confined to the market module.
// Run with node --test V6_BO/tests/workbuddy-live-rate-budget.test.js.
// Optional explicit source/report: node this-file source.html report.json (no network dependencies).
global.fetch=()=>Promise.reject(Error('Offline test forbids host fetch'));
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto'),nodeTest=require('node:test');
const filename=process.argv[2]||path.resolve(__dirname,'../../V6_WEB/workbuddy/index.html');
const reportFile=process.argv[3]||null;
const html=fs.readFileSync(filename,'utf8');
const first=html.indexOf("(function(root){\n'use strict';\nconst SOURCE="),ending="})(typeof window!=='undefined'?window:globalThis);",last=html.indexOf(ending,first);
if(first<0||last<0)throw Error('Market module boundary missing');
const source=html.slice(first,last+ending.length);
const moduleFor=name=>{const at=html.indexOf('root.'+name+'=Object.freeze('),begin=html.lastIndexOf('(function(root){',at),end=html.indexOf(ending,at);if(at<0||begin<0||end<0)throw Error('Missing module '+name);return html.slice(begin,end+ending.length);};
const researchSource=['V6StrategyData','V6Financials','V6StrategyAssets'].map(moduleFor).join('\n');
const classBegin=html.indexOf('async function refreshClassifications(force=false){'),classEnd=html.indexOf('async function scanFullMarket(',classBegin),classificationSource=html.slice(classBegin,classEnd);
if(!classificationSource.includes('window.V6Market.publicFetch'))throw Error('Classification boundary bypassed shared transport');
if(/\bSHARE\s*=/.test(source))throw Error('Credential module denied');
const base=Date.parse('2026-11-13T01:45:00Z');
const sleepFlush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function scheduler(start=base){
 let now=start,id=0;const timers=new Map();
 const setTimeout=(fn,ms=0)=>{const n=++id;timers.set(n,{at:now+Math.max(0,Number(ms)||0),fn});return n;};
 const clearTimeout=n=>timers.delete(n);
 const next=()=>[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
 async function settle(promises,maxMs=2000000){let done=false;const result=Promise.allSettled(promises).then(r=>{done=true;return r;}),limit=now+maxMs;for(let i=0;i<100000&&!done;i++){await sleepFlush();if(done)break;const n=next();if(!n||n[1].at>limit)throw Error('Bounded virtual deadline exceeded');now=n[1].at;timers.delete(n[0]);n[1].fn();}if(!done)throw Error('Pending mock work');return result;}
 async function advance(ms){const target=now+ms;for(let i=0;i<100000;i++){await sleepFlush();const n=next();if(!n||n[1].at>target){now=target;await sleepFlush();return;}now=n[1].at;timers.delete(n[0]);n[1].fn();}throw Error('Excessive mock timer work');}
 return {setTimeout,clearTimeout,settle,advance,get now(){return now;}};
}
function lockManager(){
 const queues=new Map(),held=new Set();
 function pump(name){if(held.has(name))return;const q=queues.get(name)||[];let item;while((item=q.shift())){if(!item.aborted)break;}if(!item||item.aborted)return;held.add(name);item.started=true;item.signal?.removeEventListener('abort',item.abort);Promise.resolve().then(()=>item.fn({name,mode:'exclusive'})).then(item.resolve,item.reject).finally(()=>{held.delete(name);pump(name);});}
 return {request(name,opt,fn){if(typeof opt==='function'){fn=opt;opt={};}return new Promise((resolve,reject)=>{const item={fn,resolve,reject,signal:opt?.signal,started:false,aborted:false};item.abort=()=>{if(item.started)return;item.aborted=true;reject(Object.assign(Error('Mock queued lock aborted'),{name:'AbortError'}));};if(item.signal?.aborted){item.abort();return;}item.signal?.addEventListener('abort',item.abort,{once:true});if(!queues.has(name))queues.set(name,[]);queues.get(name).push(item);pump(name);});}};
}
function world({start=base,status=200,latency=20,lastDate='2026-11-12',retryAfter=null,emptyQuote=false,invalidDaily=false,bodyLatency=0}={}){
 const clock=scheduler(start),locks=lockManager(),storage=new Map(),calls=[],active={},peaks={};
 const settings={status,latency,lastDate,retryAfter,emptyQuote,invalidDaily,bodyLatency};
 function makeTab(){
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
  const context={Date:ClockDate,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Response,Headers,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,document:{hidden:false,visibilityState:'visible'},navigator:{locks},localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},console:{log(){},warn(){},error(){}}};
  context.fetch=(raw,options={})=>{
   if(options.signal?.aborted)return Promise.reject(Object.assign(Error('Mock aborted'),{name:'AbortError'}));
   const url=new URL(String(raw)),provider=/gtimg\.(?:cn|com)$|qq\.com$/.test(url.hostname)?'tencent':/sina\.com\.cn$/.test(url.hostname)?'sina':/eastmoney\.com$/.test(url.hostname)?'eastmoney':'unknown';
   if(provider==='unknown')return Promise.reject(Error('Mock denies unrecognized provider'));
   const family=url.pathname.includes('/q=')?'quotes':provider==='sina'?'directory':provider==='eastmoney'?'research':'history',status=settings.status;
   let body='[]';
   if(family==='history'){
    const qid=(url.searchParams.get('param')||'').split(',')[0],end=Date.parse(settings.lastDate+'T12:00:00Z');
    const n=Math.max(21,Number((url.searchParams.get('param')||'').split(',')[4])||21),rows=Array.from({length:n},(_,i)=>[new Date(end-(n-1-i)*86400000).toISOString().slice(0,10),'10','10','11','9','100']);
    body=settings.invalidDaily?JSON.stringify({code:0,data:{}}):JSON.stringify({code:0,data:{[qid]:{day:rows,qfqday:rows}}});
   }else if(family==='research')body=JSON.stringify(url.pathname.includes('fflow')?{rc:0,data:{code:url.searchParams.get('secid').split('.')[1],klines:['2026-11-13,1,2,3,4,5,6,7,8,9,10,10,0']}}:{success:true,result:{data:[],pages:1,count:0}});else if(family==='quotes')body=settings.emptyQuote?'':url.href.split('/q=')[1].split(',').map(qid=>{const f=Array(55).fill('');f[1]='MOCK';f[2]=qid.slice(2);f[3]='10';f[4]='10';f[30]='20261113094500';f[32]='0';return `v_${qid}="${f.join('~')}";`;}).join('\n');
   calls.push({provider,family,status,startMs:clock.now-base,url:url.href});active[provider]=(active[provider]||0)+1;peaks[provider]=Math.max(peaks[provider]||0,active[provider]);
   return new Promise((resolve,reject)=>{let done=false,settled=false,read,bodyReject;const finish=error=>{if(done)return;done=true;active[provider]--;options.signal?.removeEventListener('abort',abort);if(error){if(settled)bodyReject?.(error);else reject(error);}};const abort=()=>finish(Object.assign(Error('Mock aborted'),{name:'AbortError'}));options.signal?.addEventListener('abort',abort,{once:true});clock.setTimeout(()=>{if(done)return;settled=true;const consume=()=>read||(read=new Promise((r,j)=>{bodyReject=j;clock.setTimeout(()=>{finish();r(body);},settings.bodyLatency);}));resolve({ok:status>=200&&status<300,status,statusText:'Mock',headers:new Headers(settings.retryAfter?{'Retry-After':settings.retryAfter}:{}),text:()=>consume(),json:async()=>JSON.parse(await consume()),arrayBuffer:async()=>new TextEncoder().encode(await consume()).buffer});},settings.latency);});
  };
  context.window=context;context.globalThis=context;vm.createContext(context,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(source,context,{timeout:1000});vm.runInContext(researchSource,context,{timeout:1000});
  context.installClassifications=()=>{};context.renderMarketSafely=()=>{};context.V6StorageCodec={encode:async()=>''};context.api=async()=>{};context.classElement={title:''};context.$=()=>context.classElement;context.CLASS_KEY='offline-classification';context.classificationData={groups:[['sw1_fixture','Fixture',1,[]]],updatedAt:'2026-11-01T00:00:00Z'};context.classificationLastAttempt=0;context.classificationJob=null;
  vm.runInContext(classificationSource,context,{timeout:1000});return {api:context.V6Market,context};
 }
 return {clock,locks,storage,calls,peaks,settings,makeTab};
}
const results=[];
function check(condition,message){if(!condition)throw Error(message);}
async function test(name,fn){return nodeTest(name,async()=>{try{const evidence=await fn();results.push({name,pass:true,evidence});}catch(e){results.push({name,pass:false,error:e.message});throw e;}});}
async function main(){
 await test('default_paused_all_entrypoints',async()=>{const w=world(),t=w.makeTab();await w.clock.settle([t.api.refreshQuotes({force:true}),t.api.loadSeries('600000',{force:true}),t.api.discoverUniverse({force:true})]);check(!t.api.status.collectionEnabled,'Default unexpectedly enabled');check(w.calls.length===0,'Default paused entrypoint emitted a wire request');return {wireRequests:w.calls.length};});
 await test('same_provider_quotes_history_one_inflight',async()=>{const w=world({latency:1500}),t=w.makeTab();t.api.resumeCollection();await w.clock.settle([t.api.refreshQuotes({force:true}),t.api.loadSeries('600000',{force:true}),t.api.loadSeries('600001',{force:true})]);const starts=w.calls.filter(x=>x.provider==='tencent').map(x=>x.startMs);check(w.peaks.tencent===1,'Tencent overlap');check(starts.length>=3,'Expected quote/history wires missing');check(starts.every((x,i)=>i===0||x-starts[i-1]>=1000),'Tencent start interval under 1 second');return {peakTencentInflight:w.peaks.tencent,tencentStartMs:starts};});
 await test('two_tabs_shared_lock_and_one_second_gap',async()=>{const w=world(),a=w.makeTab(),b=w.makeTab();a.api.resumeCollection();b.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000'),b.api.loadSeries('600001')]);const starts=w.calls.map(x=>x.startMs);check(w.peaks.tencent===1,'Two-tab overlap');check(starts.length===2&&starts[1]-starts[0]>=1000,'Two-tab start interval under 1 second');return {peakTencentInflight:w.peaks.tencent,startMs:starts};});
 for(const status of [429,403])await test(`status_${status}_persists_without_same_provider_fallback`,async()=>{const w=world({status}),a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000',{force:true})]);check(w.calls.length===1,'Restricted response attempted a fallback');const original=w.clock.now;const b=w.makeTab();b.api.resumeCollection();await w.clock.settle([b.api.loadSeries('600001',{force:true})]);check(w.calls.length===1,'Reload bypassed cooldown');const minimum=status===403?900000:60000;await w.clock.advance(minimum-1);await w.clock.settle([b.api.loadSeries('600002',{force:true})]);check(w.calls.length===1,'Cooldown ended too early');await w.clock.advance(2);await w.clock.settle([b.api.loadSeries('600003',{force:true})]);check(w.calls.length===2,'Provider did not resume after elapsed minimum cooldown');return {beforeMinimumRequests:1,totalRequests:w.calls.length,persistedEntries:w.storage.size,elapsedMs:w.clock.now-original};});
 await test('retry_after_larger_than_minimum',async()=>{const w=world({status:429,retryAfter:'3600'}),a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000')]);await w.clock.advance(60001);const b=w.makeTab();b.api.resumeCollection();await w.clock.settle([b.api.loadSeries('600001',{force:true})]);check(w.calls.length===1,'Retry-After was shortened');return {wireRequests:w.calls.length};});
 await test('pause_aborts_active_and_queued_then_resume_does_not_revive_queue',async()=>{const w=world({latency:5000}),a=w.makeTab();a.api.resumeCollection();const requests=[a.api.loadSeries('600000'),a.api.loadSeries('600001')];await sleepFlush();check(w.calls.length===1,'First request failed to start');a.api.pauseCollection('offline test');a.api.resumeCollection();await w.clock.settle(requests);check(w.calls.length===1,'Paused queue revived after resume');return {wireRequests:w.calls.length};});
 await test('hidden_tab_refuses_new_requests',async()=>{const w=world(),a=w.makeTab();a.api.resumeCollection();a.context.document.hidden=true;await w.clock.settle([a.api.loadSeries('600000'),a.api.refreshQuotes({force:true})]);check(w.calls.length===0,'Hidden tab started a wire request');return {wireRequests:w.calls.length};});
 await test('same_closed_day_cache_survives_force_and_eleven_minutes',async()=>{const w=world(),a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000')]);await w.clock.advance(660000);await w.clock.settle([a.api.loadSeries('600000',{force:true})]);check(w.calls.length===1,'Same closed data day refetched');return {wireRequests:w.calls.length,asOfDate:a.api.snapshot.seriesMeta['600000'].asOfDate};});
 await test('stale_source_date_remains_actual_date',async()=>{const w=world({lastDate:'2026-11-12'}),a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000')]);check(a.api.snapshot.seriesMeta['600000'].asOfDate==='2026-11-12','Stale actual source data date overwritten');check(a.api.snapshot.series['600000'].at(-1).date==='2026-11-12','Stale row date overwritten');return {sourceDatePreserved:true};});
 await test('intraday_and_future_rows_excluded_from_history_cache',async()=>{const w=world({start:Date.parse('2026-11-13T02:00:00Z'),lastDate:'2026-11-14'}),a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000')]);check(a.api.snapshot.seriesMeta['600000'].asOfDate==='2026-11-12','Unclosed or future row cached');return {lastClosedDate:a.api.snapshot.seriesMeta['600000'].asOfDate};});
 await test('morning_cache_waits_through_close_until_next_open',async()=>{
  const w=world({start:Date.parse('2026-11-13T01:45:00Z'),lastDate:'2026-11-12'}),a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000')]);check(w.calls.length===1,'Morning history fixture failed');
  await w.clock.advance(Date.parse('2026-11-13T07:30:01Z')-w.clock.now);w.settings.lastDate='2026-11-13';await w.clock.settle([a.api.loadSeries('600000',{force:true})]);check(w.calls.length===1,'After-close request bypassed session gate');
  await w.clock.advance(Date.parse('2026-11-16T01:15:00Z')-w.clock.now);await w.clock.settle([a.api.loadSeries('600000',{force:true})]);check(w.calls.length===2,'Prior-day success blocked next opening history');check(a.api.snapshot.seriesMeta['600000'].asOfDate==='2026-11-13','Next opening history lost prior close date');return {morningRequests:1,afterCloseRequests:1,nextOpeningRequests:2};
 });
 await test('per_symbol_failure_backoff_reload_and_daily_two_attempts',async()=>{const w=world({status:400}),a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000')]);const b=w.makeTab();b.api.resumeCollection();await w.clock.settle([b.api.loadSeries('600000',{force:true})]);check(w.calls.length===1,'Reload or force bypassed symbol backoff');await w.clock.advance(900001);await w.clock.settle([b.api.loadSeries('600000',{force:true})]);check(w.calls.length===2,'Second symbol attempt did not run');await w.clock.advance(1800001);await w.clock.settle([b.api.loadSeries('600000',{force:true})]);check(w.calls.length===2,'Per-symbol day budget exceeded two attempts');return {wireRequests:w.calls.length};});
 await test('provider_daily_budget_blocks_manual_force',async()=>{const w=world();w.storage.set('v6:public-market-budget:v1',JSON.stringify({schemaVersion:1,families:{tencent:{day:'2026-11-13',starts:6000,nextStartAt:0,blockedUntil:0,failures:0,status:null}},codes:{},historyPauseUntil:0}));const a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000',{force:true})]);check(w.calls.length===0,'Daily provider budget bypassed');return {wireRequests:w.calls.length};});
 await test('history_batch_is_at_most_sixty_symbols',async()=>{const w=world(),a=w.makeTab();a.api.resumeCollection();const symbols=Array.from({length:65},(_,i)=>String(600000+i));await w.clock.settle([a.api.loadIndicators({symbols,includeIndices:false})]);check(w.calls.length===60,'History batch limit mismatch');return {wireRequests:w.calls.length};});
 await test('storage_failure_and_missing_web_locks_fail_closed',async()=>{const w=world(),a=w.makeTab();a.context.navigator.locks=null;let failed=false;try{a.api.resumeCollection();}catch(e){failed=true;}await w.clock.settle([a.api.refreshQuotes({force:true})]);check(failed&&w.calls.length===0,'Missing locks did not fail closed');const b=w.makeTab();b.context.localStorage.getItem=()=>{throw Error('Mock unavailable');};failed=false;try{b.api.resumeCollection();}catch(e){failed=true;}check(failed&&w.calls.length===0,'Missing storage did not fail closed');return {wireRequests:w.calls.length};});
 for(const initialFamily of ['quote','daily'])await test(`http_200_invalid_${initialFamily}_triggers_progressive_provider_backoff`,async()=>{
  const w=world({emptyQuote:true,invalidDaily:true}),a=w.makeTab();a.api.resumeCollection();
  await w.clock.settle([initialFamily==='quote'?a.api.refreshQuotes({force:true}):a.api.loadSeries('600000')]);
  const tencent=()=>w.calls.filter(x=>x.provider==='tencent');check(tencent().length===1,'Invalid success response attempted a same-provider fallback');
  const firstResponse=base+tencent()[0].startMs+w.settings.latency;
  await w.clock.advance(firstResponse+15000-1-w.clock.now);
  await w.clock.settle([a.api.loadSeries('600001',{force:true})]);check(tencent().length===1,'Next symbol bypassed initial 15-second provider backoff');
  await w.clock.advance(2);await w.clock.settle([a.api.loadSeries('600002',{force:true})]);check(tencent().length===2,'Provider did not become eligible after initial backoff');
  const secondResponse=base+tencent()[1].startMs+w.settings.latency;
  await w.clock.advance(secondResponse+30000-1-w.clock.now);
  await w.clock.settle([a.api.loadSeries('600003',{force:true})]);check(tencent().length===2,'Second invalid response did not increase provider backoff to 30 seconds');
  await w.clock.advance(2);await w.clock.settle([a.api.loadSeries('600004',{force:true})]);check(tencent().length===3,'Provider did not become eligible after progressive backoff');
  return {allResponsesHttp200:true,tencentStartMs:tencent().map(x=>x.startMs),initialBackoffMs:15000,secondBackoffMs:30000};
 });
 await test('ten_stale_history_results_wait_for_next_close_and_next_open',async()=>{
  const w=world({lastDate:'2026-11-11'}),a=w.makeTab();a.api.resumeCollection();
  await w.clock.settle([a.api.loadIndicators({symbols:Array.from({length:20},(_,i)=>String(600000+i)),includeIndices:false})]);check(w.calls.length===10,'Ten stale results did not stop subsequent history symbols');
  const b=w.makeTab();b.api.resumeCollection();await w.clock.settle([b.api.loadSeries('600020',{force:true})]);check(w.calls.length===10,'Reload or force bypassed no-progress pause');
  await w.clock.advance(Date.parse('2026-11-13T07:30:01Z')-w.clock.now);w.settings.lastDate='2026-11-13';await w.clock.settle([b.api.loadSeries('600021',{force:true})]);check(w.calls.length===10,'Next closing data bypassed closed-market scan gate');
  await w.clock.advance(Date.parse('2026-11-16T01:15:00Z')-w.clock.now);await w.clock.settle([b.api.loadSeries('600022',{force:true})]);check(w.calls.length===11,'History failed to resume at next opening');check(b.api.snapshot.seriesMeta['600022'].asOfDate==='2026-11-13','Resumed history did not keep actual source date');return {requestsBeforeResume:10,requestsAfterResume:11,resumeAt:'2026-11-16T01:15:00Z'};
 });
 await test('china_midnight_does_not_scan_and_next_open_resets_daily_budget',async()=>{
  const w=world({start:Date.parse('2026-11-13T15:59:59Z')}),seed={schemaVersion:1,families:{tencent:{day:'2026-11-13',starts:6000,nextStartAt:0,blockedUntil:0,failures:0,status:null}},codes:{},historyPauseUntil:0};
  w.storage.set('v6:public-market-budget:v1',JSON.stringify(seed));const a=w.makeTab();a.api.resumeCollection();await w.clock.settle([a.api.loadSeries('600000',{force:true})]);check(w.calls.length===0,'Closed midnight fixture emitted wire');
  await w.clock.advance(1001);await w.clock.settle([a.api.loadSeries('600001',{force:true})]);check(w.calls.length===0,'Midnight reset enabled closed-market wire');
  await w.clock.advance(Date.parse('2026-11-16T01:15:00Z')-w.clock.now);await w.clock.settle([a.api.loadSeries('600002',{force:true})]);check(w.calls.length===1,'Next open did not reset provider budget');const persisted=JSON.parse(w.storage.get('v6:public-market-budget:v1'));check(persisted.families.tencent.day==='2026-11-16'&&persisted.families.tencent.starts===1,'New-day provider budget did not persist');
  const rollback=world();for(const [key,value]of w.storage)rollback.storage.set(key,value);const b=rollback.makeTab();b.api.resumeCollection();const results=await rollback.clock.settle([b.api.loadSeries('600003',{force:true})]);check(rollback.calls.length===0,'Clock date rollback emitted a request');check(results[0].status==='rejected'&&results[0].reason.code==='RATE_CLOCK_ROLLBACK','Clock rollback was not identified');return {midnightRequests:0,nextOpeningRequests:1,rollbackRequests:0};
 });
 await test('lock_queue_timeout_does_not_send_after_thirty_seconds',async()=>{
  const w=world(),a=w.makeTab();let release;const blocker=w.locks.request('v6:public-market-wire',()=>new Promise(resolve=>{release=resolve;}));await sleepFlush();a.api.resumeCollection();
  const request=a.api.loadSeries('600000');w.clock.setTimeout(()=>release(),31000);await w.clock.settle([blocker,request]);check(w.calls.length===0,'Expired lock waiter emitted a late wire request');return {lockHeldMs:31000,wireRequests:w.calls.length};
 });
 await test('corrupt_persistent_state_fails_closed',async()=>{
  const invalidStates=['{broken-json',JSON.stringify({schemaVersion:1,families:{tencent:{day:'2026-11-13',starts:-1,nextStartAt:0,blockedUntil:0}},codes:{},historyPauseUntil:0}),JSON.stringify({schemaVersion:1,families:{},codes:{'600000':{day:'2026-11-13',failures:0,nextAttemptAt:-1}},historyPauseUntil:0})];
  let refusals=0;for(const raw of invalidStates){const w=world();w.storage.set('v6:public-market-budget:v1',raw);const a=w.makeTab();try{a.api.resumeCollection();}catch(e){check(e.code==='RATE_STATE_INVALID','Corruption error lacked fail-closed code');refusals++;}await w.clock.settle([a.api.loadSeries('600001',{force:true})]);check(w.calls.length===0,'Corrupt budget emitted a wire request');}
  check(refusals===invalidStates.length,'Some corrupt state enabled collection');return {corruptVariants:invalidStates.length,refusals,wireRequests:0};
 });
 await test('corrupt_negative_history_attempt_counter_fails_closed',async()=>{
  const w=world();w.storage.set('v6:public-history-budget:v1',JSON.stringify({schemaVersion:1,families:{},codes:{'600000':{day:'2026-11-13',failures:0,attempts:-1,nextAttemptAt:0,target:'2026-11-13',lastDataDate:null}},historyPauseUntil:0}));const a=w.makeTab();let refused=false;try{a.api.resumeCollection();}catch(e){refused=e.code==='RATE_STATE_INVALID';}
  await w.clock.settle([a.api.loadSeries('600000',{force:true})]);check(refused&&w.calls.length===0,'Negative history attempt counter enabled collection and emitted '+w.calls.length+' request(s)');return {refused,wireRequests:w.calls.length};
 });

 await test('research_and_classification_real_entrypoints_default_paused',async()=>{
  const w=world(),t=w.makeTab(),c=t.context;await w.clock.settle([c.V6StrategyData.refresh({symbols:['600000'],types:['funds'],force:true}),c.V6Financials.refresh({symbols:['600000'],force:true}),c.V6StrategyAssets.discoverBonds({force:true}),c.V6StrategyAssets.refreshQuotes(['sh510300'],{force:true}),c.refreshClassifications(true)]);check(w.calls.length===0,'Research/classification bypassed default pause');return {wireRequests:0,actualModules:4};
 });
 await test('eastmoney_research_financial_assets_share_physical_wire',async()=>{
  const w=world(),t=w.makeTab(),c=t.context;t.api.resumeCollection();await w.clock.settle([c.V6StrategyData.refresh({symbols:['600000'],types:['funds'],force:true}),c.V6Financials.refresh({symbols:['600000'],force:true}),c.V6StrategyAssets.discoverBonds({force:true})]);const starts=w.calls.filter(x=>x.provider==='eastmoney').map(x=>x.startMs);check(starts.length>=5,'Research real boundaries did not execute');check(w.peaks.eastmoney===1,'Eastmoney body overlapped');check(starts.every((x,i)=>!i||x-starts[i-1]>=1000),'Research wire interval under 1 second');return {eastmoneyRequests:starts.length,peak:1,startMs:starts};
 });
 await test('assets_tencent_quotes_share_market_history_governor',async()=>{
  const w=world({bodyLatency:1500}),t=w.makeTab();t.api.resumeCollection();await w.clock.settle([t.context.V6StrategyAssets.refreshQuotes(['sh510300'],{force:true}),t.api.loadSeries('600000')]);check(w.calls.length===2&&w.peaks.tencent===1,'Assets and market body consumption overlapped');check(w.calls[1].startMs-w.calls[0].startMs>=1500,'Lock released before body consumption');return {wireRequests:2,peak:1,startMs:w.calls.map(x=>x.startMs)};
 });
 await test('classification_and_assets_sina_share_governor',async()=>{
  const w=world(),t=w.makeTab();t.api.resumeCollection();check(t.api.status.collectionEnabled&&!t.context.document.hidden&&t.context.classificationData.groups.length===1,'classification fixture invalid');const settled=await w.clock.settle([t.context.refreshClassifications(true),t.context.V6StrategyAssets.discoverETF({force:true})]);check(settled[0].status==='fulfilled','Classification runtime error: '+settled[0].reason?.message);const calls=w.calls.filter(x=>x.provider==='sina');check(calls.length>=3,'Expected actual classification and asset requests');check(w.peaks.sina===1&&calls.every((x,i)=>!i||x.startMs-calls[i-1].startMs>=1000),'Classification/asset bypassed shared wire');return {sinaRequests:calls.length,peak:1};
 });
 for(const status of [403,429])await test(`eastmoney_${status}_persists_across_modules_and_reload`,async()=>{
  const w=world({status}),t=w.makeTab();t.api.resumeCollection();await w.clock.settle([t.context.V6StrategyData.refresh({symbols:['600000'],types:['funds'],force:true})]);check(w.calls.length===1,'First restricted research request rotated');const reloaded=w.makeTab();reloaded.api.resumeCollection();await w.clock.settle([reloaded.context.V6Financials.refresh({symbols:['600001'],force:true}),reloaded.context.V6StrategyAssets.discoverBonds({force:true})]);check(w.calls.length===1,'Another research module or reload bypassed cooldown');const persisted=JSON.parse(w.storage.get('v6:public-market-budget:v1'));check(persisted.families.eastmoney.blockedUntil>=base+(status===403?900000:60000),'Cooldown minimum missing');return {wireRequests:1,status,persistentCooldown:true};
 });
 await test('pause_aborts_research_body_and_queued_market_work',async()=>{
  const w=world({latency:100,bodyLatency:5000}),t=w.makeTab();t.api.resumeCollection();const work=[t.context.V6StrategyData.refresh({symbols:['600000'],types:['funds'],force:true}),t.api.loadSeries('600000')];await sleepFlush();await w.clock.advance(101);t.api.pauseCollection();await w.clock.settle(work);check(w.calls.length===1,'Paused research body allowed queued wire');return {wireRequests:1};
 });
 await test('sixty_bar_history_upgrades_once_for_260_bar_strategy',async()=>{
  const w=world(),t=w.makeTab();t.api.resumeCollection();await w.clock.settle([t.api.loadSeries('600000',{barCount:60})]);await w.clock.settle([t.api.ensureStrategyBars('600000',{force:true})]);await w.clock.settle([t.api.ensureStrategyBars('600000',{force:true})]);const sizes=w.calls.map(x=>Number(new URL(x.url).searchParams.get('param').split(',')[4]));check(sizes.length===2&&sizes[0]===60&&sizes[1]===260,'History cache upgrade was blocked or repeated');const budget=JSON.parse(w.storage.get('v6:public-history-budget:v1'));check(budget.codes['600000'].attempts===2,'Upgrade did not consume second symbol budget');return {wireRequests:2,requestedBars:sizes,attempts:2};
 });
 await test('public_bridge_unknown_host_hidden_and_response_shape_are_fail_closed',async()=>{
  const w=world(),t=w.makeTab();t.api.resumeCollection();await w.clock.settle([t.api.publicFetch('https://unknown.invalid/data')]);t.context.document.hidden=true;await w.clock.settle([t.api.publicFetch('https://datacenter-web.eastmoney.com/api/data/v1/get')]);check(!w.calls.length,'Unknown/hidden source emitted wire');return {wireRequests:0};
 });
 const report={offline:true,htmlSha256:crypto.createHash('sha256').update(html).digest('hex'),evaluated:'actual market, strategy data, financials, isolated assets and classification modules',transport:'memory fetch only; host fetch denied; no account module evaluation',passed:results.filter(x=>x.pass).length,total:results.length,results};if(reportFile)fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;
}
main().catch(()=>{console.error('Offline VM suite failed; private source and error details suppressed.');process.exitCode=1;});
