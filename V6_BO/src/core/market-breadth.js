'use strict';
/** Derive observed A-share breadth from an explicitly sourced, dated universe.
 * Never substitute neutral/synthetic values when coverage is insufficient. */
const {aShareCalendarDate}=require('./a-share-calendar');
const {describeParticipation}=require('./market-participation');
const CODE=/^\d{6}$/;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(Date.parse(s)).toISOString().slice(0,10)===s;
function analyzeMarketBreadth(snapshot, options={}){
 const minCoverage=options.minCoverage??0.8;
 if(!Number.isFinite(minCoverage)||minCoverage<=0||minCoverage>1)throw Error('minCoverage须为(0,1]之间的有限数字');
 const {date,source,universeSize,stocks}=snapshot||{};
 if(!validDate(date)||typeof source!=='string'||!source.trim()||!Array.isArray(stocks)||!Number.isInteger(universeSize)||universeSize<1)
  return {usable:false,reason:'缺少可信日期、来源、股票列表或市场总数'};
 const today=aShareCalendarDate(options.asOf??Date.now());
 if(date>today)return {usable:false,reason:'快照日期位于未来',date,source};
 const seen=new Set(),identities=new Set(),accepted=[];
 let up=0,down=0,flat=0,limitUp=0,limitDown=0,amount=0,invalid=0;
 let duplicateCount=0,amountObservedCount=0,limitUpKnownCount=0,limitDownKnownCount=0;
 for(const stock of stocks){
  const code=String(stock?.code??stock?.symbol??'');
  // Keep the legacy first-valid-row descriptive aggregate, but disclose
  // duplicates even when one record is invalid/suspended or comes first.
  if(CODE.test(code)){
   if(identities.has(code))duplicateCount++;
   identities.add(code);
  }
  const change=stock?.pctChange;
  if(!CODE.test(code)||seen.has(code)||typeof change!=='number'||!Number.isFinite(change)||change < -100||change>100||stock.suspended===true){invalid++;continue;}
  seen.add(code);accepted.push(stock);
  if(change>0)up++;else if(change<0)down++;else flat++;
  if(typeof stock.limitUp==='boolean')limitUpKnownCount++;
  if(typeof stock.limitDown==='boolean')limitDownKnownCount++;
  if(stock.limitUp===true)limitUp++;
  if(stock.limitDown===true)limitDown++;
  if(typeof stock.amount==='number'&&Number.isFinite(stock.amount)&&stock.amount>=0){
   amountObservedCount++;amount+=stock.amount;
  }
 }
 const observed=seen.size,coverage=observed/universeSize;
 if(observed>universeSize)return {usable:false,reason:'有效股票数超过市场总数',date,source,observed,universeSize};
 if(coverage<minCoverage)return {usable:false,reason:'市场覆盖率不足',date,source,observed,universeSize,coverage:+coverage.toFixed(4),invalid,duplicateCount};
 return {usable:true,date,source,observed,universeSize,coverage:+coverage.toFixed(4),invalid,duplicateCount,up,down,flat,limitUp,limitDown,
  limitUpKnownCount,limitDownKnownCount,amountObservedCount,amountCoverage:+(amountObservedCount/universeSize).toFixed(4),
  observedAmount:amountObservedCount>0&&Number.isFinite(amount)?amount:null,
  participation:describeParticipation(snapshot,accepted,{duplicateCount}),
  breadthScore:+(100*up/observed).toFixed(2),advanceDeclineRatio:down===0?null:+(up/down).toFixed(4),
  warning:'涨跌停数量只统计来源明确标记的股票，未知与明确否定须结合已知数；成交额为有效记录汇总，缺失或溢出为null，不代表交易所认证全市场成交额；重复记录仅供描述，禁止据此分类'};
}
module.exports={analyzeMarketBreadth};
