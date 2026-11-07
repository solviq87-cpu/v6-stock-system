'use strict';
// Immutable, point-in-time signal snapshots and retrospective research outcomes.
// NO auto-weight changes, brokerage orders or live alerts.
const crypto=require('node:crypto');
const {validateHistoricalBars}=require('./feed-quality');
const {assessDailyBarFinality}=require('../core/a-share-calendar');
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function dateOk(d){return typeof d==='string'&&DATE.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;}
const fingerprint=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const horizons=[1,3,5,10];
function freezeSignals({items=[],stocks=[],journal=[],now=Date.now(),strategyVersion='v6-research-only'}={}){
 if(!Array.isArray(items)||items.length>10000||!Array.isArray(stocks)||stocks.length>10000||
  !Array.isArray(journal)||journal.length>300000||!Number.isFinite(now)||now<=0)throw TypeError('研究日志输入无效');
 const today=new Date(now+8*3600000).toISOString().slice(0,10),byCode=new Map();
 for(const s of stocks){const code=String(s?.symbol||s?.code||'');if(/^\d{6}$/.test(code)&&!byCode.has(code))byCode.set(code,s);}
 const known=new Set(journal.map(x=>x.id).filter(x=>typeof x==='string'));
 const added=[];
 for(const item of items){
  const code=String(item?.symbol||''),stock=byCode.get(code),bars=stock?.bars;
  if(!/^\d{6}$/.test(code)||!Array.isArray(bars)||bars.length<2||!item?.patterns?.usable)continue;
  const checked=validateHistoricalBars(bars,{requireDates:true});
  if(!checked.usable)continue;
  const end=bars.at(-1),date=end.date;
  if(!dateOk(date)||date>today||!Number.isFinite(end.close)||end.close<=0||!item.quality?.usable)continue;
  if(!assessDailyBarFinality(date,{observedAt:item.quality.timestamp,now}).usable)continue;
  const names=(item.patterns?.matched||[]).filter(x=>x?.status==='matched'&&x.side==='bullish')
    .map(x=>String(x.id||'')).filter(Boolean).sort();
  if(!names.length)continue;
  const observedAt=item.quality.timestamp;
  if(typeof observedAt!=='number'||!Number.isFinite(observedAt)||observedAt<=0||observedAt>now)continue;
  // Event key is stable across replays. Never include user portfolio or broker details.
  const id=fingerprint({code,date,strategyVersion,names}).slice(0,32);
  if(known.has(id))continue;
  known.add(id);
  added.push({id,schemaVersion:1,code,date,strategyVersion,
   names,signalCount:names.length,price:end.close,
   source:String(item.quality.source||'unknown').slice(0,80),observedAt,
   researchOnly:true,blockedBySafety:!!item.blockedBySafety,
   riskCount:item.patterns?.riskCount||0,issuerRiskClues:item.issuerEvidence?.riskClues?.length||0,
   issuerVerified:false,scoreBonus:0});
 }
 return {schemaVersion:1,mode:'research-only',asOf:now,added,journal:[...journal,...added],
  canTrade:false,note:'按信号发生时点冻结，不用未来价格判定是否入池；研究日志不含持仓隐私'};
}
function evaluateForwardOutcomes({journal=[],stocks=[],now=Date.now(),maxSignals=100000}={}){
 if(!Array.isArray(journal)||journal.length>maxSignals||!Array.isArray(stocks)||stocks.length>20000||!Number.isFinite(now)||now<=0)
  throw TypeError('研究结果输入无效');
 const today=new Date(now+8*3600000).toISOString().slice(0,10),indexed=new Map();
 for(const stock of stocks){
  const code=String(stock?.symbol||stock?.code||''),rows=stock?.bars;
  if(!/^\d{6}$/.test(code)||!Array.isArray(rows)||rows.length<2||
    !validateHistoricalBars(rows,{requireDates:true}).usable)continue;
  indexed.set(code,rows.filter(x=>dateOk(x.date)&&x.date<=today));
 }
 const outcomes=[];
 for(const e of journal){
  const rows=indexed.get(e?.code);
  if(!rows||!dateOk(e.date)||e.date>today||!Number.isFinite(e.price)||e.price<=0)continue;
  const at=rows.findIndex(x=>x.date===e.date);
  if(at<0)continue;
  for(const days of horizons){
   const future=rows[at+days];
   if(!future||future.date<=e.date||!assessDailyBarFinality(future.date,{observedAt:now,now}).usable)continue;
   const window=rows.slice(at+1,at+days+1);
   const low=Math.min(...window.map(x=>x.low)),high=Math.max(...window.map(x=>x.high));
   outcomes.push({signalId:e.id,code:e.code,date:e.date,exitDate:future.date,horizon:days,
    returnPct:+((future.close/e.price-1)*100).toFixed(4),
    maxAdversePct:+((low/e.price-1)*100).toFixed(4),
    maxFavorablePct:+((high/e.price-1)*100).toFixed(4),
    evidence:'historical-close, pre-cost',canTrade:false});
  }
 }
 const metrics={};
 for(const days of horizons){
  const group=outcomes.filter(o=>o.horizon===days);
  metrics[days]={evaluated:group.length,averageReturnPct:group.length?
    +(group.reduce((s,x)=>s+x.returnPct,0)/group.length).toFixed(4):null,
    winRate:group.length?+(100*group.filter(x=>x.returnPct>0).length/group.length).toFixed(2):null,
    meanAdversePct:group.length?+(group.reduce((s,x)=>s+x.maxAdversePct,0)/group.length).toFixed(4):null};
 }
 return {mode:'research-only',asOf:now,outcomes,metrics,horizons,
  limitations:['未经交易费用、流动性和涨跌停可成交性模拟','未通过独立样本外对照，不得据此自动修改正式评分','未来尚未出现的交易日不生成结果']};
}
module.exports={freezeSignals,evaluateForwardOutcomes,horizons};
