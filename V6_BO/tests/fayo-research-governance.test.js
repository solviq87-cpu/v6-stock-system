'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pairedFactorDiagnostics,prospectiveComparison,buildGovernance,modelComparison}=require('../src/core/fayo-research-governance');
// Synthetic unit tests only; never formal research data.
const days=Array.from({length:42},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
const samples=days.flatMap((day,i)=>Array.from({length:5},(_,j)=>({market:'CN',code:String(j),day,targetDay:days[i+1]||'2026-03-01',labelKnownAt:Date.parse((days[i+1]||'2026-03-01')+'T15:10:00+08:00'),values:{F:i<20?j:j+10},returnPct:i<20?j:-j,definitionFingerprints:{F:'same'}})));
const folds={folds:[{status:'evaluated',ranges:{test:{start:days[0],end:days[19]}}},{status:'evaluated',ranges:{test:{start:days[21],end:days[40]}}}]};
const paired=days.slice(0,20).flatMap(day=>Array.from({length:5},(_,i)=>({day,code:String(i),currentScore:-i,candidateScore:i,netReturnPct:i,stressedReturnPct:i-.2})));
test('matched nonoverlapping windows distinguish distribution shift and IC change',()=>{const r=pairedFactorDiagnostics(samples,folds);assert.equal(r.factors[0].performanceWarning,true);assert.equal(r.factors[0].distributionWarning,true);assert.equal(r.verifiedDecay,false);});
test('definition changes or overlapping-only folds do not establish deterioration',()=>{const changed=samples.map(r=>r.day>=days[21]?{...r,definitionFingerprints:{F:'changed'}}:r);assert.equal(pairedFactorDiagnostics(changed,folds).factors[0].status,'definition-changed-or-unknown');assert.equal(pairedFactorDiagnostics(samples,{folds:[folds.folds[1]]}).factors.length,0);});
test('same day same universe paired comparison requires new net and stress improvement, not training success',()=>{assert.equal(prospectiveComparison(paired).descriptiveGain,true);assert.equal(prospectiveComparison(paired).reviewSupported,false);assert.equal(prospectiveComparison(paired).approvalEligible,false);assert.equal(prospectiveComparison(paired.slice(0,25)).reviewSupported,false);assert.equal(prospectiveComparison(paired.map(r=>({...r,candidateScore:r.currentScore}))).reviewSupported,false);assert.equal(prospectiveComparison(paired.map(r=>({...r,stressedReturnPct:-30}))).reviewSupported,false);});
test('duplicate symbols cannot inflate paired support',()=>{assert.throws(()=>prospectiveComparison([...paired,paired[0]]),/重复/);});
test('empty and demo archives cannot certify model improvement or decay',()=>{const r=buildGovernance({archive:null});assert.equal(r.canTrade,false);assert.equal(r.canApprove,false);assert.equal(r.probability.calibrationCertified,false);assert.equal(r.decay.verifiedDecay,false);assert.equal(modelComparison({scope:'demo'}).reviewSupported,false);});

test('matched diagnostics reject duplicate stock-days and missing markets cannot change the comparable cross-section',()=>{
 assert.equal(pairedFactorDiagnostics([...samples,samples[0]],folds).status,'duplicate-or-invalid-symbol-day');
 const missing=samples.filter(r=>!(r.day>=days[21]&&r.code==='0'&&Number(r.day.slice(-2))%2===0));
 const result=pairedFactorDiagnostics(missing,folds);
 assert.ok(result.matchedDayCoverage.recent<.8);
 assert.equal(result.factors[0].performanceWarning,false);
 assert.equal(result.factors[0].distributionWarning,false);
 const late=samples.map(r=>({...r,labelKnownAt:Date.parse('2027-01-01T16:00:00+08:00')}));
 assert.equal(pairedFactorDiagnostics(late,folds,{now:Date.parse('2026-03-01T16:00:00+08:00')}).matchedSymbols,0);
});
test('paired comparison rejects malformed collections and policies without treating them as model evidence',()=>{
 assert.throws(()=>prospectiveComparison(null),/无效/);
 assert.throws(()=>prospectiveComparison(paired,{topK:0}),/无效/);
 assert.throws(()=>prospectiveComparison(paired.map(r=>({...r,day:'2026-02-30'}))),/无效/);
});

test('small prospective days stay in the paired comparison rather than being discarded after outcomes are known',()=>{
 const sparse=[...paired,{...paired[0],day:'2026-03-01',netReturnPct:-4,stressedReturnPct:-5}];
 const result=prospectiveComparison(sparse);assert.equal(result.days,21);assert.equal(result.daily.at(-1).selectedEach,1);
 assert.equal(result.daily.at(-1).candidate,result.daily.at(-1).previous);
});
