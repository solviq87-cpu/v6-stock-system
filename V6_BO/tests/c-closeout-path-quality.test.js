'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-27',code='600001',at=day+' 15:00';
function dates(n){const d=new Date(day+'T12:00:00Z'),out=[];while(out.length<n){if(![0,6].includes(d.getUTCDay()))out.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}return out;}
function series(closes){const ds=dates(closes.length);return closes.map((close,i)=>({code,date:ds[i],role:'stock',period:'日K',priceBasis:'unadjusted',
 source:'same-original-source',sampleSet:'real',sampleSource:'isolated-fixture',open:close,high:close,low:close,close,...(i?{previousDay:ds[i-1]}:{})}));}
async function scan(rows,extra={}){const b=rows.at(-1);return (await api).buildChaseRiskResearch({b,history:rows.slice(0,-1),asOf:at,currentRows:[b],...extra});}
const win=(r,n=5)=>r.pathQuality.windows.find(w=>w.sessions===n);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,'expected '+b+' got '+a);
test('C37.1 equal endpoint return separates smooth gains from volatile chase-risk paths',async()=>{
 const smooth=win(await scan(series([100,102,104,106,108,110]))).recent;
 const volatile=win(await scan(series([100,125,88,125,90,110]))).recent;
 near(smooth.netReturnPct,10);near(volatile.netReturnPct,10);
 assert.ok(volatile.dailyLogVolatilityPct>smooth.dailyLogVolatilityPct);
 assert.equal(smooth.maxCloseDrawdownPct,0);assert.ok(volatile.maxCloseDrawdownPct>20);
 near(smooth.directionEfficiency,1);assert.ok(volatile.directionEfficiency<0.3);
});
test('C37.2 drawdown uses ordered closing observations and original peak and trough dates, not intraday extremes',async()=>{
 const rows=series([100,120,90,100,110,120]);
 rows[2].high=150;rows[2].low=1;
 const r=win(await scan(rows)).recent;
 near(r.maxCloseDrawdownPct,25);assert.equal(r.drawdownPeakDate,rows[1].date);
 assert.equal(r.drawdownTroughDate,rows[2].date);
 assert.equal(r.startClose,100);assert.equal(r.endClose,120);
});
test('C37.3 signed path movement, concentration, counts and streaks do not equate gross movement with net return',async()=>{
 const r=win(await scan(series([100,110,121,121,110,121]))).recent;
 near(r.netReturnPct,21);near(r.positiveLogMovementPct,300*Math.log(1.1));near(r.negativeLogMovementPct,100*Math.log(1.1));
 near(r.directionEfficiency,.5);near(r.largestGainSharePct,100/3);
 assert.equal(r.risingSessions,3);assert.equal(r.fallingSessions,1);assert.equal(r.flatSessions,1);
 assert.equal(r.longestRisingRun,2);assert.equal(r.longestFallingRun,1);
});
test('C37.4 fixed five, ten and twenty session windows expose exact dates and explicitly insufficient data',async()=>{
 const rows=series(Array.from({length:21},(_,i)=>100+i));
 const r=await scan(rows);assert.deepEqual(r.pathQuality.windows.map(w=>w.sessions),[5,10,20]);
 for(const n of [5,10,20]){const x=win(r,n);assert.equal(x.status,'observed-research');assert.equal(x.recent.from,rows[20-n].date);assert.equal(x.recent.to,day);}
 assert.equal(win(r,20).preceding,null);assert.equal(win(r,20).acceleration,null);
 const small=win(await scan(rows.slice(-5)));
 assert.equal(small.status,'insufficient-contiguous-history');assert.equal(small.recent,null);
});
test('C37.5 adjacent equal-length windows share only boundary close and expose acceleration without thresholds',async()=>{
 const rows=series([100,101,102,103,104,105,107,109,112,118,125]),x=win(await scan(rows));
 assert.equal(x.preceding.from,rows[0].date);assert.equal(x.preceding.to,x.recent.from);assert.equal(x.recent.to,day);
 near(x.acceleration.netLogReturnDeltaPctPoints,100*(Math.log(125/105)-Math.log(105/100)));
 assert.equal(x.acceleration.fasterPositiveGain,true);assert.equal(x.acceleration.greaterVolatility,true);
 assert.equal(win(await scan(rows.slice(-10))).acceleration,null);
});
test('C37.6 source, sample family, adjustment, missing predecessor and visible contradictions break the affected window',async()=>{
 const rows=series(Array.from({length:21},(_,i)=>100+i)),i=rows.length-8;
 for(const patch of [{source:'different'},{sampleSource:'different'},{priceBasis:'hfq'},{withdrawn:true}]){
  const bad=rows.map((r,j)=>j===i?{...r,...patch}:r),r=await scan(bad);
  assert.ok(win(r,5).recent);assert.equal(win(r,10).recent,null);
 }
 const removed=rows.filter((_,j)=>j!==i),r=await scan(removed);
 assert.ok(win(r,5).recent);assert.equal(win(r,10).recent,null);
 const bad={...rows[i],close:rows[i].close+1,high:rows[i].close+1};
 const conflict=await scan(rows,{history:[...rows.slice(0,-1),bad]});
 assert.equal(win(conflict,10).recent,null);
});
test('C37.7 invisible later corrections and exact copies do not change path evidence; visible current conflict withholds it',async()=>{
 const rows=series([100,102,104,106,108,110]),baseline=(await scan(rows)).pathQuality;
 const older=rows[1],late={...older,close:200,high:200,knownAt:day+' 15:01'};
 const r=await scan(rows,{history:[...rows.slice(0,-1),{...older},late]});assert.deepEqual(r.pathQuality,baseline);
 const current=rows.at(-1);assert.equal((await scan(rows,{currentRows:[current,{...current,close:111,high:111}]})).pathQuality,null);
});
test('C37.8 flat or extreme valid prices do not fabricate gain concentration, infinite metrics, risk level or authority',async()=>{
 const flat=await scan(series([100,100,100,100,100,100])),q=win(flat).recent;
 assert.equal(q.dailyLogVolatilityPct,0);assert.equal(q.maxCloseDrawdownPct,0);assert.equal(q.directionEfficiency,null);
 assert.equal(q.largestGainSharePct,null);assert.equal(q.flatSessions,5);
 const e=await scan(series([Number.MIN_VALUE,1e300,1e-300,1e300,1e-300,1e300])),x=win(e).recent;
 assert.equal(x.netReturnPct,null);assert.ok(Number.isFinite(x.netLogReturnPct));assert.ok(Number.isFinite(x.dailyLogVolatilityPct));
 assert.equal(e.pathQuality.actualChaseRiskLevel,null);assert.equal(e.pathQuality.canTrade,false);assert.equal(e.canTrade,false);
});
