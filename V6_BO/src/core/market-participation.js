'use strict';
/** Descriptive participation in a declared universe, not authenticated full-market
 * membership, a bull/bear label, institutional flow, or a trading signal. */
const {researchInstant}=require('./observed-market-timing');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const CODE=/^\d{6}$/;
const known=(row,key)=>row?.[key]!==undefined&&row[key]!==null;
const validPct=n=>typeof n==='number'&&Number.isFinite(n)&&n>=-100&&n<=100;
const finiteAmount=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const unknownConcentration=reason=>({status:'unknown',reason,headCount:null,headShare:null,hhi:null,monetaryUnit:null});
function describeConcentration(snapshot,rows){
 const unit=snapshot.sourceCoverage?.monetaryUnit;
 if(rows.length!==snapshot.universeSize||rows.some(r=>!finiteAmount(r.amount)))
  return unknownConcentration('incomplete-universe-or-amounts');
 if(typeof unit!=='string'||!unit.trim()||rows.some(r=>['monetaryUnit','amountUnit'].some(k=>known(r,k)&&r[k]!==unit)))
  return unknownConcentration('missing-or-conflicting-monetary-unit');
 const amounts=rows.map(r=>r.amount).sort((a,b)=>b-a),total=amounts.reduce((s,n)=>s+n,0);
 if(!Number.isFinite(total)||total<=0)return unknownConcentration('nonpositive-or-invalid-total');
 const headCount=Math.ceil(rows.length/10);
 const shares=amounts.map(n=>n/total);
 return {status:'declared-unverified',reason:null,headCount,
  headShare:shares.slice(0,headCount).reduce((s,n)=>s+n,0),hhi:shares.reduce((s,n)=>s+n*n,0),monetaryUnit:unit};
}
function describeParticipation(snapshot,rows,{duplicateCount}={}){
 const base={status:'unknown',scope:'declared-universe-only',reason:null,
  universeSize:snapshot.universeSize,observed:rows.length,missing:snapshot.universeSize-rows.length,
  sampleMeanPct:null,sampleMedianPct:null,upShareBounds:null,downShareBounds:null,
  majority:'unknown',concentration:unknownConcentration('participation-unavailable'),canTrade:false,certified:false};
 if(duplicateCount>0)return {...base,status:'conflict',reason:'duplicate-security-identity'};
 // Never use a coerced numeric code, conflicting alias, or explicitly mixed
 // scope to make a new participation claim; retain legacy descriptive output.
 if(rows.some(r=>{
  const code=r.code??r.symbol;
  return typeof code!=='string'||!CODE.test(code)||
   (known(r,'code')&&known(r,'symbol')&&r.code!==r.symbol)||
   ['date','tradeDate'].some(k=>known(r,k)&&r[k]!==snapshot.date)||
   (known(r,'source')&&r.source!==snapshot.source)||
   (known(r,'suspended')&&typeof r.suspended!=='boolean');
 }))return {...base,status:'conflict',reason:'security-identity-or-scope-conflict'};
 if(!rows.length||rows.length>snapshot.universeSize)return {...base,reason:'invalid-sample-size'};
 const values=rows.map(r=>r.pctChange).sort((a,b)=>a-b),n=values.length,total=snapshot.universeSize,missing=total-n;
 const up=values.filter(v=>v>0).length,down=values.filter(v=>v<0).length;
 // Missing rows may be up, down or flat; do not treat them as zero return.
 const bounds=count=>({lower:count/total,upper:(count+missing)/total});
 const majority=up>total/2?'majority-up':down>total/2?'majority-down':
  up+missing<=total/2&&down+missing<=total/2?'no-majority':'unknown';
 return {...base,status:missing?'partial-declared':'complete-declared',reason:null,
  sampleMeanPct:values.reduce((s,n)=>s+n,0)/n,
  sampleMedianPct:n%2?values[(n-1)/2]:(values[n/2-1]+values[n/2])/2,
  upShareBounds:bounds(up),downShareBounds:bounds(down),majority,
  concentration:describeConcentration(snapshot,rows)};
}
/** Optional internal research comparison. No HTTP/production contract or policy
 * changes. Exact same session-return window and declared cutoff required. */
function describeIndexParticipation(snapshot,breadth,timing,index){
 const base={status:'unknown',relation:'unknown',reason:null,indexCode:null,indexReturnPct:null,
  scope:'declared-universe-only',marketAsOf:null,indexSource:null,indexObservedAt:null,indexKnownAt:null,certified:false,canTrade:false};
 const fail=reason=>({...base,reason});
 if(!index||typeof index!=='object'||Array.isArray(index))return fail('index-return-unavailable');
 const p=breadth.participation;
 if(!p||!['partial-declared','complete-declared'].includes(p.status))return fail('participation-unavailable');
 if(timing.status!=='declared-aligned'||researchInstant(timing.marketAsOf)===null)return fail('market-cutoff-unconfirmed');
 const cutoff=timing.marketAsOf,decision=timing.decisionAt;
 if(snapshot.returnWindow!=='session-to-date'||index.returnWindow!==snapshot.returnWindow||index.tradeDate!==snapshot.date)
  return fail('inconsistent-return-window-or-date');
 const indexAt=researchInstant(index.asOf),observed=researchInstant(index.observedAt),knownAt=researchInstant(index.knownAt);
 const received=known(index,'receivedAt')?researchInstant(index.receivedAt):undefined;
 if(typeof index.code!=='string'||!index.code.trim()||typeof index.source!=='string'||!index.source.trim()||
  !validPct(index.returnPct)||indexAt!==cutoff||observed===null||knownAt===null||observed<indexAt||knownAt<observed||knownAt>decision||
  (received!==undefined&&(received===null||received<observed||received>knownAt))||
  (known(index,'date')&&index.date!==snapshot.date))
  return fail('index-evidence-invalid-or-misaligned');
 // Reuse the original quote-time semantics (90 seconds). Require every row
 // contributing to this comparison to be recent; missing universe rows still
 // enter the conservative majority bounds. No vendor authenticity implied.
 if(snapshot.stocks.length!==breadth.observed||snapshot.stocks.some(row=>
  classifyQuoteTime(row,{requestDate:snapshot.date,retrievedAt:cutoff}).quoteTimeStatus!=='recent-source-unverified'))
  return fail('observed-quote-time-coverage-insufficient');
 const identity={indexCode:index.code,indexReturnPct:index.returnPct,marketAsOf:cutoff,indexSource:index.source,indexObservedAt:observed,indexKnownAt:knownAt};
 if(p.majority==='unknown')return {...base,...identity,reason:'missing-rows-could-change-majority'};
 const relation=index.returnPct>0&&p.majority==='majority-down'?'index-up-majority-down':
  index.returnPct<0&&p.majority==='majority-up'?'index-down-majority-up':
  index.returnPct>0&&p.majority==='majority-up'?'index-up-majority-up':
  index.returnPct<0&&p.majority==='majority-down'?'index-down-majority-down':
  index.returnPct===0?'index-flat':'no-majority';
 return {...base,...identity,status:'declared-unverified',relation};
}
module.exports={describeParticipation,describeIndexParticipation};
