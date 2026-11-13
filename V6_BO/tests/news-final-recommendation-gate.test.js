'use strict';
// Actual server functions, private temporary journals and memory-only senders.
// No HTTP, supplier, account, webhook or notification API is used by this file.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const serverPath=require.resolve('../server.js'),baseDir=path.dirname(serverPath);
const source=fs.readFileSync(serverPath,'utf8'),realRequire=createRequire(serverPath);
const Journal=require('../src/core/news-evidence-journal'),Queue=require('../feishuq');
function section(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
function fn(name){const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}\n',a)+2;assert.ok(a>=0&&b>a,name);return source.slice(a,b);}
function fixture(t,{deferPrivate=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'news-final-gate-')),root=path.join(directory,'private');
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let clock=Date.now(),batch=[],failColumn=null;
 const sends=[],logs=[],releases=[],quotaCalls=[],privateTimers=[],privateQueues=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const journal={...Journal,captureProviderBatch:(p,raw)=>Journal.captureProviderBatch(p,raw,{now:clock}),
  readJournal:p=>Journal.readJournal(p,{now:clock})};
 const c=vm.createContext({Date:Clock,fs,path,__dirname:baseDir,process:{env:{V6_NEWS_EVIDENCE_DIR:root}},
  require:name=>name==='./src/core/news-evidence-journal'?journal:realRequire(name),console:{log(){},warn(){},error(){}},
  S:{config:{},stocks:[],sectors:[{name:'示例板块'},{name:'其他板块'}],secStocks:new Map(),
   news:{good:[],bad:[],goodAll:[],badAll:[],neutralAll:[],goodCodes:new Set(),badCodes:new Set(),badSectors:new Set(),goodPushed:new Set(),holidayBuf:[]}},
  FSQ:{createQueue:(send,options)=>{const q=Queue.createQueue(send,{...options,minGap:0,sleep:(_ms,run)=>deferPrivate?privateTimers.push(run):run()});privateQueues.push(q);return q;}},
  HOLIDAY_BUF_CAP:1200,NEWS_ARCHIVE_CAP:300,within3Days:value=>{
   const parsed=Date.parse(value);return Number.isFinite(parsed)&&parsed<=clock&&clock-parsed<=3*86400000;
  },isTradeDay:()=>true,isTradingTime:()=>false,
  fetchNewsPage:async column=>{if(column===failColumn)throw Error('memory source unavailable');return {data:{fastNewsList:batch}};},
  ensureSectorStocks:async()=>{},saveNews(){},
  sectorOfStock:row=>row?.sector||c.S.stocks.find(s=>s.code===row?.code)?.sector||'未知',
  redactSecrets:value=>value,inManualPush:()=>false,isReplica:()=>false,msgGate:()=>({ok:true}),inQuietHours:()=>false,
  sseSendEdit(){},sseSend(){},privReady:()=>true,feishuSecId:()=> 'fixture-only',feishuSecMask:()=> 'fixture-only',
  feishuReady:()=>true,mailReady:()=>false,
  feishuProbe:async(_id,_secret,text)=>{sends.push(text);return {ok:true};},
  feishuSend:(text,callback)=>{sends.push(text);callback(true,'memory-only');},
  sendQQMail:async()=>{throw Error('unexpected email sender');},
  pushLog:(...args)=>logs.push(args),_pushLast:{},
  govReleaseAll:rows=>releases.push(...rows),modDayRelease:module=>releases.push(module),
  govResetIfNewDay:()=>quotaCalls.push('quota-reset'),PUSH_GOV:{total:0}});
 vm.runInContext(section('const NEWS_EVIDENCE_ROOT=','const HOLIDAY_BUF_CAP'),c);
 vm.runInContext(section('const NEWS_BAD_KW =','function saveNews()'),c);
 vm.runInContext(section('function classifyNews(','async function fetchNewsPage('),c);
 vm.runInContext(section('async function refreshNews()','// 每日新闻汇总'),c);
 for(const name of ['reviewRecommendation','reviewSnapshotFields','freezeRecommendationRows','freezeNewsRecommendationRows','newsRecommendationSendOptions','recommendationSendOptions',
  'recommendationNewsReview','prepareRecommendationDelivery','extractStockCodes','sendResultUnknown','pushAll','govTake','nextPlanNewsOptions'])vm.runInContext(fn(name),c);
 vm.runInContext(section('const _fsPrivateQueue =','// opts.priority'),c);
 const raw=(patch={})=>({code:'event-1',title:'利空减持',summary:'原始消息摘要',showTime:new Date(clock-1000).toISOString(),stockList:['0.000001'],...patch});
 const row=(patch={})=>({code:'000001',name:'正常股票',sector:'其他板块',price:10,quoteAt:clock-1000,receivedAt:clock,
  mode:'public-live-unverified',quoteSource:'vendor-original',canNotify:true,amount:1e8,volume:10000,ts:clock,
  signalId:'a'.repeat(64),type:'趋势票',prob:99,...patch});
 const refresh=async rows=>{batch=rows;await c.refreshNews();};
 const append=(patch={})=>{
  const current=Journal.readJournal(root,{now:clock}).filter(r=>r.evidence.eventId==='event-1').at(-1);
  assert.ok(current,'event needed for a real journal revision');
  const evidence=Object.fromEntries(Object.entries(current.evidence).filter(([key])=>!['bodyHash','uncertainty'].includes(key)));
  return Journal.appendBatch(root,[{...evidence,sourceRevisionId:'test-revision-'+Journal.readJournal(root,{now:clock}).length,
   supersedes:current.eventHash,kind:'revised',revisedAt:clock,receivedAt:clock,...patch}],{now:clock});
 };
 const queued=()=>{
  const timers=[],dispatches=[];
  const q=Queue.createQueue((text,callback)=>{dispatches.push(text);callback(true,'memory-only');},
   {minGap:0,retry:2,sleep:(_ms,run)=>timers.push(run)});
  c.feishuSend=(text,callback,options)=>q.send(text,callback,options);
  return {q,timers,dispatches,run:()=>{assert.ok(timers.length,'one scheduled dispatch expected');timers.shift()();}};
 };
 return {c,root,raw,row,sends,logs,releases,quotaCalls,refresh,append,queued,privateQueues,
  dispatchPrivate:()=>{assert.ok(privateTimers.length,'one scheduled private dispatch expected');privateTimers.shift()();},
  advance:ms=>{clock+=ms;},now:()=>clock,fail:column=>{failColumn=column;}};
}

