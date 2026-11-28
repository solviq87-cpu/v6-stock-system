'use strict';
const {FLAGS,digest}=require('./research-workspace-store');
const {conditionChanges}=require('./research-workspace-decision');
const {quoteUseEligibility,quoteObservationView}=require('./quote-observation-view');
const finite=x=>typeof x==='number'&&Number.isFinite(x),array=x=>Array.isArray(x)?x:[];
const average=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round=x=>finite(x)?+x.toFixed(4):null;
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
function analysisEvents(events,asOf){return events.filter(e=>e.kind==='analysis'&&e.recordedAt<=asOf&&e.data.asOf<=asOf).sort((a,b)=>a.data.asOf-b.data.asOf||a.sequence-b.sequence);}
function marketPosition(events,symbol,asOf){
 const clock=x=>Number.isSafeInteger(x)&&x>0&&x<=8e15;
 const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(Date.parse(d)).toISOString().slice(0,10)===d;
 const validCode=x=>typeof x==='string'&&/^\d{6}$/.test(x);
 const eligible=clock(asOf)?analysisEvents(events,asOf).filter(e=>clock(e.recordedAt)&&clock(e.data.asOf)&&e.data.asOf<=e.recordedAt):[];
 const own=eligible.filter(e=>e.data.symbol===symbol),latest=own.at(-1)?.data;
 const out={status:'unknown',role:'unknown',phase:'unknown',boards:[],scope:'selected-frozen-boards-only',...FLAGS};
 if(!latest)return {...out,reason:'尚无该股封存观察'};
 const dates=latest.tradeDates,calendarOK=Array.isArray(dates)&&dates.every((d,i)=>validDay(d)&&(!i||d>dates[i-1]))&&dates.includes(latest.tradeDate);
 const currentOf=d=>d.context?.sectorContext?.current;
 const boardsOf=d=>array(currentOf(d)?.boards);
 const comparableBoard=(d,b)=>b&&b.membershipComplete===true&&Array.isArray(b.members)&&b.members.length>0&&
  b.members.every(validCode)&&new Set(b.members).size===b.members.length&&b.members.includes(symbol)&&
  ['industry','concept'].includes(b.category)&&typeof b.code==='string'&&!!b.code.trim()&&
  validDay(d.tradeDate)&&b.quoteDate===d.tradeDate&&clock(b.quoteAt)&&b.quoteAt<=d.asOf&&
  day(b.quoteAt)===b.quoteDate&&b.quoteAt>=Date.parse(b.quoteDate+'T15:00:00+08:00')&&
  clock(b.membersObservedAt)&&b.membersObservedAt<=d.asOf&&day(b.membersObservedAt)===d.tradeDate&&
  b.simulated!==true&&b.retracted!==true;
 const boardIdentity=(d,b)=>JSON.stringify([d.provider,b.source??currentOf(d)?.source??currentOf(d)?.provider??null,
  b.classificationVersion??currentOf(d)?.classificationVersion??null,b.category,b.code]);
 const validClose=(bar,date,d,e)=>bar&&bar.date===date&&finite(bar.close)&&bar.close>0&&clock(bar.knownAt)&&
  bar.knownAt>=Date.parse(date+'T15:10:00+08:00')&&bar.knownAt<=Math.min(asOf,d.asOf,e.recordedAt)&&
  bar.closed!==false&&bar.isClosed!==false&&bar.simulated!==true&&bar.retracted!==true&&
  (bar.priceBasis==null||bar.priceBasis===d.priceBasis)&&(bar.source==null||bar.source===d.provider);
 for(const board of boardsOf(latest)){
  if(!comparableBoard(latest,board)||boardsOf(latest).filter(b=>b?.category===board.category&&b?.code===board.code).length!==1)continue;
  const memberHash=digest([...board.members].sort()),history=new Map(),identity=boardIdentity(latest,board);
  for(const e of own){
   const d=e.data,matching=boardsOf(d).filter(b=>b?.category===board.category&&b?.code===board.code);
   const b=matching.length===1?matching[0]:null;
   if(comparableBoard(d,b)&&boardIdentity(d,b)===identity&&digest([...b.members].sort())===memberHash&&finite(b.changePct)&&b.changePct>=-100)
    history.set(b.quoteDate,{date:b.quoteDate,changePct:b.changePct,evidence:e.hash});
  }
  const end=calendarOK?dates.indexOf(latest.tradeDate):-1;
  const expected=end>=2?dates.slice(end-2,end+1):[];
  const last3=expected.map(d=>history.get(d)).filter(Boolean);
  const consecutive=expected.length===3&&last3.length===3;
  const phase=consecutive?last3[2].changePct>last3[1].changePct&&last3[1].changePct>last3[0].changePct?'warming':
   last3[2].changePct<last3[1].changePct&&last3[1].changePct<last3[0].changePct?'cooling':'mixed':'unknown';
  const members=new Map();
  if(end>0)for(const e of eligible){
   const s=e.data;
   if(board.members.includes(s.symbol)&&s.tradeDate===latest.tradeDate&&s.provider===latest.provider&&
      s.priceBasis==='unadjusted'&&latest.priceBasis==='unadjusted'&&Array.isArray(s.bars)&&s.bars.length>=2){
    const b=s.bars.at(-1),p=s.bars.at(-2);
    if(validClose(b,latest.tradeDate,s,e)&&validClose(p,dates[end-1],s,e)){
     const changePct=100*(b.close/p.close-1);
     if(finite(changePct))members.set(s.symbol,{symbol:s.symbol,changePct,evidence:e.hash});
    }
   }
  }
  const ranked=[...members.values()].sort((a,b)=>b.changePct-a.changePct||a.symbol.localeCompare(b.symbol));
  const coverage=ranked.length/board.members.length,target=members.get(symbol);
  const eligibleRank=ranked.length>=5&&coverage>=.8&&!!target;
  const equal=x=>Math.abs(x.changePct-target.changePct)<=1e-8;
  const best=eligibleRank?ranked.filter(x=>!equal(x)&&x.changePct>target.changePct).length+1:null;
  const worst=eligibleRank?best+ranked.filter(equal).length-1:null;
  const classify=n=>n<=Math.max(1,Math.ceil(ranked.length*.2))?'relative-front':n>ranked.length*.8?'relative-back':'relative-middle';
  const role=eligibleRank&&classify(best)===classify(worst)?classify(best):'unknown';
  out.boards.push({code:board.code,name:board.name,category:board.category,tradeDate:board.quoteDate,quoteAt:board.quoteAt,membersObservedAt:board.membersObservedAt,
   memberHash,memberCount:board.members.length,observedMembers:ranked.length,coveragePct:round(coverage*100),
   rank:role==='unknown'||best!==worst?null:best,rankRange:eligibleRank?{best,worst}:null,
   phase,role,history:last3,phaseBasis:'截止最新交易日同身份同成员连续3个交易日涨幅变化，仅描述性观察',
   roleBasis:'已封存同日同价基成员涨幅相对位置，并列跨分位时保持未知，不认证龙头或补涨',
   changePct:finite(board.changePct)&&board.changePct>=-100?board.changePct:null,
   mainNetInflow:finite(board.mainNetInflow)?board.mainNetInflow:null});
 }
 out.status=out.boards.length?'observed-unverified':'unknown';
 const aggregate=key=>{const values=[...new Set(out.boards.map(b=>b[key]).filter(x=>x!=='unknown'))];return values.length===1?values[0]:'unknown';};
 out.role=aggregate('role');out.phase=aggregate('phase');
 out.reason=out.boards.length?'按明确选择的板块展示，不代表全市场主线或因果关系':'缺少同日成员和板块时点';return out;
}
function timeline(events,symbol,asOf){
 const rows=analysisEvents(events,asOf).filter(e=>e.data.symbol===symbol);
 const latestByIdentity=new Map();
 return rows.map(e=>{
  const key=e.data.provider+'|'+e.data.priceBasis,prior=latestByIdentity.get(key);latestByIdentity.set(key,e);
  const changes=conditionChanges(e.data,prior?.data);
  return {id:e.hash,previousRunId:prior?.hash??null,sequence:e.sequence,recordedAt:e.recordedAt,asOf:e.data.asOf,tradeDate:e.data.tradeDate,provider:e.data.provider,
   targetDate:e.data.targetDate,dueAt:e.data.dueAt,systems:e.data.systems,
   changes,changeDetected:!!prior&&(changes.changes.length>0||changes.systemChanges.length>0),status:e.data.dueAt&&e.data.dueAt<=asOf?'awaiting-evidence':'observed'};
 });
}
function scorecards(events,{asOf=Date.now(),feeBps=8,slippageBps=10,sellTaxBps=5}={}){
 if(![feeBps,slippageBps,sellTaxBps].every(x=>finite(x)&&x>=0&&x<=1000))throw Error('成绩单费用假设无效');
 const runs=analysisEvents(events,asOf),latest=new Map(),first=new Map(),prices=new Map();
 const priceIdentity=d=>{
  // Version-one workspace decisions predate the currency field and contain
  // unadjusted CNY A-share bars. Unknown schemas/bases are never interchangeable.
  const legacy=d.schemaVersion===1&&d.researchOnly===true&&d.canTrade===false&&d.canNotify===false&&d.productionWeightsChanged===false&&/^[a-f0-9]{64}$/.test(d.observationHash||'');
  if(!legacy||!/^\d{6}$/.test(d.symbol||'')||!['tencent','eastmoney'].includes(d.provider)||d.priceBasis!=='unadjusted'||Object.hasOwn(d,'currency')&&d.currency!=='CNY')return null;
  return d.symbol+'|'+d.provider+'|unadjusted|CNY';
 };
 // Keep the existing latest analysis-time correction policy per date. A rolling
 // snapshot omitting a date does not erase older evidence for that date.
 for(const e of runs){const identity=priceIdentity(e.data);if(!identity)continue;latest.set(identity,e.data);if(!prices.has(identity))prices.set(identity,new Map());
  for(const bar of array(e.data.bars))if(typeof bar.date==='string')prices.get(identity).set(bar.date,{bar,event:e});
 }
 const validPrice=row=>{if(!row)return false;const {bar:b,event:e}=row,closed=Date.parse(b.date+'T15:10:00+08:00');
  return /^\d{4}-\d{2}-\d{2}$/.test(b.date)&&Number.isFinite(closed)&&day(closed)===b.date&&Number.isSafeInteger(b.knownAt)&&b.knownAt>=closed&&b.knownAt<=Math.min(asOf,e.data.asOf,e.recordedAt)&&
   ['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high)&&finite(b.volume)&&b.volume>=0;
 };
 // The first server receipt owns the signal; a later backdated analysis must
 // not replace an already frozen pass/fail or remove its outcome sample.
 for(const e of runs.slice().sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence)){const d=e.data;for(const s of d.systems){const key=[d.symbol,d.provider,d.tradeDate,s.id,s.version].join('|');if(!first.has(key))first.set(key,{run:e,data:d,system:s});}}
 const buckets=new Map(),observations=[];
 for(const {run,data:d,system:s}of first.values())for(const horizon of [1,5,20,60]){
  const key=[s.id,s.version,d.regime,horizon,d.provider].join('|');
  if(!buckets.has(key))buckets.set(key,{system:s.id,version:s.version,regime:d.regime,horizon,provider:d.provider,total:0,passed:0,rejected:0,unknown:0,pending:0,missing:0,blocked:0,price:[],net:[],excess:[],dates:new Set(),symbols:new Set(),windows:[]});
  const b=buckets.get(key);b.total++;
  if(s.verdict!=='pass'){b[s.verdict==='fail'?'rejected':'unknown']++;continue;}b.passed++;
  const identity=priceIdentity(d),current=latest.get(identity),evidence=prices.get(identity),dates=array(current?.tradeDates),index=dates.indexOf(d.tradeDate);
  const entryDate=dates[index+1],exitDate=dates[index+1+horizon];
  if(index<0||!exitDate&&dates.at(-1)<day(asOf)){b.missing++;continue;}
  if(!exitDate||exitDate>day(asOf)){b.pending++;continue;}
  const entrySource=evidence?.get(entryDate),exitSource=evidence?.get(exitDate),entry=entrySource?.bar,exit=exitSource?.bar;
  const obs={runId:run.hash,symbol:d.symbol,system:s.id,horizon,signalDate:d.tradeDate,entryDate,exitDate,status:'missing',netReturnPct:null,
   outcomePolicy:'latest-available-snapshot-containing-date',entryOutcomeRunId:entrySource?.event.hash??null,exitOutcomeRunId:exitSource?.event.hash??null,
   entryOutcomeRecordedAt:entrySource?.event.recordedAt??null,exitOutcomeRecordedAt:exitSource?.event.recordedAt??null};
  if(!validPrice(entrySource)||!validPrice(exitSource)){b.missing++;observations.push(obs);continue;}
  if(!(entry.open>0&&exit.open>0)){b.missing++;observations.push(obs);continue;}
  const entryOpen=Date.parse(entryDate+'T09:30:00+08:00');
  if(d.asOf>=entryOpen||run.recordedAt>=entryOpen){b.blocked++;obs.status='signal-frozen-after-entry';observations.push(obs);continue;}
  const priceReturn=100*(exit.open/entry.open-1);if(!finite(priceReturn)){b.missing++;observations.push(obs);continue;}b.price.push(priceReturn);
  const usable=x=>x.volume>0&&x.suspended===false&&x.tradable===true&&x.isST===false&&x.corporateAction===false&&
   Number.isSafeInteger(x.statusKnownAt)&&x.statusKnownAt<=Date.parse(x.date+'T09:30:00+08:00')&&
   Number.isSafeInteger(x.corporateActionKnownAt)&&x.corporateActionKnownAt<=Date.parse(x.date+'T09:30:00+08:00')&&x.high!==x.low;
  const limits=x=>{if(x.noPriceLimit!==false||!(x.limitReferencePrice>0)||!finite(x.limitPct)||x.limitPct<=0||x.limitPct>30||!Number.isSafeInteger(x.limitKnownAt)||x.limitKnownAt>Date.parse(x.date+'T09:30:00+08:00'))return null;
   const up=Math.round(x.limitReferencePrice*(1+x.limitPct/100)*100)/100,down=Math.round(x.limitReferencePrice*(1-x.limitPct/100)*100)/100;
   return finite(x.limitUpPrice)&&Math.abs(x.limitUpPrice-up)<.011&&x.high<=up+.011&&x.low>=down-.011?{up,down}:null;};
  const entryLimit=limits(entry),exitLimit=limits(exit),windowDates=dates.slice(index+1,index+2+horizon),windowBars=windowDates.map(date=>evidence?.get(date));
  const actionVerified=windowBars.length===windowDates.length&&windowBars.every(row=>validPrice(row)&&row.bar.corporateAction===false&&Number.isSafeInteger(row.bar.corporateActionKnownAt)&&row.bar.corporateActionKnownAt<=Date.parse(row.bar.date+'T09:30:00+08:00'));
  if(!usable(entry)||!usable(exit)||!actionVerified||!entryLimit||!exitLimit||entry.open>=entryLimit.up-.005||exit.open<=exitLimit.down+.005){b.blocked++;obs.status='unverified-execution';obs.priceReturnPct=round(priceReturn);observations.push(obs);continue;}
  const net=100*((exit.open*(1-slippageBps/10000)*(1-(feeBps+sellTaxBps)/10000))/(entry.open*(1+slippageBps/10000)*(1+feeBps/10000))-1);
  if(!finite(net)){b.blocked++;obs.status='invalid-cost-estimate';observations.push(obs);continue;}
  b.net.push(net);b.dates.add(d.tradeDate);b.symbols.add(d.symbol);b.windows.push({from:entryDate,to:exitDate});obs.status='paper-estimate';obs.netReturnPct=round(net);obs.priceReturnPct=round(priceReturn);
  const benchmark=current.benchmarkSeries,indexRows=array(benchmark?.bars),be=indexRows.find(x=>x.date===entryDate),bx=indexRows.find(x=>x.date===exitDate);
  obs.benchmarkStatus='missing-matching-open-series';
  if(benchmark?.provider===d.provider&&benchmark.priceBasis===d.priceBasis&&benchmark.frequency==='1d'&&be&&bx&&be.knownAt<=asOf&&bx.knownAt<=asOf&&be.open>0&&bx.open>0){obs.benchmarkReturnPct=100*(bx.open/be.open-1);obs.benchmarkStatus='matched-open-to-open';b.excess.push(net-obs.benchmarkReturnPct);}
  observations.push(obs);
 }
 const systems=['fourteen','bazi','gpt','python'];
 const groups=[...buckets.values()].map(b=>{let nonOverlappingWindows=0,end='';for(const w of b.windows.slice().sort((a,b)=>a.to.localeCompare(b.to)))if(w.from>end){nonOverlappingWindows++;end=w.to;}
 return {system:b.system,version:b.version,regime:b.regime,horizon:b.horizon,provider:b.provider,
  total:b.total,passed:b.passed,rejected:b.rejected,unknown:b.unknown,pending:b.pending,missing:b.missing,blocked:b.blocked,
  observedPriceCount:b.price.length,modeledCount:b.net.length,independentSignalDays:b.dates.size,nonOverlappingWindows,distinctSymbols:b.symbols.size,
  averagePriceReturnPct:round(average(b.price)),averageNetReturnPct:round(average(b.net)),benchmarkMatched:b.excess.length,
  excessReturnPct:round(average(b.excess)),positiveFractionPct:b.net.length?round(100*b.net.filter(n=>n>0).length/b.net.length):null,
  status:b.net.length>=30&&nonOverlappingWindows>=10&&b.symbols.size>=10?'descriptive-only':'insufficient-independent-samples'};});
 return {groups,observations,systems:systems.map(id=>({id,groups:groups.filter(g=>g.system===id).length,status:groups.some(g=>g.system===id)?'observed':'not-evaluated'})),
  assumptions:{feeBps,slippageBps,sellTaxBps,entry:'next-session-open',exit:'entry-plus-horizon-session-open',quantityMode:'percentage-paper-estimate-not-account-ledger',signalSelection:'first-server-receipt',outcomeSelection:'latest-available-snapshot-containing-date'},
  limitations:['含成本估计不是权威模拟账本收益；不报告没有成交证据的净收益','同股连续信号和重叠周期非独立样本；不按收益自动调权','缺同日期/口径基准时超额保持未知',
   '同日信号取首次服务端接收；逐日期价格沿用截至查看时点最新分析快照中的修订，滚动窗口省略不删除旧证据'],...FLAGS};
}
function holdingDefense(events,accounts,quotes,asOf,preferences={}){
 const runs=analysisEvents(events,asOf),rows=[];
 for(const [accountId,account]of Object.entries(accounts||{})){
  const positions=Object.entries(account.positions||{}),marks=new Map();
  for(const [symbol]of positions){const q=quotes?.get?.(symbol)?.wireQuote||quotes?.get?.(symbol);if(q&&quoteUseEligibility(q,asOf).canTrade)marks.set(symbol,q);}
  const complete=marks.size===positions.length,total=complete?positions.reduce((n,[s,p])=>n+marks.get(s).price*p.shares,0):null;
  for(const [symbol,p]of positions){
   const entry=runs.filter(e=>e.data.symbol===symbol&&e.recordedAt<=(p.buyTs||0)&&e.data.asOf<=(p.buyTs||0)).at(-1);
   const latest=runs.filter(e=>e.data.symbol===symbol&&(!entry||e.data.provider===entry.data.provider)).at(-1);
   const q=marks.get(symbol),raw=quotes?.get?.(symbol)?.wireQuote||quotes?.get?.(symbol),quote=quoteObservationView(raw,asOf),cost=finite(p.buyPrice)?p.buyPrice:finite(p.cost)?p.cost:null,weight=total>0?q.price*p.shares/total*100:null;
   const originally=new Set(array(entry?.data.conditions).filter(c=>c.status==='pass'&&!c.coverageOnly).map(c=>c.id));
   const invalidated=array(latest?.data.conditions).filter(c=>originally.has(c.id)&&c.status==='fail');
   const missing=array(latest?.data.conditions).filter(c=>originally.has(c.id)&&c.status==='unknown');
   const market=marketPosition(events,symbol,asOf);
   rows.push({accountId,symbol,name:p.name||symbol,price:q?.price??null,lastObservedPrice:finite(raw?.price)?raw.price:null,quoteAt:quote.quoteAt,quoteAgeMs:quote.quoteAgeMs,quoteStatus:quote.quoteStatus,quoteMissingReason:quote.missingReason,
    cost,shares:p.shares,weightPct:round(weight),weightBasis:'current-holdings-market-value-excluding-cash',
    costChangePct:q&&cost>0?round((q.price/cost-1)*100):null,entryRunId:entry?.hash??null,currentRunId:latest?.hash??null,
    entryEvidenceAt:entry?.recordedAt??null,entryTradeDate:entry?.data.tradeDate??null,currentEvidenceAt:latest?.recordedAt??null,currentTradeDate:latest?.data.tradeDate??null,
    invalidated:invalidated.map(c=>({id:c.id,name:c.name,evidenceIds:c.evidenceIds})),missing:missing.map(c=>c.field),
    locked:!!p.locked,muted:!!p.mute,concentrationWarning:weight!==null&&weight>=(preferences.maxPositionPct||30),
    avoidedBoards:market.boards.filter(b=>array(preferences.avoidSectors).includes(b.name)).map(b=>b.name),excludedByResearchPreference:array(preferences.excludedSymbols).includes(symbol),
    boards:market.boards.map(b=>({code:b.code,name:b.name,memberHash:b.memberHash,category:b.category})),
    status:!q?'quote-unusable':!entry?'entry-evidence-missing':invalidated.length?'review-invalidation':'observed-unverified'});
  }
 }
 const exposures=new Map();
 for(const p of rows)for(const b of p.boards){const key=p.accountId+'|'+b.category+'|'+b.code;const e=exposures.get(key)||{accountId:p.accountId,name:b.name,code:b.code,symbols:[],weightPct:0,complete:true};e.symbols.push(p.symbol);if(p.weightPct===null)e.complete=false;else e.weightPct+=p.weightPct;exposures.set(key,e);}
 return {rows,exposures:[...exposures.values()].map(e=>({...e,weightPct:e.complete?round(e.weightPct):null})),
  meaning:'只读原账户；主题有交叉不能相加为总仓位，缺少完整报价不输出估值权重',...FLAGS};
}
function qualityReport(decision){
 const bySource=new Map();
 for(const e of array(decision?.evidence)){const key=e.source||'unknown';const r=bySource.get(key)||{source:key,total:0,known:0,missing:0,maxAgeMs:null};r.total++;
  if(e.value===null||e.availableAt===null)r.missing++;else{r.known++;const age=decision.asOf-e.availableAt;r.maxAgeMs=Math.max(r.maxAgeMs??0,age);}bySource.set(key,r);}
 const gaps=new Map();for(const c of array(decision?.conditions).filter(c=>c.status==='unknown')){const g=gaps.get(c.field)||{field:c.field,strategies:new Set(),reason:c.reason};g.strategies.add(c.system);gaps.set(c.field,g);}
 return {sources:[...bySource.values()],gaps:[...gaps.values()].map(g=>({...g,strategies:[...g.strategies],affectedStrategies:g.strategies.size})).sort((a,b)=>b.affectedStrategies-a.affectedStrategies||a.field.localeCompare(b.field)),...FLAGS};
}
module.exports={analysisEvents,marketPosition,timeline,scorecards,holdingDefense,qualityReport};
