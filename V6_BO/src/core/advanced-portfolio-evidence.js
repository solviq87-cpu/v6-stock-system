'use strict';
// Read-only supplementary evidence calculations; never grants trade permission or writes accounts.
const {executionCapacity}=require('./execution-risk');
const {quoteUseEligibility}=require('./quote-observation-view');
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
function capacityScenarios({prior,asOf,price,lotSize,capitalLevels,targetWeight,maxParticipationPct,feeBps,impactBpsAtLimit}={}){
 if(!stamp(asOf)||!positive(price)||!Number.isSafeInteger(lotSize)||lotSize<=0||lotSize>10000||!Array.isArray(capitalLevels)||!capitalLevels.length||capitalLevels.length>50||!capitalLevels.every(x=>positive(x)&&x<=1e12)||!positive(targetWeight)||targetWeight>1||!positive(maxParticipationPct)||maxParticipationPct>100||![feeBps,impactBpsAtLimit].every(x=>finite(x)&&x>=0&&x<=10000))return unknown("INVALID_SCENARIO");
 if(!prior||!day(prior.date)||!label(prior.source)||!label(prior.dataVersion)||!stamp(prior.availableAt)||prior.availableAt>asOf||Date.parse(prior.date+"T15:00:00+08:00")>prior.availableAt||prior.date>=new Date(asOf+28800000).toISOString().slice(0,10)||prior.priceBasis!=="unadjusted"||prior.evidenceKind!=="historical"||!positive(prior.amount)||!positive(prior.volume)||prior.volumeUnit!=="shares")return unknown("PRIOR_LIQUIDITY_UNAVAILABLE");
 const limit=maxParticipationPct/100;
 const turnoverCap=Math.floor(prior.amount*limit/price/lotSize)*lotSize;
 const rows=capitalLevels.map(capital=>{
  const desired=Math.floor(capital*targetWeight/price/lotSize)*lotSize;
  const participation=executionCapacity({volumeUnit:"shares"},prior,desired,lotSize,{maxParticipationPct}).shares;
  const executable=Math.max(0,Math.min(desired,participation,turnoverCap));
  const notional=executable*price;
  const impact=impactBpsAtLimit*Math.sqrt(notional/prior.amount/limit);
  return {capital,desiredShares:desired,estimatedShares:executable,fillFraction:desired?executable/desired:null,estimatedNotional:round(notional),assumedImpactBps:round(impact),estimatedCost:round(notional*(feeBps+impact)/10000),estimatedNetReturn:null};
 });
 return report({rows,source:prior.source,dataVersion:prior.dataVersion,observedDate:prior.date,assumptions:["前日未复权量额参与率双重上限，不代表当前盘口","平方根冲击为用户给定压力假设，未经实盘校准","费用为压力参数，未认证真实成交与收益"]});
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
 const liquidity=prior&&day(prior.date)&&prior.date<new Date(now+28800000).toISOString().slice(0,10)&&label(prior.source)&&label(prior.dataVersion)&&stamp(prior.availableAt)&&prior.availableAt<=now&&Date.parse(prior.date+"T15:00:00+08:00")<=prior.availableAt&&prior.evidenceKind==="historical"&&positive(prior.volume)&&prior.volumeUnit==="shares"&&positive(prior.amount)&&positive(maxParticipationPct)&&maxParticipationPct<=100;
 const cap=liquidity?Math.floor(prior.volume*maxParticipationPct/100):null;
 if(cap===null||cap===0||position.sellable>cap)add("LIQUIDITY_EXIT","high",cap===null?"前日成交量或参与率未知":"持仓可卖数量超过单日历史参与率容量","无法保证单日退出","核对成交量、金额与盘口","取得足量可执行流动性");
 const clear=q?.canTrade===true&&suspended===false&&limitDown===false&&cap!==null&&cap>0;
 return report({symbol:position.symbol,sellable:position.sellable,restrictedQuantity:position.quantity-position.sellable,historicalDailyShares:cap,conditionalSessions:clear?Math.ceil(position.sellable/cap):null,estimatedExitCost:clear&&finite(assumedExitBps)&&assumedExitBps>=0&&assumedExitBps<=10000?round(position.sellable*quote.price*assumedExitBps/10000):null,alerts,guaranteedFill:false,quoteAt:q?.quoteAt??null,liquiditySource:liquidity?prior.source:null,liquidityVersion:liquidity?prior.dataVersion:null,assumptions:["历史容量及成本仅为压力预演；止损不保证成交"]});
}
function cashFlowPerformance({initialAt,initialEquity,rows,benchmark}={}){
 if(!stamp(initialAt)||!positive(initialEquity)||!Array.isArray(rows)||!rows.length||rows.length>10000)return unknown("MISSING_EQUITY_BOUNDARIES");
 let previousAt=initialAt,previous=initialEquity,external=0,factor=1;
 const cash=[{at:initialAt,amount:-initialEquity}];
 for(const x of rows){
  if(!x||!stamp(x.at)||x.at<=previousAt||!label(x.evidenceRef)||!finite(x.equityBeforeFlow)||x.equityBeforeFlow<0||!finite(x.externalFlow)||!finite(x.equityAfterFlow)||x.equityAfterFlow<0||Math.abs(x.equityBeforeFlow+x.externalFlow-x.equityAfterFlow)>0.011||previous<=0)return unknown("INCOMPLETE_OR_INCONSISTENT_FLOW_BOUNDARY");
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
 const bench=benchmark&&label(benchmark.source)&&label(benchmark.dataVersion)&&benchmark.initialAt===initialAt&&benchmark.finalAt===previousAt&&positive(benchmark.initialValue)&&positive(benchmark.finalValue)?benchmark.finalValue/benchmark.initialValue-1:null;
 return report({initialAt,finalAt:previousAt,observations:rows.length,externalNetFlow:round(external),investmentPnl:round(previous-initialEquity-external),timeWeightedReturn:round(factor-1),moneyWeightedAnnualReturn:mwr===null?null:round(mwr),moneyWeightedReason:mwr===null?"NO_UNIQUE_BOUNDED_XIRR":null,benchmarkReturn:bench===null?null:round(bench),benchmarkExcess:bench===null?null:round(factor-1-bench),benchmarkSource:bench===null?null:benchmark.source,benchmarkVersion:bench===null?null:benchmark.dataVersion,riskAdjustedReturn:null,assumptions:["必须有每次外部现金流前后原账本权益，不用充值冒充收益","XIRR使用实际日数/365；多重符号变化不猜测唯一解","未核实连续交易日净值，风险调整收益未知"]});
}
function tailRisk({assets,observations,asOf,confidence=.95}={}){
 if(!stamp(asOf)||!Array.isArray(assets)||!assets.length||assets.length>100||!assets.every(a=>a&&symbol(a.symbol)&&positive(a.weight)&&a.weight<=1)||new Set(assets.map(a=>a.symbol)).size!==assets.length||assets.reduce((s,a)=>s+a.weight,0)>1+1e-9||![.9,.95,.99].includes(confidence)||!Array.isArray(observations)||observations.length<60||observations.length>3000)return unknown("INSUFFICIENT_ALIGNED_EVIDENCE");
 const codes=assets.map(a=>a.symbol);let last="";
 for(const o of observations){
  if(!o||!day(o.date)||o.date<=last||!stamp(o.availableAt)||o.availableAt>asOf||Date.parse(o.date+"T15:00:00+08:00")>o.availableAt||!label(o.source)||!label(o.dataVersion)||o.evidenceKind!=="historical"||o.returnBasis!=="total-return"||!o.returns||!codes.every(c=>finite(o.returns[c])&&o.returns[c]>=-1&&o.returns[c]<=100))return unknown("MISSING_DUPLICATE_OR_FUTURE_RETURN");
  last=o.date;
 }
 const vectors=observations.map(o=>codes.map(c=>o.returns[c]));
 const p=vectors.map(v=>v.reduce((s,x,i)=>s+x*assets[i].weight,0));
 const n=p.length,mu=mean(p),varp=p.reduce((s,x)=>s+(x-mu)**2,0)/(n-1),sd=Math.sqrt(varp);
 const k=Math.max(1,Math.ceil(n*(1-confidence)-1e-9));
 const order=p.map((x,i)=>({loss:-x,i})).sort((a,b)=>b.loss-a.loss||a.i-b.i);
 const worst=order.slice(0,k);
 const tailKnown=k>=10;
 const contributions=assets.map((a,i)=>{
  const vals=vectors.map(v=>v[i]),mi=mean(vals);
  const cov=vals.reduce((s,x,j)=>s+(x-mi)*(p[j]-mu),0)/(n-1);
  return {symbol:a.symbol,weight:a.weight,volatilityContribution:sd>0?round(a.weight*cov/sd):null,tailLossContribution:tailKnown?round(mean(worst.map(x=>-vectors[x.i][i]*a.weight))):null,industry:label(a.industry)?a.industry:null,theme:label(a.theme)?a.theme:null};
 });
 const groups=(field)=>{
  const g=new Map();
  for(const c of contributions){const key=c[field]??"未分类";const x=g.get(key)||{group:key,weight:0,volatilityContribution:sd>0?0:null,tailLossContribution:tailKnown?0:null};x.weight+=c.weight;if(sd>0)x.volatilityContribution+=c.volatilityContribution;if(tailKnown)x.tailLossContribution+=c.tailLossContribution;g.set(key,x);}
  return [...g.values()];
 };
 const correlations=[];
 for(let i=0;i<codes.length;i++)for(let j=i+1;j<codes.length;j++){
  const corr=(vv)=>{const a=vv.map(v=>v[i]),b=vv.map(v=>v[j]),am=mean(a),bm=mean(b);const den=Math.sqrt(a.reduce((s,x)=>s+(x-am)**2,0)*b.reduce((s,x)=>s+(x-bm)**2,0));return den>0?round(a.reduce((s,x,k)=>s+(x-am)*(b[k]-bm),0)/den):null;};
  const recent=corr(vectors.slice(-30)),previous=corr(vectors.slice(-60,-30));
  correlations.push({symbols:[codes[i],codes[j]],recent30:recent,previous30:previous,change:recent===null||previous===null?null:round(recent-previous)});
 }
 return report({sampleCount:n,start:observations[0].date,end:last,confidence,tailCount:k,dailyVolatility:round(sd),dailyDownsideDeviation:round(Math.sqrt(mean(p.map(x=>Math.min(0,x)**2)))),historicalVaR:tailKnown?round(order[k-1].loss):null,historicalES:tailKnown?round(mean(worst.map(x=>x.loss))):null,tailReason:tailKnown?null:"FEWER_THAN_TEN_TAIL_OBSERVATIONS",contributions,industryContributions:groups("industry"),themeContributions:groups("theme"),correlations,assumptions:["同日完整总收益率、当前固定多头权重，现金收益设0","历史等权单日场景；正损失为风险，负贡献可能抵消风险","尾部至少10个观测；不保证未来最大损失，不认证上游数据"]});
}
function previewPosition({snapshot,plan,gate}={}){
 if(!snapshot||!label(snapshot.evidenceRef)||!positive(snapshot.equity)||!finite(snapshot.cash)||snapshot.cash<0||!finite(snapshot.availableCash)||snapshot.availableCash<0||snapshot.availableCash>snapshot.cash||!Array.isArray(snapshot.positions)||snapshot.positions.length>1000||!snapshot.positions.every(p=>p&&symbol(p.symbol)&&finite(p.marketValue)&&p.marketValue>=0)||new Set(snapshot.positions.map(p=>p.symbol)).size!==snapshot.positions.length)return unknown("ACCOUNT_PROJECTION_UNAVAILABLE");
 if(Math.abs(snapshot.cash+snapshot.positions.reduce((s,p)=>s+p.marketValue,0)-snapshot.equity)>0.011)return unknown("ACCOUNT_EQUITY_NOT_RECONCILED");
 if(!plan||!label(plan.evidenceRef)||!symbol(plan.symbol)||!positive(plan.price)||!Number.isSafeInteger(plan.quantity)||plan.quantity<=0||!finite(plan.fee)||plan.fee<0)return unknown("PLAN_OR_COST_UNAVAILABLE");
 const gross=plan.price*plan.quantity,total=gross+plan.fee,afterEquity=snapshot.equity-plan.fee;
 if(!positive(afterEquity)||!finite(total))return unknown("INVALID_POST_FILL_EQUITY");
 const positions=snapshot.positions.map(p=>({...p}));
 const existing=positions.find(p=>p.symbol===plan.symbol);
 if(existing)existing.marketValue+=gross;else positions.push({symbol:plan.symbol,marketValue:gross,industry:plan.industry,theme:plan.theme,strategy:plan.strategy});
 const groups=field=>{const g=new Map();for(const p of positions){const key=label(p[field])?p[field]:"未分类";g.set(key,(g.get(key)||0)+p.marketValue);}return [...g.entries()].map(([group,value])=>({group,weight:round(value/afterEquity)}));};
 const gateStatus=gate&&label(gate.evidenceRef)&&["allowed","blocked","unknown"].includes(gate.status)?gate.status:"unknown";
 return report({cashAfter:round(snapshot.cash-total),availableCashAfter:round(snapshot.availableCash-total),totalWeight:round(positions.reduce((s,p)=>s+p.marketValue,0)/afterEquity),symbolWeight:round(positions.find(p=>p.symbol===plan.symbol).marketValue/afterEquity),industry:groups("industry"),theme:groups("theme"),strategy:groups("strategy"),riskBudgetAfter:null,incrementalPortfolioRisk:null,originalGateStatus:gateStatus,previewBlocked:total>snapshot.availableCash||gateStatus!=="allowed",assumptions:["假设按后端计划价全额成交，费用即刻扣除；不是订单","风控预算与增量风险缺证据保持未知；原门禁结果不是执行授权"]});
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
module.exports={capacityScenarios,exitRisk,cashFlowPerformance,tailRisk,previewPosition,pointInTimeVersion};