test('uninitialized empty news is unknown, while an actual complete empty poll is an available no-hit',async t=>{
 const x=fixture(t);
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
 assert.equal(x.c.reviewRecommendationNews(x.row()).status,'unknown');
 await x.refresh([]);
 const checked=x.c.reviewRecommendationNews(x.row());assert.equal(checked.canRecommend,true);assert.equal(checked.status,'available');
 assert.equal(x.sends.length,0);
});

test('a failed source column cannot be relabeled a complete empty or complete positive result',async t=>{
 const x=fixture(t);await x.refresh([]);assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,true);
 x.fail(104);await x.refresh([x.raw({title:'利好中标'})]);
 const result=x.c.reviewRecommendationNews(x.row());assert.equal(result.canRecommend,false);assert.equal(result.status,'unknown');
 x.fail(null);await x.refresh([]);assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,true);
});

test('the exact current negative security blocks while an unrelated security remains available',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
 assert.equal(x.c.reviewRecommendationNews(x.row()).status,'blocked');
 assert.equal(x.c.reviewRecommendationNews(x.row({code:'600000'})).canRecommend,true);
});

test('current positive support never cancels a separate current negative event',async t=>{
 const x=fixture(t);await x.refresh([x.raw(),x.raw({code:'event-good',title:'利好中标'})]);
 assert.equal(x.c.newsSupportsCode('000001'),true);assert.equal(x.c.newsWarnsCode('000001'),true);
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
});

test('explicit sector association blocks indirectly affected recommendations without generalizing to other sectors',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'示例板块利空减持',stockList:['1.600000']})]);
 const affected=x.c.reviewRecommendationNews(x.row({sector:'示例板块'}));
 assert.equal(affected.canRecommend,false);assert.equal(affected.status,'blocked');
 assert.equal(x.c.reviewRecommendationNews(x.row({sector:'其他板块'})).canRecommend,true);
 assert.equal(x.c.reviewRecommendationNews(x.row({sector:'示例板块延伸'})).canRecommend,true,'an explicit different sector is not a substring match');
});

test('a successful refreshed revision from positive to negative is used by the final gate',async t=>{
 const x=fixture(t),positive=x.raw({title:'利好中标'});await x.refresh([positive]);
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,true);
 await x.refresh([{...positive,title:'利空减持',summary:'最新负面修订'}]);
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
});

