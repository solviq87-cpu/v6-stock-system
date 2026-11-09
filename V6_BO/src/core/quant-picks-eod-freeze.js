'use strict';
// Research-only bridge: same-day cached /api/quant-picks + separately imported
// *closed* daily prices -> new immutable forward cohort. Never backdate a signal.
const crypto=require('node:crypto');
const {freezeCohort,evaluateForward}=require('./forward-signal-observer');
const MAX_AGE_MS=5*60*1000;
const closedAt=day=>Date.parse(day+'T16:00:00+08:00');
const shanghaiDay=epoch=>new Date(epoch+8*60*60*1000).toISOString().slice(0,10);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const identity=parts=>crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');

function freezeCurrentPicks(candidates,market,{now=Date.now()}={}){
 if(!finite(now)||!Number.isSafeInteger(now)||now<=0)throw Error('冻结时钟无效');
 if(!candidates||candidates.locked===true||candidates.ok===false||
    candidates.isMock===true||candidates.simulated===true||
    !Number.isSafeInteger(candidates.asOf)||candidates.asOf<=0||
    !['all','main','gem'].includes(candidates.board)||
    !Number.isSafeInteger(candidates.totalScanned)||candidates.totalScanned<1||
    !Number.isSafeInteger(candidates.count)||candidates.count<1||
    !Array.isArray(candidates.items)||candidates.items.length<1||
    candidates.items.length>500||candidates.count<candidates.items.length)
  throw Error('必须提供当日实际选股快照，禁止锁定或演示结果');
 const snapshotDay=shanghaiDay(candidates.asOf),freezeDay=shanghaiDay(now);
 if(snapshotDay!==freezeDay||candidates.asOf>now||now-candidates.asOf>MAX_AGE_MS||
    candidates.asOf<closedAt(snapshotDay)||now<closedAt(snapshotDay))
  throw Error('选股快照必须为同一交易日16:00后最近5分钟生成，禁止历史补造信号');
 if(!market||market.schemaVersion!==1||!validDay(market.asOf)||
    market.asOf!==snapshotDay||!market.feed||market.feed.source!=='imported'||
    market.feed.priceBasis!=='unadjusted'||!Number.isSafeInteger(market.observedAt)||
    market.observedAt<closedAt(snapshotDay)||market.observedAt>now)
  throw Error('需要同日收盘后授权导入的未复权行情快照');
 if(!Array.isArray(market.stocks)||!Array.isArray(market.calendar)||
    !market.calendar.includes(snapshotDay))
  throw Error('缺少显式交易日历和收盘证据');
 const stockRows=new Map();
 for(const stock of market.stocks){
  if(!stock||typeof stock.symbol!=='string'||stockRows.has(stock.symbol)||
    !Array.isArray(stock.bars))throw Error('行情股票代码重复或行记录无效');
  stockRows.set(stock.symbol,stock);
 }
 const codes=new Set(),ids=new Set(),signals=[];
 for(const item of candidates.items){
  if(!item||typeof item.code!=='string'||!/^\d{6}$/.test(item.code)||
     codes.has(item.code)||!Array.isArray(item.hit)||item.hit.length<1||item.hit.length>30)
   throw Error('候选股代码重复或未返回原始命中条件');
  codes.add(item.code);
  const stock=stockRows.get(item.code);
  const baseline=stock?.bars.find(row=>row?.date===snapshotDay);
  if(!baseline||!finite(baseline.close)||baseline.close<=0||
     !Number.isSafeInteger(baseline.volume)||baseline.volume<=0||baseline.suspended!==false)
   throw Error('候选股缺少同日收盘价/成交量或处于停牌，不能冻结');
  const hits=new Set();
  for(const hit of item.hit){
   if(!hit||!Number.isSafeInteger(hit.id)||hit.id<1||hit.id>6||
      hits.has(hit.id)||typeof hit.text!=='string'||!hit.text.trim()||
      hit.text.length>220)
    throw Error('候选股命中条件ID/证据无效或重复');
   hits.add(hit.id);
   // One independent observation per complete matched condition, even for
   // the same symbol. "manual" labels the external snapshot bridge, not
   // one of the unchanged formally approved strategy engines.
   const signalId='quant-picks-'+identity([snapshotDay,candidates.asOf,item.code,hit.id,hit.text]);
   if(ids.has(signalId))throw Error('同一冻结信号ID重复');
   ids.add(signalId);
   signals.push({
    signalId,symbol:item.code,system:'manual',cohort:'量化选股条件'+hit.id,
    provenance:('quant-picks '+snapshotDay+' '+candidates.asOf+'：'+hit.text).slice(0,200),
    signalDate:snapshotDay,signalAt:now,baselineClose:baseline.close
   });
  }
  if(item.hitIds!==undefined&&(!Array.isArray(item.hitIds)||
     item.hitIds.length!==hits.size||item.hitIds.some(id=>!hits.has(id))))
   throw Error('命中条件ID与命中理由不一致');
 }
 if(signals.length>500)throw Error('命中信号超过500条，禁止静默截断');
 const cohort=freezeCohort({schemaVersion:1,feed:market.feed,signals},{now});
 // Validate the whole supplied historical/closed market contract (including
 // baseline match and calendar) before the immutable signal is published.
 // Results here are intentionally discarded: not a verified outcome.
 evaluateForward(cohort,market,{now});
 return cohort;
}
module.exports={freezeCurrentPicks,MAX_AGE_MS};
