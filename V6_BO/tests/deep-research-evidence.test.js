'use strict';
// All observations in this file are deterministic test fixtures. None are
// written to the production archives or presented as real market validation.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const D=require('../src/core/deep-research-evidence');
const at=x=>Date.parse(x+'+08:00');
const t0=at('2026-11-02T10:00:00'),t1=at('2026-11-03T10:00:00'),t2=at('2026-11-04T10:00:00');
const nativeHash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const proof=(id,stamp=t0,extra={})=>({id,revision:1,source:'supplied-provider',sourceUrl:'https://example.org/disclosure/'+id,
  publishedAt:stamp,firstKnownAt:stamp,recordedAt:stamp,...extra});
const event=(extra={})=>proof('buyback-1',t0,{symbol:'600000',eventType:'buyback',title:'公司回购进展',bodyScope:'declared-body',...extra});
const outcome=(extra={})=>proof('outcome-1',t1,{eventId:'buyback-1',eventRevision:1,symbol:'600000',horizonSessions:1,
  startAt:t0,endAt:t1,stock:{startPrice:10,endPrice:11,currency:'CNY',priceBasis:'unadjusted',corporateAction:false},
  benchmark:{symbol:'index-all-a',source:'supplied-benchmark',knownAt:t1,startAt:t0,endAt:t1,startPrice:100,endPrice:108,currency:'CNY',priceBasis:'unadjusted'},...extra});
const relation=(id,from,extra={})=>proof(id,t0,{from,to:'supplier-entity',relation:'supplier',relationClass:'business',
  bodyScope:'declared-body',validFrom:t0,validUntil:null,...extra});
const quote=(price,stamp=t2)=>({price,quoteAt:stamp,receivedAt:stamp,quoteSource:'supplied-quotes',canTrade:true});
const account=(extra={})=>({accountId:'pool',source:'v6-authoritative-ledger',sourceAt:t2,equity:4000,
  positions:[{symbol:'600000',shares:100,quote:quote(10)},{symbol:'600001',shares:100,quote:quote(20)}],...extra});
const depth=(extra={})=>proof('depth-1',t2,{symbol:'600000',granularity:'depth-snapshot',quoteAt:t2,receivedAt:t2,price:10,volumeUnit:'shares',
  bids:[{price:9.9,quantity:200},{price:9.8,quantity:100}],asks:[{price:10.1,quantity:100},{price:10.2,quantity:100}],
  authorization:{provider:'supplied-provider',status:'granted',scope:['depth-snapshot'],evidenceId:'authorization-document',knownAt:t0,validFrom:t0,validUntil:t2+86400000},...extra});
const theme=(extra={})=>proof('theme-1',t2,{name:'研究题材',membershipComplete:true,snapshotAt:t2,
  members:['600000','600001','600002','600003','600004'],
  stocks:['600000','600001','600002','600003','600004'].map((s,i)=>({symbol:s,amount:[60,20,10,5,5][i],turnoverPct:12,changePct:6,
    limitUp:i<2,quoteAt:t2,source:'supplied-quotes'})),...extra});

test('empty inputs keep all six modules unknown, never invent values or grant execution',()=>{
  const r=D.buildDeepResearchEvidence({}, {asOf:t2});
  assert.deepEqual(Object.keys(r.modules),['67','68','69','70','71','72']);
  for(const m of Object.values(r.modules)){assert.equal(m.status,'unknown');assert.equal(m.canTrade,false);assert.equal(m.accountWrites,false);assert.ok(m.missing.length);}
  assert.equal(r.riskObservations.length,0);
  assert.throws(()=>D.buildDeepResearchEvidence({}, {asOf:NaN}),/时点/);
  assert.throws(()=>D.buildDeepResearchEvidence({events:Array(10001).fill({})},{asOf:t2}),/有界/);
});

test('event study separates market rise from excess, preserves every horizon and failed cases',()=>{
  const failure=outcome({id:'outcome-5',horizonSessions:5,endAt:t2,publishedAt:t2,firstKnownAt:t2,recordedAt:t2,
    stock:{startPrice:10,endPrice:9,currency:'CNY',priceBasis:'unadjusted',corporateAction:false},
    benchmark:{...outcome().benchmark,knownAt:t2,endAt:t2,endPrice:105}});
  const input={events:[event()],eventOutcomes:[outcome(),failure]},before=JSON.stringify(input);
  const r=D.buildEventImpactStudy(input,{asOf:t2});
  assert.equal(r.rows[0].stockReturnPct,10);assert.equal(r.rows[0].benchmarkReturnPct,8);assert.equal(r.rows[0].excessReturnPct,2);
  assert.deepEqual(r.durationProfile.map(x=>x.horizonSessions),[1,5]);
  assert.equal(r.groups[1].failureCases[0].excessReturnPct,-15);assert.equal(r.rows[0].drawdownPct,null);
  assert.equal(JSON.stringify(input),before);
});

test('event receipt cutoff, source revisions and later data cannot rewrite an earlier as-of report',()=>{
  const input={events:[event()],eventOutcomes:[outcome()]},expected=D.buildEventImpactStudy(input,{asOf:t1});
  input.events.push(event({revision:2,publishedAt:t2,firstKnownAt:t2,recordedAt:t2,title:'后来修订'}));
  input.eventOutcomes.push(outcome({id:'future',publishedAt:t2,firstKnownAt:t2,recordedAt:t2,stock:{...outcome().stock,endPrice:999}}));
  assert.deepEqual(D.buildEventImpactStudy(input,{asOf:t1}),expected);
  const late=D.buildEventImpactStudy({events:[event({firstKnownAt:t0+1,recordedAt:t0+1})],eventOutcomes:[outcome()]},{asOf:t1});
  assert.equal(late.rows.length,0);assert.equal(late.rejected[0].reason,'entry-before-event-known');
  assert.equal(D.buildEventImpactStudy(input,{asOf:t2}).rows.length,0);
});

