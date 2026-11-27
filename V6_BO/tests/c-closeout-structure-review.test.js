'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-27',code='600001',at=day+' 15:00';
function dates(n){const d=new Date(day+'T12:00:00Z'),out=[];while(out.length<n){if(![0,6].includes(d.getUTCDay()))out.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}return out;}
function series(n=30){
 const ds=dates(n);return ds.map((date,i)=>({code,date,name:'结构复核样例',role:'stock',period:'日K',priceBasis:'unadjusted',source:'synthetic-original',open:100,high:105,low:95,close:100,volume:1000,volumeUnit:'shares',...(i?{previousDay:ds[i-1]}:{})}));
}
function set(r,close,high,low,volume=1000,open=close){Object.assign(r,{open,close,high,low,volume});return r;}
function breakout(rows,index=rows.length-5){set(rows[index],110,112,104,2000);return rows[index];}
async function scan(rows,extra={}){const b=rows.at(-1);return (await api).buildChaseRiskResearch({b,history:rows.slice(0,-1),asOf:at,currentRows:[b],...extra});}
test('C30.1 current frozen prior twenty range separates high touch, close return, boundary, and range floor',async()=>{
 const rows=series();set(rows.at(-1),102,110,99);
 let r=(await scan(rows)).structureReview;assert.equal(r.current.range.high,105);assert.equal(r.current.range.low,95);
 assert.equal(r.current.attemptedBreakoutReturnedBelow,true);assert.equal(r.current.closeAboveCeiling,false);
 assert.equal(r.anchorStatus,'no-close-breakout-in-five-endpoints');
 set(rows.at(-1),105,110,99);r=(await scan(rows)).structureReview;
 assert.equal(r.current.attemptedBreakoutReturnedBelow,false);assert.equal(r.current.attemptedBreakoutClosedAtBoundary,true);assert.equal(r.current.closeAtCeiling,true);
 set(rows.at(-1),94,98,93);r=(await scan(rows)).structureReview;
 assert.equal(r.current.closeBelowFloor,true);assert.equal(r.current.lowBelowFloor,true);assert.equal(r.canTrade,false);
});
test('C30.1 present close breakout reconstructs prior range without current high or later data',async()=>{
 const rows=series();breakout(rows,rows.length-1);
 const r=(await scan(rows)).structureReview;assert.equal(r.anchor.date,day);assert.equal(r.anchor.resistance,105);
 assert.equal(r.anchor.referenceTo,rows.at(-2).date);assert.equal(r.path.status,'breakout-close-observed');assert.equal(r.path.observedSessions,0);
 assert.equal(r.path.actualFalseBreakout,null);assert.equal(r.path.canTrade,false);
});
test('C30.2 clean contracting retest holds the original ceiling and is not confirmed healthy or a buy instruction',async()=>{
 const rows=series(),a=breakout(rows);set(rows[26],112,115,108,1800);set(rows[27],109,114,108,1600);set(rows[28],108,110,106,1300);set(rows[29],107,109,104,800);
 const r=(await scan(rows)).structureReview,p=r.path;
 assert.equal(r.anchor.date,a.date);assert.equal(r.anchor.resistance,105);assert.equal(r.current.range.high,115);
 assert.equal(p.status,'contracting-retest-close-held');assert.equal(p.retestDays,1);assert.equal(p.firstBreachDay,null);
 assert.equal(p.volumeReview.versusAnchor,.4);assert.equal(p.volumeReview.contractedAgainstBoth,true);
 assert.equal(p.actualHealthyPullback,null);assert.equal(p.canTrade,false);
});
test('C30.2 volume missing, incomparable or not contracting is never inferred from the close',async()=>{
 for(const patch of [{volumeUnit:undefined},{volumeUnit:'lots'},{volume:0},{volume:null},{volume:2500}]){
  const rows=series();breakout(rows);for(const r of rows.slice(26,29))set(r,108,110,106,1300);set(rows[29],107,109,104,800);Object.assign(rows[29],patch);
  const p=(await scan(rows)).structureReview.path;
  if(patch.volume===2500){assert.equal(p.status,'retest-close-held-no-confirmed-contraction');assert.equal(p.volumeReview.contractedAgainstBoth,false);}
  else{assert.equal(p.status,'retest-close-held-volume-unknown');assert.equal(p.volumeReview,null);}
 }
});
test('C30.2 equality at frozen ceiling is distinct from a reclaimed or held-above close',async()=>{
 const rows=series();breakout(rows);for(const r of rows.slice(26,29))set(r,108,110,106,1300);set(rows[29],105,108,103,800);
 const p=(await scan(rows)).structureReview.path;assert.equal(p.status,'retest-closed-at-boundary');assert.equal(p.currentCloseBelowFrozenLevel,false);
 assert.equal(p.observations.at(-1).atLevel,true);assert.equal(p.actualRecoveryConfirmed,null);
});
test('C30.3 break then reclaim then rebreak stays tied to the earliest anchor',async()=>{
 const rows=series(),a=breakout(rows);
 set(rows[26],103,111,102);set(rows[27],113,114,103);set(rows[28],108,113,106);set(rows[29],102,109,101);
 const r=(await scan(rows)).structureReview,p=r.path;
 assert.equal(r.anchor.date,a.date);assert.equal(r.anchor.resistance,105);assert.equal(p.status,'reclaim-failed-close-below');
 assert.equal(p.firstBreachDay,rows[26].date);assert.equal(p.firstReclaimDay,rows[27].date);assert.equal(p.firstRebreakDay,day);
 assert.equal(p.rebreakCount,1);assert.equal(p.observations.at(-1).touchedLevelButClosedBelow,true);assert.equal(p.actualRecoveryConfirmed,null);
});
test('C30.3 reclaim after breach is not clean retest or confirmed recovery; boundary stays separate',async()=>{
 const rows=series();breakout(rows);set(rows[26],103,109,102);set(rows[27],104,106,102);set(rows[28],104,106,103);set(rows[29],107,109,103,500);
 let p=(await scan(rows)).structureReview.path;assert.equal(p.status,'close-reclaimed-after-breach');assert.equal(p.actualRecoveryConfirmed,null);
 set(rows[29],105,109,103,500);p=(await scan(rows)).structureReview.path;assert.equal(p.status,'boundary-after-breach');assert.equal(p.firstReclaimDay,null);
 set(rows[29],93,104,92);p=(await scan(rows)).structureReview.path;assert.equal(p.currentCloseBelowFrozenRangeFloor,true);
 assert.equal(p.status,'close-below-frozen-level');
});
test('C30.4 insufficient prior window, changed source or missing predecessor cannot invent an anchor',async()=>{
 const short=series(20);assert.equal((await scan(short)).structureReview,null);
 const partial=series(23),p=(await scan(partial)).structureReview;assert.ok(p.current);assert.equal(p.anchorStatus,'unknown');assert.equal(p.path,null);
 for(const patch of [{source:'other'},{priceBasis:'hfq'},{corporateAction:true},{sourceConflict:true},{sampleSet:'test'}]){
  const rows=series();Object.assign(rows[20],patch);assert.equal((await scan(rows)).structureReview,null);
 }
 const rows=series();rows.splice(18,1);assert.equal((await scan(rows)).structureReview,null);
});
test('C30.4 later available historical rows may support present range but not earlier anchor selection',async()=>{
 const rows=series();breakout(rows);rows[15].knownAt=rows[27].date+' 15:00';
 const r=(await scan(rows)).structureReview;
 assert.ok(r.current);assert.equal(r.anchorStatus,'unknown');assert.equal(r.anchor,null);assert.equal(r.path,null);
 const late=series();breakout(late);late[25].knownAt=late[26].date+' 15:00';
 const x=(await scan(late)).structureReview;assert.ok(x.current);assert.equal(x.anchorStatus,'unknown');
});
test('C30.4 price-identical conflicting volume versions remove contraction only, late conflicts do not rewrite',async()=>{
 const rows=series();breakout(rows);for(const r of rows.slice(26,29))set(r,108,110,106,1300);set(rows[29],107,109,104,800);
 const past=rows[28],b=rows.at(-1);
 for(const history of [[...rows.slice(0,-1),{...past,volume:1}],[{...past,volume:1},...rows.slice(0,-1)]]){
  const p=(await scan(rows,{history})).structureReview.path;assert.equal(p.status,'retest-close-held-volume-unknown');assert.equal(p.volumeReview,null);
 }
 const x=(await scan(rows,{currentRows:[b,{...b,volumeUnit:'lots'}]})).structureReview.path;
 assert.equal(x.status,'retest-close-held-volume-unknown');
 const y=(await scan(rows,{history:[...rows.slice(0,-1),{...past,volume:1,knownAt:day+' 15:01'}]})).structureReview.path;
 assert.equal(y.status,'contracting-retest-close-held');
});
test('C30.5 no healthy/failed label from guessed intraday order or uncertified actual outcomes',async()=>{
 const rows=series();breakout(rows);set(rows[26],102,110,99);set(rows[27],104,106,101);set(rows[28],104,107,100);set(rows[29],103,111,100);
 const r=await scan(rows),p=r.structureReview.path;
 assert.equal(p.observations.at(-1).touchedLevelButClosedBelow,true);assert.equal(p.firstReclaimDay,null);
 assert.equal(p.actualHealthyPullback,null);assert.equal(p.actualFalseBreakout,null);assert.equal(p.actualRecoveryConfirmed,null);
 assert.equal(r.canTrade,false);assert.equal(p.canTrade,false);
});
test('C30.integration original recognition and historical observation consume the same frozen structure path',async()=>{
 const {deriveCheckInput,observations}=await import('../public/nova/shortline/backtest.mjs'),{autoValidate}=await import('../public/nova/shortline/market.mjs');
 const catalog=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
 const rows=series();breakout(rows);set(rows[26],103,111,102);set(rows[27],113,114,103);set(rows[28],108,113,106);set(rows[29],102,109,101);
 const state={catalog,bars:rows,market:[],trades:[],plans:[]};
 const a=deriveCheckInput(state,{code,date:day}).recognition.chaseRiskResearch;
 const b=autoValidate(state,{code,date:day}).recognition.chaseRiskResearch;
 const h=observations(state,day,{code,all:true}).find(r=>r.date===day).features.chaseRiskResearch;
 for(const r of [a,b,h]){assert.equal(r.structureReview.path.status,'reclaim-failed-close-below');assert.equal(r.structureReview.anchor.resistance,105);assert.equal(r.canTrade,false);}
 const conflict={...state,bars:[...rows,{...rows[27],close:110}]};
 assert.equal(deriveCheckInput(conflict,{code,date:day}).recognition.chaseRiskResearch.structureReview,null);
});

