'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const AUTHORITY='fayo-decision-center',SCHEMA=1;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validTime=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const list=value=>Array.isArray(value)?value:[];
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10);
const quoteKeys=['price','pct','volume','amount','amountUnit','quoteUnits','turnover','mktcap','floatCap','high','low','open','preClose','quoteAt','vendorQuoteAt','receivedAt','quoteSource','quoteMode','mode','canTrade','canNotify','quoteFreshness','quoteStatus','tradeDate'];
const model=()=>import('./decision-model.mjs');

function centerConfig(given){
 if(given&&typeof given==='object')return given;
 try{return JSON.parse(fs.readFileSync(path.join(__dirname,'../../config/intelligence-center.json'),'utf8'));}
 catch{return {schemaVersion:1,enabled:false,ruleVersion:'fayo-center-unavailable',configurationError:'独立决策配置无法读取，等待核验。',weather:{positionCaps:{green:0,yellow:0,red:0,unknown:0}}};}
}

// Strategy provenance and current quote provenance are separate records. A new
// quote replaces the whole quote group, never just the timestamp of an old price.
function currentCandidates(state,now,normalizeDay,pickDay){
 const input=state.decisionQuotes;
 const quotes=input instanceof Map?[...input.values()]:Array.isArray(input)?input:input&&typeof input==='object'?Object.values(input):[];
 const byCode=new Map(quotes.filter(q=>q&&/^\d{6}$/.test(q.code)).map(q=>[q.code,q]));
 return list(state.pool).filter(Boolean).map(original=>{
  const row={...original},strategyDay=pickDay(original,normalizeDay(state.poolDay||state.snapshotFieldDays?.candidatePool),now);
  const evaluations=list(original.conditionInputs).map(e=>e?.evaluatedAt).filter(at=>validTime(at)&&at<=now&&chinaDay(at)===strategyDay);
  const strategyAt=evaluations.length?Math.max(...evaluations):validTime(original.quoteAt)?original.quoteAt:null;
  row.strategyBasis={day:strategyDay,quoteAt:original.quoteAt??null,calculatedAt:evaluations.length?strategyAt:null,score:original.score??null,
   source:'V6 原策略候选',timestampKind:evaluations.length?'strategy-evaluation':'strategy-quote-anchor'};
  row.strategyAt=strategyAt;
  const quote=byCode.get(original.code);
  const explicitlyBlocked=original.canTrade===false||original.canNotify===false||original.tradable===false||original.suspended===true||
   ['readOnlyBackup','imported','historicalClose','simulated','fixture','mock','synthetic'].some(key=>original[key]===true)||
   /simulat|research|readonlybackup|cost|carried|histor|import|fixture|mock|test|synthetic/i.test(String(original.quoteSource||'')+' '+String(original.quoteMode||original.mode||''));
  if(quote&&!explicitlyBlocked&&strategyDay===chinaDay(now)&&validTime(strategyAt)&&strategyAt<=now){
   for(const key of quoteKeys)delete row[key];
   for(const key of quoteKeys)if(Object.hasOwn(quote,key))row[key]=quote[key];
   for(const key of ['simulated','readOnlyBackup','imported','fixture','mock','synthetic','tradable','suspended'])if(Object.hasOwn(quote,key))row[key]=quote[key];
   if(typeof quote.name==='string'&&quote.name.trim())row.name=quote.name;
   if(!finite(row.pct)&&finite(quote.preClose)&&quote.preClose>0&&finite(quote.price))row.pct=(quote.price/quote.preClose-1)*100;
   row.poolDay=strategyDay;
   if(quote.canTrade!==true)row.blocked=true;
   row.quoteBasis={code:quote.code,price:quote.price,quoteAt:quote.quoteAt,receivedAt:quote.receivedAt,source:quote.quoteSource,
    mode:quote.quoteMode||quote.mode,kind:'independent-current-original-row'};
  }else row.quoteBasis={code:row.code,price:row.price,quoteAt:row.quoteAt,receivedAt:row.receivedAt,source:row.quoteSource,
   mode:row.quoteMode||row.mode,kind:'strategy-original-row'};
  const freshLevels=state.decisionLevels?.[original.code];
  if(freshLevels){
   const basis=freshLevels.evidence||freshLevels;
   if((basis.code===undefined||basis.code===row.code)&&typeof basis.source==='string'&&basis.source.trim()&&
    validTime(basis.sourceAt)&&basis.sourceAt<=now&&validTime(basis.asOf)&&basis.sourceAt<=basis.asOf&&basis.asOf<=now&&
    normalizeDay(basis.throughDay)&&normalizeDay(basis.throughDay)<=chinaDay(now)&&normalizeDay(basis.throughDay)<=chinaDay(basis.sourceAt)&&
    basis.quoteAt===row.quoteAt&&(basis.price===undefined||basis.price===row.price)){
    row.levels=freshLevels.levels;row.levelsEvidence={source:basis.source,sourceAt:basis.sourceAt,
     asOf:basis.asOf,throughDay:normalizeDay(basis.throughDay),quoteAt:basis.quoteAt,adjustment:basis.adjustment||null};
   }else{row.levels=null;row.levelsEvidence=null;}
  }else{row.levels=null;row.levelsEvidence=null;}
  if(!row.levelsEvidence)row.decisionBlockReasons=[...list(row.decisionBlockReasons),'买卖计划缺少与原报价对应的 K 线来源或时点'];
  return row;
 });
}

