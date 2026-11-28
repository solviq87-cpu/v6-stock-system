'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {createFixture}=require('./helpers/v6-studio-fixture');
const {deepResearchHttp}=require('../src/server/deep-research-http');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const Store=require('../src/core/research-workspace-store');
const endpoint='/api/research/deep';
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');

function rawRequest(port,url,{method='GET',body='',headers={}}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:url,method,timeout:10000,
   headers:{...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...headers}},res=>{
   let raw='';res.on('data',b=>raw+=b);res.on('end',()=>{let data;try{data=JSON.parse(raw);}catch{}resolve({status:res.statusCode,body:data,raw,headers:res.headers});});
  });req.once('error',reject);req.once('timeout',()=>req.destroy(Error('deep HTTP fixture timeout')));req.end(body);
 });
}
function tree(root){
 if(!fs.existsSync(root))return {};
 const files={};function walk(dir){for(const name of fs.readdirSync(dir).sort()){
  const p=path.join(dir,name),st=fs.lstatSync(p);if(st.isDirectory())walk(p);else if(st.isFile())files[path.relative(root,p)]=digest(fs.readFileSync(p));
 }}walk(root);return files;
}
function assertDenied(response){
 assert.ok(response.status===403||response.body?.locked===true,JSON.stringify(response.body));
 assert.notEqual(response.body?.ok,true);assert.equal(response.body?.result,undefined);
}
function material(extra={}){
 const old=Date.now()-86400000;
 return {type:'events',revision:0,requestId:'deep_import_http_001',records:[{id:'declared-event-1',revision:1,
  source:'private-source-declaration',sourceUrl:'https://example.org/disclosure',publishedAt:old,firstKnownAt:old+1,recordedAt:old+2,
  symbol:'600000',eventType:'buyback',title:'隔离测试输入：回购进展',bodyScope:'declared-body'}],...extra};
}
async function invoke(options={}){
 const output={},body=options.rawBody??(options.input?JSON.stringify(options.input):'');
 const req={method:options.method||(options.input?'POST':'GET'),headers:{host:'localhost',...(options.headers||{})}};
 const res={writeHead(status,headers){output.status=status;output.headers=headers;},end(raw){output.body=JSON.parse(raw);}};
 await deepResearchHttp(req,res,{url:new URL('http://localhost'+(options.url||endpoint)),body,
  authenticate:options.authenticate||(()=>true),isReplica:options.isReplica||(()=>false),
  root:options.root,shortlineRoot:options.shortlineRoot,newsRoot:options.newsRoot,backgroundRoot:options.backgroundRoot,
  readSnapshot:options.readSnapshot||(async()=>({})),job:options.job||runWorkspaceJob,
  readAcceptance:options.readAcceptance||(async()=>({longTermAccepted:false})),clock:Date.now});
 return output;
}

