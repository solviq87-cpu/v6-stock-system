'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runValidatedBacktest}=require('../src/core/historical-validation');
test('F42.4 original validated ledger runs separate actual native segment replays with unchanged continuous result',()=>{
 const dates=Array.from({length:120},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10)).filter(d=>![0,6].includes(new Date(d).getUTCDay())).slice(0,80),code='600000',split=51;
 const master={source:'fixture-security',knownAt:'2024-12-31T00:00:00Z',availableAt:'2024-12-31T01:00:00Z',dataVersion:'v1',listedOn:'2000-01-01',delistedOn:null,board:'main',isST:false,suspended:false,limitPct:10,priceBasis:'unadjusted',corporateActionStatus:'none',actionIds:[],feeVersion:'fee1',evidenceHash:'a'.repeat(64)};
 const member=(from,through,securityMaster)=>({symbol:code,from:dates[from],through:dates[through],eligible:true,source:'fixture-membership',knownAt:securityMaster.knownAt,securityMaster});
 const newer={...master,dataVersion:'v2',feeVersion:'fee2',evidenceHash:'b'.repeat(64),knownAt:'2025-01-15T00:00:00Z',availableAt:'2025-01-15T01:00:00Z'};
 const fee=(version,effectiveFrom,knownAt,feeBps)=>({version,source:'fixture-fees',knownAt,effectiveFrom,feeBps,minFee:0,sellTaxBps:5});
 const history={source:'imported',provider:'isolated-fixture',asOf:dates.at(-1),requirePointInTime:true,priceBasis:'unadjusted',priceAdjustment:{mode:'unadjusted'},stocks:[{symbol:code,market:'main',volumeUnit:'shares',bars:dates.map((date,i)=>({date,open:10+i*.01,close:10.01+i*.01,high:10.1+i*.01,low:9.9+i*.01,volume:1000000,amount:10000000,isST:false,suspended:false,tradable:true,limitPct:10,priceBasis:'unadjusted'}))}],
  universeHistory:[member(0,split,master),member(split+1,dates.length-1,newer)],feeSchedules:[fee('fee1','2025-01-01',master.knownAt,1),fee('fee2',dates[split+1],newer.knownAt,2)],start:27,end:dates.length-1};
 const plain=runValidatedBacktest(history),withReview=runValidatedBacktest({...history,institutionalReview:true});
 assert.deepEqual(withReview.metrics,plain.metrics);assert.deepEqual(withReview.equity,plain.equity);assert.deepEqual(withReview.trades,plain.trades);
 assert.equal(plain.institutionalReview.status,'segmented-awaiting-review');const r=withReview.institutionalReview;
 assert.equal(r.breakCount,1);assert.equal(r.replayAttempts,2);assert.equal(r.reviewedSegments,2);assert.equal(r.segments[1].fromDate,dates[split+1]);assert.equal(r.releaseEligible,false);
 assert.throws(()=>runValidatedBacktest({...history,institutionalReview:'true'}),/布尔值/);
});
