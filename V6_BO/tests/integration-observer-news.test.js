'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
const source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8'),serverRequire=createRequire(path.resolve(__dirname,'../server.js'));
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'integration-observer-news-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function queueFunction(root){
 const start=source.indexOf('function queuePushedStockObservations('),end=source.indexOf('// Funds evidence:',start);
 return new Function('getStockObservationMonitor','process','require','path','__dirname',source.slice(start,end)+'\nreturn queuePushedStockObservations;')(
  ()=>({wake(){}}),{env:{V6_STOCK_OBSERVATION_QUEUE_DIR:root}},serverRequire,path,path.resolve(__dirname,'..'));
}
test('actual push observer retains the frozen signal hash in the durable queue and preserves legacy unknown identity',t=>{
 const root=path.join(temporary(t),'queue'),enqueue=queueFunction(root),at=Date.now()-1000,id='a'.repeat(64);
 enqueue('fixture body',['600000'],{signalRefs:[{code:'600000',type:'pool',ts:at,signalId:id},{code:'600000',type:'trend',ts:at}]});
 const file=path.join(root,'intents','000001.json'),record=JSON.parse(fs.readFileSync(file));
 assert.equal(record.intent.signalRefs.find(r=>r.type==='pool').id,id);
 assert.equal(record.intent.signalRefs.find(r=>r.type==='trend').id,undefined);
 const queue=require('../src/core/stock-observation-queue').readStockObservationQueue(root);assert.equal(queue.counts.total,1);
 assert.equal(queue.completed.length,0);assert.equal(record.canTrade,false);
});
function newsStats(stocks){
 const start=source.indexOf('const statOf = codes => {'),end=source.indexOf('const relCodeMap =',start);
 return new Function('S','A','fundsNumber',source.slice(start,end)+'\nreturn statOf;')({stocks},{isLimitUp:(_code,_name,pct)=>pct>=10},v=>typeof v==='number'&&Number.isFinite(v)?v:null);
}
test('actual news statistics preserve missing pct/funds while true zero remains valid',()=>{
 let stats=newsStats([{code:'600000',price:10,pct:null,mainInflow:null}])(['600000']);
 assert.equal(stats.avgPct,null);assert.equal(stats.mainSum,null);assert.equal(stats.up,null);assert.equal(stats.limit,null);
 assert.deepEqual(stats.availability,{pctKnown:0,fundsKnown:0,total:1,pctComplete:false,fundsComplete:false});
 stats=newsStats([{code:'600000',price:10,pct:0,mainInflow:0}])(['600000']);
 assert.equal(stats.avgPct,0);assert.equal(stats.mainSum,0);assert.equal(stats.up,0);assert.equal(stats.availability.fundsComplete,true);
 stats=newsStats([{code:'600000',price:10,pct:2,mainInflow:100},{code:'000001',price:5,pct:null,mainInflow:null}])(['600000','000001']);
 assert.equal(stats.avgPct,null);assert.equal(stats.mainSum,null);assert.equal(stats.availability.pctKnown,1);assert.equal(stats.availability.fundsKnown,1);
});
test('actual related-news rows retain null pct rather than inventing a zero return',()=>{
 const start=source.indexOf('const relCodeMap ='),end=source.indexOf('return json(res, {',start);
 const related=new Function('S','A','fundsNumber',source.slice(start,end)+'\nreturn relatedOf;')({stocks:[{code:'600000',price:10,pct:null}],secStocks:new Map([['fixture',{list:[{code:'000001',price:5,pct:null}]}]])},{isJunkName:()=>false},v=>typeof v==='number'&&Number.isFinite(v)?v:null);
 assert.equal(related({codes:['600000'],sectors:[]}).direct[0].pct,null);
 assert.equal(related({codes:[],sectors:['fixture']}).indirect[0].pct,null);
});
test('shared dashboard state removes retracted code/sector flags without rewriting raw history',t=>{
 const root=path.join(temporary(t),'news'),journal=require('../src/core/news-evidence-journal'),now=Date.now();
 const original={schemaVersion:1,source:'eastmoney-fast-news',eventId:'withdrawn',sourceRevisionId:'first',kind:'original',supersedes:null,url:null,title:'fixture',body:'fixture',securities:['600000'],publishedAt:null,receivedAt:now,revisedAt:null};
 const id=journal.appendBatch(root,[original],{now}).results[0].eventHash;
 journal.appendBatch(root,[{...original,kind:'retracted',sourceRevisionId:'withdrawal',supersedes:id}],{now});
 const item={id:'withdrawn',codes:['600000'],sectors:['fixture']},state={news:{goodAll:[item],badAll:[item],neutralAll:[item],goodCodes:new Set(['600000']),badCodes:new Set(['600000']),badSectors:new Set(['fixture'])}};
 const start=source.indexOf('let newsEvidenceCache='),end=source.indexOf('const HOLIDAY_BUF_CAP',start);
 const visible=new Function('fs','NEWS_EVIDENCE_ROOT','S','require',source.slice(start,end)+'\nreturn newsEvidenceVisibleState;')(fs,root,state,serverRequire)();
 assert.equal(visible.news.goodAll.length,0);assert.equal(visible.news.badCodes.has('600000'),false);assert.equal(visible.news.badSectors.size,0);
 assert.equal(state.news.goodAll.length,1);assert.equal(state.news.badCodes.has('600000'),true);
});
test('actual legacy news renderer labels unknown values and retains genuine zero',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../public/assets/app.js'),'utf8'),start=app.indexOf('const newsKnown ='),end=app.indexOf('// wecom / mail',start);
 assert.ok(start>0&&end>start);const nodes={};
 const document={getElementById:id=>nodes[id]||(nodes[id]={})},esc=s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const fmtY=n=>{assert.equal(typeof n,'number');return n+'元';};
 const render=new Function('document','esc','fmtY','s',app.slice(start,end));
 const item={type:'good',title:'<script>fixture</script>',stocks:[],why:'fixture',stat:{total:1,up:null,down:null,limit:null,avgPct:null,mainSum:null},related:{direct:[{code:'600000',name:'fixture',pct:null}],indirect:[]}};
 render(document,esc,fmtY,{goodNews:{items:[item],hotSectors:[],hotStocks:[]},badNews:{items:[item],sectors:[],codes:[]}});
 assert.match(nodes.gnList.innerHTML,/均幅未知/);assert.match(nodes.gnList.innerHTML,/主力净流入未知/);assert.match(nodes.bnList.innerHTML,/主力净流出未知/);assert.doesNotMatch(nodes.gnList.innerHTML,/<script>|null%|0\.0%/);
 item.stat={total:1,up:0,down:0,limit:0,avgPct:0,mainSum:0};item.related.direct[0].pct=0;
 render(document,esc,fmtY,{goodNews:{items:[item],hotSectors:[],hotStocks:[]}});
 assert.match(nodes.gnList.innerHTML,/均幅0\.0%/);assert.match(nodes.gnList.innerHTML,/主力净流入0元/);
});