test('a real journal-only negative revision blocks without waiting for another source refresh',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'利好中标'})]);
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,true);
 x.append({title:'利空减持',body:'在推送等待期间修订为负面'});
 assert.equal(x.c.S.news.badAll.length,0,'the cached category is deliberately not refreshed');
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
});

test('journal retraction invalidates the old negative projection without another source refresh',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
 x.append({kind:'retracted',title:'已撤稿'});
 assert.equal(x.c.S.news.badAll.length,1,'the old negative cache remains present for this regression');
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,true);
});

for(const fault of ['content','permissions'])test('an invalid private journal keeps current recommendations unknown: '+fault,async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'利好中标'})]);assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,true);
 const file=path.join(x.root,'000001.json');
 if(fault==='content')fs.writeFileSync(file,'{}');else fs.chmodSync(file,0o644);
 x.advance(1001);
 const result=x.c.reviewRecommendationNews(x.row());assert.equal(result.canRecommend,false);assert.equal(result.status,'unknown');
});

test('a negative event with unknown publication time cannot be used as a passed risk check',async t=>{
 const x=fixture(t);await x.refresh([x.raw({showTime:null})]);
 const result=x.c.reviewRecommendationNews(x.row());assert.equal(result.canRecommend,false);assert.equal(result.status,'unknown');
});

test('expired or future coverage clocks cannot authorize recommendations',async t=>{
 const x=fixture(t);await x.refresh([]);x.advance(300001);
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
 await x.refresh([]);x.c.S.news.riskSnapshot.checkedAt=x.now()+1;
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
});

test('a rejected provider event cannot make a partial intake appear available',async t=>{
 const x=fixture(t);await x.refresh([x.raw({showTime:'invalid-provider-date'})]);
 const result=x.c.reviewRecommendationNews(x.row());assert.equal(result.canRecommend,false);assert.equal(result.status,'unknown');
});

test('actual pushAll rejects the previously reproducible valid-quote negative-news leak and releases reservations',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);
 const options=x.c.recommendationSendOptions([x.row()],{private:true,undo:[{code:'000001',type:'pool'}],modDay:'pool'});
 assert.equal(x.c.pushAll('当前可买 正常股票(000001)',false,options),false);
 await new Promise(setImmediate);assert.equal(x.sends.length,0);assert.equal(x.releases.length,2);
});

for(const override of [{force:true},{manual:true},{force:true,manual:true}])test('high model value and caller overrides do not bypass current negative news: '+JSON.stringify(override),async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);
 const options=x.c.recommendationSendOptions([x.row({prob:99.9})],{private:true,manual:!!override.manual});
 assert.equal(x.c.pushAll('模型99.9 当前可买',!!override.force,options),false);await new Promise(setImmediate);assert.equal(x.sends.length,0);
});

test('a mixed recommendation batch is held as one batch when one structured row is affected',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);
 const options=x.c.recommendationSendOptions([x.row(),x.row({code:'600000'})],{private:true,undo:[{code:'000001'},{code:'600000'}],modDay:'pool'});
 assert.equal(x.c.pushAll('两个股票当前可买',false,options),false);await new Promise(setImmediate);
 assert.equal(x.sends.length,0);assert.equal(x.releases.length,3);
});

test('the central reservation gate rejects current news before modifying stock or daily quotas',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);
 const result=x.c.govTake('000001','pool',true,99.9,x.row());
 assert.equal(result.ok,false);assert.equal(x.quotaCalls.length,0);assert.equal(x.c.PUSH_GOV.total,0);
});

test('an actual queued public recommendation rechecks news at dispatch and drops a newly negative row',async t=>{
 const x=fixture(t);await x.refresh([]);const queue=x.queued();
 const options=x.c.recommendationSendOptions([x.row()],{public:true,undo:[{code:'000001'}],modDay:'pool'});
 assert.equal(x.c.pushAll('当前可买 正常股票(000001)',false,options),true);
 await x.refresh([x.raw()]);queue.run();await new Promise(setImmediate);
 assert.equal(queue.dispatches.length,0);assert.equal(queue.q.running,false);assert.equal(x.releases.length,2);
});

