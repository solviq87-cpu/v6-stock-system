 'use strict';
const {validateFeed}=require('./feed-quality');
const {evaluateCandidate}=require('./strategy-service');
const {classifyLimitLadder}=require('./limit-ladder-engine');
const {detectPatterns,attachRps,buildPatternPools}=require('./a-share-patterns');
const {linkIssuerEvents,buildIssuerLinkage,buildIssuerPools}=require('./issuer-event-linkage');
const {optionalResearchView}=require('../core/optional-research-view');
const {evaluateLinkage,buildLinkagePools}=require('./market-sector-pattern-linkage');
const {updateLifecycle}=require('./signal-pool-lifecycle');
function scanUniverse({stocks=[],market={},now=Date.now(),maxAgeMs=900000,requireReal=false,previousStates=[]}={}){
 if(!Array.isArray(stocks))throw TypeError('stocks必须为数组');
 const seen=new Set(),items=[];
 // One bounded read of the optional CNINFO source, never a trusted sentiment feed.
 // Missing optional data must never break legacy scanning or test-only deployments.
 let optional={status:'unconfigured',announcements:[]};
 if(process.env.V6_OPTIONAL_RESEARCH_FILE){
  try{optional=optionalResearchView(process.env.V6_OPTIONAL_RESEARCH_FILE,now);}
  catch{optional={status:'source-unavailable',announcements:[]};}
 }
 const issuerDocs=optional.status==='research-only'?optional.announcements:[];
 for(const stock of stocks){
  const symbol=String(stock.symbol||stock.code||'').trim();
  const quality=validateFeed(stock,{now,maxAgeMs,requireReal});
  if(!symbol){quality.errors.push('股票代码缺失');quality.usable=false;}
  if(seen.has(symbol)){quality.errors.push('重复股票代码');quality.usable=false;}
  seen.add(symbol);
  const evaluated=quality.usable?evaluateCandidate({stock,market}):null;
  const ladder=quality.usable?classifyLimitLadder(stock):null;
  const tradable=!!(evaluated&&evaluated.pass&&!stock.isST&&!stock.suspended&&stock.tradable!==false&&quality.fresh);
  const patterns=quality.usable?detectPatterns(stock):null;
  const blockedBySafety=Boolean(stock.isST||stock.suspended||stock.tradable===false||
    evaluated?.riskFilter?.pass===false);
  const issuerEvidence=linkIssuerEvents({symbol,now,announcements:[
    ...(Array.isArray(stock.announcements)?stock.announcements:[]),
    ...issuerDocs]});
  const issuerLinkage=buildIssuerLinkage({patterns,issuerEvidence});
  // Never use guessed market/sector values as evidence.
  const linkageResearch=evaluateLinkage({symbol,patterns,issuerEvidence,quality,bars:stock.bars,
    linkage:market?.linkage,asOf:now});
  items.push({patterns,patternDate:Array.isArray(stock.bars)?stock.bars.at(-1)?.date:null,blockedBySafety,issuerEvidence,issuerLinkage,linkageResearch,symbol,name:stock.name||'',quality,tradable,score:evaluated?evaluated.finalScore:null,
   strategy:evaluated?{pass:evaluated.pass,regime:evaluated.regime,legacyScore:evaluated.legacyScore,topDrivers:evaluated.topDrivers,
    extendedFactors:evaluated.extendedFactors,playbookAnalysis:evaluated.playbookAnalysis,riskFilter:evaluated.riskFilter}:null,
   ladder:ladder?{stage:ladder.stage,next:ladder.next,streak:ladder.streak,score:ladder.score,warnings:ladder.warnings}:null});
 }
 attachRps(stocks,items);
 const patternPools=buildPatternPools(items);
 const issuerPools=buildIssuerPools(items);
 const linkagePools=buildLinkagePools(items);
 const lifecycle=updateLifecycle({items,previous:previousStates,now});
 const lifecycleBySymbol=new Map(lifecycle.states.map(x=>[x.symbol,x]));
 for(const item of items)item.lifecycle=lifecycleBySymbol.get(item.symbol)||null;
 items.sort((a,b)=>Number(b.tradable)-Number(a.tradable)||Number(b.quality.usable)-Number(a.quality.usable)||(b.score??-1)-(a.score??-1)||a.symbol.localeCompare(b.symbol));
 return {asOf:now,total:items.length,eligible:items.filter(x=>x.tradable).length,rejected:items.filter(x=>!x.quality.usable).length,
  simulated:items.filter(x=>x.quality.simulated).length,
  patternPoolCount:Object.values(patternPools).reduce((a,p)=>a+p.length,0),patternPools,
  issuerPools,linkagePools,lifecycle,issuerEvidenceSource:optional.status,items,disclaimer:'候选研究排行，不提供自动下单；模拟/导入/过期行情须显著标注'};
}
module.exports={scanUniverse};
