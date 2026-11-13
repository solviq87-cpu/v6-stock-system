'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const html=fs.readFileSync(path.resolve(__dirname,'../../V6_WEB/workbuddy/index.html'),'utf8');
const ending="})(typeof window!=='undefined'?window:globalThis);",begin=html.indexOf("(function(root){\n'use strict';\nconst SOURCE="),end=html.indexOf(ending,begin);
assert.ok(begin>=0&&end>begin,'Deployed market module boundary missing');
const marketSource=html.slice(begin,end+ending.length),at=iso=>Date.parse(iso+'+08:00');
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function harness(iso='2026-11-13T09:45:00',storage=new Map(),latency=0){
 let now=at(iso),nextId=0;const timers=new Map(),calls=[],sessionEvents=[];
 const timeout=(fn,ms=0)=>{const id=++nextId;timers.set(id,{at:now+Math.max(0,Number(ms)||0),fn});return id;};
 const clear=id=>timers.delete(id);
 async function advance(target){const destination=typeof target==='number'?target:at(target);assert.ok(destination>=now);for(let n=0;n<50000;n++){await flush();const next=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next||next[1].at>destination){now=destination;await flush();return;}now=next[1].at;timers.delete(next[0]);next[1].fn();}throw Error('Unbounded virtual timer activity');}
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const c={Date:ClockDate,URL,TextEncoder,TextDecoder,AbortController,Response,Headers,setTimeout:timeout,clearTimeout:clear,document:{hidden:false},navigator:{locks:{request:async(name,opt,fn)=>{if(typeof opt==='function')fn=opt;return fn();}}},localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value))},console:{log(){},warn(){},error(){}}};
 c.fetch=(url,options={})=>new Promise((resolve,reject)=>{calls.push({url:String(url),at:now,aborted:false});const call=calls.at(-1);let finished=false;const abort=()=>{if(finished)return;finished=true;call.aborted=true;reject(Object.assign(Error('fixture aborted'),{name:'AbortError'}));};options.signal?.addEventListener('abort',abort,{once:true});timeout(()=>{if(finished)return;finished=true;options.signal?.removeEventListener('abort',abort);resolve(new Response('[]',{status:200}));},latency);});
 c.window=c;c.globalThis=c;vm.createContext(c,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(marketSource,c,{timeout:1000});c.V6Market.subscribeSession(event=>sessionEvents.push({at:now,...event}));
 return {c,api:c.V6Market,storage,calls,sessionEvents,advance,flush,get now(){return now;},jump(iso){now=at(iso);}};
}
function extractAppFunction(name,nextName){const a=html.indexOf('function '+name+'(');const b=html.indexOf('function '+nextName+'(',a);assert.ok(a>=0&&b>a);return html.slice(a,b);}
function installActualBoot(h){
 const c=h.c;Object.assign(c,{SHARE:'synthetic-offline-context',marketStarted:false,quoteTimer:null,fullScanTimer:null,battleTimer:null,battleController:null,marketError:'',refreshCount:0,scanCount:0,battleCount:0,classificationCount:0,acceptMarket(){},refreshMarket(){c.refreshCount++;},scanFullMarket(){c.scanCount++;},refreshClassifications(){c.classificationCount++;},scheduleBattleScan(){c.battleCount++;},updateMarketStatus(){}});
 vm.runInContext(extractAppFunction('marketScanAllowed','startMarket')+extractAppFunction('startMarket','pauseMarketCollection'),c);
 c.startMarket();
}