test('missing and late benchmarks stay null; corporate actions cannot become false event returns',()=>{
  for(const change of [b=>({...b,knownAt:t2}),b=>({...b,startAt:t0-1}),b=>({...b,priceBasis:'qfq'}),()=>undefined]){
    const r=D.buildEventImpactStudy({events:[event()],eventOutcomes:[outcome({benchmark:change(outcome().benchmark)})]},{asOf:t1});
    assert.equal(r.rows[0].excessReturnPct,null);assert.equal(r.rows[0].failure,null);
  }
  const r=D.buildEventImpactStudy({events:[event()],eventOutcomes:[outcome({stock:{...outcome().stock,corporateAction:true}})]},{asOf:t1});
  assert.equal(r.rows.length,0);
});

test('duplicate identical source revisions dedupe while conflicting revisions quarantine that event',()=>{
  assert.equal(D.buildEventImpactStudy({events:[event(),event()]},{asOf:t1}).events.length,1);
  const r=D.buildEventImpactStudy({events:[event(),event({title:'同版冲突'})],eventOutcomes:[outcome()]},{asOf:t1});
  assert.equal(r.events.length,0);assert.equal(r.rows.length,0);assert.ok(r.rejected.some(x=>x.reason==='conflicting-revision'));
});

function eventArchive(){
  // Explicit fixture sessions, independent of the observed bar dates. This is
  // isolated test material and never an operational holiday-calendar source.
  const sessions=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10']
    .map(date=>({date,open:!['2026-11-07','2026-11-08'].includes(date)}));
  const calendar={schemaVersion:1,exchange:'SSE',source:'supplied-calendar',from:'2026-11-02',to:'2026-11-10',sessions};
  const tradeDates=sessions.filter(s=>s.open).map(s=>s.date),asOf=at('2026-11-10T16:00:00');
  const bars=tradeDates.slice(0,-1).map((date,i)=>({date,role:'stock',code:'600000',period:'日K',source:'V6/supplied-daily',
    knownAt:at(date+'T15:00:01'),open:10+i,high:12+i,low:9+i,close:11+i,priceBasis:'unadjusted',corporateAction:false}));
  const receivedAt=at('2026-11-09T16:00:00'),indexEvidence={name:'中证全指',source:'supplied-index',receivedAt,
    rows:tradeDates.slice(0,-1).map((date,i)=>({date,open:100+i,close:102+i}))};
  return {asOf,events:[event()],archive:{scope:'live',bars,market:[{date:'2026-11-09',indexEvidence}]},
    eventCalendar:{status:'available',calendar,tradeDates,metadata:{source:calendar.source,sha256:nativeHash(calendar),
      knowledgeAvailableAt:new Date(t0-86400000).toISOString()}}};
}

test('event study derives fixed 1/5/20/60 windows from original raw archives and preserves source receipts',()=>{
  const input=eventArchive(),before=JSON.stringify(input);
  const report=D.buildDeepResearchEvidence(input,{asOf:input.asOf}).modules[67];
  assert.deepEqual(report.archiveDerivation.policy.horizons,[1,5,20,60]);
  assert.deepEqual(report.rows.map(r=>r.horizonSessions),[1,5]);
  assert.equal(report.rows[0].startAt,at('2026-11-03T09:30:00'),'the intraday event cannot use that morning open');
  assert.equal(report.rows[0].endAt,at('2026-11-03T15:00:00'));
  assert.equal(report.rows[1].endAt,at('2026-11-09T15:00:00'));
  assert.equal(report.rows[0].stockReturnPct,9.090909);assert.equal(report.rows[0].benchmarkReturnPct,1.980198);
  assert.equal(report.rows[0].excessReturnPct,7.110711);
  assert.equal(report.rows[0].priceEvidence[0].knownAt,at('2026-11-03T15:00:01'));
  assert.equal(report.rows[0].benchmark.knownAt,at('2026-11-09T16:00:00'));
  assert.equal(report.rows[0].benchmark.evidence.start.receivedAt,at('2026-11-09T16:00:00'));
  assert.equal(report.rows[0].drawdownPct,null);assert.equal(report.archiveDerivation.policy.executableReturn,false);
  assert.deepEqual(report.archiveDerivation.pending.map(r=>r.horizonSessions),[20,60]);
  assert.ok(report.groups.every(g=>g.status==='insufficient-independent-samples'&&g.independentEvents===1&&g.inferenceCertified===false));
  assert.equal(JSON.stringify(input),before,'research projection must leave the original archive byte representation intact');
});

