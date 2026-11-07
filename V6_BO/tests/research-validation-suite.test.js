'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateResearchSuite}=require('../src/core/research-validation-suite');
const make=(n=110)=>({source:'simulated',asOf:'2026-11-05',stocks:['600001','000001'].map((symbol,j)=>({symbol,bars:Array.from({length:n},(_,i)=>{const close=10+j+i*.02;return {date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:close,high:close*1.01,low:close*.99,close,volume:100000};})}))});
test('多窗口样本外回测输出可复现，交易门禁关闭',()=>{const d=make();const a=evaluateResearchSuite(d,{windows:3,testDays:15});const b=evaluateResearchSuite(d,{windows:3,testDays:15});assert.deepEqual(a,b);assert.equal(a.folds.length,3);assert.equal(a.canTrade,false);assert.equal(a.folds[0].trainingEndIndex+1,a.folds[0].testStartIndex-1);assert.equal(a.dataset.sha256.length,64);});
test('历史数据不足拒绝滚动窗口',()=>assert.throws(()=>evaluateResearchSuite(make(40),{windows:3,testDays:20}),/样本不足/));
test('禁止未对账公司行为与复权成交价',()=>{const d=make();d.stocks[0].bars[10].corporateAction='split';assert.throws(()=>evaluateResearchSuite(d),/公司行为/);delete d.stocks[0].bars[10].corporateAction;d.stocks[0].bars[10].priceBasis='adjusted';assert.throws(()=>evaluateResearchSuite(d),/未复权/);});
test('缺失或错误来源与 OHLCV 必须拒绝',()=>{const d=make();delete d.asOf;assert.throws(()=>evaluateResearchSuite(d),/来源/);d.asOf='2026-11-05';d.stocks[0].bars[5].volume=-1;assert.throws(()=>evaluateResearchSuite(d),/OHLCV/);});
test('禁止无效滚动配置',()=>assert.throws(()=>evaluateResearchSuite(make(),{gapDays:0}),/配置无效/));
