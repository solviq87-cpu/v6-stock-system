'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const at=Date.parse('2026-11-05T10:00:00+08:00');
const base={method:'adjacent-qualified-index-window-v1',code:'1.000001',source:'sina-index',windowMinutes:1,quoteAt:at,
 detectedAt:at,validUntil:at+60000,returnPct:1,historicalMaxAbsPct:0.5,referenceDays:20,
 revision:2,status:'abnormal',phase:'strengthening',direction:'up',attribution:'unknown',canTrade:false,canNotify:false};
test('shared display projection distinguishes abnormal and ended windows without declaring safety',async()=>{
 const {indexContinuityRows}=await import('../public/nova/index-continuity-view.mjs');
 const rows=indexContinuityRows([base,{...base,phase:'below-historical-range',status:'ended',returnPct:0}],at);
 assert.equal(rows[0].label,'异动强化');assert.equal(rows[0].revision,2);assert.equal(rows[0].direction,'上涨');
 assert.equal(rows[1].label,'回到历史变动范围');assert.match(rows[1].note,/不代表风险解除/);
});
test('shared display drops expired, conflicting, malformed and permission-altered evidence',async()=>{
 const {indexContinuityRows}=await import('../public/nova/index-continuity-view.mjs');
 assert.deepEqual(indexContinuityRows([base],at+60000),[]);assert.deepEqual(indexContinuityRows([base],at-1),[]);
 for(const patch of [{phase:'below-historical-range'},{canTrade:true},{canNotify:true},{returnPct:NaN},{referenceDays:19},
 {validUntil:at+120000},{returnPct:0},{status:'ended'},{phase:'unknown'},{direction:null},{detectedAt:at-1}])
  assert.deepEqual(indexContinuityRows([{...base,...patch}],at),[]);
 assert.deepEqual(indexContinuityRows(null,at),[]);
});
