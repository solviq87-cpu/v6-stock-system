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
function backtestResearch36(input={}){
 const {strategyId,stocks,evidenceByDate,config={},options={}}=input;
 if(!catalog.strategies.some(s=>s.id===strategyId)||!Array.isArray(stocks)||stocks.length>200||!plain(evidenceByDate)||!plain(options))throw Error('回测研究输入无效');
 settings(config);
 const allowed=['start','end','initialCash','topN','holdDays','feeBps','slippageBps','sellTaxBps','maxParticipationPct','minPriorTurnover','maxDrawdownPausePct','maxDailyLossPausePct','feeSchedules','riskPolicy','universeHistory','settlements','tradingDates'];
 if(Object.keys(options).some(k=>!allowed.includes(k)))throw Error('不允许覆盖回测选择器或真实性门禁');
 if(stocks.some(s=>!Array.isArray(s.bars)||s.bars.length>3000)||stocks.reduce((n,s)=>n+s.bars.length,0)>50000)throw Error('历史长度超限');
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
function experimentResearch36(input={}){
 const {windows,...base}=input;
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
 const result=windows.map(w=>({window:clone(w),result:backtestResearch36({...base,options:{...base.options,start:w.start,end:w.end}})}));
 return {researchOnly:true,canTrade:false,configHash,purgeSessions:purge,windows:result,productionWeightsChanged:false,outOfSampleValidated:false,
  note:'固定配置分窗评估，不执行参数拟合或按测试集选参；窗口标签不证明事前注册或独立样本外认证。'};
}
module.exports={getCatalog,settings,technicalFeatures,evaluateResearch36,backtestResearch36,researchMetrics,experimentResearch36};
