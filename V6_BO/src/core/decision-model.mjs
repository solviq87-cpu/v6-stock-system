import {eligiblePick,pickReasons,systemPickDay} from '../../public/nova/system-picks.mjs';
export {systemPickDay};

// Server-owned decision projection. No scanner, account or quote permission is
// changed here; the browser receives these values and only validates them.
const array=value=>Array.isArray(value)?value:[];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const positive=value=>finite(value)&&value>0;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const time=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const text=value=>typeof value==='string'?value.trim().slice(0,240):'';
const code=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10);
const round=value=>Math.round(value*100)/100;
const forbidden=/simulat|research|readonlybackup|cost|carried|histor|import|fixture|mock|test|synthetic/i;

export function decisionDay(value){
 if(typeof value!=='string')return null;
 const day=value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const at=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(at)&&new Date(at).toISOString().startsWith(day)?day:null;
}

function currentSession(state,day,now){
 const clock=state.marketClock,minute=new Date(now+28800000).getUTCHours()*60+new Date(now+28800000).getUTCMinutes();
 return (clock?clock.trading===true&&decisionDay(clock.day)===day:state.trading===true)&&state.trading!==false&&
  !state.isSnapshot&&!state.dashboard?.isSnapshot&&!state.closeSession&&
  (minute>=570&&minute<690||minute>=780&&minute<897);
}

function riskReasons(row){
 const reasons=array(row?.decisionBlockReasons).map(text).filter(Boolean);
 if(!eligiblePick(row))reasons.push('已有策略或风控条件未通过');
 if(['riskWarning','halt','suspended','blocked','bad','riskBlocked','blacklisted'].some(k=>row?.[k]===1||typeof row?.[k]==='string'&&!/^(?:false|0|no|none|无|正常|否)$/i.test(row[k])))reasons.push('存在风险或停牌标记');
 if(row?.canTrade===false||row?.canNotify===false)reasons.push('原始报价明确禁止该用途');
 if(row?.canTrade!==true&&row?.canNotify!==true)reasons.push('原始报价未返回用途许可');
 if(row?.readOnlyBackup===true||row?.imported===true||row?.historicalClose===true||row?.pickSource==='收盘观察精选')reasons.push('该记录仅供历史或观察使用');
 return [...new Set(reasons)];
}

export function decisionQuoteGate(row,{day,now=Date.now(),poolDay}={}){
 const reasons=riskReasons(row),target=decisionDay(day)||chinaDay(now);
 const at=row?.quoteAt,received=row?.receivedAt,source=text(row?.quoteSource),mode=text(row?.quoteMode||row?.mode);
 if(!code(row?.code))reasons.push('股票代码无效');
 if(!positive(row?.price))reasons.push('缺少有效原始价格');
 if(!source||!mode||forbidden.test(source)||forbidden.test(mode))reasons.push('原始报价来源或用途待核验');
 if(!time(at)||at>now||now-at>15000||time(at)&&chinaDay(at)!==target)reasons.push('原始报价超过15秒、跨日或时点缺失');
 if(row?.vendorQuoteAt!=null&&row.vendorQuoteAt!==at)reasons.push('供应商时点与报价时点不一致');
 if(!time(received)||received<at||received>now)reasons.push('原始报价接收顺序无效');
 if(systemPickDay(row||{},decisionDay(poolDay),now)!==target)reasons.push('候选交易日与当前日期不一致');
 if(!positive(row?.volume)&&!positive(row?.amount))reasons.push('缺少同一原始行的有效成交量额');
 if(['volume','amount'].some(k=>finite(row?.[k])&&row[k]<=0))reasons.push('原始行成交量或成交额为零或负数');
 return {ok:reasons.length===0,reasons:[...new Set(reasons)],day:target,quoteAt:time(at)?at:null,source:source||null};
}

// Match the existing public intraday distribution collector's 15-minute
// source clock and observed-market breadth's 80% coverage floor. Receipt
// refreshes and the morning session must not revive obsolete buy evidence.
const WEATHER_MAX_AGE=15*60000;
const weatherFields=['adv','dec','flat','observed','total','upLimit','downLimit'];
const conflicted=row=>row?.sourceConflict===true||row?.conflict===true||
 ['conflict','conflicting','unknown','stale','future','invalid'].includes(row?.evidenceStatus);