function lifecycle(h){
 const c=h.c,events={};c.addEventListener=(n,fn)=>events[n]=fn;c.document.addEventListener=c.addEventListener;
 Object.assign(c,{cloud:true,initialize(){},renderMarketSafely(){}});installActualBoot(h);
 const a=html.indexOf('function pauseMarketCollection('),b=html.indexOf('async function toggleMarketCollection(',a);
 vm.runInContext(html.slice(a,b),c);
 for(const name of ['online','offline','pageshow','visibilitychange']){
  const line=html.split('\n').find(s=>s.startsWith((name==='visibilitychange'?'document':'window')+".addEventListener('"+name+"',"));
  assert.ok(line);vm.runInContext(line,c);
 }
 return events;
}
test('independent devices restore foreground refresh once and retain manual pause',()=>{
 const phone=harness(),pc=harness(),p=lifecycle(phone),d=lifecycle(pc);
 pc.c.document.hidden=true;d.visibilitychange();assert.equal(phone.api.status.collectionEnabled,true);
 phone.c.document.hidden=true;p.visibilitychange();phone.c.document.hidden=false;p.visibilitychange();
 assert.equal(phone.c.refreshCount,2);p.pageshow();p.online();assert.equal(phone.c.refreshCount,2);
 phone.c.pauseMarketCollection();p.pageshow();p.online();assert.equal(phone.api.status.collectionRequested,false);
 assert.equal(JSON.parse(phone.storage.get('v6:scan-auto-preference:v1')).enabled,false);
 assert.equal(phone.calls.length+pc.calls.length,0);
});
test('offline stops transport; recovery needs connectivity, foreground and valid access',async()=>{
 const h=harness(),e=lifecycle(h);h.c.navigator.onLine=false;e.offline();
 assert.equal(h.api.status.collectionEnabled,false);await assert.rejects(h.api.publicFetch('https://qt.gtimg.cn/q=sh600000'));
 assert.throws(()=>h.api.resumeCollection());h.c.document.hidden=true;h.c.navigator.onLine=true;e.online();
 assert.equal(h.api.status.collectionRequested,false);h.c.document.hidden=false;e.visibilitychange();assert.equal(h.api.status.collectionEnabled,true);
 h.c.document.hidden=true;e.visibilitychange();h.c.SHARE='';h.c.document.hidden=false;e.visibilitychange();assert.equal(h.api.status.collectionRequested,false);
 assert.equal(h.calls.length,0);
});
test('foreground recovery preserves session and damaged-preference gates',()=>{
 for(const date of ['2026-11-13T15:12:00','2026-11-14T10:00:00','2027-01-04T10:00:00']){
  const h=harness(date),e=lifecycle(h);h.c.document.hidden=true;e.visibilitychange();h.c.document.hidden=false;e.visibilitychange();
  assert.equal(h.api.status.collectionEnabled,false);assert.equal(h.c.refreshCount,0);
 }
 const h=harness(),e=lifecycle(h);h.c.document.hidden=true;e.visibilitychange();h.storage.set('v6:scan-auto-preference:v1','broken');
 h.c.document.hidden=false;e.visibilitychange();assert.equal(h.api.status.collectionEnabled,false);
});
test('initially hidden or offline devices start when they become available',()=>{
 for(const kind of ['hidden','offline']){
  const h=harness();if(kind==='hidden')h.c.document.hidden=true;else h.c.navigator.onLine=false;
  const e=lifecycle(h);assert.equal(h.c.refreshCount,0);h.c.document.hidden=false;h.c.navigator.onLine=true;e.pageshow();assert.equal(h.c.refreshCount,1);
 }
});

test('scan scheduling calendar exactly matches the existing explicit 2026 repository calendar',()=>{
 const h=harness(),raw=fs.readFileSync(path.resolve(__dirname,'../config/research-calendar-2026.json')),calendar=JSON.parse(raw);
 assert.equal(h.api.scanCalendar.sha256,crypto.createHash('sha256').update(raw).digest('hex'));
 assert.equal(h.api.scanCalendar.days.length,365);
 for(const day of calendar.sessions)assert.equal(h.api.sessionAt(at(day.date+'T10:00:00')).open,day.open,day.date);
 assert.equal(h.api.scanCalendar.verifiedExternal,false);assert.equal(h.api.scanCalendar.tradeEligible,false);
});

for(const [time,kind,open]of [
 ['09:14:59.999','pre-open',false],['09:15:00','auction',true],['09:24:59.999','auction',true],['09:25:00','auction-break',false],['09:29:59.999','auction-break',false],['09:30:00','morning',true],['11:29:59.999','morning',true],['11:30:00','lunch',false],['12:59:59.999','lunch',false],['13:00:00','afternoon',true],['14:59:59.999','afternoon',true],['15:00:00','after-close',false],['15:12:00','after-close',false]
])test('Beijing session exact boundary '+time,()=>{const h=harness(),r=h.api.sessionAt(at('2026-11-13T'+time));assert.equal(r.kind,kind);assert.equal(r.open,open);assert.equal(r.date,'2026-11-13');assert.equal(r.timeZone,'Asia/Shanghai');});

for(const date of ['2026-11-14','2026-11-15','2026-10-01','2026-10-07','2026-02-23','2026-01-04','2026-10-10'])test('weekend, statutory closure and makeup weekend stay closed '+date,()=>{const h=harness();assert.equal(h.api.sessionAt(at(date+'T10:00:00')).open,false);});

