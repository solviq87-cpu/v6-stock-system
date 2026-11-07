'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePythonEvidence}=require('../src/core/python-three-round-evidence');
const date='2025-03-04',symbol='000001';
const evidence={symbol,date,observedThrough:date,evaluatorVersion:'python-native/v1',provenance:'python-runtime:run-20250304',rounds:[1,2,3].map(round=>({round,verdict:'pass',observedThrough:date,reason:'fixture pass'}))};
test('three independently observed Python rounds are accepted with provenance',()=>{
 const r=evaluatePythonEvidence(evidence,{symbol,date});assert.equal(r.verdict,'pass');assert.equal(r.rounds.length,3);assert.equal(r.evidenceFingerprint.length,64);
});
test('missing Python evidence remains unknown, not pass',()=>assert.equal(evaluatePythonEvidence(undefined,{symbol,date}).verdict,'unknown'));
test('rejects future observations and mismatched symbols',()=>{
 assert.throws(()=>evaluatePythonEvidence({...evidence,observedThrough:'2025-03-05'},{symbol,date}),/日期/);
 assert.throws(()=>evaluatePythonEvidence({...evidence,symbol:'000002'},{symbol,date}),/股票/);
});
test('requires three ordered rounds and individual reasoning',()=>{
 assert.throws(()=>evaluatePythonEvidence({...evidence,rounds:evidence.rounds.slice(0,2)},{symbol,date}),/三轮/);
 assert.throws(()=>evaluatePythonEvidence({...evidence,rounds:[evidence.rounds[1],evidence.rounds[0],evidence.rounds[2]]},{symbol,date}),/三轮/);
 assert.throws(()=>evaluatePythonEvidence({...evidence,rounds:evidence.rounds.map((x,i)=>i===1?{...x,reason:''}:x)},{symbol,date}),/依据/);
});
test('unknown round cannot produce an eligible pass',()=>{
 const r=evaluatePythonEvidence({...evidence,rounds:evidence.rounds.map((x,i)=>i===2?{...x,verdict:'unknown'}:x)},{symbol,date});assert.equal(r.verdict,'unknown');
});