function weatherClock(at,day,now){
 if(!time(at)||at>now||now-at>WEATHER_MAX_AGE||chinaDay(at)!==day)return false;
 const minute=new Date(now+28800000).getUTCHours()*60+new Date(now+28800000).getUTCMinutes();
 const start=Date.parse(day+(minute>=780?'T13:00:00+08:00':'T09:30:00+08:00'));
 return at>=start;
}
function weatherCoverage(observed,total){
 return count(observed)&&count(total)&&total>=3000&&total<=20000&&observed<=total&&observed*5>=total*4;
}
function sampleTotal(row){
 const values=[row?.total,row?.universeSize].filter(v=>v!=null);
 return values.length&&values.every(v=>v===values[0])?values[0]:null;
}
const metricClock=row=>row?.quoteAt??row?.observedAt;
function metric(row,day,now,intraday=false){
 const at=metricClock(row);
 return row&&decisionDay(row.date)===day&&time(row.knownAt)&&row.knownAt<=now&&chinaDay(row.knownAt)>=day&&text(row.source)&&
  !forbidden.test(row.source)&&!conflicted(row)&&finite(row.value)&&
  (!intraday||weatherClock(at,day,now)&&weatherClock(row.knownAt,day,now)&&at<=row.knownAt&&
   (row.quoteAt==null||row.observedAt==null||row.quoteAt===row.observedAt))?row:null;
}

// Keep sector evidence separate from the full-market distribution.
const marketScope=value=>text(value).replace(/\s/g,'').replace(/[()]/g,m=>m==='('?'（':'）');
const fullMarketScope=value=>/^沪深京A股(?:（含ST）)?$/.test(marketScope(value));
const weatherSource=row=>/^打板客(?:盘中涨跌分布|收盘涨跌分布)?$/.test(text(row?.source))?'打板客':text(row?.source).toLowerCase();
const observationOnly=row=>['simulated','synthetic','fixture','mock','imported','readOnlyBackup'].some(k=>row?.[k]===true)||
 forbidden.test(text(row?.mode))||forbidden.test(text(row?.quoteMode));
function distributionReceipt(row,day,now,intraday=false){
 return row&&['market-distribution-intraday','market-distribution'].includes(row.kind)&&decisionDay(row.day)===day&&
  text(row.source)&&text(row.scope)&&!forbidden.test(row.source)&&time(row.quoteAt)&&time(row.knownAt)&&
  row.quoteAt<=row.knownAt&&row.knownAt<=now&&chinaDay(row.quoteAt)===day&&
  (!intraday||row.kind==='market-distribution-intraday'&&fullMarketScope(row.scope)&&
   weatherClock(row.quoteAt,day,now)&&weatherClock(row.knownAt,day,now));
}
function distribution(row,day,now,intraday=false){
 return distributionReceipt(row,day,now,intraday)&&!conflicted(row)&&(!intraday||!observationOnly(row))&&
  weatherFields.every(k=>count(row[k]))&&
  row.observed>0&&row.observed<=row.total&&row.adv+row.dec+row.flat===row.observed&&row.upLimit<=row.adv&&row.downLimit<=row.dec&&
  (!intraday||weatherCoverage(row.observed,row.total));
}
function latestDistributionReceipts(rows,day,now){
 // Establish the latest visible batch before quality filtering. Never revive
 // an older batch from a provider whose newest comparable batch is incomplete.
 const groups=new Map();
 for(const row of rows){
  if(!distributionReceipt(row,day,now,true))continue;
  const key=JSON.stringify([weatherSource(row),marketScope(row.scope)]),previous=groups.get(key);
  if(!previous||row.quoteAt>previous[0].quoteAt)groups.set(key,[row]);
  else if(row.quoteAt===previous[0].quoteAt)previous.push(row);
 }
 return [...groups.values()].flat();
}