function accountEvidence(state,now){
 const evidence=state.decisionAccountEvidence,account=state.paper?.pool;
 return account&&evidence&&evidence.kind==='server-account-snapshot'&&typeof evidence.source==='string'&&evidence.source.trim()&&
  validTime(evidence.sourceAt)&&evidence.sourceAt<=now&&now-evidence.sourceAt<=15000&&
  chinaDay(evidence.sourceAt)===chinaDay(now)?{...evidence,account:'pool',inputs:{cash:account.cash,equity:account.equity,
   allocationPct:account.executionPolicy?.allocationPct??null,maxPositions:account.executionPolicy?.maxPositions??account.maxPos??null}}:null;
}

function candidateQuality(state,pool,now,config){
 const byCode={},day=chinaDay(now),checks=state.crossChecksByCode;
 for(const row of pool){
  let gate;
  try{
   const report=checks instanceof Map?checks.get(row.code):checks?.[row.code];
   gate=require('./intelligence-research').decisionCrosscheckGate(report,{code:row.code,day,now,source:row.quoteBasis?.source,
    ...(config.quality&&config.consistency?{config}:{})});
  }catch{
   gate={status:'unknown',blocked:false,canAdmit:false,reason:'quality-gate-configuration-unavailable',checkedAt:null,
    sourceEvidence:[],canTrade:false,changesOriginalGates:false};
   row.decisionBlockReasons=[...list(row.decisionBlockReasons),'中心质量门禁配置未完成核验'];
  }
  let quality;
  try{quality=require('./decision-quality').decisionQuality(row,gate,{day,now,history:state.decisionQualityHistory?.[row.code],config});}
  catch{quality={...gate,qScore:null,qReason:'五维质量规则配置未完成核验，保留全部原交易门禁。'};}
  row.centerQuality=quality;byCode[row.code]=quality;
  if(gate.blocked)row.decisionBlockReasons=[...list(row.decisionBlockReasons),'同日原始多源报价存在冲突，已从中心候选剔除'];
 }
 return byCode;
}

const confidenceLevel=value=>!finite(value)||value<50?'低':value<75?'中':'高';
function councilView(id,label,score,evidence,missing=[]){
 const known=finite(score)&&score>=0&&score<=100;
 const vote=!known||missing.length?'待核验':score>=65?'支持':score<40?'回避':'观望';
 const available=evidence.filter(e=>e.known).length,total=evidence.length,confidence=total?Math.round(available/total*100):null;
 return {id,label,score:known?score:null,vote,confidence,confidenceLevel:confidenceLevel(confidence),
  confidenceKind:'证据覆盖度，非胜率',evidence,missing,engine:'existing-evidence-rules',calibrationCertified:false};
}