test('event archive gaps, unknown corporate actions and missing market benchmark remain explicit pending evidence',()=>{
  const original=eventArchive();
  const missingIndex=structuredClone(original);missingIndex.archive.market=[];
  let report=D.buildDeepResearchEvidence(missingIndex,{asOf:original.asOf}).modules[67];
  assert.equal(report.rows.length,2);assert.ok(report.rows.every(r=>r.excessReturnPct===null&&r.failure===null));
  assert.ok(report.archiveDerivation.pending.some(r=>r.horizonSessions===1&&/指数/.test(r.reason)));
  const noCorporateAction=structuredClone(original);for(const b of noCorporateAction.archive.bars)delete b.corporateAction;
  report=D.buildDeepResearchEvidence(noCorporateAction,{asOf:original.asOf}).modules[67];
  assert.equal(report.rows.length,0);assert.ok(report.missing.some(r=>/公司行为/.test(r)));
  const gap=structuredClone(original);gap.archive.bars=gap.archive.bars.filter(b=>b.date!=='2026-11-04');
  report=D.buildDeepResearchEvidence(gap,{asOf:original.asOf}).modules[67];
  assert.deepEqual(report.rows.map(r=>r.horizonSessions),[1]);
  assert.ok(report.archiveDerivation.pending.some(r=>r.horizonSessions===5&&/缺日/.test(r.reason)));
  const learnedLate=structuredClone(original);learnedLate.eventCalendar.metadata.knowledgeAvailableAt=new Date(t1).toISOString();
  report=D.buildDeepResearchEvidence(learnedLate,{asOf:original.asOf}).modules[67];
  assert.equal(report.rows.length,0);assert.ok(report.missing.some(r=>/事件之后才可知/.test(r)));
  const unsupportedExchange=structuredClone(original);unsupportedExchange.events[0].symbol='430047';
  for(const b of unsupportedExchange.archive.bars)b.code='430047';
  report=D.buildDeepResearchEvidence(unsupportedExchange,{asOf:original.asOf}).modules[67];
  assert.equal(report.rows.length,0);assert.ok(report.missing.some(r=>/交易所/.test(r)));
});

test('archive event derivation keeps future revisions invisible and quarantines same-receipt conflicts',()=>{
  const input=eventArchive(),asOf=at('2026-11-04T10:00:00');
  input.archive.marketHistory=[{indexEvidence:{...input.archive.market[0].indexEvidence,receivedAt:at('2026-11-03T16:00:00'),
    rows:input.archive.market[0].indexEvidence.rows.slice(0,2)}}];
  const expected=D.buildDeepResearchEvidence(input,{asOf}).modules[67];
  assert.equal(expected.rows.length,1);assert.equal(expected.rows[0].benchmark.knownAt,at('2026-11-03T16:00:00'));
  const original=input.archive.bars.find(b=>b.date==='2026-11-03');
  input.archive.bars.push({...original,knownAt:at('2026-11-05T16:00:00'),close:999,high:1000});
  assert.deepEqual(D.buildDeepResearchEvidence(input,{asOf}).modules[67],expected);
  input.archive.bars.push({...original,close:13});
  const conflict=D.buildDeepResearchEvidence(input,{asOf}).modules[67];
  assert.equal(conflict.rows.length,0);assert.ok(conflict.missing.some(x=>/来源冲突/.test(x)));
  const synthetic=eventArchive();synthetic.archive.bars.forEach(b=>{b.synthetic=true;});
  assert.equal(D.buildDeepResearchEvidence(synthetic,{asOf:synthetic.asOf}).modules[67].rows.length,0);
});

const expected=(extra={})=>proof('expected-1',t0,{symbol:'600000',period:'2026Q3',metric:'net-profit',unit:'CNY',value:100,
  expectationKind:'consensus',sampleSize:3,...extra});
const actual=(extra={})=>proof('actual-1',t1,{symbol:'600000',period:'2026Q3',metric:'net-profit',unit:'CNY',value:110,
  announcementAt:t1,higherIsBetter:true,...extra});
test('expectations use strictly pre-announcement archives, including when the actual is revised later',()=>{
  const r=D.buildExpectationStudy({expectations:[expected(),expected({revision:2,publishedAt:t1,firstKnownAt:t1,recordedAt:t1,value:110})],
    actuals:[actual(),actual({revision:2,publishedAt:t2,firstKnownAt:t2,recordedAt:t2,value:120})]},{asOf:t2});
  assert.equal(r.rows[0].expected,100);assert.equal(r.rows[0].actual,120);assert.equal(r.rows[0].surprisePct,20);
  assert.equal(r.rows[0].evidence[0].revision,1);
  const late=D.buildExpectationStudy({expectations:[expected({firstKnownAt:t1+1,recordedAt:t1+1})],actuals:[actual()]},{asOf:t2});
  assert.equal(late.rows[0].expected,null);assert.equal(late.rows[0].classification,'unknown');
  const rewritten=D.buildExpectationStudy({expectations:[expected()],actuals:[actual(),actual({revision:2,
    announcementAt:t2,publishedAt:t2,firstKnownAt:t2,recordedAt:t2})]},{asOf:t2});
  assert.equal(rewritten.rows.length,0);assert.ok(rewritten.rejected.some(x=>x.reason==='actual-identity-or-original-announcement-rewritten'));
});

test('missing expectations, incompatible units and zero expectations do not fabricate consensus or percentages',()=>{
  for(const expectations of [[],[expected({unit:'USD'})],[expected({value:null})],[expected({sampleSize:0})]]){
    const r=D.buildExpectationStudy({expectations,actuals:[actual()]},{asOf:t2});assert.equal(r.rows[0].expected,null);
  }
  const r=D.buildExpectationStudy({expectations:[expected({value:0})],actuals:[actual()]},{asOf:t2});
  assert.equal(r.rows[0].surprise,110);assert.equal(r.rows[0].surprisePct,null);
});