export function decisionWeather(state={}, {day,now=Date.now()}={}){
 const target=decisionDay(day)||chinaDay(now),missing=[],basis=[],intraday=currentSession(state,target,now);
 const snapshots=[state.marketDistribution,...array(state.marketRecovery?.coverage)];
 const currentReceipts=intraday?latestDistributionReceipts(snapshots,target,now):snapshots;
 const latest=currentReceipts.filter(row=>distribution(row,target,now,intraday)).sort((a,b)=>b.quoteAt-a.quoteAt||
  (intraday?b.observed/b.total-a.observed/a.total||Number(marketScope(b.scope).endsWith('（含ST）'))-Number(marketScope(a.scope).endsWith('（含ST）'))||
   weatherSource(a).localeCompare(weatherSource(b)):0))[0];
 const noQualifiedLatest=intraday&&currentReceipts.length>0&&!latest;
 // Conflicts in the same provider/scope/batch cannot be resolved by array
 // order, a newer receipt clock, or substituting a weaker sample.
 const wideConflict=Boolean(latest&&snapshots.some(row=>row&&row!==latest&&
   decisionDay(row.day)===target&&row.kind===latest.kind&&
   (intraday?marketScope(row.scope)===marketScope(latest.scope):row.source===latest.source&&row.scope===latest.scope)&&
   row.quoteAt===latest.quoteAt&&time(row.knownAt)&&row.knownAt<=now&&row.knownAt>=row.quoteAt&&
   (conflicted(row)||intraday&&observationOnly(row)||weatherFields.some(k=>row[k]!==latest[k]))))||
  Boolean(intraday&&snapshots.some(row=>decisionDay(row?.day)===target&&
   row.kind==='market-distribution-intraday'&&weatherClock(row.quoteAt,target,now)&&
   time(row.knownAt)&&row.knownAt<=now&&conflicted(row)));
 const wide=wideConflict?null:latest;
 let breadth=null,upLimit=null,downLimit=null,sealRate=null;
 if(wideConflict)missing.push('同批全市场涨跌分布冲突');
 if(noQualifiedLatest&&!wideConflict)missing.push('最新全市场批次未通过覆盖率或来源核验');
 if(wide){
  breadth=wide.adv/wide.observed*100;upLimit=wide.upLimit;downLimit=wide.downLimit;
  basis.push({kind:'breadth',source:wide.source,scope:wide.scope,day:target,quoteAt:wide.quoteAt,knownAt:wide.knownAt,observed:wide.observed,total:wide.total,coverage:wide.observed/wide.total});
 }else if(!wideConflict){
  const b=state.breadth,m=state.dashboard?.mood,at=m?.scope?.snapAt;
  if(decisionDay(b?.day)===target&&time(b.at)&&b.at<=now&&chinaDay(b.at)===target&&count(b.up)&&count(b.down)&&count(b.n)&&b.n>0&&b.up+b.down<=b.n&&
    !conflicted(b)&&(!intraday||weatherClock(b.at,target,now))){
   const total=sampleTotal(b);
   breadth=b.up/b.n*100;basis.push({kind:'breadth',source:'V6 同批行情宽度',scope:'已采集 '+b.n+' 只',day:target,quoteAt:b.at,observed:b.n,total:total??null});
   if(intraday&&!weatherCoverage(b.n,total))missing.push('当前全市场覆盖率');
  }else if(time(at)&&at<=now&&chinaDay(at)===target&&['upN','downN','flatN'].every(k=>count(m?.[k]))&&
   count(m.scope.sample)&&m.scope.sample>0&&m.upN+m.downN+m.flatN===m.scope.sample&&
   !conflicted(m)&&(!intraday||weatherClock(at,target,now))){
   const total=sampleTotal(m.scope);
   breadth=m.upN/m.scope.sample*100;basis.push({kind:'breadth',source:'V6 同批行情宽度',scope:'已采集 '+m.scope.sample+' 只',day:target,quoteAt:at,observed:m.scope.sample,total:total??null});
   if(intraday&&!weatherCoverage(m.scope.sample,total))missing.push('当前全市场覆盖率');
  }
  const up=metric(state.marketRecovery?.metrics?.upLimit,target,now,intraday),down=metric(state.marketRecovery?.metrics?.downLimit,target,now,intraday);
  // Never divide counts collected from different providers, scopes or batches.
  if(up&&down&&count(up.value)&&count(down.value)&&up.source===down.source&&up.scope===down.scope&&up.knownAt===down.knownAt&&
    (!intraday||text(up.scope)&&metricClock(up)===metricClock(down))){
   upLimit=up.value;downLimit=down.value;basis.push({kind:'limits',source:up.source,scope:up.scope||'同源专题池',day:target,knownAt:up.knownAt,
    ...(intraday?{quoteAt:metricClock(up)}:{})});
  }
 }
 const db=state.dabanke,ecos=array(db?.ecology).filter(row=>row?.label==='当日封板'),eco=ecos[0];
 // The real collector returns the page's original market/distribution
 // timestamps. Do not let a new page receipt hide explicit old source clocks.
 const dbClocks=[db?.market,db?.distribution].filter(v=>v!=null).map(v=>v.quoteAt);
 const dbCurrent=!intraday||db?.mode!=='收盘'&&weatherClock(db?.knownAt,target,now)&&
  dbClocks.every(at=>weatherClock(at,target,now)&&at<=db.knownAt);
 if(decisionDay(db?.day)===target&&time(db.knownAt)&&db.knownAt<=now&&dbCurrent&&!conflicted(db)&&
  count(eco?.success)&&count(eco?.total)&&eco.total>0&&eco.success<=eco.total&&
  ecos.every(row=>row.success===eco.success&&row.total===eco.total)){
  sealRate=eco.success/eco.total*100;
  basis.push({kind:'sealing',source:'打板客',scope:'当日触板池（不含 ST）',day:target,knownAt:db.knownAt,sealed:eco.success,touched:eco.total,
   clockBasis:dbClocks.length?'provider-page-clock':'receipt-only',
   ...(dbClocks.length&&dbClocks.every(time)?{quoteAt:Math.min(...dbClocks)}:{})});
 }else{
  const broken=metric(state.marketRecovery?.metrics?.breakRate,target,now,intraday);
  if(broken&&broken.value>=0&&broken.value<=100){sealRate=100-broken.value;basis.push({kind:'sealing',source:broken.source,scope:broken.scope||'同源触板专题池',day:target,knownAt:broken.knownAt,
   ...(intraday?{quoteAt:metricClock(broken)}:{})});}
 }
 if(breadth===null)missing.push('同日市场宽度');
 if(upLimit===null||downLimit===null)missing.push('同日同口径涨跌停家数');
 if(sealRate===null)missing.push('同日封板率');
 const metrics={breadth:breadth===null?null:round(breadth),upLimit,downLimit,upDownRatio:downLimit>0?round(upLimit/downLimit):null,sealRate:sealRate===null?null:round(sealRate)};
 if(missing.length)return {day:target,status:'unknown',label:'谨慎',summary:'市场依据待核验：缺少'+missing.join('、')+'，暂不形成买入候选。',canConsider:false,metrics,missing,basis};
 // Fixed display rules, not learned thresholds or changes to the risk engine.
 const weak=breadth<35||downLimit>upLimit||sealRate<50;
 const strong=breadth>=55&&upLimit>0&&(downLimit===0||upLimit/downLimit>=1.5)&&sealRate>=70;
 const status=weak?'red':strong?'green':'yellow',label=weak?'空仓':strong?'可做多':'谨慎';
 const summary=label+' · 上涨占比 '+round(breadth)+'%，涨跌停 '+upLimit+':'+downLimit+'，封板率 '+round(sealRate)+'%。';
 return {day:target,status,label,summary,canConsider:!weak,metrics,missing,basis};
}