test('unknown future calendar and invalid clocks fail closed',()=>{const h=harness();for(const date of ['2025-12-31','2027-01-04']){const r=h.api.sessionAt(at(date+'T10:00:00'));assert.equal(r.open,false);assert.equal(r.kind,'calendar-unknown');assert.equal(r.nextOpenAt,null);}assert.equal(h.api.sessionAt(NaN).open,false);assert.equal(h.api.sessionAt(Infinity).kind,'invalid-clock');});

test('previous and latest closed trade dates use the same explicit calendar',()=>{const h=harness();assert.equal(h.api.sessionAt(at('2026-11-16T10:00:00')).previousTradingDate,'2026-11-13');assert.equal(h.api.sessionAt(at('2026-10-08T10:00:00')).latestClosedDate,'2026-09-30');assert.equal(h.api.sessionAt(at('2026-11-13T15:00:00')).latestClosedDate,'2026-11-13');});

test('actual application boot enables first-time trading-session auto intent without any off-hours scan',async()=>{const h=harness('2026-11-13T09:14:59');installActualBoot(h);assert.equal(h.api.status.collectionRequested,true);assert.equal(h.api.status.collectionEnabled,false);assert.equal(h.c.scanCount,0);assert.equal(h.c.classificationCount,0);await h.advance('2026-11-13T09:15:00');assert.equal(h.api.status.collectionEnabled,true);assert.equal(h.c.scanCount,1);assert.equal(h.c.refreshCount,1);assert.equal(h.c.battleCount,1);assert.equal(h.c.classificationCount,1);assert.equal(h.calls.length,0,'Boot fixture must not emit external traffic');});

test('lunch and auction gaps keep requested auto intent and resume exactly at next open',async()=>{const h=harness('2026-11-13T09:24:59');h.api.initializeAutoCollection();await h.advance('2026-11-13T09:25:00');assert.equal(h.api.status.collectionEnabled,false);assert.equal(h.api.status.collectionRequested,true);await h.advance('2026-11-13T09:30:00');assert.equal(h.api.status.collectionEnabled,true);await h.advance('2026-11-13T11:30:00');assert.equal(h.api.status.collectionEnabled,false);await h.advance('2026-11-13T13:00:00');assert.equal(h.api.status.collectionEnabled,true);assert.deepEqual(h.sessionEvents.map(e=>e.collectionEnabled),[true,false,true,false,true]);});

test('manual pause persists across reload and market sessions until explicit continue',async()=>{const h=harness();h.api.initializeAutoCollection();h.api.pauseCollection();assert.equal(h.api.status.collectionRequested,false);const reloaded=harness('2026-11-16T10:00:00',h.storage);installActualBoot(reloaded);assert.equal(reloaded.api.status.collectionRequested,false);assert.equal(reloaded.c.scanCount,0);reloaded.api.resumeCollection();assert.equal(reloaded.api.status.collectionEnabled,true);assert.equal(reloaded.c.scanCount,1);});

test('hidden pause cannot be revived merely by returning to foreground or a later session',async()=>{const h=harness('2026-11-13T11:29:59');h.api.initializeAutoCollection();h.c.document.hidden=true;h.api.pauseCollection('后台页面已暂停');h.c.document.hidden=false;await h.advance('2026-11-13T13:00:01');assert.equal(h.api.status.collectionRequested,false);assert.equal(h.api.status.collectionEnabled,false);assert.throws(()=>{h.c.document.hidden=true;h.api.resumeCollection();},error=>error.code==='COLLECTION_PAUSED');});

test('15:00 cancels active and queued quote transport without reviving the queued request',async()=>{
 const h=harness('2026-11-13T14:59:59.500',new Map(),2000);h.api.initializeAutoCollection();const work=Promise.allSettled([h.api.publicFetch('https://qt.gtimg.cn/q=sh600000'),h.api.publicFetch('https://qt.gtimg.cn/q=sh600001')]);await h.flush();assert.equal(h.calls.length,1);await h.advance('2026-11-13T15:00:02');const settled=await work;assert.equal(h.calls.length,1);assert.equal(h.calls[0].aborted,true);assert.ok(settled.every(r=>r.status==='rejected'));assert.equal(h.api.status.collectionRequested,true);assert.equal(h.api.status.collectionEnabled,false);await h.advance('2026-11-16T09:15:01');assert.equal(h.calls.length,1,'Old queued request resumed after reopening');
});

test('an unchanged live quote body arriving after a clock jump is rejected before scan publication',async()=>{const h=harness('2026-11-13T14:59:59.500',new Map(),600);h.api.resumeCollection();const pending=h.api.publicFetch('https://qt.gtimg.cn/q=sh600000');await h.flush();h.jump('2026-11-13T15:00:00');await h.advance('2026-11-13T15:00:01');await assert.rejects(pending,error=>['MARKET_SESSION_CLOSED','COLLECTION_PAUSED'].includes(error.code));assert.equal(h.calls.length,1);});

