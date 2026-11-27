'use strict';
// Read-only research candidates. The original account, quote, approval and order
// gates remain authoritative; this module cannot grant execution permission.
const S = require('./research-workspace-store');
const {quoteObservationView, quoteSourceAllowsUse} = require('./quote-observation-view');
const {tradingFees, validateFeePolicy, maxAffordableQuantity, paperBuyLotSize} = require('./trading-fees');
const {boundQuoteValuationMark} = require('./account-equity-evidence');
const {atLockedLimit, assertAligned} = require('../strategy/historical-session');
const {executionCapacity} = require('./execution-risk');
const {corporateAction, entitlement} = require('./corporate-actions');
const {validateUniverseHistory, universeObservation} = require('./historical-universe');
const {assertUnadjustedExecutionPriceBasis} = require('./historical-execution-price-basis');
const {validateEntryPolicy, evaluateEntryRisk} = require('./common-entry-risk');
const FLAGS = Object.freeze({researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false});
const finite = x => typeof x === 'number' && Number.isFinite(x);
const instant = x => Number.isSafeInteger(x) && x > 0 && x < 8e15;
const known = (x,at) => instant(x) && x <= at;
const nonnegative = x => finite(x) && x >= 0;
const fraction = x => finite(x) && x >= 0 && x <= 1;
const text = (x,n=160) => typeof x === 'string' && !/(?:bearer\s|password\s*[:=]|token\s*[:=]|sharecode|api[_-]?key\s*[:=])/i.test(x) ? x.trim().slice(0,n) : '';
const symbol = x => typeof x === 'string' && /^\d{6}$/.test(x);
const arr = x => Array.isArray(x) ? x : [];
const round = x => finite(x) ? Math.round(x*1e8)/1e8 : null;
const chinaDay = at => new Date(at+28800000).toISOString().slice(0,10);
const clone = value => S.canonical(value);
const atTime = x => { if(!instant(x))throw Error('研究需要明确的信息截止时间'); return x; };
const evidence = (x,at) => !!text(x?.source) && known(x?.knownAt,at);
const realResearchEvidence=require('../../public/nova/shortline/numeric-factors').realEvidence;
const nonRealTag=/(?:^|[-_: /\s])(?:test|fixture|mock|synthetic|simulated|simulation|demo|teaching)(?:$|[-_: /\s])/i;
const probabilityTag=/(?:ztToday|ztNext|up3Next|limit[-_ ]?up|probability|ranking[-_ ]?score)/i;
const declarationScope=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&realResearchEvidence(x)&&
 !['sampleSet','sampleScope','scope','dataMode','mode','source'].some(k=>nonRealTag.test(String(x[k]??'')))&&
 !['fixture','simulated','teaching','sourceConflict','conflict'].some(k=>x[k]===true)&&
 !['invalid','conflict','rejected','unknown','missing','stale'].includes(x.evidenceStatus);
const evidenceTimeFields=['knownAt','availableAt','receivedAt','recordedAt','firstKnownAt','sourceKnownAt','evaluatedAt','archiveReceivedAt'];
function researchEvidenceAt(x,at){
 if(!declarationScope(x)||!evidence(x,at))return null;
 const times=evidenceTimeFields.filter(k=>Object.hasOwn(x,k)).map(k=>x[k]);
 if(times.some(t=>!known(t,at)))return null;
 if(x.inputOrigin==='explicit-private-import'&&
    (!known(x.archiveReceivedAt,at)||typeof x.archiveHash!=='string'||!/^[a-f0-9]{64}$/.test(x.archiveHash)||x.independentlyVerified!==false))return null;
 return Math.max(...times);
}
const returnTargets=['return','expected-return','horizon-return','portfolio-return','portfolio-horizon-return','return-before-rebalance-costs'];
const fractionUnits=['fraction','ratio','decimal','return-fraction'];
const declaredValue=(x,key,allowed)=>!Object.hasOwn(x,key)||allowed.includes(x[key]);
const positiveSamples=(x)=>Number.isSafeInteger(x.sampleCount)&&x.sampleCount>=20&&
 ['matureSamples','matureSampleCount','effectiveSamples','effectiveSampleCount'].every(k=>!Object.hasOwn(x,k)||
  (Number.isSafeInteger(x[k])&&x[k]>=20&&x[k]<=x.sampleCount));
function returnEstimateValid(x,id,horizon,at){
 return researchEvidenceAt(x,at)!==null&&x.horizonDays===horizon&&positiveSamples(x)&&
  x.mature!==false&&(!Object.hasOwn(x,'symbol')||x.symbol===id)&&(!Object.hasOwn(x,'code')||x.code===id)&&
  !probabilityTag.test(String(x.source))&&declaredValue(x,'target',returnTargets)&&
  declaredValue(x,'unit',fractionUnits)&&declaredValue(x,'returnUnit',fractionUnits)&&
  declaredValue(x,'valueKind',['return','return-estimate','expected-return','model-estimate'])&&
  (x.valueKind!=='model-estimate'||returnTargets.includes(x.target)&&(fractionUnits.includes(x.unit)||fractionUnits.includes(x.returnUnit)))&&
  declaredValue(x,'returnBasis',['before-rebalance-costs','before-incremental-rebalance-costs','gross-of-rebalance-costs'])&&
  x.rebalanceCostsIncluded!==true&&x.includesRebalanceCosts!==true&&
  finite(x.expectedReturn)&&x.expectedReturn>=-1&&x.expectedReturn<=2&&
  nonnegative(x.standardError)&&x.standardError<=2&&finite(x.volatility)&&x.volatility>0&&x.volatility<=2;
}
function returnEvidenceView(rows,at){
 return {status:'unverified-research-declarations',forecastVerified:false,rows:rows.map(r=>{
  const e=r.estimate;
  return {symbol:r.symbol,source:text(e.source),sourceKnownAt:e.knownAt,archiveReceivedAt:e.archiveReceivedAt??null,
   effectiveKnownAt:researchEvidenceAt(e,at),archiveHash:e.inputOrigin==='explicit-private-import'?e.archiveHash:null,
   target:e.target??null,unit:e.unit??e.returnUnit??null,returnBasis:e.returnBasis??null,
   semanticBasis:e.target&&(e.unit||e.returnUnit)&&e.returnBasis?'typed-declaration':'legacy-or-partial-declaration',
   declaredSampleCount:e.sampleCount,declaredMatureEffectiveCount:Math.min(e.sampleCount,...['matureSamples','matureSampleCount','effectiveSamples','effectiveSampleCount'].filter(k=>Object.hasOwn(e,k)).map(k=>e[k])),
   sampleCountVerified:false};
 })};
}
function monetaryImprovementValid(x,at){
 return researchEvidenceAt(x,at)!==null&&!probabilityTag.test(String(x.source))&&
  declaredValue(x,'target',['expected-improvement','rebalance-improvement','expected-improvement-cny'])&&
  declaredValue(x,'unit',['CNY','yuan'])&&declaredValue(x,'valueKind',['amount-estimate','expected-improvement'])&&
  nonnegative(x.uncertainty)&&finite(x.expectedAmount);
}
const noAdjust = (missing,extra={}) => ({schemaVersion:1,status:'no-adjust',action:'不调整',missing:[...new Set(missing)],...extra,...FLAGS});

function positiveSemidefinite(matrix) {
  const n=matrix.length,L=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let value=matrix[i][j];for(let k=0;k<j;k++)value-=L[i][k]*L[j][k];
    if(i===j){if(value < -1e-8)return false;L[i][j]=Math.sqrt(Math.max(0,value));}
    else if(L[j][j]>1e-10)L[i][j]=value/L[j][j];else if(Math.abs(value)>1e-8)return false;
  }
  return true;
}

