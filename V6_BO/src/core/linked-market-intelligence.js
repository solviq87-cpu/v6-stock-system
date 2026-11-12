'use strict';
// A connector for existing research evidence, never a second execution engine.
const {analyzeStockHistory,appendSnapshot}=require('./stock-intelligence-memory');
const {analyzeSectorRelations}=require('../strategy/sector-relations');
const {evaluateLinkage}=require('../strategy/market-sector-pattern-linkage');
const {studyPatternOutcomes}=require('../strategy/pattern-outcome-study');
const crypto=require('node:crypto');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const stamp=x=>Number.isSafeInteger(x)?x:typeof x==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;
const flags={canTrade:false,canNotify:false,verifiedLive:false,productionWeightsChanged:false,autoPromotion:false};

function publicContextView(context,asOf){
 const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 const retrievedAt=stamp(context?.retrievedAt),usable=Number.isFinite(retrievedAt)&&retrievedAt>0&&retrievedAt<=asOf&&context.source==='eastmoney'&&day(context.tradeDate);
 const out={status:usable?'observed-unverified':'unknown',tradeDate:usable?context.tradeDate:null,
  retrievedAt:usable?context.retrievedAt:null,source:usable?context.source:null,sourceTimestamp:null,
  funds:{market:null,sector:null,stock:null},sentiment:{status:'unknown',reason:'缺少同日完整涨停和炸板未封池'},
  limitation:'接收时间不是原始行情时间；资金为供应商按订单大小估算，不能识别真实账户身份'};
 if(!usable)return out;
 for(const [key,input] of [['market','marketFlow'],['sector','sectorFlow'],['stock','stockFlow']]){
  const flow=context[input];
  if(!flow||typeof flow!=='object')continue;
  const received=flow.retrievedAt===undefined?retrievedAt:stamp(flow.retrievedAt);
  const sourceAt=flow.sourceTimestamp==null?null:stamp(flow.sourceTimestamp);
  if(!Number.isFinite(received)||received<=0||received>asOf||sourceAt!==null&&(!Number.isFinite(sourceAt)||sourceAt<=0||sourceAt>received))continue;
  const rows=flow.records;
  if(flow.source!=='eastmoney'||flow.fundsMethod!=='vendor-order-size-estimate'||!Array.isArray(rows)||rows.length>120)continue;
  if(rows.some(r=>!day(r.tradeDate)||r.tradeDate>context.tradeDate||r.observedAt!==undefined&&(!Number.isFinite(stamp(r.observedAt))||stamp(r.observedAt)>asOf))||new Set(rows.map(r=>r.tradeDate)).size!==rows.length)continue;
  out.funds[key]={source:'eastmoney',fundsMethod:flow.fundsMethod,symbol:/^\d{6}$/.test(flow.symbol||'')?flow.symbol:null,
   rawHash:/^[a-f0-9]{64}$/.test(flow.rawHash||'')?flow.rawHash:null,
   retrievedAt:received,sourceTimestamp:sourceAt,status:'observed-unverified',unit:'CNY',...flags,
   records:rows.map(r=>({tradeDate:r.tradeDate,...Object.fromEntries(['mainNetInflow','smallNetInflow','midNetInflow','bigNetInflow','superNetInflow'].map(k=>[k,finite(r[k])?r[k]:null]))}))};
 }
 const pools=context.limitPools;
 // Recompute descriptive ratios from complete, disjoint records; distrust scores.
 const projectPool=p=>{
  if(!p||!day(p.tradeDate)||p.tradeDate!==context.tradeDate||!Array.isArray(p.records)||p.records.length>10000)return null;
  const symbols=p.records.map(r=>r.symbol);
  const valid=symbols.every(s=>typeof s==='string'&&/^\d{6}$/.test(s))&&new Set(symbols).size===symbols.length;
  return {tradeDate:p.tradeDate,fetchedCount:symbols.length,totalCount:Number.isSafeInteger(p.totalCount)&&p.totalCount>=0?p.totalCount:null,
   complete:valid&&p.complete===true&&p.partial===false&&p.totalCount===symbols.length,symbols,sourceTimestamp:null,...flags};
 };
 const sealed=projectPool(pools?.sealed),broken=projectPool(pools?.broken);
 if(sealed&&broken){
  const overlap=sealed.symbols.some(s=>broken.symbols.includes(s)),total=sealed.fetchedCount+broken.fetchedCount;
  const complete=sealed.complete&&broken.complete&&!overlap;
  out.sentiment={status:complete?'descriptive-unverified':'unknown',tradeDate:context.tradeDate,sealed,broken,complete,
   sealRate:complete&&total>0?sealed.fetchedCount/total:null,breakRate:complete&&total>0?broken.fetchedCount/total:null,
   reason:complete?'当前封板与炸板未封的截面占比；不是所有曾炸板事件比例，也不是赚钱概率':'池不完整或重复，拒绝计算比例',...flags};
 }
 return out;
}

function compactContext(marketContext){
 const funds=Object.fromEntries(Object.entries(marketContext.funds).map(([key,value])=>[key,value?{...value,records:value.records.slice(-5)}:null]));
 const sentiment={...marketContext.sentiment};
 for(const key of ['sealed','broken'])if(sentiment[key]){
  const {symbols,...counts}=sentiment[key];sentiment[key]=counts;
 }
 return {...marketContext,funds,sentiment};
}

