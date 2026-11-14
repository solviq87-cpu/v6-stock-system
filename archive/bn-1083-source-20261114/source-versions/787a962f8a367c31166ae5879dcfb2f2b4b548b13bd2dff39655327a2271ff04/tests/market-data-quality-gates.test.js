'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateDataset}=require('../src/core/historical-validation');
const {createMarketDataCenter}=require('../src/core/market-data-center');
const {Readable}=require('node:stream');
function history(){return {source:'imported',provider:'test',datasetId:'data-001',asOf:'2026-03-31',stocks:[{code:'000001',bars:Array.from({length:32},(_,i)=>{const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);return {date,open:10,high:11,low:9,close:10,volume:100};})}]};}
test('rejects impossible asOf calendar date',()=>{const d=history();d.asOf='2026-02-30';assert.throws(()=>validateDataset(d),/截至日期/);});
test('rejects impossible bar calendar date',()=>{const d=history();d.stocks[0].bars[2].date='2026-02-30';assert.throws(()=>validateDataset(d),/日期无效/);});
test('imported bars must carry a date on every record',()=>{const d=history();for(const b of d.stocks[0].bars)delete b.date;assert.throws(()=>validateDataset(d),/交易日期/);});
test('rejects bar later than asOf even in offline validation',()=>{const d=history();d.asOf='2026-01-15';assert.throws(()=>validateDataset(d),/未来K线/);});
test('rejects non-json content-type before writing imported data',async()=>{const raw=Buffer.from(JSON.stringify(history()));const c=createMarketDataCenter({url:'https://data.example.org/history',outputFile:'/tmp/v6-no-write-on-wrong-mime-'+process.pid,provider:'test',datasetId:'data-001',fetchImpl:async()=>({ok:true,headers:{get:k=>k==='content-type'?'text/html':String(raw.length)},body:Readable.from([raw])})});const r=await c.sync();assert.match(r.error,/JSON/);});
