'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),L=require('../public/assets/learning-workbench');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 class Element extends EventTarget{
  constructor(tag='div'){super();this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.ownText='';}
  append(e){this.children.push(e);}replaceChildren(){this.children=[];this.ownText='';}
  set textContent(x){this.ownText=x;this.children=[];}get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
  setAttribute(k,v){this.attributes[k]=v;}
 }
 const elements=new Map(['learningRuntimeRead','learningModelProbe','learningRuntimeStatus','learningRuntimeSummary','learningWorkbench','learningRead','learningForce','learningLimit','learningStatus','learningSummary','learningDetails','token'].map(id=>[id,new Element()]));
 elements.get('learningLimit').value='30';elements.get('token').value='private-credential';
 const doc=new EventTarget();doc.hidden=false;doc.getElementById=id=>elements.get(id);doc.createElement=tag=>new Element(tag);
 const root=new EventTarget(),calls=[],timers=new Map();let timerId=0;root.document=doc;root.navigator={onLine:true};
 root.fetch=(url,options)=>{const d=deferred();calls.push({url,options,...d});return d.promise;};root.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;};root.clearTimeout=id=>timers.delete(id);
 Object.defineProperty(root,'localStorage',{get(){throw Error('storage is forbidden');}});
 const api=L.mount(root),get=id=>elements.get(id);
 const reply=(index,status,extra={})=>calls[index].resolve({ok:true,status:200,json:async()=>({ok:true,status,...extra})});
 return {root,doc,api,get,calls,timers,reply};
}
function status(overrides={}){return {counts:{total:18,live:10,matured:5,pending:3,invalid:2,backtest:4,posthoc:3,void:1},byType:{auction:{total:0,matured:0,pending:0,invalid:0},pool:{total:10,matured:5,pending:3,invalid:2}},operation:{state:'success',kind:'force',startedAt:1794562800000,finishedAt:1794562860000,beforeMatured:3,afterMatured:5,newOutcomes:2,attempted:4,fetched:3,error:null},...overrides};}
test('mount is inert; explicit buttons use GET versus bounded POST with credentials only in headers',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(L.mount(f.root),null);f.get('learningRead').dispatchEvent(new Event('click'));assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/learn-status');assert.equal(f.calls[0].options.method,'GET');assert.equal(f.calls[0].options.headers.Authorization,'Bearer private-credential');assert.equal(f.calls[0].options.body,undefined);assert.equal(f.calls[0].options.cache,'no-store');f.reply(0,status());await new Promise(resolve=>setImmediate(resolve));
 f.get('learningLimit').value='60';const p=f.api.request(true);assert.equal(f.calls[1].options.method,'POST');assert.deepEqual(JSON.parse(f.calls[1].options.body),{force:true,limit:60});assert.doesNotMatch(f.calls[1].options.body,/private-credential|seed/);f.reply(1,status());await p;
});
test('new force supersedes old deferred read; late body and finally cannot restore or unlock newer request',async()=>{
 const f=fixture(),oldBody=deferred();const first=f.api.request();f.calls[0].resolve({ok:true,status:200,json:()=>oldBody.promise});await Promise.resolve();const latest=f.api.request(true);await first;assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.get('learningForce').disabled,true);oldBody.resolve({ok:true,status:status({counts:{matured:999}})});await Promise.resolve();assert.equal(f.get('learningSummary').textContent,'');assert.equal(f.get('learningForce').disabled,true);f.reply(1,status());await latest;assert.match(f.get('learningSummary').textContent,/实盘有效已验5/);assert.doesNotMatch(f.get('learningSummary').textContent,/999/);
});
test('new read during force abandons client response but shows backend running and keeps read available',async()=>{
 const f=fixture(),force=f.api.request(true),read=f.api.request();await force;assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.get('learningRead').disabled,false);assert.equal(f.get('learningForce').disabled,true);f.reply(0,status({counts:{matured:999}}));f.reply(1,status({operation:{state:'running',kind:'force'}}));await read;assert.equal(f.get('learningForce').disabled,true);assert.match(f.get('learningStatus').textContent,/正在运行/);const again=f.api.request();assert.equal(f.get('learningForce').disabled,true);f.reply(2,status({operation:{state:'success'}}));await again;assert.equal(f.get('learningForce').disabled,false);
});
test('zero remains zero and malformed counts stay unknown; type scope and event metric are explicit',async()=>{
 const f=fixture(),p=f.api.request();f.reply(0,status({counts:{total:0,live:0,matured:-1,pending:'0',invalid:NaN,backtest:0,posthoc:undefined,void:0}}));await p;
 assert.match(f.get('learningSummary').textContent,/实盘有效已验未知实盘待回验未知实盘结果无效未知实盘登记总数0/);assert.match(f.get('learningDetails').textContent,/历史回测 \/ 事后样本：0 \/ 未知/);assert.match(f.get('learningDetails').textContent,/auction实盘总数：0有效已验：0/);assert.match(f.get('learningDetails').textContent,/次日最高涨幅是否达到3%/);assert.match(f.get('learningDetails').textContent,/事件命中不等于可交易收益/);assert.match(f.get('learningDetails').textContent,/版本：未知 \/ 未知 \/ 未知/);
});
for(const change of ['token','hidden','offline','pagehide'])test(change+' deactivation clears sensitive receipt and discards deferred reply',async()=>{
 const f=fixture(),p=f.api.request();f.reply(0,status());await p;assert.equal(f.get('learningSummary').hidden,false);const pending=f.api.request();
 if(change==='token'){f.get('token').value='other';f.get('token').dispatchEvent(new Event('input'));}else if(change==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}else if(change==='offline'){f.root.navigator.onLine=false;f.root.dispatchEvent(new Event('offline'));}else f.root.dispatchEvent(new Event('pagehide'));
 await pending;f.reply(1,status({counts:{matured:999}}));await Promise.resolve();assert.equal(f.get('learningSummary').textContent,'');assert.equal(f.get('learningDetails').textContent,'');assert.equal(f.get('learningSummary').hidden,true);assert.equal(f.calls[1].options.signal.aborted,true);
});
for(const denial of [401,403,'locked','needPassword'])test(String(denial)+' clears authentication even with non-JSON error body',async()=>{
 const f=fixture(),p=f.api.request();f.reply(0,status());await p;const pending=f.api.request();if(typeof denial==='number')f.calls[1].resolve({status:denial,ok:false,json:async()=>{throw Error('not JSON');}});else f.calls[1].resolve({status:200,ok:true,json:async()=>({ok:false,[denial]:true})});await pending;assert.equal(f.get('learningSummary').textContent,'');assert.equal(f.get('learningDetails').textContent,'');assert.match(f.get('learningStatus').textContent,/权限已失效/);
});
test('timeouts cover stalled JSON; force timeout requires reading server state before retry',async()=>{
 const f=fixture(),p=f.api.request(true);f.calls[0].resolve({ok:true,status:200,json:()=>deferred().promise});await Promise.resolve();const timer=[...f.timers.values()][0];assert.equal(timer.ms,60000);timer.fn();await p;assert.match(f.get('learningStatus').textContent,/服务端补验可能仍在继续/);assert.equal(f.get('learningForce').disabled,true);assert.equal(f.get('learningRead').disabled,false);await f.api.request(true);assert.equal(f.calls.length,1);const read=f.api.request();assert.equal([...f.timers.values()][0].ms,15000);f.reply(1,status({operation:{state:'idle'}}));await read;assert.equal(f.get('learningForce').disabled,false);
});
test('batch input and malformed payload reject safely; server busy permits read without automatic retry',async()=>{
 const f=fixture();for(const x of ['','0','61','1.5','abc']){f.get('learningLimit').value=x;await f.api.request(true);}assert.equal(f.calls.length,0);f.get('learningLimit').value='30';let p=f.api.request();f.reply(0,[]);await p;assert.match(f.get('learningStatus').textContent,/格式无效/);p=f.api.request(true);f.calls[1].resolve({ok:false,status:409,json:async()=>({ok:false,error:'学习任务正在运行'})});await p;assert.equal(f.get('learningForce').disabled,true);assert.equal(f.get('learningRead').disabled,false);assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
});