function buildCouncil(row,weather,now){
 const day=chinaDay(now),strategyDay=row.strategyBasis?.day,dated=strategyDay===day&&validTime(row.strategyAt)&&row.strategyAt<=now;
 const fact=row.fundamentalEvidence,validFact=fact&&fact.code===row.code&&fact.day===day&&typeof fact.source==='string'&&fact.source&&validTime(fact.knownAt)&&fact.knownAt<=now&&finite(fact.score)&&fact.score>=0&&fact.score<=100&&!fact.missing?.length;
 const fundamentals=councilView('fundamental','基本面',validFact?fact.score:null,[
  {label:'已封存财报规则',known:Boolean(validFact),source:fact?.source||null,sourceAt:fact?.knownAt||null,
   sourceTimes:fact?.sourceTimes||[],text:fact?.reason||'缺少已封存财报、报告期与原始回执',formula:fact?.formula||null,inputs:fact?.inputs||[]}
 ],validFact?[]:fact?.missing?.length?fact.missing:['基本面评分与来源']);
 const trend=dated&&finite(row.baziDims?.trend)&&row.baziDims.trend>=0&&row.baziDims.trend<=100?row.baziDims.trend:null;
 const trendReasons=Array.isArray(row.baziWhy?.trend)?row.baziWhy.trend:[row.baziWhy?.trend];
 const why=trendReasons.filter(value=>typeof value==='string'&&value.trim()).join('；');
 const technical=councilView('technical','技术面',trend,[
  {label:'原八字趋势分',known:trend!==null,source:'V6 八字趋势维度',sourceAt:row.strategyAt,text:trend!==null?'原策略趋势分 '+trend:'未返回可归因的技术维度分'},
  {label:'原技术依据',known:Boolean(dated&&why),source:'V6 原策略',sourceAt:row.strategyAt,text:why||'技术依据未提供'}
 ],trend!==null&&why?[]:['技术评分或原判断依据']);
 const fund=row.bazi?.fundsEvidence,originalFund=dated&&finite(row.baziDims?.fund)?row.baziDims.fund:null;
 const fundTime=fund?.sourceTimestamp,usableFund=dated&&fund?.observed===true&&finite(fund.net)&&typeof fund.source==='string'&&fund.source&&
  validTime(fundTime)&&fundTime<=now&&chinaDay(fundTime)===day;
 const funding=councilView('funding','资金面',usableFund?originalFund:null,[
  {label:'原资金评分',known:originalFund!==null,source:'V6 八字资金维度',sourceAt:row.strategyAt,text:originalFund!==null?'已有资金维度分 '+originalFund:'原资金评分未提供'},
  {label:'实际资金数据',known:fund?.observed===true&&finite(fund?.net)&&Boolean(fund.source),source:fund?.source||null,sourceAt:fundTime??null,text:fund?.observed===true&&finite(fund?.net)?'原记录净额 '+fund.net+'；口径 '+(fund.method||'未注明'):'没有可核实资金净额'},
  {label:'资金原始时点',known:Boolean(usableFund),source:fund?.source||null,sourceAt:fundTime??null,text:usableFund?'资金源端时点与当日对应':'资金原始时点未核验，不能借价格时间补齐'}
 ],usableFund&&originalFund!==null?[]:['资金评分、日期或原始时点']);
 const m=weather.metrics,complete=!weather.missing.length;
 const hits=complete?Number(m.breadth>=55)+Number(m.upLimit>0&&(m.downLimit===0||m.upLimit/m.downLimit>=1.5))+Number(m.sealRate>=70):null;
 const sourceTimes=weather.basis.map(x=>({source:x.source,sourceAt:x.knownAt??x.quoteAt??null,scope:x.scope}));
 const emotion=councilView('sentiment','情绪面',hits===null?null:Math.round(hits/3*100),[
  {label:'宽度、涨跌停与封板率',known:complete,source:weather.basis.map(x=>x.source).join(' / '),
   sourceAt:complete?Math.max(...sourceTimes.map(x=>x.sourceAt)):null,sourceTimes,
   text:complete?'三项公开规则命中 '+hits+'/3；规则评分不代表预测胜率':weather.summary}
 ],weather.missing);
 if(weather.status==='red')emotion.vote='回避';
 const views=[fundamentals,technical,funding,emotion],support=views.filter(v=>v.vote==='支持').length,veto=views.filter(v=>v.vote==='回避').length;
 const assessed=views.filter(v=>v.score!==null&&!v.missing.length).length;
 const confidence=Math.round(assessed/views.length*100);
 return {mode:'规则型四视角会商',llmInvoked:false,views,support,veto,assessed,missingViews:views.filter(v=>v.missing.length).map(v=>v.label),
  confidence,confidenceLevel:confidenceLevel(confidence),confidenceKind:'已具备完整证据的视角比例，非胜率',
  conclusion:veto?'存在回避意见，逐项核对':assessed<views.length?'证据未齐，保留分歧与缺项':support>=3?'多视角支持':'等待更多一致证据',
  affectsExistingTradingRules:false};
}

function planLineage(card,account,ruleVersion){
 const q=card.quoteBasis,level=card.levelsEvidence,strategy=card.strategyBasis||{};
 const levelSource=level.source,levelAt=level.sourceAt;
 return {
  buyLow:{derivedBy:'现有 MA5',source:levelSource,sourceAt:levelAt,throughDay:level.throughDay||strategy.day},
  buyHigh:{derivedBy:'同一完整原始报价行 price',source:q.source,sourceAt:q.quoteAt,receivedAt:q.receivedAt},
  stop:{derivedBy:'现有 computeLevels.stop',source:levelSource,sourceAt:levelAt,throughDay:level.throughDay||strategy.day},
  target:{derivedBy:'现有 computeLevels.t1',source:levelSource,sourceAt:levelAt,throughDay:level.throughDay||strategy.day},
  positionPct:{derivedBy:'原账户分仓预算与可用资金比例的较小值，并核对天气上限',source:account.source,sourceAt:account.sourceAt,kind:account.kind,inputs:account.inputs},
  strategy:{...strategy,strategyAt:card.strategyAt},quote:{...q},quality:card.centerQuality,ruleVersion
 };
}

