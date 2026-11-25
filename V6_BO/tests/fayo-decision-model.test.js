'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=import('../src/core/decision-model.mjs');
const day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00');
const stock=(symbol='600001',patch={})=>({code:symbol,name:'公开报价候选',price:10,pct:2,score:85,
 quoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,
 poolDay:day,volume:100000,amount:1000000,paths:['横盘放量','MACD水上金叉'],pathWhy:{横盘放量:'成交量达到现有阈值'},
 sector:'芯片',levels:{ma5:9.8,stop:9.7,t1:11,r1:11.05},...patch});
const state=(rows=[stock()])=>({trading:true,marketClock:{day,trading:true},closeSession:null,pool:rows,poolDay:day,
 decisionAccountEvidence:{source:'PAPER.pool / PAPER_CFG.pool',sourceAt:now-500,kind:'server-account-snapshot'},
 decisionLevels:Object.fromEntries(rows.map(row=>[row.code,{levels:row.levels,source:'原腾讯日 K',sourceAt:now-30000,
  throughDay:day,asOf:now,quoteAt:row.quoteAt,adjustment:'qfq'}])),
 marketDistribution:{kind:'market-distribution-intraday',source:'打板客盘中涨跌分布',scope:'沪深京 A 股（含 ST）',
  day,quoteAt:now-30000,knownAt:now-20000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
 dabanke:{day,knownAt:now-20000,ecology:[{label:'当日封板',success:70,total:90}]},
 paper:{pool:{enabled:true,equity:100000,cash:100000,positions:[],executionPolicy:{maxPositions:5,allocationPct:19.6}}}});
const auction=(rows)=>({asOf:now-500,isSnapshot:false,auctionEvidence:{eligibleForAuctionEvidence:true,auctionDay:day.replaceAll('-','')},
 items:rows.map(row=>({...row,auctionInputStatus:'auction-snapshot-unverified'}))});

test('decision cards retain real plan values, expose sources and cap the list at three',async()=>{
 const {buildDecisionBoard}=await model,s=state([stock('600004',{score:84}),stock('600003',{score:83}),stock('600002',{score:82}),stock('600001',{score:81})]);
 const before=JSON.stringify(s),result=buildDecisionBoard(s,{now});
 assert.deepEqual(result.cards.map(row=>row.code),['600004','600003','600002']);
 assert.equal(result.cards[0].plan.buyLow,9.8);assert.equal(result.cards[0].plan.buyHigh,10);
 assert.equal(result.cards[0].plan.stop,9.7);assert.equal(result.cards[0].plan.target,11);
 assert.equal(result.cards[0].plan.positionPct,19.6);assert.equal(result.cards[0].resonanceScore,1);
 assert.match(result.cards[0].reason,/成交量达到现有阈值/);
 assert.equal(result.weather.status,'green');assert.equal(result.weather.basis.length,2);
 assert.equal(result.checklist.length,4);assert.equal(JSON.stringify(s),before);
});

test('resonance counts independent same-day strategies and takes priority over score',async()=>{
 const {buildDecisionBoard,decisionResonance}=await model,a=stock('600001',{score:99}),b=stock('600002',{score:80}),s=state([a,b]);
 s.yierAsOf=day;s.yierList=[b,b];s.lianbanAsOf=day;s.lianbanList=[b];s.decisionPools={auction:auction([b,b])};
 s.auctionObservations={day,items:[a]};s.fastStockMoves={tradeDate:day,items:[a]};
 const result=buildDecisionBoard(s,{now});assert.equal(result.cards[0].code,b.code);assert.equal(result.cards[0].resonanceScore,4);
 assert.deepEqual(result.cards[0].resonanceStrategies.map(x=>x.id),['ranked','relay-first','relay-next','auction']);
 assert.equal(decisionResonance(s,{day,now,ranked:s.pool}).get(a.code).length,1);
});

test('observations, proxy auction inputs, failed responses, future receipts and old strategy lists do not become resonance',async()=>{
 const {buildDecisionBoard}=await model;
 for(const change of [
  s=>{s.yierAsOf='2026-11-24';s.yierList=s.pool;},
  s=>{s.decisionPools={auction:auction(s.pool)};s.decisionPools.auction.items[0].auctionInputStatus='sector-only';},
  s=>{s.decisionPools={auction:auction(s.pool)};s.decisionPools.auction.ok=false;},
  s=>{s.decisionPools={auction:auction(s.pool)};s.decisionPools.auction.asOf=now+1;},
  s=>{s.decisionPools={auction:auction(s.pool)};s.decisionPools.auction.auctionEvidence.eligibleForAuctionEvidence=false;},
  s=>{s.decisionPools={auction:auction(s.pool)};s.decisionPools.auction.isSnapshot=true;},
  s=>{s.auctionObservations={day,items:s.pool};s.closeWatch={day,items:s.pool};}
 ]){const s=state();change(s);assert.equal(buildDecisionBoard(s,{now}).cards[0].resonanceScore,1);}
});

test('the original quote gate includes 15 seconds and rejects 15001 ms without refreshing time',async()=>{
 const {buildDecisionBoard}=await model;
 assert.equal(buildDecisionBoard(state([stock('600001',{quoteAt:now-15000})]),{now}).cards.length,1);
 const result=buildDecisionBoard(state([stock('600001',{quoteAt:now-15001,receivedAt:now})]),{now});
 assert.equal(result.cards.length,0);assert.match(result.reasons.join(''),/15秒/);
});

test('missing, future, cross-day, mismatched and reception-only quotes cannot produce cards',async()=>{
 const {buildDecisionBoard}=await model;
 for(const patch of [
  {quoteAt:null},{quoteAt:undefined,vendorQuoteAt:now-1000},{quoteAt:now+1},{quoteAt:Date.parse('2026-11-24T10:00:00+08:00')},
  {receivedAt:null},{receivedAt:now+1},{receivedAt:now-2000},{vendorQuoteAt:now-1001},{poolDay:'2026-11-24'},
  {quoteSource:''},{quoteMode:''},{quoteSource:'readOnlyBackup'},{quoteMode:'historical-bars'},
  {canTrade:false},{canNotify:false},{readOnlyBackup:true},{mock:true},{price:null},{amount:0},{volume:null,amount:null}
 ])assert.equal(buildDecisionBoard(state([stock('600001',patch)]),{now}).cards.length,0,JSON.stringify(patch));
});

test('risk exclusions, prior holdings, sealed quotes and contradictory duplicate prices block cards',async()=>{
 const {buildDecisionBoard}=await model;
 for(const patch of [{bad:true},{blocked:true},{canOpen:false},{isST:true},{name:'ST某股'},{suspended:'yes'},
  {selectionEvidenceStatus:'incomplete'},{decisionReview:{action:'sell'}},{cap:'空仓'},{sealed:true},{isSealed:true}]){
  assert.equal(buildDecisionBoard(state([stock('600001',patch)]),{now}).cards.length,0,JSON.stringify(patch));
 }
 const held=state();held.paper.pool.positions=[{code:'600001',shares:100}];assert.equal(buildDecisionBoard(held,{now}).cards.length,0);
 const sealed=state();sealed.ztDay='20261125';sealed.ztPool=[{code:'600001'}];assert.equal(buildDecisionBoard(sealed,{now}).cards.length,0);
 const conflict=state([stock(),stock('600001',{price:10.1})]);assert.equal(buildDecisionBoard(conflict,{now}).cards.length,0);
});

test('incomplete and inverted plans stay unknown and never fill synthetic plan numbers',async()=>{
 const {buildDecisionBoard,decisionPlan}=await model;
 for(const levels of [null,{ma5:9.8,stop:9.7},{ma5:null,stop:9.7,t1:11},{ma5:10.1,stop:9.7,t1:11},
  {ma5:9.8,stop:9.9,t1:11},{ma5:9.8,stop:9.7,t1:9.9}]){
  assert.equal(buildDecisionBoard(state([stock('600001',{levels})]),{now}).cards.length,0,JSON.stringify(levels));
 }
 const p=decisionPlan(stock(),{});assert.equal(p.positionPct,null);assert.equal(p.complete,false);
 assert.deepEqual(p.missing,['原模拟盘仓位预算']);
 const s=state();s.paper.pool.executionPolicy={};assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
});

test('position plans respect actual cash, suspended accounts and the existing position cap',async()=>{
 const {buildDecisionBoard}=await model,s=state();s.paper.pool.cash=5000;
 assert.equal(buildDecisionBoard(s,{now}).cards[0].plan.positionPct,5);
 s.paper.pool.cash=0;assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
 s.paper.pool.cash=100000;s.paper.pool.enabled=false;assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
 s.paper.pool.enabled=true;s.paper.pool.positions=Array.from({length:5},(_,i)=>({code:String(600010+i)}));
 assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
});

test('weather missing data and zero denominators remain explicit, without fake bearish zeros',async()=>{
 const {buildDecisionBoard,decisionWeather}=await model,s=state();s.dabanke.ecology=[];
 const missing=buildDecisionBoard(s,{now});assert.equal(missing.cards.length,0);assert.equal(missing.weather.status,'unknown');
 assert.equal(missing.weather.metrics.sealRate,null);assert.deepEqual(missing.weather.missing,['同日封板率']);
 assert.match(missing.reasons.join(''),/缺少同日封板率/);
 s.dabanke.ecology=[{label:'当日封板',success:0,total:0}];assert.equal(decisionWeather(s,{now}).status,'unknown');
 s.dabanke.ecology=[{label:'当日封板',success:0,total:10}];const zero=decisionWeather(s,{now});
 assert.equal(zero.metrics.sealRate,0);assert.equal(zero.status,'red');
 const noDown=state();noDown.marketDistribution.downLimit=0;const result=decisionWeather(noDown,{now});
 assert.equal(result.metrics.upDownRatio,null);assert.equal(result.status,'green');assert.match(result.summary,/70:0/);
});

test('mixed source, scope, day or timestamp limit counts cannot make a valid ratio',async()=>{
 const {decisionWeather}=await model;
 for(const patch of [{source:'腾讯'},{scope:'另一市场'},{date:'2026-11-24'},{knownAt:now-20001}]){
  const s=state();delete s.marketDistribution;s.breadth={day,at:now-1000,up:3000,down:1000,n:4100};
  const base={source:'东方财富',scope:'专题池',date:day,knownAt:now-20000};
  s.marketRecovery={metrics:{upLimit:{...base,value:50},downLimit:{...base,value:10,...patch}}};
  const r=decisionWeather(s,{now});assert.equal(r.status,'unknown');assert.equal(r.metrics.upLimit,null);
 }
});

test('weather rejects invalid coverage sums, negative counts, future and cross-day evidence',async()=>{
 const {decisionWeather}=await model;
 for(const patch of [{adv:3001},{upLimit:-1},{quoteAt:now+1},{knownAt:now+1},{day:'2026-11-24'},{scope:''},{source:'synthetic'}]){
  const s=state();Object.assign(s.marketDistribution,patch);assert.equal(decisionWeather(s,{now}).status,'unknown',JSON.stringify(patch));
 }
 const s=state();s.dabanke.day='2026-11-24';assert.equal(decisionWeather(s,{now}).metrics.sealRate,null);
});

test('red weather withholds cards, caution allows complete plans, and no-signal wording is stable',async()=>{
 const {buildDecisionBoard}=await model,s=state();s.marketDistribution={...s.marketDistribution,adv:1000,dec:3000};
 assert.equal(buildDecisionBoard(s,{now}).weather.status,'red');assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
 const caution=state();caution.marketDistribution.upLimit=12;const r=buildDecisionBoard(caution,{now});
 assert.equal(r.weather.status,'yellow');assert.equal(r.cards.length,1);
 assert.equal(buildDecisionBoard(state([]),{now}).emptyMessage,'今天空仓，等待信号');
});

test('market close, stale session, lunch and both auctions cannot turn same-day observations into a current plan',async()=>{
 const {buildDecisionBoard}=await model;
 for(const hm of ['09:25','11:30','12:59','14:57','15:30']){
  const at=Date.parse(day+'T'+hm+':00+08:00'),s=state([stock('600001',{quoteAt:at-1000,receivedAt:at-500})]);
  const r=buildDecisionBoard(s,{now:at});assert.equal(r.sessionOpen,false,hm);assert.equal(r.cards.length,0,hm);
 }
 for(const change of [s=>s.marketClock.trading=false,s=>s.marketClock.day='2026-11-24',s=>s.closeSession={day},s=>s.isSnapshot=true]){
  const s=state();change(s);assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
 }
});

test('details conclusion has four attributed evidence classes and clearly marks unknown evidence',async()=>{
 const {stockConclusion}=await model;
 const valid=stockConclusion(stock(),{day,now});assert.equal(valid.label,'可关注');
 assert.deepEqual(valid.evidence.map(x=>x.kind),['theme','seal','volume','position']);assert.equal(valid.evidence[1].known,false);
 assert.equal(stockConclusion(stock('600001',{breakCount:1,isSealed:false}),{day,now}).label,'等待回封');
 assert.equal(stockConclusion(stock('600001',{sealed:true}),{day,now}).label,'回避');
 assert.equal(stockConclusion(stock('600001',{quoteAt:null}),{day,now}).label,'回避');
 assert.equal(stockConclusion(stock('600001',{canTrade:false}),{day,now}).label,'回避');
});

test('display-only dashboard rows never become buy cards and a real zero score remains a score',async()=>{
 const {buildDecisionBoard}=await model,s=state([]);s.dashboard={rows:[stock('600001',{canTrade:false})]};
 assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
 const zero=buildDecisionBoard(state([stock('600001',{score:0})]),{now});assert.equal(zero.cards.length,1);assert.equal(zero.cards[0].score,0);
});

test('server authority owns plan arithmetic; the browser exports only receipt validation',async()=>{
 const {buildDecisionCenter,AUTHORITY}=require('../src/core/decision-center'),client=await import('../public/nova/decision-model.mjs');
 assert.deepEqual(Object.keys(client).sort(),['decisionDay','readDecisionBoard','stockConclusion']);
 const result=await buildDecisionCenter(state(),{now});
 assert.equal(result.authority,AUTHORITY);assert.equal(result.schemaVersion,1);assert.equal(result.cards.length,1);
 const card=result.cards[0];assert.match(card.decisionId,/^[a-f0-9]{64}$/);assert.equal(card.plan.authority,AUTHORITY);
 assert.equal(card.plan.decisionId,card.decisionId);assert.equal(card.plan.lineage.buyHigh.sourceAt,now-1000);
 assert.equal(card.plan.lineage.positionPct.sourceAt,now-500);assert.equal(card.plan.lineage.positionPct.kind,'server-account-snapshot');
 for(const field of ['buyLow','buyHigh','stop','target','positionPct']){
  assert.equal(typeof card.plan.lineage[field].source,'string');assert.equal(Number.isSafeInteger(card.plan.lineage[field].sourceAt),true);
 }
 assert.equal(client.readDecisionBoard(result,{now}).cards[0].plan,card.plan);
 assert.equal(client.stockConclusion(card,{day,now}).label,'可关注');
 assert.equal(client.stockConclusion(stock(),{day,now}).label,'回避');
});

test('the real scanner quote projection can produce a decision without manufacturing canTrade=true',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center');
 const {reviewQuoteSnapshotFields}=require('../src/core/recommendation-evidence-review');
 const wire=stock('600001',{canNotify:true}),projected=reviewQuoteSnapshotFields(wire);
 assert.equal(Object.hasOwn(projected,'canTrade'),false);
 const row={...wire,...projected};delete row.canTrade;
 const result=await buildDecisionCenter(state([row]),{now});
 assert.equal(result.cards.length,1);assert.equal(result.cards[0].canTrade,undefined);
 assert.equal(result.cards[0].canNotify,true);
});

