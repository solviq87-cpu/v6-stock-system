'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {buildPaperIntentPlan}=require('../src/core/strategy-paper-intent-plan');
const fp='a'.repeat(64);
function fixture(){return {mode:'audited-strategy-evidence-replay',datasetFingerprint:fp,windows:{inSample:{records:[
{system:'fourteen',symbol:'000001',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02',entryPrice:10}},
{system:'bazi',symbol:'000001',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02',entryPrice:10}},
{system:'python',symbol:'000002',signalDate:'2026-01-01',verdict:'unknown',outcome:{entryDate:'2026-01-02',entryPrice:5}},
{system:'gpt',symbol:'000003',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02'}}]},outOfSample:{records:[]},unassigned:{records:[]}}};}
test('builds proposal-only intent and never executes',()=>{const r=buildPaperIntentPlan(fixture(),{capital:100000,maxPositionPct:10});assert.equal(r.intentCount,1);assert.equal(r.intents[0].quantity,1000);assert.equal(r.executed,false);assert.equal(r.canTrade,false);});
test('deduplicates overlapping strategy signals per symbol and session',()=>{const r=buildPaperIntentPlan(fixture(),{capital:100000,maxPositionPct:10});assert.equal(r.rejected.some(x=>x.reason==='单股单日策略重叠上限'),true);});
test('rejects unknown evidence and missing reference price',()=>{const r=buildPaperIntentPlan(fixture(),{capital:100000,maxPositionPct:10});assert.ok(r.rejected.some(x=>x.reason==='策略证据未知'));assert.ok(r.rejected.some(x=>x.reason.includes('参考价')));});
test('validates capital and risk limits',()=>{assert.throws(()=>buildPaperIntentPlan(fixture(),{capital:0,maxPositionPct:10}),/参数无效/);assert.throws(()=>buildPaperIntentPlan(fixture(),{capital:10000,maxPositionPct:101}),/参数无效/);});
test('rejects invalid dataset fingerprint',()=>{const x=fixture();x.datasetFingerprint='bad';assert.throws(()=>buildPaperIntentPlan(x,{capital:10000,maxPositionPct:10}),/数据指纹/);});
