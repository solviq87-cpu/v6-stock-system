'use strict';
const {qualityScore}=require('./intelligence-research');
const {sourceLineage}=require('./data-source-lineage');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10);
const dayOf=value=>typeof value==='string'?value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):null;
const real=row=>row&&!['fixture','mock','synthetic','simulated','readOnlyBackup','imported'].some(key=>row[key]===true)&&
 !/fixture|mock|synthetic|simulated|demo/i.test(String(row.quoteSource||row.source||''));
function decisionQuality(row,gate,{day,now=Date.now(),history=null,config}={}){
 const source=row.quoteSource,quoteAt=row.quoteAt,receivedAt=row.receivedAt;
 const quoteKnown=real(row)&&typeof source==='string'&&source&&time(quoteAt)&&quoteAt<=now&&chinaDay(quoteAt)===day&&
  time(receivedAt)&&receivedAt>=quoteAt&&receivedAt<=now&&
  [row.tradeDate,row.sourceTradeDate,row.poolDay].filter(Boolean).every(value=>dayOf(value)===day);
 const reference={source:typeof source==='string'?source:null,sourceAt:quoteAt??null,knownAt:receivedAt??null,code:row.code,day};
 const fields=['price','preClose','open','high','low','volume','amount','pct','turnover','mktcap'];
 const presence=fields.map(field=>({field,present:finite(row[field])}));
 const maxAge=config?.quality?.maxAgeMs||15000;
 const components={
  realtime:{value:quoteKnown?Math.max(0,1-(now-quoteAt)/maxAge):null,
   evidence:{...reference,ageMs:quoteKnown?now-quoteAt:null,maxAgeMs:maxAge,method:'max(0, 1 − 原始报价年龄 / 15000ms)'}},
  completeness:{value:quoteKnown?presence.filter(item=>item.present).length/fields.length:null,
   evidence:{...reference,fields:presence,method:'原始报价十项明确数值的覆盖比例；缺值是缺项，不代填原始数值'}},
  consistency:{value:null,evidence:{source:'原多源交叉核验',checkedAt:gate?.checkedAt??null,missing:'需要至少两个独立且同日有效来源'}},
  continuity:{value:null,evidence:{source:history?.source||null,missing:'需要前复权原始日K、实际取得时间及最近20个已收盘交易日历'}},
  anomaly:{value:null,evidence:{...reference,missing:'需要完整开高低现价、前收、量额及其原始时点'}}
 };
 const evidence=Array.isArray(gate?.sourceEvidence)?gate.sourceEvidence:[];
 const checkedAt=typeof gate?.checkedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(gate.checkedAt)?Date.parse(gate.checkedAt):gate?.checkedAt;
 const groups=new Set(),identities=new Set();
 // Registry identities are declarations, not an external independence certificate.
 // No unknown source, repeated upstream or post-cutoff observation earns a Q vote.
 const independent=evidence.length>=2&&evidence.length<=8&&evidence.every(item=>{
  const lineage=sourceLineage(item?.source);
  if(!lineage?.known||lineage.upstreamAmbiguous||lineage.market!=='CN'||lineage.upstreamGroup!==item.upstreamGroup||
   identities.has(item.source)||groups.has(item.upstreamGroup)||typeof item.inConsensus!=='boolean')return false;
  identities.add(item.source);groups.add(item.upstreamGroup);return true;
 });
 const sourceDeviations=[];
 if(quoteKnown&&['observed-agreement','conflict'].includes(gate?.status)&&independent&&
  time(checkedAt)&&checkedAt<=now&&chinaDay(checkedAt)===day&&
  evidence.every(item=>finite(item.price)&&item.price>0&&finite(item.previousClose)&&item.previousClose>0&&
   time(item.quoteAt)&&item.quoteAt<=checkedAt&&now-item.quoteAt<=maxAge&&chinaDay(item.quoteAt)===day)){
  const median=key=>{const values=evidence.map(item=>item[key]).sort((a,b)=>a-b);return values[Math.floor(values.length/2)];};
  const price=median('price'),previousClose=median('previousClose');
  for(const item of evidence)sourceDeviations.push({...item,priceDeviationBps:Math.abs(item.price/price-1)*10000,
   previousCloseDeviationBps:Math.abs(item.previousClose/previousClose-1)*10000,reference:{price,previousClose,method:'独立有效来源中位数'}});
  components.consistency={value:gate.blocked?0:evidence.filter(item=>item.inConsensus).length/evidence.length,
   evidence:{source:'原多源交叉核验',checkedAt:gate.checkedAt,sources:sourceDeviations,
    method:'原容忍区间核对的独立来源一致比例；明确冲突为0，未知保持空'}};
 }
 const expected=history?.expectedDays,bars=history?.rows;
 if(history?.adjustment==='qfq'&&typeof history.source==='string'&&history.source&&time(history.knownAt)&&history.knownAt<=now&&
  typeof history.calendarSource==='string'&&history.calendarSource&&time(history.calendarKnownAt)&&history.calendarKnownAt<=now&&
  Array.isArray(expected)&&expected.length===20&&expected.every((value,index)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&value<=day&&
   (!index||expected[index-1]<value)&&Date.parse(value+'T15:00:00+08:00')<=now)&&Array.isArray(bars)&&bars.length<=500){
  const seen=new Set(),conflicts=new Set();
  for(const bar of bars){
   const date=dayOf(bar?.date),knownAt=bar?.knownAt??history.knownAt;
   // A K-line received during the session is still an intraday observation
   // after 15:00. Advancing the report clock cannot certify a closed daily bar.
   if(!expected.includes(date)||!['open','high','low','close'].every(key=>finite(bar[key])&&bar[key]>0)||
    bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close)||bar.high<bar.low||
    !time(knownAt)||knownAt>history.knownAt||knownAt>now||knownAt<Date.parse(date+'T15:00:00+08:00'))continue;
   if(seen.has(date))conflicts.add(date);seen.add(date);
  }
  for(const date of conflicts)seen.delete(date);
  components.continuity={value:seen.size/expected.length,evidence:{source:history.source,knownAt:history.knownAt,
   adjustment:'qfq',calendarSource:history.calendarSource,calendarKnownAt:history.calendarKnownAt,
   expectedDays:expected,observedDays:[...seen].sort(),missingDays:expected.filter(value=>!seen.has(value)),
   method:'最近20个已收盘交易日中，具备唯一完整、实际取得时点不早于该日收盘的原始日K比例；停牌缺条保持缺项'}};
 }
 if(quoteKnown&&['price','preClose','open','high','low','volume','amount'].every(key=>finite(row[key]))){
  const checks=[['positive-prices',['price','preClose','open','high','low'].every(key=>row[key]>0)],
   ['ordered-ohlc',row.low<=Math.min(row.open,row.price)&&row.high>=Math.max(row.open,row.price)&&row.high>=row.low],
   ['nonnegative-volume-amount',row.volume>=0&&row.amount>=0],['consistent-volume-amount',(row.volume===0)===(row.amount===0)]];
  components.anomaly={value:checks.filter(([,passed])=>passed).length/checks.length,
   evidence:{...reference,checks:checks.map(([id,passed])=>({id,passed})),method:'明确价格形态与量额一致性检查通过比例；不声称统计异常模型已认证'}};
 }
 const quality=qualityScore(components,config),missing=quality.components.filter(item=>item.value===null).map(item=>item.label);
 return {...gate,qScore:quality.score,quality,sourceDeviations,
  qReason:missing.length?'缺少'+missing.join('、')+'证据；不补零、不重分配权重':'五项均有可核对证据，按固定权重计算',
  formulaVersion:'fayo-decision-quality-v1',changesOriginalGates:false,canTrade:false};
}
module.exports={decisionQuality};