function currentState(){
 const s=state([stock('600001',{quoteAt:now-600000,receivedAt:now-599000,price:9.9,amount:999999})]);
 s.decisionQuotes=[{code:'600001',name:'同股实时原行',price:10,preClose:9.8,volume:123456,quoteAt:now-1000,receivedAt:now-500,
  quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,canNotify:true}];
 s.decisionLevels={'600001':{code:'600001',levels:{ma5:9.8,stop:9.7,t1:11,r1:11.05},source:'原腾讯日 K',sourceAt:now-30000,
  throughDay:day,asOf:now,quoteAt:now-1000}};
 return s;
}

test('current candidates keep strategy lineage separate and replace a whole original quote group',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center'),s=currentState(),before=JSON.stringify(s);
 const result=await buildDecisionCenter(s,{now}),card=result.cards[0];
 assert.equal(result.cards.length,1);assert.equal(card.price,10);assert.equal(card.quoteAt,now-1000);
 assert.equal(card.volume,123456);assert.equal(Object.hasOwn(card,'amount'),false);
 assert.equal(card.strategyAt,now-600000);assert.equal(card.strategyBasis.quoteAt,now-600000);
 assert.equal(card.quoteBasis.quoteAt,now-1000);assert.equal(card.plan.lineage.buyLow.sourceAt,now-30000);
 assert.equal(JSON.stringify(s),before);
});

