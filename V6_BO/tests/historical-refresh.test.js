'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {refreshHistorical}=require('../src/strategy/historical-refresh');
const {adaptCachedKline}=require('../src/strategy/cached-kline-adapter');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
let n=0;const ok=x=>{assert.ok(x);n++;};
const date=new Date(Date.now()-86400000).toISOString().slice(0,10);
const bars=Array.from({length:35},(_,i)=>({date:new Date(Date.now()-(35-i)*86400000).toISOString().slice(0,10),
 open:10,high:10.5,low:9.5,close:10,volume:10000}));
(async()=>{
 const calls=[];
 const r=await refreshHistorical({codes:['000001','000001','000002'],adapt:adaptCachedKline,
  fetchKline:async code=>{calls.push(code);return code==='000002'?null:{rows:bars,name:'TEST'};}});
 ok(r.requested===2);ok(r.success===1);ok(calls.length===2);ok(r.items[0].stock.bars.length===35);
 ok(r.items[1].ok===false);ok(r.verifiedLive===false);ok(r.warning.includes('不是交易所认证'));
 for(const codes of [[],Array(21).fill('000001'),['../bad']]){
  await assert.rejects(()=>refreshHistorical({codes,adapt:adaptCachedKline,fetchKline:async()=>null}));n++;
 }
 ok(server.includes("p==='/api/research/history-refresh'"));
 ok(server.includes('if(!requireEditor(res,req.__tok,req))return;'));
 ok(server.includes('klineSet(x.code,x.kline)'));
 ok(server.includes('verifiedLive:false,source:batch.source'));
 ok(server.includes('codes.length>20'));
 console.log('PASS '+n+' historical refresh assertions');
})().catch(e=>{console.error(e);process.exitCode=1});
