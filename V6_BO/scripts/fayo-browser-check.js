#!/usr/bin/env node
'use strict';
// The real independent product modules run against an isolated synthetic HTTP
// transport. Prices are deliberately marked synthetic and never production.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const publicRoot=path.resolve(__dirname,'../public');
const releaseVersion=fs.readFileSync(path.join(publicRoot,'nova/index.html'),'utf8').match(/<meta name="application-version" content="([^"]+)"/)[1];
const output=process.env.FAYO_QA_DIR||process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-browser-'));
fs.mkdirSync(output,{recursive:true});
const sourceAt=Date.parse('2026-11-13T07:00:00Z');
const stocks=Array.from({length:8},(_,i)=>({code:String(600101+i),name:'合成光谱'+(i+1),sector:i%2?'合成材料':'合成能源',price:12.3+i,pct:i%2?-1.2:2.1,score:86-i*3,quoteAt:sourceAt,vendorQuoteAt:sourceAt,quoteSource:'synthetic-friday-provider',source:'synthetic-friday-provider',signals:['合成趋势条件','合成资金条件'],hit:[{id:'fixture-trend',text:'合成趋势条件'},{id:'fixture-volume',text:'合成量能条件'}],hitIds:['fixture-trend','fixture-volume'],explanation:['仅用于隔离浏览器交互检查'],fourteen:i%2===0,bazi:i%2?{verdict:'仅研究'}:null,focused:i<3,riskLevel:'未评估'}));
stocks[7].name='<img src=x onerror=window.fayoInjected=true>';
const candles=Array.from({length:900},(_,i)=>{
 const date=new Date(sourceAt-(899-i)*86400000);
 return {date:date.toISOString().slice(0,10),open:10+i*.01,high:10.4+i*.01,low:9.8+i*.01,close:10.2+i*.01,volume:100000+i*10,amount:1200000+i*100};
}).filter(row=>![0,6].includes(new Date(row.date+'T12:00:00Z').getUTCDay()));
const indices=[['1.000001','上证指数',3210.12,.9],['0.399001','深证成指',10020.32,-.6],['0.399006','创业板指',2100.45,1.2],['1.000688','科创50',1020.4,.3]].map(([code,name,price,pct])=>({code,name,price,pct,quoteAt:sourceAt,quoteSource:'synthetic-friday-provider'}));
let phase='normal',role='edit',holdAnalysis=false,heldAnalysisReply=null,holdMarks=false,heldMarksReply=null;
const requests=[],resources=[];
let returnRetainedReview=false;
function leadershipFixture(){
 const {mergeLimitReviewPools}=require('../src/core/limit-review-pool');
 const tradeDate='2026-11-13';
 const poolEvidence={source:'em',scope:'eastmoney-limit-up-pool',tradeDate,receivedAt:sourceAt};
 const eastmoneyRows=['092500','093105','094620','103014','131502'].map((firstSeal,i)=>({
  code:i===0?stocks[0].code:String(601100+i),name:i===0?stocks[0].name:'合成同业'+i,
  sector:'合成能源',firstSeal,tradeDate,sourceTradeDate:tradeDate,src:'em',poolEvidence
 }));
 const cls={status:'available',complete:true,tradeDate,receivedAt:sourceAt,totalCount:2,fetchedCount:2,uniqueCount:2,
  items:eastmoneyRows.slice(0,2).map(row=>({...row,src:'cls',receivedAt:sourceAt}))};
 const pool=mergeLimitReviewPools({eastmoneyRows,cls,tradeDate,
  eastmoneyMeta:{totalCount:phase==='system-picks-refresh'?6:5,receivedAt:sourceAt}});
 return {ztReviewPool:pool.rows,ztReviewPoolMeta:pool.meta};
}
function state(){
 const rows=phase==='empty'?[]:stocks;
 const dashboard={observedAt:Date.now(),indexObservedAt:sourceAt,source:'合成浏览器数据 · 非真实行情',snapshotDay:phase==='empty'?'20261115':'20261113',snapshotRetained:true,isSnapshot:true,trading:false,indices:phase==='empty'?[]:indices,rows,counts:{candidates:rows.length,focused:3,signals:2,risk:1},mood:{upRatio:62,label:'休市观察',note:'保留合成周五快照'},strategies:[{label:'十四条选股',count:3},{label:'八字口诀',count:2},{label:'GPT 五策略',count:1},{label:'Python 三轮筛选',count:2}],pushes:{items:rows.slice(0,2).map(row=>({...row,stage:'history',triggerAt:sourceAt,sentAt:sourceAt,sendStatus:'sent'}))}};
 const sourcePanels={
  ...leadershipFixture(),
  fastStockMoves:{tradeDate:'2026-11-13',phase:'afternoon',checkedAt:sourceAt-300000,requested:12,observed:8,comparable:5,count:1,thresholdPct:1,
   items:[{...stocks[0],basePrice:12.1,risePct:1.653,spanMs:8000,quoteAt:sourceAt-300000,vendorQuoteAt:sourceAt-300000}]},
  sectorsDay:'20261113',ztDay:'20261113',
  ztBySector:[{sector:'合成能源',count:2,stocks:[{...stocks[0],role:'leader'},{...stocks[2],role:'mid'}]},
   {sector:'合成材料',count:1,stocks:[{...stocks[1],role:'leader'}]}],
  indexKline:{items:candles.slice(-32).map((bar,i)=>{
   const middle=3210+Math.sin(i*.7)*25+i*2;
   const open=middle+Math.cos(i)*9,close=middle-Math.cos(i)*9;
   return {date:bar.date,open,close,high:Math.max(open,close)+5,low:Math.min(open,close)-5};
  })}
 };
 return {...sourcePanels,now:Date.now(),role,trading:false,ready:true,isSnapshot:true,snapshotRetained:true,snapshotDay:phase==='empty'?'20261115':'20261113',dashboard,pool:rows,poolSize:rows.length,stocks:rows,global:[{name:'合成全球指数',price:3210.12,pct:.5}],external:{},auction:{stage:'收盘',strong:rows.slice(0,3),validCount:3,time:'2026-11-13 15:00'},sectors:[{name:'合成能源',pct:1.1,mainInflow:1e8,mainInflowYuan:1e8},{name:'合成材料',pct:-.3,mainInflow:-2e7,mainInflowYuan:-2e7}],ztPool:rows.slice(0,2),ztPre:rows.slice(0,2),trendPool:rows.slice(2,5),trendScan:rows.slice(0,5),steadyUp:rows.slice(3),myrules:{items:rows.slice(0,4)},nextplan:{date:'20261113',applyDate:'20261116',plan:{picked:rows.slice(0,2)}},signals:rows.slice(0,2).map(row=>({...row,title:'合成研究提醒',time:sourceAt})),mainline:{time:sourceAt,items:[{name:'合成能源',pct:1.1,note:'仅合成测试'}]},review:{date:'20261113',ztN:3,items:stocks.slice(0,3).map(row=>({...row,limitUpCount:1,sealAmount:11000000,breakCount:0,turnover:4.2,reason:'合成涨停复盘样本'})),poolEvidence:[{source:'em',tradeDate:'20261113',reportedCount:phase==='coverage-gap'?37:3,returnedCount:phase==='coverage-gap'?33:3,uniqueCount:phase==='coverage-gap'?33:3}]},config:{},cfgSet:{},cfgRange:{},paper:role==='edit'?{pool:{positions:[],trades:[],capital:100000,equity:100000},pre:{positions:[],trades:[],capital:100000,equity:100000}}:{hidden:true},goodNews:{items:[{title:'合成周末公告继续更新',source:'synthetic-news',publishedAt:'2026-11-15T08:00:00+08:00',codes:['600101'],url:'https://example.invalid/synthetic-news'}]},badNews:{items:[]},news:{items:[]}};
}
const shortlineArchive={
 revision:0,scope:'live',market:[],marketHistory:[],checks:[],plans:[],trades:[],bars:[],notes:[],
 checkins:[],versions:[],candidates:[],explanations:[],corrections:[],
 catalog:JSON.parse(fs.readFileSync(path.join(publicRoot,'nova/shortline/catalog.json'),'utf8'))
};
function respond(url,req,body){
 const p=url.pathname;
 if(p==='/api/lock/status')return {ok:true,role:phase==='revoked'||!req.headers.authorization?null:role,hasPassword:true,hasViewPassword:true,pushRole:'replica',appVer:releaseVersion};
 if(p==='/api/lock/unlock')return body?.password==='synthetic-fayo-password'?{ok:true,role,token:'fayo-synthetic-session'}:{ok:false,error:'合成测试口令不匹配'};
 if(phase==='revoked')return {ok:false,locked:true,needAuth:true,error:'合成设备授权已失效'};
 if(p==='/api/fast-stock-moves'){
  const fast=state().fastStockMoves;
  return {schemaVersion:1,servedAt:Date.now(),trading:false,isSnapshot:true,
   fastStockMoves:{...fast,fetchMs:480,sources:[{source:'eastmoney',observed:8,medianAgeMs:1500,p95AgeMs:2200}],
    recentItems:[{...fast.items[0],code:stocks[2].code,name:stocks[2].name,detectedAt:sourceAt-5000}]}};
 }
 if(p==='/api/close-review-evidence'&&url.searchParams.has('list'))return {ok:true,latestDay:'2026-11-13',recentDays:['2026-11-13','2026-11-12'],archivedDays:['2026-11-12']};
 if(p==='/api/close-review-evidence'&&url.searchParams.get('date')==='2026-11-12'){
  const day='2026-11-12';
  const records=Array.from({length:28},(_,i)=>({symbol:String(600110+i),name:'归档合成'+(i+1),consecutiveLimits:i===0?3:1,
   firstSealTime:i===0?'093624':'100032',lastSealTime:'101100',breakCount:0,amountCny:2e8,industry:'归档测试行业'}));
  return {ok:true,result:{day,sealed:{tradeDate:day,complete:true,totalCount:28,records},broken:{tradeDate:day,complete:true,records:[]},
   down:9,reasons:records.slice(0,2).map((r,i)=>({code:r.symbol,text:i?'合成归档依据乙':'合成归档依据甲',source:'同花顺涨停聚焦'})),
   seats:records.slice(0,5).map((r,i)=>({code:r.symbol,name:r.name,dept:i<4?'机构专用':'深股通专用',category:i<4?'机构专用':'互联互通',net:i*10000})),seatsStatus:'observed'}};
 }
 if(p==='/api/close-review-evidence'&&phase==='close-outage')return {ok:false,error:'合成的供应商断连'};
 if(p==='/api/close-review-evidence')return {ok:true,result:{day:'2026-11-13',
  sealed:{tradeDate:'2026-11-13',complete:true,totalCount:1,records:[{symbol:'600101',name:'合成光谱1',consecutiveLimits:2,firstSealTime:'093005',breakCount:0,amountCny:1e8,industry:'合成能源'}]},
  broken:{tradeDate:'2026-11-13',complete:true,totalCount:1,records:[{symbol:'600102',name:'合成光谱2',changePct:2.3}]},
  sealRate:0.5,down:2,northTurnover:130e8,marketTurnover:1000e8,seatsStatus:'observed',
  retained:returnRetainedReview?['sealed','northTurnover']:[],
  reasons:[{code:'600101',text:returnRetainedReview?'合成同日源端更新的理由':'合成同日原版理由'}],
  seats:[{code:'600101',name:'合成光谱1',dept:'机构专用',category:'机构专用',net:-40000}],
  promotion:{previousDay:'2026-11-12',stages:[{level:1,promoted:1,total:2}],failed:[]}}};

 if(p==='/api/state'||p==='/api/mobile-digest'){
  const result=state();
  if(phase==='radar-refresh')result.dashboard.counts.risk=7;
  result.goodNews.items[0].related={indirect:[{code:'600102',name:'合成光谱2',via:'合成能源',membershipObservedAt:sourceAt}]};
  if(phase==='close-outage'){result.review=null;result.ztReviewPoolMeta=null;result.ztReviewPool=[];}
  if(phase==='news-refresh')result.goodNews.items.push({title:'合成刷新后的新公告',source:'synthetic-news',publishedAt:'2026-11-15T08:10:00+08:00'});
  if(phase==='system-picks-refresh')result.dashboard.rows=[...result.dashboard.rows,{...stocks[0],code:'600199',name:'合成刷新新增',score:98}];
  return result;
 }
 if(p==='/api/reference-indexes')return {ok:true,asOf:new Date(sourceAt).toISOString(),source:'合成指数回执',items:{sh:indices[0]}};
 if(p==='/api/quant-picks'||p==='/api/auction-resonance')return {ok:true,asOf:sourceAt,board:url.searchParams.get('board')||'all',count:stocks.length,items:phase==='empty'?[]:stocks.map((stock,index)=>index===0?{...stock,price:11.11,vendorQuoteAt:sourceAt-1000,quoteAt:sourceAt-1000,hit:[...stock.hit,{text:'仅此选股池保存的合成依据'}]}:stock),snapshotDay:'20261113',snapshotRetained:true,isSnapshot:true,note:'合成周五完成的扫描'};
 if(p==='/api/v6/matches')return {ok:true,snapshotId:'synthetic-friday',scope:'quant-picks-six-rules',asOf:sourceAt,totalStocks:stocks.length,totalSignals:16,items:stocks,hasMore:false,nextCursor:null};
 if(p==='/api/kline'){
  if(url.searchParams.get('period')==='minute'){
   const code=url.searchParams.get('code'),day=url.searchParams.get('day');
   return {code,day,status:'observed',offlineTheme:'隔离测试题材',minuteBars:['09:31','09:32'].map((m,i)=>({
    code,role:'stock',date:day+' '+m,close:12+i/10,knownAt:sourceAt,source:'合成分钟来源',period:'1m'}))};
  }
  const end=url.searchParams.get('end'),limit=Math.min(240,Math.max(1,Number(url.searchParams.get('n')||120)));
  const rows=candles.filter(row=>!end||row.date<end).slice(-limit);
  return {ok:true,code:url.searchParams.get('code'),rows,asOf:'2026-11-13',source:'synthetic-friday-provider',dataQuality:{tradeDate:'2026-11-13',source:'synthetic-friday-provider',freshness:'snapshot-only'}};
 }
 if(p==='/api/search')return {ok:true,items:stocks,results:stocks};
 if(p==='/api/analyze')return {ok:true,code:url.searchParams.get('code'),name:'合成光谱1',price:12.3,pct:2.1,quoteAt:sourceAt,quoteSource:'synthetic-friday-provider',signals:['合成趋势条件'],explanation:['合成历史依据'],score:86};
 if(p==='/api/kline-marks')return {ok:true,items:[]};
 if(p==='/api/quote-cross-check')return {ok:true,code:url.searchParams.get('code'),status:'source-price-or-time-conflict',checkedAt:new Date(sourceAt).toISOString(),referencePrice:null,sourceStatuses:[
  {provider:'tencent',status:'eligible-for-comparison',observedPrice:12.3,observedPreviousClose:12,quoteAt:sourceAt},
  {provider:'eastmoney',status:'eligible-for-comparison',observedPrice:13,observedPreviousClose:12,quoteAt:sourceAt}]};
 if(p==='/api/stock-news-risk')return {ok:true,code:url.searchParams.get('code'),status:'blocked',matches:[{association:'explicit-sector',sectors:['合成能源'],publishedAt:sourceAt,source:'合成快讯'}]};
 if(p==='/api/holdings')return {ok:true,items:[],summary:{capital:100000,totalCost:0,equity:100000},cfg:{stopPct:7,reducePct:4,takePct:15,maxPosPct:30},allTags:[],time:sourceAt};
 if(p==='/api/paper')return {ok:true,paper:{pool:{...state().paper.pool,name:'合成策略跟踪',realizedSeries:[{day:'2026-11-12',value:0},{day:'2026-11-13',value:345.67}],cash:88888.88,initial:100000,totalPnl:345.67,totalPct:.35,enabled:true,positions:[],trades:[]},pre:{...state().paper.pre,name:'合成机会预选',cash:50000,initial:50000,totalPnl:0,totalPct:0,enabled:true,positions:[],trades:[]}}};
 if(p==='/api/paper/ledger')return {ok:true,paper:{pool:{schemaVersion:1,mode:'authoritative-paper-readonly-projection',accountId:'pool',paperOnly:true,canSubmitOrders:false,canCancelOrders:false,accounting:{initialCash:100000,cash:88888.88,realizedPnl:345.67,positions:[{code:'600101',shares:100,basis:1230}],tradeCount:1,auditStatus:'passed'},events:[{type:'FILL_RECORDED',side:'BUY',code:'600101',shares:100,price:12.3,amount:1230,fee:5,t:sourceAt,tradeDate:'2026-11-13',timeQuality:'known'}]},pre:{accountId:'pre',accounting:{initialCash:50000,cash:50000,realizedPnl:0,positions:[],tradeCount:0,auditStatus:'passed'},events:[]}}};
 if(p==='/api/push-log')return {ok:true,items:[]};
 if(p==='/api/lock/devices'||p==='/api/devices')return {ok:true,items:[],devices:[],online:[]};
 if(p==='/api/release/requests')return {ok:true,requests:[],items:[]};
 if(p==='/api/source')return {ok:true,file:url.searchParams.get('file')||'server.js',content:'// synthetic source fixture'};
 if(p==='/api/lock/phone')return {ok:true,bound:false};
 if(p==='/api/research/shortline'){
  if(role!=='edit'||!req.headers.authorization)return {ok:false,error:'需要研究编辑授权'};
  let result=null;
  if(req.method==='POST'){
   if(body?.revision!==shortlineArchive.revision||body?.action!=='v6:sync')return {ok:false,error:'fixture action or revision mismatch'};
   const {code,day='2026-11-13'}=body.payload;
   shortlineArchive.v6Observation={code,day,observedAtMs:Date.now(),stock:{code,name:'浏览器合成研究样本'}};
   shortlineArchive.checks.push({id:'browser-'+(++shortlineArchive.revision),code,date:day,name:'浏览器合成研究样本',strategy:'未匹配',status:'暂缓开仓',position:0,emotion:{stage:'未判定'},risks:['合成观测缺失']});
   result={code,day,missing:['完整盘面']};
  }
  return {ok:true,state:{...shortlineArchive,permissions:{canWrite:true,replica:false,role:'edit'}},result};
 }
 if(p==='/api/research/automatic-evidence'){
  const symbol=url.searchParams.get('symbol')||'600101',tradeDate='2026-11-13';
  return {ok:true,result:{symbol,name:'自动采集测试股票',tradeDate,asOf:sourceAt,provider:'tencent',source:'合成服务回包',stock:{symbol,bars:[{date:tradeDate,close:12}]},
   observations:[{name:'收盘价',value:12,unit:'元'}],systems:['十四条','八字口诀','GPT 五策略','Python 三轮'].map(label=>({label,known:2,total:4,support:[{label:'服务回包中的规则依据'}]})),
   research36:{evaluations:[],status:'测试观察已读取'},tradeDates:[tradeDate]}};
 }
 if(p==='/api/research/workspace')return {ok:true,result:{runs:[],total:0,items:[],selectedRun:null,preferences:{revision:0,value:{}},presets:[],timeline:[]}};
 if(p==='/api/learn-status')return {ok:true,status:{counts:{total:0,pending:0,matured:0},operation:{state:'idle'}}};
 if(p==='/api/research/learning-runtime')return {ok:true,result:{mode:'v6-learning-runtime-preflight',configuration:{status:'unconfigured'},overall:'unconfigured',current:{status:'unconfigured'},model:{status:'disabled'},lastRun:null}};
 if(p==='/api/strategy/dashboard')return {ok:true,strategies:state().dashboard.strategies,items:[],snapshotDay:'20261113'};
 if(p==='/api/research/strategy36')return {ok:true,result:{items:[],strategies:[]},items:[],catalog:[]};
 if(p.startsWith('/api/research/'))return {ok:true,result:{items:[],rows:[],records:[],status:'unconfigured',readOnly:true},items:[]};
 return {ok:true,items:[],rows:[],devices:[],requests:[]};
}
const aliases=new Set(['/','/m','/index.html','/mobile.html','/picks.html','/auction-picks.html','/reference-dashboard.html','/research.html','/model-library.html','/v6-studio.html','/v6-matches.html','/v6-research.html','/v6-validation.html','/v6-paper.html','/v6-market-radar.html']);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){
  let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
   let body;try{body=raw?JSON.parse(raw):null;}catch{body='invalid-json';}
   requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:req.method,body,authorization:req.headers.authorization||''});
   res.setHeader('Content-Type','application/json; charset=utf-8');
   if(holdAnalysis&&url.pathname==='/api/analyze'&&url.searchParams.get('code')==='600101'){holdAnalysis=false;heldAnalysisReply=()=>res.end(JSON.stringify({ok:true,code:'600101',privateNote:'late-analysis-A-must-not-paint'}));return;}
   if(holdMarks&&url.pathname==='/api/kline-marks'){holdMarks=false;heldMarksReply=()=>res.end(JSON.stringify({ok:true,items:[{note:'late-marks-wrong-date-must-not-paint'}]}));return;}
   res.end(JSON.stringify(respond(url,req,body)));
  });return;
 }
 try{
  const resource=aliases.has(url.pathname)?'nova/index.html':decodeURIComponent(url.pathname.slice(1));
  const file=path.resolve(publicRoot,resource);
  if(!file.startsWith(publicRoot+path.sep))throw Error('outside root');
  resources.push(url.pathname);
  const ext=path.extname(file);
  res.setHeader('Content-Type',ext==='.css'?'text/css':['.js','.mjs'].includes(ext)?'application/javascript':ext==='.json'?'application/json':ext==='.svg'?'image/svg+xml':'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});

function automaticResearchRead(entry) {
 const body=entry.body;
 if(entry.method==='POST'&&body){
  if(['/api/research/decision-pipeline','/api/research/live-market'].includes(entry.path))return Object.keys(body).length===0;
  if(entry.path==='/api/research/public-factors')return body.schemaVersion===1&&body.stocks?.length===1;
  if(entry.path==='/api/research/linked-intelligence')return body.schemaVersion===1&&body.stocks?.length===1;
 }
 return entry.method==='POST'&&entry.path==='/api/research/shortline'&&body?.action==='v6:sync'&&
   Number.isSafeInteger(body.revision)&&/^\d{6}$/.test(body.payload?.code||'')&&
   Object.keys(body.payload).every(key=>['code','day'].includes(key))&&
   (!body.payload.day||/^\d{4}-\d{2}-\d{2}$/.test(body.payload.day));
}
async function navigate(page,view,sub='') {
 const control=page.locator('[data-fy-route="'+view+'"]:visible').first();
 if(await control.count())await control.click();
 else await page.evaluate(({view,sub})=>{location.hash='#/'+view+(sub?'/'+sub:'');},{view,sub});
 if(sub)await page.evaluate(({view,sub})=>{location.hash='#/'+view+'/'+sub;},{view,sub});
 await page.waitForFunction(view=>location.hash.startsWith('#/'+view),view);
}
async function checkHomeUpdates(page){
 const result=await page.evaluate(async()=>{
  const {renderTerminalOverview}=await import('/nova/terminal-workbench.js');
  const callbacks=[],day='2026-11-13',at=Date.parse(day+'T09:25:00+08:00');
  const ctx={state:{trading:false,snapshotDay:day,sectors:[],dashboard:{snapshotDay:day}},
   role:'edit',canEdit:false,onState:fn=>callbacks.push(fn),navigate:()=>{},selectStock:()=>{}};
  const home=renderTerminalOverview(ctx);
  const find=(root,name)=>[...root.querySelectorAll('.fy-home-empty')].find(d=>d.firstElementChild.querySelector('strong')?.textContent===name);
  const emptyLabels=[...home.querySelectorAll('.fy-home-empty:not([open])>summary strong')].map(el=>el.textContent);
  const selected=()=>home.querySelector('.fy-home-tabs [aria-pressed=true]').textContent;
  const refresh=()=>callbacks.forEach(fn=>fn());
  const funds=find(home,'板块资金');funds.open=true;
  const repeat=()=>find(home,'板块资金')===funds&&funds.open;
  const valid={code:'000001',name:'竞价校验样本',day,quoteAt:at,knownAt:at+1000,sealSource:'隔离测试'};
  ctx.state.auctionObservations={day,phase:'matched',items:[{...valid,code:'000002',knownAt:Date.now()+60000},
   {...valid,code:'000003',quoteAt:at-86400000},valid]};
  refresh();
  const available=selected(),codes=[...home.querySelectorAll('.fy-home-opportunity [data-code]')].map(el=>el.dataset.code);
  const stayedOpen=repeat();
  home.querySelector('.fy-home-tabs button').click();
  const chosenFold=find(home.querySelector('.fy-home-opportunity'),'精选');chosenFold.open=true;
  ctx.state.sectorsDay=day;ctx.state.sectors=[{name:'资金校验样本',netInflowYuan:10000}];refresh();
  const restored=!find(home,'板块资金')&&home.querySelector('.fy-reference-funds').textContent.includes('资金校验样本');
  const keptChoice=selected()==='精选'&&chosenFold.open&&chosenFold===find(home.querySelector('.fy-home-opportunity'),'精选');
  ctx.state.sectorsDay='2026-11-12';refresh();
  const staleFold=!!find(home,'板块资金')&&!find(home,'板块资金').open;
  const atTime=time=>Date.parse(day+'T'+time+':00+08:00');
  const phaseTab=(trading,time,nextOpenAt)=>{
   const state={trading,now:atTime(time),closeSession:null,marketClock:{day,trading,nextOpenAt},
    auctionObservations:{day,phase:'before-match',indicative:[{...valid,source:'隔离测试',openPct:1,quoteAt:atTime('09:16'),knownAt:atTime('09:16')}]},
    fastStockMoves:{tradeDate:day,checkedAt:atTime('09:16'),items:[{...valid,source:'隔离测试',spanMs:7000,risePct:1,quoteAt:atTime('09:16')}]}
   };
   const screen=renderTerminalOverview({...ctx,state,onState:()=>{}});
   return [screen.querySelector('.fy-home-stamp').textContent,screen.querySelector('.fy-home-tabs [aria-pressed=true]').textContent];
  };
  return {emptyLabels,available,codes,stayedOpen,restored,keptChoice,staleFold,
   auction:phaseTab(true,'09:18',null),session:phaseTab(true,'10:30',null),lunch:phaseTab(false,'12:00',atTime('13:00'))};
 });
 for(const name of ['精选','市场情绪','市场环境','板块资金','板块资金排行','市场主线','涨停板分类','收盘与策略精选'])
  assert.ok(result.emptyLabels.includes(name),'collapsed evidence status for '+name);
 assert.deepEqual(result.auction,['集合竞价 · 2026-11-13','竞价引力']);
 assert.deepEqual(result.session,['盘中 · 2026-11-13','盘中异动']);
 assert.deepEqual(result.lunch,['午间休市 · 2026-11-13','竞价引力']);
 assert.equal(result.available,'竞价引力');
 assert.deepEqual(result.codes,['000001'],'only a same-day observation already knowable is presented');
 assert.ok(result.stayedOpen&&result.restored&&result.keptChoice&&result.staleFold,'ordinary data updates preserve the disclosure and chosen channel, and show or collapse funds as evidence changes');
}

async function geometry(page,label){
 const result=await page.evaluate(()=>{
  const visible=node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden';};
  const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
  return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
   duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),
   docks:[...document.querySelectorAll('.fy-dock')].filter(visible).length,
   iframeCount:document.querySelectorAll('iframe').length,
   oldShells:document.querySelectorAll('.vx-shell,.vx-sidebar,.workspace-header,#vx-dashboard').length,
   offenders:[...document.querySelectorAll('body *')].filter(visible).map(node=>({tag:node.tagName,cls:typeof node.className==='string'?node.className:'svg',right:node.getBoundingClientRect().right,width:node.getBoundingClientRect().width})).filter(node=>node.right>innerWidth+1).slice(0,15),
   reviewOverflow:[...document.querySelectorAll('[data-close-review] *')].filter(visible)
    .filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,10)
    .map(node=>({tag:node.tagName,className:node.className,right:node.getBoundingClientRect().right})),
   brand:document.querySelector('.fy-header')?.innerText||'',
   brandBox:(()=>{const r=document.querySelector('.fy-brand')?.getBoundingClientRect();return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null;})()};
 });
 assert.ok(result.scrollWidth<=result.width+1,label+' never clips content horizontally: '+JSON.stringify(result));
 assert.deepEqual(result.duplicateIds,[],label+' has no duplicate identities');
 assert.equal(result.iframeCount,0,label+' does not embed a previous page');
 assert.equal(result.oldShells,0,label+' does not retain the previous shell');
 assert.match(result.brand,/天枢智策|绯曜|FAYO/i,label+' the approved V6 product brand is visible');
 assert.ok(result.brandBox&&result.brandBox.top>=-1&&result.brandBox.left>=0&&result.brandBox.right<=result.width+1&&result.brandBox.height>0,label+' new brand mark and name stay in the visible header: '+JSON.stringify(result.brandBox));
 return result;
}
async function checkWorkspaceTabs(page,width){
 const tabs=page.locator('.fy-reference-topnav');
 const labels=await tabs.locator('[data-workspace-tab]').evaluateAll(nodes=>nodes.map(node=>node.dataset.workspaceTab));
 assert.deepEqual(labels,['大盘','机会','我的票','提醒','复盘']);
 // A deep link has no click that would bring its button into view for us.
 for(const route of ['lab/shortline-pressure','settings/release']){
  await page.evaluate(path=>{location.hash='#/'+path;},route);
  await page.waitForFunction(path=>document.querySelector('.fy-workspace-nav [aria-current]')?.dataset.workspaceRoute===path,route);
  for(const strip of [tabs,page.locator('.fy-workspace-nav')]){
   assert.equal(await strip.evaluate(nav=>{
    const area=nav.getBoundingClientRect(),tab=nav.querySelector('[aria-current]').getBoundingClientRect();
    return tab.left>=area.left-1&&tab.right<=area.right+1;
   }),true,width+'px deep link reveals the active tab for '+route);
  }
 }
 const security=page.locator('[data-workspace-route="settings/security"]');
 await security.focus();await security.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.fy-workspace-nav [aria-current]')?.dataset.workspaceRoute==='settings/security');
 assert.ok(await security.evaluate(node=>node===document.activeElement),'switching within a workspace keeps keyboard focus');
 const home=page.locator('.fy-dock [data-workspace-tab="大盘"]');
 if(await home.isVisible()){
  await home.click();
  await page.waitForFunction(()=>document.querySelector('.fy-reference-shell').dataset.workspace==='首页');
  assert.ok(await tabs.evaluate(nav=>nav.querySelector('[aria-current]').getBoundingClientRect().left>=nav.getBoundingClientRect().left),
   'using the mobile dock brings the first tab back on screen');
 }
 const grouped=[];
 for(const [label,branch] of [...labels.map(label=>[label,null]),['复盘','lab/strategies'],['大盘','pulse/sectors']]){
  const openParent=async()=>{
   await tabs.locator('[data-workspace-tab="'+label+'"]').click();
   if(branch)await page.locator('[data-workspace-route="'+branch+'"]').click();
   await page.waitForFunction(value=>document.querySelector('.fy-reference-topnav [aria-current]')?.dataset.workspaceTab===value&&
    !!document.querySelector('.fy-main>:not(.fy-loading)'),label);
  };
  await openParent();
  assert.equal(await tabs.locator('[data-current="true"]').count(),1);
  assert.equal(await tabs.locator('[data-current="true"]').getAttribute('data-workspace-tab'),label);
  assert.doesNotMatch(await page.locator('.fy-main').innerText(),/该工作空间暂时未能打开/);
  await geometry(page,'workspace-'+label+'-'+width);
  await page.screenshot({path:path.join(output,'workspace-'+label+'-'+width+'.png'),fullPage:false});
  if(branch==='pulse/sectors'){
   const summary=page.getByText('查看四大指数原始回执',{exact:true});
   const evidence=page.locator('details').filter({has:summary});
   const count=requests.filter(r=>r.path==='/api/reference-indexes').length;
   await summary.click();await evidence.locator('.fy-index-receipt-row').getByText('上证指数',{exact:true}).waitFor();
   assert.match(await evidence.locator('[role="status"]').innerText(),/合成指数回执 · 1 个指数有原始报价 · 取回于/);
   const risk=page.locator('.fy-overview-risk'),card=await risk.elementHandle();
   phase='radar-refresh';
   await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   await risk.getByText('7 只',{exact:true}).waitFor();
   assert.ok(await card.evaluate(node=>node.isConnected),'market updates keep the existing radar card');
   assert.ok(await evidence.evaluate(node=>node.open),'the raw receipt stays open through state refresh');
   assert.equal(requests.filter(r=>r.path==='/api/reference-indexes').length,count+1,'a state tick reuses the opened receipt');
   phase='normal';
  }
  const nav=page.locator('.fy-workspace-nav');
  const routes=await nav.locator('[data-workspace-route]').evaluateAll(nodes=>nodes.map(node=>node.dataset.workspaceRoute));
  assert.equal(new Set(routes).size,routes.length,'each destination appears once within '+label);
  if(await nav.isVisible()){
   for(const child of routes){
    if(!await nav.locator('[data-workspace-route="'+child+'"]').count())await openParent();
    await nav.locator('[data-workspace-route="'+child+'"]').click();
    await page.waitForFunction(value=>location.hash==='#/'+value&&
     document.querySelector('.fy-workspace-nav [aria-current="page"]')?.dataset.workspaceRoute===value&&
     !!document.querySelector('.fy-main>:not(.fy-loading)'),child);
    assert.ok(['lab/strategies','settings/channels','opportunities/scan'].includes(child)||await tabs.locator('[data-current="true"]').getAttribute('data-workspace-tab')===label);
    assert.doesNotMatch(await page.locator('.fy-main').innerText(),/该工作空间暂时未能打开/);
    if(child==='assets/paper'){
     await page.getByRole('img',{name:'模拟账户已实现收益曲线'}).waitFor();
     assert.match(await page.locator('.fy-observed-line figcaption').first().innerText(),/345.67/);
    }
    if(child==='inbox/all')await page.getByText(/私密飞书 · 未配置/).waitFor();
    if(child==='lab/strategies'){
     const rules=page.locator('.fy-strategy-workbenches>section').first();
     await rules.getByText('自动采集测试股票',{exact:false}).first().waitFor();
     assert.equal(await rules.getByText('2 / 4 项有证据',{exact:true}).count(),4);
     assert.equal(await page.locator('.fy-main input[type="file"]:visible').count(),0);
    }
    await geometry(page,'workspace-'+child+'-'+width);
   }
  }
  grouped.push({label,routes});
 }
 return grouped;
}
const runChecks=async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 const report=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  const origin='http://127.0.0.1:'+server.address().port;
  const widths=process.env.FAYO_UI_WIDTHS?process.env.FAYO_UI_WIDTHS.split(',').map(Number) :[320,390,402,768,1366,1920];
  for(const width of widths){
   phase='normal';role='edit';
   const context=await browser.newContext({
    viewport:{width,height:width===402?874:width<500?900:1000},
    deviceScaleFactor:width===402?3:1,isMobile:width===402,hasTouch:width===402,
    serviceWorkers:'block'
   });
   await context.addInitScript(()=>{localStorage.setItem('qd_device','fayo-synthetic-session');localStorage.setItem('qd_role','edit');});
   const page=await context.newPage(),errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){external.push(url.href);return route.abort();}return route.continue();});
   const before=requests.length;
   const streamRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/stream');
   await page.goto(origin+(width<500?'/m':'/'));
   await page.locator('.fy-header').waitFor({state:'visible'});
   assert.equal(await page.title(),'绯曜 FAYO · 投资研究空间');
   assert.equal(await page.locator('.fy-brand strong').innerText(),'绯曜 FAYO');
   assert.equal(await page.locator('.fy-brand small').innerText(),'投资研究空间');
   await page.locator('.fy-home-opportunity .fy-home-stock').first().waitFor({state:'visible'});
   const deployment=page.getByRole('link',{name:'部署交接文档',exact:true});
   assert.equal(await deployment.getAttribute('href'),'https://github.com/solviq87-cpu/v6-stock-system/blob/dev/DEPLOYMENT.md');
   assert.equal(await deployment.getAttribute('rel'),'noopener noreferrer');
   const deploymentBox=await deployment.boundingBox();
   assert.ok(deploymentBox&&deploymentBox.y>=0&&deploymentBox.y+deploymentBox.height<=page.viewportSize().height,'editor opens the deployment guide from the first screen at '+width);
   const stream=await streamRequest;
   assert.equal(stream.headers()['x-qd-token'],'fayo-synthetic-session','stream also authenticates when the gateway owns Authorization');
   assert.ok(!new URL(stream.url()).searchParams.has('token'),'stream credentials stay in headers');
   assert.equal(await page.locator('.fy-nav [data-fy-route]').count(),5,'five entirely new primary workspaces');

   if(width===402)await checkHomeUpdates(page);
   const focusTexts=await page.locator('.fy-terminal-priority').allTextContents();
   assert.equal(focusTexts.length,4,'overview answers market, opportunity, risk and next-action questions');
   assert.match(focusTexts[0],/最近交易日快照/,'closed-market snapshot must not be called live');
   assert.match(focusTexts[1],/复盘明细 3 条/,'opportunity count is sourced from the retained review');
   assert.match(focusTexts[2],/原始报价须逐股核验/,'matched totals do not certify live prices');
   assert.match(focusTexts[3],/查看机会证据/,'next action opens research, not a trade');
   const moreResearch=page.locator('.fy-home-research > summary');
   assert.equal(await page.locator('.fy-home-research').evaluate(e=>e.open),false);
   await moreResearch.click();
   const secondaryDetails=page.locator('details.fy-terminal-quick');
   assert.equal(await secondaryDetails.evaluate(element=>element.open),false,'secondary business tools begin collapsed');
   await secondaryDetails.locator('summary').click();
   assert.equal(await secondaryDetails.locator('.fy-terminal-shortcuts button').count(),12,
    'all original business quick routes remain available through disclosure');
   await secondaryDetails.locator('summary').click();
   assert.equal(await secondaryDetails.evaluate(element=>element.open),false,
    'business disclosure closes without altering permissions or route');

   await moreResearch.click();
   // The disclosure interaction may scroll the page. Capture the actual first fold,
   // not a convenient mid-page viewport that silently misses the key decisions.
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   await page.waitForFunction(()=>Math.abs(window.scrollY)<1);
   assert.equal(await page.title(),'绯曜 FAYO · 投资研究空间');
   assert.equal(await page.locator('meta[name="frontend-revision"]').getAttribute('content'),'battle-20261125-1');
   const battle=page.locator('[data-battle-home]');
   assert.equal(await battle.count(),1,'the current home includes the decision workbench');
   assert.match(await battle.locator('.fy-battle-empty').innerText(),/今天空仓，等待信号/,
    'historical synthetic fixtures never become live buy candidates');
   const featured=page.locator('.fy-home-featured');
   assert.equal(await featured.locator('button:visible').count(),3);
   assert.deepEqual(await featured.locator('button').evaluateAll(nodes=>nodes.map(n=>n.dataset.code)),stocks.slice(0,3).map(x=>x.code));
   assert.match(await featured.innerText(),/系统精选 · 3 只/);
   await featured.locator('button').nth(2).click();
   const symbolLens=page.getByRole('dialog',{name:'股票研究面板'});
   await symbolLens.getByRole('heading',{name:'分时走势'}).waitFor();
   await symbolLens.getByRole('img',{name:'原始分时价格'}).waitFor();
   await symbolLens.getByText('所属题材 · 隔离测试题材').waitFor();
   await symbolLens.locator('.fy-drawer-summary').getByText(/近期公告/).waitFor();
   assert.match(await symbolLens.locator('.fy-drawer-title').innerText(),/600103/);
   await page.keyboard.press('Escape');
   if(width<500)assert.equal(await page.locator('.fy-dock [data-fy-route]').count(),5);
   const metrics=await geometry(page,'pulse-'+width);
   const regions=await page.locator('.fy-home-layout').evaluate(home=>{
    const box=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,width:r.width};};
    return {headings:[...home.querySelectorAll(':scope > .fy-home-section')].map(el=>el.getAttribute('aria-label')),
     market:box(home.querySelector('.fy-home-market')),opportunity:box(home.querySelector('.fy-home-opportunity')),
     risk:box(home.querySelector('.fy-home-risk')),more:box(home.querySelector('.fy-home-research')),
     indices:[...home.querySelectorAll('.fy-home-indices article')].map(box),
     sourceCount:home.querySelectorAll('.fy-home-research .fy-terminal-stat').length,
     up:getComputedStyle(home.querySelector('.fy-overview-index.fy-positive')).color,
     down:getComputedStyle(home.querySelector('.fy-overview-index.fy-negative')).color};
   });
   fs.writeFileSync(path.join(output,'fayo-layout-'+width+'.json'),JSON.stringify(regions,null,2));
   assert.deepEqual(regions.headings,['大盘一眼看','今日机会','风险与持仓']);
   assert.equal(regions.indices.length,3);
   assert.ok(regions.indices.every(b=>b.top===regions.indices[0].top&&b.width>70));
   assert.equal(regions.sourceCount,8);
   assert.ok(regions.market.bottom<=regions.opportunity.top&&regions.more.top>=regions.risk.bottom);
   if(width>=1000)assert.equal(regions.opportunity.top,regions.risk.top);
   else assert.ok(regions.opportunity.bottom<=regions.risk.top);
   if(width===1366)assert.ok(regions.risk.width>0&&regions.risk.bottom>regions.risk.top,
    'the original risk panel remains available below the new decision workbench');
   const rgb=v=>v.match(/\d+/g).slice(0,3).map(Number);
   const [rr,rg]=rgb(regions.up),[gr,gg]=rgb(regions.down);
   assert.ok(rr>rg&&gg>gr,'index quotes retain red-up / green-down semantics');
   if(width>=1360){
    const rail=await page.evaluate(()=>{
     const nav=document.querySelector('.fy-business-nav');
     const main=document.querySelector('.fy-main');
     const a=nav.getBoundingClientRect(),b=main.getBoundingClientRect();
     return {position:getComputedStyle(nav).position,left:a.left,right:a.right,width:a.width,
      mainLeft:b.left,navButtons:nav.querySelectorAll('button').length};
    });
    assert.equal(rail.width,0,'daily workspace uses five shared destinations');
    assert.ok(rail.navButtons>=11,'original routes remain in the feature catalog');
   }
   await page.screenshot({path:path.join(output,'fayo-pulse-'+width+'.png'),fullPage:false});
   if(width===390||width===1440){
    const beforePicks=requests.length;
    await page.getByRole('button',{name:'查看全部推荐 →',exact:true}).click();
    await page.getByRole('heading',{name:'系统精选',exact:true}).waitFor();
    const selected=page.locator('[aria-label="系统精选股票"]');
    await selected.locator('[data-code="600101"]').waitFor();
    assert.equal(await page.locator('.fy-workspace-nav button').first().textContent(),'系统精选');
    const pick=selected.locator('[data-code="600101"]');
    assert.match(await pick.locator('[data-sector-leadership="early-spread"]').textContent(),/先封后扩散/);
    await pick.click();
    const lens=page.getByRole('dialog',{name:'股票研究面板'});
    await lens.getByRole('button',{name:'查看完整校验'}).waitFor();
    assert.match(await lens.locator('.fy-drawer-shortline').innerText(),/暂缓开仓/);
    const beforeLeadership=requests.length;
    await lens.getByRole('button',{name:'带动性',exact:true}).click();
    const panel=lens.locator('[data-leadership-panel]');
    assert.match(await panel.innerText(),/本股首封 09:25:00.*晚于本股 4 只/);
    assert.match(await panel.innerText(),/财联社同日收录 · 本股已收录 · 同业 1 \/ 4 只/);
    await panel.getByText('查看随后封板的同业',{exact:true}).click();
    assert.match(await panel.locator('ul').innerText(),/合成同业1 601101 · 09:31:05/);
    assert.ok(requests.slice(beforeLeadership).every(entry=>['/api/state','/api/kline'].includes(entry.path)&&entry.method==='GET'),
     'stock leadership reads the shared state and never starts an additional scan');
    await lens.locator('.fy-tabs').evaluate(tabs=>{tabs.scrollLeft=0;});
    await page.screenshot({path:path.join(output,'fayo-leadership-'+width+'.png'),fullPage:false});
    await lens.getByRole('button',{name:'关闭股票研究面板'}).click();
    await page.locator('.fy-toast').waitFor({state:'hidden'});
    phase='system-picks-refresh';
    await page.getByRole('button',{name:'刷新结果',exact:true}).click();
    await selected.locator('[data-code="600199"]').waitFor();
    assert.equal(await pick.locator('[data-sector-leadership="pending"]').count(),0,'an unverified sector inference is omitted from the pick');
    assert.doesNotMatch(await pick.innerText(),/待评估/);
    assert.match(await page.locator('[data-system-picks-read-time]').textContent(),/最近读取 \d/);
    assert.equal(await page.locator('.fy-toast').isVisible(),false,'system pick refresh reports inline without covering the results');
    assert.ok(requests.slice(beforePicks).some(entry=>entry.path==='/api/state'&&entry.method==='GET'));
    assert.ok(!requests.slice(beforePicks).some(entry=>['/api/quant-picks','/api/intraday-strong','/api/refresh'].includes(entry.path)),
     'opening and refreshing system picks only reads the shared state');
    phase='normal';
    await navigate(page,'opportunities','movement');
    const fastMoves=page.locator('[data-fast-stock-moves]');
    await fastMoves.waitFor({state:'visible'});
    assert.match(await fastMoves.innerText(),/有效报价 8 \/ 12 只 · 可比较 5 只/);
    assert.match(await fastMoves.innerText(),/\+1\.65% \/ 8 秒/);
    assert.match(await fastMoves.innerText(),/历史观察/);
    const moveSummary=page.getByText('重点股 · 近一分钟涨速',{exact:true});
    await moveSummary.click();await fastMoves.waitFor({state:'hidden'});
    await moveSummary.click();await fastMoves.waitFor({state:'visible'});
    const fresh=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fast-stock-moves');
    await fresh;
    await fastMoves.locator('[data-fast-read-time]').waitFor();
    await fastMoves.getByText('采集质量与限流',{exact:true}).click();
    assert.match(await fastMoves.innerText(),/中位 1\.5 秒/);
    await fastMoves.getByText(/该快照前的近期异动/).click();
    const hit=fastMoves.getByRole('button',{name:'合成光谱3 600103'});
    await hit.click();
    await lens.locator('[data-detail-tab="evidence"]').click();
    assert.match(await lens.innerText(),/近一分钟异动/);
    assert.match(await lens.innerText(),/涨停原因/);
    await lens.getByRole('button',{name:'关闭股票研究面板'}).click();
    await page.locator('.fy-toast').waitFor({state:'hidden'});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(output,'fayo-fast-stock-moves-'+width+'.png'),fullPage:false});
    await navigate(page,'pulse','overview');
    await page.locator('.fy-reference-home').waitFor();
   }
   assert.match(await page.locator('.fy-reference-account-values').innerText(),/100,000\.00/);
   await moreResearch.click();
   const fundPanel=page.locator('.fy-reference-funds');
   await fundPanel.getByRole('button',{name:'资金流出榜',exact:true}).click();
   await fundPanel.locator('.fy-reference-flow .fy-negative').waitFor({state:'visible'});
   assert.match(await fundPanel.locator('.fy-reference-flow').innerText(),/合成材料/);
   await fundPanel.getByRole('button',{name:'资金流入榜',exact:true}).click();
   await fundPanel.locator('.fy-reference-flow .fy-positive').waitFor({state:'visible'});
   assert.match(await fundPanel.locator('.fy-reference-flow').innerText(),/合成能源/);
   // User-provided first reference: real dedicated daily-review route, same data and session.
   const beforeReview=requests.length;
   await navigate(page,'pulse','review');
   const closeReview=page.locator('[data-close-review]');
   await closeReview.waitFor({state:'visible'});
   assert.match(await closeReview.locator('h1').innerText(),/A 股收盘复盘/);
   assert.equal(await closeReview.locator('[data-review-section]').count(),6,'all six review cards are present');
   await closeReview.getByText('0 只可晋级',{exact:true}).waitFor();
   assert.equal(await closeReview.locator('[data-review-section="mood"] .fy-close-kpi').count(),7);
   const columns=await closeReview.locator('.fy-close-grid').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
   assert.equal(columns,width>780?2:1,'the review card grid is active in ordinary browser mode');
   const metricColumns=await closeReview.locator('.fy-close-kpis').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
   assert.equal(metricColumns,width<=450?2:width<=780?3:width<=1120?4:7,'market cards follow viewport-aware columns');

   await closeReview.getByRole('combobox',{name:'复盘交易日'}).selectOption('2026-11-12');
   await closeReview.locator('.fy-close-level button').nth(27).waitFor();
   assert.equal(await closeReview.locator('.fy-close-level button').count(),28,'the archive preserves the full sourced pool');
   assert.match(await closeReview.locator('[data-review-section="mood"]').innerText(),/28 \/ 9/);
   assert.doesNotMatch(await closeReview.locator('[data-review-section="mood"]').innerText(),/退潮|合成能源/);
   await geometry(page,'close-review-'+width);
   await page.screenshot({path:path.join(output,'fayo-reference-review-'+width+'.png'),fullPage:true});
   await closeReview.locator('.fy-close-level').getByRole('button',{name:'归档合成1',exact:true}).click();
   let reason=closeReview.locator('[data-reason-selected]');
   await reason.getByText('合成归档依据甲',{exact:true}).waitFor();
   assert.match(await reason.innerText(),/09:36:24/);
   await closeReview.locator('.fy-close-level').getByRole('button',{name:'归档合成2',exact:true}).click();
   await reason.getByText('合成归档依据乙',{exact:true}).waitFor();
   const seats=closeReview.locator('[data-review-section="seats"]');
   await seats.getByRole('button',{name:'机构专用',exact:true}).click();
   assert.equal(await seats.locator('li').count(),4);
   assert.doesNotMatch(await seats.locator('li').allTextContents().then(rows=>rows.join('')),/深股通专用/);
   const reviewDate=closeReview.getByRole('combobox',{name:'复盘交易日'});
   returnRetainedReview=false;
   await reviewDate.selectOption('cloud');
   await closeReview.locator('[data-reason-selected]').getByText('合成同日原版理由',{exact:true}).waitFor();
   assert.match(await closeReview.locator('[data-review-section="mood"]').innerText(),/50\.0%/);
   assert.match(await closeReview.locator('[data-review-section="ladder"]').innerText(),/合成光谱2/);
   assert.doesNotMatch(await closeReview.locator('[data-review-section="ladder"]').innerText(),/盛剑科技/);
   await closeReview.locator('.fy-close-level').getByRole('button',{name:'合成光谱1',exact:true}).click();
   assert.equal(await closeReview.locator('[data-reason-selected]').evaluate(node=>node===document.activeElement),true);
   returnRetainedReview=true;
   await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   await closeReview.locator('[data-reason-selected]').getByText('合成同日源端更新的理由',{exact:true}).waitFor();
   await closeReview.locator('[data-retained-review]').waitFor();
   assert.match(await closeReview.locator('[data-retained-review]').innerText(),/涨停池、北向成交/);
   assert.equal(await closeReview.locator('[data-reason-selected]').evaluate(node=>node===document.activeElement),true,
    'same-day recovery retains the selected reason and its keyboard focus');
   returnRetainedReview=false;
   if(width===390||width===1366){
    phase='close-outage';
    const cold=await context.newPage();
    await cold.goto(origin+'/#/pulse/review');
    await cold.locator('.fy-close-status').filter({hasText:'2026-11-12 · 已存收盘 · 正在补采 2026-11-13'}).waitFor();
    assert.equal(await cold.locator('.fy-close-level button').count(),28);
    phase='normal';
    await cold.evaluate(()=>window.dispatchEvent(new Event('online')));
    await cold.locator('[data-reason-selected]').getByText('合成同日原版理由',{exact:true}).waitFor();
    assert.equal(await cold.locator('.fy-close-level button').count(),1);
    await cold.close();await page.bringToFront();
   }
   await closeReview.locator('.fy-close-more > summary').click();
   await closeReview.locator('.fy-reference-review-footer').waitFor();
   assert.equal(await closeReview.locator('.fy-reference-review-footer .fy-reference-mini-module').count(),6,
    'existing research shortcuts remain available');
   const reviewStats=closeReview.locator('.fy-close-more .fy-terminal-stats');
   if(width<=430){
    const boxes=await reviewStats.locator('.fy-terminal-stat').evaluateAll(cards=>cards.map(card=>{
     const rect=card.getBoundingClientRect();return {top:rect.top,width:rect.width};
    }));
    assert.equal(boxes[0].top,boxes[2].top,'phone review groups the total, first and continued counts on row one');
    assert.ok(boxes[0].width>boxes[1].width*1.8&&boxes[3].top>boxes[0].top,'the total card is wide and the other four counts are below: '+JSON.stringify(boxes));
   }
   const filters=page.locator('.fy-reference-review-filters');
   await filters.getByRole('button',{name:'首板 3',exact:true}).click();
   assert.equal(await filters.getByRole('button',{name:'首板 3',exact:true}).getAttribute('aria-pressed'),'true');
   await filters.getByRole('button',{name:'有开板记录 0',exact:true}).click();
   await page.getByText('该筛选下暂无复盘记录',{exact:true}).waitFor({state:'visible'});
   await filters.getByRole('button',{name:'全部 3',exact:true}).click();
   assert.equal(await closeReview.locator('.fy-close-more .fy-terminal-mobile-stock').count(),3);
   if(width===390||width===1440){
    const stock=closeReview.locator('.fy-close-more').getByRole('button',{name:'合成光谱1 600101',exact:true}).filter({visible:true});
    await stock.click();
    const lens=page.getByRole('dialog',{name:'股票研究面板'});
    await lens.getByRole('button',{name:'带动性',exact:true}).click();
    assert.match(await lens.locator('[data-sector-leadership="early-spread"]').innerText(),/先封后扩散/);
    await lens.getByRole('button',{name:'关闭股票研究面板'}).click();
   }
   await closeReview.locator('.fy-close-more > summary').click();
   const reviewWrites=requests.slice(beforeReview).filter(r=>r.method!=='GET');
   assert.ok(reviewWrites.every(r=>automaticResearchRead(r)&&r.body.payload.code==='600101')&&reviewWrites.length<=1,
    'only the opened stock can archive a shortline observation; review navigation does not trade, scan, push or mutate accounts');
   await navigate(page,'pulse','overview');
   await page.locator('.fy-home-market').waitFor({state:'visible'});
   if(width===402){
    const initial=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,scroll:scrollY,
     indexTop:document.querySelector('.fy-home-indices').getBoundingClientRect().top,
     dock:getComputedStyle(document.querySelector('.fy-dock')).position}));
    assert.equal(initial.width,402);assert.equal(initial.dpr,3);assert.equal(initial.scroll,0);
    assert.ok(initial.indexTop<page.viewportSize().height*.7);
    assert.equal(initial.dock,'fixed');
    await moreResearch.click();
    await page.locator('.fy-reference-home-details > summary').click();
    assert.ok(await page.locator('.fy-terminal-mobile-stock:visible').count()>=3);
    assert.equal(await page.locator('.fy-terminal-desktop-table').isVisible(),false);
    await moreResearch.click();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.setViewportSize({width:402,height:714});
    await geometry(page,'iphone17pro-safari-compact-402x714');
    await page.screenshot({path:path.join(output,'iphone17pro-402x714.png'),fullPage:false});
    await page.setViewportSize({width:874,height:402});
    await geometry(page,'iphone17pro-landscape-874x402');
    await page.screenshot({path:path.join(output,'iphone17pro-landscape-874x402.png'),fullPage:false});
    await page.setViewportSize({width:402,height:874});
    await moreResearch.click();
    phase='coverage-gap';
    await page.locator('.fy-header button[aria-label="刷新云端数据"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-focus="risk"]')?.textContent.includes('源端覆盖不完整'));
    assert.match(await page.locator('[data-focus="risk"]').innerText(),/37|33/,'source mismatch is never presented as a verified total');
    assert.match(await page.locator('[data-focus="next"]').innerText(),/核对复盘缺口/,'missing upstream members changes the next step to review');
    phase='normal';
    await page.locator('.fy-header button[aria-label="刷新云端数据"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-focus="risk"]')?.textContent.includes('原始报价须逐股核验'));
   }
   await navigate(page,'opportunities','quant');
   await page.waitForFunction(()=>document.querySelectorAll('.fy-pool-board .fy-stock-card').length===8);
   assert.equal(await page.locator('.fy-main h1').innerText(),'量化发现');
   assert.equal(await page.title(),'绯曜 FAYO · 投资研究空间');
   if(width<=700){
    const positions=await page.getByRole('navigation',{name:'常用卡片'}).getByRole('button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
    assert.ok(positions.length===4&&positions[0]===positions[1]&&positions[2]===positions[3]&&positions[0]<positions[2],'four mobile shortcuts fit into two rows');
   }
   assert.equal(await page.locator('.fy-stage-chip').count(),3,'all three workflow stage counts remain visible');
   assert.equal(await page.locator('.fy-pool-column').count(),1,'only populated stages consume card space');
   assert.equal(await page.locator('.fy-pool-column .fy-empty').count(),0,'empty stage panels never push actual opportunities below the fold');
   assert.match(await page.locator('.fy-main').innerText(),/2026[-/]11[-/]13/,'Friday source date remains visible');
   assert.equal(await page.locator('img[src="x"]').count(),0,'provider names are text, never executable markup');
   assert.equal(await page.evaluate(()=>window.fayoInjected),undefined,'provider strings cannot execute');
   await geometry(page,'opportunities-'+width);
   await page.locator('.fy-toast').waitFor({state:'hidden'});
   await page.screenshot({path:path.join(output,'fayo-opportunities-'+width+'.png'),fullPage:false});

   const originCard=page.locator('.fy-stock-card[data-code="600101"]').first();
   await page.getByRole('searchbox',{name:'筛选股票池',exact:true}).focus();
   await originCard.evaluate(node=>node.click()); // Touch browsers can activate a card without focusing it.
   const drawer=page.locator('.fy-stock-drawer');
   await drawer.waitFor({state:'visible'});
   assert.equal(await drawer.locator('.fy-drawer-quote strong').innerText(),'11.11');
   if(width===402){
    await originCard.evaluate(node=>{window.poolCardBeforeQuotePoll=node;});
    await page.waitForResponse(r=>r.url().endsWith('/api/state'));
    assert.equal(await originCard.evaluate(node=>node===window.poolCardBeforeQuotePoll&&node.isConnected),true);
    assert.equal(await drawer.locator('.fy-drawer-quote strong').innerText(),'11.11',
     'rereading the same dashboard observation keeps the selected pool quote');
   }
   const beforeQuoteChecks=requests.filter(entry=>entry.path==='/api/quote-cross-check').length;
   await drawer.locator('.fy-chart svg').waitFor({state:'visible'});
   assert.match(await drawer.locator('.fy-quote-time').innerText(),/2026[-/]11[-/]13/,'drawer preserves original provider date');
   assert.match(await drawer.locator('.fy-quote-time').innerText(),/synthetic-friday-provider/,'drawer shows original provider');
   assert.match(await drawer.locator('.fy-quote-time').innerText(),/历史/,'old prices are explicitly historical');
   assert.equal(await drawer.locator('[data-period]').count(),3,'day, month and year controls remain real interactions');
   for(const period of ['month','year','day']){
    await drawer.locator('[data-period="'+period+'"]').click();
    assert.equal(await drawer.locator('[data-period="'+period+'"]').getAttribute('aria-pressed'),'true','period selection is explicit');
    await drawer.locator('.fy-chart svg').waitFor({state:'visible'});
   }
   const priorPages=requests.filter(r=>r.path==='/api/kline').length;
   await drawer.getByRole('button',{name:'加载更早的历史',exact:true}).click();
   await page.waitForTimeout(80);
   assert.ok(requests.filter(r=>r.path==='/api/kline').length>priorPages,'older history reads actual service pages');
   assert.ok(requests.some(r=>r.path==='/api/kline'&&r.query.end),'history pagination uses an older-date boundary');
   // Drive the real state-refresh listener while focus is inside the drawer.
   // The same stock button stays connected while the quote updates behind the drawer.
   await originCard.evaluate(node=>{window.drawerOriginBeforeRefresh=node;});
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/state')),page.evaluate(()=>document.querySelector('button[aria-label="刷新云端数据"]').click())]);
   assert.equal(await originCard.evaluate(node=>node===window.drawerOriginBeforeRefresh&&node.isConnected),true);
   await drawer.locator('[data-detail-tab="evidence"]').click();
   assert.equal(await drawer.locator('.fy-drawer-quote strong').innerText(),'12.30');
   assert.match(await drawer.innerText(),/仅此选股池保存的合成依据/,'cloud refresh cannot swap the selected pool evidence for the homepage row');
   assert.equal(requests.filter(entry=>entry.path==='/api/quote-cross-check').length,beforeQuoteChecks,'shared refresh cannot start public quotation checks');
   await drawer.locator('[data-detail-tab="sources"]').click();
   await drawer.getByRole('button',{name:'核对报价',exact:true}).click();
   await drawer.getByText(/来源价格或时点有冲突/).waitFor();
   assert.ok(requests.some(entry=>entry.path==='/api/quote-cross-check'&&entry.method==='POST'&&entry.query.code==='600101'));
   await drawer.getByRole('button',{name:'读取推送避险状态',exact:true}).click();
   await drawer.getByText(/当前利空命中/).waitFor();
   assert.match(await drawer.innerText(),/板块关联 合成能源/);
   await drawer.locator('[data-detail-tab="chart"]').click();
   await page.screenshot({path:path.join(output,'fayo-stock-lens-'+width+'.png'),fullPage:false});
   await drawer.press('Escape');
   assert.equal(await drawer.isVisible(),false,'Escape closes the stock research panel');
   assert.equal(await originCard.evaluate(node=>document.activeElement===node),true,'focus returns to the selected opportunity');
   // Drive an ordinary polling cycle after Escape. The board may repaint, but
   // the focused button must stay connected and continue to open the latest evidence.
   await originCard.evaluate(node=>{
    window.focusedStockAfterEscape=node;window.boardBeforeBackgroundPoll=node.closest('.fy-pool-board');
   });
   await page.waitForResponse(r=>r.url().endsWith('/api/state'));
   await page.waitForFunction(()=>window.boardBeforeBackgroundPoll.isConnected&&document.activeElement===window.focusedStockAfterEscape);
   assert.equal(await originCard.evaluate(node=>node===window.focusedStockAfterEscape&&node===document.activeElement),true,
    'background polling retains the exact focused stock button');
   await originCard.evaluate(node=>{window.drawerOriginAfterClose=node;});
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/state')),page.evaluate(()=>document.querySelector('button[aria-label="刷新云端数据"]').click())]);
   await page.waitForFunction(()=>window.drawerOriginAfterClose?.isConnected===true);
   assert.equal(await originCard.evaluate(node=>document.activeElement===node),true,'the next list refresh preserves the restored stock focus');
   if(width===1366){
    await originCard.click();
    await drawer.locator('[data-detail-tab="marks"]').click();
    await drawer.getByLabel('标记交易日',{exact:true}).fill('2026-11-12');
    holdMarks=true;
    const pendingMarks=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/kline-marks');
    await drawer.getByRole('button',{name:'读取原始标记',exact:true}).click();
    await pendingMarks;
    for(let retry=0;retry<20&&!heldMarksReply;retry++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(typeof heldMarksReply,'function');
    await drawer.getByLabel('标记交易日',{exact:true}).fill('2026-11-13');
    heldMarksReply();heldMarksReply=null;
    await page.waitForTimeout(60);
    assert.doesNotMatch(await drawer.textContent(),/late-marks-wrong-date-must-not-paint/,'changing the date invalidates in-flight signal marks');
    await drawer.locator('[data-detail-tab="analysis"]').click();
    holdAnalysis=true;
    const pendingTab=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/analyze');
    await drawer.getByRole('button',{name:'读取分析',exact:true}).click();
    await pendingTab;
    for(let retry=0;retry<20&&!heldAnalysisReply;retry++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(typeof heldAnalysisReply,'function');
    await drawer.locator('[data-detail-tab="company"]').click();
    heldAnalysisReply();heldAnalysisReply=null;
    await page.waitForTimeout(60);
    assert.match(await drawer.innerText(),/公司原始公告/,'late diagnosis does not paint over a newly selected evidence tab');
    assert.doesNotMatch(await drawer.innerText(),/late-analysis-A-must-not-paint/);
    await drawer.press('Escape');
    await originCard.click();
    await drawer.locator('[data-detail-tab="analysis"]').click();
    holdAnalysis=true;
    const analyzing=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/analyze');
    await drawer.getByRole('button',{name:'读取分析',exact:true}).click();
    await analyzing;
    for(let retry=0;retry<20&&!heldAnalysisReply;retry++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(typeof heldAnalysisReply,'function','diagnosis response is held independently of UI selection');
    await drawer.press('Escape');
    await page.locator('.fy-stock-card[data-code="600102"]').first().click();
    await drawer.locator('.fy-chart svg').waitFor({state:'visible'});
    heldAnalysisReply();heldAnalysisReply=null;
    await page.waitForTimeout(60);
    assert.match(await drawer.locator('.fy-drawer-title').innerText(),/600102/,'late A diagnosis cannot replace selected B');
    assert.equal(await drawer.locator('.fy-chart svg').isVisible(),true,'late A diagnosis cannot replace B chart');
    assert.doesNotMatch(await drawer.innerText(),/late-analysis-A-must-not-paint/,'late private analysis is discarded');
    await drawer.press('Escape');
   }
   const search=page.getByRole('searchbox',{name:'筛选股票池'});
   await search.fill('合成光谱1');
   assert.equal(await page.locator('.fy-pool-board .fy-stock-card').count(),1,'pool search actually filters its cards');
   await search.fill('');
   assert.equal(await page.locator('.fy-pool-board .fy-stock-card').count(),8);

   // A same-session empty response cannot erase Friday's known pool. This
   // covers both /state and the independent quant results, not just a banner.
   phase='empty';
   await page.getByRole('button',{name:'刷新云端数据',exact:true}).click();
   await page.waitForTimeout(100);
   await page.getByRole('button',{name:'读取最新结果',exact:true}).click();
   await page.waitForTimeout(100);
   assert.equal(await page.locator('.fy-pool-board .fy-stock-card').count(),8,'weekend empty replies retain the last valid Friday cards');
   assert.match(await page.locator('.fy-snapshot').innerText(),/2026[-/]11[-/]13/,'the retained dashboard banner keeps its source day when the empty read carries a newer date');
   assert.match(await page.locator('.fy-main').innerText(),/2026[-/]11[-/]13/);
   phase='normal';
   for(const view of ['lab','assets','settings','pulse']){
    await navigate(page,view);
    await page.waitForTimeout(40);
    await geometry(page,view+'-'+width);
   }
   await navigate(page,'assets','ledger');
   await page.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('88,888.88'));
   assert.match(await page.locator('.fy-main').innerText(),/600101/,'ledger reads authoritative accounting.positions');
   assert.match(await page.locator('.fy-main').innerText(),/345\.67/,'ledger reads authoritative realizedPnl');
   await page.screenshot({path:path.join(output,'fayo-ledger-'+width+'.png'),fullPage:false});
   if(width===390){
    await navigate(page,'inbox','all');
    const article=page.locator('.fy-news-item').filter({hasText:'合成周末公告继续更新'});
    await article.getByText('直接关联',{exact:true}).waitFor();
    await article.getByText('板块间接关联（1 只）',{exact:true}).click();
    phase='news-refresh';
    await page.getByRole('button',{name:'刷新资讯',exact:true}).click();
    await page.getByText('合成刷新后的新公告',{exact:true}).waitFor();
    await article.getByRole('button',{name:'合成光谱2 · 合成能源',exact:true}).click();
    phase='normal';
    await drawer.locator('.fy-drawer-title').getByText(/600102/).waitFor();
    await drawer.press('Escape');
   }
   const workspaces=width===390||width===1366?await checkWorkspaceTabs(page,width):null;
   const browsing=requests.slice(before);
   const quoteChecks=browsing.filter(r=>r.path==='/api/quote-cross-check');
   assert.equal(quoteChecks.length,1,'the independent quote comparison requires one explicit request');
   const mutations=browsing.filter(r=>r.method!=='GET'&&!automaticResearchRead(r)&&!(r.path==='/api/research/order-account'&&['read','audit'].includes(r.body?.action))&&!(r.path==='/api/research/paper-account'&&r.body?.action==='read')&&!['/api/online/beat','/api/quote-cross-check'].includes(r.path));
   assert.deepEqual(mutations,[],'normal navigation never submits account, scan, publish or notification actions');
   // A five-second background GET may revoke access before a manual click can
   // start. Wait for the actual authorization gate instead of clicking a
   // button that correctly disappears when the revoked session is cleared.
   const beforeRevocation=requests.length;
   phase='revoked';
   await page.locator('.fy-gate').waitFor({state:'visible',timeout:12000});
   assert.ok(requests.slice(beforeRevocation).some(r=>r.path.startsWith('/api/')),
    'a server denial, not a client-only route change, revokes the session');
   assert.equal(await page.locator('.fy-stock-card').count(),0,'authorization loss removes retained cards, not just their visibility');
   assert.equal(await page.locator('.fy-stock-drawer:visible').count(),0,'authorization loss removes stock lens');
   assert.doesNotMatch(await page.locator('body').innerText(),/合成光谱|88,888\.88/,'private/previous market content clears on revoke');
   assert.equal(await page.evaluate(()=>localStorage.getItem('qd_device')),null,'revoked device token is cleared');
   assert.deepEqual(errors,[],'no application exceptions at '+width);
   assert.deepEqual(external,[],'no third-party data/font/model requests at '+width);
   report.push({width,metrics,workspaces,requests:browsing.length,checks:['new-native-shell','five-workspaces','workflow-board','source-date','three-period-chart','older-history','focus-return','local-filter','weekend-retention','accounting-schema','no-automatic-writes','revocation-clears','no-external-egress']});
   await context.close();
  }
  // Read-only access remains usable without attempting editor endpoints.
  phase='normal';role='view';
  const reader=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
  await reader.addInitScript(()=>{localStorage.setItem('qd_device','fayo-synthetic-reader');localStorage.setItem('qd_role','view');});
  const readPage=await reader.newPage(),readerStart=requests.length;
  await readPage.goto(origin+'/');await readPage.locator('.fy-header').waitFor({state:'visible'});
  await readPage.locator('.fy-reference-home').waitFor({state:'visible'});
  assert.equal(await readPage.getByRole('link',{name:'部署交接文档',exact:true}).count(),0,'viewer has no editor deployment shortcut');
  await readPage.locator('.fy-reference-topnav [data-workspace-tab="机会"]').click();
  await readPage.locator('.fy-workspace-nav [data-workspace-route="opportunities/all"]').waitFor({state:'visible'});
  assert.equal(await readPage.locator('.fy-workspace-nav [data-workspace-route="opportunities/wash"]').count(),0);
  await navigate(readPage,'assets','holdings');
  await readPage.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('私人工作区'));
  await navigate(readPage,'settings','channels');
  await readPage.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('私人工作区'));
  await navigate(readPage,'opportunities','wash');
  await readPage.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('需要开发者权限'));
  assert.equal(await readPage.locator('.fy-header').isVisible(),true,'a restricted tool does not log out an otherwise valid reader');
  const readerRequests=requests.slice(readerStart);
  assert.equal(readerRequests.filter(r=>['/api/holdings','/api/config','/api/wash-trend','/api/paper','/api/lock/devices'].includes(r.path)).length,0,'viewer navigation never attempts protected operations');
  await readPage.screenshot({path:path.join(output,'fayo-readonly-390.png'),fullPage:false});
  await readPage.getByRole('button',{name:'账户与授权',exact:true}).click();
  await readPage.getByRole('dialog',{name:'身份与访问',exact:true}).getByRole('button',{name:'切换登录身份',exact:true}).click();
  await readPage.locator('.fy-gate').waitFor({state:'visible'});
  assert.equal(await readPage.evaluate(()=>localStorage.getItem('qd_device')),null,'switching identity clears the prior device session');
  assert.equal(await readPage.locator('.fy-stock-card,.fy-stock-drawer').count(),0,'switching identity physically clears the previous research views');
  report.push({kind:'readonly',width:390,checks:['restricted-features-explained','no-private-endpoint-attempt','valid-reader-session-retained','native-identity-switch','prior-session-and-views-cleared']});
  await reader.close();

  phase='normal';role='edit';
  const anonymous=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),gatePage=await anonymous.newPage();
  await gatePage.goto(origin+'/');await gatePage.locator('.fy-gate').waitFor({state:'visible'});
  assert.equal(await gatePage.locator('.fy-header').count(),0,'anonymous users receive the new gate before market/account views');
  await gatePage.locator('.fy-gate input[name="password"]').fill('wrong-synthetic-password');
  await gatePage.getByRole('button',{name:'进入绯曜',exact:true}).click();
  await gatePage.waitForFunction(()=>document.querySelector('.fy-gate .fy-note')?.textContent.includes('不匹配'));
  assert.equal(await gatePage.locator('.fy-gate').isVisible(),true,'wrong password never opens the product');
  await gatePage.screenshot({path:path.join(output,'fayo-gate-390.png'),fullPage:false});
  await gatePage.locator('.fy-gate input[name="password"]').fill('synthetic-fayo-password');
  await gatePage.getByRole('button',{name:'进入绯曜',exact:true}).click();
  await gatePage.locator('.fy-header').waitFor({state:'visible'});
  assert.equal(await gatePage.evaluate(()=>localStorage.getItem('qd_device')),'fayo-synthetic-session','successful login uses the issued device token');
  assert.equal(await gatePage.locator('input[type=password]').count(),0,'the login password is removed from mounted product UI');
  assert.equal(await gatePage.evaluate(()=>Object.values(localStorage).some(value=>value.includes('synthetic-fayo-password'))),false,'password is never persisted as browser state');
  report.push({kind:'fresh-login',width:390,checks:['new-gate','wrong-password-denied','real-login-form','token-only-persistence','password-cleared']});
  await anonymous.close();

  const oldResources=resources.filter(resource=>/\/assets\/(?:app|terminal-dashboard|unified-workspace|original-workspace|v6-design|reference-match)\.(?:js|css)/.test(resource));
  assert.deepEqual(oldResources,[],'new frontend never loads the previous frontend');
  assert.ok(resources.some(resource=>resource.startsWith('/nova/app.js'))&&resources.some(resource=>resource.startsWith('/nova/fayo.css')),'the actual new product assets loaded');
  fs.writeFileSync(path.join(output,'fayo-browser-report.json'),JSON.stringify({scope:'real new FAYO modules and CSS; synthetic isolated HTTP only; no actual account/market/physical-device certification',report,requests,resources},null,2));
  console.log('FAYO native product: '+report.length+' scenarios across '+widths.length+' viewport widths passed; report and synthetic-data screenshots '+output);
 }finally{if(heldAnalysisReply){heldAnalysisReply();heldAnalysisReply=null;}if(heldMarksReply){heldMarksReply();heldMarksReply=null;}await browser?.close();await new Promise(resolve=>server.close(resolve));}
};
if(require.main===module)runChecks().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
module.exports={server,state,stocks,indices,candles,requests,resources,output,aliases,get phase(){return phase;},set phase(value){phase=value;},get role(){return role;},set role(value){role=value;}};