test('a fresh quote cannot revive a forbidden source, wrong strategy day or unverified K-line plan',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center');
 for(const change of [s=>s.pool[0].canTrade=false,s=>s.pool[0].readOnlyBackup=true,s=>s.pool[0].poolDay='2026-11-24',
  s=>{s.pool[0].mock=true;s.decisionQuotes[0].mock=false;},s=>s.pool[0].quoteSource='synthetic-provider',
  s=>s.pool[0].quoteMode='historical-bars',s=>{s.pool[0].suspended=true;s.decisionQuotes[0].suspended=false;},
  s=>s.pool[0].quoteAt=Date.parse('2026-11-24T10:00:00+08:00'),s=>delete s.decisionQuotes[0].canTrade,
  s=>delete s.decisionLevels,s=>s.decisionLevels['600001'].sourceAt=now+1,
  s=>s.decisionLevels['600001'].throughDay='2026-11-26',s=>s.decisionLevels['600001'].quoteAt=now-500]){
  const s=currentState();change(s);assert.equal((await buildDecisionCenter(s,{now})).cards.length,0);
 }
});

test('weather caps cannot silently resize the existing account; caution suppresses over-budget cards',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center'),s=state();s.marketDistribution.upLimit=12;
 const result=await buildDecisionCenter(s,{now});
 assert.equal(result.weather.positionCapPct,10);assert.equal(result.cards.length,0);
 assert.match(result.reasons.join(''),/原模拟盘等权预算更高/);
 assert.equal(result.checklist.find(x=>x.id==='paper').status,'waiting');
 s.paper.pool.cash=5000;assert.equal((await buildDecisionCenter(s,{now})).cards[0].plan.positionPct,5);
 const disabled=await buildDecisionCenter(state(),{now,config:{enabled:false}});assert.equal(disabled.cards.length,0);
});

