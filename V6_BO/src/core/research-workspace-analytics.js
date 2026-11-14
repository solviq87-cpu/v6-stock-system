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
 const eligible=analysisEvents(events,asOf),own=eligible.filter(e=>e.data.symbol===symbol),latest=own.at(-1)?.data;
 const out={status:'unknown',role:'unknown',phase:'unknown',boards:[],scope:'selected-frozen-boards-only',...FLAGS};
 if(!latest)return {...out,reason:'尚无该股封存观察'};
 for(const board of array(latest.context?.sectorContext?.current?.boards)){
  if(!board.membershipComplete||!array(board.members).includes(symbol)||new Set(board.members).size!==board.members.length||board.quoteDate!==latest.tradeDate||
   !Number.isSafeInteger(board.quoteAt)||board.quoteAt>latest.asOf||day(board.quoteAt)!==board.quoteDate||board.quoteAt<Date.parse(board.quoteDate+'T15:00:00+08:00')||!Number.isSafeInteger(board.membersObservedAt)||board.membersObservedAt>latest.asOf)continue;
  const memberHash=digest([...board.members].sort()),history=new Map();
  for(const e of own){const b=array(e.data.context?.sectorContext?.current?.boards).find(b=>b.category===board.category&&b.code===board.code);
   if(b?.membershipComplete&&array(b.members).length&&digest([...b.members].sort())===memberHash&&b.quoteDate===e.data.tradeDate&&Number.isSafeInteger(b.quoteAt)&&day(b.quoteAt)===b.quoteDate&&b.quoteAt>=Date.parse(b.quoteDate+'T15:00:00+08:00')&&b.quoteAt<=e.data.asOf&&Number.isSafeInteger(b.membersObservedAt)&&b.membersObservedAt<=e.data.asOf&&finite(b.changePct))history.set(b.quoteDate,{date:b.quoteDate,changePct:b.changePct,evidence:e.hash});}
  const last3=[...history.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-3),dates=latest.tradeDates;
  const consecutive=last3.length===3&&last3.every((r,i)=>!i||dates.indexOf(r.date)===dates.indexOf(last3[i-1].date)+1)&&dates.includes(last3[0]?.date);
  const phase=consecutive?last3[2].changePct>last3[1].changePct&&last3[1].changePct>last3[0].changePct?'warming':
   last3[2].changePct<last3[1].changePct&&last3[1].changePct<last3[0].changePct?'cooling':'mixed':'unknown';
  const members=new Map();for(const e of eligible){const s=e.data;if(board.members.includes(s.symbol)&&s.tradeDate===latest.tradeDate&&s.provider===latest.provider&&s.bars.length>=2){const b=s.bars.at(-1),p=s.bars.at(-2),i=latest.tradeDates.indexOf(b.date);if(i>0&&p.date===latest.tradeDates[i-1]&&p.close>0&&b.knownAt<=asOf)members.set(s.symbol,{symbol:s.symbol,changePct:100*(b.close/p.close-1),evidence:e.hash});}}
  const ranked=[...members.values()].sort((a,b)=>b.changePct-a.changePct||a.symbol.localeCompare(b.symbol));
  const coverage=ranked.length/board.members.length,rank=ranked.findIndex(r=>r.symbol===symbol)+1;
  const role=ranked.length>=5&&coverage>=.8&&rank?rank<=Math.max(1,Math.ceil(ranked.length*.2))?'relative-front':rank>ranked.length*.8?'relative-back':'relative-middle':'unknown';
  out.boards.push({code:board.code,name:board.name,category:board.category,tradeDate:board.quoteDate,quoteAt:board.quoteAt,membersObservedAt:board.membersObservedAt,
   memberHash,memberCount:board.members.length,observedMembers:ranked.length,coveragePct:round(coverage*100),rank:role==='unknown'?null:rank,
   phase,role,history:last3,phaseBasis:'同成员连续3个交易日涨幅变化，仅描述性观察',roleBasis:'已封存同日成员涨幅相对位置，不认证龙头',
   changePct:finite(board.changePct)?board.changePct:null,mainNetInflow:finite(board.mainNetInflow)?board.mainNetInflow:null});
 }
 out.status=out.boards.length?'observed-unverified':'unknown';
 out.role=out.boards.find(b=>b.role!=='unknown')?.role||'unknown';out.phase=out.boards.find(b=>b.phase!=='unknown')?.phase||'unknown';
 out.reason=out.boards.length?'按明确选择的板块展示，不代表全市场主线或因果关系':'缺少同日成员和板块时点';return out;
}
function timeline(events,symbol,asOf){
 const rows=analysisEvents(events,asOf).filter(e=>e.data.symbol===symbol);
 const latestByIdentity=new Map();
 return rows.map(e=>{
  const key=e.data.provider+'|'+e.data.priceBasis,prior=latestByIdentity.get(key);latestByIdentity.set(key,e);
  return {id:e.hash,sequence:e.sequence,recordedAt:e.recordedAt,asOf:e.data.asOf,tradeDate:e.data.tradeDate,provider:e.data.provider,
   targetDate:e.data.targetDate,dueAt:e.data.dueAt,systems:e.data.systems,
   changes:conditionChanges(e.data,prior?.data),status:e.data.dueAt&&e.data.dueAt<=asOf?'awaiting-evidence':'observed'};
 });
}
function scorecards(events,{asOf=Date.now(),feeBps=8,slippageBps=10,sellTaxBps=5}={}){
 if(![feeBps,slippageBps,sellTaxBps].every(x=>finite(x)&&x>=0&&x<=1000))throw Error('成绩单费用假设无效');
 const runs=analysisEvents(events,asOf),latest=new Map(),first=new Map();
 for(const e of runs){latest.set(e.data.symbol+'|'+e.data.provider,e.data);const d=e.data;for(const s of d.systems){const key=[d.symbol,d.provider,d.tradeDate,s.id,s.version].join('|');if(!first.has(key))first.set(key,{run:e,data:d,system:s});}}
 const buckets=new Map(),observations=[];
 for(const {run,data:d,system:s}of first.values())for(const horizon of [1,5,20,60]){
  const key=[s.id,s.version,d.regime,horizon,d.provider].join('|');
  if(!buckets.has(key))buckets.set(key,{system:s.id,version:s.version,regime:d.regime,horizon,provider:d.provider,total:0,passed:0,rejected:0,unknown:0,pending:0,missing:0,blocked:0,price:[],net:[],excess:[],dates:new Set(),symbols:new Set(),windows:[]});
  const b=buckets.get(key);b.total++;
  if(s.verdict!=='pass'){b[s.verdict==='fail'?'rejected':'unknown']++;continue;}b.passed++;
  const current=latest.get(d.symbol+'|'+d.provider),dates=array(current?.tradeDates),index=dates.indexOf(d.tradeDate);
  const entryDate=dates[index+1],exitDate=dates[index+1+horizon];
  if(index<0||!exitDate||exitDate>day(asOf)){b.pending++;continue;}
  const entry=current.bars.find(x=>x.date===entryDate),exit=current.bars.find(x=>x.date===exitDate);
  const obs={runId:run.hash,symbol:d.symbol,system:s.id,horizon,signalDate:d.tradeDate,entryDate,exitDate,status:'missing',netReturnPct:null};
  if(!entry||!exit||entry.knownAt>asOf||exit.knownAt>asOf){b.missing++;observations.push(obs);continue;}
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
  const entryLimit=limits(entry),exitLimit=limits(exit),windowDates=dates.slice(index+1,index+2+horizon),windowBars=current.bars.filter(x=>windowDates.includes(x.date));
  const actionVerified=windowBars.length===windowDates.length&&windowBars.every(x=>x.corporateAction===false&&Number.isSafeInteger(x.corporateActionKnownAt)&&x.corporateActionKnownAt<=Date.parse(x.date+'T09:30:00+08:00'));
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
  assumptions:{feeBps,slippageBps,sellTaxBps,entry:'next-session-open',exit:'entry-plus-horizon-session-open',quantityMode:'percentage-paper-estimate-not-account-ledger'},
  limitations:['含成本估计不是权威模拟账本收益；不报告没有成交证据的净收益','同股连续信号和重叠周期非独立样本；不按收益自动调权','缺同日期/口径基准时超额保持未知'],...FLAGS};
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
