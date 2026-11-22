'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {closeDisplayDay,nextMarketOpenAt}=require('../src/core/closing-card-snapshot');
const {marketDistribution,createWorkingDistribution}=require('../src/research/shortline-breadth-fallback');
const {createMarketRecovery}=require('../src/research/market-recovery');
const day='2026-11-20',now=Date.parse('2026-11-22T22:00:00+08:00');
const previous=()=>day;
test('Shanghai close and next wake respect weekends, preopen, lunch, and the exchange holiday calendar',()=>{
 const sunday={day:'20261122',openDay:false,minute:900},monday={day:'20261123',openDay:true,minute:500};
 for(const session of [sunday,monday])assert.equal(closeDisplayDay(session,previous),day);
 assert.equal(nextMarketOpenAt(sunday,()=>'2026-11-23'),Date.parse('2026-11-23T09:15:00+08:00'));
 assert.equal(closeDisplayDay({...monday,minute:720},previous),null);
 assert.equal(nextMarketOpenAt({...monday,minute:720}),Date.parse('2026-11-23T13:00:00+08:00'));
 assert.equal(closeDisplayDay({...monday,minute:900},previous),'2026-11-23');
 assert.equal(closeDisplayDay({day:'20261005',openDay:false,minute:800},()=>'2026-09-30'),'2026-09-30');
});
test('market-wide close and intraday validate all bins, original session, age and one shared collection',async()=>{
 const names=['limit_up','over_7','up_5_7','up_3_5','up_0_3','flat','down_0_3','down_3_5','down_5_7','below_7','limit_down'];
 const values=[30,0,0,0,283,23,5168,0,0,0,68];
 const html='<h2 id="home-market-distribution-title">全市场涨跌分布</h2><span>'+day+'</span>截至 '+day+' 15:41:35 沪深京 A 股 · 含 ST <strong class="home-market-state is-final">收盘数据</strong> 有效 5572 / 5580 </header>'+
 '<span class="market-total-rise">上涨 <strong>313</strong></span><span class="market-total-flat">平盘 <strong>23</strong></span><span class="market-total-fall">下跌 <strong>5236</strong></span>'+
 names.map((name,i)=>'<div class="short-pool-bar-row market-bucket-'+name+'"><span>区间</span><strong>'+values[i]+'</strong></div>').join('')+'</section>';
 const record=marketDistribution(html,day,now);
 assert.deepEqual([record.adv,record.flat,record.dec,record.upLimit,record.downLimit,record.observed,record.total],[313,23,5236,30,68,5572,5580]);
 for(const wrong of [html.replace('is-final','live'),html.replace('15:41:35','11:00:00'),html.replace('5572 /','5580 /'),html.replace('limit_up','limit_down')])assert.equal(marketDistribution(wrong,day,now),null);
 assert.equal(marketDistribution(html,'2026-11-19',now),null);
 let at=Date.parse(day+'T10:10:00+08:00'),calls=0;
 const live=html.replace('is-final','is-live').replace('收盘数据','盘中').replace('15:41:35','10:09:00');
 assert.equal(marketDistribution(live,day,at,{intraday:true}).upLimit,30);
 assert.equal(marketDistribution(live,day,at+20*60000,{intraday:true}),null);
 assert.equal(marketDistribution(html,day,now,{intraday:true}),null);
 const read=createWorkingDistribution({clock:()=>at,request:async()=>{calls++;return {raw:Buffer.from(live)};}});
 const session={day:'20261120',openDay:true,trading:true,minute:610};
 assert.equal(read(session),null);assert.equal(read(session),null);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(read(session).observed,5572);
 at+=120000;assert.equal(read({...session,trading:false,minute:720}).upLimit,30);
 assert.equal(read({day:'20261122',openDay:false,trading:false,minute:800}),null);assert.equal(calls,1);
});
test('one collection feeds both clients, prefers original THS reasons and survives empty retries',async()=>{
 let clock=now,calls=0;
 const frame={date:day,provider:'ths',scope:'同花顺涨停池',source:'同花顺',knownAt:now,totalCount:1,complete:true,sealed:[{code:'600001',name:'样本',level:1}]};
 const r=createMarketRecovery({getDay:()=>day,clock:()=>clock,save:async()=>true,collect:async()=>{
  calls++;return {rows:calls===1?[{date:day,knownAt:now,upLimit:1,structurePools:[frame]}]:[],closeReasons:[
   {code:'600001',day,text:'热点A',source:'财联社'},{code:'600001',day,text:'同日原文',source:'同花顺涨停聚焦'},{code:'600001',day:'2026-11-19',text:'错日',source:'同花顺涨停聚焦'}]};
 }});
 await Promise.all([r.tick(),r.tick()]);assert.equal(calls,1);
 const watch=r.display().closeWatch;assert.equal(watch.items[0].reasonRaw,'同日原文');assert.equal(watch.items[0].reasonTradeDate,day);
 clock+=3600000;await r.tick();assert.deepEqual(r.display().closeWatch,watch);
});
test('fresh Sunday workspaces share the dated close, 28 THS causes, and actual first and second boards without creating strategy hits',async()=>{
 const {projectClosingWorkspace,closingWatch,systemPicks,summarizeReview}=await import('../public/nova/market.js');
 const input={closeSession:{day,cards:{}},trading:false,pool:[],review:null,ztPool:[],marketRecovery:{referenceDay:day}};
 const projection=projectClosingWorkspace(input,now),watch=closingWatch(input,now),s=summarizeReview(projection.review);
 assert.equal(watch.items.length,28);assert.equal(watch.items.filter(r=>r.reasonRaw&&r.reasonSource==='同花顺涨停聚焦').length,28);
 assert.deepEqual([s.first,s.continued,s.highest],[25,3,4]);assert.equal(watch.items.filter(r=>r.level===2).length,1);
 assert.ok(projection.ztBySector.length);assert.equal(input.review,null);assert.deepEqual(systemPicks(projection).items,[]);
 assert.equal(closingWatch({...input,closeSession:{day:'2026-11-23'}},now),null);
});