test('four rule perspectives report missing source evidence, without pretending an LLM or a win rate',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center'),s=state();
 s.pool[0].baziDims={trend:82,fund:78};s.pool[0].baziWhy={trend:'已有均线条件成立'};
 s.pool[0].bazi={fundsEvidence:{observed:true,net:200000,source:'东方财富',method:'vendor-order-size-estimate',sourceTimestamp:null}};
 const council=(await buildDecisionCenter(s,{now})).cards[0].council;
 assert.equal(council.llmInvoked,false);assert.equal(council.views.length,4);
 assert.equal(council.views[0].score,null);assert.equal(council.views[0].vote,'待核验');
 assert.equal(council.views[1].score,82);assert.equal(council.views[1].vote,'支持');
 assert.equal(council.views[2].score,null);assert.equal(council.views[2].vote,'待核验');
 assert.equal(council.assessed,2);assert.equal(council.confidenceLevel,'中');assert.equal(council.views[1].confidenceLevel,'高');
 assert.match(council.confidenceKind,/非胜率/);
 s.pool[0].baziWhy.trend=['已有均线条件成立','原趋势方向向上'];
 const arrayBased=(await buildDecisionCenter(s,{now})).cards[0].council.views[1];
 assert.equal(arrayBased.vote,'支持');assert.match(arrayBased.evidence[1].text,/原趋势方向向上/);
});

