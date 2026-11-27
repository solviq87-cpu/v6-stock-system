'use strict';
/** Derive observed A-share breadth from an explicitly sourced, dated universe.
 * Never substitute neutral/synthetic values when coverage is insufficient. */
const {aShareCalendarDate}=require('./a-share-calendar');
const CODE=/^\d{6}$/;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(Date.parse(s)).toISOString().slice(0,10)===s;
// Keep the original display counters, but qualify decision coverage separately.
// A first-seen copy of contradictory evidence must not drive market inference.
const fakeSource=s=>typeof s==='string'&&/(?:simulat|synthetic|fixture|mock|demo|(?:^|[-_:])test(?:$|[-_:]))/i.test(s);
const artificial=x=>['synthetic','simulated','mock','fixture','testSample'].some(k=>x?.[k]===true);
const conflict=x=>['sourceConflict','quoteSourceConflict','conflict'].some(k=>x?.[k]===true)||x?.evidenceStatus==='conflict'||x?.quoteStatus==='conflict';
const identityFields=['code','symbol','pctChange','amount','limitUp','limitDown','vendorQuoteAt','source','provider','latestPrice','volumeLots'];
function qualifyDecisionBreadth(snapshot,minCoverage){
 const accepted=new Map(),rejected=new Set();
 for(const row of snapshot.stocks){
  const id=row?.code??row?.symbol;
  if(typeof id!=='string'||!CODE.test(id)||rejected.has(id))continue;
  const prior=accepted.get(id);
  const valid=!(row.code!=null&&row.symbol!=null&&row.code!==row.symbol)&&
   typeof row.pctChange==='number'&&Number.isFinite(row.pctChange)&&row.pctChange>=-100&&row.pctChange<=100&&
   row.suspended!==true&&row.tradable!==false&&!artificial(row)&&!conflict(row)&&
   (row.source==null||row.source===snapshot.source)&&!(row.limitUp===true&&row.limitDown===true);
  if(!valid||prior&&identityFields.some(k=>!Object.is(prior[k]??null,row[k]??null))){
   accepted.delete(id);rejected.add(id);continue;
  }
  if(!prior)accepted.set(id,row);
 }
 const sourceOK=!artificial(snapshot)&&!conflict(snapshot)&&!fakeSource(snapshot.source);
 const qualifiedObserved=sourceOK?accepted.size:0,coverage=qualifiedObserved/snapshot.universeSize;
 const decisionUsable=qualifiedObserved>0&&coverage>=minCoverage&&qualifiedObserved<=snapshot.universeSize;
 const up=sourceOK?[...accepted.values()].filter(r=>r.pctChange>0).length:0;
 return {qualifiedObserved,decisionCoverage:+coverage.toFixed(4),rejectedDecisionSymbols:rejected.size,
  decisionUsable,decisionBreadthScore:decisionUsable?+(100*up/qualifiedObserved).toFixed(2):null,
  decisionMissingReason:decisionUsable?null:sourceOK?'qualified-market-coverage-insufficient':'unqualified-market-source'};
}
function analyzeMarketBreadth(snapshot, options={}){
 const minCoverage=options.minCoverage??0.8;
 if(!Number.isFinite(minCoverage)||minCoverage<=0||minCoverage>1)throw Error('minCoverage须为(0,1]之间的有限数字');
 const {date,source,universeSize,stocks}=snapshot||{};
 if(!validDate(date)||typeof source!=='string'||!source.trim()||!Array.isArray(stocks)||!Number.isSafeInteger(universeSize)||universeSize<1)
  return {usable:false,reason:'缺少可信日期、来源、股票列表或市场总数'};
 const today=aShareCalendarDate(options.asOf??Date.now());
 if(date>today)return {usable:false,reason:'快照日期位于未来',date,source};
 const seen=new Set();let up=0,down=0,flat=0,limitUp=0,limitDown=0,amount=0,invalid=0;
 for(const stock of stocks){
  const code=String(stock?.code??stock?.symbol??'');
  const change=stock?.pctChange;
  if(!CODE.test(code)||seen.has(code)||typeof change!=='number'||!Number.isFinite(change)||change < -100||change>100||stock.suspended===true){invalid++;continue;}
  seen.add(code);
  if(change>0)up++;else if(change<0)down++;else flat++;
  if(stock.limitUp===true)limitUp++;
  if(stock.limitDown===true)limitDown++;
  if(typeof stock.amount==='number'&&Number.isFinite(stock.amount)&&stock.amount>=0)amount+=stock.amount;
 }
 const observed=seen.size,coverage=observed/universeSize;
 if(observed>universeSize)return {usable:false,reason:'有效股票数超过市场总数',date,source,observed,universeSize};
 if(coverage<minCoverage)return {usable:false,reason:'市场覆盖率不足',date,source,observed,universeSize,coverage:+coverage.toFixed(4),invalid};
 return {usable:true,date,source,observed,universeSize,coverage:+coverage.toFixed(4),invalid,up,down,flat,limitUp,limitDown,observedAmount:amount,
  ...qualifyDecisionBreadth(snapshot,minCoverage),
  breadthScore:+(100*up/observed).toFixed(2),advanceDeclineRatio:down===0?null:+(up/down).toFixed(4),
  warning:'涨跌停数量只统计来源明确标记的股票；成交额为有效记录汇总，不代表交易所认证全市场成交额'};
}
module.exports={analyzeMarketBreadth};
