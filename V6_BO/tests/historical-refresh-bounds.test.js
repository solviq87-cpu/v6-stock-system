'use strict';
const assert=require('node:assert/strict');
const {refreshHistorical}=require('../src/strategy/historical-refresh');
let count=0;function eq(a,b){assert.deepEqual(a,b);count++;}
(async()=>{
const adapt=(code,k)=>({stock:{symbol:code,bars:k.rows}});
const valid=async()=>({rows:[{date:'2026-01-01',close:1}]});
let calls=0;
const batch=await refreshHistorical({codes:['000001','000001','000002'],fetchKline:async c=>{calls++;if(c==='000002')throw Error('provider down');return valid();},adapt});
eq(batch.requested,2);eq(batch.success,1);eq(calls,2);eq(batch.items[1].ok,false);eq(batch.verifiedLive,false);
for(const codes of [[],['../bad'],[1],Array(21).fill('000001')]){await assert.rejects(()=>refreshHistorical({codes,fetchKline:valid,adapt}));count++;}
for(const concurrency of [0,6,1.5]){await assert.rejects(()=>refreshHistorical({codes:['000001'],fetchKline:valid,adapt,concurrency}));count++;}
for(const timeoutMs of [0,99,60001,NaN]){await assert.rejects(()=>refreshHistorical({codes:['000001'],fetchKline:valid,adapt,timeoutMs}));count++;}
let current=0,max=0;
const parallel=await refreshHistorical({codes:['000001','000002','000003','000004','000005'],concurrency:2,timeoutMs:2000,adapt,fetchKline:async()=>{current++;max=Math.max(max,current);await new Promise(r=>setTimeout(r,15));current--;return valid();}});
eq(parallel.success,5);eq(max<=2,true);
let aborted=false;
const start=Date.now();
const slow=await refreshHistorical({codes:['000001'],timeoutMs:100,adapt,fetchKline:async(_c,_n,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true});})});
eq(slow.success,0);eq(aborted,true);eq(Date.now()-start<800,true);eq(slow.items[0].error.includes('超时')||slow.items[0].error.includes('aborted'),true);
console.log('PASS '+count+' refresh bounded concurrency and timeout assertions');
})().catch(e=>{console.error(e);process.exitCode=1});