test('real deep HTTP uses existing editor permissions, worker reports, private imports and original source clocks',{timeout:45000},async t=>{
 const f=await createFixture({count:1});t.after(()=>f.close());
 fs.copyFileSync(path.join(f.root,'config/deep-research-tasks.json'),path.join(f.tmp,'config/deep-research-tasks.json'));
 const root=path.join(f.tmp,'data/research-workspace'),newsRoot=path.join(f.tmp,'data/news-evidence'),shortlineRoot=path.join(f.tmp,'data/shortline-research');
 const now=Date.now(),receivedAt=now-20,publishedAt=now-86400000;
 require('../src/core/news-evidence-journal').appendBatch(newsRoot,[{schemaVersion:1,source:'isolated-http-declaration',
  eventId:'native-news-1',sourceRevisionId:'native-source-revision',kind:'original',supersedes:null,
  title:'隔离输入：回购公告',body:'仅供自动化测试的公告内容，未连接真实供应商。',bodyScope:'declared-body',
  securities:['600000'],url:'https://example.org/native-news',publishedAt,receivedAt,revisedAt:null}],{now});
 const note=await f.request('/api/research/shortline','POST',{action:'review:note',revision:0,
  payload:{date:new Date(now+28800000).toISOString().slice(0,10),kind:'annotation',text:'集成测试保留原短线档案'}});
 assert.equal(note.status,200,JSON.stringify(note.body));
 const originalNews=tree(newsRoot),originalArchive=tree(shortlineRoot),originalLedger=tree(path.join(f.tmp,'data/order-accounts'));

 for(const token of ['',f.viewerToken]){
  assertDenied(await f.request(endpoint,'GET',null,token));
  assertDenied(await f.request(endpoint+'/evidence','POST',material(),token));
 }
 let r=await f.request(endpoint);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.mode,'fayo-deep-research');
 assert.equal(r.body.result.sources.newsRevisions,1);assert.equal(r.body.result.sources.archiveAvailable,true);
 assert.equal(r.body.result.research.modules['67'].events[0].firstKnownAt,receivedAt);
 assert.equal(r.body.result.research.modules['67'].events[0].publishedAt,publishedAt);
 assert.equal(r.body.result.research.modules['67'].events[0].recordedAt,now);
 assert.equal(r.body.result.research.modules['67'].rows.length,0);assert.equal(r.body.result.research.modules['68'].status,'unknown');
 assert.equal(r.body.result.canTrade,false);assert.match(r.headers['cache-control'],/private.*no-store/);
 assert.equal(fs.existsSync(root),false,'GET must not initialize a research journal');

 const input=material(),started=Date.now();r=await f.request(endpoint+'/evidence','POST',input);
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.revision,1);
 const first=r.body.result,firstBytes=tree(root);assert.ok(first.recordedAt>=started&&first.recordedAt<=Date.now());
 const stored=Store.readEvents(root)[0].data.records[0];
 assert.equal(stored.firstKnownAt,first.recordedAt);assert.equal(stored.recordedAt,first.recordedAt);
 assert.equal(stored.declaredFirstKnownAt,input.records[0].firstKnownAt);assert.equal(stored.independentlyVerified,false);
 r=await f.request(endpoint+'/evidence','POST',input);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.result.reused,true);assert.equal(r.body.result.recordedAt,first.recordedAt);assert.deepEqual(tree(root),firstBytes);
 const changed=structuredClone(input);changed.records[0].title+='同ID不同内容';
 assert.equal((await f.request(endpoint+'/evidence','POST',changed)).status,409);
 assert.equal((await f.request(endpoint+'/evidence','POST',{...input,requestId:'deep_import_http_stale'})).status,409);
 r=await f.request(endpoint);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.revision,1);
 const imported=r.body.result.research.modules['67'].events.find(e=>e.id===input.records[0].id);
 assert.equal(imported.firstKnownAt,first.recordedAt);assert.equal(imported.publishedAt,input.records[0].publishedAt);
 assert.equal(r.body.result.research.modules['68'].rows.length,0);assert.equal(r.body.result.research.modules['69'].rows.length,0);
 assert.equal(r.body.result.research.modules['67'].policyStudy.status,'unknown');assert.equal(r.body.result.research.modules['68'].macroStudy.creditEconomicState.status,'unknown');assert.equal(r.body.result.research.modules['68'].macroStudy.margin.actualForcedLiquidationQuantity,null);
 assert.equal(r.body.result.research.modules['72'].rows.length,0);

 for(const query of ['?root=/etc','?now=1','?asOf=1','?accountId=foreign','?book=demo','?token='+f.token]){
  assert.equal((await f.request(endpoint+query)).status,400);
 }
 for(const [method,url]of [['POST',endpoint],['PUT',endpoint+'/evidence'],['GET',endpoint+'/evidence'],['POST',endpoint+'/acceptance']]){
  assert.equal((await f.request(url,method)).status,405);
 }
 assert.equal((await f.request(endpoint+'/not-real')).status,404);
 const headers={Authorization:'Bearer '+f.token};
 assert.equal((await rawRequest(f.port,endpoint,{headers:{...headers,'x-v6-research-book':'demo'}})).status,400);
 assert.equal((await rawRequest(f.port,endpoint+'/evidence',{method:'POST',body:JSON.stringify({...input,revision:1,requestId:'cross_origin_import'}),
  headers:{...headers,Origin:'https://other.example'}})).status,403);
 assert.equal((await f.request(endpoint+'/evidence','POST',{...input,revision:1,requestId:'secret_import_001',
  records:[{...input.records[0],sourceUrl:'https://example.org/?access_token=never-save'}]})).status,400);
 const override=await f.request(endpoint+'/evidence','POST',{...input,revision:1,requestId:'path_override_001',root:'/tmp/foreign'});
 assert.ok([400,409,422].includes(override.status),JSON.stringify(override.body));assert.equal(override.body.ok,false);
 assert.equal((await rawRequest(f.port,endpoint+'/evidence',{method:'POST',headers,body:'{"revision":1,"requestId":"prototype_import_001","__proto__":{"polluted":true}}'})).status,400);
 assert.equal(Object.prototype.polluted,undefined);assert.deepEqual(tree(root),firstBytes);

 r=await f.request(endpoint+'/acceptance');assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.result.observation.longTermAccepted,false);
 assert.deepEqual(r.body.result.observation.stages.map(s=>s.tradingDays),[5,20,60]);
 assert.ok(r.body.result.observation.stages.every(s=>s.passed===false&&s.completeObservationDays===0));
 assert.equal(fs.existsSync(path.join(shortlineRoot,'runtime-acceptance')),false,'reading acceptance cannot create an observation day');
 assert.deepEqual(tree(newsRoot),originalNews);assert.deepEqual(tree(shortlineRoot),originalArchive);assert.deepEqual(tree(path.join(f.tmp,'data/order-accounts')),originalLedger);
 const devices=await f.request('/api/lock/devices'),device=devices.body.items.find(x=>x.role==='edit'&&x.fp==='studio-fixture-admin');
 assert.ok(device);const revoked=await f.request('/api/lock/revoke','POST',{id:device.id});
 assert.equal(revoked.body.ok,true);assert.equal(revoked.body.revoked,1);
 assertDenied(await f.request(endpoint));assert.deepEqual(tree(root),firstBytes);
});