function buildLinkedIntelligence(input,{memoryRoot}={}){
 if(!input||input.schemaVersion!==1||!Number.isSafeInteger(input.asOf)||input.asOf<=0||input.asOf>Date.now())throw Error('需要不晚于当前的明确研究时点');
 if(!Array.isArray(input.stocks)||input.stocks.length<1||input.stocks.length>20)throw Error('需要1至20只股票');
 const symbols=input.stocks.map(s=>String(s?.symbol||s?.code||''));
 if(symbols.some(s=>!/^\d{6}$/.test(s))||new Set(symbols).size!==symbols.length)throw Error('股票代码必须为唯一六位代码');
 if(input.persist!==undefined&&typeof input.persist!=='boolean')throw Error('persist必须为布尔值');
 if(input.persist&&!memoryRoot)throw Error('研究记忆尚未配置');
 const {asOf,tradeDates}=input;
 const marketContext=publicContextView(input.publicContext,asOf);
 const sectorRelations=analyzeSectorRelations({asOf,tradeDates,history:input.sectorHistory||[],current:input.sectorCurrent||null});
 const stocks=input.stocks.map((stock,i)=>{
  const forecast=analyzeStockHistory(stock,{asOf,tradeDates});
  const linkage=evaluateLinkage({symbol:symbols[i],patterns:forecast.patterns,
   quality:{usable:forecast.coverage.latestFormationUsable&&forecast.patterns.usable},
   bars:stock.bars.filter(b=>b.date<=forecast.lastBarDate),linkage:input.linkage,asOf});
  const condition=(id,label,status,detail)=>({id,label,status,detail});
  const conditions=[
   condition('closed-causal-history','完整且时点有效的历史',forecast.coverage.latestFormationUsable?'met':'unknown',forecast.coverage.missing.join('；')||'逐日来源、可得时点和交易状态校验'),
   condition('technical-pattern','已确认的看涨形态',forecast.patterns.usable?(forecast.patterns.positiveCount?'met':'not_met'):'unknown',forecast.patterns.matched?.filter(p=>p.side==='bullish').map(p=>p.label).join('、')||forecast.patterns.reason||'未出现已定义形态'),
   condition('market-breadth','同日市场上涨家数占比≥60%',linkage.marketStatus==='observed-unverified'?(linkage.marketBreadth>=60?'met':'not_met'):'unknown','需同日20分钟内、覆盖率≥80%的独立宽度证据'),
   condition('sector-relative-strength','同日所属板块相对强度≥70',linkage.sectorStatus==='observed-unverified'?(linkage.sectorStrength>=70?'met':'not_met'):'unknown','需同日20分钟内的原始板块观测；不回填过去'),
  ];
  // Do not use a different stock's flow or a request date as current evidence.
  const flow=marketContext.funds.stock;
  const flowSymbol=String(flow?.symbol||flow?.code||'');
  const records=Array.isArray(flow?.records)?flow.records:[];
  const date=forecast.lastBarDate,record=records.find(r=>r.tradeDate===date);
  const flowKnown=flowSymbol===symbols[i]&&flow?.source==='eastmoney'&&flow?.fundsMethod==='vendor-order-size-estimate'&&finite(record?.mainNetInflow);
  conditions.push(condition('observed-stock-flow','同日订单规模估算主力净额为正',flowKnown?(record.mainNetInflow>0?'met':'not_met'):'unknown','东财订单大小分类口径；不等于机构真实资金进出'));
  const patternStudy=studyPatternOutcomes(stock,{asOf,tradeDates});
  return {symbol:symbols[i],name:String(stock.name||'').slice(0,64),forecast,patternStudy,linkage,conditions,
   contextConflict:linkage.riskConflict,memory:{status:'not-requested'},...flags};
 });
 // Validate every stock before publishing any archive. A storage failure is explicit.
 if(input.persist)for(let i=0;i<stocks.length;i++){
  const row=stocks[i];
  try{row.memory={status:'saved',...appendSnapshot(memoryRoot,{stock:input.stocks[i],forecast:row.forecast,decisionAt:asOf,
   context:{marketContext:compactContext(marketContext),linkage:row.linkage,conditions:row.conditions,sectorEvidence:sectorRelations.dailyEvidence.slice(-5),
    suppliedContextHash:crypto.createHash('sha256').update(JSON.stringify({publicContext:input.publicContext,sectorHistory:input.sectorHistory,sectorCurrent:input.sectorCurrent})).digest('hex'),
    patternStudy:{status:row.patternStudy.status,currentlyMatched:row.patternStudy.patterns.filter(p=>p.currentlyMatched).slice(0,8)}}})};}
  catch{row.memory={status:'failed',reason:'历史封存未完成；已有不可变记录不会覆盖'};}
 }
 return {schemaVersion:1,mode:'linked-market-intelligence',asOf,marketContext,sectorRelations,stocks,...flags,
  limitations:['板块同日相关与去市场相关是描述性统计，不能证明因果、领先或真实资金转移',
   '当前大盘、情绪、板块及资金仅解释本次观察，未作为过去样本的训练特征',
   '方向概率是明确状态下的历史条件频率；样本外误差和后续冻结预测需分别检验',
   '不把形态或条件数量转换为胜率；不修改原策略排名、权重、模拟账户或订单']};
}
module.exports={buildLinkedIntelligence,publicContextView};
