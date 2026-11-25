'use strict';

// This projection only links an already recorded research check. It cannot
// create an observation, train/approve a model or change a paper-buy condition.
const installedCatalog=require('../../public/nova/shortline/catalog.json');
const numeric=require('../../public/nova/shortline/numeric-factors');
const {decisionPlanPayload}=require('./paper-decision-plan');
const SCHEMA='fayo-plan-factor-reference-v1';
const instant=value=>{const at=numeric.instant(value);return at!==null&&at<8e15?at:null;};
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10);
const dayOk=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&
  Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day;
const real=numeric.realEvidence;

function originalEdges(archive,cutoff){
  const pairs=new Map(),conflicts=new Set();
  const records=[...(archive.marketHistory||[]),...(archive.market||[]),
    ...(archive.checks||[]).map(check=>check?.market).filter(Boolean)];
  for(const row of records){
    if(!row||typeof row!=='object')continue;
    const known=instant(row.calendarKnownAt),recorded=instant(row.knownAt);
    if(!real(row)||!dayOk(row.date)||!dayOk(row.nextTradingDay)||row.nextTradingDay<=row.date||
      known===null||recorded===null||known>recorded||recorded>cutoff||
      typeof row.calendarSource!=='string'||!row.calendarSource.trim()||!real({source:row.calendarSource}))continue;
    const previous=pairs.get(row.date);
    if(previous&&previous.to!==row.nextTradingDay){conflicts.add(row.date);continue;}
    if(!previous||known<instant(previous.knownAt))pairs.set(row.date,{kind:'original-next-trading-day',
      from:row.date,to:row.nextTradingDay,source:row.calendarSource,knownAt:row.calendarKnownAt,recordKnownAt:row.knownAt});
  }
  for(const date of conflicts)pairs.delete(date);
  return {pairs,conflicts};
}

function inspectCheck(check,{card,catalog,dictionaryVersion,cutoff,edges,counts}){
  const missing=[];
  const fail=reason=>({check,missing:[reason]});
  if(!check||typeof check.id!=='string'||!check.id||counts.get(check.id)!==1)return fail('原校验记录缺少唯一身份');
  if(!real(check)||check.method!=='行情自动识别')return fail('原校验不是已归档的真实行情数值观察');
  if(check.code!==card.code||!dayOk(check.date)||check.date>card.day)return fail('原校验股票或交易日不一致');
  const createdAt=instant(check.createdAt),asOf=instant(check.asOf),panel=check.recognition?.ruleObservations;
  const observationAt=instant(panel?.cutoff);
  if(createdAt===null||asOf===null||createdAt>cutoff||asOf>createdAt||chinaDay(asOf)!==check.date||
    observationAt===null||observationAt>createdAt||chinaDay(observationAt)!==check.date||
    // The original check displays minute precision while its panel retains the
    // actual millisecond receipt. Never expand that minute to a later session.
    observationAt>asOf&&!(typeof check.asOf==='string'&&/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(check.asOf)&&observationAt<asOf+60000)||
    [check.knownAt,check.observedAt].filter(value=>value!=null).some(value=>instant(value)===null||instant(value)>createdAt))
    return fail('原校验或源观察晚于决策，不能补录为事前信号');
  if(typeof dictionaryVersion!=='string'||!dictionaryVersion||panel.dictionaryVersion!==dictionaryVersion)
    return fail('原校验数值定义与当前词典版本不一致');
  let calendarEvidence;
  if(check.date===card.day)calendarEvidence={kind:'same-session',from:check.date,to:card.day,
    source:'原校验与服务器决策的同日日期',knownAt:check.createdAt};
  else{
    const edge=edges.pairs.get(check.date);
    if(edges.conflicts.has(check.date))return fail('原档案相邻交易日声明冲突');
    if(!edge||edge.to!==card.day||instant(edge.knownAt)>observationAt)
      return fail('缺少事前可核验的原相邻交易日声明');
    calendarEvidence={...edge};
  }
  let vector;
  try{vector=numeric.readNumericCheck(check,catalog,cutoff);}catch{return fail('原校验数值观察结构无效');}
  if(vector.rejected.length)return fail('原校验数值、条件证据、定义或时点校验失败');
  if(!Array.isArray(panel.inputs)||panel.inputs.some(row=>!real(row)))return fail('原数值观察来源含教学或合成资料');
  const registered=new Set((check.factorCodes||[]).filter(id=>typeof id==='string'&&!id.startsWith('YZ-')));
  const factorIds=Object.keys(vector.values).filter(id=>{
    const definition=vector.definitions[id],evidence=vector.evidence[id];
    if(!definition||definition.factorCode!==id||!definition.semanticVersion||typeof definition.unit!=='string'||!definition.unit||!real(evidence))return false;
    return id.startsWith('YZ-')||registered.has(id);
  }).sort();
  if(!factorIds.length)return fail('原校验尚无条件完整且有来源的数值观察；未知值不填零');
  const values=Object.fromEntries(factorIds.map(id=>[id,vector.values[id]]));
  const definitions=Object.fromEntries(factorIds.map(id=>[id,vector.definitions[id]]));
  const evidence=Object.fromEntries(factorIds.map(id=>[id,vector.evidence[id]]));
  return {check,missing,observationAt,calendarEvidence,factorIds,values,definitions,evidence,
    checkFingerprint:numeric.fingerprint(check),factorDefinitionFingerprint:numeric.fingerprint(definitions),
    observationFingerprint:numeric.fingerprint({values,definitions,evidence})};
}

