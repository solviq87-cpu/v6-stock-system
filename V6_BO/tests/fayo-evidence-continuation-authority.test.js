'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const J=require('../src/core/news-evidence-journal');
const baseDir=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(baseDir,'server.js'),'utf8');
function section(begin,end){const a=source.indexOf(begin),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,begin);return source.slice(a,b);}
function fixture(t,{revisionClock=Date.now}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-news-authority-')),root=path.join(dir,'news');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=Date.now(),writes=0,pushes=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const c=vm.createContext({Date:Clock,fs,path,__dirname:baseDir,process:{env:{V6_NEWS_EVIDENCE_DIR:root}},Map,Set,
  require:m=>m.startsWith('./')?require(path.join(baseDir,m)):require(m),
  S:{stocks:[],sectors:[],news:{goodAll:[],badAll:[],neutralAll:[],goodCodes:new Set(),badCodes:new Set(),holidayBuf:[]}}});
 vm.runInContext(section('const NEWS_EVIDENCE_ROOT=','const HOLIDAY_BUF_CAP'),c);
 vm.runInContext(section('const NEWS_BAD_KW =','function saveNews()'),c);
 vm.runInContext(section('function classifyNews(','async function fetchNewsPage('),c);
 const ingest=(title='公司收到监管函',patch={})=>{
  const raw={code:'authority-fixture',title,summary:'隔离合成正文，仅用于测试新闻版本关联',showTime:new Date(clock-10000).toISOString(),stockList:['0.000001'],...patch};
  J.captureProviderBatch(root,[raw]);
  const items=c.classifyNews([raw],new Map());
  c.S.news.badAll=items.filter(row=>row.type==='bad');c.S.news.goodAll=items.filter(row=>row.type==='good');
  c.S.news.neutralAll=items.filter(row=>row.type==='neutral');
  c.S.news.badCodes=new Set(c.S.news.badAll.flatMap(row=>row.codes));c.S.news.goodCodes=new Set(c.S.news.goodAll.flatMap(row=>row.codes));
  clock=Math.max(clock,Date.now());
  c.S.news.riskSnapshot={status:'available',checkedAt:clock,source:'eastmoney-fast-news',columnsComplete:true};
 };
 const revise=(kind='retracted',patch={})=>{
  const original=J.readJournal(root).at(-1);
  // One real receipt clock for the whole revision; two Date.now() reads can
  // straddle a millisecond and fabricate a revision later than its receipt.
  const now=revisionClock();
  J.appendBatch(root,[{...Object.fromEntries(Object.entries(original.evidence).filter(([key])=>!['bodyHash','uncertainty'].includes(key))),
    sourceRevisionId:'fixture-'+kind,kind,supersedes:original.eventHash,receivedAt:now,revisedAt:now,...patch}],{now});
  clock=Math.max(clock,Date.now());
 };
 const newsContext=()=>({...c.newsEvidenceVisibleState().news,evidenceStatus:c.newsRiskSnapshotView().status});
 const io={readFileSync(file){return String(file).endsWith('holdings.json')?JSON.stringify({capital:100000,stopPct:-8,reducePct:-4,takePct:15,maxPosPct:90,
    items:[{code:'000001',name:'隔离合成持仓',cost:100,shares:100,tags:[],locked:false}]}):'{}';},
   writeFileSync(){writes++;},renameSync(){writes++;},existsSync:()=>false};
 const makeHoldings=callback=>require('../holdings')({fs:io,path,dir,S:c.S,em:{},newsContext:callback,sseSend(){},sseSendEdit(){},pushAll(){pushes++;}});
 const holdings=makeHoldings(newsContext),bars=Array.from({length:10},()=>({close:94,high:95}));
 const verdict=(patch={},api=holdings)=>api.verdict('000001',{price:95,pct:0,mainInflow:0,mainPct:0,...patch},bars,{positionPct:10});
 const calls=[];
 Object.assign(c,{isReplica:()=>false,isContinuousTrading:()=>true,aShareCalendarDate:()=> '2026-11-26',
  loadSystemPickRules:async()=>({pickReasons:()=>['合成规则'],systemPickDay:()=> '2026-11-26',topSystemPicks:rows=>rows}),
  refreshPaperAuthority(){},PAPER:{pool:{trades:[],positions:{}}},paperPrices:()=>new Map(),paperBuy:(key,rows)=>calls.push({key,codes:rows.map(row=>row.code)})});
 vm.runInContext(section('async function followSystemPicks','let _fundHistoryCache;'),c);
 return {c,root,ingest,revise,verdict,calls,makeHoldings,advance(ms){clock+=ms;},counts:()=>({writes,pushes}),
  follow:(patch={})=>c.followSystemPicks([{code:'000001',name:'隔离合成候选',score:90,...patch}],'2026-11-26')};
}

test('journal withdrawal reaches actual holding advice and system follow without refreshing stale headline sets',async t=>{
 const x=fixture(t);x.ingest();
 assert.equal(x.c.S.news.badCodes.has('000001'),true);
 assert.equal(x.verdict().badNews,true);assert.ok(x.verdict().acts.some(a=>a.type==='减仓'));
 await x.follow();assert.equal(x.calls.length,0,'current negative evidence still blocks follow');
 x.revise();
 assert.equal(x.c.S.news.badCodes.has('000001'),true,'legacy cache intentionally remains unchanged');
 const current=x.verdict();assert.equal(current.badNews,false);assert.ok(!current.acts.some(a=>a.type==='减仓'));
 assert.ok(current.acts.some(a=>a.type==='关注'),'original price warning survives the retraction');
 await x.follow();assert.deepEqual(x.calls,[{key:'pool',codes:['000001']}]);
 assert.deepEqual(x.counts(),{writes:0,pushes:0});
});