test('the actual queue rechecks the same news guard before a rate-limit retry',async t=>{
 const x=fixture(t);await x.refresh([]);const timers=[],dispatches=[];
 const queue=Queue.createQueue((text,cb)=>{dispatches.push(text);cb(false,'9499 too many request');},
  {minGap:0,retry:2,sleep:(_ms,run)=>timers.push(run)});
 x.c.feishuSend=(text,cb,options)=>queue.send(text,cb,options);
 const options=x.c.recommendationSendOptions([x.row()],{public:true,undo:[{code:'000001'}],modDay:'pool'});
 assert.equal(x.c.pushAll('当前可买 正常股票(000001)',false,options),true);
 assert.ok(timers.length);timers.shift()();assert.equal(dispatches.length,1);assert.ok(timers.length);
 await x.refresh([x.raw()]);timers.shift()();await new Promise(setImmediate);
 assert.equal(dispatches.length,1,'a newly negative retry must not reach the sender again');assert.equal(queue.running,false);
});

test('risk warnings, holding sells and news broadcasts retain their non-recommendation purpose even with unknown news',async t=>{
 const x=fixture(t);
 for(const text of ['持仓风险警报：000001出现利空，请关注减仓','卖出记录：000001，本次金额600000元','新闻播报：000001收到监管关注'])
  assert.equal(x.c.pushAll(text,false,{private:true}),true);
 await new Promise(setImmediate);assert.equal(x.sends.length,3);
});

test('risk association uses structured security rows rather than incidental money numbers in message text',async t=>{
 const x=fixture(t);await x.refresh([x.raw({stockList:['1.600000']})]);
 const options=x.c.recommendationSendOptions([x.row({code:'000001'})],{private:true});
 assert.equal(x.c.pushAll('正常股票(000001)；金额600000元',false,options),true);await new Promise(setImmediate);assert.equal(x.sends.length,1);
});

test('explicit historical resend cannot preserve current-buy language as a news-gate override',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);
 const options=x.c.recommendationSendOptions([x.row()],{private:true,manual:true},true);
 x.c.pushAll('当前可买 正常股票(000001)',true,options);await new Promise(setImmediate);
 for(const text of x.sends){assert.match(text,/历史触发观察/);assert.doesNotMatch(text,/当前可买/);}
});

test('a negative term after the display summary boundary is classified and still blocks',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'公司公告',summary:'甲'.repeat(100)+'利空减持'})]);
 assert.equal(x.c.S.news.badAll.length,1,'the full provider summary, rather than only its display excerpt, classifies risk');
 assert.equal(x.c.S.news.badAll[0].summary.length,90,'the display excerpt remains bounded');
 assert.equal(x.c.reviewRecommendationNews(x.row()).canRecommend,false);
});

test('a sector association after the display summary boundary is not lost by the risk gate',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'利空减持',summary:'甲'.repeat(100)+'示例板块',stockList:['1.600000']})]);
 assert.equal(x.c.reviewRecommendationNews(x.row({sector:'示例板块'})).canRecommend,false);
});

test('a news-only dated stock observation still checks current risk without inventing an intraday quotation',async t=>{
 const x=fixture(t);await x.refresh([]);
 const dated={code:'000001',name:'正常股票',sector:'其他板块'};
 assert.equal(x.c.pushAll('带日期观察：000001，仅供研究',false,x.c.newsRecommendationSendOptions([dated],{private:true})),true);
 await new Promise(setImmediate);assert.equal(x.sends.length,1);
 await x.refresh([x.raw()]);
 assert.equal(x.c.pushAll('带日期观察：000001，仅供研究',true,x.c.newsRecommendationSendOptions([dated],{private:true,manual:true})),false);
 await new Promise(setImmediate);assert.equal(x.sends.length,1);
});

test('news-only recommendation rows are immutable and missing rows cannot authorize a send',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);const r={code:'000001',sector:'其他板块',sectors:['其他板块']};
 const options=x.c.newsRecommendationSendOptions([r],{private:true});
 r.code='600000';r.sectors[0]='示例板块';
 assert.equal(options.newsRecommendationRows[0].code,'000001');assert.equal(options.newsRecommendationRows[0].sectors[0],'其他板块');
 assert.ok(Object.isFrozen(options.newsRecommendationRows));assert.ok(Object.isFrozen(options.newsRecommendationRows[0].sectors));
 assert.equal(x.c.pushAll('当前观察',false,options),false);
 assert.equal(x.c.pushAll('当前观察',false,x.c.newsRecommendationSendOptions([],{private:true})),false);
});

