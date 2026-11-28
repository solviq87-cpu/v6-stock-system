'use strict';
// Deterministic research-only watch pool lifecycle. No trading, external messaging or score changes.
const VALID=new Set(['observe','focus','risk-review','weakening','archived']);
const RX=/^\d{6}$/,DATE=/^\d{4}-\d{2}-\d{2}$/;
const dateOk=d=>typeof d==='string'&&DATE.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
const safeArr=a=>Array.isArray(a)?a:[];
const safeId=value=>typeof value==='string'?value.slice(0,70):'';
const dayDiff=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
const validClock=t=>Number.isSafeInteger(t)&&t>0&&t<=8e15;
const validCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
const marketDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const eligiblePrior=r=>r&&['observe','focus'].includes(r.stage)&&r.dataStatus==='observed-research-only'&&
 r.misses===0&&r.streak>=1&&ruleSet(r.matched).length>0&&safeArr(r.riskIds).length===0;
const ruleSet=ids=>[...new Set(safeArr(ids).filter(id=>typeof id==='string'&&id.length>0&&id.length<=70))].sort().slice(0,100);
const validRules=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=100&&ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=70)&&new Set(ids).size===ids.length;
// This measures latency on the caller's research clock, not market discovery
// latency in a live feed. An old state without this evidence cannot backfill it.
function readDiscovery(prior){
 const d=prior?.discovery;
 if(!eligiblePrior(prior)||!d||d.mode!=='research-clock-only'||!dateOk(d.firstSeenDate)||d.firstSeenDate>prior.lastSeen||
    !validClock(d.firstObservedAt)||!validClock(d.lastObservedAt)||d.lastObservedAt<d.firstObservedAt||
    d.firstSeenDate>marketDay(d.firstObservedAt)||prior.lastSeen>marketDay(d.lastObservedAt)||
    !validRules(d.firstMatched)||!validRules(d.continuousMatched)||
    d.continuousMatched.some(id=>!d.firstMatched.includes(id)||!ruleSet(prior.matched).includes(id)))return null;
 if(d.confirmedDate===null&&d.confirmedObservedAt===null&&d.confirmationDelayMs===null)return d;
 if(prior.stage!=='focus'||!dateOk(d.confirmedDate)||d.confirmedDate<=d.firstSeenDate||d.confirmedDate>prior.lastSeen||
    !validClock(d.confirmedObservedAt)||d.confirmedObservedAt<=d.firstObservedAt||d.confirmedObservedAt>d.lastObservedAt||
    d.confirmedDate>marketDay(d.confirmedObservedAt)||d.confirmationDelayMs!==d.confirmedObservedAt-d.firstObservedAt)return null;
 return d;
}
function discoveryFor(prior,matched,sourceDate,now,stage){
 if(!['observe','focus'].includes(stage))return null;
 const ids=ruleSet(matched);
 if(!ids.length)return null;
 const old=readDiscovery(prior);
 const surviving=old?old.continuousMatched.filter(id=>ids.includes(id)):[];
 if(!old||!surviving.length||dayDiff(sourceDate,prior.lastSeen)>7)
  return {mode:'research-clock-only',firstSeenDate:sourceDate,firstObservedAt:now,firstMatched:ids,continuousMatched:ids.slice(),lastObservedAt:now,
   confirmedDate:null,confirmedObservedAt:null,confirmationDelayMs:null};
 const next={mode:'research-clock-only',firstSeenDate:old.firstSeenDate,firstObservedAt:old.firstObservedAt,
  firstMatched:old.firstMatched.slice(),continuousMatched:surviving,lastObservedAt:now,
  confirmedDate:old.confirmedDate,confirmedObservedAt:old.confirmedObservedAt,confirmationDelayMs:old.confirmationDelayMs};
 if(stage==='focus'&&old.confirmedDate===null&&sourceDate>prior.lastSeen&&now>old.lastObservedAt){
  next.confirmedDate=sourceDate;next.confirmedObservedAt=now;next.confirmationDelayMs=now-old.firstObservedAt;
 }
 return next;
}
function updateLifecycle({items=[],previous=[],now=Date.now(),expiryDays=7,archiveAfterMisses=3}={}){
 if(!Array.isArray(items)||items.length>10000||!Array.isArray(previous)||previous.length>10000)throw TypeError('研究池记录数量无效');
 if(!validClock(now)||!Number.isSafeInteger(expiryDays)||expiryDays<1||expiryDays>90)throw TypeError('日期或过期阈值无效');
 if(!Number.isSafeInteger(archiveAfterMisses)||archiveAfterMisses<1||archiveAfterMisses>30)throw TypeError('缺席阈值无效');
 const today=marketDay(now);
 const prevMap=new Map(),previousIds=new Set(),ambiguousPrior=new Set();
 for(const r of previous){
  if(!r||typeof r.symbol!=='string'||!RX.test(r.symbol))continue;
  if(previousIds.has(r.symbol)){prevMap.delete(r.symbol);ambiguousPrior.add(r.symbol);continue;}
  previousIds.add(r.symbol);
  const undated=r.lastSeen===null&&r.stage==='archived'&&r.dataStatus==='unavailable'&&r.streak===0&&r.misses===0;
  if(!VALID.has(r.stage)||(!undated&&!dateOk(r.lastSeen))||(!undated&&r.lastSeen>today)||!validCount(r.streak)||!validCount(r.misses)||
     (r.evaluatedAt!==undefined&&!validClock(r.evaluatedAt))){
   ambiguousPrior.add(r.symbol);continue;
  }
  prevMap.set(r.symbol,r);
 }
 const counts=new Map();
 for(const item of items){const id=String(item?.symbol||'');if(RX.test(id))counts.set(id,(counts.get(id)||0)+1);}
 const states=[],seen=new Set();
 for(const item of items){
  const symbol=String(item?.symbol||''),quality=item?.quality||{},p=item?.patterns||{};
  if(!RX.test(symbol)||seen.has(symbol))continue;
  seen.add(symbol);
  const last=Array.isArray(item.bars)?item.bars.at(-1):null;
  const sourceDate=last?.date||item?.patternDate||null;
  const previousRow=prevMap.get(symbol);
  const dated=dateOk(sourceDate)&&sourceDate<=today;
  const expired=!dated||(dayDiff(today,sourceDate)>expiryDays);
  const qualityReady=quality.usable===true&&quality.simulated===false&&quality.fresh===true&&p.usable!==false&&dated&&!expired;
  const matched=safeArr(p.matched).filter(x=>x?.status==='matched'&&x.side==='bullish').map(x=>safeId(x.id)).filter(Boolean);
  const risks=safeArr(p.matched).filter(x=>x?.status==='matched'&&x.side==='bearish').map(x=>safeId(x.id)).filter(Boolean);
  const hasRisk=risks.length>0||(item?.issuerEvidence?.riskClues?.length||0)>0||
   (item?.issuerEvidence?.conflicts?.length||0)>0||!!item?.linkageResearch?.riskConflict;
  const blocked=!!item.blockedBySafety;
  const carry=previousRow&&dateOk(previousRow.lastSeen)?previousRow:null;
  const oldDiscovery=readDiscovery(carry);
  const evaluatedAt=Math.max(now,validClock(previousRow?.evaluatedAt)?previousRow.evaluatedAt:0,oldDiscovery?.lastObservedAt||0);
  const disputed=counts.get(symbol)!==1||ambiguousPrior.has(symbol)||
   !!(carry&&dated&&carry.lastSeen>sourceDate)||evaluatedAt>now;
  if(!qualityReady||disputed){
   states.push({symbol,stage:carry?.stage||'archived',lastSeen:carry?.lastSeen||null,
    streak:carry?.streak||0,misses:carry?.misses||0,matched:[],riskIds:[],confirmed:false,
    dataStatus:'unavailable',evaluatedAt,discovery:null,reason:disputed?'重复、矛盾或倒序观察，禁止升级':expired?'缺少近期有效日K或历史已过期':'数据质量或来源不符合升级要求'});
   continue;
  }
  const had=matched.length>0,prevDate=carry?.lastSeen,dayChanged=prevDate!==sourceDate;
  let streak=carry?.streak||0,misses=carry?.misses||0,stage='archived';
  if(had){
   // Multiple checks in the same session never count as consecutive-day confirmation.
   const continuous=eligiblePrior(carry)&&dayDiff(sourceDate,prevDate)<=7&&
    (oldDiscovery?.continuousMatched||ruleSet(carry.matched)).some(id=>matched.includes(id));
   streak=blocked||hasRisk?0:continuous?(dayChanged?Math.min(10000,streak+1):Math.max(1,streak)):1;
   misses=0;
   stage=blocked||hasRisk?'risk-review':streak>=2?'focus':'observe';
  }else{
   if(carry){
    misses=dayChanged?Math.min(10000,misses+1):misses;
    stage=hasRisk||blocked?'risk-review':misses>=archiveAfterMisses?'archived':'weakening';
   }else stage=hasRisk||blocked?'risk-review':'archived';
   streak=0;
  }
  states.push({symbol,name:String(item.name||'').slice(0,90),stage,lastSeen:sourceDate,
   streak,misses,matched,riskIds:risks,confirmed:stage==='focus',evaluatedAt,
   discovery:discoveryFor(carry,matched,sourceDate,now,stage),
   dataStatus:'observed-research-only',reason:stage==='risk-review'?'风险独立处理，不允许被看涨命中覆盖':
    stage==='focus'?'不同交易日连续确认，仍属研究关注':stage==='observe'?'任意一套完整战法命中即入观察':
    stage==='weakening'?'有效数据连续未命中，转弱观察':stage==='archived'?'无研究命中或达到归档阈值':''});
 }
 // A partial scan does not establish failure or absence of the prior signal.
 // Keep the last dated state without exposing it in the current watch pools.
 for(const [symbol,prior] of prevMap){
  if(seen.has(symbol)||ambiguousPrior.has(symbol))continue;
  states.push({symbol,name:String(prior.name||'').slice(0,90),stage:prior.stage,lastSeen:prior.lastSeen,
   streak:prior.streak,misses:prior.misses,matched:[],riskIds:[],confirmed:false,dataStatus:'unavailable',
   evaluatedAt:Math.max(now,prior.evaluatedAt||0,readDiscovery(prior)?.lastObservedAt||0),discovery:null,reason:'本轮未覆盖该证券；保留历史状态，不升级、不计缺席'});
 }
 if(states.length>10000)throw Error('本轮与历史证券合并超过研究池上限，拒绝静默丢弃历史');
 const pools={'新发现观察池':[],'持续确认重点池':[],'风险核对池':[],'转弱跟踪池':[]};
 for(const x of states){
  if(x.dataStatus!=='observed-research-only')continue;
  const k=x.stage==='observe'?'新发现观察池':x.stage==='focus'?'持续确认重点池':x.stage==='risk-review'?'风险核对池':x.stage==='weakening'?'转弱跟踪池':null;
  if(k)pools[k].push({symbol:x.symbol,name:x.name,stage:x.stage,matchedCount:x.matched.length,risks:x.riskIds.length,
   streak:x.streak,lastSeen:x.lastSeen,reason:x.reason,discovery:x.discovery?structuredClone(x.discovery):null});
 }
 return {schemaVersion:1,mode:'research-only',asOf:now,states,pools,
  canTrade:false,canNotify:false,notes:['研究阶段股票池，不做自动下单或手机推送；无数据时不自动升级或清空旧记录']};
}
module.exports={updateLifecycle};