export function decisionPlan(row,account){
 const levels=row?.levels||{},missing=[],policy=account?.executionPolicy||{};
 const buyLow=positive(levels.ma5)?levels.ma5:null,buyHigh=positive(row?.price)?row.price:null;
 const stop=positive(levels.stop)?levels.stop:null,target=positive(levels.t1)?levels.t1:null;
 const allocation=positive(policy.allocationPct)&&policy.allocationPct<=100?policy.allocationPct:
  Number.isSafeInteger(policy.maxPositions)&&policy.maxPositions>0?98/policy.maxPositions:
  Number.isSafeInteger(account?.maxPos)&&account.maxPos>0?98/account.maxPos:null;
 const positionPct=allocation!==null&&positive(account?.equity)&&finite(account?.cash)&&account.cash>=0?
  Math.min(allocation,account.cash/account.equity*100):null;
 if(buyLow===null||buyHigh===null)missing.push('买入区间');
 if(stop===null)missing.push('止损位');
 if(target===null)missing.push('目标价');
 if(positionPct===null)missing.push('原模拟盘仓位预算');
 else if(positionPct<=0)missing.push('可用资金');
 if(buyLow!==null&&buyHigh!==null&&stop!==null&&target!==null&&!(stop<buyLow&&buyLow<=buyHigh&&buyHigh<target))missing.push('止损、买区与目标价次序');
 if(account?.enabled===false)missing.push('模拟盘策略跟踪已暂停');
 const max=policy.maxPositions??account?.maxPos;
 if(Number.isSafeInteger(max)&&array(account?.positions).length>=max)missing.push('现有模拟盘持仓已满');
 return {buyLow,buyHigh,stop,target,positionPct,complete:missing.length===0,missing,
  priceBasis:'现有 MA5 至本行原始报价；止损与目标取现有 levels.stop / levels.t1',
  positionBasis:positionPct===null?'原模拟盘仓位预算待核验':'取原模拟盘单票预算与可用资金比例较小值；费用、整手和最终仓位由原买入门禁核验'};
}