test('C30.integration original CSV keeps explicit volume units without guessing units for legacy rows',async()=>{
 const {parseKCsv,deriveCheckInput}=await import('../public/nova/shortline/backtest.mjs');
 const catalog=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
 const rows=series();breakout(rows);for(const r of rows.slice(26,29))set(r,108,110,106,1300);set(rows[29],107,109,104,800);
 const header=['date','code','name','open','high','low','close','volume','priceBasis','source'];
 function csv(withUnit,unitHeader='volumeUnit',currentUnit='shares'){
  return [header.concat(withUnit?[unitHeader]:[]).join(','),...rows.map((r,i)=>header.map(k=>r[k]).concat(withUnit?[i===rows.length-1?currentUnit:r.volumeUnit]:[]).join(','))].join('\n');
 }
 const p=(bars)=>deriveCheckInput({catalog,bars,market:[],trades:[],plans:[]},{code,date:day}).recognition.chaseRiskResearch.structureReview.path;
 const bars=parseKCsv(csv(true));assert.equal(bars.at(-1).volumeUnit,'shares');assert.equal(p(bars).status,'contracting-retest-close-held');
 const zh=parseKCsv(csv(true,'成交量单位'));assert.equal(zh.at(-1).volumeUnit,'shares');assert.equal(p(zh).status,'contracting-retest-close-held');
 const old=parseKCsv(csv(false));assert.equal(old.at(-1).volumeUnit,undefined);assert.equal(p(old).status,'retest-close-held-volume-unknown');
 const mixed=parseKCsv(csv(true,'volumeUnit','lots'));assert.equal(p(mixed).volumeReview,null);
 const invalid=parseKCsv(csv(true,'volumeUnit','unknown'));assert.equal(p(invalid).volumeReview,null);
});
