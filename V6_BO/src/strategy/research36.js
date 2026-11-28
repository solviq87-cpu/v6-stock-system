'use strict';
const crypto=require('node:crypto');
const catalog=require('../../strategies/research36.json');
const {barsToIndicators}=require('./historical-indicators');
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clock=v=>Number.isSafeInteger(v)&&v>0&&v<8e15;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>Array.isArray(v)?v.map(canonical):plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
function getCatalog(){return clone(catalog);}
function settings(config={}){
 if(!plain(config)||Object.keys(config).some(k=>!catalog.strategies.some(s=>s.id===k)))throw Error('未知策略配置');
 return catalog.strategies.map(s=>{
  const c=Object.hasOwn(config,s.id)?config[s.id]:{};
  if(!plain(c)||Object.keys(c).some(k=>!['enabled','weight','thresholds'].includes(k)))throw Error('非法研究配置');
  if(c.enabled!==undefined&&typeof c.enabled!=='boolean')throw Error('启停必须为布尔值');
  if(c.weight!==undefined&&(!finite(c.weight)||c.weight<0||c.weight>100))throw Error('研究权重必须为0至100');
  const thresholds=c.thresholds??{};
  if(!plain(thresholds)||Object.keys(thresholds).some(k=>!s.rules.some(r=>r.field===k)))throw Error('未知条件阈值');
  const rules=s.rules.map(r=>{
   if(!Object.hasOwn(thresholds,r.field))return clone(r);
   const v=thresholds[r.field];
   const valid=r.type==='boolean'?typeof v==='boolean':r.op==='between'?Array.isArray(v)&&v.length===2&&v.every(finite)&&v[0]<=v[1]:finite(v);
   if(!valid)throw Error('条件阈值类型或区间错误');
   return {...r,value:clone(v)};
  });
  return {...s,enabled:c.enabled??s.enabled,weight:c.weight??1,rules};
 });
}
function accepts(value,r){
 switch(r.op){case 'gt':return value>r.value;case 'gte':return value>=r.value;case 'lt':return value<r.value;case 'lte':return value<=r.value;case 'eq':return value===r.value;case 'between':return value>=r.value[0]&&value<=r.value[1];default:throw Error('未知比较符');}
}
function proofProblem(p,r,code,asOf){
 if(!plain(p))return '缺少字段证据';
 if(p.code!==code)return '证据标的不一致';
 if(typeof p.source!=='string'||!p.source.trim()||typeof p.evidenceId!=='string'||!p.evidenceId.trim())return '缺少来源或证据引用';
 if(p.simulated===true||p.retracted===true)return '模拟或已撤销证据';
 if(![p.observedAt,p.availableAt,p.recordedAt].every(clock))return '缺少原始、可得或记录时点';
 if(p.observedAt>p.availableAt||p.availableAt>p.recordedAt||p.recordedAt>asOf)return '未来或不一致时点';
 if(asOf-p.observedAt>r.maxAgeMs)return '证据超过研究时效';
 if(p.unit!==r.unit)return '单位不一致';
 if(r.type==='boolean'?typeof p.value!=='boolean':!finite(p.value))return '未知或非法数值';
 // Bound only fields whose definition guarantees a domain. Ratios, returns,
 // cash flows and accounting percentages may legitimately exceed 100 or be negative.
 const v=p.value;
 if((r.unit==='percentile'||['rsi14','ensembleScore','sectorBreadthPct'].includes(r.field))&&(v<0||v>100)||
    r.field==='sectorStrengthChange'&&(v< -100||v>100)||
    r.unit==='polarity'&&(v< -1||v>1)||
    r.field==='closeLocation'&&(v<0||v>1)||
    r.unit==='rank'&&(!Number.isSafeInteger(v)||v<1)||
    r.unit==='trading-days'&&(!Number.isSafeInteger(v)||v<0)||
    r.unit==='minutes'&&v<0)return '数值超出字段定义范围';
 return null;
}
// Technical features use only completed, causally available daily bars. No source
// time is invented from the evaluation clock or from the batch receive time.
function technicalFeatures(stock,asOf){
 if(!Array.isArray(stock.bars)||stock.bars.length>5000)return {};
 // An undated hole must not silently shorten an indicator window. Future rows
 // may be excluded only when their own available/recorded clocks are explicit.
 if(stock.bars.some(b=>!plain(b)||!clock(b.availableAt)||!clock(b.recordedAt)))return {};
 const bars=stock.bars.filter(b=>plain(b)&&clock(b.availableAt)&&clock(b.recordedAt)&&b.availableAt<=asOf&&b.recordedAt<=asOf);
 if(bars.length<27)return {};
 let prior='';
 for(const b of bars){
  if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<=prior||b.final!==true||b.priceBasis!=='unadjusted'||
    typeof b.source!=='string'||!b.source.trim()||!clock(b.observedAt)||b.observedAt>b.availableAt||b.availableAt>b.recordedAt||
    !Number.isFinite(Date.parse(b.date))||new Date(b.date).toISOString().slice(0,10)!==b.date||Date.parse(b.date+'T15:00:00+08:00')>b.availableAt)return {};
  prior=b.date;
 }
 if(new Set(bars.map(b=>b.source)).size!==1)return {};
 const ind=barsToIndicators(bars),prev=barsToIndicators(bars.slice(0,-1));if(!ind.valid||!prev.valid)return {};
 const last=bars.at(-1),before=bars.at(-2),ratio=(a,b)=>finite(a)&&finite(b)&&b>0?a/b:null;
 const previous=bars.slice(0,-1),closes=bars.slice(-20).map(b=>b.close);
 const mean=closes.reduce((a,b)=>a+b,0)/closes.length;
 const sd=Math.sqrt(closes.reduce((a,b)=>a+(b-mean)**2,0)/closes.length);
 const values={ma5Over10:ratio(ind.ma5,ind.ma10),ma10Over20:ratio(ind.ma10,ind.ma20),closeOver20:ratio(last.close,ind.ma20),closeOver10:ratio(last.close,ind.ma10),
  closeOverPrior20High:ratio(last.close,Math.max(...previous.slice(-20).map(b=>b.high))),
  closeOverPrior60High:bars.length>=61?ratio(last.close,Math.max(...previous.slice(-60).map(b=>b.high))):null,
  closeOverPrior5High:ratio(last.close,Math.max(...previous.slice(-5).map(b=>b.high))),closeOverPriorHigh:ratio(last.close,before.high),
  volumeRatio:ind.volumeRatio,macdHist:ind.macd.hist,priorMacdHist:prev.macd.hist,closeOverUpperBand:ratio(last.close,mean+2*sd),
  dailyReturnPct:(last.close/before.close-1)*100,priorDailyReturnPct:(before.close/bars.at(-3).close-1)*100,rsi14:ind.rsi14,
  closeLocation:last.high>last.low?(last.close-last.low)/(last.high-last.low):null,
  drawdown20Pct:(last.close/Math.max(...closes)-1)*100};
 const definitions=new Map(catalog.strategies.flatMap(s=>s.rules.map(r=>[r.field,r]))),out={};
 const proof={code:stock.code,source:last.source,evidenceId:'daily-prefix:'+hash(bars),observedAt:last.observedAt,
  availableAt:Math.max(...bars.map(b=>b.availableAt)),recordedAt:Math.max(...bars.map(b=>b.recordedAt))};
 for(const [field,value] of Object.entries(values))if(finite(value))out[field]={...proof,value,unit:definitions.get(field).unit};
 return out;
}
function evaluateResearch36({stock,asOf,config={}}={}){
 if(!plain(stock)||typeof stock.code!=='string'||!/^\d{6}$/.test(stock.code)||!clock(asOf))throw Error('需要六位股票代码及明确研究时点');
 if(stock.features!==undefined&&!plain(stock.features))throw Error('字段证据必须为对象');
 const strategies=settings(config),features={...technicalFeatures(stock,asOf),...(stock.features||{})};
 const evaluations=strategies.map(s=>{
  const checks=s.rules.map(r=>{
   const proof=Object.hasOwn(features,r.field)?features[r.field]:null,missing=proofProblem(proof,r,stock.code,asOf);
   return {field:r.field,op:r.op,threshold:r.value,unit:r.unit,value:missing?null:proof.value,
    pass:missing?null:accepts(proof.value,r),missing,
    evidence:proof?{source:proof.source??null,evidenceId:proof.evidenceId??null,observedAt:proof.observedAt??null,availableAt:proof.availableAt??null,recordedAt:proof.recordedAt??null}:null};
  });
  const missing=checks.filter(c=>c.missing),passed=checks.filter(c=>c.pass===true);
  const status=!s.enabled||s.weight===0?'disabled':missing.length?'insufficient_data':passed.length===checks.length?'research_candidate':'not_matched';
  return {id:s.id,name:s.name,family:s.family,version:s.version,weight:s.weight,experimental:true,productionEnabled:false,canTrade:false,
   configHash:hash(s),status,score:missing.length?null:Math.round(passed.length/checks.length*100),scoreKind:'condition-coverage-not-probability',
   support:passed,opposition:checks.filter(c=>c.pass===false),missing,checks,invalidation:s.invalidation,action:status==='research_candidate'?'关注研究':status==='insufficient_data'?'等待数据':'观望',predictionProbability:null};
 });
 // A family contributes at most once. This is a transparent redundancy cap,
 // not a claim that the remaining families are statistically independent.
 const families=Object.keys(catalog.families).map(family=>{
  const rows=evaluations.filter(r=>r.family===family&&r.status==='research_candidate').sort((a,b)=>b.weight-a.weight||a.id.localeCompare(b.id));
  return {family,selected:rows[0]?.id??null,redundant:rows.slice(1).map(r=>r.id)};
 });
 return {schemaVersion:1,catalogVersion:catalog.version,code:stock.code,asOf,configHash:hash(strategies),inputHash:hash({stock,asOf}),
  researchOnly:true,canTrade:false,canNotify:false,verifiedExternal:false,productionWeightsChanged:false,predictionProbability:null,
  evaluations,families,matched:evaluations.filter(r=>r.status==='research_candidate').length,
  note:'调用方证据尚未独立认证；满足研究条件不代表可交易、已校准概率或样本外有效。'};
}
function validateResearchBacktest(stocks,evidenceByDate,config,options){
 if(!Array.isArray(stocks)||stocks.length>200||!plain(evidenceByDate)||!plain(options))throw Error('回测研究输入无效');
 settings(config);
 const allowed=['start','end','initialCash','topN','holdDays','feeBps','slippageBps','sellTaxBps','maxParticipationPct','minPriorTurnover','maxDrawdownPausePct','maxDailyLossPausePct','feeSchedules','riskPolicy','universeHistory','settlements','tradingDates'];
 if(Object.keys(options).some(k=>!allowed.includes(k)))throw Error('不允许覆盖回测选择器或真实性门禁');
 if(stocks.some(s=>!Array.isArray(s.bars)||s.bars.length>3000)||stocks.reduce((n,s)=>n+s.bars.length,0)>50000)throw Error('历史长度超限');
}
function backtestResearch36(input={}){
 const {strategyId,stocks,evidenceByDate,config={},options={}}=input;
 if(!catalog.strategies.some(s=>s.id===strategyId))throw Error('回测研究输入无效');
 validateResearchBacktest(stocks,evidenceByDate,config,options);
 const seen=[];
 const result=require('./position-ledger-backtest').ledgerBacktest({...options,stocks,strictHistoricalStatus:true,strictMarks:true,source:'research36-imported',
  selectCandidates:(prefix,day)=>prefix.filter(s=>{
   const code=String(s.symbol||s.code),date=s.bars.at(-1)?.date,asOf=Date.parse(date+'T15:00:00+08:00');
   const features=evidenceByDate[date]?.[code]||{};
   const r=evaluateResearch36({stock:{code,bars:s.bars,features},asOf,config});
   const strategy=r.evaluations.find(x=>x.id===strategyId);seen.push({code,date,day,asOf,status:strategy.status,configHash:r.configHash,inputHash:r.inputHash});
   return strategy.status==='research_candidate';
  }).map(s=>String(s.symbol||s.code))});
 const benchmark=require('./position-ledger-backtest').ledgerBacktest({...options,stocks,topN:stocks.length,strictHistoricalStatus:true,strictMarks:true,source:'research36-imported',
  selectCandidates:prefix=>prefix.map(s=>String(s.symbol||s.code)).sort()});
 return {...result,additionalMetrics:researchMetrics(result),benchmark:{name:'同池等额定期持有基准',executionModel:benchmark.executionModel,metrics:benchmark.metrics,
  additionalMetrics:researchMetrics(benchmark),equity:benchmark.equity,canTrade:false,verifiedExternal:false},
  research36:{strategyId,version:catalog.version,configHash:hash(settings(config)),signals:seen},
  predictionProbability:null,outOfSampleValidated:false,warning:'导入声明及实验参数；本次结果不是独立样本外验证。'};
}
function researchMetrics(result){
 const equities=result.equity.map(x=>x.value),returns=equities.slice(1).map((v,i)=>v/equities[i]-1);
 const mean=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null;
 const deviation=returns.length>1?Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1)):null;
 const pnl=result.trades.map(t=>t.netPnl).filter(finite),wins=pnl.filter(p=>p>0),losses=pnl.filter(p=>p<0);
 const grossWins=wins.reduce((a,b)=>a+b,0),grossLosses=-losses.reduce((a,b)=>a+b,0);
 const averageEquity=equities.length?equities.reduce((a,b)=>a+b,0)/equities.length:null;
 const turnover=result.orders.filter(o=>o.status==='filled').reduce((n,o)=>n+o.shares*o.price,0);
 return {sharpeZeroRiskFree252:deviation>0?mean/deviation*Math.sqrt(252):null,
  profitFactor:grossLosses>0?grossWins/grossLosses:null,
  averageWinLossRatio:wins.length&&losses.length?(grossWins/wins.length)/(grossLosses/losses.length):null,
  grossTurnoverRatio:averageEquity>0?turnover/averageEquity:null,
  conventions:'夏普按252期、零无风险利率；换手为区间双边成交额/平均净值；无亏损或零波动保持null。'};
}
function validateExperimentWindows(base,windows){
 if(!Array.isArray(windows)||windows.length<3||windows.length>12)throw Error('需要3至12个明确研究窗口');
 const configHash=hash(settings(base.config||{})),purge=Math.max(1,base.options?.holdDays??1)+1;
 const length=Array.isArray(base.stocks)&&base.stocks.length?Math.min(...base.stocks.map(s=>Array.isArray(s.bars)?s.bars.length:0)):0;
 let end=-Infinity;const labels=new Set();
 for(const w of windows){
  if(!plain(w)||typeof w.label!=='string'||!w.label.trim()||labels.has(w.label)||!['train','validation','test'].includes(w.role)||
   !Number.isInteger(w.start)||!Number.isInteger(w.end)||w.start<27||w.end<=w.start||w.end>=length||w.start<=end+purge)throw Error('窗口重叠、顺序、角色、数据覆盖或隔离期无效');
  labels.add(w.label);end=w.end;
 }
 if(!['train','validation','test'].every(role=>windows.some(w=>w.role===role)))throw Error('缺少训练、验证或测试窗口');
 return {configHash,purge};
}
function experimentResearch36(input={}){
 if(input.compareRoutes!==undefined&&typeof input.compareRoutes!=='boolean')throw Error('路由研究开关必须是布尔值');
 if(input.compareRoutes===true)return compareResearchRoutes(input);
 const {windows,...base}=input,{configHash,purge}=validateExperimentWindows(base,windows);
 const result=windows.map(w=>({window:clone(w),result:backtestResearch36({...base,options:{...base.options,start:w.start,end:w.end}})}));
 return {researchOnly:true,canTrade:false,configHash,purgeSessions:purge,windows:result,productionWeightsChanged:false,outOfSampleValidated:false,
  note:'固定配置分窗评估，不执行参数拟合或按测试集选参；窗口标签不证明事前注册或独立样本外认证。'};
}
// F21.1/F21.2/F21.4. One bounded opt-in experiment on the ORIGINAL
// research36 evaluators and original position ledger; no production router.
const ROUTE_IDS=Object.freeze({trend:'ma_trend',event:'news',reversal:'oversold'});
const ROUTE_NAMES=Object.keys(ROUTE_IDS);
const ARMS=Object.freeze([...ROUTE_NAMES,'fixed','dynamic']);
const MARKET_KEYS=['breadthScore','indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore'];
const MIN_ROUTE_SWITCH_SESSIONS=5;
const validLabel=s=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=240;
function routeMarketReceipt(row,date,asOf){
 // The original classifier's neutral fallback is not admissible route evidence.
 if(!plain(row)||row.date!==date||!validLabel(row.source)||!validLabel(row.evidenceId)||
  row.simulated===true||row.synthetic===true||row.retracted===true||row.sourceConflict===true||
  ![row.observedAt,row.availableAt,row.recordedAt].every(clock)||
  row.observedAt<Date.parse(date+'T00:00:00+08:00')||row.observedAt>row.availableAt||
  row.availableAt>row.recordedAt||row.recordedAt>asOf||!plain(row.scores)||
  !MARKET_KEYS.every(k=>Object.hasOwn(row.scores,k)&&finite(row.scores[k])&&row.scores[k]>=0&&row.scores[k]<=100))return null;
 const scores=Object.fromEntries(MARKET_KEYS.map(k=>[k,row.scores[k]]));
 const regime=require('../core/market-regime').classifyMarket(scores).regime;
 return {date,source:row.source,evidenceId:row.evidenceId,observedAt:row.observedAt,availableAt:row.availableAt,
  recordedAt:row.recordedAt,scores,regime,verifiedExternal:false};
}
function summarizeRouteEconomics(arms){
 const base=arms?.fixed;
 const unknown=reason=>({status:'unknown',reason,netMarkedReturnDeltaPct:null,drawdownDeltaPct:null,feeDeltaCny:null,turnoverDelta:null,
   dailyPairedSamples:0,meanDailyReturnDeltaPct:null,worstDailyReturnDeltaPct:null,actualLatencyMs:null,maintenanceCostCny:null,canTrade:false});
 function facts(a){
  const r=a?.report,e=r?.equity,o=r?.orders,m=r?.metrics;
  if(!Array.isArray(e)||e.length<2||!Array.isArray(o)||!finite(m?.initialCash)||m.initialCash<=0||
     !finite(m.returnPct)||!finite(m.maxDrawdownPct)||!a.buyFills||e.some((x,i)=>!Number.isSafeInteger(x.day)||i&&x.day!==e[i-1].day+1||!finite(x.value)||x.value<=0||!Array.isArray(x.unpriced)||x.unpriced.length))return null;
  const fills=o.filter(x=>x.status==='filled');
  if(fills.some(x=>!finite(x.fees)||x.fees<0||!finite(x.price)||x.price<=0||!Number.isSafeInteger(x.shares)||x.shares<=0))return null;
  return {rows:e,initialCash:m.initialCash,netMarkedReturnPct:m.returnPct,drawdownPct:m.maxDrawdownPct,
   fees:fills.reduce((n,x)=>n+x.fees,0),turnover:fills.reduce((n,x)=>n+x.price*x.shares,0),blocked:o.filter(x=>x.status==='blocked').length,
   openPositions:r.openPositions?.length??null};
 }
 const baseline=facts(base),rows={};
 for(const [name,arm]of Object.entries(arms||{})){
  if(name==='fixed')continue;
  const candidate=facts(arm);
  if(!baseline||!candidate||baseline.initialCash!==candidate.initialCash||baseline.rows.length!==candidate.rows.length||baseline.rows.some((x,i)=>x.day!==candidate.rows[i].day)){rows[name]=unknown('INCOMPLETE_OR_UNMATCHED_ORIGINAL_LEDGER');continue;}
  const delta=candidate.rows.slice(1).map((x,i)=>100*(x.value/candidate.rows[i].value-baseline.rows[i+1].value/baseline.rows[i].value));
  if(!delta.every(finite)){rows[name]=unknown('INVALID_PAIRED_RETURN');continue;}
  const round=x=>Number(x.toFixed(8));
  rows[name]={...unknown(null),status:'descriptive-only',initialCash:baseline.initialCash,
   netMarkedReturnDeltaPct:round(candidate.netMarkedReturnPct-baseline.netMarkedReturnPct),drawdownDeltaPct:round(candidate.drawdownPct-baseline.drawdownPct),
   feeDeltaCny:round(candidate.fees-baseline.fees),turnoverDelta:round(candidate.turnover-baseline.turnover),
   dailyPairedSamples:delta.length,meanDailyReturnDeltaPct:round(delta.reduce((a,b)=>a+b,0)/delta.length),worstDailyReturnDeltaPct:round(Math.min(...delta)),
   baseline:{markedReturnPct:baseline.netMarkedReturnPct,drawdownPct:baseline.drawdownPct,feesCny:round(baseline.fees),turnoverCny:round(baseline.turnover),blockedOrders:baseline.blocked,openPositions:baseline.openPositions},
   candidate:{markedReturnPct:candidate.netMarkedReturnPct,drawdownPct:candidate.drawdownPct,feesCny:round(candidate.fees),turnoverCny:round(candidate.turnover),blockedOrders:candidate.blocked,openPositions:candidate.openPositions}};
 }
 return {baseline:'fixed',rows,actualCapacityVerified:false,independentEconomicValueVerified:false,trialBudgetVerified:false,canTrade:false,
  basis:'原同窗独立账本标记净值、原成交费用及成交额；费用已含于净值，不重复扣除；实际延迟、维护成本和可成交容量未认证'};
}
function compareResearchRoutes(input={}){
 const {stocks,evidenceByDate,config={},options={},windows,marketByDate}=input;
 validateResearchBacktest(stocks,evidenceByDate,config,options);
 const {configHash,purge}=validateExperimentWindows(input,windows);
 if(!stocks.length||!plain(marketByDate)||Object.keys(marketByDate).length>3000)throw Error('路由研究缺少有界市场时点档案');
 const dates=new Set(stocks[0].bars.map(b=>b.date));
 if(Object.keys(marketByDate).some(date=>!dates.has(date)))throw Error('路由市场档案含非输入交易日');
 // Budget BEFORE starting any of the five runs in a window. Count repeated
 // prefix validation by the original ledger as well as daily strategy evaluation.
 const workUnits=stocks.length*ARMS.length*windows.reduce((n,w)=>n+w.end+1,0);
 if(workUnits>60000)throw Error('路由研究超出60000条原账本历史工作单位上限，请缩小原研究样本');
 const protocol={schemaVersion:1,catalogVersion:catalog.version,configHash,representatives:{...ROUTE_IDS},
  arms:[...ARMS],weights:{fixed:[1,1,1],focusMultiplier:2},marketMapping:{risk_on:'trend',trend:'trend',mean_reversion:'reversal',neutral:'event',risk_off:'abstain'},
  minimumSwitchSessions:MIN_ROUTE_SWITCH_SESSIONS,resetBetweenWindows:true,purgeSessions:purge,
  options:clone(options),windows:clone(windows),coverageBasis:'all three original representatives known plus explicit market receipt; no unknown score substitution'};
 const evidenceFingerprint=hash({stocks,evidenceByDate,marketByDate,config}),protocolFingerprint=hash({protocol,evidenceFingerprint});
 const ledger=require('./position-ledger-backtest').ledgerBacktest;
 let outputRows=0,evaluationCalls=0,cacheReuses=0;
 const result=[];
 for(const w of windows){
  const cache=new Map();let focus=null,lastSwitch=null,switchCount=0;
  const makeDay=(prefix,dayIndex)=>{
   if(cache.has(dayIndex)){
    cacheReuses++;const prev=cache.get(dayIndex);
    if(prev.symbols.join('/')!==prefix.map(s=>String(s.symbol||s.code)).join('/'))throw Error('原回测各臂股票池不一致');
    return prev;
   }
   const date=stocks[0].bars[dayIndex].date,asOf=Date.parse(date+'T15:00:00+08:00');
   const market=routeMarketReceipt(Object.hasOwn(marketByDate,date)?marketByDate[date]:null,date,asOf);
   const wanted=market?protocol.marketMapping[market.regime]:null;
   let switched=false,skipReason=!market?'MARKET_EVIDENCE_UNKNOWN':wanted==='abstain'?'ORIGINAL_RISK_OFF_ABSTENTION':null;
   if(!skipReason&&wanted!==focus&&(lastSwitch===null||dayIndex-lastSwitch>=MIN_ROUTE_SWITCH_SESSIONS)){
    if(focus!==null){switchCount++;switched=true;}
    focus=wanted;lastSwitch=dayIndex;
   }
   const counts=Object.fromEntries(ROUTE_NAMES.map(name=>[name,{evaluated:0,passed:0,unknown:0,disabled:0}]));
   const rows=prefix.map(s=>{
    const code=String(s.symbol||s.code);
    const observed=evaluateResearch36({stock:{code,bars:s.bars,features:evidenceByDate[date]?.[code]||{}},asOf,config});evaluationCalls++;
    const verdicts=Object.fromEntries(ROUTE_NAMES.map(name=>{
     const rule=observed.evaluations.find(r=>r.id===ROUTE_IDS[name]),count=counts[name];
     if(rule.status==='research_candidate'||rule.status==='not_matched'){count.evaluated++;if(rule.status==='research_candidate')count.passed++;}
     else if(rule.status==='disabled')count.disabled++;else count.unknown++;
     return [name,{id:rule.id,version:rule.version,status:rule.status,configHash:rule.configHash}];
    }));
    return {code,inputHash:observed.inputHash,configHash:observed.configHash,verdicts,
     common:ROUTE_NAMES.every(name=>['research_candidate','not_matched'].includes(verdicts[name].status))};
   });
   const common=rows.filter(r=>r.common),eligible=skipReason?[]:common;
   const passes=(row,name)=>row.verdicts[name].status==='research_candidate';
   const rank=arm=>eligible.map(row=>({code:row.code,value:ROUTE_NAMES.reduce((n,name)=>n+(passes(row,name)?
    (arm==='fixed'?1:arm==='dynamic'?name===focus?2:1:arm===name?1:0):0),0)}))
    .filter(row=>row.value>0).sort((a,b)=>b.value-a.value||a.code.localeCompare(b.code)).map(row=>row.code);
   const picks=Object.fromEntries(ARMS.map(arm=>[arm,rank(arm)]));
   const trace={date,asOf,dayIndex,market,wantedFocus:wanted,activeFocus:focus,switched,
    switchDeferred:!skipReason&&wanted!==focus,skipReason,expectedSymbols:rows.length,commonEvaluated:common.length,
    comparableSymbols:eligible.length,counts,rows,pickCounts:Object.fromEntries(ARMS.map(arm=>[arm,picks[arm].length]))};
   outputRows+=rows.length+1;if(outputRows>40000)throw Error('路由完整证据超过40000行上限，不截取局部结果');
   const item={symbols:rows.map(row=>row.code),trace,picks};cache.set(dayIndex,item);return item;
  };
  const arms=Object.fromEntries(ARMS.map(arm=>{
   const report=ledger({...options,stocks,start:w.start,end:w.end,strictHistoricalStatus:true,strictMarks:true,source:'research36-imported',
    selectCandidates:(prefix,dayIndex)=>makeDay(prefix,dayIndex).picks[arm]});
   outputRows+=report.orders.length+report.trades.length+report.equity.length+report.openPositions.length;
   if(outputRows>40000)throw Error('路由完整证据超过40000行上限，不截取局部结果');
   const buyFills=report.orders.filter(o=>o.side==='buy'&&o.status==='filled').length;
   return [arm,{status:!buyFills?'no-buy-fills':report.openPositions.length?'unsettled-paper-estimate':'closed-paper-estimate',
    buyFills,markedReturnPct:buyFills?report.metrics.returnPct:null,
    closedAccountReturnPct:buyFills&&report.metrics.closedTrades&&!report.openPositions.length?report.metrics.returnPct:null,
    additionalMetrics:researchMetrics(report),report}];
  }));
  const trace=[...cache.values()].map(x=>x.trace),sum=key=>trace.reduce((n,row)=>n+row[key],0);
  result.push({window:clone(w),arms,economicComparison:summarizeRouteEconomics(arms),trace,switchCount,expectedSymbols:sum('expectedSymbols'),commonEvaluated:sum('commonEvaluated'),
   comparableSymbols:sum('comparableSymbols'),marketUnknownSessions:trace.filter(x=>x.skipReason==='MARKET_EVIDENCE_UNKNOWN').length,
   riskOffSessions:trace.filter(x=>x.skipReason==='ORIGINAL_RISK_OFF_ABSTENTION').length});
 }
 return {schemaVersion:1,mode:'fixed-representative-route-research',status:'descriptive-only',protocol,protocolFingerprint,evidenceFingerprint,
  windows:result,workUnits,evaluationCalls,cacheReuses,outputRows,researchOnly:true,canTrade:false,canTrain:false,canNotify:false,
  productionWeightsChanged:false,eligibleForPromotion:false,outOfSampleValidated:false,trialBudgetVerified:false,
  limitations:['固定三条代表规则不代表完整事件、趋势、反转族或原四体系；反转使用原超跌修复规则，原目录仍属事件族',
   '固定组合等权、动态组合仅提高当前焦点的候选排序权重；每个独立原账本使用同样资金、期限及费用，不改正式权重',
   '未知市场或任一代表规则未知时共同弃权；已明确风险关闭的日期共同不新增，原卖出及风险门禁继续运行',
   '权重映射为固定研究假设，不是批准调度、未来收益预测或真实成交；独立预注册、留出样本及价值另验']};
}
module.exports={getCatalog,settings,technicalFeatures,evaluateResearch36,backtestResearch36,researchMetrics,experimentResearch36,compareResearchRoutes,summarizeRouteEconomics};