function portfolioInput(input,asOf) {
  const missing=[],a=input?.account||{},rows=arr(input?.candidates),c=input?.constraints||{},cost=input?.costs||{},co=input?.correlation||{};
  const need=(ok,message)=>{if(!ok)missing.push(message);};
  need(declarationScope(input),'组合研究声明含非正式或冲突样本标记');
  need(rows.length>0&&rows.length<=12,'需要1至12只候选，且包含全部现有持仓');
  need(text(a.authorityRef)&&Number.isSafeInteger(a.revision)&&a.revision>=0,'缺少原权威账户引用或版本');
  need(known(a.observedAt,asOf)&&asOf-a.observedAt<=15000,'账户投影时点未知、未来或超过15秒');
  need(finite(a.equity)&&a.equity>0&&a.equity<=1e15&&nonnegative(a.cash),'缺少有效账户权益与现金');
  need(nonnegative(a.availableCash)&&a.availableCash<=a.cash,'原账户可用资金未知，不能把总现金当作可用现金');
  need(Number.isSafeInteger(a.pendingBuyOrders)&&a.pendingBuyOrders===0,'原账户存在未终结买单或挂单状态未知');
  const countOk=n=>Number.isSafeInteger(n)&&n>=0;
  const ordersKnown=countOk(a.pendingOrders)&&countOk(a.pendingSellOrders)&&countOk(a.pendingBuyOrders)&&
    a.pendingOrders===a.pendingBuyOrders+a.pendingSellOrders;
  need(ordersKnown,'原账户挂单数量与买卖分项不一致或未知');
  const positions=arr(a.positions),pmap=new Map();
  need(Array.isArray(a.positions)&&positions.length<=50,'缺少完整持仓');
  let reservedSymbols=0;
  for(const p of positions){
    const valid=symbol(p?.symbol)&&!pmap.has(p.symbol)&&countOk(p.quantity)&&countOk(p.availableQuantity)&&p.availableQuantity<=p.quantity;
    need(valid,'持仓、可卖数量或唯一身份无效');
    if(!valid)continue;
    pmap.set(p.symbol,p);
    // Existing sell orders are accounted for by the original unavailable
    // quantity, not assumed proceeds. When present, the reservation must
    // reconcile with both the held shares and the account's order inventory.
    const hasReservation=Object.hasOwn(p,'pendingSellQuantity');
    if(hasReservation||ordersKnown&&a.pendingSellOrders>0){
      const q=p.pendingSellQuantity;
      need(countOk(q)&&q<=p.quantity-p.availableQuantity,'原持仓卖单冻结数量未知或不一致 '+p.symbol);
      if(countOk(q)&&q>0)reservedSymbols++;
    }
  }
  if(ordersKnown)need(reservedSymbols<=a.pendingSellOrders&&(a.pendingSellOrders===0||reservedSymbols>0),
    '原卖单与持仓冻结清单不一致');
  const ids=rows.map(r=>r?.symbol);need(new Set(ids).size===rows.length&&ids.every(symbol),'候选股票身份无效或重复');
  need(positions.every(p=>ids.includes(p?.symbol)),'候选未包含全部持仓，不能遗漏风险敞口');
  need(Number.isSafeInteger(input?.horizonDays)&&input.horizonDays>=1&&input.horizonDays<=60,'缺少明确研究持有周期');
  need(text(c.version),'缺少原约束版本');
  need(Number.isSafeInteger(c.maxPositions)&&c.maxPositions>=1&&c.maxPositions<=50,'缺少原后台有效持仓数量上限');
  for(const key of ['maxGrossWeight','maxSingleWeight','maxSectorWeight','minimumCashWeight','maxParticipation'])need(fraction(c[key]),'缺少有效约束 '+key);
  need(finite(c.maxVolatility)&&c.maxVolatility>0&&c.maxVolatility<=2,'缺少同周期风险预算');
  need(finite(c.riskAversion)&&c.riskAversion>=0&&c.riskAversion<=100,'缺少有界研究风险偏好');
  if(c.riskPolicy){try{validateEntryPolicy(c.riskPolicy);}catch{missing.push('原后台风险策略无效');}}
  need(researchEvidenceAt(cost,asOf)!==null,'缺少事前费用与滑点来源或收件证据');
  try{validateFeePolicy(cost.feePolicy);}catch{missing.push('缺少原版本费用规则');}
  for(const key of ['slippageBps','impactBps','uncertaintyBps'])need(nonnegative(cost[key])&&cost[key]<=1000,'成本分项缺失 '+key);
  const normalized=rows.map(r=>{
    const q=r?.quote||{},e=r?.estimate||{},l=r?.liquidity||{},p=pmap.get(r?.symbol)||{quantity:0,availableQuantity:0};
    let view;try{view=quoteObservationView(q,asOf);}catch{view={quoteStatus:'unknown',missingReason:'invalid-time'};}
    need(view.quoteStatus==='recent-unverified'&&view.missingReason===null,'原始报价不满足15秒门槛 '+String(r?.symbol));
    need(quoteSourceAllowsUse(q),'报价为只读、历史、合成或不可交易来源 '+String(r?.symbol));
    need(boundQuoteValuationMark(q,r?.symbol,asOf).price!==null,'原始报价标的、来源或时点不一致 '+String(r?.symbol));
    const lotSize=paperBuyLotSize(r?.symbol);
    need(r?.lotSize==null||r.lotSize===lotSize,'导入手数与原模拟盘规则不一致 '+String(r?.symbol));
    need(declarationScope(r)&&returnEstimateValid(e,r?.symbol,input.horizonDays,asOf),'预期收益声明的目标、单位、费用口径、事前来源、时点或成熟样本无效 '+String(r?.symbol));
    need(researchEvidenceAt(l,asOf)!==null&&finite(l.averageDailyAmount)&&l.averageDailyAmount>0,'缺少可核验历史流动性 '+String(r?.symbol));
    need(text(r?.sector),'缺少持仓行业分类 '+String(r?.symbol));
    return {symbol:r?.symbol,sector:text(r?.sector),strategyId:text(r?.strategyId)||null,quantity:p.quantity,availableQuantity:p.availableQuantity,
      price:q.price,currentWeight:p.quantity*q.price/a.equity,minimumWeight:(p.quantity-p.availableQuantity)*q.price/a.equity,
      estimate:e,liquidity:l,quote:view,lotSize};
  });
  if(finite(a.equity)&&a.equity>0&&normalized.every(r=>nonnegative(r.currentWeight)))need(Math.abs(a.cash/a.equity+normalized.reduce((n,r)=>n+r.currentWeight,0)-1)<1e-6,'账户权益与现金及全部持仓估值不一致');
  need(researchEvidenceAt(co,asOf)!==null&&co.horizonDays===input.horizonDays&&positiveSamples(co),'相关性缺少事前来源、同周期或20个对齐样本');
  const matrix=co.matrix,n=rows.length;
  const matrixOK=Array.isArray(co.symbols)&&co.symbols.length===n&&co.symbols.every((s,i)=>s===ids[i])&&Array.isArray(matrix)&&matrix.length===n&&matrix.every(row=>Array.isArray(row)&&row.length===n&&row.every(x=>finite(x)&&Math.abs(x)<=1))&&matrix.every((row,i)=>Math.abs(row[i]-1)<1e-8&&row.every((x,j)=>Math.abs(x-matrix[j][i])<1e-8));
  need(matrixOK&&positiveSemidefinite(matrix),'相关性矩阵顺序、对称性或半正定校验失败');
  if(missing.length)return {missing};
  const policy=c.riskPolicy||{};
  const bounds={...c,maxGrossWeight:Math.min(c.maxGrossWeight,1-c.minimumCashWeight,policy.maxGrossExposurePct==null?1:policy.maxGrossExposurePct/100),
    maxSingleWeight:Math.min(c.maxSingleWeight,policy.maxPositionPct==null?1:policy.maxPositionPct/100),
    maxSectorWeight:Math.min(c.maxSectorWeight,policy.maxSectorPct==null?1:policy.maxSectorPct/100)};
  return {missing:[],account:a,rows:normalized,cost,bounds,correlation:co,asOf,horizonDays:input.horizonDays};
}

function weightMetrics(weights,p) {
  const {rows,account:a,bounds:c,cost}=p;
  let expected=0,lower=0,variance=0,fee=0,slippage=0,turnover=0;const sectors=new Map(),changes=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i],w=weights[i],delta=w-r.currentWeight;
    expected+=w*r.estimate.expectedReturn;lower+=w*(r.estimate.expectedReturn-1.96*r.estimate.standardError);
    sectors.set(r.sector,(sectors.get(r.sector)||0)+w);
    for(let j=0;j<rows.length;j++)variance+=w*weights[j]*r.estimate.volatility*rows[j].estimate.volatility*p.correlation.matrix[i][j];
    if(Math.abs(delta)>1e-10){
      const quantity=Math.abs(delta)*a.equity/r.price;
      const f=tradingFees({side:delta>0?'buy':'sell',quantity,price:r.price,tradeDate:chinaDay(p.asOf),policy:cost.feePolicy});
      const friction=Math.abs(delta)*a.equity*(cost.slippageBps+cost.impactBps+cost.uncertaintyBps)/10000;
      fee+=f.total;slippage+=friction;turnover+=Math.abs(delta);
      changes.push({symbol:r.symbol,side:delta>0?'buy':'sell',quantity:round(quantity),notional:round(Math.abs(delta)*a.equity),fees:f.total,otherCost:round(friction)});
    }
  }
  const gross=weights.reduce((n,w)=>n+w,0),volatility=Math.sqrt(Math.max(0,variance)),totalCost=fee+slippage,violations=[];
  const fail=(condition,id)=>{if(condition)violations.push(id);};
  fail(weights.filter(w=>w>1e-10).length>c.maxPositions,'position-count');fail(gross>c.maxGrossWeight+1e-8,'gross-exposure');fail(1-gross-totalCost/a.equity<c.minimumCashWeight-1e-8,'cash-after-cost');
  const freeCashAfterCost=a.availableCash+(rows.reduce((n,r)=>n+r.currentWeight,0)-gross)*a.equity-totalCost;
  fail(freeCashAfterCost< -1e-6,'available-cash-after-cost');
  fail(volatility>c.maxVolatility+1e-8,'risk-budget');
  weights.forEach((w,i)=>{const r=rows[i];fail(w<r.minimumWeight-1e-8,'t-plus-one:'+r.symbol);fail(w>c.maxSingleWeight+1e-8,'single-name:'+r.symbol);
    fail(Math.abs(w-r.currentWeight)*a.equity>r.liquidity.averageDailyAmount*c.maxParticipation+1e-8,'liquidity:'+r.symbol);});
  for(const [sector,w] of sectors)fail(w>c.maxSectorWeight+1e-8,'sector:'+sector);
  if(c.riskPolicy)for(let i=0;i<rows.length;i++)if(weights[i]>rows[i].currentWeight+1e-10){
    const delta=weights[i]-rows[i].currentWeight,r=rows[i];
    const risk=evaluateEntryRisk({policy:c.riskPolicy,symbol:r.symbol,strategyId:r.strategyId,quantity:delta*a.equity/r.price,price:r.price,
      cash:a.equity*(1-gross+delta),positions:rows.map((x,j)=>({symbol:x.symbol,strategyId:x.strategyId,quantity:(weights[j]-(j===i?delta:0))*a.equity/x.price})).filter(x=>x.quantity>0),
      marks:Object.fromEntries(rows.map(x=>[x.symbol,x.price])),sectors:Object.fromEntries(rows.map(x=>[x.symbol,x.sector])),
      lossStreak:a.lossStreak??null,previousClose:a.previousClose??null});
    for(const reason of risk.reasonCodes)violations.push('original-risk:'+reason);
  }
  return {weights:rows.map((r,i)=>({symbol:r.symbol,weight:round(weights[i]),currentWeight:round(r.currentWeight),minimumWeight:round(r.minimumWeight)})),
    grossWeight:round(gross),cashWeightAfterCost:round(1-gross-totalCost/a.equity),availableCashAfterCost:round(freeCashAfterCost),expectedReturn:round(expected),conservativeReturn:round(lower),
    volatility:round(volatility),estimatedCosts:round(totalCost),fees:round(fee),friction:round(slippage),turnoverWeight:round(turnover),
    objective:round(lower-totalCost/a.equity-c.riskAversion*variance),constraintsSatisfied:violations.length===0,violations,changes};
}
function quantize(weights,p) {
  return weights.map((w,i)=>{
    const r=p.rows[i],quantity=w*p.account.equity/r.price;
    let target=quantity>=r.quantity?r.quantity+Math.floor((quantity-r.quantity+1e-7)/r.lotSize)*r.lotSize:
      Math.max(r.quantity-r.availableQuantity,Math.ceil(quantity-1e-7));
    return Math.max(0,target*r.price/p.account.equity);
  });
}
function researchPortfolioWeights(input={}, {asOf=Date.now()}={}) {
  atTime(asOf);const p=portfolioInput(input,asOf);
  if(p.missing.length)return noAdjust(p.missing,{asOf,task:73,current:null,equalWeight:null,candidate:null});
  const estimateEvidence=returnEvidenceView(p.rows,asOf);
  const currentWeights=p.rows.map(r=>r.currentWeight),minimum=p.rows.map(r=>r.minimumWeight),n=p.rows.length;
  const current=weightMetrics(currentWeights,p),equalWeight=weightMetrics(quantize(p.rows.map(r=>Math.max(r.minimumWeight,Math.min(p.bounds.maxSingleWeight,p.bounds.maxGrossWeight/n))),p),p);
  const seeds=[minimum,currentWeights,equalWeight.weights.map(r=>r.weight)].map(w=>({weights:w,metrics:weightMetrics(w,p)})).filter(v=>v.metrics.constraintsSatisfied);
  if(!seeds.length)return noAdjust(['可卖数量、流动性或风险约束暂不能同时满足'],{asOf,task:73,current,equalWeight,candidate:null,constraintsVersion:p.bounds.version,estimateEvidence});
  let best=seeds.sort((a,b)=>b.metrics.objective-a.metrics.objective)[0],evaluations=seeds.length;
  // A bounded discrete coordinate search, explicitly a candidate rather than
  // a claim of a globally optimal or executable portfolio.
  for(const step of [.05,.01,.002])for(let pass=0;pass<40;pass++){
    let improved=false;
    for(let i=0;i<n;i++)for(const direction of [-1,1]){
      const w=best.weights.slice();w[i]=Math.min(p.bounds.maxSingleWeight,Math.max(minimum[i],w[i]+direction*step));
      const target=quantize(w,p),metrics=weightMetrics(target,p);evaluations++;
      if(metrics.constraintsSatisfied&&metrics.objective>best.metrics.objective+1e-9){best={weights:target,metrics};improved=true;}
    }
    if(!improved)break;
  }
  const useful=best.metrics.turnoverWeight>1e-8&&(!current.constraintsSatisfied||best.metrics.objective>current.objective+1e-8);
  return {schemaVersion:1,task:73,status:useful?'research-candidate':'no-adjust',action:useful?'候选权重，待原流程核验':'不调整',asOf,
    accountRef:text(p.account.authorityRef),accountRevision:p.account.revision,constraintsVersion:p.bounds.version,costVersion:p.cost.feePolicy.version,
    horizonDays:p.horizonDays,estimateEvidence,uncertaintyMethod:'1.96倍标准误压力情景，未认证覆盖概率',cashReturnAssumption:0,current,equalWeight,candidate:useful?best.metrics:current,missing:[],
    comparison:{objectiveImprovement:round(best.metrics.objective-current.objective),volatilityChange:round(best.metrics.volatility-current.volatility),evaluations},
    limitations:['有界离散研究，不保证全局最优或未来收益','权重为研究候选；原账户、权限、行情、风控、批准及成交门禁仍需重新校验','1.96倍标准误仅作压力情景，未经独立验证不能称为置信覆盖率；现金收益假定为0'],...FLAGS};
}

