'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{performance}=require('node:perf_hooks'),{spawnSync}=require('node:child_process');
const J=require('../src/core/news-evidence-journal'),source=fs.readFileSync(require.resolve('../server.js'),'utf8'),baseDir=path.resolve(__dirname,'..');
function section(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'news-current-')),root=path.join(dir,'private');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=Date.now(),batch=[],reads=0,inventories=0,stats=0,pushes=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const countedFs=new Proxy(fs,{get(target,key){if(key==='lstatSync')return (...args)=>{stats++;return fs.lstatSync(...args);};if(key==='readdirSync')return (...args)=>{inventories++;return fs.readdirSync(...args);};return target[key];}});
 const journal={...J,readJournal:(...args)=>{reads++;return J.readJournal(...args);}};
 const c=vm.createContext({Date:Clock,fs:countedFs,path,__dirname:baseDir,process:{env:{V6_NEWS_EVIDENCE_DIR:root}},
  require:m=>m==='./src/core/news-evidence-journal'?journal:m.startsWith('./')?require(path.resolve(baseDir,m)):require(m),
  S:{stocks:[],sectors:[],news:{good:[],bad:[],goodAll:[],badAll:[],neutralAll:[],goodCodes:new Set(),badCodes:new Set(),badSectors:new Set(),goodPushed:new Set(),holidayBuf:[]}},
  HOLIDAY_BUF_CAP:1200,NEWS_ARCHIVE_CAP:300,within3Days:()=>true,isTradeDay:()=>false,isTradingTime:()=>false,
  fetchNewsPage:async()=>({data:{fastNewsList:batch}}),ensureSectorStocks:async()=>{},saveNews(){},pushAll(){pushes++;},console:{log(){},warn(){},error(message,error){throw Error(message+' '+error);}}});
 vm.runInContext(section('const NEWS_EVIDENCE_ROOT=','const HOLIDAY_BUF_CAP'),c);
 vm.runInContext(section('const NEWS_BAD_KW =','function saveNews()'),c);
 vm.runInContext(section('function classifyNews(','async function fetchNewsPage('),c);
 vm.runInContext(section('async function refreshNews()','// 每日新闻汇总'),c);
 const raw=(patch={})=>({code:'event-1',title:'利好中标',summary:'原始摘要',showTime:new Date(clock-10000).toISOString(),stockList:['0.000001'],...patch});
 return {c,root,raw,now:()=>clock,refresh:async rows=>{batch=rows;await c.refreshNews();},advance:ms=>{clock+=ms;},counts:()=>({reads,inventories,stats,pushes}),reset:()=>{reads=0;inventories=0;stats=0;}};
}
test('actual refresh replaces the current category and cannot revive an old positive after retraction',async t=>{
 const x=fixture(t),original=x.raw();await x.refresh([original]);
 assert.equal(x.c.newsSupportsCode('000001'),true);assert.equal(x.c.S.news.goodAll.length,1);
 const first=fs.readFileSync(path.join(x.root,'000001.json')),firstItem=JSON.parse(JSON.stringify(x.c.S.news.goodAll[0]));
 await x.refresh([{...original,title:'利空解除合同',summary:'修订为负面'}]);
 assert.equal(x.c.S.news.goodAll.length,0);assert.equal(x.c.S.news.badAll.length,1);assert.equal(x.c.S.news.holidayBuf[0].type,'bad');
 assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsEvidenceAllowsItem(firstItem),false);
 const bad=x.c.S.news.badAll[0],second=fs.readFileSync(path.join(x.root,'000002.json'));
 assert.notEqual(bad.newsEvidence.eventHash,firstItem.newsEvidence.eventHash);assert.equal(bad.newsEvidence.sequence,2);
 await x.refresh([{...original,title:'已撤稿',retracted:true}]);
 assert.equal(x.c.S.news.goodAll.length,0);assert.equal(x.c.S.news.badAll.length,0);assert.equal(x.c.S.news.holidayBuf.length,0);
 await x.refresh([original]);
 assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsEvidenceAllowsItem(firstItem),false);
 assert.equal(J.readJournal(x.root).length,3);assert.deepEqual(fs.readFileSync(path.join(x.root,'000001.json')),first);assert.deepEqual(fs.readFileSync(path.join(x.root,'000002.json')),second);
 assert.equal(x.counts().pushes,0,'the real refresh runs with no external dispatch');
});
test('same-category and security revisions replace prior projections rather than accumulating old references',async t=>{
 const x=fixture(t),original=x.raw();await x.refresh([original]);
 await x.refresh([{...original,title:'利好获批',summary:'新摘要',stockList:['1.600000']}]);
 assert.equal(x.c.S.news.goodAll.length,1);assert.equal(x.c.S.news.goodAll[0].title,'利好获批');
 assert.deepEqual([...x.c.S.news.goodCodes],['600000']);assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsSupportsCode('600000'),true);
 await x.refresh([{...original,title:'例行信息',summary:'一般事项',stockList:['1.600000']}]);
 assert.equal(x.c.S.news.goodAll.length,0);assert.equal(x.c.S.news.neutralAll.length,1);assert.equal(x.c.S.news.holidayBuf[0].type,'neutral');
});
test('referenced existing-file corruption and permission changes invalidate a warm cache immediately',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);assert.equal(x.c.newsSupportsCode('000001'),true);
 const file=path.join(x.root,'000001.json'),bytes=fs.readFileSync(file),stamp=fs.statSync(x.root).mtimeMs,record=JSON.parse(bytes);
 record.evidence.title='篡改标题';fs.writeFileSync(file,JSON.stringify(record));
 assert.equal(fs.statSync(x.root).mtimeMs,stamp);assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsEvidenceCurrent().unknown,true);
 assert.equal(x.c.newsEvidenceVisibleState().news.goodAll.length,0);assert.throws(()=>J.readJournal(x.root),/INTEGRITY/);
 fs.writeFileSync(file,bytes);x.advance(1001);assert.equal(x.c.newsSupportsCode('000001'),true);
 fs.chmodSync(file,0o644);assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsEvidenceCurrent().unknown,true);
});
test('unreferenced mutation has a bounded one-second metadata audit window; append revocation is immediate',async t=>{
 const x=fixture(t),one=x.raw(),two=x.raw({code:'other',stockList:['1.600000']});await x.refresh([one,two]);
 const before=x.c.newsEvidenceCurrent(),file=path.join(x.root,'000002.json'),bytes=fs.readFileSync(file);
 fs.writeFileSync(file,'{}');assert.equal(x.c.newsSupportsCode('000001'),true,'another event is outside this referenced-version check');
 x.advance(1000);assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsEvidenceCurrent().unknown,true);
 fs.writeFileSync(file,bytes);x.advance(1001);assert.equal(x.c.newsSupportsCode('000001'),true);
 const after=x.c.newsEvidenceCurrent();assert.ok(after.chainVerifiedAt>before.chainVerifiedAt);assert.ok(after.metadataCheckedAt>=after.chainVerifiedAt);
 const current=J.readJournal(x.root).find(e=>e.evidence.eventId==='event-1');
 J.appendBatch(x.root,[{schemaVersion:1,...Object.fromEntries(Object.entries(current.evidence).filter(([k])=>!['bodyHash','uncertainty'].includes(k))),
  sourceRevisionId:'withdrawal-cli',kind:'retracted',supersedes:current.eventHash,receivedAt:Date.now()}]);
 assert.equal(x.c.newsSupportsCode('000001'),false,'directory mutation bypasses the audit interval');
});
test('unbound legacy cache and failed intake cannot retain positive support',async t=>{
 const x=fixture(t),legacy={id:'event-1',title:'利好中标',codes:['000001'],sectors:[]};
 x.c.S.news.goodAll=[legacy];x.c.S.news.goodCodes.add('000001');assert.equal(x.c.newsSupportsCode('000001'),false);
 await x.refresh([x.raw()]);assert.equal(x.c.newsSupportsCode('000001'),true);
 x.c.S.news.evidenceIntake={status:'unknown'};assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsEvidenceVisibleState().news.goodCodes.size,0);
});
test('current raw content must match the classified cache even when the version hash remains intact',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);const item=x.c.S.news.goodAll[0],original=JSON.parse(JSON.stringify(item));
 for(const change of [{title:'利好假标题'},{summary:'假摘要'},{codes:['600000']},{publishedAt:null}]){
  Object.assign(item,original,change);assert.equal(x.c.newsEvidenceAllowsItem(item),false);
 }
 Object.assign(item,original);assert.equal(x.c.newsEvidenceAllowsItem(item),true);
});
test('real CLI retraction changes actual pre-buy filtering without a network refresh or stale negative flags',async t=>{
 const x=fixture(t);x.c.S.sectors=[{name:'示例板块'}];await x.refresh([x.raw({title:'利空示例板块'})]);
 Object.assign(x.c,{A:{isLimitUp:()=>false},numNeutral:(_kind,v)=>v,numGapRaw:()=>5});
 vm.runInContext(section('function analyzePreBuy(','// ---------------- 外围联动'),x.c);
 const candidate={code:'000001',name:'示例',prob:80,mainInflow:100,pct:0};
 assert.equal(x.c.S.news.badCodes.has('000001'),true);assert.equal(x.c.newsWarnsSector('示例板块'),true);assert.equal(x.c.analyzePreBuy([candidate]).length,0);
 const current=J.readJournal(x.root)[0],input=path.join(path.dirname(x.root),'withdrawal.json');
 fs.writeFileSync(input,JSON.stringify({...Object.fromEntries(Object.entries(current.evidence).filter(([k])=>!['bodyHash','uncertainty'].includes(k))),
  sourceRevisionId:'real-cli-withdrawal',kind:'retracted',supersedes:current.eventHash,receivedAt:Date.now()}),{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(baseDir,'scripts/news-evidence.js'),'import',input],{env:{...process.env,V6_NEWS_EVIDENCE_DIR:x.root},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).results.length,1);
 assert.equal(x.c.S.news.badCodes.has('000001'),true,'the legacy collection deliberately remains stale for this causal regression');
 assert.equal(x.c.newsWarnsCode('000001'),false);assert.equal(x.c.newsWarnsSector('示例板块'),false);assert.equal(x.c.analyzePreBuy([candidate]).length,1);
 assert.equal(x.counts().pushes,0);t.diagnostic('actual CLI append: pre-buy excluded before withdrawal, admitted after withdrawal; no refresh or external dispatch');
});
for(const count of [100,1000])test('bounded cache cost with '+count+' journal rows and 6000 actual support checks',async t=>{
 const x=fixture(t),rows=Array.from({length:count},(_,i)=>x.raw({code:'event-'+i}));
 J.captureProviderBatch(x.root,rows);x.c.S.news.goodAll=x.c.classifyNews([rows[0]],new Map());x.c.S.news.goodCodes.add('000001');
 x.reset();const start=performance.now();for(let i=0;i<6000;i++)assert.equal(x.c.newsSupportsCode('000001'),true);const elapsedMs=performance.now()-start,counts=x.counts();
 assert.equal(counts.reads,0,'classification already verified the unchanged full chain');assert.equal(counts.inventories,0,'one hot referenced version is checked without rescanning all file metadata');
 assert.ok(counts.stats<=6000*3+2,'metadata operations grow with references, not archive size');
 t.diagnostic(JSON.stringify({journalRows:count,supportChecks:6000,elapsedMs:+elapsedMs.toFixed(2),...counts}));
});
test('full body negative overrides a positive title and the 90-character display excerpt',async t=>{
 const x=fixture(t),body='项目进展说明。'.repeat(20)+'公司收到监管函';
 await x.refresh([x.raw({title:'公司中标项目',summary:body})]);
 const item=x.c.S.news.badAll[0];assert.ok(item);assert.equal(item.summary.length,90);
 assert.doesNotMatch(item.summary,/监管函/);assert.match(item.why,/监管函/);
 assert.equal(x.c.newsWarnsCode('000001'),true);assert.equal(x.c.newsSupportsCode('000001'),false);
 assert.equal(J.readJournal(x.root)[0].evidence.body,body);
 item.type='good';assert.equal(x.c.newsEvidenceAllowsItem(item),false,'a matching evidence hash cannot endorse a forged classification');
});
test('source time expires positive, negative and sector decisions without a provider refresh; holiday history survives',async t=>{
 const x=fixture(t);x.c.S.sectors=[{name:'示例板块'}];
 await x.refresh([x.raw(),x.raw({code:'bad',title:'示例板块公司收到监管函',stockList:['1.600000']})]);
 assert.equal(x.c.newsSupportsCode('000001'),true);assert.equal(x.c.newsWarnsCode('600000'),true);
 x.advance(3*86400000);
 assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsWarnsCode('600000'),false);assert.equal(x.c.newsWarnsSector('示例板块'),false);
 vm.runInContext(section('function newsTitlesFor(',"S.pre = S.pre ||"),x.c);
 assert.equal(x.c.newsTitlesFor('000001','').good.length,0);assert.equal(x.c.newsTitlesFor('600000','').bad.length,0);
 const visible=x.c.newsEvidenceVisibleState().news;
 assert.equal(visible.goodAll.length,0);assert.equal(visible.badAll.length,0);assert.equal(visible.holidayBuf.length,2);
 assert.equal(x.c.S.news.goodAll.length,1,'read-side expiry does not delete source history');
});
test('missing source time and future relative to the consumer clock cannot affect a candidate',async t=>{
 const x=fixture(t);await x.refresh([x.raw({showTime:null})]);
 assert.equal(x.c.S.news.goodAll[0].publishedAt,null);assert.equal(x.c.newsSupportsCode('000001'),false);
 await x.refresh([x.raw({code:'known'})]);assert.equal(x.c.newsSupportsCode('000001'),true);
 x.advance(-20000);assert.equal(x.c.newsSupportsCode('000001'),false);
});
test('startup repairs both sentiment directions from full evidence including holiday history without rewriting source',async t=>{
 const x=fixture(t);
 await x.refresh([x.raw({title:'公司中标',summary:'进展。'.repeat(50)+'公司收到监管函'}),x.raw({code:'relief',title:'股东终止减持计划'})]);
 const bad=x.c.S.news.badAll[0],neutral=x.c.S.news.neutralAll[0];
 const original=fs.readFileSync(path.join(x.root,'000001.json'));
 x.c.S.news.goodAll=[{...bad,type:'good',why:'旧利好'}];
 x.c.S.news.badAll=[{...neutral,type:'bad',why:'旧利空'}];x.c.S.news.neutralAll=[];
 x.c.S.news.holidayBuf=[...x.c.S.news.goodAll,...x.c.S.news.badAll];x.c.S.news.goodPushed.add(bad.id);
 vm.runInContext(section('function repairNewsClassify()','function within3Days('),x.c);x.c.repairNewsClassify();
 assert.equal(x.c.S.news.goodAll.length,0);assert.equal(x.c.S.news.badAll[0].id,bad.id);assert.equal(x.c.S.news.neutralAll[0].id,neutral.id);
 assert.equal(x.c.S.news.badAll[0].type,'bad');assert.equal(x.c.S.news.holidayBuf.find(n=>n.id===neutral.id).type,'neutral');
 assert.equal(x.c.S.news.goodPushed.has(bad.id),false);assert.deepEqual(fs.readFileSync(path.join(x.root,'000001.json')),original);
 const after=JSON.stringify(x.c.S.news);x.c.repairNewsClassify();assert.equal(JSON.stringify(x.c.S.news),after);
});
test('seed retains successful pages when one column fails and bounds repeated pagination cursors',async t=>{
 const x=fixture(t),calls=[];
 x.c.em={delay:async()=>{}};
 x.c.fetchNewsPage=async(col,cursor)=>{calls.push([col,cursor]);if(col===101)throw Error('offline fixture');return {data:{fastNewsList:[x.raw()],sortEnd:'same-cursor'}};};
 vm.runInContext(section('async function seedNews()','// 增量刷新'),x.c);await x.c.seedNews();
 assert.equal(x.c.S.news.goodAll.length,1);assert.equal(x.c.newsSupportsCode('000001'),true);
 assert.equal(calls.filter(([col])=>col===104).length,2);assert.equal(J.readJournal(x.root).length,1);assert.equal(x.counts().pushes,0);
 const before=JSON.stringify(x.c.S.news.goodAll);x.c.fetchNewsPage=async()=>{throw Error('both offline');};await x.c.seedNews();
 assert.equal(JSON.stringify(x.c.S.news.goodAll),before);
});
test('incremental collection tolerates a failed/malformed column and retains prior evidence on all-failed',async t=>{
 const x=fixture(t);let failed=false;
 x.c.fetchNewsPage=async col=>{if(failed||col===101)throw Error('offline');return {data:{fastNewsList:[x.raw()]}};};
 await x.c.refreshNews();assert.equal(x.c.newsSupportsCode('000001'),true);
 failed=true;await x.c.refreshNews();assert.equal(x.c.S.news.goodAll.length,1);
 x.c.fetchNewsPage=async()=>({data:{fastNewsList:{unexpected:true}}});await x.c.refreshNews();
 assert.equal(x.c.S.news.goodAll.length,1);assert.equal(J.readJournal(x.root).length,1);
});
test('wrong archive category never turns a current negative into a positive and unbound history survives repair',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'公司收到监管函'})]);
 const row=x.c.S.news.badAll[0];x.c.S.news.goodAll=[row];
 assert.equal(x.c.newsSupportsCode('000001'),false);assert.equal(x.c.newsEvidenceVisibleState().news.goodAll.length,0);
 const legacy={id:'old-unbound',type:'good',title:'旧记录',summary:'',codes:[],sectors:[],t:x.raw().showTime};
 x.c.S.news.goodAll=[legacy];
 vm.runInContext(section('function repairNewsClassify()','function within3Days('),x.c);x.c.repairNewsClassify();
 assert.equal(x.c.S.news.goodAll[0].id,legacy.id);assert.equal(x.c.newsEvidenceAllowsItem(legacy),false);
});
test('actual three-day archive helper is invariant to UTC, Shanghai, Tokyo and New York host zones',()=>{
 const body=section('function within3Days(','// 板块') ;
 const now=Date.parse('2026-11-13T00:00:00+08:00');
 const code=`const fs=require('fs'),vm=require('vm'),path=require('path');const requireServer=require('module').createRequire(${JSON.stringify(path.join(baseDir,'server.js'))});const c=vm.createContext({require:requireServer,Date:class extends Date{static now(){return ${now}}}});vm.runInContext(${JSON.stringify(body)},c);console.log(JSON.stringify(['2026-11-11 00:00:00','2026-11-10 23:59:59','2026-11-13 00:00:01','2026-02-30 00:00:00',null].map(t=>c.within3Days(t))));`;
 for(const TZ of ['UTC','Asia/Shanghai','Asia/Tokyo','America/New_York']){
  const run=spawnSync(process.execPath,['-e',code],{env:{...process.env,TZ},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),[true,false,false,false,false]);
 }
});