test('price reaction classification uses a mature sourced interval and retains causal uncertainty',()=>{
  const priceReaction=proof('reaction',t2,{symbol:'600000',startAt:t1,endAt:t2,startPrice:10,endPrice:9,priceBasis:'unadjusted',corporateAction:false});
  const r=D.buildExpectationStudy({expectations:[expected()],actuals:[actual({priceReaction})]},{asOf:t2});
  assert.equal(r.rows[0].priceResponseCase,'positive-surprise-negative-response');assert.equal(r.rows[0].priceReaction.returnPct,-10);
  const early=D.buildExpectationStudy({expectations:[expected()],actuals:[actual({priceReaction})]},{asOf:t1});
  assert.equal(early.rows[0].priceReaction,null);
});

test('relationships keep business, indirect and concepts separate, with effective periods and source documents',()=>{
  const rows=[relation('one','600000'),relation('two','600001'),relation('expired','600002',{validUntil:t1}),
    relation('concept','600003',{relationClass:'concept',bodyScope:'provider-summary'}),relation('headline','600004',{bodyScope:'provider-summary'})];
  const r=D.buildRelationshipGraph({relations:rows,account:account()},{asOf:t2});
  assert.equal(r.rows.length,3);assert.equal(r.commonExposures.length,1);assert.deepEqual(r.commonExposures[0].symbols,['600000','600001']);
  assert.equal(r.commonExposures[0].holdingExposure.weightOfHoldingsPct,100);
  assert.equal(r.commonExposures[0].holdingExposure.weightOfAccountPct,75);
  assert.ok(r.rejected.some(x=>x.reason==='business-relation-needs-public-document-body'));
  const unknown=D.buildRelationshipGraph({relations:rows,account:account({positions:[...account().positions.slice(0,1),{symbol:'600001',shares:100,quote:quote(20,t2-15001)}]})},{asOf:t2});
  assert.equal(unknown.commonExposures[0].holdingExposure.weightOfHoldingsPct,null);
});

test('a relation learned after an event cannot appear as the event-time impact path',()=>{
  const r=D.buildRelationshipGraph({relations:[relation('early','600000'),relation('late','600001',{publishedAt:t1,firstKnownAt:t1,recordedAt:t1})],
    events:[event({entityIds:['supplier-entity']})]},{asOf:t2});
  assert.deepEqual(r.eventExposure[0].paths.map(x=>x.symbol),['600000']);assert.equal(r.eventExposure[0].impactDirection,'unknown');
});

test('ordinary snapshots cannot masquerade as depth, trades, queues or principal intent',()=>{
  const r=D.buildDepthResearch({depth:[depth({granularity:'quote-snapshot'})]},{asOf:t2});
  assert.equal(r.rows[0].status,'unsupported-granularity');assert.equal(r.rows[0].metrics,null);
  assert.equal(r.rows[0].queuePosition,null);assert.equal(r.rows[0].principalIntent,null);
});

test('depth needs exact provider/granularity authorization and preserves the 15-second boundary',()=>{
  const d=depth();
  let r=D.buildDepthResearch({depth:[d]},{asOf:t2+15000});
  assert.equal(r.rows[0].current,true);assert.equal(r.rows[0].metrics.bookImbalance,.2);assert.equal(r.rows[0].metrics.spreadBps,200);
  assert.equal(r.riskObservations[0].isTradeInstruction,false);assert.equal(r.riskObservations[0].canTrade,false);
  r=D.buildDepthResearch({depth:[d]},{asOf:t2+15001});assert.equal(r.rows[0].status,'historical-only');assert.equal(r.riskObservations.length,0);
  for(const authorization of [null,{...d.authorization,provider:'other'},{...d.authorization,scope:['trade-ticks']},{...d.authorization,knownAt:t2+1}]){
    const denied=D.buildDepthResearch({depth:[depth({authorization})]},{asOf:t2});assert.equal(denied.rows[0].metrics,null);
  }
});

test('depth rejects late source receipts, crossed books, future times and synthetic sources',()=>{
  const delayed=depth({firstKnownAt:t2+15001,recordedAt:t2+15001,receivedAt:t2+15001});
  assert.equal(D.buildDepthResearch({depth:[delayed]},{asOf:t2+15001}).rows[0].status,'source-time-unusable');
  const crossed=depth({asks:[{price:9.9,quantity:50}]});assert.equal(D.buildDepthResearch({depth:[crossed]},{asOf:t2}).rows[0].metrics,null);
  const future=depth({quoteAt:t2+1});assert.equal(D.buildDepthResearch({depth:[future]},{asOf:t2}).rows[0].status,'source-time-unusable');
  const synthetic=depth({source:'synthetic'});assert.equal(D.buildDepthResearch({depth:[synthetic]},{asOf:t2}).rows.length,0);
});

test('trade imbalance requires real tick directions and never substitutes order-book imbalance',()=>{
  const d=depth({granularity:'trade-ticks',authorization:{...depth().authorization,scope:['trade-ticks']},
    trades:[{id:'a',at:t2-1000,price:10,quantity:100,aggressor:'buy'},{id:'b',at:t2,price:10,quantity:50,aggressor:'unknown'}]});
  let r=D.buildDepthResearch({depth:[d]},{asOf:t2});assert.equal(r.rows[0].metrics.tradeImbalance,null);assert.equal(r.rows[0].metrics.bookImbalance,null);
  d.trades[1].aggressor='sell';r=D.buildDepthResearch({depth:[d]},{asOf:t2});assert.equal(r.rows[0].metrics.tradeImbalance,.333333);
  d.trades[1].id='a';assert.equal(D.buildDepthResearch({depth:[d]},{asOf:t2}).rows[0].metrics,null);
});