/**
 * The native preparation route uses this same projection as the locked store.
 * Passing checkId pins a previously selected identity (including null for an
 * absent selection); validation never substitutes a different later check.
 */
function prepareDecisionPlanResearch(card,archive={},options={}){
  const payload=decisionPlanPayload(card),now=instant(options.now??Date.now()),decisionAt=instant(card.calculatedAt);
  const base={schema:SCHEMA,status:'missing',code:card.code,targetDay:card.day,decisionId:card.decisionId,decisionAt:card.calculatedAt??null,
    archiveRevision:Number.isSafeInteger(archive.revision)?archive.revision:null,
    dictionaryVersion:archive.dictionaryVersion||null,checkId:null,factorIds:[],missing:[],canTrade:false};
  const absent=missing=>({payload,researchReference:{...base,missing:[...new Set(missing)]}});
  if(!real(archive))return absent(['演示、测试或合成档案不能成为正式计划的因子依据']);
  if(now===null||decisionAt===null||decisionAt>now||!dayOk(card.day)||chinaDay(decisionAt)!==card.day)
    return absent(['后端决策时点或交易日无效，未关联研究记录']);
  const checks=Array.isArray(archive.checks)?archive.checks:[],counts=new Map();
  for(const check of checks)counts.set(check?.id,(counts.get(check?.id)||0)+1);
  const pinned=Object.hasOwn(options,'checkId');
  if(pinned&&(typeof options.checkId!=='string'||!options.checkId))return absent(['准备时没有合规事前校验；未在提交时补绑其他记录']);
  const catalog=Array.isArray(archive.catalog)?archive.catalog:installedCatalog;
  const edges=originalEdges(archive,decisionAt),preferred=card.factorRanking?.sourceCheckId;
  const candidates=checks.filter(check=>pinned?check?.id===options.checkId:check?.code===card.code&&check?.date<=card.day);
  candidates.sort((a,b)=>Number(b.id===preferred)-Number(a.id===preferred)||String(b.date).localeCompare(String(a.date))||
    (instant(b.createdAt)||0)-(instant(a.createdAt)||0)||String(a.id).localeCompare(String(b.id)));
  const rejected=[];
  for(const check of candidates){
    const result=inspectCheck(check,{card,catalog,dictionaryVersion:archive.dictionaryVersion,cutoff:decisionAt,edges,counts});
    if(result.missing.length){rejected.push(...result.missing);continue;}
    return {payload:{...payload,checkId:check.id},researchReference:{...base,status:'linked',checkId:check.id,
      signalDay:check.date,checkCreatedAt:check.createdAt,checkAsOf:check.asOf,observationAt:result.observationAt,
      selectedBy:check.id===preferred?'approved-ranking-reference':result.calendarEvidence.kind,
      factorIds:result.factorIds,factorDefinitionFingerprint:result.factorDefinitionFingerprint,
      observationFingerprint:result.observationFingerprint,checkFingerprint:result.checkFingerprint,
      calendarEvidence:result.calendarEvidence,calendarEvidenceFingerprint:numeric.fingerprint(result.calendarEvidence),
      // These are frozen observations, not weights or a newly approved baseline.
      numericFactors:{values:result.values,definitions:result.definitions},
      missing:[]}};
  }
  return absent(rejected.length?rejected:['没有同股、事前已记录且含完整数值观察的当日或原相邻前日校验']);
}

module.exports={SCHEMA,prepareDecisionPlanResearch};