test('a local dispatch refusal is never retried merely because its explanation contains a rate-limit number',()=>{
 const timers=[],calls=[],results=[];
 const q=Queue.createQueue((_text,cb)=>{calls.push('sent');cb(true,'memory-only');},{minGap:0,retry:2,sleep:(_ms,run)=>timers.push(run)});
 q.send('当前观察',(ok,why)=>results.push({ok,why}),{beforeSend:()=>({ok:false,why:'新闻审核失败：来源429 / 9499不能冒充飞书限流'})});
 assert.equal(timers.length,1);timers.shift()();
 assert.equal(calls.length,0);assert.equal(timers.length,0);assert.equal(q.stats().retried,0);assert.equal(q.running,false);
 assert.equal(results.length,1);assert.equal(results[0].ok,false);
});

test('a later queued-news veto does not release reservations for a batch already delivered by email',async t=>{
 const x=fixture(t);await x.refresh([]);const queue=x.queued(),mail=[];
 x.c.S.config.qqMail={user:'fixture-user',authCode:'fixture-only-code',to:'fixture-recipient'};
 x.c.mailReady=()=>true;x.c.sendQQMail=async request=>{mail.push(request.text);};
 const options=x.c.recommendationSendOptions([x.row()],{public:true,undo:[{code:'000001'}],modDay:'pool'});
 assert.equal(x.c.pushAll('当前观察 正常股票(000001)',false,options),true);await new Promise(setImmediate);
 assert.equal(mail.length,1);await x.refresh([x.raw()]);queue.run();await new Promise(setImmediate);
 assert.equal(queue.dispatches.length,0);assert.equal(x.releases.length,0,'one confirmed channel delivery owns the original reservations');
 assert.equal(x.c._pushLast.sent,true);
});

test('a named bank company adverse event is not generalized to every bank stock',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'招商银行收到警示函，利空',stockList:['1.600036']})]);
 assert.equal(x.c.reviewRecommendationNews(x.row({code:'600036',sector:'银行'})).canRecommend,false,'the explicitly named company remains blocked');
 assert.equal(x.c.reviewRecommendationNews(x.row({code:'000001',sector:'银行'})).canRecommend,true,'a company-name substring is not an industry impact statement');
});

test('an electrical-equipment sector warning is not generalized to the shorter electricity industry',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'电力设备板块利空减持',stockList:['1.600000']})]);
 assert.equal(x.c.reviewRecommendationNews(x.row({sector:'电力设备'})).canRecommend,false);
 assert.equal(x.c.reviewRecommendationNews(x.row({sector:'电力'})).canRecommend,true);
});

for(const affectedCode of ['000001','600000'])test('queued immutable news identity stays attached to its original message after options replacement: '+affectedCode,async t=>{
 const x=fixture(t);await x.refresh([]);const queue=x.queued();
 const options=x.c.recommendationSendOptions([x.row()],{public:true});
 assert.equal(x.c.pushAll('原始股票(000001)当前观察',false,options),true);
 options.newsRecommendationRows=[{code:'600000',name:'被替换证券',sector:'其他板块'}];
 options.recommendationRows=[x.row({code:'600000'})];
 await x.refresh([x.raw({stockList:[affectedCode==='000001'?'0.000001':'1.600000']})]);
 queue.run();await new Promise(setImmediate);
 if(affectedCode==='000001')assert.equal(queue.dispatches.length,0,'replacing caller options cannot evade the original security risk');
 else {assert.deepEqual(queue.dispatches,['原始股票(000001)当前观察']);assert.doesNotMatch(queue.dispatches[0],/600000|被替换证券/);}
});

test('actual next-plan metadata carries picked and relay securities into the news-only final boundary',async t=>{
 const x=fixture(t);await x.refresh([x.raw({stockList:['1.600000']})]);
 x.c.S.nextplan={plan:{picked:[{code:'000001',sector:'其他板块'}]},relay:[{code:'600000',sector:'其他板块'}]};
 const options=x.c.nextPlanNewsOptions();
 assert.deepEqual(Array.from(options.newsRecommendationRows,r=>r.code),['000001','600000']);assert.equal(options.private,true);
 x.c.S.nextplan.relay[0].code='600001';
 assert.equal(options.newsRecommendationRows[1].code,'600000');
 assert.equal(x.c.pushAll('次日条件场景，非实时买价',true,options),false);await new Promise(setImmediate);assert.equal(x.sends.length,0);
});