function evaluateRebalanceThreshold(input={}, {asOf=Date.now()}={}) {
  atTime(asOf);
  // A cost preference can never veto an existing compulsory risk action.
  if(input.forcedRisk?.triggered===true)return {schemaVersion:1,task:74,status:'risk-action-priority',action:'交回原强制风险处置流程',filterMayBlock:false,
    riskRef:text(input.forcedRisk.reference)||null,missing:[],asOf,...FLAGS};
  const missing=[],improvement=input.improvement||{},costs=input.costs||{};
  if(!declarationScope(input)||!monetaryImprovementValid(improvement,asOf))missing.push('缺少可追溯的同周期人民币收益改善与不确定性');
  if(researchEvidenceAt(costs,asOf)===null)missing.push('缺少成本来源与事前时点');
  for(const key of ['fees','slippage','impact','executionUncertainty','incrementalRisk'])if(!nonnegative(costs[key]))missing.push('缺少成本分项 '+key);
  if(!text(input.baselineRef)||!text(input.candidateRef)||input.baselineRef===input.candidateRef)missing.push('缺少不同的原方案和候选方案引用');
  if(!Number.isSafeInteger(input.horizonDays)||input.horizonDays<1||input.horizonDays>60||improvement.horizonDays!==input.horizonDays)missing.push('改善证据与比较周期不一致');
  if(missing.length)return {task:74,...noAdjust(missing,{asOf,filterMayBlock:true})};
  const totalCost=['fees','slippage','impact','executionUncertainty','incrementalRisk'].reduce((n,k)=>n+costs[k],0),lower=improvement.expectedAmount-1.96*improvement.uncertainty;
  const pass=lower>totalCost+1e-8;
  return {schemaVersion:1,task:74,status:pass?'research-candidate':'no-adjust',action:pass?'收益改善证据可进入原审批':'继续持有或等待',filterMayBlock:true,asOf,
    uncertaintyMethod:'1.96倍标准误压力情景，未认证覆盖概率',expectedImprovement:improvement.expectedAmount,conservativeImprovement:round(lower),estimatedTotalCost:round(totalCost),margin:round(lower-totalCost),
    missing:[],reason:pass?'保守改善超过费用、滑点、冲击及新增风险预算':'证据不足以覆盖全部成本和新增风险，榜单或评分变化不构成换仓依据',...FLAGS};
}

/** Reuse the 73 comparison and its original cost policy. This does not create
 * a forecast from ranking changes or count a utility penalty as an actual loss. */
function deriveRebalanceThresholdInput(input={},report={}, {asOf=Date.now()}={}) {
  atTime(asOf);
  if(report.status!=='research-candidate'||!report.current||!report.candidate||arr(report.missing).length)return {};
  const a=input.account||{},cost=input.costs||{},rows=arr(input.candidates),current=new Map(report.current.weights.map(r=>[r.symbol,r.weight])),next=new Map(report.candidate.weights.map(r=>[r.symbol,r.weight]));
  if(!declarationScope(input)||!nonnegative(a.equity)||researchEvidenceAt(cost,asOf)===null||!rows.length||rows.some(r=>!declarationScope(r)||!returnEstimateValid(r.estimate,r.symbol,input.horizonDays,asOf))||!nonnegative(input.constraints?.riskAversion))return {};
  const uncertainty=rows.reduce((sum,r)=>sum+Math.abs((next.get(r.symbol)||0)-(current.get(r.symbol)||0))*r.estimate.standardError*a.equity,0);
  const notional=report.candidate.turnoverWeight*a.equity;
  const incrementalRisk=Math.max(0,report.candidate.volatility**2-report.current.volatility**2)*input.constraints.riskAversion*a.equity;
  const sources=[...new Set(rows.map(r=>text(r.estimate.source)).concat(text(cost.source)))],knownAt=Math.max(researchEvidenceAt(cost,asOf),...rows.map(r=>researchEvidenceAt(r.estimate,asOf)));
  const estimateEvidence=returnEvidenceView(rows,asOf);
  const source='original-portfolio-comparison/'+S.digest({account:a.authorityRef,revision:a.revision,weights:report.candidate.weights,estimateEvidence,estimates:rows.map(r=>({expectedReturn:r.estimate.expectedReturn,standardError:r.estimate.standardError,volatility:r.estimate.volatility})),sources}).slice(0,32);
  return {baselineRef:text(a.authorityRef)+'@'+a.revision+'/current',candidateRef:source,horizonDays:input.horizonDays,
    improvement:{expectedAmount:(report.candidate.expectedReturn-report.current.expectedReturn)*a.equity,uncertainty,horizonDays:input.horizonDays,source,knownAt,unit:'CNY',target:'expected-improvement-cny',valueKind:'amount-estimate'},
    costs:{fees:report.candidate.fees,slippage:notional*cost.slippageBps/10000,impact:notional*cost.impactBps/10000,
      executionUncertainty:notional*cost.uncertaintyBps/10000,incrementalRisk,source:text(cost.source),knownAt:researchEvidenceAt(cost,asOf)},
    derivation:{sources,estimateEvidence,method:'same-candidate-and-account-comparison',uncertaintyMethod:'权重差绝对值乘各估计标准误之和；未假定估计误差独立',
      incrementalRiskMethod:'max(候选方差−当前方差,0)×原研究风险偏好×账户权益；属于效用成本假设，不是实际损失',scoreUsedAsProbability:false},...FLAGS};
}

