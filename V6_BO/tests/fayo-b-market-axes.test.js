'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyObservedMarket}=require('../src/core/observed-market-regime');
const day='2026-11-05',at=Date.parse(day+'T10:00:00+08:00');
const scores={indexTrendScore:75,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70,asOf:at,observedAt:at+1000,knownAt:at+2000};
const options={asOf:at+3000,scoreSource:'fixture-index-scores',scoreDate:day,scores};
// Synthetic weekday calendar for deterministic tests, not an exchange calendar.
const dates=[day];
for(let t=Date.parse(day+'T00:00:00Z')-86400000;dates.length<62;t-=86400000){
 const d=new Date(t);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)dates.unshift(d.toISOString().slice(0,10));
}
const codes=['000001.SH','399001.SZ','399006.SZ'];
const snap=(values=[2,1,3,-1],universeSize=values.length)=>({date:day,source:'fixture-market',universeSize,returnWindow:'session-to-date',
 asOf:at,observedAt:at+1000,knownAt:at+2000,sourceCoverage:{monetaryUnit:'provider-CNY-unverified'},
 stocks:values.map((pctChange,i)=>({code:String(i+1).padStart(6,'0'),pctChange,vendorQuoteAt:at-1000,amount:100,limitUp:false,limitDown:false}))});
const index=(returnPct=1)=>({code:'000300',source:'fixture-index',tradeDate:day,returnWindow:'session-to-date',returnPct,
 asOf:at,observedAt:at+1000,knownAt:at+2000});
const history=(path=(i)=>100*1.01**i)=>({calendar:{source:'fixture-calendar',evidenceId:'cal-1',knownAt:at-86400000,tradeDates:[...dates]},indices:codes.map((indexCode,j)=>({indexCode,source:'fixture-historical-index',evidenceId:'series-'+j,priceMethod:'index-close',
 bars:dates.slice(0,-1).map((date,i)=>({date,close:path(i,j),final:true,observedAt:Date.parse(date+'T15:10:00+08:00'),knownAt:Date.parse(date+'T15:11:00+08:00')}))}))});