test('authority identifiers survive same-price quote refreshes but change when the actual plan changes',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center'),s=currentState();
 const first=(await buildDecisionCenter(s,{now})).cards[0];
 s.decisionQuotes[0].quoteAt=now-500;s.decisionQuotes[0].receivedAt=now;s.decisionLevels['600001'].quoteAt=now-500;
 const second=(await buildDecisionCenter(s,{now:now+1000})).cards[0];
 assert.equal(first.decisionId,second.decisionId);assert.notEqual(first.quoteBasis.quoteAt,second.quoteBasis.quoteAt);
 s.decisionQuotes[0].price=10.1;const changed=(await buildDecisionCenter(s,{now:now+1000})).cards[0];
 assert.notEqual(first.decisionId,changed.decisionId);
});

test('browser validation rejects stale packages, missing authority and inconsistent plan or quote metadata',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center'),{readDecisionBoard}=await import('../public/nova/decision-model.mjs');
 const valid=await buildDecisionCenter(state(),{now});
 assert.equal(readDecisionBoard(valid,{now:now+15001}).cards.length,0);
 for(const change of [p=>delete p.authority,p=>p.schemaVersion=999,p=>p.day='2026-11-24',p=>p.calculatedAt=now+1,
  p=>p.cards[0].plan.authority='browser',p=>p.cards[0].quoteBasis.price=99,p=>p.cards[0].canTrade=false,
  p=>p.cards[0].plan.stop=12,p=>p.cards[0].quoteBasis.receivedAt=now+1,p=>p.cards[0].conclusion.authority='browser']){
  const altered=structuredClone(valid);change(altered);assert.equal(readDecisionBoard(altered,{now}).cards.length,0);
 }
});