async function buildDecisionCenter(state={}, {now=Date.now(),config}={}){
 const engine=await model(),policy=centerConfig(config||state.decisionPolicy),ruleVersion=policy.ruleVersion||'fayo-center-v1';
 const account=accountEvidence(state,now);
 const {enrichDecisionEvidence}=require('./decision-evidence');
 const pool=currentCandidates(state,now,engine.decisionDay,engine.systemPickDay).map(row=>enrichDecisionEvidence(row,{
  financials:state.decisionFinancials?.byCode?.[row.code],financialMissing:state.decisionFinancials?.missingByCode?.[row.code],
  day:chinaDay(now),now,account:state.paper?.pool,accountEvidence:account})),prepared={...state,pool};
 if(!account)for(const row of pool)row.decisionBlockReasons=[...list(row.decisionBlockReasons),'仓位计划缺少原模拟账户快照时点'];
 const qualityByCode=candidateQuality(state,pool,now,policy);
 const board=engine.buildDecisionBoard(prepared,{now});
 const defaults={green:20,yellow:10,red:0,unknown:0},caps=policy.weather?.positionCaps||defaults;
 const candidateCap=caps[board.weather.status],cap=finite(candidateCap)&&candidateCap>=0&&candidateCap<=100?candidateCap:defaults[board.weather.status];
 board.weather.positionCapPct=cap;board.weather.capBasis='决策中心独立规则上限；不修改原模拟盘分仓';
 const blocked=board.cards.filter(card=>card.plan.positionPct>cap+1e-9);
 if(blocked.length){
  board.cards=board.cards.filter(card=>card.plan.positionPct<=cap+1e-9);
  board.blockedCounts['原模拟盘单票预算超过天气仓位上限']=blocked.length;
  board.reasons.push('当前天气单票仓位上限 '+cap+'%，原模拟盘等权预算更高；保留原分仓规则，本次不生成可执行卡。');
 }
 if(policy.enabled===false){board.cards=[];board.reasons.unshift(policy.configurationError||'决策中心已通过独立配置关闭。');}
 if(!board.cards.length)for(const item of board.checklist)if(['plan','paper'].includes(item.id)){
  item.status='waiting';item.note=board.reasons.at(-1)||'今天空仓，等待信号';
 }
 const resonance=engine.decisionResonance(prepared,{day:board.day,now,ranked:pool});
 const resonanceByCode=Object.fromEntries([...resonance].map(([symbol,strategies])=>[symbol,{day:board.day,count:strategies.length,
  strategies:strategies.map(s=>({...s,day:board.day}))}]));
 const conclusions={};
 for(const row of pool){
  if(!/^\d{6}$/.test(row.code||''))continue;
  conclusions[row.code]={...engine.stockConclusion(row,{day:board.day,now}),authority:AUTHORITY,schemaVersion:SCHEMA,code:row.code,asOf:now,quoteAt:row.quoteAt??null};
 }
 board.cards=board.cards.map(card=>{
  const council=buildCouncil(card,board.weather,now),lineage=planLineage(card,account,ruleVersion);
  const canonical={ruleVersion,day:card.day,code:card.code,strategyAt:card.strategyAt,source:card.quoteBasis.source,mode:card.quoteBasis.mode,
   plan:[card.plan.buyLow,card.plan.buyHigh,card.plan.stop,card.plan.target,card.plan.positionPct],positionCapPct:cap};
  if(card.factorRanking?.rankingApplied)canonical.approvedFactorRanking={modelFingerprint:card.factorRanking.modelFingerprint,
    sourceCheckId:card.factorRanking.sourceCheckId,signalDay:card.factorRanking.signalDay,targetDay:card.factorRanking.targetDay};
  const decisionId=crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  const plan={...card.plan,authority:AUTHORITY,decisionId,asOf:now,derivedBy:ruleVersion,
   source:'现有策略、原始行情与原模拟账户',sourceAt:card.quoteAt,lineage};
  return {...card,authority:AUTHORITY,decisionId,calculatedAt:now,plan,authoritativePlan:plan,lineage,council,conclusion:conclusions[card.code]};
 });
 const evidenceByCode=Object.fromEntries(pool.map(row=>[row.code,{code:row.code,day:board.day,fundamental:row.fundamentalEvidence,factorScores:row.factorScores}]));
 return {...board,authority:AUTHORITY,schemaVersion:SCHEMA,calculatedAt:now,ruleVersion,resonanceByCode,conclusions,qualityByCode,evidenceByCode,
  approvedFactorRanking:state.decisionApprovedRanking?{...state.decisionApprovedRanking,rows:undefined}:null,
  authorityNote:'价格、仓位、天气与会商由服务端生成；模拟成交仍通过原 paperBuy，前端只展示与校验。'};
}

module.exports={buildDecisionCenter,AUTHORITY,SCHEMA};
