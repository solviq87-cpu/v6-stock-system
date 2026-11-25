'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/battle-model.js');
const day='2026-11-25',now=Date.parse(day+'T10:30:00+08:00');
const quote=(code,extra={})=>({code,name:'候选'+code,score:80,price:10,pct:2,
 quoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified',
 poolDay:day,paths:['放量突破'],pathWhy:'同日量价条件已命中',...extra});
const state=(extra={})=>({trading:true,marketClock:{day,trading:true,openDay:true},
 snapshotFieldDays:{candidatePool:day},pool:[quote('600001')],...extra});
const distribution=(extra={})=>({kind:'market-distribution-intraday',day,source:'打板客盘中涨跌分布',
 scope:'沪深京 A 股（含 ST）',quoteAt:now-30000,knownAt:now-10000,
 adv:3500,dec:1400,flat:100,observed:5000,total:5000,upLimit:70,downLimit:20,...extra});
const ecology=(extra={})=>({day,knownAt:now-10000,ecology:[{label:'当日封板',success:80,total:100}],...extra});

test('battle board uses original pool receipts, ranks resonance before score and never mutates inputs',async()=>{
 const {buildBattleBoard}=await api;
 const s=state({pool:[quote('600001',{score:99}),quote('600002',{score:90}),quote('600003',{score:80}),quote('600004',{score:70})],
  dashboard:{verifiedLive:false,rows:[{...quote('600001'),canTrade:false}]},
  yierAsOf:day,yierList:[quote('600004'),quote('600004')],
  auctionResonance:{snapshotDay:day,items:[quote('600004'),quote('SH600004'),quote('600003')]}});
 const before=JSON.stringify(s),out=buildBattleBoard(s,{now,role:'edit'});
 assert.deepEqual(out.candidates.map(r=>r.code),['600004','600003','600001']);
 assert.deepEqual(out.candidates.map(r=>r.resonance),[3,2,1]);
 assert.deepEqual(out.candidates[0].resonanceLabels,['精选','竞价引力','一进二']);
 assert.equal(out.candidates[0].day,day);assert.equal(out.candidates[0].quoteAt,now-1000);
 assert.equal(out.candidates[0].reason,'同日量价条件已命中');
 assert.ok(out.candidates.every(r=>r.canTrade===false&&r.executionReady===false));
 assert.equal(JSON.stringify(s),before);
});

test('dashboard observation projections, historical close picks and fake samples cannot become decision cards',async()=>{
 const {buildBattleBoard}=await api;
 for(const s of [state({pool:[],dashboard:{rows:[quote('600001')]}}),
  state({pool:[quote('600001',{canTrade:false})]}),
  state({pool:[quote('600001',{historicalClose:true,mode:'historical-close'})]}),
  state({pool:[quote('600001',{fixture:true})]}),state({pool:[quote('600001',{quoteSource:'fixture'})]})]){
  const out=buildBattleBoard(s,{now});assert.equal(out.candidates.length,0);
  assert.equal(out.emptyReason,'今天空仓，等待信号');
 }
});

test('exact 15 second boundary uses quoteAt and refuses missing future and reception-derived times',async()=>{
 const {buildBattleBoard}=await api;
 assert.equal(buildBattleBoard(state({pool:[quote('600001',{quoteAt:now-15000})]}),{now}).candidates.length,1);
 for(const extra of [{quoteAt:now-15001},{quoteAt:now+1},{quoteAt:null},{quoteSource:null},
  {receivedAt:null},{receivedAt:now+1},{receivedAt:now-2000},{vendorQuoteAt:now-999},
  {quoteAt:now-3600000,receivedAt:now},{quoteMode:'research'},{price:null}])
  assert.equal(buildBattleBoard(state({pool:[quote('600001',extra)]}),{now}).candidates.length,0,JSON.stringify(extra));
});

test('candidate dates, pool declarations and continuous auction boundaries are enforced independently',async()=>{
 const {buildBattleBoard}=await api;
 for(const extra of [{tradeDate:'2026-11-24'},{sourceTradeDate:'2026-11-26'},{poolDay:'2026-11-24'}])
  assert.equal(buildBattleBoard(state({pool:[quote('600001',extra)]}),{now}).candidates.length,0);
 assert.equal(buildBattleBoard(state({snapshotFieldDays:{candidatePool:'20261124'}}),{now}).candidates.length,0);
 for(const time of ['09:25:00','11:30:00','12:00:00','14:57:00','15:30:00']){
  const at=Date.parse(day+'T'+time+'+08:00'),s=state({pool:[quote('600001',{quoteAt:at-1,receivedAt:at})]});
  assert.equal(buildBattleBoard(s,{now:at}).candidates.length,0,time);
 }
 for(const time of ['09:30:00','11:29:59','13:00:00','14:56:59']){
  const at=Date.parse(day+'T'+time+'+08:00'),s=state({pool:[quote('600001',{quoteAt:at-1,receivedAt:at})]});
  assert.equal(buildBattleBoard(s,{now:at}).candidates.length,1,time);
 }
 for(const extra of [{trading:false},{marketFrozen:true},{isSnapshot:true},{closeSession:{day:'2026-11-24'}}])
  assert.equal(buildBattleBoard(state(extra),{now}).candidates.length,0);
});

