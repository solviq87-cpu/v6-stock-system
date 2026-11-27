'use strict';
/** Point-in-time checks for existing read-only market research. Declared
 * timestamps can establish consistency, never provider authenticity. */
const {aShareCalendarDate}=require('./a-share-calendar');
const MIN=Date.UTC(1990,0,1),MAX=Date.UTC(2100,0,1);
function researchInstant(value){
 let t=value;
 if(value instanceof Date)t=value.getTime();
 else if(typeof value==='string'){
  const m=/^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if(!m)return null;
  const day=Date.parse(m[1]+'T00:00:00Z');
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==m[1])return null;
  t=Date.parse(value);
 }
 return Number.isSafeInteger(t)&&t>=MIN&&t<MAX?t:null;
}
const declared=(x,k)=>x?.[k]!==undefined&&x[k]!==null;
function assessObservedTiming(snapshot,scores,cutoff){
 const base={status:'unknown',decisionAt:cutoff,marketAsOf:null,scoreAsOf:null,
  providerTimeCount:0,providerTimeCoverage:null,certified:false,canTrade:false};
 const fail=reason=>({...base,status:'blocked',reason});
 if(researchInstant(cutoff)===null)return fail('研究决策时钟无效');
 const day=snapshot.date;
 const parse=(record,keys,label)=>{
  const out={};
  for(const key of keys){
   if(!declared(record,key))continue;
   const t=researchInstant(record[key]);
   if(t===null||t>cutoff)throw Error(label+'.'+key+' 无效或晚于决策截点');
   out[key]=t;
  }
  return out;
 };
 const ordered=(a,b,label)=>{
  if(a!==undefined&&b!==undefined&&a>b)throw Error(label+' 时序倒置');
 };
 const onDay=(t,label)=>{
  if(t!==undefined&&aShareCalendarDate(t)!==day)throw Error(label+' 与市场日期不一致');
 };
 const observed=['asOf','observedAt','receivedAt','knownAt'];
 const chronology=(v,label)=>{
  // A missing intermediate stamp does not excuse a reversed known pair.
  for(let i=0;i<observed.length;i++)for(let j=i+1;j<observed.length;j++)
   ordered(v[observed[i]],v[observed[j]],label);
  onDay(v.asOf,label+'.asOf');
  for(const k of observed.slice(1))if(v[k]!==undefined&&aShareCalendarDate(v[k])<day)
   throw Error(label+'.'+k+' 早于市场日期');
 };
 try{
  const m=parse(snapshot,[...observed,'startedAt','retrievedAt'],'snapshot');
  const s=parse(scores,observed,'scores');
  chronology(m,'snapshot');chronology(s,'scores');
  onDay(m.startedAt,'snapshot.startedAt');
  if(m.startedAt!==undefined)onDay(m.retrievedAt,'snapshot.retrievedAt');
  if(m.retrievedAt!==undefined&&aShareCalendarDate(m.retrievedAt)<day)throw Error('快照接收早于市场日期');
  ordered(m.startedAt,m.retrievedAt,'快照采样');
  if(m.startedAt!==undefined&&m.retrievedAt!==undefined&&m.retrievedAt-m.startedAt>120000)
   throw Error('快照采样超过原两分钟上限');
  if(declared(snapshot,'samplingDurationMs')){
   const duration=snapshot.samplingDurationMs;
   if(!Number.isSafeInteger(duration)||duration<0||duration>120000||
    (m.startedAt!==undefined&&m.retrievedAt!==undefined&&duration!==m.retrievedAt-m.startedAt))
    throw Error('声明采样跨度与原时点不一致');
  }
  ordered(m.asOf,m.retrievedAt,'快照数据与接收');
  ordered(m.observedAt,m.retrievedAt,'快照观察与接收');
  ordered(m.retrievedAt,m.receivedAt,'快照接收');
  ordered(m.retrievedAt,m.knownAt,'快照可知');
  if(m.asOf!==undefined&&s.asOf!==undefined&&m.asOf!==s.asOf)
   throw Error('市场快照与独立评分的数据截点不一致');
  if(m.asOf===undefined&&s.asOf!==undefined){
   ordered(m.startedAt,s.asOf,'评分与快照采样');
   ordered(s.asOf,m.observedAt,'评分与快照观察');
   ordered(s.asOf,m.retrievedAt,'评分与快照采样');
  }
  for(const key of ['date','tradeDate'])if(declared(scores,key)&&scores[key]!==day)
   throw Error('独立评分内部日期与市场日期不一致');
  const sourceCutoff=m.asOf??m.observedAt??m.retrievedAt??cutoff;
  let count=0;
  for(const row of snapshot.stocks){
   // f124 was normalized upstream to epoch milliseconds. Other timestamp
   // representations are not legal for this provider-specific field.
   if(declared(row,'vendorQuoteAt')&&(!Number.isSafeInteger(row.vendorQuoteAt)||row.vendorQuoteAt<946684800000))
    throw Error('原始供应商报价时点不是合法毫秒值');
   const r=parse(row,[...observed,'vendorQuoteAt'],'stock');
   chronology(r,'stock');
   onDay(r.vendorQuoteAt,'原始报价');
   ordered(r.vendorQuoteAt,r.asOf,'原始报价与逐股截点');
   ordered(r.vendorQuoteAt,r.observedAt,'原始报价与观察');
   ordered(r.vendorQuoteAt,r.receivedAt,'原始报价与接收');
   ordered(r.vendorQuoteAt,r.knownAt,'原始报价与可知');
   ordered(r.vendorQuoteAt,sourceCutoff,'原始报价与市场截点');
   ordered(r.asOf,sourceCutoff,'逐股与市场截点');
   ordered(r.observedAt,m.retrievedAt,'逐股观察与快照接收');
   ordered(r.receivedAt,m.retrievedAt,'逐股接收与快照接收');
   ordered(r.knownAt,m.knownAt??m.retrievedAt,'逐股可知与快照可知');
   if(r.vendorQuoteAt!==undefined&&row?.suspended!==true&&typeof row?.pctChange==='number'&&Number.isFinite(row.pctChange)&&row.pctChange>=-100&&row.pctChange<=100&&/^\d{6}$/.test(String(row.code??row.symbol??'')))count++;
  }
  const aligned=m.asOf!==undefined&&m.asOf===s.asOf&&m.observedAt!==undefined&&
   (m.knownAt!==undefined||m.retrievedAt!==undefined)&&s.observedAt!==undefined&&s.knownAt!==undefined;
  return {...base,status:aligned?'declared-aligned':'unknown',marketAsOf:m.asOf??null,
   scoreAsOf:s.asOf??null,providerTimeCount:count,providerTimeCoverage:count/snapshot.universeSize,
   reason:aligned?'声明的截点一致，仍未经数据来源认证':'缺少完整的观察、可知或统一截点；仅保留旧研究分类'};
 }catch(e){return fail(e.message);}
}
module.exports={researchInstant,assessObservedTiming};