function runtime(overrides={}){return {schemaVersion:1,mode:'v6-learning-runtime-preflight',checkedAt:1794562800000,readOnly:true,researchOnly:true,canTrade:false,productionWeightsChanged:false,overall:'awaiting-model-probe',nextAction:'probe-local-model',configuration:{status:'configured'},model:{status:'not-probed',modelName:'test-model:v1',modelDigest:'a'.repeat(64),checkedAt:null,inferenceVerified:false},current:{status:'needs-data',nextAction:'await-independent-matured-h5-days',sourceDay:'2026-11-13',captureDays:2},lastRun:{status:'research-cycle-completed-not-certified',checkTime:1794562000000,sourceDay:'2026-11-12',captureDays:4,nextAction:'await-next-source-or-research-lineage'},...overrides};}
function replyRuntime(f,index,report){f.calls[index].resolve({ok:true,status:200,json:async()=>({ok:true,result:report})});}
test('runtime mounts without requests; explicit buttons use read-only GET and exact probe POST without query credentials',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
 f.get('learningRuntimeRead').dispatchEvent(new Event('click'));assert.equal(f.calls[0].url,'/api/research/learning-runtime');assert.equal(f.calls[0].options.method,'GET');assert.equal(f.calls[0].options.body,undefined);assert.equal(f.calls[0].options.headers.Authorization,'Bearer private-credential');assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(f.calls[0].options.cache,'no-store');replyRuntime(f,0,runtime());await new Promise(r=>setImmediate(r));
 f.get('learningModelProbe').dispatchEvent(new Event('click'));assert.equal(f.calls[1].options.method,'POST');assert.deepEqual(JSON.parse(f.calls[1].options.body),{probeModel:true});assert.equal(f.calls[1].options.headers['Content-Type'],'application/json');replyRuntime(f,1,runtime());await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
 for(const event of ['online','focus','pageshow'])f.root.dispatchEvent(new Event(event));f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.calls.length,2);
});
test('runtime current conditions and last record remain separate from each other and old outcome counts',async()=>{
 const f=fixture();let p=f.api.request();f.reply(0,status());await p;p=f.api.requestRuntime();replyRuntime(f,1,runtime());await p;
 assert.match(f.get('learningSummary').textContent,/实盘有效已验5/);const text=f.get('learningRuntimeSummary').textContent;assert.match(text,/当前运行条件条件：需要补充数据/);assert.match(text,/现有冻结天数：2/);assert.match(text,/上次记录记录状态：研究周期已记录，尚未认证/);assert.match(text,/记录冻结天数：4/);assert.match(text,/不能证明后台任务仍在运行/);assert.doesNotMatch(text,/实盘有效已验|H5.*[24]天/);
 p=f.api.request();f.reply(2,status());await p;assert.equal(f.get('learningRuntimeSummary').textContent,text);
});
test('verified model is only digest verification and cannot override an unconfigured task',async()=>{
 const f=fixture(),p=f.api.requestRuntime(true);replyRuntime(f,0,runtime({overall:'unconfigured',nextAction:'configure-private-research-agent',configuration:{status:'unconfigured'},current:{status:'unconfigured',nextAction:null,sourceDay:null,captureDays:null},lastRun:null,model:{status:'verified',modelName:'local:v1',modelDigest:'a'.repeat(64),checkedAt:1794562800000,inferenceVerified:false}}));await p;
 const text=f.get('learningRuntimeSummary').textContent;assert.match(text,/运行预检：尚未配置研究任务/);assert.match(text,/模型摘要已核对/);assert.match(text,/不代表推理或训练成功/);assert.match(text,/现有冻结天数：未知/);assert.match(text,/上次记录记录：暂无/);assert.doesNotMatch(text,/运行预检：具备研究预检条件|检查结果：推理成功|检查结果：训练成功|记录状态：正在运行/);
});
test('runtime safely maps enums, validates model fields and dates, and never prints arbitrary report data',async()=>{
 const f=fixture(),p=f.api.requestRuntime();replyRuntime(f,0,runtime({overall:'SECRET_UNKNOWN',nextAction:'SECRET_ACTION',checkedAt:9e18,configuration:{status:'toString'},model:{status:'__proto__',modelName:'http://secret?token=SECRET',modelDigest:'SECRET',checkedAt:'2026-11-13'},current:{status:'SECRET_STATUS',nextAction:'SECRET_CURRENT_ACTION',sourceDay:'2026-02-30',captureDays:'0'},lastRun:{status:'SECRET_LAST',checkTime:-1,sourceDay:'secret',captureDays:NaN,nextAction:'SECRET_LAST_ACTION',path:'/private/SECRET'},extra:'SECRET'}));await p;
 const text=f.get('learningRuntimeSummary').textContent;assert.doesNotMatch(text,/SECRET|2026-02-30|toString|__proto__|NaN|private/);assert.match(text,/运行预检：未知/);assert.match(text,/现有冻结天数：未知/);assert.match(text,/检查时间：未知/);
});
for(const [overall,label]of [['blocked','运行条件受阻'],['needs-data','需要补充研究数据'],['ready-for-research','具备研究预检条件'],['awaiting-model-probe','等待本地模型检查']])test('runtime overall '+overall+' is rendered from explicit current report',async()=>{
 const f=fixture(),p=f.api.requestRuntime();replyRuntime(f,0,runtime({overall}));await p;assert.match(f.get('learningRuntimeSummary').textContent,new RegExp(label));
});
test('a new runtime probe supersedes a stalled old learning JSON body without reviving counts',async()=>{
 const f=fixture(),body=deferred(),old=f.api.request();f.calls[0].resolve({ok:true,status:200,json:()=>body.promise});await Promise.resolve();const latest=f.api.requestRuntime(true);await old;assert.equal(f.calls[0].options.signal.aborted,true);replyRuntime(f,1,runtime());await latest;const text=f.get('learningRuntimeSummary').textContent;body.resolve({ok:true,status:status({counts:{matured:999}})});await new Promise(r=>setImmediate(r));assert.equal(f.get('learningSummary').textContent,'');assert.equal(f.get('learningRuntimeSummary').textContent,text);
});
test('a new learning read supersedes runtime JSON body and stale 403 fetch cannot clear new state',async()=>{
 const f=fixture(),body=deferred(),old=f.api.requestRuntime();f.calls[0].resolve({ok:true,status:200,json:()=>body.promise});await Promise.resolve();const latest=f.api.request();await old;f.reply(1,status());await latest;body.resolve({ok:true,result:runtime()});await new Promise(r=>setImmediate(r));assert.equal(f.get('learningRuntimeSummary').textContent,'');assert.match(f.get('learningSummary').textContent,/实盘有效已验5/);
 const stale=f.api.requestRuntime(),fresh=f.api.request();await stale;f.reply(3,status());await fresh;f.calls[2].resolve({ok:false,status:403,json:async()=>{throw Error('forbidden');}});await new Promise(r=>setImmediate(r));assert.match(f.get('learningSummary').textContent,/实盘有效已验5/);
});
test('runtime superseding force preserves backend uncertainty through timeout until an old-status read confirms idle',async()=>{
 const f=fixture(),force=f.api.request(true),probe=f.api.requestRuntime(true);await force;assert.equal(f.get('learningForce').disabled,true);assert.equal([...f.timers.values()].at(-1).ms,15000);[...f.timers.values()].at(-1).fn();await probe;assert.match(f.get('learningRuntimeStatus').textContent,/只读预检，不改变学习状态/);assert.equal(f.get('learningForce').disabled,true);await f.api.request(true);assert.equal(f.calls.length,2);
 const read=f.api.request();f.reply(2,status({operation:{state:'idle'}}));await read;assert.equal(f.get('learningForce').disabled,false);
});
for(const change of ['token','hidden','offline','pagehide','403','locked'])test('runtime '+change+' clears both private sections and blocks late JSON',async()=>{
 const f=fixture();let p=f.api.request();f.reply(0,status());await p;p=f.api.requestRuntime();replyRuntime(f,1,runtime());await p;assert.notEqual(f.get('learningRuntimeSummary').textContent,'');const body=deferred(),pending=f.api.requestRuntime(true);f.calls[2].resolve({ok:true,status:200,json:()=>body.promise});await Promise.resolve();
 if(change==='403'||change==='locked'){body.resolve(change==='locked'?{ok:false,locked:true}:{});if(change==='403'){const newer=f.api.requestRuntime();f.calls[3].resolve({ok:false,status:403,json:async()=>{throw Error('not JSON');}});await newer;}}
 else if(change==='token'){f.get('token').value='expired';f.get('token').dispatchEvent(new Event('change'));}
 else if(change==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}
 else if(change==='offline'){f.root.navigator.onLine=false;f.root.dispatchEvent(new Event('offline'));}
 else f.root.dispatchEvent(new Event('pagehide'));
 await pending;body.resolve({ok:true,result:runtime()});await new Promise(r=>setImmediate(r));assert.equal(f.get('learningSummary').textContent,'');assert.equal(f.get('learningDetails').textContent,'');assert.equal(f.get('learningRuntimeSummary').textContent,'');assert.equal(f.get('learningRuntimeSummary').hidden,true);assert.equal(f.calls.length,change==='403'?4:3);
});
test('a silently changed token rejects runtime response and malformed runtime safety flags fail closed',async()=>{
 const f=fixture(),pending=f.api.requestRuntime();f.get('token').value='expired-without-event';replyRuntime(f,0,runtime());await pending;assert.equal(f.get('learningRuntimeSummary').textContent,'');
 for(const override of [{canTrade:true},{readOnly:false},{schemaVersion:2},{productionWeightsChanged:true}]){const p=f.api.requestRuntime();replyRuntime(f,f.calls.length-1,runtime(override));await p;assert.equal(f.get('learningRuntimeSummary').textContent,'');assert.match(f.get('learningRuntimeStatus').textContent,/格式无效/);}
});
