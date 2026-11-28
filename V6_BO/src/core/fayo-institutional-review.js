'use strict';
// Segmentation over the original validated historical-security/fee evidence.
// No new history source, account, selection engine or release permission.
const rules=['board','limitPct','feeVersion','priceBasis'];
const MAX_TRANSITIONS=200,MAX_SEGMENTS=4,MAX_REPLAY_STOCK_BARS=20000,MIN_SESSIONS=20;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const dayOpen=x=>Date.parse(x+'T09:30:00+08:00');
const proof=m=>({source:m.source,dataVersion:m.dataVersion,knownAt:m.knownAt,availableAt:m.availableAt,evidenceHash:m.evidenceHash,board:m.board,limitPct:m.limitPct,feeVersion:m.feeVersion,priceBasis:m.priceBasis});
const valid=(r,d)=>r&&r.from<=d&&r.through>=d&&Number.isFinite(Date.parse(r.knownAt))&&Date.parse(r.knownAt)<=dayOpen(d)&&r.securityMaster&&
 Number.isFinite(Date.parse(r.securityMaster.knownAt))&&Number.isFinite(Date.parse(r.securityMaster.availableAt))&&Date.parse(r.securityMaster.knownAt)<=Date.parse(r.securityMaster.availableAt)&&Date.parse(r.securityMaster.availableAt)<=dayOpen(d)&&
 hash(r.securityMaster.evidenceHash)&&text(r.securityMaster.dataVersion)&&text(r.securityMaster.source)&&text(r.securityMaster.feeVersion)&&text(r.securityMaster.board)&&finite(r.securityMaster.limitPct)&&r.securityMaster.priceBasis==='unadjusted';