test('existing exclusions, sealed pools and missing selection evidence are never silently promoted',async()=>{
 const {buildBattleBoard}=await api;
 for(const extra of [{blocked:true},{bad:true},{canOpen:false},{tradable:false},{name:'ST样本'},
  {selectionEvidenceStatus:'incomplete'},{cap:'空仓'},{decisionReview:{action:'sell'}},{score:null},
  {paths:[],pathWhy:'',reasons:[]},{readOnlyBackup:true},{sealedUp:true}])
  assert.equal(buildBattleBoard(state({pool:[quote('600001',extra)]}),{now}).candidates.length,0,JSON.stringify(extra));
 assert.equal(buildBattleBoard(state({ztDay:day,ztPool:[{code:'600001'}]}),{now}).candidates.length,0);
 assert.equal(buildBattleBoard(state({ztDay:'2026-11-24',ztPool:[{code:'600001'}]}),{now}).candidates.length,1,'old limit pool does not overwrite current evidence');
});

test('resonance isolates dates and strategies and never counts tape observations or private viewer pools',async()=>{
 const {strategyResonance}=await api;
 const s=state({yierAsOf:day,yierList:[quote('600001')],auctionObservations:{day,items:[quote('600001')]},
  auctionResonance:{snapshotDay:day,items:[quote('600001',{poolDay:'2026-11-24'})]}});
 assert.deepEqual([...strategyResonance(s,{now,role:'view'}).get('600001')],['精选']);
 assert.deepEqual([...strategyResonance(s,{now,role:'edit'}).get('600001')],['精选','一进二']);
 s.auctionResonance={snapshotDay:day,items:[quote('600001'),quote('1.600001'),quote('600001.SH')]};
 assert.deepEqual([...strategyResonance(s,{now,role:'edit'}).get('600001')],['精选','竞价引力','一进二']);
 s.auctionResonance.locked=true;
 assert.equal(strategyResonance(s,{now,role:'edit'}).get('600001').size,2);
});

test('prices come from existing levels and applicable plans; missing values stay unknown',async()=>{
 const {buildBattleBoard}=await api;
 const s=state({pool:[quote('600001',{levels:{stop:9.7,t1:11.8,ma5:9.9}})],paper:{pool:{policy:{positionPct:19.6}}}});
 let card=buildBattleBoard(s,{now,role:'edit'}).candidates[0];
 assert.equal(card.stop,9.7);assert.equal(card.target,11.8);assert.equal(card.entry,null);
 assert.equal(card.positionPct,19.6);assert.deepEqual(card.planMissing,['买入区间']);
 assert.equal(card.positionSource,'A 盘现有仓位上限');
 s.nextplan={date:'2026-11-24',applyDate:day,plan:{picked:[{code:'600001',entry:[9.9,10.1],stop:9.5,target:12,maxPosition:10}]}};
 card=buildBattleBoard(s,{now}).candidates[0];assert.deepEqual(card.entry,[9.9,10.1]);assert.equal(card.stop,9.5);assert.equal(card.target,12);assert.equal(card.positionPct,10);assert.equal(card.planReady,true);
 s.nextplan.applyDate='2026-11-26';card=buildBattleBoard(s,{now}).candidates[0];assert.equal(card.entry,null);assert.equal(card.stop,9.7);
 const empty=buildBattleBoard(state(),{now}).candidates[0];
 assert.deepEqual([empty.entry,empty.stop,empty.target,empty.positionPct],[null,null,null,null]);
});

test('invalid or mismatched plan values cannot leak prices or position into a decision card',async()=>{
 const {buildBattleBoard}=await api;
 for(const plan of [{code:'600002',entry:[9,10],stop:8,target:12,maxPosition:20},
  {code:'600001',applyDate:'2026-11-24',entry:[9,10],stop:8,target:12,maxPosition:20},
  {code:'600001',knownAt:now+1,entry:[9,10],stop:8,target:12,maxPosition:20}]){
  const card=buildBattleBoard(state({pool:[quote('600001',{plan})]}),{now}).candidates[0];
  assert.deepEqual([card.entry,card.stop,card.target,card.positionPct],[null,null,null,null]);
 }
 const card=buildBattleBoard(state({pool:[quote('600001',{plan:{entry:[12,9],stop:11,target:8,maxPosition:0}})]}),{now}).candidates[0];
 assert.deepEqual([card.entry,card.stop,card.target,card.positionPct],[null,null,null,null]);
});