test('late THS evidence enriches the saved same-day members even when the pool provider is offline',async()=>{
 let at=now,n=0;
 const pool={date:day,scope:'专题池',source:'样本来源',knownAt:at,totalCount:1,complete:true,sealed:[{code:'600001',name:'样本',level:1}]};
 const recovery=createMarketRecovery({getDay:()=>day,clock:()=>at,save:async()=>true,
  collect:async()=>++n===1?{rows:[{date:day,knownAt:at,upLimit:1,structurePools:[pool]}]}:
   {rows:[],closeReasons:['600001','600002'].map(code=>({code,day,text:'后补原文',source:'同花顺涨停聚焦'}))}});
 await recovery.tick();at+=3600000;await recovery.tick();
 const watch=recovery.display().closeWatch;
 assert.equal(watch.knownAt,at);assert.deepEqual(watch.items.map(x=>[x.code,x.reasonRaw,x.reasonKnownAt]),[['600001','后补原文',at]]);
});
test('native THS daily review accepts the published session and close text only',()=>{
 const {thsDailyBrief}=require('../src/core/close-review-evidence');
 const html='<h1>复盘必读</h1><script>Global.date="20130109"; Global.date="20261120";</script><div id="block_1887">截至收盘，指数下跌。</div><div id="block_1890">芯片、PCB、芯片</div>';
 const brief=thsDailyBrief(html,day,now);
 assert.deepEqual(brief.themes,['芯片','PCB']);assert.match(brief.url,/20261120[.]shtml$/);assert.equal(brief.knownAt,now);
 assert.equal(thsDailyBrief(html,'2026-11-19',now),null);assert.equal(thsDailyBrief(html.replace('收盘','午间'),day,now),null);
 assert.equal(thsDailyBrief(html,day,Date.parse(day+'T14:59:00+08:00')),null);
});