test('one receipt clock binds synthetic source revision, receipt and journal recording',t=>{
 let reads=0;
 const x=fixture(t,{revisionClock:()=>{reads++;return Date.now();}});
 x.ingest();x.revise();
 const event=J.readJournal(x.root).at(-1);
 assert.equal(reads,1);
 assert.equal(event.evidence.revisedAt,event.evidence.receivedAt);
 assert.equal(event.recordedAt,event.evidence.receivedAt);
 assert.equal(x.verdict().badNews,false);
});

test('revised company association and expiry cannot retain stale holding conclusions',async t=>{
 const x=fixture(t);x.ingest();x.revise('revised',{securities:['600000']});
 assert.equal(x.verdict().badNews,false);assert.equal(x.c.S.news.badCodes.has('000001'),true);
 await x.follow();assert.equal(x.calls.length,1,'old company association cannot remain a veto');
 const y=fixture(t);y.ingest();y.advance(3*86400000);
 const expired=y.verdict();assert.equal(expired.badNews,false);assert.equal(expired.newsStatus,'unknown');
 assert.ok(expired.acts.some(a=>a.type==='新闻待核实'&&a.canNotify===false));
 await y.follow();assert.equal(y.calls.length,0,'expired snapshot is unknown, never a clean recommendation');
 assert.ok(y.verdict({price:90}).acts.some(a=>a.type==='止损'),'price stop is independent of headline validity');
});

test('unbound or corrupted news is unknown and cannot drive holding reductions or permit system follow',async t=>{
 const x=fixture(t);x.ingest();assert.equal(x.verdict().badNews,true);
 fs.writeFileSync(path.join(x.root,'000001.json'),'{}');
 const result=x.verdict();assert.equal(result.badNews,false);assert.equal(result.newsStatus,'unknown');
 assert.ok(result.acts.some(a=>a.type==='新闻待核实'));assert.ok(!result.acts.some(a=>a.type==='减仓'));
 await x.follow();assert.equal(x.calls.length,0);
 const noProjection=x.makeHoldings(undefined);assert.equal(x.verdict({},noProjection).badNews,false);
 assert.equal(x.verdict({},noProjection).newsStatus,'unknown');
 const failedProjection=x.makeHoldings(()=>{throw Error('fixture archive unavailable');});
 assert.ok(x.verdict({price:90},failedProjection).acts.some(a=>a.type==='止损'));
 assert.deepEqual(x.counts(),{writes:0,pushes:0});
});

test('the original explicit-sector news risk gate also applies to automatic system following',async t=>{
 const x=fixture(t);x.ingest('银行板块收到监管函',{stockList:['1.600000']});
 assert.equal(x.c.S.news.badCodes.has('000001'),false,'no direct-security legacy flag exists');
 await x.follow({sector:'银行'});assert.equal(x.calls.length,0,'explicit sector evidence is reviewed by the original gate');
 await x.follow({sector:'软件服务'});assert.equal(x.calls.length,1,'an unrelated sector is not inferred from the title');
});

test('a current positive headline cannot suppress the original unchanged-position conclusion',t=>{
 const x=fixture(t);x.ingest('公司中标');
 const observed=x.verdict({price:100});
 assert.equal(observed.goodNews,true);assert.ok(observed.acts.some(a=>a.type==='利好在案'));
 assert.ok(observed.acts.some(a=>a.type==='持有'&&/维持现有仓位/.test(a.text)));
 assert.deepEqual(x.counts(),{writes:0,pushes:0});
});

test('server injects the same current news projection into its only holdings instance',()=>{
 const wiring=section('const HD = createHoldings','// ⛔ 2026-10-06');
 assert.match(wiring,/newsContext:\s*\(\)\s*=>\s*\(\{\.\.\.newsEvidenceVisibleState\(S\)\.news,evidenceStatus:newsRiskSnapshotView\(\)\.status\}\)/);
});

test('actual news-only message labels keyword classification instead of claiming selection logic',async t=>{
 const x=fixture(t),messages=[],raw={code:'message-only',title:'公司中标',summary:'隔离消息模板测试',
  showTime:new Date(Date.now()-10000).toISOString(),stockList:['0.000001']};
 Object.assign(x.c,{HOLIDAY_BUF_CAP:1200,NEWS_ARCHIVE_CAP:300,within3Days:()=>true,isTradeDay:()=>true,isTradingTime:()=>true,
  fetchNewsPage:async()=>({data:{fastNewsList:[raw]}}),ensureSectorStocks:async()=>{},saveNews(){},pushAll:message=>messages.push(message),
  console:{log(){},error(...args){throw Error(args.join(' '));}}});
 x.c.S.news.goodPushed=new Set();
 vm.runInContext(section('async function refreshNews()','// 每日新闻汇总'),x.c);
 await x.c.refreshNews();
 assert.equal(messages.length,1);assert.match(messages[0],/关键词归类（待核实）/);
 assert.match(messages[0],/不作为入选或买卖依据/);assert.doesNotMatch(messages[0],/选股逻辑:/);
 assert.equal(x.calls.length,0);assert.deepEqual(x.counts(),{writes:0,pushes:0});
});
