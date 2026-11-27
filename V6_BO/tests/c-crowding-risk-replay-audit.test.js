'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {registerRiskAudit:register,freezeRiskDay:freeze,evaluateRiskAudit:evaluate}=require('../src/core/crowding-risk-replay-audit');
const policies=['original','fixed','conditional'],codes=['600000','600001'];
const calendar=[];for(let ms=Date.parse('2026-10-12T00:00:00Z');calendar.length<20;ms+=86400000){const d=new Date(ms);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)calendar.push(d.toISOString().slice(0,10));}
const at=(d,h='16:00:00')=>Date.parse(d+'T'+h+'+08:00'),registered=at(calendar[0],'09:00:00'),now=at(calendar.at(-1));
function setup(extra={}){
 const feed={source:'fixture',provider:'test-feed',datasetId:'isolated-risk-audit',priceBasis:'unadjusted'};
 const input={scope:'fixture',feed,population:'selected',horizon:1,lossPct:10,calendar,
  folds:{training:[calendar[0],calendar[2]],validation:[calendar[4],calendar[6]],holdout:[calendar[8],calendar[10]]},
  criteria:{minSamples:4,minDays:2,minTailWindows:1,tailConfidence:.5,maxFalseAlertRate:.25,maxMissRate:.25},
  policies:Object.fromEntries(policies.map((p,i)=>[p,{version:'v1',modelFingerprint:String(i+1).repeat(64),trainingEndedAt:registered-1}])),...extra};
 const plan=register(input,{now:registered}),days=Object.values(input.folds).flat(),target=new Set(days.map(d=>calendar[calendar.indexOf(d)+input.horizon]));
 const market={schemaVersion:1,feed:input.feed,asOf:calendar.at(-1),observedAt:now,calendar,stocks:codes.map((symbol,i)=>({symbol,corporateActions:[],bars:calendar.map(date=>({date,close:target.has(date)?i?105:90:100,volume:1000,suspended:false}))}))};
 const make=(day,edit=x=>x)=>{
  const cohort=freezeCohort({schemaVersion:1,feed:input.feed,signals:codes.map(symbol=>({signalId:day+'/'+symbol,symbol,system:'fourteen',cohort:'selected',provenance:'synthetic fixture',signalDate:day,signalAt:at(day),baselineClose:market.stocks.find(s=>s.symbol===symbol).bars.find(b=>b.date===day).close}))},{now:at(day)});
  const opinions=cohort.signals.flatMap((s,i)=>policies.map(policy=>({signalId:s.signalId,policy,planFingerprint:plan.fingerprint,target:'forward-close-loss-event',horizon:input.horizon,lossPct:input.lossPct,version:'v1',modelFingerprint:input.policies[policy].modelFingerprint,evidenceRef:policy+'/'+s.signalId,knownAt:at(day),verdict:policy==='original'?'alert':policy==='fixed'?'clear':i?'clear':'alert',probability:policy==='original'?.5:policy==='fixed'?.1:i?.2:.8,valueKind:'declared-event-probability'})));
  const changed=edit(opinions);return {cohort,packet:freeze(plan,cohort,changed,{now:at(day,'16:01:00')})};};
 return {input,plan,market,days,make,packets:days.map(d=>make(d))};
}
const run=f=>evaluate(f.plan,f.packets,f.market,{now});
test('C10.1 original frozen cohort and three policies use exactly the same four holdout labels',()=>{
 const f=setup(),before=JSON.stringify(f),r=run(f),h=r.folds.holdout;assert.equal(h.expectedSignals,4);assert.equal(h.knownOutcomes,4);assert.equal(h.pairedCount,4);assert.equal(h.coverage,1);
 assert.equal(h.perPolicy.original.paired.fp,2);assert.equal(h.perPolicy.fixed.paired.fn,2);assert.equal(h.perPolicy.conditional.paired.tp,2);assert.equal(h.perPolicy.conditional.paired.tn,2);assert.equal(JSON.stringify(f),before);assert.equal(r.canTrade,false);
});
test('C10.1 post-next-open freeze, late input and duplicate security-day are rejected',()=>{
 const f=setup(),x=f.packets[0];assert.throws(()=>freeze(f.plan,x.cohort,x.packet.opinions,{now:at(calendar[1],'09:30:00')}),/LATE/);
 const late=x.packet.opinions.map(o=>({...o,knownAt:at(calendar[1],'09:30:00')}));assert.throws(()=>freeze(f.plan,x.cohort,late,{now:x.packet.frozenAt}),/OPINION/);
 const s=x.cohort.signals[0],c=freezeCohort({schemaVersion:1,feed:x.cohort.feed,signals:[s,{...s,signalId:'copy',system:'bazi'}]},{now:x.cohort.frozenAt});assert.throws(()=>freeze(f.plan,c,[],{now:x.packet.frozenAt}),/DUPLICATE/);
});
test('C10.1 mutation, duplicate packet and mixed feed do not silently enter the same sample',()=>{
 let f=setup();f.packets[0].packet.opinions[0].verdict='clear';assert.throws(()=>run(f),/FINGERPRINT/);
 f=setup();f.packets[1]=f.packets[0];assert.throws(()=>run(f),/DUPLICATE/);
 f=setup();f.market.feed={...f.market.feed,provider:'other'};assert.throws(()=>run(f),/MARKET/);
});
test('C10.2 absent decision or abstention is not a clear label and reduces paired coverage',()=>{
 const f=setup(),day=f.input.folds.holdout[0];f.packets[f.days.indexOf(day)]=f.make(day,rows=>rows.filter(o=>!(o.policy==='conditional'&&o.signalId.endsWith(codes[0]))));
 const h=run(f).folds.holdout;assert.equal(h.knownOutcomes,4);assert.equal(h.pairedCount,3);assert.equal(h.perPolicy.conditional.all.abstainedOrMissing,1);assert.equal(h.perPolicy.conditional.all.fn,0);assert.equal(h.perPolicy.conditional.all.missRateIncludingAbstention,.5);
});
test('C10.2 missing entire frozen day stays a missing population denominator, never zero risk',()=>{
 const f=setup();f.packets.pop();const r=run(f);assert.deepEqual(r.missingDays,[f.days.at(-1)]);assert.equal(r.folds.holdout.expectedDays,2);assert.equal(r.folds.holdout.receivedDays,1);assert.equal(r.reviewCriteriaMet,false);
});
test('C10.2 missing, suspended and corporate-action labels stay unknown rather than false negative or normal divergence',()=>{
 for(const mode of ['missing','suspended','action']){const f=setup(),d=calendar[9],s=f.market.stocks[0];if(mode==='missing')s.bars=s.bars.filter(b=>b.date!==d);else if(mode==='suspended')s.bars.find(b=>b.date===d).suspended=true;else s.corporateActions.push(d);
 const r=run(f),h=r.folds.holdout;assert.equal(h.knownOutcomes,3);assert.equal(h.perPolicy.conditional.all.unknownOutcome,1);assert.equal(h.perPolicy.conditional.all.normalDivergenceFalseAlertRate,null);assert.equal(h.tail.incompleteDays,1);assert.equal(r.reviewCriteriaMet,false);}
});
test('C10.2 pending horizons remain unknown before actual target close',()=>{
 const f=setup();f.market.asOf=calendar[8];f.market.observedAt=at(calendar[8]);f.market.stocks.forEach(s=>s.bars=s.bars.filter(b=>b.date<=calendar[8]));
 const r=run(f);assert.equal(r.folds.holdout.knownOutcomes,0);assert.equal(r.folds.holdout.perPolicy.conditional.all.precision,null);assert.equal(r.reviewCriteriaMet,false);
});
test('C10.3 Brier is computed on identical declared event probabilities only',()=>{
 const h=run(setup()).folds.holdout;assert.equal(h.pairedProbabilityCount,4);assert.ok(Math.abs(h.perPolicy.conditional.pairedBrier-.04)<1e-10);assert.equal(h.perPolicy.original.pairedBrier,.25);
 const f=setup(),day=f.input.folds.holdout[0];f.packets[f.days.indexOf(day)]=f.make(day,rows=>rows.map(o=>o.policy==='conditional'?{...o,probability:null}:o));
 const g=run(f).folds.holdout;assert.equal(g.pairedProbabilityCount,2);assert.ok(policies.every(p=>g.perPolicy[p].pairedBrier===null));
});
test('C10.3 ranking scores, out-of-range probabilities, duplicate opinions and wrong model version cannot become probabilities',()=>{
 const f=setup();for(const patch of [{valueKind:'ranking-score'},{probability:1.1},{version:'later-v2'},{verdict:'abstain'}])assert.throws(()=>f.make(f.days[0],rows=>rows.map((o,i)=>i?o:{...o,...patch})),/OPINION/);
 assert.throws(()=>f.make(f.days[0],rows=>[...rows.slice(1),rows[1]]),/OPINION/);
});
test('C10.3 true zero event/alert denominator stays unknown, never perfect precision or recall',()=>{
 const f=setup();f.market.stocks.forEach(s=>s.bars.forEach(b=>{if(b.date===calendar[9]||b.date===calendar[11])b.close=105;}));
 const r=run(f),h=r.folds.holdout;assert.equal(h.perPolicy.fixed.all.precision,null);assert.equal(h.perPolicy.fixed.all.recallIncludingAbstention,null);assert.equal(r.reviewCriteriaMet,false);
});
test('C10.4 tail uses one worst security per complete day, then disjoint windows, not four independent trades',()=>{
 const r=run(setup()),tail=r.folds.holdout.tail;assert.equal(tail.observedDays,2);assert.equal(tail.nonOverlappingWindows,2);assert.equal(tail.tailWindows,1);assert.ok(Math.abs(tail.expectedShortfallPct-10)<1e-9);assert.equal(tail.maximumLossBound,null);assert.equal(tail.independenceCertified,false);
});
test('C10.4 small tail sample does not output an apparently precise VaR or ES',()=>{
 const x=setup(),f=setup({criteria:{...x.input.criteria,minTailWindows:2}}),r=run(f),tail=r.folds.holdout.tail;assert.equal(tail.status,'insufficient-tail-evidence');assert.equal(tail.varLossPct,null);assert.equal(tail.expectedShortfallPct,null);assert.equal(r.reviewCriteriaMet,false);
});
test('C10.4 overlapping horizon windows cannot create independent tail samples',()=>{
 const f=setup({horizon:5,folds:{training:[calendar[0]],validation:[calendar[6]],holdout:[calendar[12],calendar[13]]}}),r=run(f);assert.equal(r.folds.holdout.tail.observedDays,2);assert.equal(r.folds.holdout.tail.nonOverlappingWindows,1);assert.equal(r.folds.holdout.tail.expectedShortfallPct,null);
});
test('C10.5 preregistration must precede first signal, model training cutoff, immutable plan and same calendar',()=>{
 const f=setup();assert.throws(()=>register(f.input,{now:at(calendar[0])}),/REGISTRATION/);
 const bad={...f.input,policies:{...f.input.policies,conditional:{...f.input.policies.conditional,trainingEndedAt:registered+1}}};assert.throws(()=>register(bad,{now:registered}),/POLICY/);
 f.plan.criteria.maxMissRate=1;assert.throws(()=>run(f),/FINGERPRINT/);
 const g=setup();g.market.calendar=g.market.calendar.slice(1);assert.throws(()=>run(g),/MARKET/);
});
test('C10.5 windows overlapping next fold are purged without using their outcomes',()=>{
 const f=setup({horizon:1,folds:{training:[calendar[0]],validation:[calendar[1]],holdout:[calendar[2],calendar[4]]}}),r=run(f);
 assert.equal(r.folds.training.purgedCount,2);assert.equal(r.folds.validation.purgedCount,2);assert.equal(r.folds.training.knownOutcomes,0);assert.equal(r.reviewCriteriaMet,false);
});
test('C10.5 even passing descriptive criteria never promotes, trains, proves execution or claims actual avoided loss',()=>{
 const r=run(setup());assert.equal(r.reviewCriteriaMet,true);assert.equal(r.eligibleForPromotion,false);assert.equal(r.autoPromotion,false);assert.equal(r.canTrain,false);assert.equal(r.trainingLabelAvailabilityCertified,false);assert.equal(r.sourceLicenseCertified,false);assert.equal(r.executionAndCostEvidence,null);assert.equal(r.actualAvoidableLoss,null);assert.equal(r.netOpportunityCost,null);assert.equal(r.prAuc,null);assert.equal(r.maximumAdverseExcursion,null);assert.equal(r.normalDivergenceReview,null);
});
test('C10.1 policy opinions bind event, horizon, threshold and plan; source evidence references are retained',()=>{
 const f=setup();for(const patch of [{target:'future-rise'},{horizon:5},{lossPct:5},{planFingerprint:'f'.repeat(64)}])assert.throws(()=>f.make(f.days[0],rows=>rows.map((o,i)=>i?o:{...o,...patch})),/OPINION/);
 const r=run(f),row=r.rows.find(x=>x.event!==null);assert.equal(row.marketFingerprint,r.marketFingerprint);assert.equal(row.outcomeObservedAt,f.market.observedAt);assert.equal(row.cohortFingerprint,f.packets[0].cohort.fingerprint);assert.equal(row.packetFingerprint,f.packets[0].packet.fingerprint);
});
test('C10.1 cohort population and explicitly simulated sources cannot be silently substituted',()=>{
 const f=setup(),x=f.packets[0],other=freezeCohort({schemaVersion:1,feed:x.cohort.feed,signals:x.cohort.signals.map(s=>({...s,cohort:'other'}))},{now:x.cohort.frozenAt});
 assert.throws(()=>freeze(f.plan,other,[],{now:x.packet.frozenAt}),/LATE_OR_DUPLICATE/);
 const feed={...f.input.feed,source:'imported',provider:'provider',datasetId:'original-dataset'},p=register({...f.input,scope:'imported',feed},{now:registered});
 const c=freezeCohort({schemaVersion:1,feed,signals:x.cohort.signals},{now:x.cohort.frozenAt});assert.throws(()=>freeze(p,c,[],{now:x.packet.frozenAt}),/LATE_OR_DUPLICATE/);
 assert.throws(()=>register({...f.input,scope:'imported',feed:{...feed,simulated:true}},{now:registered}),/FEED/);
});