function decisionProjection(result) {
  const rows=arr(result?.candidate?.weights||result?.weights);
  return {status:text(result?.status,80)||'unknown',riskLevel:finite(result?.riskLevel)?result.riskLevel:text(result?.riskLevel,80)||null,
    ranking:arr(result?.ranking).slice(0,20).map(r=>text(typeof r==='string'?r:r?.symbol,80)),
    weights:rows.map(r=>({symbol:r.symbol,weight:finite(r.weight)?r.weight:null})),
    missing:arr(result?.missing).slice(0,30).map(x=>text(x,200))};
}
function checkDecisionRobustness(input={}, {asOf=Date.now(),evaluate}={}) {
  atTime(asOf);const portfolio=input.portfolio;
  const evaluator=typeof evaluate==='function'?evaluate:portfolio?(x,options)=>researchPortfolioWeights(x,options):null;
  if(!evaluator)return {schemaVersion:1,task:75,status:'not-evaluated',missing:['缺少服务端原评估器及其冻结输入'],scenarios:[],asOf,...FLAGS};
  const original=clone(input.decisionInput??portfolio),run=(data,time)=>{
    const result=evaluator(clone(data),{asOf:time});if(result?.then)throw Error('稳健性检查只接受有界同步原评估器');
    return decisionProjection(result);
  };
  const baseline=run(original,asOf),cases=[];
  if(baseline.status==='no-adjust'&&baseline.missing.length||['unknown','not-evaluated'].includes(baseline.status))return {schemaVersion:1,task:75,status:'not-evaluated',baseline,missing:['原决策输入尚不完整，未制造扰动结论'],scenarios:[],asOf,...FLAGS};
  const c=arr(original.candidates);
  for(let i=0;i<Math.min(c.length,6);i++){
    let next=clone(original);next.candidates[i].estimate=null;
    cases.push({id:'missing-estimate-'+i,label:'单个收益因子缺失 '+c[i].symbol,input:next,at:asOf,expectedGate:true});
    if(finite(c[i].estimate?.standardError))for(const direction of [-1,1]){
      next=clone(original);next.candidates[i].estimate.expectedReturn+=direction*c[i].estimate.standardError;
      cases.push({id:'estimate-'+i+'-'+direction,label:'估计偏移一个标准误 '+c[i].symbol,input:next,at:asOf,expectedGate:false});
    }
  }
  for(const factor of arr(input.factors).slice(0,6)){
    const path=factor?.path;
    if(!Array.isArray(path)||!path.length||path.length>6||path.some(k=>typeof k!=='string'||!k||['__proto__','constructor','prototype'].includes(k)))throw Error('扰动因子路径无效');
    let value=original;for(const key of path)value=value?.[key];
    if(!finite(value))continue;
    if(!finite(factor.delta)||factor.delta<=0||factor.delta>Math.max(Math.abs(value),1))throw Error('扰动幅度必须有界');
    for(const direction of [null,-1,1]){
      const next=clone(original);let parent=next;for(const key of path.slice(0,-1))parent=parent[key];
      parent[path.at(-1)]=direction===null?null:value+direction*factor.delta;
      cases.push({id:'factor-'+text(factor.id,40)+'-'+String(direction),label:(direction===null?'因子缺失 ':'因子小幅变化 ')+text(factor.id,60),input:next,at:asOf,expectedGate:direction===null});
    }
  }
  if(original.costs){const next=clone(original);for(const k of ['slippageBps','impactBps','uncertaintyBps'])if(nonnegative(next.costs[k]))next.costs[k]=Math.min(1000,next.costs[k]*1.5);cases.push({id:'cost-pressure',label:'执行摩擦提高50%',input:next,at:asOf,expectedGate:false});}
  cases.push({id:'latency-pressure',label:'处理延迟增加15001毫秒',input:clone(original),at:asOf+15001,expectedGate:true});
  const scenarios=cases.map(s=>{
    let result,error=null;try{result=run(s.input,s.at);}catch(e){result={status:'rejected',riskLevel:null,ranking:[],weights:[],missing:['原评估器拒绝该输入']};error=true;}
    const weights=new Map(result.weights.map(r=>[r.symbol,r.weight])),before=new Map(baseline.weights.map(r=>[r.symbol,r.weight]));let maxWeightChange=0;
    for(const id of new Set([...weights.keys(),...before.keys()])){
      const a=before.has(id)?before.get(id):0,b=weights.has(id)?weights.get(id):0;
      if(finite(a)&&finite(b))maxWeightChange=Math.max(maxWeightChange,Math.abs(a-b));
    }
    const changed=result.status!==baseline.status||result.riskLevel!==baseline.riskLevel||baseline.ranking.join('|')!==result.ranking.join('|')||maxWeightChange>.05;
    const gateApplied=s.expectedGate&&(error||['rejected','blocked','not-evaluated'].includes(result.status)||['no-adjust','unknown'].includes(result.status)&&result.missing.length>0);
    return {id:s.id,label:s.label,result,changed,maxWeightChange:round(maxWeightChange),gateExpected:s.expectedGate,expectedGate:Boolean(gateApplied),error};
  });
  const failedExpectedGates=scenarios.filter(s=>s.gateExpected&&!s.expectedGate);
  const sensitive=scenarios.filter(s=>s.changed&&!s.expectedGate||s.gateExpected&&!s.expectedGate),gateChanges=scenarios.filter(s=>s.changed&&s.expectedGate);
  return {schemaVersion:1,task:75,status:sensitive.length?'sensitive':'stable-in-tested-range',asOf,baseline,scenarios,
    sensitiveFactors:sensitive.map(s=>s.label),expectedGateChanges:gateChanges.length,failedExpectedGates:failedExpectedGates.map(s=>s.id),missing:[],
    meaning:'只说明指定扰动范围内的敏感性；稳定不等于正确或保证收益。缺因子和过期输入触发原门禁属于预期退化。',...FLAGS};
}

const FREEZE='deep-decision-alternatives-v1',REVIEW='deep-decision-review-v1';
function cleanSourceSnapshot(raw,input) {
  if(raw==null)return null;
  const a=raw.account||{},c=raw.constraints||{},f=raw.costs||{},q=Array.isArray(raw.quotes)?raw.quotes:Object.entries(raw.quotes||{}).map(([symbol,row])=>({symbol,...row}));
  if(a.authorityRef!==input.accountRef||a.revision!==input.accountRevision||a.equity!==input.capital||!known(a.observedAt,input.informationCutoff)||input.informationCutoff-a.observedAt>15000||!nonnegative(a.cash))throw Error('对照原账户快照、时点或权益不一致');
  if(!Array.isArray(a.positions)||a.positions.length>12||new Set(a.positions.map(p=>p?.symbol)).size!==a.positions.length)throw Error('对照持仓快照无效');
  const positions=a.positions.map(p=>{
    if(!symbol(p?.symbol)||!Number.isSafeInteger(p.quantity)||p.quantity<0||!Number.isSafeInteger(p.availableQuantity)||p.availableQuantity<0||p.availableQuantity>p.quantity)throw Error('对照持仓及可卖数量无效');
    return {symbol:p.symbol,quantity:p.quantity,availableQuantity:p.availableQuantity,strategyId:text(p.strategyId)||null};
  });
  const noExposure=positions.every(p=>p.quantity===0)&&arr(input.alternatives).every(a=>arr(a.weights).every(w=>w.weight===0));
  if(!q.length&&!noExposure||q.length>12||new Set(q.map(r=>r?.symbol)).size!==q.length)throw Error('冻结报价身份无效');
  const quotes=q.map(row=>{
    const v=quoteObservationView(row,input.informationCutoff);if(!symbol(row?.symbol)||v.quoteStatus!=='recent-unverified'||v.missingReason!==null||!quoteSourceAllowsUse(row)||boundQuoteValuationMark(row,row.symbol,input.informationCutoff).price===null)throw Error('冻结报价未满足原15秒门禁或标的来源一致性');
    return {symbol:row.symbol,price:row.price,quoteAt:row.quoteAt,receivedAt:row.receivedAt,quoteSource:text(row.quoteSource),sector:text(row.sector)||null,strategyId:text(row.strategyId)||null,market:text(row.market,40)||null};
  });
  const marks=new Map(quotes.map(row=>[row.symbol,row.price]));
  if(positions.some(p=>p.quantity>0&&!marks.has(p.symbol))||Math.abs(a.cash+positions.filter(p=>p.quantity>0).reduce((n,p)=>n+p.quantity*marks.get(p.symbol),0)-a.equity)>.01)throw Error('冻结现金和持仓不能与原权益对账');
  if(!text(c.version))throw Error('冻结交易约束缺少版本');
  const constraints={version:text(c.version),riskPolicy:null,maxPositions:Number.isSafeInteger(c.maxPositions)&&c.maxPositions>0&&c.maxPositions<=50?c.maxPositions:null};
  for(const k of ['maxGrossWeight','maxSingleWeight','maxSectorWeight','minimumCashWeight','maxParticipation','maxVolatility','riskAversion','minPriorTurnover'])if(c[k]!=null){if(!nonnegative(c[k]))throw Error('冻结约束数值无效');constraints[k]=c[k];}
  if(c.riskPolicy){validateEntryPolicy(c.riskPolicy);constraints.riskPolicy={version:text(c.riskPolicy.version)};for(const k of ['maxPositionPct','maxGrossExposurePct','maxSectorPct','maxStrategyPct','maxDrawdownPausePct','maxDailyLossPausePct','maxConsecutiveLosses'])if(c.riskPolicy[k]!=null)constraints.riskPolicy[k]=c.riskPolicy[k];}
  const costs={source:text(f.source)||null,knownAt:known(f.knownAt,input.informationCutoff)?f.knownAt:null,feePolicy:null};
  if(f.feePolicy){validateFeePolicy(f.feePolicy);costs.feePolicy={version:text(f.feePolicy.version),feeBps:f.feePolicy.feeBps,minFee:f.feePolicy.minFee,sellTaxBps:f.feePolicy.sellTaxBps};for(const k of ['transferBps','commissionScope','effectiveFrom'])if(f.feePolicy[k]!=null)costs.feePolicy[k]=f.feePolicy[k];}
  for(const k of ['slippageBps','impactBps','uncertaintyBps'])costs[k]=nonnegative(f[k])&&f[k]<=1000?f[k]:null;
  const account={authorityRef:text(a.authorityRef),revision:a.revision,observedAt:a.observedAt,equity:a.equity,cash:a.cash,positions};
  account.availableCash=nonnegative(a.availableCash)&&a.availableCash<=a.cash?a.availableCash:null;
  for(const k of ['pendingOrders','pendingBuyOrders','pendingSellOrders'])account[k]=Number.isSafeInteger(a[k])&&a[k]>=0?a[k]:null;
  if(Number.isSafeInteger(a.lossStreak)&&a.lossStreak>=0)account.lossStreak=a.lossStreak;
  if(a.previousClose&&['priorEquity','priorPeak','previousEquity'].every(k=>nonnegative(a.previousClose[k])))account.previousClose=Object.fromEntries(['priorEquity','priorPeak','previousEquity'].map(k=>[k,a.previousClose[k]]));
  const captureAt=Math.max(input.snapshotAt,a.observedAt,...quotes.map(q=>q.receivedAt));
  if(!known(captureAt,input.informationCutoff))throw Error('冻结快照取得时间晚于信息截止');
  return {account,quotes,constraints,costs,captureAt};
}