const axes=(s=snap(),h=history(),i=index(),o={})=>classifyObservedMarket(s,{...options,axisHistory:h,indexObservation:i,...o}).marketAxes;
const editBar=(h,change,index=0,offset=60)=>{h.indices[index].bars[offset]={...h.indices[index].bars[offset],...change};return h;};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,String(a)+' vs '+String(b));
test('20 and 60 completed-session returns use the correct endpoints for all three indices',()=>{
 const r=axes();assert.equal(r.trend.medium,'up');assert.equal(r.trend.long,'up');assert.equal(r.trend.throughDate,dates[60]);assert.equal(r.trend.indices.length,3);
 for(const i of r.trend.indices){close(i.return20Pct,100*(1.01**20-1));close(i.return60Pct,100*(1.01**60-1));close(i.realizedDailyVolatility20Pct,0);}
 assert.equal(r.trend.calendarCertified,false);
});
test('slow downtrend with majority advance is a rebound, not a confirmed reversal or bull market',()=>{
 const r=axes(snap(),history(i=>100*.99**i));assert.equal(r.trend.long,'down');assert.equal(r.trend.medium,'down');assert.equal(r.structure.label,'majority-advance');
 assert.equal(r.reading,'downtrend-majority-rebound');assert.equal(r.bullBear,'unknown');assert.equal(r.reversalConfirmed,false);assert.equal(r.canTrade,false);
});
test('prior long decline and shorter recovery coexist without changing the long trend',()=>{
 const r=axes(snap(),history(i=>100*.98**Math.min(i,40)*1.01**Math.max(0,i-40)));
 assert.equal(r.trend.long,'down');assert.equal(r.trend.medium,'up');assert.equal(r.reading,'downtrend-recovery-watch');assert.equal(r.reversalConfirmed,false);
});
test('prior uptrend and weak current participation remain separate pullback observations',()=>{
 const r=axes(snap([-2,-1,-3,1]),history(),index(-1));assert.equal(r.trend.long,'up');assert.equal(r.structure.label,'majority-decline');assert.equal(r.reading,'uptrend-majority-pullback');
 const q=axes(snap([-2,-1,-3,1]),history(i=>100*1.02**Math.min(i,40)*.99**Math.max(0,i-40)),index(-1));
 assert.equal(q.trend.long,'up');assert.equal(q.trend.medium,'down');assert.equal(q.reading,'uptrend-deterioration-watch');
});
test('downtrend with index rise and majority loss does not assert crowding or institutional flows',()=>{
 const r=axes(snap([-1,-2,-3,1]),history(i=>100*.99**i),index(1));
 assert.equal(r.structure.label,'narrow-index-rise');assert.equal(r.reading,'downtrend-narrow-index-rise');assert.equal(r.crowding,'unknown');assert.equal(r.bullBear,'unknown');
});
test('mixed broad indices and flat history are separate states, never a forced bull or bear',()=>{
 const mixed=axes(snap(),history((i,j)=>100*(j===1?.99:1.01)**i));assert.equal(mixed.trend.long,'mixed');assert.equal(mixed.trend.medium,'mixed');assert.equal(mixed.reading,'unknown');
 const flat=axes(snap(),history(()=>100));assert.equal(flat.trend.long,'flat');assert.equal(flat.trend.medium,'flat');assert.equal(flat.reading,'unknown');
});
test('a missing or malformed history cannot replace independent trend with legacy index score',()=>{
 for(const h of [null,{},[],{...history(),simulated:true}]){const r=axes(snap(),h);assert.equal(r.trend.long,'unknown');assert.equal(r.structure.label,'majority-advance');assert.equal(r.reading,'unknown');}
});
test('frozen calendar must contain exactly the prior sessions and current day, known by cutoff',()=>{
 for(const change of [{knownAt:at+1},{source:''},{evidenceId:''},{tradeDates:dates.slice(1)},{tradeDates:[...dates.slice(0,-1),dates[60]]},{tradeDates:[...dates.slice(0,-1),'2026-11-06']},{simulated:true}]){
  const h=history();Object.assign(h.calendar,change);assert.equal(axes(snap(),h).trend.long,'unknown');
 }
});
test('all three named broad index series are required; no missing or duplicate index substitution',()=>{
 for(const kind of ['missing','duplicate','unrecognized']){const h=history();if(kind==='missing')h.indices.pop();else h.indices[2].indexCode=kind==='duplicate'?codes[0]:'other';
  assert.equal(axes(snap(),h).trend.long,'unknown');}
});
test('missing, duplicate, out-of-order or same-day closing bars cannot replace prior 61 sessions',()=>{
 const h=history();h.indices[0].bars.pop();assert.equal(axes(snap(),h).trend.long,'unknown');
 for(const date of [dates[59],day,'2026-02-30'])assert.equal(axes(snap(),editBar(history(),{date})).trend.long,'unknown');
});
test('premature close, non-final, late or inverted evidence is rejected without future leakage',()=>{
 const last=dates[60],observedAt=Date.parse(last+'T15:09:59+08:00');
 for(const change of [{observedAt},{knownAt:at+1},{knownAt:Date.parse(last+'T15:09:00+08:00')},{observedAt:at,knownAt:at-1},{final:false},{final:null},{knownAt:last},{observedAt:last}])assert.equal(axes(snap(),editBar(history(),change)).trend.long,'unknown');
});
test('mixed index source or price convention, simulated row or invalid price prevents return computation',()=>{
 for(const change of [{source:'other'},{indexCode:'399006.SZ'},{priceMethod:'total-return'},{simulated:true},{close:0},{close:-1},{close:'100'},{close:Infinity}])assert.equal(axes(snap(),editBar(history(),change)).trend.long,'unknown');
});
test('nonfinite return/volatility cannot produce a directional label',()=>{
 const h=editBar(history(),{close:Number.MIN_VALUE},0,40);assert.equal(axes(snap(),h).trend.long,'unknown');
});
test('fast structure with unknown or stale original quote time stays unknown while slow trend remains available',()=>{
 for(const vendorQuoteAt of [null,at-90001]){const s=snap();s.stocks[0].vendorQuoteAt=vendorQuoteAt;const r=axes(s);assert.equal(r.structure.label,'unknown');assert.equal(r.trend.long,'up');assert.equal(r.sentiment.label,'unknown');assert.equal(r.reading,'unknown');}
});
test('low coverage, ambiguous majority, or missing window cannot establish current structure',()=>{
 const r=axes(snap([1,2,-1,-2],10),history(),index(),{minCoverage:.4});assert.equal(r.structure.label,'unknown');
 const ambiguous=axes(snap([1,1,1,1,1,-1,-1,-1],10));assert.equal(ambiguous.structure.label,'unknown');
 assert.equal(axes({...snap(),returnWindow:null}).structure.label,'unknown');
});
test('emotion imbalance uses complete noncontradictory limit flags, phase remains unknown',()=>{
 const s=snap();s.stocks[0].limitUp=true;s.stocks[1].limitUp=true;s.stocks[3].limitDown=true;const r=axes(s);
 assert.equal(r.sentiment.label,'positive-limit-imbalance');assert.equal(r.sentiment.limitUp,2);assert.equal(r.sentiment.limitDown,1);assert.equal(r.phase.label,'unknown');
 s.stocks[1].limitUp=false;s.stocks[0].limitUp=false;assert.equal(axes(s).sentiment.label,'negative-limit-imbalance');
 s.stocks[3].limitDown=false;assert.equal(axes(s).sentiment.label,'balanced-limit-counts');
});
test('missing flag, mixed flags, incompatible sign or incomplete universe cannot produce fake limit imbalance',()=>{
 for(const change of [{limitUp:undefined},{limitDown:true},{limitUp:true,limitDown:true},{limitUp:1}]){const s=snap();Object.assign(s.stocks[0],change);assert.equal(axes(s).sentiment.label,'unknown');}
 assert.equal(axes(snap([1,2,3,-1],5)).sentiment.label,'unknown');
});
test('legacy dates without verified timing retain old regime and weights but axes are unknown',()=>{
 const s=snap();delete s.asOf;const r=classifyObservedMarket(s,{...options,axisHistory:history()});assert.equal(r.usable,true);assert.equal(r.marketAxes.status,'unknown');assert.equal(r.marketAxes.trend.long,'unknown');assert.equal(r.marketAxes.structure.label,'unknown');
});
test('declared historical replay cannot masquerade as a current policy',()=>{
 const r=axes(snap(),history(),index(),{asOf:at+86400000});assert.equal(r.historicalAtDecision,true);assert.equal(r.asOf,at);assert.equal(r.canNotify,false);assert.equal(r.canTrade,false);
});
test('new research axes do not alter original five-class regime, scores or weights and cannot authorize promotion',()=>{
 const s=snap(),old=classifyObservedMarket(s,options),next=classifyObservedMarket(s,{...options,indexObservation:index(),axisHistory:history(i=>100*.99**i)});
 for(const key of ['regime','weights','attackScore','defensiveScore','inputs'])assert.deepEqual(next[key],old[key]);
 const r=next.marketAxes;assert.equal(r.calibrated,false);assert.equal(r.certified,false);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);assert.equal(r.weightsChanged,false);
});