const diff=(a,b,keys)=>keys.filter(k=>!Object.is(a[k],b[k]));
const round=x=>finite(x)?Number(x.toFixed(6)):null;
function institutionalReview(history,{coverage,options,result,replay}={}){
 const requested=history?.institutionalReview===true;
 const base={schemaVersion:1,mode:'point-in-time-institutional-review',status:'unknown',requested,ruleChangeCount:0,versionTransitionCount:0,securityStateTransitionCount:0,breakCount:0,transitions:[],segments:[],replayAttempts:0,reviewedSegments:0,
  verifiedExternal:false,causalEffect:null,productionWeightsChanged:false,releaseEligible:false,canTrade:false,reviewLimit:MAX_SEGMENTS,minSessions:MIN_SESSIONS,
  note:'仅原提交的逐证券、逐日制度及费用证据。制度版本变化与真实规则变化分开。原连续回测的跨断点持仓不算独立样本；按需原引擎分段复核以相同初始资金空仓开始，不补造清仓，不认证因果或策略晋级。'};
 if(coverage?.complete!==true||!Array.isArray(history?.universeHistory)||!Array.isArray(history?.stocks)||!history.stocks.length||!options)return {...base,reason:'缺少完整的原历史时点证券主数据或费用覆盖'};
 const dates=history.stocks[0].bars.map(b=>b.date),start=options.start??27,end=options.end??dates.length-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<27||end>=dates.length||end<=start||!dates.every(date)||dates.some((d,i)=>i>0&&d<=dates[i-1]))return {...base,reason:'原样本区间或日期无效'};
 const grouped=new Map(),boundaries=new Set(),transitions=[];
 for(const row of history.universeHistory){const a=grouped.get(row.symbol)||[];a.push(row);grouped.set(row.symbol,a);}
 for(const a of grouped.values())a.sort((a,b)=>a.from.localeCompare(b.from));
 let ruleChanges=0,versions=0,states=0,changed=0;
 for(const stock of history.stocks){
  const symbol=String(stock.symbol||stock.code||''),g=grouped.get(symbol)||[];
  if(!/^\d{6}$/.test(symbol)||stock.bars.length!==dates.length||g.some((r,i)=>i&&r.from<=g[i-1].through))return {...base,reason:'证券身份、日期或主数据区间冲突'};
  let cursor=0,prior=null;
  for(let i=start;i<=end;i++){
   const d=dates[i];if(stock.bars[i].date!==d)return {...base,reason:'原证券日期没有对齐'};
   while(cursor<g.length&&g[cursor].through<d)cursor++;
   const r=g[cursor];if(!valid(r,d))return {...base,reason:'开盘时点的原制度证据有缺口或尚不可知'};
   if(prior&&r!==prior){
    const before=prior.securityMaster,after=r.securityMaster,ruleFields=diff(before,after,rules),
     versionFields=diff(before,after,['source','dataVersion','evidenceHash']),stateFields=diff(before,after,['isST','suspended','listedOn','delistedOn']);
    if(r.eligible!==prior.eligible)stateFields.push('eligible');
    if(ruleFields.length){ruleChanges++;boundaries.add(i);}
    if(versionFields.length)versions++;
    if(stateFields.length)states++;
    if(ruleFields.length||versionFields.length||stateFields.length){
     changed++;
     if(transitions.length<MAX_TRANSITIONS)transitions.push({symbol,beforeDate:dates[i-1],afterDate:d,index:i,ruleFields,versionFields,stateFields,before:proof(before),after:proof(after),isInstitutionalBreak:ruleFields.length>0});
    }
   }
   prior=r;
  }
 }
 const breakpoints=[...boundaries].sort((a,b)=>a-b),common={...base,ruleChangeCount:ruleChanges,versionTransitionCount:versions,securityStateTransitionCount:states,breakCount:breakpoints.length,transitionTotal:changed,transitionOmitted:changed-transitions.length,transitions};
 if(breakpoints.length>100)return {...common,status:'segment-budget-exceeded',reason:'断点超过本次100个上限，保留原数据，不把截断后的制度样本作为完整比较'};
 const points=[start,...breakpoints,end+1],equity=new Map((result?.equity||[]).map(r=>[r.day,r.value])),trades=Array.isArray(result?.trades)?result.trades:[];
 const segments=points.slice(0,-1).map((from,i)=>{
  const to=points[i+1]-1,baseValue=from===start?options.initialCash:equity.get(from-1),final=equity.get(to);
  const inside=trades.filter(t=>Number.isInteger(t.buyDay)&&Number.isInteger(t.sellDay)&&t.buyDay>=from&&t.sellDay<=to&&t.sellDay>=t.buyDay);
  const crossing=trades.filter(t=>Number.isInteger(t.buyDay)&&Number.isInteger(t.sellDay)&&t.buyDay<from&&t.sellDay>=from&&t.sellDay<=to);
  return {fromIndex:from,throughIndex:to,fromDate:dates[from],throughDate:dates[to],sessions:to-from+1,originalContinuousPath:{markedReturnPct:finite(baseValue)&&baseValue>0&&finite(final)?round(100*(final/baseValue-1)):null,closedTradesWithin:inside.length,crossBoundaryClosedTrades:crossing.length,
   withinSegmentClosedNetPnl:inside.every(t=>finite(t.netPnl))?round(inside.reduce((n,t)=>n+t.netPnl,0)):null,independentSample:false},isolatedReplay:{status:requested?'pending':'not-requested',metrics:null}};
 });
 let replayAttempts=0,reviewedSegments=0;
 const permitted=breakpoints.length>0&&segments.length<=MAX_SEGMENTS&&history.stocks.length*dates.length<=MAX_REPLAY_STOCK_BARS&&typeof replay==='function';
 for(const seg of segments){
  if(!requested)continue;
  if(!breakpoints.length){seg.isolatedReplay.status='no-declared-rule-break';continue;}
  if(!permitted){seg.isolatedReplay.status='replay-budget-or-engine-unavailable';continue;}
  if(seg.sessions<Math.max(MIN_SESSIONS,(options.holdDays??1)+2)){seg.isolatedReplay.status='insufficient-segment-sessions';continue;}
  replayAttempts++;
  try{
   const r=replay({...options,start:seg.fromIndex,end:seg.throughIndex});
   if(!r?.metrics||!Array.isArray(r.equity)||r.equity[0]?.day!==seg.fromIndex||r.equity.at(-1)?.day!==seg.throughIndex||r.metrics.initialCash!==options.initialCash||!Array.isArray(r.openPositions)||!Array.isArray(r.trades)||r.trades.some(t=>!Number.isInteger(t.buyDay)||!Number.isInteger(t.sellDay)||t.buyDay<seg.fromIndex||t.sellDay>seg.throughIndex||t.sellDay<t.buyDay))throw Error('inconsistent original replay');
   reviewedSegments++;
   seg.isolatedReplay={status:r.metrics.closedTrades>0?'evaluated-research':'no-closed-trades',metrics:r.metrics,remainingOpenPositions:r.openPositions.length,blockedOrders:Array.isArray(r.orders)?r.orders.filter(o=>['blocked','risk-paused'].includes(o.status)).length:null,
    scope:'same-original-engine-fresh-cash-no-carried-orders-or-holdings',strategyVersionEvidence:'original-running-engine-not-historical-version-authentication',warmup:'original historical prefixes retained',netProfitCertified:false,releaseEligible:false};
  }catch{seg.isolatedReplay={status:'original-segment-replay-unavailable',metrics:null};}
 }
 return {...common,status:breakpoints.length?(requested?(reviewedSegments===segments.length?'segmented-research-replayed':'segmented-review-incomplete'):'segmented-awaiting-review'):'no-declared-rule-break',segments,replayAttempts,reviewedSegments,originalContinuousReplayPreserved:true,
  fullCalendarVerified:false,independentSamplesCertified:false,ruleAdaptationVerified:false};
}
module.exports={institutionalReview};
