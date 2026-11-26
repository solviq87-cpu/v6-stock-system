'use strict';
// Use the existing same-stock/date frozen evidence contract. Never infer a
// consecutive-board count from OHLC, a score, a missing field or today's data.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const dayOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
function instant(v){
 if(Number.isSafeInteger(v)&&v>0&&v<8e15)return v;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!dayOK(v.slice(0,10)))return null;
 const n=Date.parse(v);return Number.isSafeInteger(n)&&n>0&&n<8e15?n:null;
}
const clocks=['knownAt','availableAt','receivedAt','recordedAt','observedAt','sourceTimestamp'];
const stockFields=['floatCap','amount','sealAmount','limitUpCount','breakCount','preClose','amountUnit','currency'];
const sections=['sector','auction','profitRatio','lhb','aucTicks'];
function declaredTimes(row){return clocks.filter(k=>Object.hasOwn(row,k)).map(k=>instant(row[k]));}
function projectFourteenEvidence(snapshot,{symbol,date,cutoff,allowSynthetic=false}={}){
 const e=snapshot?.fourteenEvidence;
 if(!object(snapshot)||!object(e)||!dayOK(date)||typeof symbol!=='string'||!/^\d{6}$/.test(symbol)||
    snapshot.symbol!==symbol||snapshot.observedThrough!==date||e.symbol!==symbol||e.date!==date||
    typeof e.source!=='string'||!e.source.trim()||e.source.length>160||
    !Number.isSafeInteger(cutoff)||cutoff<=0||!object(e.stock))return null;
 const start=Date.parse(date+'T00:00:00+08:00'),end=Math.min(cutoff,Date.parse(date+'T23:59:59.999+08:00'));
 const known=instant(e.knownAt),parent=declaredTimes(snapshot),times=declaredTimes(e);
 if(known===null||known<start||known>end||parent.some(x=>x===null||x>end)||
    times.some(x=>x===null||x>end)||parent.length&&Math.max(...times)>Math.max(...parent))return null;
 if(Object.keys(e.stock).some(k=>!stockFields.includes(k)))return null;
 if(Object.hasOwn(e,'observedThrough')&&e.observedThrough!==date)return null;
 let visited=0;
 function inspect(v,depth=0){
  if(v==null||typeof v!=='object')return true;
  if(++visited>200||depth>6)return false;
  if(Array.isArray(v))return v.every(x=>inspect(x,depth+1));
  if(!allowSynthetic&&(['simulated','synthetic','mock','testSample','isTest'].some(k=>v[k]===true)||['test','demo','fixture'].includes(v.sampleSet)))return false;
  if(v.retracted===true||v.superseded===true)return false;
  for(const k of ['symbol','code'])if(v[k]!=null&&v[k]!==symbol)return false;
  for(const k of ['date','tradeDate','observedThrough'])if(v[k]!=null&&v[k]!==date)return false;
  if(declaredTimes(v).some(t=>t===null||t>end||t>Math.max(...times)))return false;
  return Object.values(v).every(x=>inspect(x,depth+1));
 }
 if(!inspect(e))return null;
 return {stock:Object.fromEntries(stockFields.filter(k=>Object.hasOwn(e.stock,k)).map(k=>[k,e.stock[k]])),
  sections:Object.fromEntries(sections.filter(k=>Object.hasOwn(e,k)).map(k=>[k,e[k]])),
  source:e.source,knownAt:known};
}
module.exports={projectFourteenEvidence};
