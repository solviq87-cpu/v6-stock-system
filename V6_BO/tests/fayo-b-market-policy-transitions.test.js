'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {describeResearchPolicy}=require('../src/core/market-research-policy');
const {replayResearchPolicyTransitions}=require('../src/core/market-policy-transitions');
const day='2026-11-05',start=Date.parse(day+'T10:00:00+08:00');
function event(seconds,{env='rise',risk='clear',stamp=start+seconds*1000,arrival=stamp+3000,decisionAt=stamp+2000,quoteAt=stamp-1000}={}){
 const date=new Date(stamp+8*3600000).toISOString().slice(0,10);
 const evidence={status:'declared-unverified'};
 const long=env==='rise'||env==='pullback'?'up':env==='mixed'?'mixed':'down';
 const majority=env==='pullback'||env==='decline'||env==='narrow'?'majority-down':'majority-up';
 const rel=env==='narrow'?'index-up-majority-down':majority==='majority-down'?'index-down-majority-down':'index-up-majority-up';
 const axes={historicalAtDecision:false,trend:{...evidence,long,medium:long},structure:{...evidence,majority,indexRelation:rel},sentiment:evidence};
 const timing={status:'declared-aligned',marketAsOf:stamp,decisionAt};
 const p=describeResearchPolicy({date,source:'fixture-market',stocks:[{vendorQuoteAt:quoteAt}]},timing,axes,env==='risk-off'?'risk_off':'neutral','fixture-score');
 return {recordedAt:arrival,policy:p,risk:{aStatus:risk==='a-veto'?'blocked':'pass',cStatus:risk==='c-veto'?'blocked':risk==='unknown'?'unknown':'pass',policyId:p.policyId,knownAt:decisionAt,aEvidenceId:'a-'+seconds,cEvidenceId:'c-'+seconds}};
}
const run=(events,asOf=events.at(-1)?.recordedAt??start)=>replayResearchPolicyTransitions(events,{asOf});
const noAuthority=x=>{for(const k of ['canTrade','canNotify','canOpenRisk','autoPromotion','weightsChanged','certified'])assert.equal(x[k],false,k);};
const stable=()=>[event(0),event(15)];
const recovery=()=>[...stable(),event(20,{risk:'c-veto'}),event(30),event(60),event(90)];
const status=x=>x.history.map(r=>r.status);
test('ordinary initial confirmation needs two independently timed observations',()=>{
 const one=run([event(0)]);assert.equal(one.current.status,'confirming');assert.deepEqual(one.current.eligibleResearchFamilies,[]);
 const r=run(stable());assert.equal(r.current.status,'research-only');assert.equal(r.current.reason,'switch-confirmed');assert.equal(r.current.confirmedEnvironment,'rising-participation');assert.deepEqual(r.current.eligibleResearchFamilies,['trend-breakout','pullback-repair']);noAuthority(r.current);
});
test('nearby ticks cannot inflate confirmation count before minimum observation gap',()=>{
 const r=run([event(0),event(5),event(14)]);assert.equal(r.current.confirmationCount,1);assert.equal(r.current.status,'confirming');
 assert.equal(run([event(0),event(5),event(15)]).current.status,'research-only');
});
test('same market cutoff with a new arrival or policy id does not increment confirmation',()=>{
 const a=event(0),b=event(1,{stamp:start,arrival:start+20000,decisionAt:start+4000});assert.notEqual(a.policy.policyId,b.policy.policyId);
 const r=run([a,b]);assert.equal(r.current.confirmationCount,1);assert.equal(r.current.status,'confirming');
});
test('switch requires consecutive evidence and dwell; no old family during pending',()=>{
 const r=run([...stable(),event(30,{env:'pullback'}),event(45,{env:'pullback'}),event(75,{env:'pullback'})]);
 assert.deepEqual(status(r),['confirming','research-only','confirming','confirming','research-only']);
 for(const rec of r.history.slice(2,4))assert.deepEqual(rec.eligibleResearchFamilies,[]);
 assert.equal(r.current.confirmedEnvironment,'rising-pullback');
});
test('alternating environments reset confirmation instead of oscillating active policies',()=>{
 const r=run([...stable(),event(30,{env:'pullback'}),event(45,{env:'mixed'}),event(60,{env:'pullback'}),event(75,{env:'mixed'})]);
 assert.equal(r.current.confirmedEnvironment,'rising-participation');assert.equal(r.current.confirmationCount,1);assert.deepEqual(r.current.eligibleResearchFamilies,[]);
});
test('return to prior confirmed environment cancels pending switch without a new alert',()=>{
 const r=run([...stable(),event(30,{env:'mixed'}),event(45)]);assert.equal(r.current.reason,'confirmed-policy-unchanged');assert.equal(r.history.at(-1).reviewHint,'none');
});
test('A and C hard vetoes immediately interrupt a confirmed environment',()=>{
 for(const risk of ['a-veto','c-veto']){const r=run([...stable(),event(20,{risk})]);assert.equal(r.current.status,'risk-blocked');assert.equal(r.current.reason,'upstream-veto-declared');assert.deepEqual(r.current.eligibleResearchFamilies,[]);assert.equal(r.history.at(-1).reviewHint,'risk-review');assert.equal(r.current.riskLatched,true);noAuthority(r.current);}
});
test('legacy risk-off and downtrend decline policy independently block opportunity families',()=>{
 for(const env of ['risk-off','decline']){const r=run([...stable(),event(20,{env})]);assert.equal(r.current.status,'risk-blocked');assert.equal(r.current.reason,'market-risk-review');assert.deepEqual(r.current.eligibleResearchFamilies,[]);}
});
test('unknown A/C gates never authorize an opportunity',()=>{
 const r=run([...stable(),event(20,{risk:'unknown'})]);assert.equal(r.current.status,'data-blocked');assert.equal(r.current.reason,'upstream-gates-unconfirmed');assert.equal(r.current.riskLatched,true);
});
test('missing and mismatched gate receipts cannot clear risk latch',()=>{
 for(const change of [{cEvidenceId:''},{policyId:'wrong'},{knownAt:start-1},{knownAt:start+999999},{simulated:true}]){const e=event(30);Object.assign(e.risk,change);const r=run([...stable(),event(20,{risk:'c-veto'}),e]);assert.equal(r.current.status,'data-blocked');assert.equal(r.current.riskLatched,true);}
});
test('recovery requires three independent observations and at least 60 seconds of market span',()=>{
 const before=run([...stable(),event(20,{risk:'c-veto'}),event(30),event(45),event(60)]);assert.equal(before.current.status,'recovering');assert.equal(before.current.confirmationCount,3);assert.deepEqual(before.current.eligibleResearchFamilies,[]);
 const r=run(recovery());assert.equal(r.current.status,'research-only');assert.equal(r.current.reason,'recovery-confirmed');assert.equal(r.current.riskLatched,false);
});
test('recovery counts reset on a new veto, missing evidence, or different environment',()=>{
 for(const change of [{risk:'a-veto'},{risk:'unknown'},{env:'mixed'}]){const r=run([...stable(),event(20,{risk:'c-veto'}),event(30),event(60),event(75,change),event(90)]);assert.notEqual(r.current.status,'research-only');assert.equal(r.current.riskLatched,true);}
});
test('a duplicate cutoff after veto cannot count as a recovery observation',()=>{
 const r=run([...stable(),event(20,{risk:'c-veto'}),event(25,{stamp:start+20000,decisionAt:start+23000,arrival:start+28000})]);assert.equal(r.current.status,'recovering');assert.equal(r.current.confirmationCount,0);
});
test('gap past the last valid policy expiry requires new recovery observations',()=>{
 const r=run([...stable(),event(110)]);assert.equal(r.current.status,'recovering');assert.equal(r.current.confirmationCount,1);assert.equal(r.current.riskLatched,true);
});
test('lunch and cross-day gaps never resurrect the morning confirmed policy',()=>{
 for(const stamp of [Date.parse(day+'T13:01:00+08:00'),Date.parse('2026-11-06T10:00:00+08:00')]){
  const r=run([...stable(),event(999,{stamp})]);assert.equal(r.current.status,'recovering');assert.equal(r.current.confirmationCount,1);assert.deepEqual(r.current.eligibleResearchFamilies,[]);
 }
});
test('expiry boundary blocks current without modifying or appending accepted records',()=>{
 const events=stable(),first=run(events),later=run(events,events.at(-1).policy.expiresAt);assert.deepEqual(later.history,first.history);assert.equal(later.current.reason,'policy-expired-at-evaluation');assert.deepEqual(later.current.eligibleResearchFamilies,[]);assert.equal(later.current.riskLatched,true);
});
test('policy cannot extend freshness by changing expiry for the same cutoff',()=>{
 const events=stable(),e=event(16,{stamp:start+15000,arrival:start+35000,decisionAt:start+18000,quoteAt:start+15000});
 const r=run([...events,e]);assert.equal(r.current.expiresAt,events.at(-1).policy.expiresAt);
});
test('late arrival and future arrival cannot overwrite or alter prior snapshots',()=>{
 const events=stable(),initial=run(events);const r=run([...events,event(5,{env:'mixed'}),event(90)],events.at(-1).recordedAt);
 assert.deepEqual(r.history,initial.history);assert.deepEqual(r.current,initial.current);assert.deepEqual(r.rejected.map(x=>x.reason),['late-arrival','future-arrival']);
});
test('late older market observation with a later receive clock stays outside accepted history',()=>{
 const events=stable(),late=event(1,{arrival:start+30000,env:'mixed'});const r=run([...events,late]);assert.equal(r.history.length,2);assert.equal(r.rejected[0].reason,'late-market-observation');assert.equal(r.current.confirmedEnvironment,'rising-participation');
});
test('risk veto arriving on an old market observation still blocks conservatively',()=>{
 const r=run([...stable(),event(1,{arrival:start+30000,risk:'c-veto'})]);assert.equal(r.current.status,'risk-blocked');assert.equal(r.history.length,3);
});
test('same cutoff with different environment fails closed',()=>{
 const r=run([...stable(),event(20,{stamp:start+15000,decisionAt:start+20000,arrival:start+23000,env:'mixed'})]);assert.equal(r.current.status,'data-blocked');assert.equal(r.current.reason,'same-cutoff-policy-conflict');
});
test('identical arrival is idempotent; conflicting arrival fails closed without rewriting history',()=>{
 const events=stable(),original=run(events);const duplicate=run([...events,events.at(-1)]);assert.deepEqual(duplicate.history,original.history);assert.equal(duplicate.rejected[0].reason,'duplicate-arrival');
 const conflict=run([...events,{...events.at(-1),risk:{...events.at(-1).risk,cStatus:'blocked'}}]);assert.deepEqual(conflict.history,original.history);assert.equal(conflict.rejected[0].reason,'conflicting-arrival');assert.equal(conflict.current.reason,'replay-input-integrity-conflict');
});
test('semantic duplicate reviews stay suppressed despite changing policy IDs',()=>{
 const r=run([...stable(),event(45),event(75),event(105),event(135),event(165)]);
 assert.equal(r.history.filter(x=>x.reviewHint==='policy-review').length,1);assert.equal(new Set(r.history.map(x=>x.policyId)).size,7);
});
test('normal change respects cooldown and becomes reviewable once it persists',()=>{
 const r=run([...stable(),event(30,{env:'pullback'}),event(75,{env:'pullback'}),event(105,{env:'pullback'}),event(135,{env:'pullback'}),event(150,{env:'pullback'})]);
 assert.equal(r.history[3].reason,'switch-confirmed');assert.equal(r.history[3].reviewHint,'none');assert.equal(r.history[5].reviewHint,'policy-review');assert.equal(r.history[6].reviewHint,'none');
});
test('urgent escalation bypasses cooldown; repeated identical veto does not create new review hints',()=>{
 const r=run([...stable(),event(20,{risk:'unknown'}),event(25,{risk:'c-veto'}),event(30,{risk:'c-veto'})]);
 assert.deepEqual(r.history.slice(2).map(x=>x.reviewHint),['data-review','risk-review','none']);
});
test('history is deterministic and chained with explicit policy differences; no mutation of inputs',()=>{
 const events=[...stable(),event(30,{env:'pullback'}),event(75,{env:'pullback'})],before=JSON.stringify(events),r=run(events);
 assert.equal(JSON.stringify(events),before);assert.deepEqual(r,run(events));
 r.history.forEach((entry,i)=>{const {recordHash,...body}=entry;assert.equal(recordHash,createHash('sha256').update(JSON.stringify(body)).digest('hex'));assert.equal(entry.previousHash,i?r.history[i-1].recordHash:null);noAuthority(entry);});
 assert.deepEqual(r.history[2].change.removedFamilies,['trend-breakout','pullback-repair']);assert.deepEqual(r.history[3].change.addedFamilies,['pullback-repair','defensive']);
});
test('malformed matrix, time, or authority claims cannot be used as clear policy',()=>{
 for(const change of [{eligibleResearchFamilies:['other']},{canTrade:true},{canNotify:true},{version:'other'},{expiresAt:start+120001},{tradeDate:'2026-11-04'},{decisionAt:start+999999}]){const e=event(30);Object.assign(e.policy,change);const r=run([...stable(),e]);assert.equal(r.current.status,'data-blocked');noAuthority(r.current);}
});
test('invalid clock, unbounded sequence or no observations never produce eligible families',()=>{
 for(const r of [run([]),run(stable(),null),run(Array(2049).fill(event(0)),start+3000),run([{recordedAt:null}],start+3000)]){assert.equal(r.current.status,'data-blocked');assert.deepEqual(r.current.eligibleResearchFamilies,[]);noAuthority(r.current);}
});
test('an expired late morning observation cannot overwrite an accepted afternoon observation',()=>{
 const late=event(1,{arrival:Date.parse(day+'T13:01:05+08:00')});
 const afternoon=event(999,{stamp:Date.parse(day+'T13:01:00+08:00')});
 const r=run([...stable(),afternoon,late]);assert.equal(r.rejected.at(-1).reason,'late-market-observation');assert.equal(r.history.length,3);
 assert.equal(r.current.policyId,afternoon.policy.policyId);assert.equal(r.current.status,'recovering');
});
test('risk receipt must be known no earlier than the exact policy decision it identifies',()=>{
 const e=event(30);e.risk.knownAt=e.policy.decisionAt-1;
 const r=run([...stable(),event(20,{risk:'c-veto'}),e]);assert.equal(r.current.status,'data-blocked');assert.equal(r.current.riskLatched,true);
});
test('audit snapshots retain separate A/C declarations and observed families even while blocked',()=>{
 const r=run([...stable(),event(30,{risk:'a-veto'})]);const rec=r.history.at(-1);
 assert.equal(rec.gateEvidence.aStatus,'blocked');assert.equal(rec.gateEvidence.cStatus,'pass');assert.equal(rec.gateEvidence.aEvidenceId,'a-30');assert.equal(rec.gateEvidence.certified,false);
 assert.deepEqual(rec.observedResearchFamilies,['trend-breakout','pullback-repair']);assert.deepEqual(rec.eligibleResearchFamilies,[]);
});