test('auction research reuses the existing indicative-versus-executed evidence rules',()=>{
  const end=at('2026-11-04T09:25:00'),source='supplied-provider';
  const tick=(ts,price,volume,extra={})=>({code:'600000',source,quoteAt:at('2026-11-04T'+ts),receivedAt:at('2026-11-04T'+ts),indicativePrice:price,indicativeMatchedVolume:volume,...extra});
  const stock={code:'600000',source,previousClose:10,dailyAverageAmount20:1e8,snapshots:[
    tick('09:20:00',10.1,1000),tick('09:24:59',10.2,1200),tick('09:25:00',10.2,1200,{executed:true,executedAmount:4000000})]};
  const d=depth({...proof('auction',end),quoteAt:end,receivedAt:end,granularity:'auction-indicative',stock,
    authorization:{...depth().authorization,scope:['auction-indicative']}});
  const r=D.buildDepthResearch({depth:[d]},{asOf:end});assert.equal(r.rows[0].auction.factors.executedAuctionAmount,4000000);
  assert.equal(r.rows[0].auction.canTrade,false);assert.equal(r.rows[0].auction.factors.matchedVolumeGrowth,1.2);
});

function paperArchive(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deep-research-paper-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {createPaperApplicationService}=require('../src/core/paper-application-service');
  const {importSettledPaperTrades}=require('../src/research/shortline-paper-import');
  let now=at('2026-11-04T10:00:00');const file=path.join(dir,'pool.json'),service=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});
  service.initialize(100000);
  for(const [id,side,price,stamp]of [['buy','buy',10,'2026-11-04T10:00:00'],['sell','sell',11,'2026-11-05T11:00:00']]){
    now=at(stamp);const date=stamp.slice(0,10);
    service.submit({orderId:id,side,quantity:100,symbol:'600000',limitPrice:price,tradeDate:date,strategyId:'fourteen'});
    service.fill(id,id+'-fill',{symbol:'600000',timestamp:now,source:'simulated',tradeDate:date,suspended:false,tradable:true,price,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5});
  }
  now+=60000;const archive={scope:'live',plans:[],trades:[]};importSettledPaperTrades(archive,{accountDir:dir,now});
  assert.equal(archive.trades.length,1);return {archive,now,file};
}

test('session adapter reads original mature net settlements at cent precision without ledger writes',t=>{
  const x=paperArchive(t),before=fs.readFileSync(x.file),a=D.extractDeepArchiveInputs(x.archive,{now:x.now});
  assert.equal(a.sessionSamples.length,1);assert.equal(a.sessionSamples[0].system,'fourteen');
  assert.ok(a.sessionSamples[0].netReturnPct<10);assert.ok(a.sessionSamples[0].costCents>0);
  assert.equal(a.sessionSamples[0].decisionAt,null);assert.equal(a.sessionSamples[0].signalWindow,'unknown');
  const r=D.buildSessionEffectiveness({archive:x.archive},{asOf:x.now});assert.equal(r.rows.length,1);assert.equal(r.unassigned.length,1);
  assert.ok(r.groups.every(g=>g.settlements.samples===0));assert.deepEqual(fs.readFileSync(x.file),before);
  const future=D.extractDeepArchiveInputs(x.archive,{now:x.now-60001});assert.equal(future.sessionSamples.length,0);
});

test('session evidence rejects changed fingerprints, same-day exits and demo archives',t=>{
  const x=paperArchive(t),bad=structuredClone(x.archive);bad.trades[0].paperSettlement.realizedCents+=100;
  assert.equal(D.extractDeepArchiveInputs(bad,{now:x.now}).sessionSamples.length,0);
  const same=structuredClone(x.archive),row=same.trades[0];row.paperSettlement.entryFills[0].time=row.paperSettlement.exitTimestamp-1000;
  row.sourceFingerprint=nativeHash(row.paperSettlement);assert.equal(D.extractDeepArchiveInputs(same,{now:x.now}).sessionSamples.length,0);
  assert.equal(D.extractDeepArchiveInputs({...x.archive,scope:'demo'},{now:x.now}).sessionSamples.length,0);
  const mixed=structuredClone(x.archive);mixed.trades[0].sampleSet='test';
  assert.equal(D.extractDeepArchiveInputs(mixed,{now:x.now}).sessionSamples.length,0);
  const extracted=D.extractDeepArchiveInputs(x.archive,{now:x.now});extracted.sessionSamples[0].netReturnPct=999;
  assert.notEqual(D.buildSessionEffectiveness(extracted,{asOf:x.now}).rows[0].netReturnPct,999);
});

test('four-strategy session analysis reuses native cost and execution gates, with horizons kept separate',()=>{
  const W=require('../src/core/research-workspace-decision'),{fixture,native,event:we,at:wa}=require('./helpers/research-workspace-fixtures');
  const events=[we(W.buildWorkspaceDecision(fixture(),native())),we(W.buildWorkspaceDecision(fixture({index:140}),native(140)),2)];
  const r=D.buildSessionEffectiveness({workspaceEvents:events},{asOf:wa(140)}),g=r.groups.find(g=>g.system==='python'&&g.session==='overnight');
  assert.equal(r.groups.length,28);assert.equal(g.settlements.samples,0);assert.equal(g.modeled.length,4);assert.ok(g.modeled.every(x=>x.samples===1));
  const original=g.modeled[0].meanNetReturnPct;
  const costly=D.buildSessionEffectiveness({workspaceEvents:events},{asOf:wa(140),costs:{feeBps:100,slippageBps:100}});
  assert.ok(costly.groups.find(g=>g.system==='python'&&g.session==='overnight').modeled[0].meanNetReturnPct<original);
  const blocked=structuredClone(events);blocked[1].data.bars[71].suspended=true;
  const b=D.buildSessionEffectiveness({workspaceEvents:blocked},{asOf:wa(140)});
  assert.ok(b.rows.filter(x=>x.system==='python').every(x=>x.netReturnPct===null));
});

