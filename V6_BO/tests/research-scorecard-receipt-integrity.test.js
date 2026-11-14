'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../src/core/research-workspace-decision'),A=require('../src/core/research-workspace-analytics'),S=require('../src/core/research-workspace-store');
const {fixture,native,event,at,dates}=require('./helpers/research-workspace-fixtures');
const build=index=>D.buildWorkspaceDecision(fixture({index}),native(index));
const observation=(result,id,horizon=1)=>result.observations.find(o=>o.runId===id&&o.system==='python'&&o.horizon===horizon);
function rolling(){
 const signal=event(build(70)),outcome=event(build(100),2),newer=build(140);newer.bars=newer.bars.slice(-40);
 return {signal,outcome,latest:event(newer,3)};
}
test('later receipt with an earlier same-day analysis time cannot replace the first frozen signal',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-scorecard-receipts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'workspace');
 const first=build(70),firstEvent=S.appendEvent(root,'analysis',first,{requestId:'receipt_first_signal',now:at(70,'17:00')});
 const input=fixture();input.asOf=at(70,'16:00');input.stock.observedAt=at(70,'15:30');input.stock.bars.at(-1).knownAt=at(70,'15:15');input.evidenceBundle.decisionAt=input.asOf;input.evidenceBundle.recordedAt=input.asOf;input.evidenceBundle.sourceRefs[0].receivedAt=at(70,'15:30');input.observation.observationHash=S.digest(input.stock.bars);input.evidenceBundle.observationHash=input.observation.observationHash;
 const evidence=native();evidence.pythonEvidence.knownAt=at(70,'15:45');evidence.gptEvidence.knownAt=at(70,'15:45');evidence.pythonEvidence.rounds.forEach(r=>r.verdict='fail');
 const revised=D.buildWorkspaceDecision(input,evidence);assert.equal(revised.tradeDate,first.tradeDate);assert.equal(revised.systems.find(s=>s.id==='python').verdict,'fail');
 S.appendEvent(root,'analysis',revised,{requestId:'receipt_later_revision',now:at(70,'18:00')});S.appendEvent(root,'analysis',build(140),{requestId:'receipt_later_outcome',now:at(140)});
 const result=A.scorecards(S.readEvents(root),{asOf:at(140)}),row=observation(result,firstEvent.hash);assert.equal(row?.status,'paper-estimate');assert.equal(result.groups.find(g=>g.system==='python'&&g.horizon===1).rejected,0);
});
test('equal receipt timestamps use server sequence for the first signal, regardless of supplied array order',()=>{
 const first=event(build(70),1),revised=structuredClone(first);revised.sequence=2;revised.hash='revision';revised.data.systems.find(s=>s.id==='python').verdict='fail';
 const r=A.scorecards([revised,event(build(140),3),first],{asOf:at(140)});assert.equal(observation(r,first.hash).status,'paper-estimate');assert.equal(r.groups.find(g=>g.system==='python'&&g.horizon===1).rejected,0);
});
test('rolling snapshots retain already archived outcome bars and disclose each selected source',()=>{
 const {signal,outcome,latest}=rolling(),before=observation(A.scorecards([signal,outcome],{asOf:at(100)}),signal.hash),after=observation(A.scorecards([signal,outcome,latest],{asOf:at(140)}),signal.hash);
 assert.equal(before.status,'paper-estimate');assert.equal(after.status,'paper-estimate');assert.equal(after.netReturnPct,before.netReturnPct);assert.equal(after.priceReturnPct,before.priceReturnPct);
 assert.equal(after.entryOutcomeRunId,outcome.hash);assert.equal(after.exitOutcomeRunId,outcome.hash);assert.equal(after.entryOutcomeRecordedAt,outcome.recordedAt);assert.equal(after.outcomePolicy,'latest-available-snapshot-containing-date');
});
test('same-date corrections keep the existing latest-analysis policy and cannot be erased by a later rolling window',()=>{
 const {signal,outcome,latest}=rolling(),correction=build(110);correction.bars.find(b=>b.date===dates[72]).open+=.02;const revised=event(correction,3),newest={...latest,sequence:4};
 const row=observation(A.scorecards([signal,outcome,revised,newest],{asOf:at(140)}),signal.hash);assert.equal(row.status,'paper-estimate');assert.equal(row.exitOutcomeRunId,revised.hash);assert.ok(Math.abs(row.priceReturnPct-100*(correction.bars[72].open/correction.bars[71].open-1))<.0001);
});
for(const defect of ['receipt-after-view','analysis-after-view'])test('future outcome is excluded: '+defect,()=>{
 const signal=event(build(70)),later=event(build(100),2);if(defect==='receipt-after-view')later.recordedAt=at(101);else later.data.asOf=at(101);
 const row=observation(A.scorecards([signal,later],{asOf:at(100)}),signal.hash);assert.equal(row.status,'missing');assert.equal(row.netReturnPct,null);
});
for(const identity of ['other-symbol','other-provider','adjusted','missing-basis','usd','null-currency','unknown-schema'])test('outcome cannot cross identity: '+identity,()=>{
 const signal=event(build(70)),other=event(build(140),2);if(identity==='other-symbol')other.data.symbol='600001';if(identity==='other-provider')other.data.provider='eastmoney';if(identity==='adjusted')other.data.priceBasis='adjusted';if(identity==='missing-basis')delete other.data.priceBasis;if(identity==='usd')other.data.currency='USD';if(identity==='null-currency')other.data.currency=null;if(identity==='unknown-schema')other.data.schemaVersion=99;
 const row=observation(A.scorecards([signal,other],{asOf:at(140)}),signal.hash);assert.equal(row.status,'missing');assert.equal(row.netReturnPct,null);
});
test('explicit CNY and recognized version-one implicit CNY remain compatible',()=>{
 for(const explicit of [false,true]){const {signal,outcome,latest}=rolling();if(explicit){signal.data.currency='CNY';outcome.data.currency='CNY';latest.data.currency='CNY';}assert.equal(observation(A.scorecards([signal,outcome,latest],{asOf:at(140)}),signal.hash).status,'paper-estimate');}
});
for(const defect of ['future-known-at','missing-known-at','bad-ohlc','zero-volume','late-status','unknown-corporate-action','unknown-limit'])test('newer adverse evidence never falls back to an older favorable bar: '+defect,()=>{
 const {signal,outcome,latest}=rolling(),revised=build(110),bar=revised.bars[71];
 if(defect==='future-known-at')bar.knownAt=at(141);if(defect==='missing-known-at')delete bar.knownAt;if(defect==='bad-ohlc')bar.high=bar.low-.01;if(defect==='zero-volume')bar.volume=0;if(defect==='late-status')bar.statusKnownAt=at(71);if(defect==='unknown-corporate-action')delete bar.corporateAction;if(defect==='unknown-limit')delete bar.limitKnownAt;
 const row=observation(A.scorecards([signal,outcome,event(revised,3),{...latest,sequence:4}],{asOf:at(140)}),signal.hash);assert.equal(row.netReturnPct,null);assert.notEqual(row.status,'paper-estimate');
});
test('every date of a holding window still needs timely corporate-action evidence after merging snapshots',()=>{
 const {signal,outcome,latest}=rolling(),revised=build(110);revised.bars[73].corporateAction=true;
 const row=observation(A.scorecards([signal,outcome,event(revised,3),{...latest,sequence:4}],{asOf:at(140)}),signal.hash,5);assert.equal(row.netReturnPct,null);assert.equal(row.status,'unverified-execution');
});
for(const defect of ['missing-flags','missing-observation-hash'])test('implicit CNY requires a recognized legacy decision: '+defect,()=>{
 const signal=event(build(70)),other=event(build(140),2);if(defect==='missing-flags')delete other.data.researchOnly;else delete other.data.observationHash;
 const row=observation(A.scorecards([signal,other],{asOf:at(140)}),signal.hash);assert.equal(row.status,'missing');assert.equal(row.netReturnPct,null);
});
test('same analysis and receipt time corrections use server sequence deterministically',()=>{
 const {signal,outcome,latest}=rolling(),correction=structuredClone(outcome);correction.sequence=3;correction.hash='same_time_correction';correction.data.bars[72].open+=.02;
 const result=A.scorecards([{...latest,sequence:4},correction,signal,outcome],{asOf:at(140)}),row=observation(result,signal.hash);assert.equal(row.status,'paper-estimate');assert.equal(row.exitOutcomeRunId,correction.hash);
});
test('a later receipt of an older snapshot does not undo a newer analysis-time correction',()=>{
 const {signal,outcome,latest}=rolling(),correction=build(110);correction.bars[72].open+=.02;const revised=event(correction,3),lateOld=structuredClone(outcome);lateOld.sequence=4;lateOld.recordedAt=at(120);lateOld.hash='late_old_snapshot';
 const row=observation(A.scorecards([signal,outcome,revised,lateOld,{...latest,sequence:5}],{asOf:at(140)}),signal.hash);assert.equal(row.status,'paper-estimate');assert.equal(row.exitOutcomeRunId,revised.hash);
});