test('real HTTP freezes empty-account hold/cash alternatives, retries original intent and exposes read-only pending replay',{timeout:45000},async t=>{
 const f=await createFixture({count:1});t.after(()=>f.close());
 fs.copyFileSync(path.join(f.root,'config/deep-research-tasks.json'),path.join(f.tmp,'config/deep-research-tasks.json'));
 const root=path.join(f.tmp,'data/research-workspace'),newsRoot=path.join(f.tmp,'data/news-evidence'),shortlineRoot=path.join(f.tmp,'data/shortline-research');
 const originals={ledger:tree(path.join(f.tmp,'data/order-accounts')),news:tree(newsRoot),shortline:tree(shortlineRoot)};
 const input={revision:0,requestId:'deep_freeze_http_001',horizonDays:5,selectedId:'hold',alternatives:[
  {id:'hold',action:'hold',label:'继续持有',weights:[]},{id:'cash',action:'cash',label:'保持现金',weights:[]}
 ]};
 for(const token of ['',f.viewerToken])assertDenied(await f.request(endpoint+'/alternatives','POST',input,token));
 assert.equal(fs.existsSync(root),false);
 const started=Date.now();let r=await f.request(endpoint+'/alternatives','POST',input);
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.revision,1);
 const first=r.body.result,bytes=tree(root);assert.equal(first.task,undefined);
 assert.equal(first.type,'deep-decision-alternatives-v1');assert.equal(first.classification,'prospective');
 assert.equal(first.capital,100000);assert.equal(first.sourceSnapshot.account.cash,100000);
 assert.equal(first.sourceSnapshot.account.pendingOrders,0);assert.equal(first.sourceSnapshot.account.availableCash,100000);
 assert.deepEqual(first.sourceSnapshot.account.positions,[]);assert.deepEqual(first.sourceSnapshot.quotes,[]);
 assert.ok(first.recordedAt>=started&&first.recordedAt<=Date.now());
 assert.equal(first.freezeTime.serverReceivedAt,first.recordedAt);assert.equal(first.canTrade,false);
 assert.equal(first.sourceSnapshot.constraints.maxPositions,5);assert.equal(first.sourceSnapshot.costs.slippageBps,null);
 assert.equal(Store.readEvents(root).length,1);
 r=await f.request(endpoint+'/alternatives','POST',input);
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.id,first.id);assert.equal(r.body.result.reused,true);
 assert.deepEqual(r.body.result.sourceSnapshot,first.sourceSnapshot);assert.equal(r.body.result.recordedAt,first.recordedAt);
 assert.deepEqual(tree(root),bytes);

 // Exercise the actual HTTP adapter + worker with a now-unavailable account.
 // Retry must resolve immutable intent before constructing any new snapshot;
 // the authoritative ledger itself is deliberately left untouched.
 let snapshots=0;
 const unavailable=await invoke({root,newsRoot,shortlineRoot,input,url:endpoint+'/alternatives',
  readSnapshot:async()=>{snapshots++;return {account:null,quotes:{}};}});
 assert.equal(snapshots,1);assert.equal(unavailable.status,200,JSON.stringify(unavailable.body));
 assert.equal(unavailable.body.result.id,first.id);assert.equal(unavailable.body.result.reused,true);
 assert.deepEqual(unavailable.body.result.sourceSnapshot,first.sourceSnapshot);assert.deepEqual(tree(root),bytes);
 assert.equal((await f.request(endpoint+'/alternatives','POST',{...input,selectedId:'cash'})).status,409);
 assert.equal((await f.request(endpoint+'/alternatives','POST',{...input,requestId:'deep_freeze_stale_002'})).status,409);
 for(const extra of [{informationCutoff:1},{sourceSnapshot:{}},{accountRef:'foreign'},{capital:1000000},{root:'/tmp/elsewhere'}]){
  assert.equal((await f.request(endpoint+'/alternatives','POST',{...input,...extra})).status,400);
 }
 assert.deepEqual(tree(root),bytes);
 r=await f.request(endpoint);assert.equal(r.status,200,JSON.stringify(r.body));
 const alternatives=r.body.result.alternatives;
 assert.equal(alternatives.records.length,1);assert.equal(alternatives.records[0].id,first.id);
 assert.equal(alternatives.reviews.length,0);assert.equal(alternatives.replay.length,1);
 assert.equal(alternatives.replay[0].freezeId,first.id);assert.equal(alternatives.replay[0].readOnly,true);
 assert.equal(alternatives.replay[0].status,'pending');
 assert.ok(alternatives.replay[0].rows.every(row=>row.netPnl===null&&row.status==='pending'));
 assert.deepEqual(tree(root),bytes,'GET cannot append a review, restart a freeze or rewrite original source clocks');
 assert.deepEqual(tree(path.join(f.tmp,'data/order-accounts')),originals.ledger);
 assert.deepEqual(tree(newsRoot),originals.news);assert.deepEqual(tree(shortlineRoot),originals.shortline);
});