function alternativeInput(input,now) {
  if(!text(input?.decisionRef)||!known(input.informationCutoff,now)||!known(input.snapshotAt,input.informationCutoff))throw Error('缺少决策引用、事前信息截止或快照时点');
  if(!Number.isSafeInteger(input.horizonDays)||input.horizonDays<1||input.horizonDays>60)throw Error('对照持有周期无效');
  if(!Number.isSafeInteger(input.accountRevision)||input.accountRevision<0||!text(input.accountRef)||!finite(input.capital)||input.capital<=0)throw Error('对照缺少原账户版本及相同资金条件');
  for(const key of ['evidenceHash','constraintsHash','costPolicyHash'])if(!/^[a-f0-9]{64}$/.test(input[key]||''))throw Error('缺少对照冻结证据 '+key);
  const choices=arr(input.alternatives);if(choices.length<2||choices.length>5)throw Error('事前备选须为2至5个有界方案');
  const seen=new Set(),alternatives=choices.map(a=>{
    if(!text(a?.id,60)||seen.has(a.id)||!['hold','cash','reduce','candidate','delay'].includes(a.action))throw Error('对照身份或动作无效');seen.add(a.id);
    const weights=arr(a.weights);if(weights.length>12||new Set(weights.map(w=>w.symbol)).size!==weights.length||weights.some(w=>!symbol(w?.symbol)||!fraction(w.weight))||weights.reduce((n,w)=>n+w.weight,0)>1+1e-9)throw Error('对照权重无效');
    if(a.action==='cash'&&weights.some(w=>w.weight!==0))throw Error('保持现金方案不能隐藏股票权重');
    const delaySessions=a.delaySessions??0;if(!Number.isSafeInteger(delaySessions)||delaySessions<0||delaySessions>5)throw Error('对照延迟超限');
    if(['candidate','reduce','delay'].includes(a.action)&&!weights.length)throw Error('候选方案必须冻结明确目标');
    const clean={id:text(a.id,60),action:a.action,label:text(a.label,120)||a.action,weights:weights.map(w=>({symbol:w.symbol,weight:w.weight})),delaySessions};
    return {...clean,alternativeHash:S.digest(clean)};
  });
  if(!seen.has(input.selectedId))throw Error('实际决策必须是事前方案之一');
  const declared=input.declaredDecisionAt??now;if(!known(declared,now))throw Error('声明决策时点无效');
  const postHoc=declared<now||input.informationCutoff<now-15000;
  const sourceSnapshot=cleanSourceSnapshot(input.sourceSnapshot,input);
  if(sourceSnapshot)for(const a of alternatives){
    const positions=new Map(sourceSnapshot.account.positions.map(p=>[p.symbol,p])),quotes=new Map(sourceSnapshot.quotes.map(q=>[q.symbol,q]));
    if(a.weights.some(w=>w.weight>0&&!quotes.has(w.symbol)))throw Error('备选标的缺少冻结原始报价');
    if(a.action==='hold'||a.action==='reduce'){
      const requested=new Map(a.weights.map(w=>[w.symbol,w.weight]));
      for(const id of new Set([...positions.keys(),...requested.keys()])){const current=(positions.get(id)?.quantity||0)*(quotes.get(id)?.price||0)/input.capital,target=requested.get(id)||0;
        if(a.action==='hold'&&Math.abs(current-target)>1e-6||a.action==='reduce'&&target>current+1e-6)throw Error('持有或减仓方案与原账户持仓不一致');
      }
    }
  }
  return {type:FREEZE,decisionRef:text(input.decisionRef),asOf:input.informationCutoff,informationCutoff:input.informationCutoff,snapshotAt:input.snapshotAt,
    declaredDecisionAt:declared,classification:postHoc?'post-hoc-exploration':'prospective',horizonDays:input.horizonDays,
    accountRef:text(input.accountRef),accountRevision:input.accountRevision,capital:input.capital,evidenceHash:input.evidenceHash,
    constraintsHash:input.constraintsHash,costPolicyHash:input.costPolicyHash,alternatives,selectedId:input.selectedId,
    sourceSnapshot,sourceSnapshotHash:sourceSnapshot?S.digest(sourceSnapshot):null,
    freezeTime:{captureAt:sourceSnapshot?.captureAt??input.snapshotAt,serverReceivedAt:now,executionPolicy:'after-freeze-calendar-day',earliestDayAfter:chinaDay(now)},
    dataMode:['real-observation','historical-replay','research-manual-unverified'].includes(input.dataMode)?input.dataMode:'research-manual-unverified'};
}
function freezeDecisionAlternatives(root,input,{requestId,expectedRevision,now=Date.now(),beforeCommit,authorize}={}) {
  atTime(now);if(now>Date.now())throw Error('服务器记录时点不能在未来');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('冻结对照需要当前研究修订');
  const events=S.readEvents(root),previous=events.find(e=>e.requestId===requestId);
  // A retried request is compared with its original server time so network
  // retry cannot create a new version or change a prospective classification.
  if(!previous&&expectedRevision!==events.filter(e=>e.kind==='diagnostic').length)throw Error('研究设置版本冲突，请重新读取');
  const clean=alternativeInput(input,previous?.recordedAt??now);
  if(previous&&(previous.kind!=='diagnostic'||previous.data?.type!==FREEZE))throw Error('对照请求ID已由其他研究记录使用');
  if(events.some(e=>e.data?.type===FREEZE&&e.data.decisionRef===clean.decisionRef&&e.requestId!==requestId))throw Error('该决策已有不可变对照，不能事后替换');
  const event=S.appendEvent(root,'diagnostic',clean,{requestId,expectedRevision,now:previous?.recordedAt??now,beforeCommit:typeof authorize==='function'?()=>authorize()===true:undefined,beforeCommitLocked:context=>{
    if(context.events.some(e=>e.data?.type===FREEZE&&e.data.decisionRef===clean.decisionRef&&e.requestId!==requestId))throw Error('该决策已有不可变对照，不能事后替换');
    return (typeof beforeCommit!=='function'||beforeCommit(context)===true)&&(typeof authorize!=='function'||authorize(context)===true);
  }});
  return {...event.data,id:event.hash,recordedAt:event.recordedAt,revision:event.revision,reused:event.reused,...FLAGS};
}
function listDecisionAlternatives(root,{asOf=Date.now()}={}) {
  const events=S.readEvents(root,{asOf});
  return {schemaVersion:1,task:76,revision:events.filter(e=>e.kind==='diagnostic').length,
    records:events.filter(e=>e.kind==='diagnostic'&&e.data?.type===FREEZE).slice(-50).map(e=>({...e.data,id:e.hash,recordedAt:e.recordedAt,revision:e.revision,...FLAGS})),
    reviews:events.filter(e=>e.kind==='diagnostic'&&e.data?.type===REVIEW).slice(-50).map(e=>({...e.data,id:e.hash,recordedAt:e.recordedAt,...FLAGS})),...FLAGS};
}
function resolveFrozenRequest(root,requestId,publicIntent,{authorize,beforeCommit}={}) {
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw Error('对照请求ID无效');
  const event=S.readEvents(root).find(e=>e.requestId===requestId);
  if(!event)return null;
  if(event.kind!=='diagnostic'||event.data?.type!==FREEZE)throw Error('请求ID已用于另一研究操作');
  const input=publicIntent||{};
  if(Object.keys(input).some(k=>!['horizonDays','selectedId','alternatives'].includes(k)))throw Error('对照重试只能携带原公开意图');
  const alternatives=arr(input.alternatives).map(a=>{
    if(a?.action!=='hold'||arr(a.weights).length||!event.data.sourceSnapshot)return a;
    const snapshot=event.data.sourceSnapshot,marks=new Map(snapshot.quotes.map(q=>[q.symbol,q.price]));
    return {...a,weights:snapshot.account.positions.filter(p=>p.quantity>0).map(p=>({symbol:p.symbol,weight:p.quantity*marks.get(p.symbol)/snapshot.account.equity}))};
  });
  const normalized=alternativeInput({...event.data,horizonDays:input.horizonDays,selectedId:input.selectedId,alternatives},event.recordedAt);
  for(const key of ['horizonDays','selectedId','alternatives'])if(S.digest(normalized[key])!==S.digest(event.data[key]))throw Error('同请求ID内容冲突');
  const saved=S.appendEvent(root,'diagnostic',event.data,{requestId,expectedRevision:event.revision,now:event.recordedAt,beforeCommit:typeof authorize==='function'?()=>authorize()===true:undefined,beforeCommitLocked:context=>
    context.reused&&context.existing?.hash===event.hash&&(typeof authorize!=='function'||authorize(context)===true)&&(typeof beforeCommit!=='function'||beforeCommit(context)===true)});
  return {...saved.data,id:saved.hash,recordedAt:saved.recordedAt,revision:saved.revision,reused:true,...FLAGS};
}

function archiveTime(value) {
  if(instant(value))return value;
  if(typeof value!=='string')return null;
  const normalized=/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?$/.test(value)?value.replace(' ','T')+'+08:00':value;
  if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(normalized))return null;
  const at=Date.parse(normalized);return instant(at)?at:null;
}
/** Adapt the existing shortline archive and immutable workspace analysis
 * events. In particular, OHLCV alone cannot establish historical tradability,
 * absence of corporate actions, actual price limits or a trading calendar. */
