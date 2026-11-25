'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectApprovedFactors,createApprovedFactorCache,TTL,SCHEMA}=require('../src/server/approved-factor-cache');
const signalDay='2026-11-20',targetDay='2026-11-23',at=(day,clock)=>Date.parse(day+'T'+clock+'+08:00'),now=at(targetDay,'10:00:00');
function report(codes=['600000','600001']){
  const modelFingerprint='a'.repeat(64),modelVersion=2,approvedAt=at(signalDay,'10:00:00');
  return {authority:'fayo-intelligence-research',day:signalDay,factors:{approvedScoring:{status:'ready',factorSchema:SCHEMA,
    day:signalDay,asOf:now,modelVersion,modelFingerprint,approvedAt,trainCutoff:at('2026-11-19','23:00:00'),
    trainingSignalStart:'2026-01-05',trainingSignalEnd:'2026-11-18',trainingLabelKnownAtMax:at('2026-11-19','21:00:00'),
    canTrade:false,changesOriginalGates:false,rows:codes.map((code,i)=>({code,day:signalDay,signalDay,targetDay,
      targetOpenAt:at(targetDay,'09:30:00'),calendarKnownAt:at('2026-01-01','00:00:00'),calendarSource:'原交易日历',
      observationAt:at(signalDay,'15:10:00'),scoredAt:now,score:(i+1)/100,threshold:0,passesResearchThreshold:true,
      modelVersion,modelFingerprint,sourceCheckId:'check-'+code,factorCount:8,eligibleForNextSession:true,missing:[],canTrade:false}))}}};
}
const project=input=>projectApprovedFactors(input,{signalDay,targetDay,now});
test('approved prior-session projection preserves original signal and model clocks without changing original selected scores',()=>{
  const p=project(report());assert.equal(p.status,'ready');assert.equal(p.rows.length,2);
  assert.equal(p.rows[0].day,signalDay);assert.equal(p.rows[0].targetDay,targetDay);assert.equal(p.rows[0].observationAt,at(signalDay,'15:10:00'));
  assert.equal(p.changesSelectionScore,false);assert.equal(p.canTrade,false);assert.equal(p.changesOriginalGates,false);
});
test('late approval, future scoring, mismatched next day and duplicate codes never manufacture comparable observations',()=>{
  const make=mutate=>{const x=report();mutate(x.factors.approvedScoring);return project(x);};
  assert.equal(make(x=>x.approvedAt=at(signalDay,'16:00:00')).rows.length,0);
  assert.equal(make(x=>x.asOf=now+1).rows.length,0);
  assert.equal(make(x=>x.rows.forEach(r=>r.targetDay='2026-11-24')).rows.length,0);
  assert.equal(make(x=>x.rows.forEach(r=>r.calendarKnownAt=at(targetDay,'09:00:00'))).rows.length,0);
  assert.equal(make(x=>x.rows.push({...x.rows[0]})).rows.length,1);
  assert.equal(make(x=>x.trainingLabelKnownAtMax=x.approvedAt).rows.length,0);
  assert.equal(make(x=>x.rows.forEach(r=>r.missing=['缺因子原定义'])).rows.length,0);
});
test('background cache uses the original previous trading day and homepage reads stay synchronous and memory-only',async()=>{
  let time=now,primary=true;const calls=[];
  const cache=createApprovedFactorCache({clock:()=>time,isPrimary:()=>primary,enabled:()=>true,
    session:()=>({day:'20261123',minute:new Date(time+28800000).getUTCHours()*60+new Date(time+28800000).getUTCMinutes()}),
    calendar:{isOpen:day=>[signalDay,targetDay].includes(day)},readResearch:async input=>{calls.push(input);return {ok:true,result:report()};}});
  assert.equal(cache.read({day:targetDay}).status,'waiting-background-evidence');assert.equal(calls.length,0);
  await cache.tick();assert.deepEqual(calls,[{day:signalDay,now}]);assert.equal(cache.read({day:targetDay}).rows.length,2);
  for(let i=0;i<50;i++)cache.read({day:targetDay});assert.equal(calls.length,1);
  await cache.tick();assert.equal(calls.length,1);
  assert.equal(cache.read({day:'2026-11-24'}).rows.length,0);
  time+=TTL+1;assert.equal(cache.read({day:targetDay}).rows.length,0);
  primary=false;await cache.tick();assert.equal(calls.length,1);
});
test('revocation while archive read is pending cannot populate a private scoring cache',async()=>{
  let primary=true,release;const wait=new Promise(resolve=>release=resolve);
  const cache=createApprovedFactorCache({clock:()=>now,isPrimary:()=>primary,enabled:()=>true,
    session:()=>({day:'20261123',minute:600}),calendar:{isOpen:day=>[signalDay,targetDay].includes(day)},
    readResearch:async()=>{await wait;return {ok:true,result:report()};}});
  const pending=cache.tick();primary=false;release();await pending;primary=true;
  assert.equal(cache.read({day:targetDay}).rows.length,0);
});
test('resonance wins first, then comparable approved scores; original selected scores remain unchanged',async()=>{
  const {rankDecisionCandidates}=await import('../src/core/decision-model.mjs');
  const rows=[{code:'600000',score:90,resonanceScore:1},{code:'600001',score:80,resonanceScore:1},{code:'600002',score:60,resonanceScore:2}];
  const ranked=rankDecisionCandidates(rows,project(report()),{day:targetDay,now});
  assert.deepEqual(ranked.map(r=>r.code),['600002','600001','600000']);assert.equal(ranked[2].score,90);
  assert.equal(ranked[1].factorRanking.rankingApplied,true);assert.equal(ranked[1].factorRanking.signalDay,signalDay);
});
test('an incomplete tie group retains a transitive original ranking and never treats unknown as zero',async()=>{
  const {rankDecisionCandidates}=await import('../src/core/decision-model.mjs');
  const rows=()=>[{code:'600000',score:90,resonanceScore:1},{code:'600001',score:80,resonanceScore:1},{code:'600002',score:85,resonanceScore:1}];
  const p=project(report()),ranked=rankDecisionCandidates(rows(),p,{day:targetDay,now});
  assert.deepEqual(ranked.map(r=>r.code),['600000','600002','600001']);assert.equal(ranked[0].factorRanking.rankingApplied,false);
  assert.equal(ranked[1].factorRanking,undefined);
  p.loadedAt=now-TTL-1;assert.deepEqual(rankDecisionCandidates(rows(),p,{day:targetDay,now}).map(r=>r.code),['600000','600002','600001']);
});
