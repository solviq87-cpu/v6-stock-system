'use strict';
// Read-only supplementary evidence calculations; never grants trade permission or writes accounts.
const {executionCapacity}=require('./execution-risk');
const {quoteUseEligibility}=require('./quote-observation-view');
const {evaluateEntryRisk}=require('./common-entry-risk');
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const stamp=x=>Number.isSafeInteger(x)&&x>0&&x<=8e15;
const label=x=>typeof x==="string"&&x.trim()===x&&x.length>0&&x.length<=128&&!/[\u0000-\u001f\u007f]/.test(x);
const symbol=x=>typeof x==="string"&&/^\d{6}$/.test(x);
const day=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const unknown=(reason)=>({status:"unknown",reason,canTrade:false,writesAccount:false});
const report=(data)=>({status:"estimated-unverified",canTrade:false,writesAccount:false,...data});
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const round=x=>Math.round(x*1e8)/1e8;
function liquidityKnown(prior,asOf){
 return !!(prior&&day(prior.date)&&label(prior.source)&&label(prior.dataVersion)&&stamp(prior.availableAt)&&prior.availableAt<=asOf&&Date.parse(prior.date+"T15:00:00+08:00")<=prior.availableAt&&prior.date<new Date(asOf+28800000).toISOString().slice(0,10)&&prior.evidenceKind==="historical"&&positive(prior.amount)&&positive(prior.volume)&&prior.volumeUnit==="shares"&&(prior.amountUnit===undefined||prior.amountUnit==="CNY")&&(prior.priceBasis==="unadjusted"||prior.turnoverBasis==="original-turnover"&&prior.amountUnit==="CNY"));
}
function capacityScenarios({prior,asOf,price,lotSize,capitalLevels,targetWeight,maxParticipationPct,feeBps,impactBpsAtLimit,feeEstimator}={}){
 if(!stamp(asOf)||!positive(price)||!Number.isSafeInteger(lotSize)||lotSize<=0||lotSize>10000||!Array.isArray(capitalLevels)||!capitalLevels.length||capitalLevels.length>50||!capitalLevels.every(x=>positive(x)&&x<=1e12)||!positive(targetWeight)||targetWeight>1||!positive(maxParticipationPct)||maxParticipationPct>100||![feeBps,impactBpsAtLimit].every(x=>finite(x)&&x>=0&&x<=10000))return unknown("INVALID_SCENARIO");
 if(!liquidityKnown(prior,asOf))return unknown("PRIOR_LIQUIDITY_UNAVAILABLE");
 if(feeEstimator!==undefined&&typeof feeEstimator!=="function")return unknown("SCENARIO_FEE_UNAVAILABLE");
 const limit=maxParticipationPct/100;
 const turnoverCap=Math.floor(prior.amount*limit/price/lotSize)*lotSize;
 let rows;
 try{rows=capitalLevels.map(capital=>{
  const budget=capital*targetWeight;
  let desired=Math.floor(budget/price/lotSize)*lotSize;
  if(!Number.isSafeInteger(desired))throw Error("quantity range");
  const feeFor=shares=>{if(!shares)return 0;const fee=feeEstimator?feeEstimator(shares):shares*price*feeBps/10000;if(!finite(fee)||fee<0)throw Error("fee");return fee;};
  if(feeEstimator){let lo=0,hi=desired/lotSize;while(lo<hi){const mid=Math.ceil((lo+hi)/2),shares=mid*lotSize;if(shares*price+feeFor(shares)<=budget+1e-9)lo=mid;else hi=mid-1;}desired=lo*lotSize;}
  const participation=executionCapacity({volumeUnit:"shares"},prior,desired,lotSize,{maxParticipationPct}).shares;
  const executable=Math.max(0,Math.min(desired,participation,turnoverCap));
  const notional=executable*price;
  const impact=impactBpsAtLimit*Math.sqrt(notional/prior.amount/limit);
  const fee=feeFor(executable),impactCost=notional*impact/10000;
  return {capital,budget:round(budget),desiredShares:desired,estimatedShares:executable,fillFraction:desired?executable/desired:null,estimatedNotional:round(notional),estimatedFee:round(fee),estimatedMarketImpact:round(impactCost),assumedImpactBps:round(impact),estimatedCost:round(fee+impactCost),estimatedTotalOutlay:round(notional+fee+impactCost),cashBufferRequired:round(Math.max(0,notional+fee+impactCost-budget)),estimatedNetReturn:null};
 });}catch{return unknown("SCENARIO_FEE_UNAVAILABLE");}
 return report({rows,source:prior.source,dataVersion:prior.dataVersion,observedDate:prior.date,availableAt:prior.availableAt,priceBasis:prior.priceBasis,turnoverBasis:prior.turnoverBasis||"original-turnover",assumptions:["前日原始量额参与率双重上限；估值使用当前原报价，不把复权价当成交价","平方根冲击为压力假设，未经实盘校准","费用和冲击仅为情景估计，未认证真实成交与收益"]});
}
function exitRisk({position,quote,now,limitDown,suspended,prior,maxParticipationPct,assumedExitBps}={}){
 if(!stamp(now)||!position||!symbol(position.symbol)||!Number.isSafeInteger(position.quantity)||position.quantity<0||!Number.isSafeInteger(position.sellable)||position.sellable<0||position.sellable>position.quantity)return unknown("AUTHORITATIVE_POSITION_OR_SELLABLE_UNKNOWN");
 const alerts=[];
 const add=(code,severity,basis,restriction,check,release)=>alerts.push({code,severity,basis,object:position.symbol,restriction,check,release});
 if(position.sellable<position.quantity)add("SELLABLE_RESTRICTED","high","可卖数量少于持仓；可能为T+1或冻结","不得预演卖出超出可卖数量的部分","核对原批次与冻结账本","原后台确认可卖数量");
 if(suspended===true)add("SUSPENDED","critical","权威停牌标志","无法假设退出","核对交易所状态","复牌并通过原门禁");
 if(limitDown===true)add("LIMIT_DOWN","high","已知跌停标志","无法保证卖出","核对真实盘口及买方流动性","原门禁与实际成交条件恢复");
 const q=quote?.code===position.symbol?quoteUseEligibility(quote,now):null;
 if(!q?.canTrade)add("QUOTE_INELIGIBLE","high",q?.missingReason||"缺少对应个股可用原始报价","不得据此执行","检查来源、时点和权限","原报价门禁恢复");
 if(typeof suspended!=="boolean"||typeof limitDown!=="boolean")add("EXIT_STATUS_UNKNOWN","high","停牌或跌停状态未知","不能确认退出能力","核对交易所与行情状态","状态有据");
 const liquidity=liquidityKnown(prior,now)&&positive(maxParticipationPct)&&maxParticipationPct<=100;
 const calculatedCap=liquidity&&q?.canTrade?Math.floor(Math.min(prior.volume,prior.amount/quote.price)*maxParticipationPct/100):null;
 const cap=Number.isSafeInteger(calculatedCap)&&calculatedCap>=0?calculatedCap:null;
 if(cap===null||cap===0||position.sellable>cap)add("LIQUIDITY_EXIT","high",cap===null?"前日成交量或参与率未知":"持仓可卖数量超过单日历史参与率容量","无法保证单日退出","核对成交量、金额与盘口","取得足量可执行流动性");
 const clear=q?.canTrade===true&&suspended===false&&limitDown===false&&cap!==null&&cap>0;
 // A capacity estimate for today's sellable subset is not an exit estimate
 // for the whole holding. In particular, T+1 or frozen shares are not zero risk.
 const restrictedQuantity=position.quantity-position.sellable;
 const subsetKnown=clear&&(position.sellable>0||position.quantity===0);
 const conditionalSellableSessions=subsetKnown?Math.ceil(position.sellable/cap):null;
 // Preserve the legacy STATIC current-mark friction when the caller supplies
 // an explicit bps assumption. It is not an estimate of future multi-session
 // executions, fees or prices. The runtime separately projects one session.
 const subsetCost=subsetKnown&&finite(assumedExitBps)&&assumedExitBps>=0&&assumedExitBps<=10000?round(position.sellable*quote.price*assumedExitBps/10000):null;
 const estimatedSellableExitCost=finite(subsetCost)?subsetCost:null;
 return report({symbol:position.symbol,sellable:position.sellable,restrictedQuantity,historicalDailyShares:cap,
  conditionalSessions:restrictedQuantity===0?conditionalSellableSessions:null,
  estimatedExitCost:restrictedQuantity===0?estimatedSellableExitCost:null,
  conditionalSellableSessions,estimatedSellableExitCost,exitEstimateQuantity:subsetKnown?position.sellable:null,
  exitCostBasis:estimatedSellableExitCost===null?"unavailable":"static-current-mark-bps-only",
  staticSellableMarkFriction:estimatedSellableExitCost,
  staticWholeMarkFriction:restrictedQuantity===0?estimatedSellableExitCost:null,
  staticMarkFrictionBps:estimatedSellableExitCost===null?null:assumedExitBps,
  multiSessionExitCost:null,actualExitCost:null,
  alerts,guaranteedFill:false,quoteAt:q?.quoteAt??null,liquiditySource:liquidity?prior.source:null,liquidityVersion:liquidity?prior.dataVersion:null,
  assumptions:["历史容量仅为压力预演；止损不保证成交","存在T+1或冻结数量时整仓退出时间及成本未知；局部估计只覆盖明确可卖部分","本底层estimatedExitCost/estimatedSellableExitCost在显式基点假设下仅兼容静态现价摩擦；跨时段费用、价格、冲击与实际成交成本未知"]});
}
function cashFlowPerformance({initialAt,initialEquity,rows,benchmark,asOf=Date.now(),dailyEvidence}={}){
 if(!stamp(asOf)||!stamp(initialAt)||initialAt>asOf||!positive(initialEquity)||!Array.isArray(rows)||!rows.length||rows.length>10000)return unknown("MISSING_EQUITY_BOUNDARIES");
 let previousAt=initialAt,previous=initialEquity,external=0,factor=1;const references=new Set();
 const cash=[{at:initialAt,amount:-initialEquity}];
 for(const x of rows){
  if(!x||!stamp(x.at)||x.at<=previousAt||x.at>asOf||!label(x.evidenceRef)||references.has(x.evidenceRef)||!finite(x.equityBeforeFlow)||x.equityBeforeFlow<0||!finite(x.externalFlow)||!finite(x.equityAfterFlow)||x.equityAfterFlow<0||Math.abs(x.equityBeforeFlow+x.externalFlow-x.equityAfterFlow)>0.011||previous<=0)return unknown("INCOMPLETE_OR_INCONSISTENT_FLOW_BOUNDARY");
  references.add(x.evidenceRef);
  factor*=x.equityBeforeFlow/previous;external+=x.externalFlow;
  if(!finite(factor)||!finite(external))return unknown("NUMERIC_RANGE");
  cash.push({at:x.at,amount:-x.externalFlow});previous=x.equityAfterFlow;previousAt=x.at;
 }
 cash[cash.length-1].amount+=previous;
 const flows=cash.filter(x=>x.amount!==0);
 const signs=flows.slice(1).filter((x,i)=>Math.sign(x.amount)!==Math.sign(flows[i].amount)).length;
 let mwr=null;
 if(signs===1&&flows[0].amount<0&&flows.at(-1).amount>0){
  const npv=logRate=>flows.reduce((s,x)=>s+x.amount*Math.exp(-logRate*(x.at-initialAt)/(365*86400000)),0);
  let lo=-16,hi=16;
  if(npv(lo)>0&&npv(hi)<0){for(let i=0;i<100;i++){const mid=(lo+hi)/2;if(npv(mid)>0)lo=mid;else hi=mid;}mwr=Math.expm1((lo+hi)/2);}
 }
 const bench=benchmark&&label(benchmark.source)&&label(benchmark.dataVersion)&&benchmark.initialAt===initialAt&&benchmark.finalAt===previousAt&&positive(benchmark.initialValue)&&positive(benchmark.finalValue)&&(benchmark.knownAt===undefined||stamp(benchmark.knownAt)&&benchmark.knownAt>=previousAt&&benchmark.knownAt<=asOf)?benchmark.finalValue/benchmark.initialValue-1:null;
 const riskAdjustedReturn=equityDailyRisk({initialAt,initialEquity,rows,asOf,dailyEvidence});
 return report({initialAt,finalAt:previousAt,observations:rows.length,externalNetFlow:round(external),investmentPnl:round(previous-initialEquity-external),timeWeightedReturn:round(factor-1),moneyWeightedAnnualReturn:mwr===null||!finite(mwr)?null:round(mwr),moneyWeightedReason:mwr===null||!finite(mwr)?"NO_UNIQUE_BOUNDED_XIRR":null,benchmarkReturn:bench===null?null:round(bench),benchmarkExcess:bench===null?null:round(factor-1-bench),benchmarkSource:bench===null?null:benchmark.source,benchmarkVersion:bench===null?null:benchmark.dataVersion,riskAdjustedReturn:riskAdjustedReturn.status==="unknown"?null:riskAdjustedReturn,riskAdjustedReason:riskAdjustedReturn.status==="unknown"?riskAdjustedReturn.reason:null,factorVersion:"fayo-flow-performance-v2",assumptions:["必须有每次外部现金流前后原账本权益，不用充值冒充收益","XIRR使用实际日数/365；多重符号变化不猜测唯一解","风险调整收益仅由同一权益边界的连续交易日回报计算；缺少日历或时点证据保持未知"]});
}
function equityDailyRisk({initialAt,initialEquity,rows,asOf,dailyEvidence}){
 const e=dailyEvidence,calendar=e?.calendar;
 if(!e||!label(e.source)||!label(e.dataVersion)||!stamp(e.knownAt)||e.knownAt>asOf||e.knownAt<rows.at(-1).at||!calendar||!label(calendar.source)||!stamp(calendar.knownAt)||calendar.knownAt>asOf||!finite(e.riskFreeAnnual)||e.riskFreeAnnual<=-1||e.riskFreeAnnual>1||!label(e.riskFreeBasis)||rows.length<60)return unknown("MISSING_CONTINUOUS_DAILY_EQUITY_EVIDENCE");
 const dateOf=t=>new Date(t+28800000).toISOString().slice(0,10),close=d=>Date.parse(d+"T15:00:00+08:00");
 let previousDate=dateOf(initialAt),previous=initialEquity,wealth=1,peak=1,maxDrawdown=0;const returns=[];
 if(initialAt!==close(previousDate))return unknown("INTRADAY_FLOW_BOUNDARIES_NOT_DAILY_RETURNS");
 for(const row of rows){
  const currentDate=dateOf(row.at),edge=calendar.nextEvidenceByDay?.[previousDate];
  if(row.at!==close(currentDate)||!edge||edge.nextTradingDay!==currentDate||!stamp(edge.knownAt)||edge.knownAt>asOf||!label(edge.source)||(calendar.conflictingDays||[]).includes(previousDate))return unknown("MISSING_CONTINUOUS_DAILY_EQUITY_EVIDENCE");
  const r=row.equityBeforeFlow/previous-1;returns.push(r);wealth*=1+r;peak=Math.max(peak,wealth);maxDrawdown=Math.max(maxDrawdown,1-wealth/peak);previous=row.equityAfterFlow;previousDate=currentDate;
 }
 const rf=Math.expm1(Math.log1p(e.riskFreeAnnual)/252),excess=returns.map(r=>r-rf),mu=mean(excess),sd=Math.sqrt(mean(excess.map(r=>(r-mu)**2))*returns.length/(returns.length-1)),downside=Math.sqrt(mean(excess.map(r=>Math.min(0,r)**2)));
 return report({sampleCount:returns.length,source:e.source,dataVersion:e.dataVersion,knownAt:e.knownAt,annualization:252,riskFreeAnnual:e.riskFreeAnnual,riskFreeBasis:e.riskFreeBasis,annualizedVolatility:round(sd*Math.sqrt(252)),sharpe:sd>0?round(mu/sd*Math.sqrt(252)):null,sortino:downside>0?round(mu/downside*Math.sqrt(252)):null,maximumFlowAdjustedDrawdown:round(maxDrawdown),factorVersion:"fayo-equity-daily-risk-v1"});
}
function tailRisk({assets,observations,asOf,confidence=.95,returnBasis="total-return"}={}){
 if(!["total-return","adjusted-price"].includes(returnBasis))return unknown("UNSUPPORTED_RETURN_BASIS");
 if(!stamp(asOf)||!Array.isArray(assets)||!assets.length||assets.length>100||!assets.every(a=>a&&symbol(a.symbol)&&positive(a.weight)&&a.weight<=1)||new Set(assets.map(a=>a.symbol)).size!==assets.length||assets.reduce((s,a)=>s+a.weight,0)>1+1e-9||![.9,.95,.99].includes(confidence)||!Array.isArray(observations)||observations.length<60||observations.length>3000)return unknown("INSUFFICIENT_ALIGNED_EVIDENCE");
 const codes=assets.map(a=>a.symbol);let last="";
 for(const o of observations){
  if(!o||!day(o.date)||o.date<=last||!stamp(o.availableAt)||o.availableAt>asOf||Date.parse(o.date+"T15:00:00+08:00")>o.availableAt||!label(o.source)||!label(o.dataVersion)||o.evidenceKind!=="historical"||o.returnBasis!==returnBasis||!o.returns||!codes.every(c=>finite(o.returns[c])&&o.returns[c]>=-1&&o.returns[c]<=100))return unknown("MISSING_DUPLICATE_OR_FUTURE_RETURN");
  last=o.date;
 }
 const vectors=observations.map(o=>codes.map(c=>o.returns[c]));
 const p=vectors.map(v=>v.reduce((s,x,i)=>s+x*assets[i].weight,0));
 const n=p.length,mu=mean(p),varp=p.reduce((s,x)=>s+(x-mu)**2,0)/(n-1),sd=Math.sqrt(varp);
 const k=Math.max(1,Math.ceil(n*(1-confidence)-1e-9));
 const order=p.map((x,i)=>({loss:-x,i})).sort((a,b)=>b.loss-a.loss||a.i-b.i);
 const worst=order.slice(0,k);
 const tailKnown=k>=10;
 const downside=Math.sqrt(mean(p.map(x=>Math.min(0,x)**2)));
 const varBoundary=tailKnown?order.filter(x=>x.loss===order[k-1].loss):[];
 const contributions=assets.map((a,i)=>{
  const vals=vectors.map(v=>v[i]),mi=mean(vals);
  const cov=vals.reduce((s,x,j)=>s+(x-mi)*(p[j]-mu),0)/(n-1);
  return {symbol:a.symbol,weight:a.weight,volatilityContribution:sd>0?round(a.weight*cov/sd):null,downsideContribution:downside>0?round(a.weight*mean(p.map((x,j)=>x<0?x*vals[j]:0))/downside):null,varScenarioContribution:tailKnown?round(mean(varBoundary.map(x=>-vectors[x.i][i]*a.weight))):null,tailLossContribution:tailKnown?round(mean(worst.map(x=>-vectors[x.i][i]*a.weight))):null,industry:label(a.industry)?a.industry:null,theme:label(a.theme)?a.theme:null};
 });
 const groups=(field)=>{
  const g=new Map();
  for(const c of contributions){const key=c[field]??"未分类";const x=g.get(key)||{group:key,weight:0,volatilityContribution:sd>0?0:null,downsideContribution:downside>0?0:null,varScenarioContribution:tailKnown?0:null,tailLossContribution:tailKnown?0:null};x.weight+=c.weight;if(sd>0)x.volatilityContribution+=c.volatilityContribution;if(downside>0)x.downsideContribution+=c.downsideContribution;if(tailKnown){x.varScenarioContribution+=c.varScenarioContribution;x.tailLossContribution+=c.tailLossContribution;}g.set(key,x);}
  return [...g.values()];
 };
 const correlations=[];
 for(let i=0;i<codes.length;i++)for(let j=i+1;j<codes.length;j++){
  const corr=(vv)=>{const a=vv.map(v=>v[i]),b=vv.map(v=>v[j]),am=mean(a),bm=mean(b);const den=Math.sqrt(a.reduce((s,x)=>s+(x-am)**2,0)*b.reduce((s,x)=>s+(x-bm)**2,0));return den>0?round(a.reduce((s,x,k)=>s+(x-am)*(b[k]-bm),0)/den):null;};
  const recent=corr(vectors.slice(-30)),previous=corr(vectors.slice(-60,-30));
  correlations.push({symbols:[codes[i],codes[j]],recent30:recent,previous30:previous,change:recent===null||previous===null?null:round(recent-previous)});
 }
 return report({sampleCount:n,start:observations[0].date,end:last,confidence,tailCount:k,returnBasis,factorVersion:"fayo-historical-tail-v2",dailyVolatility:round(sd),dailyDownsideDeviation:round(downside),historicalVaR:tailKnown?round(order[k-1].loss):null,historicalES:tailKnown?round(mean(worst.map(x=>x.loss))):null,tailReason:tailKnown?null:"FEWER_THAN_TEN_TAIL_OBSERVATIONS",varAttributionBasis:"kth-worst-loss-boundary-equal-loss-scenarios-averaged",varBoundaryScenarioCount:varBoundary.length,contributions,industryContributions:groups("industry"),themeContributions:groups("theme"),correlations,assumptions:[returnBasis==="total-return"?"同日完整总收益率、当前固定多头权重，现金收益设0":"同日后复权价格变动场景、当前固定多头权重，现金收益设0；并非经认证总收益率","历史等权单日场景；正损失为风险，负贡献可能抵消风险","波动与下行偏差为Euler贡献；VaR按最差ceil(n×尾部比例)的边界场景归因，同损失场景取均值，不冒充连续分布边际VaR","尾部至少10个观测；不保证未来最大损失，不认证上游数据"]});
}
function previewPosition({snapshot,plan,gate,riskContext,observations,asOf,returnBasis="total-return"}={}){
 if(!snapshot||!label(snapshot.evidenceRef)||!positive(snapshot.equity)||!finite(snapshot.cash)||snapshot.cash<0||!finite(snapshot.availableCash)||snapshot.availableCash<0||snapshot.availableCash>snapshot.cash||!Array.isArray(snapshot.positions)||snapshot.positions.length>1000||!snapshot.positions.every(p=>p&&symbol(p.symbol)&&finite(p.marketValue)&&p.marketValue>=0)||new Set(snapshot.positions.map(p=>p.symbol)).size!==snapshot.positions.length)return unknown("ACCOUNT_PROJECTION_UNAVAILABLE");
 if(Math.abs(snapshot.cash+snapshot.positions.reduce((s,p)=>s+p.marketValue,0)-snapshot.equity)>0.011)return unknown("ACCOUNT_EQUITY_NOT_RECONCILED");
 if(!plan||!label(plan.evidenceRef)||!symbol(plan.symbol)||!positive(plan.price)||!Number.isSafeInteger(plan.quantity)||plan.quantity<=0||!finite(plan.fee)||plan.fee<0)return unknown("PLAN_OR_COST_UNAVAILABLE");
 const gross=plan.price*plan.quantity,total=gross+plan.fee,afterEquity=snapshot.equity-plan.fee;
 if(!positive(afterEquity)||!finite(total))return unknown("INVALID_POST_FILL_EQUITY");
 const positions=snapshot.positions.map(p=>({...p}));
 const existing=positions.find(p=>p.symbol===plan.symbol);
 if(existing)existing.marketValue+=gross;else positions.push({symbol:plan.symbol,marketValue:gross,industry:plan.industry,theme:plan.theme,strategy:plan.strategy});
 // A new lot can use a different strategy even when the stock is already held.
 // Keep that capital separate instead of assigning it to the old stock label.
 const strategyPositions=[...snapshot.positions,{marketValue:gross,strategy:plan.strategy}];
 const groups=field=>{const g=new Map();for(const p of field==="strategy"?strategyPositions:positions){const key=label(p[field])?p[field]:"未分类";g.set(key,(g.get(key)||0)+p.marketValue);}return [...g.entries()].map(([group,value])=>({group,weight:round(value/afterEquity)}));};
 const gateStatus=gate&&label(gate.evidenceRef)&&["allowed","blocked","unknown"].includes(gate.status)?gate.status:"unknown";
 let riskBudgetAfter=null;
 if(riskContext?.policy&&label(riskContext.evidenceRef))try{
  const values=snapshot.positions.map(p=>({symbol:p.symbol,quantity:p.marketValue,strategyId:p.strategy}));
  const checked=evaluateEntryRisk({policy:riskContext.policy,side:"buy",symbol:plan.symbol,strategyId:plan.strategy,quantity:plan.quantity,price:plan.price,cash:snapshot.cash,positions:values,pending:riskContext.pending||[],marks:Object.fromEntries(values.map(p=>[p.symbol,1])),sectors:Object.fromEntries([...snapshot.positions,plan].filter(p=>label(p.industry)).map(p=>[p.symbol,p.industry])),lossStreak:riskContext.lossStreak??null,previousClose:riskContext.previousClose??null});
  const budgets=[];
  for(const [field,kind] of [["maxPositionPct","single"],["maxGrossExposurePct","gross"],["maxSectorPct","sector"],["maxStrategyPct","strategy"]])if(riskContext.policy[field]!=null){const used=checked.exposure[kind],known=finite(used)&&positive(checked.exposure.equity);budgets.push({kind,limitPct:riskContext.policy[field],exposureAfter:known?round(used):null,remainingAtOriginalEquity:known?round(checked.exposure.equity*riskContext.policy[field]/100-used):null,remainingAfterEstimatedFee:known?round(afterEquity*riskContext.policy[field]/100-used):null});}
  riskBudgetAfter={status:"observed-unverified",policyVersion:checked.policyVersion,evidenceRef:riskContext.evidenceRef,originalEquityBasis:checked.exposure.equity,afterFeeEquity:afterEquity,estimatedConstraintsSatisfied:checked.allowed,reasonCodes:checked.reasonCodes,budgets,canTrade:false,writesAccount:false};
 }catch{riskBudgetAfter=unknown("ORIGINAL_RISK_POLICY_UNAVAILABLE");}
 const assets=(pp,equity)=>pp.filter(p=>p.marketValue>0).map(p=>({symbol:p.symbol,weight:p.marketValue/equity,industry:p.industry,theme:p.theme}));
 let incrementalPortfolioRisk=null;
 if(Array.isArray(observations)&&stamp(asOf)){
  const after=tailRisk({assets:assets(positions,afterEquity),observations,asOf,returnBasis});
  const beforeAssets=assets(snapshot.positions,snapshot.equity),before=beforeAssets.length?tailRisk({assets:beforeAssets,observations,asOf,returnBasis}):{status:"estimated-unverified",dailyVolatility:0,dailyDownsideDeviation:0,historicalVaR:0,historicalES:0};
  if(before.status!=="unknown"&&after.status!=="unknown"){
   const metrics={};for(const key of ["dailyVolatility","dailyDownsideDeviation","historicalVaR","historicalES"]){metrics[key]={before:before[key],after:after[key],change:finite(before[key])&&finite(after[key])?round(after[key]-before[key]):null};}
   incrementalPortfolioRisk={status:"estimated-unverified",metrics,sampleCount:after.sampleCount,start:after.start,end:after.end,returnBasis,factorVersion:after.factorVersion,canTrade:false,writesAccount:false};
  }else incrementalPortfolioRisk=unknown(after.reason||before.reason||"INCOMPLETE_ALIGNED_POSITION_HISTORY");
 }
 const policyBlocked=riskBudgetAfter!==null&&(riskBudgetAfter.status==="unknown"||riskBudgetAfter.estimatedConstraintsSatisfied!==true);
 return report({cashAfter:round(snapshot.cash-total),availableCashAfter:round(snapshot.availableCash-total),equityAfter:round(afterEquity),totalWeight:round(positions.reduce((s,p)=>s+p.marketValue,0)/afterEquity),symbolWeight:round(positions.find(p=>p.symbol===plan.symbol).marketValue/afterEquity),industry:groups("industry"),theme:groups("theme"),strategy:groups("strategy"),riskBudgetAfter,incrementalPortfolioRisk,originalGateStatus:gateStatus,originalGateReason:label(gate?.reason)?gate.reason:null,previewBlocked:total>snapshot.availableCash||gateStatus!=="allowed"||policyBlocked,assumptions:["假设按后端计划价全额成交，费用即刻扣除；不是订单","沿原风控函数观察政策额度，待买委托计入敞口；政策检查不替代原事务回执","增量风险使用同一历史样本及当前持仓权重；原门禁结果不是执行授权"]});
}
// Reuse the existing non-overlapping calendar windows for both held-stock
// comparisons and available-cash scenarios. A broken edge restarts the window.
function opportunityWindows(observations,horizon,build){
 const periods=[];let buffer=[];
 for(const o of observations){
  if(!day(o.previousDate)||o.previousDate>=o.date)return null;
  if(buffer.length&&o.previousDate!==buffer.at(-1).date)buffer=[];
  buffer.push(o);
  if(buffer.length===horizon){
   const compounded=code=>buffer.reduce((f,x)=>f*(1+x.returns[code]),1)-1;
   periods.push({start:buffer[0].previousDate,end:o.date,...build(compounded)});
   buffer=[];
  }
 }
 return periods;
}
// F24.4: the available cash alternative is the original account's free cash,
// not frozen funds or hypothetical proceeds from selling existing holdings.
function compareAvailableCash({snapshot,candidate,observations,asOf,horizon=5,returnBasis="total-return",confidence=.95}={}){
 if(!snapshot||!label(snapshot.evidenceRef)||!finite(snapshot.cash)||snapshot.cash<0||
  !positive(snapshot.availableCash)||snapshot.availableCash>snapshot.cash||snapshot.availableCash>1e12||
  !candidate||!symbol(candidate.symbol)||!label(candidate.evidenceRef)||!positive(candidate.notional)||
  ![candidate.entryCost,candidate.exitCost].every(x=>finite(x)&&x>=0)||
  candidate.notional+candidate.entryCost>snapshot.availableCash||
  !Number.isSafeInteger(horizon)||horizon<1||horizon>20)return unknown("INCOMPARABLE_AVAILABLE_CASH_OR_COST");
 const validation=tailRisk({assets:[{symbol:candidate.symbol,weight:1}],observations,asOf,confidence,returnBasis});
 if(validation.status==="unknown")return validation;
 const capital=snapshot.availableCash;
 const periods=opportunityWindows(observations,horizon,compounded=>({
  net:(candidate.notional*compounded(candidate.symbol)-candidate.entryCost-candidate.exitCost)/capital}));
 if(!periods)return unknown("MISSING_HORIZON_CALENDAR_ALIGNMENT");
 if(periods.length<12||periods.some(p=>!finite(p.net)))return unknown("FEWER_THAN_TWELVE_PAIRED_HORIZONS");
 const values=periods.map(p=>p.net),mu=mean(values),n=values.length;
 const losses=values.map(x=>-x).sort((a,b)=>b-a),k=Math.ceil(n*(1-confidence)-1e-9);
 return report({symbol:candidate.symbol,accountEvidenceRef:snapshot.evidenceRef,gateEvidenceRef:candidate.evidenceRef,
  capital,uninvestedCash:round(capital-candidate.notional-candidate.entryCost),notional:candidate.notional,
  entryCost:candidate.entryCost,exitCost:candidate.exitCost,horizonSessions:horizon,sampleCount:n,
  start:periods[0].start,end:periods.at(-1).end,asOf,returnBasis,confidence,
  cashBaseline:{meanNetReturn:0,interestAssumption:'explicit-zero-interest',actualYieldVerified:false},
  candidate:{meanNetReturn:round(mu),volatility:round(Math.sqrt(mean(values.map(x=>(x-mu)**2))*n/(n-1))),
   downsideDeviation:round(Math.sqrt(mean(values.map(x=>Math.min(0,x)**2)))),
   historicalVaR:k>=10?round(losses[k-1]):null,historicalES:k>=10?round(mean(losses.slice(0,k))):null},
  meanNetDifference:round(mu),historicalCandidateAdvantageFraction:values.filter(v=>v>0).length/n,
  historicalMeanAboveCash:mu>0,recommendation:null,automaticSwitch:false,canTrain:false,
  assumptions:['同一原账户可用现金、固定候选份额；不释放冻结资金、不假设卖出现有持仓',
   '零现金利息为比较假设，候选计当前费用与冲击的入场和退出压力；未来收益、真实成交及利息未验证']});
}
// Paired, non-overlapping historical scenarios use the same capital, dates,
// horizon and return basis. They are not forecasts or a switching instruction.
function compareOpportunity({hold,candidate,observations,asOf,horizon=5,returnBasis="total-return",confidence=.95}={}){
 if(!hold||!candidate||!symbol(hold.symbol)||!symbol(candidate.symbol)||hold.symbol===candidate.symbol||!label(hold.evidenceRef)||!label(candidate.evidenceRef)||!positive(hold.notional)||!positive(candidate.notional)||![hold.exitCost,candidate.entryCost,candidate.exitCost,candidate.cashRemainder].every(x=>finite(x)&&x>=0)||Math.abs(candidate.notional+candidate.entryCost+candidate.cashRemainder-hold.notional)>.011||!Number.isSafeInteger(horizon)||horizon<1||horizon>20)return unknown("INCOMPARABLE_CAPITAL_OR_COST_EVIDENCE");
 const validation=tailRisk({assets:[{symbol:hold.symbol,weight:.5},{symbol:candidate.symbol,weight:.5}],observations,asOf,confidence,returnBasis});
 if(validation.status==="unknown")return validation;
 const periods=opportunityWindows(observations,horizon,compounded=>{
  const holdNet=(hold.notional*compounded(hold.symbol)-hold.exitCost)/hold.notional;
  const candidateNet=(candidate.notional*compounded(candidate.symbol)-candidate.entryCost-candidate.exitCost)/hold.notional;
  return {holdNet,candidateNet,difference:candidateNet-holdNet};
 });
 if(!periods)return unknown("MISSING_HORIZON_CALENDAR_ALIGNMENT");
 if(periods.length<12)return unknown("FEWER_THAN_TWELVE_PAIRED_HORIZONS");
 const summary=field=>{const values=periods.map(p=>p[field]),mu=mean(values),losses=values.map(x=>-x).sort((a,b)=>b-a),k=Math.ceil(values.length*(1-confidence)-1e-9);return {meanNetReturn:round(mu),volatility:round(Math.sqrt(values.reduce((s,x)=>s+(x-mu)**2,0)/(values.length-1))),downsideDeviation:round(Math.sqrt(mean(values.map(x=>Math.min(0,x)**2)))),historicalVaR:k>=10?round(losses[k-1]):null,historicalES:k>=10?round(mean(losses.slice(0,k))):null,tailReason:k>=10?null:"FEWER_THAN_TEN_TAIL_OBSERVATIONS"};};
 const differences=periods.map(p=>p.difference).sort((a,b)=>a-b),n=differences.length;
 return report({holdSymbol:hold.symbol,candidateSymbol:candidate.symbol,capital:hold.notional,investedInCandidate:candidate.notional,cashRemainder:candidate.cashRemainder,holdExitCost:hold.exitCost,switchEntryCost:candidate.entryCost,candidateExitCost:candidate.exitCost,incrementalTransactionCost:round(candidate.entryCost+candidate.exitCost-hold.exitCost),horizonSessions:horizon,sampleCount:n,start:periods[0].start,end:periods.at(-1).end,asOf,returnBasis,confidence,hold:summary("holdNet"),candidate:summary("candidateNet"),meanNetDifference:round(mean(differences)),medianNetDifference:round(n%2?differences[(n-1)/2]:(differences[n/2-1]+differences[n/2])/2),historicalCandidateAdvantageFraction:periods.filter(p=>p.difference>0).length/n,automaticSwitch:false,recommendation:null,factorVersion:"fayo-paired-opportunity-v1",assumptions:["相同已知时点、同一非重叠持有期与资本比较；零现金利息","继续持有计期末卖出成本；替换计现在卖出、买入及期末卖出成本，费用与冲击按当前假设","历史均值和胜出比例不是预期收益或换仓建议；未来价差和流动性未知"]});
}
function validateVersionRows(rows){
 if(!Array.isArray(rows)||rows.length>50000)throw Error("INVALID_VERSION_COLLECTION");
 const groups=new Map();
 for(const row of rows){
  if(!row||!label(row.id)||!label(row.source)||!label(row.dataVersion)||!label(row.factorVersion)||!Number.isSafeInteger(row.version)||row.version<1||!stamp(row.eventAt)||!stamp(row.originalAt)||!stamp(row.receivedAt)||!stamp(row.firstAvailableAt)||row.eventAt>row.originalAt||row.originalAt>row.receivedAt||row.receivedAt>row.firstAvailableAt||typeof row.payloadHash!=="string"||!/^[a-f0-9]{64}$/.test(row.payloadHash)||(row.version===1?row.revisedAt!==null:!stamp(row.revisedAt)||row.revisedAt<row.originalAt||row.revisedAt>row.receivedAt))throw Error("INVALID_TIME_OR_VERSION_EVIDENCE");
  const key=JSON.stringify([row.source,row.id]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 for(const items of groups.values()){
  items.sort((a,b)=>a.version-b.version);
  for(let i=0;i<items.length;i++){
   const x=items[i],p=items[i-1];
   if(x.version!==i+1||p&&(x.eventAt!==p.eventAt||x.originalAt!==p.originalAt||x.firstAvailableAt<=p.firstAvailableAt||x.receivedAt<p.receivedAt||x.revisedAt<(p.revisedAt??p.originalAt)))throw Error("VERSION_CHAIN_CONFLICT");
  }
 }
 return groups;
}
function pointInTimeVersion(rows,{source,id,eventThrough,decisionAt}={}){
 if(!label(source)||!label(id)||!stamp(eventThrough)||!stamp(decisionAt)||eventThrough>decisionAt)throw Error("INVALID_AS_OF");
 const list=validateVersionRows(rows).get(JSON.stringify([source,id]))||[];
 const row=list.filter(x=>x.eventAt<=eventThrough&&x.firstAvailableAt<=decisionAt).at(-1);
 return row?{status:"observed-unverified",canTrade:false,record:{...row}}:unknown("NOT_KNOWN_AT_DECISION");
}
// A group of independently checked plans is not a jointly approved batch.
// Reuse exact existing per-plan budget receipts, not labels or fresh policy guesses.
function previewPlanBatch({snapshot,plans,policy=null,accountRevision}={}){
 const fail=(reason,extra={})=>({status:"unknown",reason,canTrade:false,writesAccount:false,reservesCash:false,requiresSequentialRecheck:true,...extra});
 const cents=n=>finite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))&&Math.abs(n*100-Math.round(n*100))<=0.001?Math.round(n*100):null;
 const sum=xs=>{let n=0;for(const x of xs){if(x===null||!Number.isSafeInteger(x)||!Number.isSafeInteger(n+x))return null;n+=x;}return n;};
 const money=n=>Number.isSafeInteger(n)?n/100:null;
 if(!snapshot||!label(snapshot.evidenceRef)||!Number.isSafeInteger(accountRevision)||accountRevision<1||
    !Array.isArray(snapshot.positions)||snapshot.positions.length>1000||new Set(snapshot.positions.map(x=>x?.symbol)).size!==snapshot.positions.length||
    !snapshot.positions.every(x=>symbol(x?.symbol)&&cents(x.marketValue)!==null)||
    !Array.isArray(plans)||!plans.length||plans.length>20)return fail("BATCH_OR_ACCOUNT_EVIDENCE_UNAVAILABLE");
 const cash=cents(snapshot.cash),free=cents(snapshot.availableCash),eq=cents(snapshot.equity),held=sum(snapshot.positions.map(x=>cents(x.marketValue)));
 if([cash,free,eq,held].includes(null)||eq<=0||free>cash||sum([cash,held])!==eq)return fail("BATCH_CASH_OR_EQUITY_UNRECONCILED");
 const out={status:"estimated-unverified",canTrade:false,writesAccount:false,reservesCash:false,requiresSequentialRecheck:true,
  accountEvidenceRef:snapshot.evidenceRef,accountRevision,planCount:plans.length,existingReservedCash:money(cash-free),
  originalAvailableCash:money(free),originalEquity:money(eq),totalAdditionalNotional:null,totalEstimatedFees:null,
  availableCashAfter:null,afterFeeEquity:null,grossBudget:null,sharedSectorBudget:null,sharedStrategyBudget:null,
  planIds:[],symbols:[],reasonCodes:[],jointBudgetStatus:"unknown",jointlyApproved:false,
  note:"所有候选仅假设同时成交；原未成交委托已占用现金；每笔仍由原账户事务重新核验。未获证实的共同分类限额不推定通过。"};
 const reason=new Set();
 if(plans.some(p=>!label(p?.planId)||!symbol(p.symbol)||!label(p.gateEvidenceRef)||p.accountEvidenceRef!==snapshot.evidenceRef||
  p.accountRevision!==accountRevision||p.originalGateStatus!=="allowed"||p.previewBlocked!==false||p.status!=="estimated-unverified"||
  !Number.isSafeInteger(p.quantity)||p.quantity<=0||!positive(p.price)||cents(p.estimatedFee)===null||cents(p.quantity*p.price)===null))
  return fail("BATCH_INDIVIDUAL_PREVIEW_UNAVAILABLE",{planCount:plans.length});
 if(new Set(plans.map(p=>p.planId)).size!==plans.length||new Set(plans.map(p=>p.gateEvidenceRef)).size!==plans.length||
    new Set(plans.map(p=>p.symbol)).size!==plans.length)return fail("BATCH_DUPLICATE_PLAN_OR_SYMBOL",{planCount:plans.length});
 const rows=plans.map(p=>({p,gross:cents(p.quantity*p.price),fee:cents(p.estimatedFee)}));
 const totalGross=sum(rows.map(x=>x.gross)),fees=sum(rows.map(x=>x.fee)),total=sum([totalGross,fees]);
 if(total===null||fees>=eq)return fail("BATCH_NUMERIC_RANGE");
 Object.assign(out,{planIds:plans.map(p=>p.planId).sort(),symbols:plans.map(p=>p.symbol).sort(),
  totalAdditionalNotional:money(totalGross),totalEstimatedFees:money(fees),
  availableCashAfter:money(free-total),afterFeeEquity:money(eq-fees)});
 if(total>free)reason.add("SHARED_CASH_BUDGET_EXCEEDED");
 const policyKnown=policy===null||policy&&label(policy.version);
 if(!policyKnown)reason.add("ORIGINAL_POLICY_UNAVAILABLE");
 // Original single plan caps remain relevant after other candidate fees reduce
 // equity. The aggregate is only a conservative diagnostic, not a new limit.
 for(const {p,gross,fee} of rows){
  const cap=p.planAllocationBudgetAfter;
  const match=Array.isArray(cap?.budgets)?cap.budgets.filter(b=>b?.kind==="single"):[];
  const b=match[0],previous=cents(snapshot.positions.find(x=>x.symbol===p.symbol)?.marketValue??0);
  if(cap?.policyScope!=="original-plan-effective-position-cap"||cap.estimatedConstraintsSatisfied!==true||
     cents(cap.originalEquityBasis)!==eq||cents(cap.afterFeeEquity)!==eq-fee||match.length!==1||
     !positive(b.limitPct)||b.limitPct>100||cents(b.exposureAfter)!==sum([previous,gross])){
   reason.add("ORIGINAL_PLAN_CAP_UNAVAILABLE");continue;
  }
  if(b.exposureAfter>(eq-fees)/100*b.limitPct/100+1e-9)reason.add("SHARED_AFTER_FEE_PLAN_CAP_EXCEEDED");
 }
 if(policyKnown&&policy){
  const all=rows.map(({p,gross,fee})=>({p,gross,fee,b:p.riskBudgetAfter}));
  const bound=all.every(({p,fee,b})=>b?.policyScope==="original-account-readonly-preview"&&b.policyVersion===policy.version&&
   b.estimatedConstraintsSatisfied===true&&b.canTrade===false&&b.writesAccount===false&&label(b.evidenceRef)&&
   cents(b.originalEquityBasis)===eq&&cents(b.afterFeeEquity)===eq-fee&&Array.isArray(b.budgets));
  if(!bound)reason.add("ORIGINAL_COMMON_POLICY_RECEIPTS_UNAVAILABLE");
  else{
   // The actual common-entry risk receipt includes original pending buy
   // exposure. Subtract ONLY this candidate addition, then require agreement
   // across every independently obtained receipt before adding the batch.
   if(policy.maxGrossExposurePct!=null){
    const limit=policy.maxGrossExposurePct,baselines=[];
    for(const {b,gross} of all){
     const matches=b.budgets.filter(x=>x?.kind==="gross"),v=matches[0],after=cents(v?.exposureAfter);
     if(matches.length!==1||!positive(limit)||limit>100||v.limitPct!==limit||after===null||after<gross||after-gross<held){
      reason.add("ORIGINAL_GROSS_BUDGET_UNAVAILABLE");break;
     }
     baselines.push(after-gross);
    }
    if(baselines.length===rows.length&&new Set(baselines).size===1){
     const before=baselines[0],after=sum([before,totalGross]);
     if(after===null)reason.add("ORIGINAL_GROSS_BUDGET_UNAVAILABLE");
     else{
      const allowed=after/100<=eq/100*limit/100+1e-9,afterFeeAllowed=after/100<=(eq-fees)/100*limit/100+1e-9;
      out.grossBudget={limitPct:limit,originalExposureIncludingPending:money(before),originalPendingExposure:money(before-held),
       exposureAfter:money(after),remainingAtOriginalEquity:round(eq/100*limit/100-after/100),
       remainingAfterEstimatedFees:round((eq-fees)/100*limit/100-after/100),originalBasisWithinLimit:allowed,afterFeeWithinLimit:afterFeeAllowed};
      if(!allowed)reason.add("SHARED_GROSS_LIMIT_EXCEEDED");
      if(!afterFeeAllowed)reason.add("SHARED_AFTER_FEE_GROSS_LIMIT_EXCEEDED");
     }
    }else reason.add("ORIGINAL_GROSS_BASELINE_CONFLICT");
   }
   if(policy.maxPositionPct!=null)for(const {b} of all){
    const m=b.budgets.filter(x=>x?.kind==="single"),v=m[0];
    if(m.length!==1||!positive(policy.maxPositionPct)||policy.maxPositionPct>100||v.limitPct!==policy.maxPositionPct||cents(v.exposureAfter)===null)reason.add("ORIGINAL_SINGLE_BUDGET_UNAVAILABLE");
    else if(v.exposureAfter>(eq-fees)/100*policy.maxPositionPct/100+1e-9)reason.add("SHARED_AFTER_FEE_SINGLE_LIMIT_EXCEEDED");
   }
   // Do not aggregate sector/strategy merely by optional labels. The original
   // individual receipts are not a simultaneous attribution transaction.
   if(policy.maxSectorPct!=null)reason.add("SHARED_SECTOR_BUDGET_RECHECK_REQUIRED");
   if(policy.maxStrategyPct!=null)reason.add("SHARED_STRATEGY_BUDGET_RECHECK_REQUIRED");
  }
 }
 out.reasonCodes=[...reason].sort();
 out.jointBudgetStatus=out.reasonCodes.some(x=>x.endsWith("_EXCEEDED"))?"conditional-budget-exceeded":out.reasonCodes.length?"unknown":"conditional-cash-and-known-caps-within-limit";
 return out;
}
module.exports={capacityScenarios,exitRisk,cashFlowPerformance,tailRisk,previewPosition,previewPlanBatch,compareOpportunity,compareAvailableCash,pointInTimeVersion};