function deriveDecisionReplayHistory(archive={},workspaceEvents=[],{asOf=Date.now(),informationCutoff=asOf,symbols=[]}={}) {
  atTime(asOf);atTime(informationCutoff);if(informationCutoff>asOf)throw Error('回放信息截止在查询时间之后');
  if(!Array.isArray(workspaceEvents)||workspaceEvents.length>2000||!Array.isArray(symbols)||symbols.length>12||symbols.some(s=>!symbol(s)))throw Error('回放档案范围无效');
  const versions=new Map(),conflicts=new Set(),calendars=[],sourceRefs=new Set(),counts={accepted:0,excluded:0,conflicts:0,truncated:0};let examined=0;
  const requested=new Set(symbols),validDay=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  function calendarCandidate(d,recordedAt,ref) {
    const meta=d?.calendarEvidence,knownAt=archiveTime(meta?.knowledgeAvailableAt??meta?.observedAt);
    if(!meta?.source||!known(knownAt,informationCutoff)||!known(recordedAt,informationCutoff)||!Array.isArray(d.tradeDates)||d.tradeDates.length>500||!d.tradeDates.every(validDay)||d.tradeDates.some((day,i)=>i&&day<=d.tradeDates[i-1]))return;
    calendars.push({source:text(meta.source),knownAt:Math.max(knownAt,recordedAt),dates:d.tradeDates.slice(),reference:ref});
  }
  function addBar(row,owner) {
    if(++examined>20000){counts.truncated++;return;}
    const id=row?.code||row?.symbol||owner.symbol,source=text(row?.source||owner.source),basis=row?.priceBasis||owner.priceBasis;
    const received=archiveTime(row?.knownAt),recorded=owner.recordedAt??received;
    if(!symbol(id)||requested.size&&!requested.has(id)||!validDay(row?.date)||row.role&&row.role!=='stock'||row.period&&!['日K','1d','daily'].includes(row.period)||basis!=='unadjusted'||!source||row.sampleSet==='test'||row.synthetic===true||row.simulated===true||/fixture|synthetic|教学|演示/i.test(source)||!known(received,asOf)||!known(recorded,asOf)||!known(Date.parse(row.date+'T15:00:00+08:00'),received)) {counts.excluded++;return;}
    if(!['open','high','low','close','volume'].every(k=>finite(row[k]))||row.open<=0||row.close<=0||row.low<=0||row.high<Math.max(row.open,row.close,row.low)||row.low>Math.min(row.open,row.close)||row.volume<0){counts.excluded++;return;}
    const provider=text(owner.provider)||source.replace(/^V6\//,''),key=provider+'/'+id+'/'+row.date;
    const clean={date:row.date,open:row.open,high:row.high,low:row.low,close:row.close,volume:row.volume,knownAt:Math.max(received,recorded),source,priceBasis:'unadjusted'};
    for(const k of ['amount','amountUnit','currency','volumeUnit','sector','market','isST','suspended','tradable','corporateAction'])if(row[k]!==undefined)clean[k]=clone(row[k]);
    for(const k of ['statusKnownAt','limitKnownAt','corporateActionKnownAt'])if(archiveTime(row[k])!==null)clean[k]=archiveTime(row[k]);
    const up=row.upperLimit??row.limitUpPrice,down=row.lowerLimit??row.limitDownPrice;
    if(finite(up))clean.upperLimit=up;if(finite(down))clean.lowerLimit=down;
    const fingerprint=S.digest(clean),old=versions.get(key);
    if(old&&old.bar.knownAt===clean.knownAt&&old.fingerprint!==fingerprint){conflicts.add(key);counts.conflicts++;return;}
    if(!old||old.bar.knownAt<clean.knownAt)versions.set(key,{symbol:id,provider,bar:clean,fingerprint,reference:owner.reference||null});
    if(owner.reference)sourceRefs.add(owner.reference);counts.accepted++;
  }
  if(archive?.scope!=='demo')for(const row of arr(archive?.bars).slice(0,50000))addBar(row,{});
  const events=workspaceEvents.filter(e=>e?.kind==='analysis'&&known(e.recordedAt,asOf)&&known(e.data?.asOf,asOf));
  for(const event of events){
    const d=event.data;calendarCandidate(d,event.recordedAt,event.hash);
    for(const row of arr(d.bars).slice(0,500))addBar(row,{symbol:d.symbol,source:d.provider,provider:d.provider,priceBasis:d.priceBasis,recordedAt:event.recordedAt,reference:event.hash});
  }
  // Reuse the repository's existing explicit-calendar reader; never derive
  // exchange sessions from the mere presence of bars or weekday arithmetic.
  if(!calendars.length){
    const identifiers=requested.size?[...requested]:[...new Set([...versions.values()].map(v=>v.symbol))].slice(0,12),observed=[];
    for(const id of identifiers){const c=require('./research-calendar-source').readResearchCalendar({asOf:informationCutoff,symbol:id});if(c.status!=='available'){observed.length=0;break;}
      observed.push({source:c.metadata.source,knownAt:archiveTime(c.metadata.knowledgeAvailableAt),dates:c.tradeDates,reference:c.metadata.sha256});}
    if(observed.length&&observed.every(c=>known(c.knownAt,informationCutoff))){const dates=observed[0].dates.filter(d=>observed.every(c=>c.dates.includes(d)));calendars.push({source:[...new Set(observed.map(c=>c.source))].join(';').slice(0,160),knownAt:Math.max(...observed.map(c=>c.knownAt)),dates,reference:observed.map(c=>c.reference).join(':')});}
  }
  const groups=new Map();for(const [key,v] of versions)if(!conflicts.has(key)){const identity=v.provider+'/'+v.symbol;if(!groups.has(identity))groups.set(identity,{symbol:v.symbol,provider:v.provider,bars:[]});groups.get(identity).bars.push(v.bar);}
  const selected=[];for(const id of (requested.size?[...requested]:[...new Set([...groups.values()].map(g=>g.symbol))]).slice(0,12)){
    const providers=[...groups.values()].filter(g=>g.symbol===id).sort((a,b)=>b.bars.length-a.bars.length||a.provider.localeCompare(b.provider));
    if(providers.length)selected.push(providers[0]);
  }
  selected.forEach(s=>s.bars.sort((a,b)=>a.date.localeCompare(b.date)));
  let calendar=calendars.sort((a,b)=>b.knownAt-a.knownAt||a.source.localeCompare(b.source))[0]||null;
  const missing=[];
  if(!selected.length)missing.push('原研究档案没有截止查询时间的未复权闭合OHLCV');
  if(requested.size&&selected.length!==requested.size)missing.push('冻结标的在原档案中覆盖不全');
  if(!calendar)missing.push('尚无冻结决策时点已经取得的完整交易日历');
  if(calendar&&selected.length){
    const first=selected.map(s=>s.bars[0].date).sort().at(-1),last=selected.map(s=>s.bars.at(-1).date).sort()[0];
    calendar={...calendar,dates:calendar.dates.filter(d=>d>=first&&d<=last)};
    if(calendar.dates.length<2)missing.push('各标的共同交易日历史不足');
    for(const stock of selected){const indexed=new Map(stock.bars.map(b=>[b.date,b]));stock.bars=calendar.dates.map(d=>indexed.get(d)).filter(Boolean);
      if(stock.bars.length!==calendar.dates.length)missing.push('原档案缺少明确交易日行情 '+stock.symbol);}
  }
  const universeHistory=[];let corporateComplete=selected.length>0,statusComplete=selected.length>0,limitComplete=selected.length>0,volumeComplete=selected.length>0;
  for(const stock of selected){
    for(const bar of stock.bars){
      const opening=Date.parse(bar.date+'T09:30:00+08:00');
      if(['isST','suspended','tradable'].every(k=>typeof bar[k]==='boolean')&&known(bar.statusKnownAt,opening)){
        universeHistory.push({symbol:stock.symbol,from:bar.date,through:bar.date,eligible:bar.tradable&&!bar.suspended,source:bar.source+'/original-daily-status',knownAt:new Date(bar.statusKnownAt).toISOString(),...(text(bar.sector)?{sector:text(bar.sector)}:{})});
      }else statusComplete=false;
      if(!finite(bar.upperLimit)||!finite(bar.lowerLimit)||!known(bar.limitKnownAt,opening))limitComplete=false;
      if(bar.volumeUnit!=='shares')volumeComplete=false;
      if(!(bar.corporateAction===false||bar.corporateAction&&typeof bar.corporateAction==='object')||!known(bar.corporateActionKnownAt,asOf))corporateComplete=false;
    }
    stock.volumeUnit=stock.bars.every(b=>b.volumeUnit==='shares')?'shares':'unknown';
  }
  if(!statusComplete)missing.push('原历史证券状态或其开盘前已知时点不足');
  if(!limitComplete)missing.push('原历史实际涨跌停边界或其开盘前已知时点不足');
  if(!corporateComplete)missing.push('原档案未逐日声明公司行为及其已知时点');
  if(!volumeComplete)missing.push('原成交量股数单位不足，不能估算参与率');
  if(counts.truncated)missing.push('原档案超过本次20000行有界读取预算，不能声称完整覆盖');
  if(counts.conflicts)missing.push('相同时点的原始档案存在冲突，已排除冲突条目');
  const dates=selected.flatMap(s=>s.bars.map(b=>b.knownAt));
  return {schemaVersion:1,status:missing.length?'partial':'available',source:'existing-shortline-and-workspace-archives',knownAt:dates.length?Math.max(...dates):null,
    priceBasis:'unadjusted',stocks:selected,calendar,universeHistory:statusComplete?universeHistory:null,corporateActionsComplete:corporateComplete,
    sourceRefs:[...sourceRefs].slice(0,100),counts,missing:[...new Set(missing)],asOf,informationCutoff,sourceAuthenticated:false,...FLAGS};
}

/** Existing archive bridge. A historical return distribution is descriptive;
 * it is not a prospective alpha forecast. Only observed liquidity and aligned
 * correlation may fill missing inputs. Expected returns remain unknown. */
function derivePortfolioArchiveEvidence(archive={},workspaceEvents=[],input={}, {asOf=Date.now()}={}) {
  atTime(asOf);const portfolio=clone(input),rows=arr(portfolio.candidates),ids=rows.map(r=>r?.symbol),h=portfolio.horizonDays,missing=[],liquidity=[];
  const base={schemaVersion:1,asOf,input:portfolio,liquidity,correlation:null,descriptiveBaseline:[],sourceAuthenticated:false,...FLAGS};
  if(!ids.length||ids.length>12||new Set(ids).size!==ids.length||ids.some(id=>!symbol(id))||!Number.isSafeInteger(h)||h<1||h>60)return {...base,status:'partial',missing:['需复用原候选集合和明确研究持有周期，不能由历史收益事后选股']};
  const history=deriveDecisionReplayHistory(archive,workspaceEvents,{asOf,informationCutoff:asOf,symbols:ids});
  const bySymbol=new Map(history.stocks.map(s=>[s.symbol,s]));
  for(const row of rows){
    const bars=arr(bySymbol.get(row.symbol)?.bars).slice(-20);
    // Original Eastmoney/Baostock normalizers explicitly define amounts in
    // CNY. Other adapters need their own units, not price*volume estimates.
    const lastDates=arr(history.calendar?.dates).slice(-20);
    const usable=!history.counts.truncated&&bars.length===20&&lastDates.length===20&&bars.every((b,i)=>b.date===lastDates[i]&&nonnegative(b.amount)&&
      (b.amountUnit==='CNY'||/^V6\/(?:eastmoney|baostock)$/.test(b.source)));
    if(!usable){liquidity.push({symbol:row.symbol,status:'unknown',sampleCount:bars.length,averageDailyAmount:null});missing.push('缺少20个闭合交易日的原始人民币成交额 '+row.symbol);continue;}
    const value={averageDailyAmount:bars.reduce((n,b)=>n+b.amount,0)/bars.length,sampleCount:bars.length,source:'original-daily-amount/'+S.digest(bars.map(b=>({date:b.date,source:b.source,amount:b.amount,knownAt:b.knownAt}))).slice(0,24),
      knownAt:Math.max(...bars.map(b=>b.knownAt)),amountUnit:'CNY',firstDate:bars[0].date,lastDate:bars.at(-1).date,sourceRefs:[...new Set(bars.map(b=>b.source))]};
    liquidity.push({symbol:row.symbol,status:'observed',...value});if(row.liquidity==null)row.liquidity=value;
  }
  const dates=history.calendar?.dates||[],n=Math.min(60,Math.floor((dates.length-1)/h));
  const covered=bySymbol.size===ids.length&&history.corporateActionsComplete&&!history.counts.truncated&&!history.counts.conflicts&&n>=20&&
    ids.every(id=>bySymbol.get(id).bars.length===dates.length&&bySymbol.get(id).bars.every((b,i)=>b.date===dates[i]));
  if(!covered)return {...base,status:'partial',sourceRefs:history.sourceRefs,missing:[...new Set([...missing,'共同交易日、公司行为证据或至少20个不重叠成熟窗口不足；不计算伪相关性',...rows.filter(r=>!r.estimate).map(r=>'尚无事前收益估计 '+r.symbol)])]};
  const samples=[],start=dates.length-1-n*h;
  try{
    for(let k=0;k<n;k++){
      const first=start+k*h,last=first+h,values=[];
      for(const id of ids){const bars=bySymbol.get(id).bars;let shares=100,cash=0;
        for(let j=first+1;j<=last;j++){const action=corporateAction(bars[j]);if(action){const applied=entitlement(shares,action);shares=applied.shares;cash+=applied.cash;}}
        const grossReturn=(shares*bars[last].close+cash)/(100*bars[first].close)-1;if(!finite(grossReturn))throw Error('收益未知');values.push(grossReturn);
      }
      samples.push({start:dates[first],end:dates[last],values});
    }
  }catch{return {...base,status:'partial',sourceRefs:history.sourceRefs,missing:[...new Set([...missing,'公司行为或零碎股证据不足，不能虚构收益窗口'])]};}
  const means=ids.map((_,i)=>samples.reduce((sum,s)=>sum+s.values[i],0)/n);
  const covariance=ids.map((_,i)=>ids.map((_,j)=>samples.reduce((sum,s)=>sum+(s.values[i]-means[i])*(s.values[j]-means[j]),0)/(n-1)));
  const volatility=ids.map((_,i)=>Math.sqrt(Math.max(0,covariance[i][i]))),source='original-calendar-aligned-gross-marks/'+S.digest(samples).slice(0,24);
  const knownAt=Math.max(history.calendar.knownAt,...history.stocks.flatMap(s=>s.bars.flatMap(b=>[b.knownAt,b.corporateActionKnownAt])));
  const descriptiveBaseline=ids.map((id,i)=>({symbol:id,horizonDays:h,sampleCount:n,meanGrossReturn:round(means[i]),volatility:round(volatility[i]),
    standardErrorUnderIndependentWindows:round(volatility[i]/Math.sqrt(n)),source,knownAt,expectedReturn:null,
    interpretation:'所给固定标的、固定窗口的历史收盘估值分布；未扣费、未经未来预测验证，不是可成交收益或胜率'}));
  let correlation=null;
  if(volatility.every(v=>finite(v)&&v>1e-12)){
    const matrix=covariance.map((row,i)=>row.map((v,j)=>i===j?1:Math.max(-1,Math.min(1,v/(volatility[i]*volatility[j])))));
    correlation={symbols:ids,matrix,horizonDays:h,sampleCount:n,source,knownAt,priceBasis:'unadjusted-with-explicit-entitlements',samplePolicy:'all-contiguous-nonoverlapping-windows',firstDate:samples[0].start,lastDate:samples.at(-1).end};
    if(portfolio.correlation==null)portfolio.correlation=correlation;
  }else missing.push('历史窗口零方差，相关性未定义');
  for(const row of rows)if(!row.estimate)missing.push('历史均值未冒充事前收益估计 '+row.symbol);
  return {...base,status:missing.length?'partial':'observed',correlation,descriptiveBaseline,sourceRefs:history.sourceRefs,
    windows:samples.map(({start,end})=>({start,end})),missing:[...new Set(missing)],limitations:['失败和反向窗口保留；缺失窗口不会删除后重算漂亮样本','只补已有真实成交额和历史相关性，不从分数、已卖出交易或历史均值生成预期收益','无前瞻验证时无法断言收益稳定、可成交或生产适用']};
}

function reviewDecisionAlternatives(frozen,outcomes=[],{asOf=Date.now()}={}) {
  atTime(asOf);if(frozen?.type!==FREEZE||!known(frozen.recordedAt,asOf)||!known(frozen.informationCutoff,frozen.recordedAt)||!arr(frozen.alternatives).length)throw Error('对照冻结引用无效');
  if(!Array.isArray(outcomes)||outcomes.length>5)throw Error('对照结果数量超限');
  const ids=new Set();for(const o of outcomes){if(ids.has(o?.alternativeId))throw Error('对照结果身份重复');ids.add(o?.alternativeId);}
  const rows=frozen.alternatives.map(a=>{
    const o=outcomes.find(o=>o.alternativeId===a.id),missing=[];
    if(!o)missing.push('尚无成熟的原回放引擎结果');
    else {
      if(o.alternativeHash!==a.alternativeHash||o.freezeId!==frozen.id)missing.push('方案或冻结版本不一致');
      if(o.informationCutoff!==frozen.informationCutoff||o.constraintsHash!==frozen.constraintsHash||o.costPolicyHash!==frozen.costPolicyHash||o.capital!==frozen.capital||o.horizonDays!==frozen.horizonDays)missing.push('信息、成本、资金或交易约束口径不一致');
      if(!evidence(o,asOf)||!known(o.periodStartAt,o.periodEndAt)||!known(o.periodEndAt,o.knownAt)||o.periodStartAt<frozen.recordedAt&&frozen.classification==='prospective')missing.push('结果来源、成熟或发生时点无效');
      if(o.mode!=='constrained-paper-replay'||o.constraintsVerified!==true||o.mature!==true)missing.push('缺少原引擎约束校验或样本尚未成熟');
      if(!finite(o.netPnl)||!finite(o.grossPnl)||!nonnegative(o.totalCosts)||Math.abs(o.grossPnl-o.totalCosts-o.netPnl)>.011)missing.push('成本后盈亏无法对账');
    }
    return {id:a.id,action:a.action,label:a.label,selected:a.id===frozen.selectedId,status:missing.length?'pending':'hypothetical-evaluated',missing,
      netPnl:missing.length?null:o.netPnl,grossPnl:missing.length?null:o.grossPnl,totalCosts:missing.length?null:o.totalCosts,
      source:missing.length?null:text(o.source),knownAt:missing.length?null:o.knownAt,periodStartAt:missing.length?null:o.periodStartAt,periodEndAt:missing.length?null:o.periodEndAt};
  });
  const valid=rows.filter(r=>r.status==='hypothetical-evaluated'),periods=new Set(valid.map(r=>r.periodStartAt+'/'+r.periodEndAt));
  if(periods.size>1)for(const r of valid){r.status='pending';r.missing.push('备选方案不在相同观察窗口');r.netPnl=null;r.grossPnl=null;r.totalCosts=null;}
  const selected=rows.find(r=>r.selected),complete=rows.every(r=>r.status==='hypothetical-evaluated');
  return {schemaVersion:1,type:REVIEW,task:76,freezeId:frozen.id,decisionRef:frozen.decisionRef,asOf,classification:frozen.classification,
    status:complete?'compared':'pending',rows:rows.map(r=>({...r,differenceFromSelected:complete?round(r.netPnl-selected.netPnl):null})),
    actualExecutionClaim:false,meaning:frozen.classification==='prospective'?'与事前冻结方案作同条件纸面对照，不写入权威账户':'事后探索，不能声称当时本应知道最佳方案',...FLAGS};
}
function recordDecisionAlternativeReview(root,freezeId,outcomes,{requestId,expectedRevision,now=Date.now(),beforeCommit,authorize}={}) {
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('保存复盘需要当前研究修订');
  const e=S.readEvents(root).find(e=>e.hash===freezeId&&e.data?.type===FREEZE);if(!e)throw Error('未找到不可变的事前对照记录');
  const previous=S.readEvents(root).find(row=>row.requestId===requestId);
  if(previous&&(previous.data?.type!==REVIEW||previous.data.freezeId!==freezeId))throw Error('复盘请求ID已用于其他记录');
  const recordedAt=previous?.recordedAt??now;
  const report=reviewDecisionAlternatives({...e.data,id:e.hash,recordedAt:e.recordedAt},outcomes,{asOf:recordedAt});
  const saved=S.appendEvent(root,'diagnostic',report,{requestId,expectedRevision,now:recordedAt,beforeCommit:typeof authorize==='function'?()=>authorize()===true:undefined,beforeCommitLocked:context=>(typeof beforeCommit!=='function'||beforeCommit(context)===true)&&(typeof authorize!=='function'||authorize(context)===true)});return {...report,id:saved.hash,revision:saved.revision,recordedAt:saved.recordedAt,reused:saved.reused};
}
function evaluateDecisionAlternatives(frozen,{evaluateAlternative,asOf=Date.now()}={}) {
  if(typeof evaluateAlternative!=='function')return reviewDecisionAlternatives(frozen,[],{asOf});
  const outcomes=frozen.alternatives.map(a=>evaluateAlternative(clone(a),clone({freezeId:frozen.id,informationCutoff:frozen.informationCutoff,
    constraintsHash:frozen.constraintsHash,costPolicyHash:frozen.costPolicyHash,capital:frozen.capital,horizonDays:frozen.horizonDays,asOf})));
  if(outcomes.some(o=>o?.then))throw Error('对照评估需要有界同步的原回放器');
  return reviewDecisionAlternatives(frozen,outcomes,{asOf});
}
/** Replay only the already frozen alternatives. This is a private research
 * calculation, reusing the existing opening-limit, participation, fee, entry
 * risk and corporate-action functions. It never calls an account writer. */
function replayDecisionAlternatives(frozen,history={}, {asOf=Date.now()}={}) {
  atTime(asOf);
  const pending=reason=>({...reviewDecisionAlternatives(frozen,[],{asOf}),missing:[reason],replayDetails:[]});
  const snap=frozen?.sourceSnapshot;
  if(!snap||frozen.sourceSnapshotHash!==S.digest(snap))return pending('缺少完整、指纹一致的冻结账户与规则快照');
  const {account,quotes,constraints:c,costs}=snap;
  if(!nonnegative(account.availableCash)||account.availableCash>account.cash||account.pendingBuyOrders!==0)return pending('冻结的原账户可用资金或未终结买单状态未知，不能重用总现金');
  if(account.cash-account.availableCash>.01)return pending('冻结可用资金少于总现金，尚无预留资金的释放记录');
  if(account.pendingOrders!==0||account.pendingSellOrders!==0)return pending('冻结时存在开放订单或状态未知，尚不能假定未来成交及解除冻结');
  if(!evidence(costs,frozen.informationCutoff)||!costs.feePolicy||!['slippageBps','impactBps','uncertaintyBps'].every(k=>nonnegative(costs[k])))return pending('冻结成本尚不完整，不能按零费用回放');
  if(!fraction(c.maxParticipation)||c.maxParticipation<=0)return pending('冻结流动性参与上限未知');
  if(!Number.isSafeInteger(c.maxPositions)||c.maxPositions<1)return pending('冻结的原后台持仓数量上限缺失');
  if(!evidence(history,asOf)||history.priceBasis!=='unadjusted'||history.corporateActionsComplete!==true)return pending('需要有来源及已知时点的未复权历史与完整公司行为声明');
  const calendar=history.calendar||{},dates=calendar.dates||history.tradingDates;
  if(!evidence(calendar,frozen.informationCutoff)||!Array.isArray(dates)||dates.length<2||dates.length>500)return pending('缺少事前可知且有界的交易日历');
  if(history.universeHistory==null)return pending('缺少同一时点可用的历史证券状态');
  const stocks=arr(history.stocks),ids=new Set(stocks.map(s=>s?.symbol)),required=new Set([...account.positions.map(p=>p.symbol),...frozen.alternatives.flatMap(a=>a.weights.filter(w=>w.weight>0).map(w=>w.symbol))]);
  if(!stocks.length||stocks.length>12||ids.size!==stocks.length||[...required].some(id=>!ids.has(id)))return pending('冻结标的历史覆盖不完整');
  const anchor=frozen.classification==='prospective'?frozen.recordedAt:frozen.declaredDecisionAt;
  const earliestDay=frozen.freezeTime?.earliestDayAfter||chinaDay(anchor);
  const start=dates.findIndex(d=>d>earliestDay),end=start+frozen.horizonDays-1;
  if(start<1||end>=dates.length)return pending('前一交易日或观察窗口尚未覆盖');
  const endAt=Date.parse(dates[end]+'T15:00:00+08:00');
  if(!known(endAt,history.knownAt)||endAt>asOf)return pending('冻结观察窗口尚未成熟');
  try {
    assertUnadjustedExecutionPriceBasis(history);validateFeePolicy(costs.feePolicy);validateEntryPolicy(c.riskPolicy);validateUniverseHistory(history.universeHistory);
    assertAligned(stocks,end,dates);
    for(const stock of stocks)for(const b of stock.bars.slice(0,end+1)){
      if(!symbol(stock.symbol)||!['open','high','low','close','volume'].every(k=>nonnegative(b[k]))||b.open<=0||b.close<=0||b.low<=0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||b.priceBasis&&b.priceBasis!=='unadjusted')throw Error('历史价格无效');
      if(!['isST','suspended','tradable'].every(k=>typeof b[k]==='boolean')||!known(b.statusKnownAt,Date.parse(b.date+'T09:30:00+08:00'))||!known(b.limitKnownAt,Date.parse(b.date+'T09:30:00+08:00'))||!finite(b.upperLimit)||!finite(b.lowerLimit)||b.upperLimit<=b.lowerLimit)throw Error('缺少当日证券状态及真实涨跌停边界');
      corporateAction(b);
    }
  }catch{return pending('历史日期、价格口径、权益或原风控校验失败');}
  const bySymbol=new Map(stocks.map(s=>[s.symbol,s])),quoteMap=new Map(quotes.map(q=>[q.symbol,q]));
  const replayDetails=[],outcomes=[];
  const frictionBps=costs.slippageBps+costs.impactBps+costs.uncertaintyBps;
  for(const alternative of frozen.alternatives){
    let cash=account.cash,totalCosts=0,peak=account.equity,maxDrawdown=0;
    const holdings=new Map(account.positions.map(p=>[p.symbol,{...p}])),orders=[],equity=[];
    const scheduled=start+alternative.delaySessions;
    const block=(date,id,side,reason)=>orders.push({date,symbol:id,side,status:'hypothetical-blocked',reason});
    for(let d=start;d<=end;d++){
      const date=dates[d],openAt=Date.parse(date+'T09:30:00+08:00');
      for(const [id,p] of holdings){
        const action=corporateAction(bySymbol.get(id).bars[d]);
        if(action){const applied=entitlement(p.quantity,action);p.quantity=applied.shares;cash+=applied.cash;}
        if(date>chinaDay(account.observedAt))p.availableQuantity=p.quantity;
      }
      if(d===scheduled&&alternative.action!=='hold'){
        const targets=new Map(alternative.weights.map(w=>[w.symbol,w.weight]));
        // Sell first, retaining blocked quantities and their subsequent marks.
        for(const [id,p] of holdings){
          const stock=bySymbol.get(id),bar=stock.bars[d],prior=stock.bars[d-1],weight=targets.get(id)||0;
          const target=Math.ceil(weight*account.equity/bar.open-1e-7),requested=Math.max(0,p.quantity-target);
          if(!requested)continue;
          const lock=atLockedLimit(bar,prior,stock,'sell');
          if(bar.suspended===true||bar.tradable===false||bar.volume===0||lock.blocked){block(date,id,'sell',lock.reason||'停牌或无成交');continue;}
          const available=Math.min(requested,p.availableQuantity);
          if(!available){block(date,id,'sell','T+1可卖数量不足');continue;}
          const capacity=executionCapacity(stock,prior,available,1,{maxParticipationPct:c.maxParticipation*100,minPriorTurnover:c.minPriorTurnover??null});
          if(capacity.shares<=0){block(date,id,'sell',capacity.reason);continue;}
          const quantity=capacity.shares,price=Math.max(lock.boundary,bar.open*(1-frictionBps/10000)),fee=tradingFees({side:'sell',quantity,price,tradeDate:date,policy:costs.feePolicy});
          cash+=quantity*price-fee.total;totalCosts+=fee.total+quantity*(bar.open-price);p.quantity-=quantity;p.availableQuantity-=quantity;
          orders.push({date,symbol:id,side:'sell',quantity,price,fees:fee.total,status:'hypothetical-filled'});
          if(quantity<requested)block(date,id,'sell',capacity.reason||'可卖数量限制，剩余继续估值');
        }
        // A frozen reduction authorizes only lower exposure. A later price gap
        // can imply a larger share target at the same weight; never buy it back.
        if(alternative.action!=='reduce')for(const [id,weight] of targets){
          if(weight<=0)continue;
          const stock=bySymbol.get(id),bar=stock.bars[d],prior=stock.bars[d-1],p=holdings.get(id)||{symbol:id,quantity:0,availableQuantity:0},lotSize=paperBuyLotSize(id);
          const requested=Math.floor(Math.max(0,weight*account.equity/bar.open-p.quantity)/lotSize)*lotSize;if(!requested)continue;
          if(p.quantity===0&&[...holdings.values()].filter(h=>h.quantity>0).length>=c.maxPositions){block(date,id,'buy','原后台持仓数量上限');continue;}
          const lock=atLockedLimit(bar,prior,stock,'buy'),membership=universeObservation(history.universeHistory,id,date,{at:'open'});
          if(bar.isST===true||bar.suspended===true||bar.tradable===false||bar.volume===0||lock.blocked||!membership.eligible){block(date,id,'buy',lock.reason||'证券状态或历史股票池禁止入场');continue;}
          const price=Math.min(lock.boundary,bar.open*(1+frictionBps/10000)),affordable=maxAffordableQuantity({budget:cash,price,lotSize,tradeDate:date,policy:costs.feePolicy});
          const capacity=executionCapacity(stock,prior,Math.min(requested,affordable),lotSize,{maxParticipationPct:c.maxParticipation*100,minPriorTurnover:c.minPriorTurnover??null});
          const quantity=capacity.shares;if(quantity<=0){block(date,id,'buy',capacity.reason||'资金不足一手');continue;}
          const risk=evaluateEntryRisk({policy:c.riskPolicy,symbol:id,strategyId:quoteMap.get(id)?.strategyId||p.strategyId,
            quantity,price,cash,positions:[...holdings.values()].filter(p=>p.quantity>0),marks:Object.fromEntries(stocks.map(s=>[s.symbol,s.bars[d-1].close])),
            sectors:Object.fromEntries(stocks.map(s=>[s.symbol,universeObservation(history.universeHistory,s.symbol,date,{at:'open'}).sector])),
            lossStreak:account.lossStreak??null,previousClose:equity.length?{priorEquity:equity.at(-1).value,priorPeak:peak,previousEquity:equity.at(-2)?.value??account.equity}:account.previousClose??null});
          if(!risk.allowed){block(date,id,'buy',risk.reasonCodes.join(','));continue;}
          const fee=tradingFees({side:'buy',quantity,price,tradeDate:date,policy:costs.feePolicy});cash-=quantity*price+fee.total;
          totalCosts+=fee.total+quantity*(price-bar.open);p.quantity+=quantity;holdings.set(id,p);
          orders.push({date,symbol:id,side:'buy',quantity,price,fees:fee.total,status:'hypothetical-filled'});
        }
      }
      const value=cash+[...holdings.values()].reduce((n,p)=>n+p.quantity*bySymbol.get(p.symbol).bars[d].close,0);
      peak=Math.max(peak,value);maxDrawdown=Math.max(maxDrawdown,(peak-value)/peak);
      equity.push({date,value:round(value),cash:round(cash)});
    }
    const netPnl=equity.at(-1).value-account.equity;
    outcomes.push({alternativeId:alternative.id,alternativeHash:alternative.alternativeHash,freezeId:frozen.id,informationCutoff:frozen.informationCutoff,
      constraintsHash:frozen.constraintsHash,costPolicyHash:frozen.costPolicyHash,capital:frozen.capital,horizonDays:frozen.horizonDays,
      periodStartAt:Date.parse(dates[start]+'T09:30:00+08:00'),periodEndAt:endAt,knownAt:history.knownAt,source:history.source,
      mode:'constrained-paper-replay',constraintsVerified:true,mature:true,grossPnl:round(netPnl+totalCosts),totalCosts:round(totalCosts),netPnl:round(netPnl)});
    replayDetails.push({alternativeId:alternative.id,orders,equity,maxDrawdown:round(maxDrawdown),finalHoldings:[...holdings.values()],actualExecutionClaim:false,...FLAGS});
  }
  return {...reviewDecisionAlternatives(frozen,outcomes,{asOf}),outcomes,replayDetails,
    limitations:['仅在冻结当日之后的首个交易日开盘（加事前延迟）调仓一次；受阻部分继续持有，不事后选择更有利的时点重试','收盘估值包含未实现盈亏，未假定期末必能清仓','只有历史约束下的纸面对照；没有真实订单队列或成交保证']};
}
function buildDeepDecisionResearch(input={},options={}) {
  const asOf=options.asOf??Date.now(),portfolio=researchPortfolioWeights(input.portfolio||{}, {asOf});
  const derivedRebalance=deriveRebalanceThresholdInput(input.portfolio||{},portfolio,{asOf});
  const explicitRebalance=input.rebalance&&(input.rebalance.forcedRisk?.triggered===true||Object.keys(input.rebalance).some(k=>k!=='forcedRisk'));
  const rebalanceInput=explicitRebalance?input.rebalance:derivedRebalance;
  const rebalance={...evaluateRebalanceThreshold(rebalanceInput, {asOf}),derivation:rebalanceInput.derivation||null};
  const robustness=checkDecisionRobustness(input.robustness||{portfolio:input.portfolio},{asOf,evaluate:options.evaluate});
  const counterfactual=input.frozen?reviewDecisionAlternatives(input.frozen,input.outcomes||[],{asOf}):{task:76,status:'pending',records:[],missing:['尚无事前冻结的备选方案'],...FLAGS};
  return {schemaVersion:1,asOf,portfolio,rebalance,robustness,counterfactual,...FLAGS};
}
module.exports={FLAGS,researchPortfolioWeights,evaluateRebalanceThreshold,checkDecisionRobustness,freezeDecisionAlternatives,listDecisionAlternatives,
  reviewDecisionAlternatives,recordDecisionAlternativeReview,evaluateDecisionAlternatives,replayDecisionAlternatives,resolveFrozenRequest,deriveDecisionReplayHistory,
  deriveRebalanceThresholdInput,derivePortfolioArchiveEvidence,buildDeepDecisionResearch};