function themesOf(row){
 return [...new Set([...array(row?.themes),...array(row?.themeTags),row?.sector,row?.industry].map(text).filter(Boolean))].slice(0,6);
}

export function stockConclusion(row={}, {day,now=Date.now()}={}){
 const target=decisionDay(day)||decisionDay(row.poolDay||row.tradeDate)||chinaDay(now),gate=decisionQuoteGate(row,{day:target,now,poolDay:target});
 const tags=themesOf(row),sameDay=systemPickDay(row,target,now)===target;
 const sealed=row.sealed===true||row.isSealed===true||row.decisionSealed===true;
 const broken=sameDay&&(row.opened===true||row.sealStatus==='opened'||row.status==='炸板'||count(row.breakCount)&&row.breakCount>0&&row.isSealed===false);
 const evidence=[
  {kind:'theme',label:'题材',known:sameDay&&tags.length>0,text:sameDay&&tags.length?tags.join(' / '):'缺少同日题材记录'},
  {kind:'seal',label:'封单',known:sameDay&&(finite(row.sealAmount)||count(row.breakCount)),text:sameDay&&finite(row.sealAmount)?'封单 '+row.sealAmount+' 元'+(count(row.breakCount)?'，开板 '+row.breakCount+' 次':''):sameDay&&count(row.breakCount)?'开板 '+row.breakCount+' 次，封单金额未提供':'缺少同日封单证据'},
  {kind:'volume',label:'量价',known:gate.ok,text:gate.ok?'原始价 '+row.price+'；'+(positive(row.amount)?'成交额 '+row.amount+' 元':'成交量 '+row.volume)+(finite(row.pct)?'；涨跌 '+round(row.pct)+'%':''):'报价或量额证据不足'},
  {kind:'position',label:'位置',known:sameDay&&positive(row.levels?.ma5)&&positive(row.price),text:sameDay&&positive(row.levels?.ma5)&&positive(row.price)?'MA5 '+row.levels.ma5+'，'+(row.price>=row.levels.ma5?'位于其上方或附近':'位于其下方')+(positive(row.levels?.r1)?'；第一压力 '+row.levels.r1:''):'位置依据待核验'}
 ];
 const label=!gate.ok||sealed?'回避':broken?'等待回封':'可关注';
 const reason=!gate.ok?gate.reasons.join('；'):sealed?'当前已封板，等待可成交的重新核验':broken?'已有开板证据，等待回封并重新核对量价':pickReasons(row)[0]||'报价与当前条件可核对，按计划继续观察';
 return {label,reason,evidence,day:target};
}

function readyPool(pool){
 return pool&&pool.ok!==false&&!pool.error&&!pool.locked&&pool.isSnapshot!==true&&
  !/^(?:error|failed|unavailable|unknown|busy|pending|loading|calculating|computing|not-ready)$/.test(String(pool.status||''))&&
  !/计算(?:失败|异常)|行情未就绪|正在计算|数据(?:不可用|未就绪)|采集失败/.test(String(pool.note||''));
}