test('session windows use Beijing time and never classify lunch as executable morning/afternoon',()=>{
  const times=['08:30:00','09:15:00','09:30:00','10:00:00','11:30:00','13:00:00','14:30:00','15:00:00'];
  assert.deepEqual(times.map(t=>D.sessionOf(at('2026-11-02T'+t))),['premarket','auction','opening','morning','break','afternoon','closing','overnight']);
});

test('theme crowding uses all-member denominators, actual holdings and descriptive progressive warnings',()=>{
  const r=D.buildThemeCrowding({themes:[theme()],account:account()},{asOf:t2});
  assert.equal(r.rows[0].metrics.turnoverConcentrationTop3Pct,90);assert.equal(r.rows[0].metrics.limitUpFractionPct,40);
  assert.equal(r.rows[0].holdingExposure.weightOfAccountPct,75);assert.equal(r.riskObservations[0].level,2);
  assert.equal(r.riskObservations[0].isTradeInstruction,false);assert.ok(r.riskObservations[0].releaseCondition);
  const partial=theme();partial.stocks[2].turnoverPct=null;
  const p=D.buildThemeCrowding({themes:[partial]},{asOf:t2});assert.equal(p.rows[0].metrics.meanTurnoverPct,null);assert.equal(p.riskObservations.length,0);
  const absent=theme();absent.stocks.pop();const m=D.buildThemeCrowding({themes:[absent]},{asOf:t2});
  assert.equal(m.rows[0].coveragePct,80);assert.equal(m.rows[0].metrics.limitUpFractionPct,null);
});

test('duplicate theme members, unknown membership and old snapshots do not create current risk claims',()=>{
  const duplicate=theme();duplicate.stocks.push({...duplicate.stocks[0],amount:999});
  assert.equal(D.buildThemeCrowding({themes:[duplicate]},{asOf:t2}).rows.length,0);
  assert.equal(D.buildThemeCrowding({themes:[theme({membershipComplete:false})]},{asOf:t2}).rows.length,0);
  const old=D.buildThemeCrowding({themes:[theme()]},{asOf:t2+15001});assert.equal(old.rows[0].current,false);assert.equal(old.riskObservations.length,0);
});

test('news adapter preserves each actual receipt and cannot stamp an unknown revision with the original time',()=>{
  const original={sequence:1,eventHash:'a'.repeat(64),recordedAt:t0+200,evidence:{source:'supplied-news',eventId:'event-a',securities:['600000'],
    kind:'original',publishedAt:t0,receivedAt:t0+100,revisedAt:null,title:'公司回购公告',url:'https://example.org/event-a',bodyScope:'provider-summary'}};
  const revised={...original,sequence:2,eventHash:'b'.repeat(64),recordedAt:t1+200,evidence:{...original.evidence,kind:'revised',receivedAt:t1+100,revisedAt:t1,title:'回购进展修订'}};
  const rows=D.extractNewsJournalEvents([revised,original],{asOf:t2});assert.equal(rows[0].firstKnownAt,t0+100);assert.equal(rows[1].firstKnownAt,t1+100);
  assert.equal(rows[1].publishedAt,t1);assert.equal(rows[1].revision,2);
  assert.equal(D.extractNewsJournalEvents([original,revised],{asOf:t0+200}).length,1);
  revised.evidence.revisedAt=null;const unknown=D.extractNewsJournalEvents([original,revised],{asOf:t2});
  assert.equal(unknown[1].publishedAt,null);
  const quarantined=D.buildEventImpactStudy({events:unknown},{asOf:t2});
  assert.ok(quarantined.rejected.some(x=>x.reason==='missing-or-invalid-source-time'));assert.equal(quarantined.events.length,0);
  const removed={...revised,evidence:{...revised.evidence,revisedAt:t1,securities:[]}};
  const withdrawals=D.extractNewsJournalEvents([original,removed],{asOf:t2});
  assert.equal(withdrawals[1].associationRemoved,true);assert.equal(withdrawals[1].retracted,true);
  assert.equal(D.buildEventImpactStudy({events:withdrawals},{asOf:t2}).events[0].retracted,true);
});