test('handler and worker freeze actual ledger holdings, exclude unrelated quotes and retry original hold weights',{timeout:15000},async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-deep-held-account-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const root=path.join(tmp,'workspace'),ledger=path.join(tmp,'accounts/pool.json');
 const {createPaperApplicationService}=require('../src/core/paper-application-service');
 const {deepAccountProjection}=require('../src/core/deep-research-workspace');
 const day=at=>new Date(at+28800000).toISOString().slice(0,10);
 let now=Date.now()-2*86400000;
 const service=createPaperApplicationService({file:ledger,clock:()=>now,calendar:{isOpen:()=>true}});
 service.initialize(100000);
 service.submit({orderId:'isolated-buy',side:'buy',symbol:'600000',quantity:100,limitPrice:10,tradeDate:day(now),strategyId:'fourteen'});
 service.fill('isolated-buy','isolated-fill',{symbol:'600000',timestamp:now,source:'simulated',tradeDate:day(now),price:10,
  suspended:false,tradable:true,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5});
 const original=tree(path.dirname(ledger)),book=service.read();
 let mark=10;
 const readSnapshot=async at=>{
  const quotes={'600000':{symbol:'600000',price:mark,quoteAt:at,receivedAt:at,quoteSource:'supplied-quotes'},
   '600999':{symbol:'600999',price:999,quoteAt:at-15001,receivedAt:at,quoteSource:'supplied-quotes'}};
  return {account:deepAccountProjection(book,quotes,{now:at,day:day(at)}),quotes,feePolicy:book.feePolicy,
   constraints:{version:'original-paper-policy',riskPolicy:book.riskPolicy,maxPositions:5}};
 };
 const input={revision:0,requestId:'holding_freeze_http_001',horizonDays:5,selectedId:'hold',alternatives:[
  {id:'hold',action:'hold',weights:[]},{id:'cash',action:'cash',weights:[]}
 ]};
 let r=await invoke({root,input,url:endpoint+'/alternatives',readSnapshot});
 assert.equal(r.status,200,JSON.stringify(r.body));const first=r.body.result,bytes=tree(root);
 assert.equal(first.sourceSnapshot.account.positions[0].quantity,100);
 assert.equal(first.sourceSnapshot.account.positions[0].availableQuantity,100);
 assert.deepEqual(first.sourceSnapshot.quotes.map(q=>q.symbol),['600000']);
 assert.equal(first.sourceSnapshot.quotes[0].price,10);
 assert.equal(first.alternatives[0].weights[0].weight,1000/first.capital);
 mark=20;r=await invoke({root,input,url:endpoint+'/alternatives',readSnapshot});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.reused,true);
 assert.equal(r.body.result.id,first.id);assert.deepEqual(r.body.result.alternatives,first.alternatives);
 assert.equal(r.body.result.sourceSnapshot.quotes[0].price,10);assert.equal(r.body.result.capital,first.capital);
 assert.deepEqual(tree(root),bytes);assert.deepEqual(tree(path.dirname(ledger)),original);
});