export function decisionResonance(state={}, {day,now=Date.now(),ranked=[]}={}){
 const target=decisionDay(day)||chinaDay(now),byCode=new Map();
 const add=(rows,id,label,declared,predicate=()=>true)=>{
  for(const row of array(rows)){
   if(!code(row?.code)||!eligiblePick(row)||!predicate(row)||systemPickDay(row,decisionDay(declared),now)!==target)continue;
   if(!byCode.has(row.code))byCode.set(row.code,new Map());
   byCode.get(row.code).set(id,{id,label});
  }
 };
 add(ranked,'ranked','精选',target);
 const firstDay=decisionDay(state.yierAsOf),nextDay=decisionDay(state.lianbanAsOf);
 if(firstDay===target)add(state.yierList,'relay-first','一进二',firstDay);
 if(nextDay===target)add(state.lianbanList,'relay-next','连板接力',nextDay);
 const auction=state.decisionPools?.auction,basis=auction?.auctionEvidence;
 if(readyPool(auction)&&time(auction.asOf)&&auction.asOf<=now&&basis?.eligibleForAuctionEvidence===true&&decisionDay(basis.auctionDay)===target){
  add(auction.items,'auction','竞价引力',target,row=>row.auctionInputStatus==='auction-snapshot-unverified');
 }
 // Count strategy membership, never the multiple factors within one strategy.
 return new Map([...byCode].map(([symbol,strategies])=>[symbol,[...strategies.values()]]));
}

export function rankDecisionCandidates(qualified,projection,{day,now}={}){
 const original=(a,b)=>b.score-a.score||a.code.localeCompare(b.code);
 const usable=projection?.protocol==='fayo-approved-factor-ranking-v1'&&projection.status==='ready'&&
  projection.targetDay===day&&decisionDay(projection.signalDay)===projection.signalDay&&projection.signalDay<day&&
  time(projection.loadedAt)&&projection.loadedAt<=now&&now-projection.loadedAt<=15*60000&&
  Number.isSafeInteger(projection.modelVersion)&&projection.modelVersion>0&&/^[a-f0-9]{64}$/.test(projection.modelFingerprint||'')&&
  projection.canTrade===false&&projection.changesOriginalGates===false&&projection.changesSelectionScore===false;
 const observations=new Map();
 if(usable)for(const row of array(projection.rows)){
  if(!code(row?.code)||row.eligibleForNextSession!==true||row.targetDay!==day||row.signalDay!==projection.signalDay||row.day!==projection.signalDay||
     row.modelVersion!==projection.modelVersion||row.modelFingerprint!==projection.modelFingerprint||!finite(row.score)||
     !time(row.observationAt)||row.observationAt>now||chinaDay(row.observationAt)!==row.signalDay||!Array.isArray(row.missing)||row.missing.length)continue;
  observations.set(row.code,observations.has(row.code)?null:row);
 }
 const groups=new Map();
 for(const row of qualified){if(!groups.has(row.resonanceScore))groups.set(row.resonanceScore,[]);groups.get(row.resonanceScore).push(row);}
 const ranked=[];
 for(const [resonance,rows]of [...groups].sort((a,b)=>b[0]-a[0])){
  // Use a single comparable basis for the whole tie group. Pairwise mixing of
  // old and model scores would create a non-transitive sort with missing rows.
  const complete=usable&&rows.every(row=>observations.get(row.code));
  for(const row of rows){
   const observation=observations.get(row.code);
   if(observation)row.factorRanking={...observation,status:complete?'applied':'incomplete-peer-group',
    rankingApplied:Boolean(complete),loadedAt:projection.loadedAt,approvedAt:projection.approvedAt,
    trainCutoff:projection.trainCutoff,trainingLabelKnownAtMax:projection.trainingLabelKnownAtMax,
    reason:complete?'同共振组使用同一已批数值模型排序，原精选分和所有交易门禁保持':
      '同共振组尚有缺分标的，本组保留原精选排序',canTrade:false};
  }
  rows.sort(complete?(a,b)=>observations.get(b.code).score-observations.get(a.code).score||original(a,b):original);
  ranked.push(...rows);
 }
 return ranked;
}