test('weather requires matching dated counts and true seal denominator and exposes each scope',async()=>{
 const {marketWeather}=await api;
 const s=state({marketDistribution:distribution(),dabanke:ecology()});
 let out=marketWeather(s,{now});assert.equal(out.label,'可做多');assert.equal(out.metrics.limitRatio,3.5);assert.equal(out.metrics.sealRatePct,80);
 assert.equal(out.sources.length,2);assert.match(out.sources[1].scope,/不含 ST/);assert.equal(out.canTrade,false);
 s.dabanke={...ecology(),ecology:[{label:'硬板率',success:80,total:100}]};
 out=marketWeather(s,{now});assert.equal(out.status,'unknown');assert.deepEqual(out.missing,['同日封板率']);
 s.dabanke=ecology({day:'2026-11-24'});assert.equal(marketWeather(s,{now}).status,'unknown');
 s.dabanke=ecology({knownAt:now+1});assert.equal(marketWeather(s,{now}).status,'unknown');
});

test('weather distinguishes zero from missing and never invents an infinite limit ratio',async()=>{
 const {marketWeather}=await api;
 for(const extra of [{downLimit:null},{upLimit:null},{observed:0},{adv:3499},{quoteAt:now+1},{quoteAt:now-900001}]){
  const out=marketWeather(state({marketDistribution:distribution(extra),dabanke:ecology()}),{now});
  assert.equal(out.status,'unknown',JSON.stringify(extra));
 }
 const zero=marketWeather(state({marketDistribution:distribution({upLimit:70,downLimit:0}),dabanke:ecology()}),{now});
 assert.equal(zero.label,'可做多');assert.equal(zero.metrics.limitRatio,null);assert.match(zero.sentence,/70 \/ 0/);
 const empty=marketWeather(state({marketDistribution:distribution({upLimit:0,downLimit:0}),dabanke:ecology()}),{now});
 assert.equal(empty.label,'谨慎');assert.equal(empty.metrics.limitRatio,null);
});

test('weather does not mix dashboard limit counts from different providers or treat hard-board rate as seal rate',async()=>{
 const {marketWeather}=await api;
 const s=state({dashboard:{source:'现有行情快照',mood:{upN:3500,downN:1400,flatN:100,ztN:70,dtN:20,
  boardHardRate:90,scope:{sample:5000,snapAt:now-1000,dtSource:'东财跌停池'}}},dabanke:ecology()});
 const out=marketWeather(s,{now});assert.equal(out.metrics.breadthPct,70);assert.equal(out.metrics.limitRatio,null);
 assert.equal(out.status,'unknown');assert.deepEqual(out.missing,['同批涨跌停数']);
});

test('red weather hides buy cards without changing original pools or account data',async()=>{
 const {buildBattleBoard}=await api;
 const s=state({marketDistribution:distribution({adv:1000,dec:3900,flat:100,upLimit:10,downLimit:80}),dabanke:ecology()});
 const before=JSON.stringify(s),out=buildBattleBoard(s,{now});
 assert.equal(out.weather.label,'空仓');assert.equal(out.candidates.length,0);assert.equal(out.emptyReason,'今天空仓，等待信号');
 assert.match(out.blocked[0].reason,/天气为空仓/);assert.equal(JSON.stringify(s),before);
});

test('closed sessions preserve the original market day and cannot create buy cards',async()=>{
 const {buildBattleBoard}=await api,at=Date.parse('2026-11-28T10:00:00+08:00'),quoteAt=Date.parse(day+'T15:30:00+08:00');
 const s=state({trading:false,marketClock:{day:'2026-11-28',trading:false},closeSession:{day},
  marketDistribution:distribution({kind:'market-distribution',quoteAt,knownAt:quoteAt}),dabanke:ecology({knownAt:quoteAt})});
 const out=buildBattleBoard(s,{now:at});assert.equal(out.day,day);assert.equal(out.weather.day,day);assert.equal(out.candidates.length,0);assert.equal(out.weather.metrics.breadthPct,70);
});

test('detail conclusion separates sealed stocks, actual breaks and missing source evidence',async()=>{
 const {stockConclusion}=await api;
 const row=quote('600001',{sector:'芯片',sealAmount:2000000,volume:10000,aboveMa5:true});
 let out=stockConclusion(row,{state:state(),now});assert.equal(out.label,'可关注');assert.equal(out.evidence.length,4);assert.equal(out.canTrade,false);
 out=stockConclusion({...row,breakCount:1},{state:state(),now});assert.equal(out.label,'等待回封');
 out=stockConclusion({...row,breakCount:1},{state:state({ztDay:day,ztPool:[{code:row.code}]}),now});assert.equal(out.label,'回避');assert.match(out.reason,/当前封板/);
 for(const extra of [{blocked:true},{canTrade:false},{quoteAt:now-15001},{tradeDate:'2026-11-24'}])
  assert.equal(stockConclusion({...row,...extra},{state:state(),now}).label,'回避');
 assert.equal(stockConclusion({...row,tradeDate:'2026-11-24'},{state:state(),now}).evidence.length,0);
});

test('malformed symbols never merge and different symbol encodings normalize without losing leading zeroes',async()=>{
 const {battleCode}=await api;
 for(const value of ['sz000001','0.000001','000001.SZ','000001'])assert.equal(battleCode(value),'000001');
 for(const value of ['00001',1,'SH600001junk','<600001>','sh000001','1.000001','sz600001','sh600001.SZ'])assert.equal(battleCode(value),null);
});
