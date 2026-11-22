'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {shortlineHttp}=require('../src/server/shortline-http');
const store=import('../src/research/shortline/store.mjs');
const day='2024-03-01';
const defaultArrays=['bars','market','marketHistory','checks','notes','trades','plans','candidates','versions','corrections','checkins','explanations'];
const derived=['flatRecords','importBatches','importedLimitPools','manualLoopLinks','v6Observation','marketResearchAsOf','demoVersion'];
const gates=['训练集验证','时间外验证','样本外测试','成本压力校验','风险检查'];
function workspace(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shortline-preflight-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
async function harness(t){
 const root=workspace(t),{shortlineJob}=await store;
 async function get(book='main',extra={}){return shortlineJob({root,book,...extra});}
 async function post(book,action,payload={},overrides={}){
  const {state}=await get(book);
  return shortlineJob({root,book,input:{action,payload,revision:state.revision},...overrides});
 }
 return {root,get,post,shortlineJob};
}
function migratedTrades(){
 const trades=[];
 for(let d=0;d<50;d++){
  const date=new Date(Date.UTC(2024,0,2+d)).toISOString().slice(0,10);
  for(let k=0;k<4;k++)trades.push({id:'observed-'+d+'-'+k,date,code:'60000'+k,name:'集成样本',strategy:'趋势突破',trend:'多头',
   entryTime:date+'T09:32',exitTime:date+'T15:00',createdAt:date+'T07:01:00Z',entryPrice:10,exitPrice:k<2?10.2:9.8,
   cost:0,shares:100,position:5,exitReason:'按记录离场',pnl:k<2?2:-2,factors:[k<2?'形态共振':'形态失效'],snapshotVerified:true,repeatable:true});
 }
 return trades;
}
// A version-one existing archive is the public migration boundary. These records
// exist only under this test's temporary owner-only directory.
function writeLegacyTrades(root,trades){
 const state={scope:'live',revision:1,schemaVersion:1,researchOnly:true,canTrade:false,canNotify:false,...Object.fromEntries(defaultArrays.map(k=>[k,[]])),trades};
 const digest=createHash('sha256').update(JSON.stringify(state)).digest('hex');
 fs.writeFileSync(path.join(root,'research.json'),JSON.stringify({digest,state}),{mode:0o600});
}
test('首次读不建文件，主账户、命名账户和演示加载在独立持久档案，教学样本不回流正式视图',async t=>{
 const {root,get,post}=await harness(t);
 const main0=(await get()).state;
 assert.deepEqual(main0.books.map(b=>b.id),['main','demo']);assert.equal(main0.revision,0);assert.equal(main0.book.id,'main');
 for(const k of defaultArrays)assert.deepEqual(main0[k],[]);assert.equal(fs.existsSync(path.join(root,'research.json')),false);
 assert.equal((await get('main',{view:'home'})).result.totals.n,0);assert.equal(main0.catalog.length,95);
 const created=await post('main','book:create',{name:'独立复盘账户'}),id=created.result.id;
 assert.match(id,/^book-[0-9a-f]{16}$/);assert.equal((await get(id)).state.scope,'live');
 await assert.rejects(post('main','book:demo'),/独立演示库/);
 await assert.rejects(post(id,'book:demo'),/独立演示库/);
 await assert.rejects(get('book-0000000000000000'),e=>e.httpStatus===404);
 await assert.rejects(get('../main'),e=>e.httpStatus===400);
 await post('main','review:note',{date:day,kind:'annotation',text:'主档案专属记录'});
 const named=await post(id,'review:note',{date:day,kind:'annotation',text:'命名档案专属记录'});
 assert.equal(named.state.revision,1);assert.equal(named.state.notes.filter(r=>r.kind==='annotation').length,1);
 const demo=await post('demo','book:demo');assert.equal(demo.state.scope,'demo');assert.ok(demo.state.bars.length>100);
 assert.ok(demo.state.trades.length>5);assert.ok(demo.state.trades.every(r=>r.sampleSet==='test'));
 const second=await post('demo','book:demo');assert.equal(second.result.reused,true);assert.equal(second.state.trades.length,demo.state.trades.length);
 assert.ok((await get('demo',{view:'home',selection:'all'})).result.totals.n>0);
 assert.equal((await get('main',{view:'home',selection:'all'})).result.totals.n,0);
 assert.equal((await get(id,{view:'home',selection:'all'})).result.totals.n,0);
 const main=(await get()).state,book=(await get(id)).state;
 assert.ok(main.notes.some(r=>r.text==='主档案专属记录'));assert.ok(!main.notes.some(r=>r.text==='命名档案专属记录'));
 assert.ok(!book.notes.some(r=>r.text==='主档案专属记录'));assert.deepEqual(main.trades,[]);assert.deepEqual(book.bars,[]);
 for(const dir of [root,path.join(root,'books','demo'),path.join(root,'books',id)])assert.ok(fs.existsSync(path.join(dir,'research.json')));
});
test('清空操作绑定账户、保护开关、确认文字和版本；清除本账户行情及派生，可重新导入',async t=>{
 const {get,post,shortlineJob,root}=await harness(t);const {result:{id}}=await post('main','book:create',{name:'临时档'});
 await post('main','review:note',{date:day,kind:'annotation',text:'其他档案保留'});
 const csv='交易日,证券代码,证券名称,题材\n'+day+',600010,测试股票,原题材';
 await post(id,'import:ths',{kind:'pool',csv});
 await post(id,'import:ths',{kind:'kline',csv:'日期,代码,开盘价,最高价,最低价,收盘价,成交量\n'+day+',600010,10,11,9,10,100',priceBasis:'unadjusted',volumeUnit:'shares'});
 await post(id,'journal:flat',{start:day,end:day,template:'没有模式内机会',reason:'当日已收盘，没有标的达到标准',benchmark:'000985'});
 await post(id,'k:correct',{id:'stock/600010/日K/'+day,mode:'撤销信号',reason:'人工核对'});
 await post(id,'settings:profile-save',{name:'本账户自定义预设'});
 const ms=Date.parse(day+'T16:00:00+08:00'),code='600010';
 const minuteBars=Array.from({length:48},(_,i)=>{
  const n=(i<24?570:780)+(i%24+1)*5;
  const at=String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  return {date:day+' '+at,role:'stock',period:'5m',code,open:10,high:11,low:9,close:10,volume:100,amount:1000,source:'V6/eastmoney',knownAt:ms,availableAt:day+' 16:00'};
 });
 const snapshot={code,day,observedAtMs:ms,observedAt:day+' 16:00',latestClosed:false,latestClosedDay:day,stock:{code,name:'时间隔离样本'},bars:[],market:[],missing:[],evidence:[],minuteBars};
 const synced=await post(id,'v6:sync',{code,day},{snapshot});
 assert.equal(synced.state.v6Observation.minuteBars.length,48);
 const shards=path.join(root,'books',id,'minutes-v1');assert.ok(fs.existsSync(shards));
 const filled=await post(id,'check',{date:day,code:'600010'});assert.equal(filled.result.emotion.stage,'未判定');assert.equal(filled.result.position,0);
 const before=(await get(id)).state;
 for(const k of ['bars','checks','importedLimitPools','importBatches','flatRecords','corrections','notes'])assert.ok(before[k]?.length,k);
 const locked=await post(id,'book:lock',{locked:true});
 const reset={book:id,confirmation:'清空临时档'};
 await assert.rejects(post(id,'book:reset',reset),e=>e.httpStatus===422);
 assert.equal((await get(id)).state.revision,locked.state.revision);
 await post(id,'book:lock',{locked:false});
 for(const p of [{...reset,book:'main'},{...reset,confirmation:'清空主研究账户'},{...reset,confirmation:''}])await assert.rejects(post(id,'book:reset',p),e=>e.httpStatus===422);
 await assert.rejects(shortlineJob({root,book:id,input:{revision:locked.state.revision,action:'book:reset',payload:reset}}),e=>e.httpStatus===409);
 const result=await post(id,'book:reset',reset);assert.equal(result.result.reset,true);assert.equal(result.state.book.name,'临时档');
 assert.ok(Number.isSafeInteger(result.state.ledgerStartAt));assert.match(result.state.minuteGeneration,/^[\da-f-]{36}$/);
 for(const k of defaultArrays)assert.deepEqual(result.state[k],[],k);
 for(const k of derived)assert.ok(!result.state[k]||result.state[k].length===0,k);
 assert.ok((await get()).state.notes.some(n=>n.text==='其他档案保留'));
 assert.ok(!fs.existsSync(shards),'retired on-disk minute generation is removed');
 assert.equal(result.state.settingsProfiles[0].name,'本账户自定义预设');
 assert.equal((await get(id,{view:'home'})).result.totals.n,0);
 const after=await post(id,'import:ths',{kind:'pool',csv});assert.equal(after.result.count,1);assert.equal(after.state.importBatches.length,1);
});
test('五道验证由服务器计算，测试样本不进入正式候选，未审批不晋级；重置清空候选和已批准版本',async t=>{
 const {root,get,post}=await harness(t);const real=migratedTrades(),testOnly={...real[0],id:'teaching-only',pnl:999,factors:['教学独有'],sampleSet:'test'};
 writeLegacyTrades(root,[...real,testOnly]);
 const create=await post('main','learn:candidate',{status:'已晋级',weights:{'客户端伪造因子':999},steps:gates.map(name=>({name,status:'通过'}))});
 const c=create.result;assert.deepEqual(c.steps.map(r=>r.name),gates);assert.deepEqual(c.steps.map(r=>r.status),Array(5).fill('通过'));
 assert.equal(c.status,'待人工审批');assert.equal(create.state.versions.length,0);assert.ok(c.sourceIds.length>0);
 assert.ok(!c.sourceIds.includes(testOnly.id));assert.ok(!Object.hasOwn(c.weights,'教学独有'));assert.ok(!Object.hasOwn(c.weights,'客户端伪造因子'));
 const decision={id:c.id,reviewer:'测试编辑者',reason:'已逐项核对所有验证记录',decision:'approve'};
 const approved=await post('main','learn:decision',decision);assert.equal(approved.state.versions.length,1);
 assert.equal(approved.result.candidateId,c.id);assert.equal(approved.state.candidates[0].decision.authorizedRole,'edit');
 await assert.rejects(post('main','learn:decision',decision));
 assert.equal((await get('demo')).state.versions.length,0);
 await post('main','book:reset',{book:'main',confirmation:'清空主研究账户'});
 const empty=(await get()).state;assert.deepEqual(empty.candidates,[]);assert.deepEqual(empty.versions,[]);assert.deepEqual(empty.trades,[]);
 const failedRoot=workspace(t);writeLegacyTrades(failedRoot,real.map(x=>({...x,pnl:-2})));
 const {shortlineJob}=await store;const failed=await shortlineJob({root:failedRoot,input:{action:'learn:candidate',revision:1,payload:{}}});
 assert.equal(failed.result.steps[0].status,'未通过');assert.ok(failed.result.steps.slice(1).every(s=>s.status==='未运行'));
 await assert.rejects(shortlineJob({root:failedRoot,input:{action:'learn:decision',revision:failed.state.revision,payload:{...decision,id:failed.result.id}}}),e=>e.httpStatus===422);
});
test('HTTP 权限先于供数，观察者和副本无私有写入，来源不可用仅返回未判定且不生成档案',async t=>{
 const root=workspace(t),{shortlineJob}=await store,endpoint='/api/research/shortline',writes={source:0,job:0};
 const request={revision:0,action:'v6:sync',payload:{code:'600010',day}};
 async function send({method='POST',role='edit',book='main',replica=false,query='',headers={},payload=request,readSource}={}){
  const req={method,headers:{host:'localhost',authorization:'Bearer integration-token','x-v6-research-book':book,...headers}},result={};
  const response={writeHead:(status,values)=>Object.assign(result,{status,headers:values}),end:v=>{result.body=JSON.parse(v);}};
  const authenticate=typeof role==='function'?role:(token=>token==='integration-token'?role:null);
  await shortlineHttp(req,response,{url:new URL('http://localhost'+endpoint+query),body:method==='GET'?'':JSON.stringify(payload),
   authenticate,isReplica:()=>replica,root,
   readSource:async input=>{writes.source++;if(readSource)return readSource(input);throw Error('隔离环境行情不可用');},
   job:async params=>{writes.job++;try{return await shortlineJob(params);}catch(e){return {ok:false,httpStatus:e.httpStatus||422,error:e.message};}}});
  return result;
 }
 for(const [options,code] of [[{role:'view'},403],[{role:null},403],[{replica:true},409],[{book:'demo'},422],[{headers:{origin:'https://invalid.test'}},403],[{query:'?book=main'},400],[{book:'../main'},400]]){
  const r=await send(options);assert.equal(r.status,code);assert.equal(r.body.state,undefined);
 }
 assert.deepEqual(writes,{source:0,job:0});
 const compact=await send({method:'GET'});assert.equal(compact.status,200);assert.equal(compact.body.state.revision,0);
 assert.match(compact.headers['Cache-Control'],/private.*no-store/);
 const cached=await send({method:'GET',headers:{'x-v6-factor-version':compact.body.state.dictionaryVersion}});
 assert.equal(cached.body.state.catalog,undefined);assert.equal(cached.body.state.dictionaryVersion,compact.body.state.dictionaryVersion);
 const degraded=await send();assert.equal(degraded.status,200);const {result,state}=degraded.body;
 assert.equal(result.degraded,true);assert.equal(result.emotion.stage,'未判定');assert.equal(result.emotion.confidence,0);assert.deepEqual(result.missing,['原始行情本次未能核实']);
 assert.equal(result.position,0);assert.equal(state.revision,0);assert.equal(state.checks.length,0);assert.ok(!fs.existsSync(path.join(root,'research.json')));
 const calls=writes.job;
 for(const mismatch of [{day:'2024-03-04',code:'600010'},{day,code:'600011'}]){
  const wrong=await send({readSource:()=>mismatch});assert.equal(wrong.status,422);assert.equal(writes.job,calls);
 }
 let allowed=true;
 const revoked=await send({role:()=>allowed?'edit':null,readSource(){allowed=false;throw Error('source unavailable');}});
 assert.equal(revoked.status,403);assert.equal(writes.job,calls);
 const demo=await send({method:'GET',book:'demo',replica:true});assert.equal(demo.body.state.permissions.canWrite,false);
});
