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
test('same day same universe paired comparison requires new net and stress improvement, not training success',()=>{assert.equal(prospectiveComparison(paired).reviewSupported,true);assert.equal(prospectiveComparison(paired.slice(0,25)).reviewSupported,false);assert.equal(prospectiveComparison(paired.map(r=>({...r,candidateScore:r.currentScore}))).reviewSupported,false);assert.equal(prospectiveComparison(paired.map(r=>({...r,stressedReturnPct:-30}))).reviewSupported,false);});
test('duplicate symbols cannot inflate paired support',()=>{assert.throws(()=>prospectiveComparison([...paired,paired[0]]),/重复/);});
test('empty and demo archives cannot certify model improvement or decay',()=>{const r=buildGovernance({archive:null});assert.equal(r.canTrade,false);assert.equal(r.canApprove,false);assert.equal(r.probability.calibrationCertified,false);assert.equal(r.decay.verifiedDecay,false);assert.equal(modelComparison({scope:'demo'}).reviewSupported,false);});