test('server plans require attributed K-line and account snapshots for every numeric plan field',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center');
 for(const change of [s=>delete s.decisionLevels,s=>delete s.decisionLevels['600001'].quoteAt,
  s=>s.decisionLevels['600001'].sourceAt=null,s=>s.decisionLevels['600001'].sourceAt=now+1,
  s=>s.decisionLevels['600001'].asOf=now-40000,s=>s.decisionLevels['600001'].source='',
  s=>delete s.decisionAccountEvidence,s=>s.decisionAccountEvidence.sourceAt=null,
  s=>s.decisionAccountEvidence.sourceAt=now+1,s=>s.decisionAccountEvidence.sourceAt=now-15001,
  s=>s.decisionAccountEvidence.kind='quote-timestamp']){
  const s=state();change(s);const result=await buildDecisionCenter(s,{now});
  assert.equal(result.cards.length,0);assert.match(result.reasons.join(''),/来源或时点|账户快照时点/);
 }
});

test('fresh, original cross-source conflicts add a centre exclusion without generating a quote or a perfect Q',async()=>{
 const {buildDecisionCenter}=require('../src/core/decision-center'),{fuseMultiSourcePrices}=require('../src/core/multi-source-price-consensus');
 const report=prices=>fuseMultiSourcePrices({code:'600001',now,sources:prices.map(([id,price])=>({id,status:'fresh-unverified',
  quote:{code:'600001',exchange:'SH',currency:'CNY',adjustment:'unadjusted',status:'normal',price,previousClose:9.8,quoteAt:now-1000}}))});
 const s=state(),before=JSON.stringify(s);s.crossChecksByCode={'600001':report([['tencent',10],['eastmoney',12]])};
 const result=await buildDecisionCenter(s,{now});
 assert.equal(result.cards.length,0);assert.equal(result.qualityByCode['600001'].blocked,true);
 assert.equal(result.qualityByCode['600001'].qScore,null);assert.match(result.reasons.join(''),/多源报价存在冲突/);
 assert.equal(result.qualityByCode['600001'].sourceEvidence[0].price,10);
 delete s.crossChecksByCode;assert.equal(JSON.stringify(s),before);
 const absent=await buildDecisionCenter(s,{now});assert.equal(absent.cards.length,1);
 assert.equal(absent.cards[0].lineage.quality.status,'unknown');assert.equal(absent.cards[0].lineage.quality.qScore,null);
 s.crossChecksByCode={'600001':report([['tencent',10],['eastmoney',10]])};
 const consistent=await buildDecisionCenter(s,{now});assert.equal(consistent.cards.length,1);
 assert.equal(consistent.qualityByCode['600001'].status,'observed-agreement');assert.equal(consistent.cards[0].price,10);
 s.crossChecksByCode={'600001':report([['tencent',12],['eastmoney',10],['sina',10]])};
 assert.equal((await buildDecisionCenter(s,{now})).cards.length,0);
});