test('positive keywords with a missing original publication time remain unknown and cannot authorize a high-score push',async t=>{
 const x=fixture(t);await x.refresh([x.raw({title:'利好中标',showTime:''})]);
 const result=x.c.reviewRecommendationNews(x.row({prob:99.9}));
 assert.equal(result.status,'unknown');assert.equal(result.canRecommend,false);assert.equal(result.reason,'NEWS_EVENT_TIME_UNKNOWN');
 const options=x.c.recommendationSendOptions([x.row({prob:99.9})],{private:true,manual:true});
 assert.equal(x.c.pushAll('利好加分后当前可买',true,options),false);await new Promise(setImmediate);assert.equal(x.sends.length,0);
});

test('the status view exposes bounded source coverage rather than a passed investment decision and becomes unknown when stale or damaged',async t=>{
 const x=fixture(t),original=x.raw({title:'利好中标'});await x.refresh([original]);
 const current=x.c.newsRiskSnapshotView();
 assert.equal(current.status,'available');assert.equal(current.validUntil,x.now()+300000);
 assert.equal(current.sourceCoverage,'two-configured-news-columns-only');assert.equal(current.verified,false);
 assert.equal(Object.hasOwn(current,'canRecommend'),false);
 x.advance(300001);assert.equal(x.c.newsRiskSnapshotView().status,'unknown');
 await x.refresh([original]);assert.equal(x.c.newsRiskSnapshotView().status,'available');
 fs.writeFileSync(path.join(x.root,'000001.json'),'{}');x.advance(1001);
 assert.equal(x.c.newsRiskSnapshotView().status,'unknown');
});

test('a news-held attempt does not reuse an earlier successful delivery status',async t=>{
 const x=fixture(t);await x.refresh([x.raw()]);
 x.c._pushLast={ret:true,sent:true,why:'',t:x.now()-1000};
 const options=x.c.recommendationSendOptions([x.row()],{private:true});
 assert.equal(x.c.pushAll('当前可买',false,options),false);
 assert.equal(x.c._pushLast.ret,false);assert.equal(x.c._pushLast.sent,false);
 assert.match(x.c._pushLast.why,/利空/);assert.equal(x.sends.length,0);
 const blocked=x.logs.find(row=>row[0]==='推荐证据未通过·不外发');
 assert.ok(blocked);assert.deepEqual([...blocked[2].extra.codes],['000001']);
 assert.equal(blocked[2].extra.newsRisk.reason,'CURRENT_NEGATIVE_NEWS');
});

for(const fault of ['negative','unknown'])test('the actual private queue rechecks current news immediately before sending: '+fault,async t=>{
 const x=fixture(t,{deferPrivate:true});await x.refresh([]);
 const options=x.c.recommendationSendOptions([x.row()],{private:true,undo:[{code:'000001'}],modDay:'pool'});
 assert.equal(x.c.pushAll('当前可买 正常股票(000001)',false,options),true);assert.equal(x.sends.length,0);
 if(fault==='negative')await x.refresh([x.raw()]);else{x.fail(104);await x.refresh([]);}
 x.dispatchPrivate();await new Promise(setImmediate);
 assert.equal(x.sends.length,0);assert.equal(x.releases.length,2);assert.equal(x.privateQueues[0].running,false);
 const status=vm.runInContext('_pushLast',x.c);assert.equal(status.ret,false);assert.equal(status.sent,false);assert.match(status.why,/新闻/);
 assert.ok(x.logs.some(entry=>entry[0]==='新闻避险·该次发送暂停'));
});

test('the private dispatch checks the captured stock identity after callers replace recommendation arrays',async t=>{
 const x=fixture(t,{deferPrivate:true});await x.refresh([]);
 const options=x.c.recommendationSendOptions([x.row()],{private:true});
 assert.equal(x.c.pushAll('当前可买 正常股票(000001)',false,options),true);
 options.recommendationRows=[x.row({code:'600000'})];options.newsRecommendationRows=[{code:'600000'}];
 await x.refresh([x.raw()]);x.dispatchPrivate();await new Promise(setImmediate);
 assert.equal(x.sends.length,0);assert.equal(x.privateQueues[0].running,false);
});

test('the merged private queue preserves the current recommendation quote expiry check',async t=>{
 const x=fixture(t,{deferPrivate:true});await x.refresh([]);
 const options=x.c.recommendationSendOptions([x.row()],{private:true,undo:[{code:'000001'}]});
 assert.equal(x.c.pushAll('当前可买 正常股票(000001)',false,options),true);
 x.advance(16000);x.dispatchPrivate();await new Promise(setImmediate);
 assert.equal(x.sends.length,0);assert.equal(x.releases.length,1);assert.equal(x.privateQueues[0].running,false);
});