test('deep adapter rejects replica writes and parameter injection before private source work',async()=>{
 let reads=0,jobs=0;
 const dependencies={readSnapshot:async()=>{reads++;return {};},job:async()=>{jobs++;throw Error('should not start');}};
 const input=material();
 assert.equal((await invoke({...dependencies,input,url:endpoint+'/evidence',isReplica:()=>true})).status,409);
 assert.equal((await invoke({...dependencies,input,url:endpoint+'/evidence',authenticate:()=>false})).status,403);
 assert.equal((await invoke({...dependencies,url:endpoint+'?now=0'})).status,400);
 assert.equal((await invoke({...dependencies,url:endpoint,headers:{'x-v6-research-book':'book-1234567890123456'}})).status,400);
 assert.equal((await invoke({...dependencies,url:endpoint+'/evidence',method:'POST',rawBody:'x'.repeat(512*1024+1)})).status,413);
 assert.equal(reads,0);assert.equal(jobs,0);
 let replica=false;
 const changed=await invoke({...dependencies,input,url:endpoint+'/evidence',isReplica:()=>replica,
  readSnapshot:async()=>{replica=true;return {};}});assert.equal(changed.status,403);assert.equal(jobs,0);
});

test('real worker rechecks revocation at durable commit and never mutates existing evidence or ledger', {timeout:15000},async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-deep-revoke-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const root=path.join(tmp,'workspace'),shortlineRoot=path.join(tmp,'shortline'),newsRoot=path.join(tmp,'news');
 const ledger=path.join(tmp,'ledger-sentinel.json');fs.writeFileSync(ledger,'{"unchanged":"authoritative-account-sentinel"}');
 const first=await invoke({root,shortlineRoot,newsRoot,input:material(),url:endpoint+'/evidence'});
 assert.equal(first.status,200,JSON.stringify(first.body));const before=tree(root),ledgerBefore=fs.readFileSync(ledger);
 let authorized=true,checkpoints=0;
 const denied=await invoke({root,shortlineRoot,newsRoot,input:material({revision:1,requestId:'deep_revoke_at_commit_001'}),url:endpoint+'/evidence',
  authenticate:()=>authorized,job:(payload,{authorize})=>runWorkspaceJob(payload,{authorize:()=>{
   checkpoints++;if(checkpoints===4)authorized=false;return authorize();
  }})});
 assert.ok(checkpoints>=4,'the worker must request more than the initial permission');
 assert.equal(denied.status,403,JSON.stringify(denied.body));assert.deepEqual(tree(root),before);assert.deepEqual(fs.readFileSync(ledger),ledgerBefore);
 assert.equal(Store.readEvents(root).length,1);
});

test('revoked permission after worker/read completion does not disclose private report or acceptance',async()=>{
 let allowed=true;
 const read=await invoke({authenticate:()=>allowed,job:async()=>{allowed=false;return {ok:true,result:{private:'must-not-return'}};}});
 assert.equal(read.status,403);assert.equal(read.body.result,undefined);
 allowed=true;
 const acceptance=await invoke({url:endpoint+'/acceptance',authenticate:()=>allowed,readAcceptance:async()=>{allowed=false;return {private:'must-not-return'};}});
 assert.equal(acceptance.status,403);assert.equal(acceptance.body.result,undefined);
});

