'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateHistoricalBars}=require('../src/strategy/feed-quality');
const {walkForward}=require('../src/strategy/walk-forward-backtest');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
function bars(n=45){return Array.from({length:n},(_,i)=>{const c=10+i*.05;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:c,high:c+.1,low:c-.1,close:c,volume:100000};});}
test('historical quality validator rejects invalid OHLCV and date ordering',()=>{
 const b=bars();b[5].high=1;assert.equal(validateHistoricalBars(b).usable,false);
 const d=bars();d[4].date=d[3].date;assert.equal(validateHistoricalBars(d).usable,false);
 const v=bars();v[3].volume=1.25;assert.equal(validateHistoricalBars(v).usable,false);
});
test('walk-forward backtest blocks malformed bars in the evaluated window',()=>{
 const b=bars();b[30].low=999;
 assert.throws(()=>walkForward({stocks:[{symbol:'000001',market:'main',bars:b}],start:27,end:35}),/行情质量门禁拒绝/);
});
test('ledger backtest blocks malformed bars in the evaluated window',()=>{
 const b=bars();b[30].volume=-1;
 assert.throws(()=>ledgerBacktest({stocks:[{symbol:'000001',market:'main',bars:b}],start:27,end:35}),/行情质量门禁拒绝/);
});
test('data beyond the requested backtest end cannot affect quality gate',()=>{
 const b=bars();b[44].close=99999;
 assert.doesNotThrow(()=>ledgerBacktest({stocks:[{symbol:'000001',market:'main',bars:b}],start:27,end:35,selectCandidates:()=>[]}));
});
