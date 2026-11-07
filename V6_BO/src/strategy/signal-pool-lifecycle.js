'use strict';
// Deterministic research-only watch pool lifecycle. No trading, external messaging or score changes.
const VALID=new Set(['observe','focus','risk-review','weakening','archived']);
const RX=/^\d{6}$/,DATE=/^\d{4}-\d{2}-\d{2}$/;
const dateOk=d=>typeof d==='string'&&DATE.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
const safeArr=a=>Array.isArray(a)?a:[];
const safeId=value=>typeof value==='string'?value.slice(0,70):'';
const dayDiff=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
function updateLifecycle({items=[],previous=[],now=Date.now(),expiryDays=7,archiveAfterMisses=3}={}){
 if(!Array.isArray(items)||items.length>10000||!Array.isArray(previous)||previous.length>10000)throw TypeError('研究池记录数量无效');
 if(!Number.isFinite(now)||now<=0||!Number.isSafeInteger(expiryDays)||expiryDays<1||expiryDays>90)throw TypeError('日期或过期阈值无效');
 if(!Number.isSafeInteger(archiveAfterMisses)||archiveAfterMisses<1||archiveAfterMisses>30)throw TypeError('缺席阈值无效');
 const today=new Date(now+8*3600000).toISOString().slice(0,10);
 const prevMap=new Map();
 for(const r of previous){
  if(!r||!RX.test(r.symbol)||prevMap.has(r.symbol)||!VALID.has(r.stage)||!dateOk(r.lastSeen))continue;
  prevMap.set(r.symbol,r);
 }
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
  const qualityReady=!!quality.usable&&!quality.simulated&&quality.fresh&&dated&&!expired;
  const matched=safeArr(p.matched).filter(x=>x?.status==='matched'&&x.side==='bullish').map(x=>safeId(x.id)).filter(Boolean);
  const risks=safeArr(p.matched).filter(x=>x?.status==='matched'&&x.side==='bearish').map(x=>safeId(x.id)).filter(Boolean);
  const hasRisk=risks.length>0||(item?.issuerEvidence?.riskClues?.length||0)>0||
   (item?.issuerEvidence?.conflicts?.length||0)>0||!!item?.linkageResearch?.riskConflict;
  const blocked=!!item.blockedBySafety;
  const carry=previousRow&&dateOk(previousRow.lastSeen)&&previousRow.lastSeen<=sourceDate?previousRow:null;
  if(!qualityReady){
   states.push({symbol,stage:carry?.stage||'archived',lastSeen:carry?.lastSeen||null,
    streak:carry?.streak||0,misses:carry?.misses||0,matched:[],riskIds:[],confirmed:false,
    dataStatus:'unavailable',reason:expired?'缺少近期有效日K或历史已过期':'数据质量或来源不符合升级要求'});
   continue;
  }
  const had=matched.length>0,prevDate=carry?.lastSeen,dayChanged=prevDate!==sourceDate;
  let streak=carry?.streak||0,misses=carry?.misses||0,stage='archived';
  if(had){
   // Multiple checks in the same session never count as consecutive-day confirmation.
   streak=dayChanged?(carry&&dayDiff(sourceDate,prevDate)<=7&&carry.misses===0?streak+1:1):Math.max(1,streak);
   misses=0;
   stage=blocked||hasRisk?'risk-review':streak>=2?'focus':'observe';
  }else{
   if(carry){
    misses=dayChanged?misses+1:misses;
    stage=hasRisk||blocked?'risk-review':misses>=archiveAfterMisses?'archived':'weakening';
   }else stage=hasRisk||blocked?'risk-review':'archived';
   streak=0;
  }
  states.push({symbol,name:String(item.name||'').slice(0,90),stage,lastSeen:sourceDate,
   streak,misses,matched,riskIds:risks,confirmed:stage==='focus',
   dataStatus:'observed-research-only',reason:stage==='risk-review'?'风险独立处理，不允许被看涨命中覆盖':
    stage==='focus'?'不同交易日连续确认，仍属研究关注':stage==='observe'?'任意一套完整战法命中即入观察':
    stage==='weakening'?'有效数据连续未命中，转弱观察':stage==='archived'?'无研究命中或达到归档阈值':''});
 }
 const pools={'新发现观察池':[],'持续确认重点池':[],'风险核对池':[],'转弱跟踪池':[]};
 for(const x of states){
  if(x.dataStatus!=='observed-research-only')continue;
  const k=x.stage==='observe'?'新发现观察池':x.stage==='focus'?'持续确认重点池':x.stage==='risk-review'?'风险核对池':x.stage==='weakening'?'转弱跟踪池':null;
  if(k)pools[k].push({symbol:x.symbol,name:x.name,stage:x.stage,matchedCount:x.matched.length,risks:x.riskIds.length,
   streak:x.streak,lastSeen:x.lastSeen,reason:x.reason});
 }
 return {schemaVersion:1,mode:'research-only',asOf:now,states,pools,
  canTrade:false,canNotify:false,notes:['研究阶段股票池，不做自动下单或手机推送；无数据时不自动升级或清空旧记录']};
}
module.exports={updateLifecycle};
