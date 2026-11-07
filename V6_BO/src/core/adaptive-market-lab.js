'use strict';
// Bounded, deterministic research: daily decisions, matured labels, explicit evidence.
const crypto=require('node:crypto');
const {validateEvidence,resolveEvidence}=require('./imported-risk-evidence');
const {validateDataset,validateBacktestConfig}=require('./historical-validation');
const {ledgerBacktest}=require('../strategy/research-v2-position-ledger-backtest');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const instant=x=>{if(typeof x!=='string')return false;const m=x.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);return !!m&&date(m[1])&&+m[2]<24&&+m[3]<60&&+m[4]<60&&(m[5]==='Z'||(+m[6]<24&&+m[7]<60))&&Number.isFinite(Date.parse(x));};
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const INDEX_IDS=['shanghai','shenzhen','chinext','a50'];
const RULES=[{id:'ma_cross',label:'双均线金叉',source:'https://www.backtrader.com/docu/strategy-reference/'},{id:'donchian_breakout',label:'前20日高点突破',source:'https://www.backtrader.com/recipes/indicators/donchian/donchian/'},{id:'bollinger_reentry',label:'布林下轨回归',source:'https://www.backtrader.com/docu/indautoref/'},...['fourteen','bazi','gpt','python'].map(id=>({id,label:'原体系证据 '+id,source:'explicit-originalRuleSignals'}))];
function visibleBars(input,asOf,at,{a50=false}={}){
 if(!Array.isArray(input)||input.length>600)throw Error('每条历史须为不超过600条数组');
 let last='';const out=[];
 for(const b of input){
  if(!b||!date(b.date)||b.date<=last)throw Error('日期无效、重复或未递增');last=b.date;
  if(b.date>asOf)continue;
  if(!instant(b.knownAt))throw Error('日线缺少带时区knownAt');if(Date.parse(b.knownAt)>at)continue;
  const closeAt=a50?b.sessionCloseAt:b.date+'T15:00:00+08:00';
  if(!instant(closeAt)||Date.parse(closeAt)<Date.parse(b.date+'T00:00:00+08:00')||Date.parse(closeAt)>Date.parse(b.date+'T00:00:00+08:00')+2*86400000||Date.parse(closeAt)>Date.parse(b.knownAt))throw Error('日线收盘时点缺失或早于收盘即宣称已知');
  if(![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.open<=0||b.close<=0||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.volume<0||!Number.isSafeInteger(b.volume))throw Error('OHLCV无效');
  out.push({...b});
 }
 return out;
}
function regimeKey(bars,i){if(i<20)return null;const ma=mean(bars.slice(i-19,i+1).map(b=>b.close));return (bars[i].close>=ma?'above':'below')+'-'+(bars[i].close>=bars[i-5].close?'up':'down');}
function indexForecast(bars,at=Infinity){
 const buckets={},history=[];let evaluated=0,brier=0,hits=0;
 for(let i=20;i<bars.length;i++){
  const cut=Math.min(at,Date.parse(bars[i].date+'T23:59:59.999+08:00'));
  const prev=history.at(-1)?.state;
  if(prev&&Date.parse(bars[i].knownAt)<=cut){const b=buckets[prev]||(buckets[prev]={n:0,wins:0,sum:0}),ret=bars[i].close/bars[i-1].close-1;b.n++;b.wins+=ret>0?1:0;b.sum+=ret;}
  const known=bars.slice(0,i+1).every(b=>Date.parse(b.knownAt)<=cut);
  const key=known?regimeKey(bars,i):null,b=buckets[key]||{n:0,wins:0,sum:0};
  const prediction={date:bars[i].date,state:key,samples:b.n,upProbability:b.n>=20?(b.wins+1)/(b.n+2):null,expectedReturnPct:b.n>=20?b.sum/b.n*100:null,trainedThrough:bars[i].date};
  // Evaluate yesterday's already-frozen prediction; never score an in-sample fit.
  const prior=history.at(-1);if(prior?.upProbability!==null&&prior&&known){const up=bars[i].close>bars[i-1].close?1:0;evaluated++;brier+=(prior.upProbability-up)**2;hits+=(prior.upProbability>=.5)===(up===1)?1:0;}
  history.push(prediction);
 }
 return {latest:history.at(-1)||null,outOfSample:{evaluated,brier:evaluated?brier/evaluated:null,directionalAccuracy:evaluated?hits/evaluated:null},method:'expanding-conditional-frequency-laplace-v1',uncertainty:'经验频率，非保证；每状态不足20个已完成样本不预测',history};
}
function signals(bars,i){
 if(i<21)return [];
 const closes=bars.slice(i-20,i+1).map(b=>b.close),prev=closes.slice(0,20),cur=closes.slice(1),ma=mean(cur),sigma=Math.sqrt(mean(cur.map(x=>(x-ma)**2))),prevMa=mean(prev),prevSigma=Math.sqrt(mean(prev.map(x=>(x-prevMa)**2)));
 const result=[];
 if(mean(cur.slice(-5))>ma&&mean(prev.slice(-5))<=prevMa)result.push('ma_cross');
 if(bars[i].close>Math.max(...bars.slice(i-20,i).map(b=>b.high)))result.push('donchian_breakout');
 if(bars[i-1].close<prevMa-2*prevSigma&&bars[i].close>=ma-2*sigma)result.push('bollinger_reentry');
 for(const id of ['fourteen','bazi','gpt','python'])if(bars[i].originalRuleSignals?.[id]===true)result.push(id);
 return result;
}
const DEFENSIVE=new Set(['银行','保险','证券','白酒','非银金融','bank','banks','insurance','securities','baijiu']);
function selectionGate(symbol,day,at,sectorRecords,weightRecords,policy){
 const reasons=[];let sector=null,sectorRef=null,weightRef=null;
 if(policy.avoidDefensive){try{const selected=resolveEvidence(sectorRecords,{maxSectorPct:100},{tradeDate:day},{observedAt:at},at,null);sector=selected.sectors[symbol]||null;sectorRef=selected.evidenceRefs[0];if(!sector)reasons.push('MISSING_SECTOR_EVIDENCE');else if((policy.excludedSectors||[...DEFENSIVE]).includes(sector.toLowerCase().trim()))reasons.push('AVOID_DEFENSIVE_SECTOR');}catch{reasons.push('MISSING_OR_CONFLICTING_SECTOR_EVIDENCE');}}
 if(policy.avoidHeavyweights){
  const candidates=weightRecords.filter(r=>r.tradeDate===day&&Date.parse(r.knownAt)<=at).sort((a,b)=>Date.parse(a.knownAt)-Date.parse(b.knownAt));const latest=candidates.at(-1),same=latest?candidates.filter(r=>Date.parse(r.knownAt)===Date.parse(latest.knownAt)):[];
  const value=latest?.weights?.[symbol];
  if(!value||!INDEX_IDS.every(k=>Number.isFinite(value[k])&&value[k]>=0&&value[k]<=100))reasons.push('MISSING_INDEX_WEIGHT_EVIDENCE');
  else if(same.some(r=>hash(INDEX_IDS.map(k=>r.weights?.[symbol]?.[k]??null))!==hash(INDEX_IDS.map(k=>value[k]))))reasons.push('CONFLICTING_INDEX_WEIGHT_EVIDENCE');
  else{weightRef={version:latest.version,provider:latest.provider,fingerprint:hash(latest)};if(INDEX_IDS.some(k=>value[k]>=policy.maxIndexWeightPct))reasons.push('AVOID_INDEX_HEAVYWEIGHT');}
 }
 return {eligible:reasons.length===0,reasons,sector,sectorRef,weightRef};
}
function runAdaptiveResearch(input,{now=Date.now()}={}){
 if(!input||input.schemaVersion!==1||!['imported','simulated'].includes(input.source)||typeof input.provider!=='string'||!input.provider.trim()||input.provider.length>160||typeof input.version!=='string'||!input.version.trim()||input.version.length>160||!date(input.asOf)||!instant(input.decisionAt)||Date.parse(input.decisionAt)>now||input.asOf>new Date(Date.parse(input.decisionAt)+8*3600000).toISOString().slice(0,10))throw Error('研究来源、版本、日期或决策时点无效');
 if(input.selectionPolicy!=null&&(typeof input.selectionPolicy!=='object'||Array.isArray(input.selectionPolicy)))throw Error('回避配置须为对象');
 const at=Date.parse(input.decisionAt),policy={avoidDefensive:true,avoidHeavyweights:true,maxIndexWeightPct:3,requireMarket:true,requireForecast:true,minUpProbability:.5,...input.selectionPolicy};
 if(!['avoidDefensive','avoidHeavyweights','requireMarket','requireForecast'].every(k=>typeof policy[k]==='boolean')||!Number.isFinite(policy.maxIndexWeightPct)||policy.maxIndexWeightPct<=0||policy.maxIndexWeightPct>100||!Number.isFinite(policy.minUpProbability)||policy.minUpProbability<0||policy.minUpProbability>1)throw Error('选股回避参数无效');
 if(policy.excludedSectors!==undefined&&(!Array.isArray(policy.excludedSectors)||policy.excludedSectors.length>50||policy.excludedSectors.some(s=>typeof s!=='string'||!s.trim()||s.length>80)))throw Error('回避行业列表无效');policy.excludedSectors=(policy.excludedSectors||[...DEFENSIVE]).map(s=>s.trim().toLowerCase());
 const learningConfig={minimumSamples:20,priorStrength:2,...input.learningConfig};if(!Number.isSafeInteger(learningConfig.minimumSamples)||learningConfig.minimumSamples<20||learningConfig.minimumSamples>200||!Number.isFinite(learningConfig.priorStrength)||learningConfig.priorStrength<2||learningConfig.priorStrength>100)throw Error('学习参数无效');
 const costBps=input.learningCostBps??41;if(!Number.isFinite(costBps)||costBps<0||costBps>1000)throw Error('学习成本参数无效');
 const sectors=(input.sectorEvidence||[]);if(!Array.isArray(sectors)||sectors.length>1000)throw Error('行业证据超过上限');
 const sectorRecords=sectors.filter(r=>date(r?.tradeDate)&&r.tradeDate<=input.asOf&&Date.parse(r.knownAt)<=at).map(r=>validateEvidence(r,at));
 if(sectorRecords.some(r=>r.classificationAsOf>new Date(Date.parse(r.knownAt)+8*3600000).toISOString().slice(0,10)))throw Error('行业分类生效时点晚于证据获知日');
 if(sectorRecords.some(r=>r.kind!=='sector'))throw Error('行业证据类型不符');
 const weights=input.weightEvidence||[];if(!Array.isArray(weights)||weights.length>1000)throw Error('权重证据超过上限');
 const weightRecords=weights.filter(r=>date(r?.tradeDate)&&r.tradeDate<=input.asOf&&Date.parse(r.knownAt)<=at);
 for(const r of weightRecords)if(r.source!=='imported'||typeof r.provider!=='string'||!r.provider.trim()||r.provider.length>160||typeof r.version!=='string'||!r.version.trim()||r.version.length>160||!date(r.weightsAsOf)||r.weightsAsOf>r.tradeDate||!instant(r.knownAt)||r.weightsAsOf>new Date(Date.parse(r.knownAt)+8*3600000).toISOString().slice(0,10)||!instant(r.publishedAt)||Date.parse(r.publishedAt)>Date.parse(r.knownAt)||!r.weights||typeof r.weights!=='object')throw Error('指数权重时点或来源无效');
 const indexModels={};for(const id of INDEX_IDS){const series=input.indices?.[id];if(!series){indexModels[id]={usable:false,reason:'MISSING_INDEX_HISTORY'};continue;}
  if(typeof series.provider!=='string'||!series.provider.trim()||series.provider.length>160||typeof series.version!=='string'||!series.version.trim()||series.version.length>160||id==='a50'&&!['index','future'].includes(series.instrument))throw Error('指数来源、版本或A50品种缺失');
  const bars=visibleBars(series.bars,input.asOf,at,{a50:id==='a50'}),forecast=indexForecast(bars,at);indexModels[id]={forecastReady:forecast.latest?.upProbability!=null,usable:bars.length>=21&&bars.at(-1)?.date===input.asOf,provider:series.provider,version:series.version,instrument:series.instrument||'index',asOf:bars.at(-1)?.date||null,...forecast};
 }
 const marketAt=day=>{const rows=INDEX_IDS.map(id=>indexModels[id].history?.find(r=>r.date===day));if(rows.some(r=>!r?.state))return {usable:false,regime:'unknown'};const falling=rows.filter(r=>r.state==='below-down').length,rising=rows.filter(r=>r.state==='above-up').length;return {usable:true,regime:falling>=3?'risk_off':rising>=3?'risk_on':'mixed',upProbability:rows.every(r=>Number.isFinite(r.upProbability))?mean(rows.map(r=>r.upProbability)):null};};
 if(!Array.isArray(input.stocks)||input.stocks.length>50)throw Error('股票池须为不超过50只数组');
 let stocks=input.stocks.map(s=>({...s,bars:visibleBars(s.bars,input.asOf,at)}));
 if(stocks.reduce((n,s)=>n+s.bars.length,0)>20000)throw Error('股票历史总行数超过20000');
 let dataset=null;if(stocks.length){dataset=validateDataset({source:input.source,asOf:input.asOf,stocks});if(dataset.lastDate!==input.asOf)throw Error('股票历史未覆盖目标日');}
 let nativeAdaptation=null;
 if(input.nativeEvidence!==undefined){const adapted=require('./native-adaptive-adapter').adaptNativeStrategies(input,stocks);stocks=adapted.stocks;nativeAdaptation=adapted.audit;}
 const dates=stocks[0]?.bars.map(b=>b.date)||[],state=Object.fromEntries(RULES.map(r=>[r.id,{samples:0,wins:0,sum:0}])),daily=[],rankHistory=new Map(),pending=[];
 for(let i=21;i<dates.length;i++){
  const day=dates[i],cut=Math.min(at,Date.parse(day+'T23:59:59.999+08:00'));
  for(const sample of pending.filter(x=>x.exitDay===i)){
   const entry=sample.stock.bars[sample.signalDay+1],exit=sample.stock.bars[i];
   if(![entry,exit].every(b=>b.volume>0&&b.suspended===false&&b.tradable===true&&b.isST===false&&instant(b.statusKnownAt)&&Date.parse(b.statusKnownAt)<=Date.parse(b.date+'T09:30:00+08:00')&&Date.parse(b.knownAt)<=cut))continue;
   if(entry.corporateAction||exit.corporateAction||(input.simulation?.settlements||[]).some(e=>e.symbol===String(sample.stock.symbol||sample.stock.code)&&e.effectiveDate>=entry.date&&e.effectiveDate<=exit.date))continue;
   const {atLockedLimit}=require('../strategy/historical-session');if(atLockedLimit(entry,sample.stock.bars[sample.signalDay],sample.stock,'buy').blocked||atLockedLimit(exit,entry,sample.stock,'sell').blocked)continue;
   if(!selectionGate(String(sample.stock.symbol||sample.stock.code),entry.date,Date.parse(entry.date+'T09:30:00+08:00'),sectorRecords,weightRecords,policy).eligible)continue;
   const ret=exit.open/entry.open-1-costBps/10000;for(const id of sample.rules){state[id].lastLabelDate=dates[i];state[id].samples++;state[id].wins+=ret>0?1:0;state[id].sum+=ret;}
  }
  const market=marketAt(day),learned=Object.fromEntries(RULES.map(r=>[r.id,state[r.id].samples>=learningConfig.minimumSamples?(state[r.id].wins+learningConfig.priorStrength/2)/(state[r.id].samples+learningConfig.priorStrength):.5]));
  const rows=stocks.map(stock=>{
   const symbol=String(stock.symbol||stock.code),known=stock.bars.slice(0,i+1).every(b=>Date.parse(b.knownAt)<=cut),active=known?signals(stock.bars,i):[];
   const gate=selectionGate(symbol,day,cut,sectorRecords,weightRecords,policy);
   if(!known)gate.reasons.push('HISTORY_NOT_KNOWN_AT_DECISION');
   if(policy.requireMarket&&(!market.usable||market.regime==='risk_off'))gate.reasons.push(market.usable?'MARKET_RISK_OFF':'MISSING_FOUR_INDEX_CONTEXT');
   if(policy.requireForecast&&(market.upProbability==null||market.upProbability<policy.minUpProbability))gate.reasons.push(market.upProbability==null?'INSUFFICIENT_MARKET_FORECAST_SAMPLES':'MARKET_FORECAST_WEAK');
   const status=stock.bars[i];if(!instant(status.statusKnownAt)||Date.parse(status.statusKnownAt)>cut||typeof status.isST!=='boolean'||typeof status.suspended!=='boolean'||typeof status.tradable!=='boolean')gate.reasons.push('MISSING_TRADABILITY_EVIDENCE');else if(status.isST||status.suspended||!status.tradable)gate.reasons.push('ST_OR_UNTRADABLE');
   gate.eligible=gate.reasons.length===0;
   const eligible=gate.eligible&&stock.bars[i].volume>0&&stock.bars[i].suspended!==true&&stock.bars[i].tradable!==false;
   if(eligible&&active.length&&i+2<dates.length)pending.push({stock,signalDay:i,exitDay:i+2,rules:active});
   return {symbol,name:String(stock.name||symbol).slice(0,64),rules:active,score:active.length?mean(active.map(id=>learned[id])):null,eligible:eligible&&active.length>0,gate};
  }).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.symbol.localeCompare(b.symbol));
  const snapshot={date:day,market,weights:learned,labelSamples:Object.fromEntries(RULES.map(r=>[r.id,state[r.id].samples])),ranking:rows,version:hash({day,learned,state})};daily.push(snapshot);rankHistory.set(day,rows.filter(r=>r.eligible).map(r=>r.symbol));
 }
 let simulation=null;
 if(input.simulation){
  if(!dataset)throw Error('模拟账本需要股票历史');const calendar=require('./trading-calendar').createTradingCalendar(input.tradingCalendar);calendar.assertDates(dates);
  const cfg={...input.simulation};validateBacktestConfig(cfg,dataset.barsPerStock);
  if(cfg.holdDays!==undefined&&cfg.holdDays!==1)throw Error('当前学习标签仅支持持有一个交易日');
  simulation=ledgerBacktest({...cfg,stocks,source:input.source,holdDays:1,selectCandidates:(_stocks,day)=>rankHistory.get(dates[day])||[],entryEligibility:({symbol,tradeDate,decisionAt})=>{const gate=selectionGate(symbol,tradeDate,decisionAt,sectorRecords,weightRecords,policy),bar=stocks.find(s=>String(s.symbol||s.code)===symbol)?.bars.find(b=>b.date===tradeDate);if(!bar||!instant(bar.statusKnownAt)||Date.parse(bar.statusKnownAt)>decisionAt||bar.isST!==false||bar.suspended!==false||bar.tradable!==true)gate.reasons.push('MISSING_OR_BLOCKED_OPEN_STATUS');gate.eligible=gate.reasons.length===0;return gate;}});
 }
 const latest=daily.at(-1)||null;
 return {schemaVersion:1,mode:'adaptive-market-research',source:input.source,provider:input.provider,inputVersion:input.version,asOf:input.asOf,decisionAt:input.decisionAt,datasetFingerprint:hash(input),verifiedLive:false,canTrade:false,brokerConnected:false,selectionPolicy:policy,nativeAdaptation,indexModels,market:marketAt(input.asOf),catalog:RULES,latest,learning:{method:'matured-next-open-to-following-open-beta-v1',costBps,minimumSamples:learningConfig.minimumSamples,priorStrength:learningConfig.priorStrength,state,versions:daily.slice(-60).map(({date,version,weights,labelSamples})=>({date,version,weights,labelSamples})),provenance:'https://qlib.readthedocs.io/en/latest/component/online.html',autoUpdated:Object.values(state).some(s=>s.samples>0),ruleStatus:Object.fromEntries(RULES.map(r=>[r.id,{trained:state[r.id].samples>=learningConfig.minimumSamples,observations:state[r.id].samples,weight:latest?.weights[r.id]??null}])),liveRulesChanged:false},simulation,notes:['下一交易日方向为历史条件频率，不是保证；样本不足返回未知。','回避依赖时点行业及四指数完整权重记录，缺失不猜测。','权重学习用扣设定成本的标签代理；实际资金表现以独立模拟账本为准。','A50指数与期货显式区分；不以科创50或上证50替代。']};
}
module.exports={runAdaptiveResearch,signals,indexForecast,selectionGate,visibleBars,INDEX_IDS,RULES};