test('F04.5 original event outcome archive projects pre-publication placebo without replacing existing event returns',()=>{
 const sessions=[];for(let t=Date.parse('2026-07-01T00:00:00Z');sessions.length<120;t+=86400000){const d=new Date(t);sessions.push({date:d.toISOString().slice(0,10),open:![0,6].includes(d.getUTCDay())});}
 const dates=sessions.filter(s=>s.open).map(s=>s.date),calendar={schemaVersion:1,exchange:'SSE',source:'supplied-calendar',from:sessions[0].date,to:sessions.at(-1).date,sessions};
 const publicAt=at(dates[65]+'T10:00:00'),asOf=at(dates[80]+'T16:00:00'),e=proof('pre-event-control',publicAt,{symbol:'600000',eventType:'policy',title:'政策原文'});
 const bars=dates.slice(0,81).map(date=>({date,role:'stock',code:'600000',period:'日K',source:'V6/supplied-daily',knownAt:at(date+'T15:00:01'),open:10,high:12,low:9,close:11,priceBasis:'unadjusted',corporateAction:false}));
 const market=dates.slice(0,81).map(date=>({date,indexEvidence:{name:'中证全指',source:'supplied-index',receivedAt:at(date+'T15:01:00'),rows:[{date,open:100,close:105,knownAt:at(date+'T15:00:01')}]}}));
 const eventCalendar={status:'available',calendar,tradeDates:dates,metadata:{source:calendar.source,sha256:nativeHash(calendar),knowledgeAvailableAt:new Date(at(dates[0]+'T09:00:00')).toISOString()}};
 const input={events:[e],archive:{scope:'live',bars,market},eventCalendar};
 const before=JSON.stringify(input),r=D.buildDeepResearchEvidence(input,{asOf}).modules[67];
 const first=r.rows.find(row=>row.horizonSessions===1);assert.ok(first);assert.equal(first.stockReturnPct,10);assert.equal(first.excessReturnPct,5);
 assert.equal(first.preEventStudy.status,'descriptive-unverified');assert.equal(first.preEventStudy.cutoff,publicAt);assert.equal(first.preEventStudy.estimationDates.length,20);assert.equal(first.preEventStudy.placeboDates.length,1);assert.equal(first.preEventStudy.placeboDates[0],dates[64]);
 assert.ok(Math.abs(first.preEventStudy.placeboGrossExcessPct-5)<1e-10);assert.equal(first.preEventStudy.matchedIndustry,null);assert.equal(first.preEventStudy.netAbnormalReturnPct,null);assert.equal(first.preEventStudy.preregistered,false);assert.equal(JSON.stringify(input),before);
 const late=structuredClone(input);late.archive.market[64].indexEvidence.receivedAt=publicAt+1;
 const replay=D.buildDeepResearchEvidence(late,{asOf}).modules[67].rows.find(row=>row.horizonSessions===1);
 assert.equal(replay.excessReturnPct,5);assert.equal(replay.preEventStudy.status,'unknown');assert.equal(replay.preEventStudy.placeboGrossExcessPct,null);
 const declared=D.buildEventImpactStudy({events:[event()],eventOutcomes:[outcome({preEventStudy:first.preEventStudy,inputOrigin:'explicit-private-import'})]},{asOf:t1});
 assert.equal(declared.rows[0].preEventStudy,null,'operator-imported claim cannot substitute original archive projection');
});

test('F01/F02 shared original report reviews explicit policy and business records, fund plans and private holdings without granting action',()=>{
 const e=event({body:'发文机关甲：产品甲适用。计划购买ETF。',policyApplicability:{entityId:'supplier-entity',productId:'alpha',clause:'产品甲适用'},publisherEvidence:{role:'issuing-entity',publisher:'发文机关甲',clause:'发文机关甲：产品甲适用'},fundActivity:{planClause:'计划购买ETF'}});
 const r=relation('policy-path','600000',{productId:'alpha',documentText:'企业主营产品甲',businessClause:'主营产品甲'});
 const report=D.buildDeepResearchEvidence({events:[e],relations:[r],account:account()},{asOf:t2});
 const review=report.modules[67].eventReview;assert.equal(review.rows.length,1);assert.equal(review.rows[0].policy.status,'declared-path-review');assert.equal(review.rows[0].fund.status,'declared-plan');assert.equal(review.rows[0].fund.buyerIdentity,null);
 assert.equal(review.rows[0].holdingRelated,true);assert.equal(review.notificationQueueVerified,false);assert.equal(review.canTrade,false);assert.equal(review.canNotify,false);
 const revoked={...r,revision:2,retracted:true,publishedAt:t1,firstKnownAt:t1,recordedAt:t1};
 const later=D.buildDeepResearchEvidence({events:[e],relations:[r,revoked],account:account()},{asOf:t2}).modules[67].eventReview;
 assert.equal(later.rows[0].policy.status,'unknown');
});
test('F05.6 original event report retains short reaction and unknown long context without upgrading market regime',()=>{
 const input=eventArchive(),r=D.buildDeepResearchEvidence(input,{asOf:input.asOf}).modules[67],row=r.rows.find(x=>x.horizonSessions===1);
 assert.equal(row.regimeOverlay.longContext.status,'unknown');assert.equal(row.regimeOverlay.shortReaction.status,'two-sessions-observed');assert.equal(row.regimeOverlay.productionRegimeChanged,false);assert.equal(row.regimeOverlay.canTrade,false);
 const forged=outcome({source:'v6-private-archive-event-study',inputOrigin:'read-only-archive-projection',regimeOverlay:row.regimeOverlay,preEventStudy:row.preEventStudy});
 const direct=D.buildEventImpactStudy({events:[event()],eventOutcomes:[forged]},{asOf:t2});
 assert.equal(direct.rows[0].regimeOverlay,null);assert.equal(direct.rows[0].preEventStudy,null);
});

test('F06/F07 original deep research report carries declared business path and catalyst evidence',()=>{
 const e=event({publishedAt:t1,firstKnownAt:t1,recordedAt:t1,body:'政策适用于产品甲。尚未签订新订单。',policyApplicability:{entityId:'product:alpha',productId:'alpha',clause:'政策适用于产品甲'},catalyst:{id:'catalyst-1',status:'planned',plannedAt:t2,clause:'政策适用于产品甲'}});
 const r=relation('business-alpha','600000',{to:'product:alpha',productId:'alpha',stage:'upstream',documentText:'主营产品甲。',businessClause:'主营产品甲'});
 const report=D.buildDeepResearchEvidence({events:[e],relations:[r]},{asOf:t2});
 const row=report.modules[67].eventReview.rows[0];
 assert.equal(row.industry.status,'declared-business-review');
 assert.equal(row.policy.status,'declared-path-review');
 assert.equal(row.catalyst.status,'planned');
 assert.equal(row.catalyst.active,false);
 assert.ok(row.textBaseline.sentences.some(s=>s.negationHint));
 assert.equal(row.industry.canTrade,false);
});

