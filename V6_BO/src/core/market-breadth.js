'use strict';
/** Derive observed A-share breadth from an explicitly sourced, dated universe.
 * Never substitute neutral/synthetic values when coverage is insufficient. */
const {aShareCalendarDate}=require('./a-share-calendar');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const CODE=/^\d{6}$/;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(Date.parse(s)).toISOString().slice(0,10)===s;
function comparableReturn(stock) {
 return typeof stock?.pctChange === 'number' && Number.isFinite(stock.pctChange) &&
   stock.pctChange >= -100 && stock.pctChange <= 100 && stock.suspended !== true;
}
function analyzeMarketBreadth(snapshot, options={}){
 const minCoverage=options.minCoverage??0.8;
 if(!Number.isFinite(minCoverage)||minCoverage<=0||minCoverage>1)throw Error('minCoverage须为(0,1]之间的有限数字');
 const {date,source,universeSize,stocks}=snapshot||{};
 if(!validDate(date)||typeof source!=='string'||!source.trim()||!Array.isArray(stocks)||!Number.isInteger(universeSize)||universeSize<1)
  return {usable:false,reason:'缺少可信日期、来源、股票列表或市场总数'};
 const today=aShareCalendarDate(options.asOf??Date.now());
 if(date>today)return {usable:false,reason:'快照日期位于未来',date,source};
 const seen=new Set();let up=0,down=0,flat=0,limitUp=0,limitDown=0,amount=0,invalid=0;
 for(const stock of stocks){
  const code=String(stock?.code??stock?.symbol??'');
  const change=stock?.pctChange;
  if(!CODE.test(code)||seen.has(code)||!comparableReturn(stock)){invalid++;continue;}
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
  breadthScore:+(100*up/observed).toFixed(2),advanceDeclineRatio:down===0?null:+(up/down).toFixed(4),
  warning:'涨跌停数量只统计来源明确标记的股票；成交额为有效记录汇总，不代表交易所认证全市场成交额'};
}
// Current cross-section for the research terminal. Keep it separate from the
// existing request-date breadth, which can describe an older market snapshot.
function summarizeRecentStructure(snapshot, minCoverage = 0.8) {
 const asOf = Date.parse(snapshot?.retrievedAt);
 const stocks = Array.isArray(snapshot?.stocks) ? snapshot.stocks : [];
 const {date, source, universeSize} = snapshot || {};
 const counts = new Map();
 for (const stock of stocks) {
   const code = stock?.code ?? stock?.symbol;
   counts.set(code, (counts.get(code) || 0) + 1);
 }
 const rows = [];
 const usableHeader = Number.isSafeInteger(asOf) && asOf > 0 && validDate(date) &&
   date === aShareCalendarDate(asOf) && typeof source === 'string' && source.trim() &&
   Number.isSafeInteger(universeSize) && universeSize > 0 && counts.size <= universeSize;
 if (usableHeader) {
   for (const stock of stocks) {
     const code = stock?.code ?? stock?.symbol;
     if (typeof code !== 'string' || !CODE.test(code) || counts.get(code) !== 1 || !comparableReturn(stock)) continue;
     const time = classifyQuoteTime(stock, {requestDate: date, retrievedAt: asOf});
     if (time.quoteTimeStatus === 'recent-source-unverified') rows.push(stock);
   }
 }
 const observed = rows.length;
 const amounts = rows.map(stock => stock.amount).filter(value => Number.isFinite(value) && value >= 0);
 const coverage = usableHeader ? observed / universeSize : null;
 const summary = {
   source, date, asOf: Number.isFinite(asOf) ? asOf : null, universeSize, observed, coverage,
   amountObserved: amounts.length, oldestQuoteAt: null, newestQuoteAt: null,
   minCoverage, quoteWindowMs: 90000, medianReturnPct: null, equalWeightReturnPct: null,
   upShare: null, turnoverHHI: null, status: 'insufficient-coverage', canTrade: false
 };
 if (!usableHeader || !observed || coverage < minCoverage) return summary;
 const changes = rows.map(stock => stock.pctChange).sort((a, b) => a - b);
 const times = rows.map(stock => stock.vendorQuoteAt);
 const amount = amounts.reduce((sum, value) => sum + value, 0);
 return {
   ...summary, status: 'observed-unverified',
   oldestQuoteAt: Math.min(...times), newestQuoteAt: Math.max(...times),
   medianReturnPct: (changes[Math.floor((observed - 1) / 2)] + changes[Math.floor(observed / 2)]) / 2,
   equalWeightReturnPct: changes.reduce((sum, value) => sum + value, 0) / observed,
   upShare: changes.filter(value => value > 0).length / observed,
   turnoverHHI: amounts.length === universeSize && Number.isFinite(amount) && amount > 0
     ? amounts.reduce((sum, value) => sum + (value / amount) ** 2, 0) : null
 };
}
module.exports={analyzeMarketBreadth,summarizeRecentStructure};