test('closed-session forced quote/history requests are blocked while explicitly requested research remains bounded',async()=>{
 const h=harness('2026-11-13T15:12:00');h.api.initializeAutoCollection();await assert.rejects(h.api.refreshQuotes({force:true}),error=>error.code==='MARKET_SESSION_CLOSED');await assert.rejects(h.api.scanMarket({force:true}),error=>error.code==='MARKET_SESSION_CLOSED');await assert.rejects(h.api.loadSeries('600000',{force:true}),error=>error.code==='MARKET_SESSION_CLOSED');assert.equal(h.calls.length,0);
 const research=h.api.publicFetch('https://datacenter.eastmoney.com/api/data/v1/get?reportName=RPT_OFFLINE_FIXTURE');await h.advance('2026-11-13T15:12:00.001');assert.equal((await research).status,200);assert.equal(h.calls.length,1);
 h.api.pauseCollection();await assert.rejects(h.api.publicFetch('https://datacenter.eastmoney.com/api/data/v1/get'),error=>error.code==='COLLECTION_PAUSED');assert.equal(h.calls.length,1);
});

test('corrupt automatic preference refuses default startup instead of silently opting in',()=>{const h=harness();h.storage.set('v6:scan-auto-preference:v1','{"schemaVersion":1,"enabled":"yes"}');assert.throws(()=>h.api.initializeAutoCollection(),error=>error.code==='RATE_STATE_INVALID');assert.equal(h.api.status.collectionRequested,false);assert.equal(h.calls.length,0);});

test('actual automatic CPU scanner scheduling refuses closed sessions and discards post-close jobs',async()=>{
 const h=harness('2026-11-13T14:59:59');h.api.initializeAutoCollection();const c=h.c;let settle;
 Object.assign(c,{ready:true,battleDirty:false,battleLoading:false,battleTimer:null,battleController:null,battleResult:null,battleSignature:'',battleLastRun:0,battleError:'',battleResultStateKey:'',view:'home',busy:false,state:{},V6Battle:{scanAsync:()=>new Promise(resolve=>{settle=resolve;})},battleFingerprint:()=> 'fixture',battleStateKey:()=> 'state',battleSnapshot:()=>({}),shareBattleResult:()=>{throw Error('Late results must not be shared');},render(){},document:{hidden:false,activeElement:null}});
 const a=html.indexOf('function scheduleBattleScan('),b=html.indexOf('async function initializeBattle(',a);vm.runInContext(extractAppFunction('marketScanAllowed','startMarket')+html.slice(a,b),c);
 c.scheduleBattleScan(true);await h.advance('2026-11-13T14:59:59.001');assert.equal(c.battleLoading,true);await h.advance('2026-11-13T15:00:00');settle({status:'ready'});await h.flush();assert.equal(c.battleResult,null);assert.equal(c.battleLoading,false);c.scheduleBattleScan(true);assert.equal(c.battleTimer,null);
});


test('history cache targets and next data windows skip the entire National Day closure',()=>{
 const h=harness();
 const before=h.api.historyScheduleAt(at('2026-09-30T10:00:00'));
 assert.equal(before.targetDate,'2026-09-29');assert.equal(before.nextDataWindowAt,at('2026-10-08T09:15:00'));
 const after=h.api.historyScheduleAt(at('2026-10-08T10:00:00'));
 assert.equal(after.targetDate,'2026-09-30');assert.equal(after.nextDataWindowAt,at('2026-10-09T09:15:00'));
 assert.equal(h.api.historyScheduleAt(at('2026-10-08T15:29:59')).targetDate,'2026-09-30');
 assert.equal(h.api.historyScheduleAt(at('2026-10-08T15:30:00')).targetDate,'2026-10-08');
 assert.equal(h.api.historyScheduleAt(at('2026-10-01T10:00:00')).targetDate,'2026-09-30');
 assert.equal(h.api.historyScheduleAt(at('2027-01-04T10:00:00')).targetDate,null);
});

test('history data windows respect Spring Festival and the last supported calendar day',()=>{
 const h=harness();assert.equal(h.api.historyScheduleAt(at('2026-02-13T10:00:00')).nextDataWindowAt,at('2026-02-24T09:15:00'));
 assert.equal(h.api.historyScheduleAt(at('2026-02-24T10:00:00')).targetDate,'2026-02-13');
 assert.equal(h.api.historyScheduleAt(at('2026-12-31T10:00:00')).nextDataWindowAt,null);
});