test('F16 original depth report accepts explicitly authorized L1 only and retains ordinary snapshot restriction',()=>{
 const d=depth(),side=(price,quantity)=>({symbol:d.symbol,source:d.source,volumeUnit:'shares',quoteAt:d.quoteAt,price,quantity});
 const row={...d,granularity:'quote-snapshot',levelOne:true,bids:[side(9.9,200)],asks:[side(10.1,100)],authorization:{...d.authorization,scope:['quote-snapshot']}};
 const r=D.buildDepthResearch({depth:[row]},{asOf:t2});
 assert.equal(r.rows[0].status,'observed-research');assert.equal(r.rows[0].metrics.completeOrderBook,false);assert.equal(r.rows[0].metrics.executionCapacity,null);assert.equal(r.rows[0].microstructure.pressureKind,'l1-displayed-quantity-proxy');
 assert.equal(r.riskObservations.length,0);assert.equal(r.microstructureSessions.rows[0].uniqueQuoteTimes,1);assert.equal(r.canTrade,false);
 const no=D.buildDepthResearch({depth:[{...row,authorization:null}]},{asOf:t2});assert.equal(no.rows[0].status,'authorization-unavailable');
 const ordinary=D.buildDepthResearch({depth:[{...row,levelOne:false}]},{asOf:t2});assert.equal(ordinary.rows[0].status,'unsupported-granularity');
});

test('F07 original reports distinguish declared issuer guidance and missing consensus entitlement',()=>{
 const g=expected({id:'guide',expectationKind:'company-guidance',metric:'净利润',unit:'万元',bodyScope:'declared-body',body:'2026Q3净利润100万元。',guidanceDocument:{issuerSymbol:'600000',documentKind:'issuer-guidance',clause:'2026Q3净利润100万元'}});
 const a=actual({metric:'净利润',unit:'万元'}),c=expected({id:'market',metric:'净利润',unit:'万元'});
 const r=D.buildExpectationStudy({actuals:[a],expectations:[g,c]},{asOf:t2});
 assert.equal(r.rows.find(x=>x.expectationKind==='company-guidance').expectationBasis.status,'declared-issuer-guidance');
 const denied=r.rows.find(x=>x.expectationKind==='consensus').expectationBasis;
 assert.equal(denied.comparison,null);assert.equal(denied.consensusAuthorized,false);
});
test('F07.4-F07.6 original archive projection uses prior frozen industry, fixed windows and rejects imported derived claims',()=>{
 const input=eventArchive(),dates=input.eventCalendar.tradeDates;
 const publicAt=at('2026-11-05T10:00:00'),members=['600000','600001','600002','600003','600004','600005'];
 input.events=[event({publishedAt:publicAt,firstKnownAt:publicAt,recordedAt:publicAt})];
 const start=at('2026-11-02T15:00:00'),end=at('2026-11-03T15:00:00'),known=end+1000;
 const evidence={provider:'eastmoney',symbol:'600000',tradeDate:'2026-11-03',knownAt:known,window:{start,end},returnBasis:'price',benchmark:{provider:'eastmoney',code:'000985',name:'全A',return:.01,knownAt:known},classification:{provider:'eastmoney',version:'v1',knownAt:start,effectiveAt:start},methodology:{noCorporateActions:true},boards:[{code:'A',name:'行业甲',category:'industry',members,membersKnownAt:start,membersEffectiveAt:start,return:.01,knownAt:known}],stocks:members.map(symbol=>({symbol,return:.01,knownAt:known}))};
 input.workspaceEvents=[{kind:'analysis',sequence:1,hash:'a'.repeat(64),recordedAt:known+1000,data:{symbol:'600000',tradeDate:'2026-11-03',asOf:known,provider:'eastmoney',priceBasis:'unadjusted',context:{marketLinkageEvidence:evidence}}}];
 const own=input.archive.bars;input.archive.bars=own.concat(members.slice(1).flatMap(code=>own.map(b=>({...b,code,open:10,low:9,high:11,close:10.1}))));
 input.archive.market=own.map(b=>({date:b.date,indexEvidence:{name:'中证全指',source:'supplied-index',receivedAt:at(b.date+'T15:01:00'),rows:[{date:b.date,open:100,close:101,knownAt:at(b.date+'T15:00:01')}]}}));
 const r=D.buildDeepResearchEvidence(input,{asOf:input.asOf}).modules[67],first=r.rows.find(x=>x.horizonSessions===1);
 assert.ok(first);assert.equal(first.industryReaction.status,'descriptive-unverified');assert.equal(first.industryReaction.industry.archiveHash,'a'.repeat(64));assert.equal(first.industryReaction.pricedInConfirmed,false);
 assert.equal(r.archiveDerivation.windowLifecycle[0].windows[0].status,'elapsed-needs-new-evidence');assert.equal(r.archiveDerivation.windowLifecycle[0].autoRenew,false);
 const forged=D.buildEventImpactStudy({events:[event()],eventOutcomes:[outcome({industryReaction:first.industryReaction,inputOrigin:'explicit-private-import'})]},{asOf:t1});
 assert.equal(forged.rows[0].industryReaction,null);
});