export function buildDecisionBoard(state={}, {now=Date.now()}={}){
 if(!time(now))throw Error('决策看板时钟无效');
 const day=chinaDay(now),sessionOpen=currentSession(state,day,now),weather=decisionWeather(state,{day,now});
 const poolDay=decisionDay(state.poolDay||state.snapshotFieldDays?.candidatePool||state.snapshotFieldDays?.pool);
 const base=array(state.pool),blockedCounts={},qualified=[];
 const held=new Set(array(state.paper?.pool?.positions).map(row=>row?.code));
 const sealed=decisionDay(state.ztDay)===day&&state.ztDayProbed!==false?new Set(array(state.ztPool).map(row=>row?.code)):new Set();
 const byCode=new Map();
 for(const row of base){
  if(!code(row?.code))continue;
  const previous=byCode.get(row.code);
  if(!previous||(row.quoteAt||0)>(previous.quoteAt||0))byCode.set(row.code,row);
  else if(row.quoteAt===previous.quoteAt&&row.price!==previous.price)byCode.set(row.code,{...previous,blocked:true});
 }
 const resonance=decisionResonance(state,{day,now,ranked:[...byCode.values()]});
 const block=reason=>{blockedCounts[reason]=(blockedCounts[reason]||0)+1;};
 for(const raw of byCode.values()){
  const row={...raw,poolDay:systemPickDay(raw,poolDay,now)||raw.poolDay};
  const gate=decisionQuoteGate(row,{day,now,poolDay}),plan=decisionPlan(row,state.paper?.pool),reasons=pickReasons(row);
  if(!gate.ok){gate.reasons.forEach(block);continue;}
  if(held.has(row.code)){block('原模拟盘已持有该股');continue;}
  if(sealed.has(row.code)||row.sealed===true||row.isSealed===true){block('当前已封板，原模拟盘不能成交');continue;}
  if(!finite(row.score)||row.score<0||row.score>100||!reasons.length){block('精选评分或入选依据不足');continue;}
  if(!plan.complete){plan.missing.forEach(block);continue;}
  const conclusion=stockConclusion(row,{day,now});
  if(conclusion.label!=='可关注'){block(conclusion.reason);continue;}
  const strategies=resonance.get(row.code)||[];
  qualified.push({...row,day,reason:reasons.slice(0,2).join('；'),themes:themesOf(row),plan,
   resonanceScore:strategies.length,resonanceStrategies:strategies,conclusion});
 }
 const ranked=rankDecisionCandidates(qualified,state.decisionApprovedRanking,{day,now});
 const cards=sessionOpen&&weather.canConsider?ranked.slice(0,3):[];
 const reasons=[];
 if(!sessionOpen)reasons.push('当前不在已确认的连续竞价时段，历史行情保留在研究区。');
 if(weather.missing.length)reasons.push(weather.summary);
 else if(!weather.canConsider)reasons.push('当前市场天气为空仓，等待环境改善。');
 if(!cards.length&&Object.keys(blockedCounts).length)reasons.push('候选未通过：'+Object.keys(blockedCounts).join('、')+'。');
 if(!base.length)reasons.push('当前没有源端策略候选。');
 const checklist=[
  {id:'market',label:'核对今日市场天气',status:weather.canConsider?'ready':'waiting',note:weather.summary},
  {id:'plan',label:'核对买区、止损、目标与仓位',status:cards.length?'ready':'waiting',note:cards.length?'仅展示通过原始行情与计划校验的 '+cards.length+' 只。':'今天空仓，等待信号'},
  {id:'paper',label:'复核后加入模拟盘',status:cards.length?'ready':'waiting',note:'预填计划后仍由原模拟盘检查报价、仓位、交易时段及 T+1。'},
  {id:'review',label:'收盘核对计划与实际执行',status:'pending',note:'执行评分按冻结计划及可核对的成交流水生成；缺证据保持待核验。'}
 ];
 return {day,generatedAt:now,sessionOpen,weather,cards,emptyMessage:'今天空仓，等待信号',reasons,blockedCounts,qualifiedCount:qualified.length,checklist};
}
