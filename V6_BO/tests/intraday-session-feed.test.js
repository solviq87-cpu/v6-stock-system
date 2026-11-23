'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSessionIndexFeed,sinaIndices}=require('../src/core/session-index-feed');
const {openingPrint,thsSeals,createAuctionDisplay}=require('../src/research/auction-display');
const day='2026-11-23',at=(t,d=day)=>Date.parse(d+'T'+t+'+08:00'),flush=()=>new Promise(resolve=>setImmediate(resolve));
const session={day:'20261123',minute:583,trading:true,openDay:true};
const code='600001',name='测试股',tick=at('09:25:00'),readAt=at('09:43:00');
function datedMinute(date='20261123'){
 const quote=Array(31).fill('');Object.assign(quote,{1:name,2:code,4:'10',5:'11',30:date+'094258'});
 return {code:0,data:{sh600001:{data:{date,data:['0930 11.00 150 165000']},qt:{sh600001:quote}}}};
}
const wire='v_detail_data_sh600001=[0,"0/09:25:00/11.00/0.00/150/165000/B|1/09:30:00/11.00/0/1/1100/B"];';
test('only matching 09:25 prints and original dated minute ledger produce an observation',()=>{
 const r=openingPrint(code,day,wire,datedMinute(),readAt);
 assert.equal(r.amountYuan,165000);assert.equal(r.openPct,10);assert.equal(r.quoteAt,tick);assert.equal(r.knownAt,readAt);
 for(const bad of [wire.replace('09:25:00','09:30:00'),wire.replace('sh600001','sh600002'),wire.replace('/150/','/100/'),wire.replace('165000','150000')])
  assert.equal(openingPrint(code,day,bad,datedMinute(),readAt),null);
 const mixed=datedMinute();mixed.data.sh600001.qt.sh600001[30]='20261120094300';
 for(const minute of [datedMinute('20261120'),mixed])assert.equal(openingPrint(code,day,wire,minute,readAt),null);
 assert.equal(openingPrint(code,day,wire,datedMinute(),at('09:24:00')),null);
});
test('THS requires both the published session date and an exact opening seal epoch',()=>{
 const one={code,name,last_limit_up_time:String(tick/1000)};
 const data=(date,items)=>({status_code:0,data:{date,info:items}});
 assert.equal(thsSeals(data(20261123,[one]),day,readAt).length,1);
 assert.deepEqual(thsSeals(data(20261120,[one]),day,readAt),[]);
 assert.deepEqual(thsSeals(data(20261123,[{...one,last_limit_up_time:String(at('09:30:00')/1000)}]),day,readAt),[]);
 assert.deepEqual(thsSeals(data(20261123,[one]),day,tick-1),[]);
});
test('index reads start before stock initialization, coalesce, reject future and cross-day rows and preserve the newest price',async()=>{
 let now=readAt,backupCalls=0,primaryCalls=0;
 const q=(src,price,t,code='1.000001')=>({code,name:'指数',price,quoteSource:src,quoteAt:t,receivedAt:now});
 let rows=[q('tencent-index',5,at('15:00:00','2026-11-20')),q('tencent-index',9,now+10000,'0.399006')];
 const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>{primaryCalls++;return rows;},backup:async()=>{backupCalls++;return [q('sina-index',10,readAt-2000)];}});
 assert.equal(feed.read(session).indices.length,0);feed.read(session);await flush();
 let r=feed.read(session);assert.equal(r.indices[0].price,10);assert.equal(primaryCalls,1);assert.equal(backupCalls,1);
 now+=5500;rows=[q('tencent-index',11,now-500)];feed.read(session);await flush();r=feed.read(session);
 assert.equal(r.indices[0].quoteAt,now-500);assert.equal(r.indices[0].canTrade,false);
 now+=6500;rows=[];feed.read(session);await flush();assert.equal(feed.read(session).indices[0].price,11);
 const before=primaryCalls;now+=3600000;feed.read({...session,trading:false});await flush();assert.equal(primaryCalls,before);
 assert.equal(feed.read({...session,day:'20261124',trading:false}).indices.length,0);
});
test('Sina fallback parses exchange dates and yuan prices without replacing malformed quotes',()=>{
 const fields=Array(33).fill('0');Object.assign(fields,{2:'100',3:'101.5',30:day,31:'09:42:59'});
 const rows=sinaIndices(Buffer.from('var hq_str_sh000001="'+fields.join(',')+'";'),readAt);
 assert.equal(rows[0].quoteAt,at('09:42:59'));assert.equal(rows[0].price,101.5);assert.equal(rows[0].pct,1.5);
 fields[3]='-';assert.equal(sinaIndices(Buffer.from('var hq_str_sh000001="'+fields.join(',')+'";'),readAt).length,0);
});
test('post-open cold start reconstructs a separate shortlist, frozen records survive restart and cannot cross dates',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'auction-display-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const index={day,knownAt:readAt,tiers:[{name:'1进2',members:[{code,name,firstSeal:'09:25:00'}]}]};
 let requests=0;
 const clock=()=>readAt,read=createAuctionDisplay({directory,clock,readSeals:async()=>[],readPrint:async()=>{requests++;return openingPrint(code,day,wire,datedMinute(),readAt);}});
 const first=read({day,session,index});assert.equal(first.items[0].sealSource,'打板客连板梯队');read({day,session,index});await flush();
 const completed=read({day,session,index});assert.equal(completed.items[0].amountYuan,165000);assert.equal(requests,1);assert.equal(completed.canTrade,false);
 const restart=createAuctionDisplay({directory,clock,readPrint:()=>assert.fail(),readSeals:()=>assert.fail()});
 assert.equal(restart({day,session:{...session,trading:false},network:false}).items[0].quoteAt,tick);
 assert.equal(restart({day:'2026-11-24',session:{...session,day:'20261124',trading:false},index,network:false}).items.length,0);
});
test('pre-match indicative quotes expire, and never become executed auction volume at 09:25',async()=>{
 let now=at('09:21:00');
 const previousDay='2026-11-20',previousWatch={day:previousDay,knownAt:at('15:01:00',previousDay),items:[{code,name}]};
 const read=createAuctionDisplay({clock:()=>now,readSeals:async()=>[],readIndicative:async()=>({code,tradeDate:day,receivedAt:now,preClose:10,quoteSource:'eastmoney-auction',bars:[{quoteAt:now,price:10.50}]})});
 const input={day,session:{...session,minute:561},previousDay,previousWatch};read(input);await flush();
 const r=read(input);assert.equal(r.indicative[0].openPct,5);assert.equal(r.indicative[0].amountYuan,undefined);assert.deepEqual(r.items,[]);
 now=tick;const next=read({...input,session:{...session,minute:565}});assert.deepEqual(next.indicative,[]);assert.deepEqual(next.items,[]);
});
test('one closing observation is collected after 15:00 and weekends start no quote jobs',async()=>{
 let now=at('15:00:07'),calls=0;
 const codes=['1.000001','0.399001','0.399006','1.000688'];
 const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>{calls++;return codes.map(code=>({
   code,price:100,pct:0,receivedAt:now,quoteAt:at('15:00:00'),quoteSource:'tencent-index'}));},backup:async()=>[]});
 const closed={...session,minute:900,trading:false};
 feed.read(closed);await flush();assert.equal(feed.read(closed).indices.length,4);
 now+=61000;feed.read({...closed,minute:901});await flush();assert.equal(calls,1);
 now=at('10:00:00','2026-11-28');feed.read({...closed,day:'20261128',minute:600,openDay:false});await flush();assert.equal(calls,1);
});