test('risk-center reuse preserves progressive levels, original evidence time and unknown action lifecycle',()=>{
 const {projectDeepRisks}=require('../src/core/deep-research-workspace');
 const {readResearchRiskCenter}=require('../src/core/research-risk-center');
 const now=Date.now(),raw=[1,2,3,4].map(level=>({id:'review-'+level,task:75,kind:'decision-fragility',level,
  target:'600000',observedAt:now-20000,evidence:{source:'original-research-report',knownAt:now-21000},
  triggerCondition:'固定条件',releaseCondition:'原始依据重新核对',currentRestriction:'保留原后台约束'}));
 const report={generatedAt:now,riskObservations:projectDeepRisks(raw,{now})};
 const result=readResearchRiskCenter({now:now+61001,deepResearch:report,
  readNews:()=>({mode:'news-evidence-readonly',canTrade:false,canNotify:false,rows:[],
   summary:{totalRevisions:0,currentEvents:0,retractedEvents:0,eligibleForResearchSupport:0,unknownEvents:0}})});
 const risks=result.deepResearch.observations;
 assert.deepEqual(risks.map(r=>r.level),['苗头','积累','触发','紧急防御']);
 assert.ok(risks.every(r=>r.dataAt===now-20000&&r.generatedAt===now&&r.stale===true));
 for(const item of risks){
  assert.equal(item.kind,'decision-fragility');assert.deepEqual(item.affected,['600000']);
  assert.deepEqual(item.evidence,raw[0].evidence);assert.equal(item.releaseCondition,raw[0].releaseCondition);
  assert.deepEqual(item.restrictions,[raw[0].currentRestriction]);assert.equal(item.status,'observed');
  assert.ok(Object.values(item.lifecycle).every(value=>value===null));assert.equal(item.canTrade,false);assert.equal(item.canNotify,false);
 }
});


test('configured background archive is read through the original authorized research worker, with no new archive or trade writes',{timeout:15000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-background-http-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'research'),shortlineRoot=path.join(dir,'shortline'),newsRoot=path.join(dir,'news'),backgroundRoot=path.join(dir,'background');
 const raw=Buffer.from(JSON.stringify([{pages:1},[{countryiso3code:'CHN',indicator:{id:'NY.GDP.MKTP.CD'},date:'2024',value:0}]]));
 const observedAt=Date.now()-100;const archived=require('../src/core/market-data-evidence').appendBackgroundReceipt({root:backgroundRoot,provider:'worldbank',
  scope:{country:'CHN',indicator:'NY.GDP.MKTP.CD',startYear:2024,endYear:2024},raw,byteBasis:'response-body',observedAt,requestStartedAt:observedAt-1});
 const dependencies={root,shortlineRoot,newsRoot,backgroundRoot};const before=tree(dir);
 const denied=await invoke({...dependencies,authenticate:()=>false});assert.equal(denied.status,403);assert.equal(denied.body.result,undefined);
 for(const query of ['?backgroundRoot=/private/foreign','?asOf=1'])assert.equal((await invoke({...dependencies,url:endpoint+query})).status,400);
 const r=await invoke(dependencies);assert.equal(r.status,200,JSON.stringify(r.body));const data=r.body.result;
 assert.equal(data.background.mode,'official-background-archive-overview');assert.equal(data.background.status,'available');
 assert.equal(data.background.rows[0].archiveHash,archived.hash);assert.equal(data.background.rows[0].records[0].value,0);assert.equal(data.background.rows[0].records[0].unit,null);
 assert.equal(data.canTrade,false);assert.equal(data.background.canTrade,false);assert.equal(data.background.verifiedExternal,false);
 assert.equal(data.research.modules['68'].status,'unknown','background statistics cannot become surprise estimates');
 assert.doesNotMatch(JSON.stringify(data),/fayo-background-http-/);assert.deepEqual(tree(dir),before);
 let allowed=true;const revoked=await invoke({...dependencies,authenticate:()=>allowed,job:async(payload,options)=>{const result=await runWorkspaceJob(payload,options);allowed=false;return result;}});
 assert.equal(revoked.status,403);assert.equal(revoked.body.result,undefined);assert.deepEqual(tree(dir),before);
});
