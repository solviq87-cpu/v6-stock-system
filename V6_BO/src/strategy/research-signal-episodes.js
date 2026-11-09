'use strict';
/**
 * Descriptive signal clustering for frozen research audits.
 * It never changes an event, excludes an unfavorable outcome, or estimates
 * independent statistical samples. Consecutive sessions may share one trade.
 */
function summarizeTemporalSignalEpisodes(events,catalog,horizons,tradeDates){
 if(!Array.isArray(events)||!Array.isArray(catalog)||!Array.isArray(horizons)||
    !Array.isArray(tradeDates))throw Error('时序信号审计参数无效');
 const indexByDate=new Map(tradeDates.map((d,i)=>[d,i]));
 const familyByRule=new Map(catalog.map(r=>[r.id,r.family||'public-technical']));
 const countEpisodes=(sessionSet,horizon)=>{
  const sorted=[...sessionSet].sort((a,b)=>a-b);
  let count=0,lastStart=-Infinity;
  for(const index of sorted)if(index-lastStart>horizon){count++;lastStart=index;}
  return count;
 };
 const byHorizon={};
 for(const horizon of horizons){
  const familyGroups=new Map(),ruleGroups=new Map();
  let rawRuleEvents=0;
  for(const event of events){
   if(event.horizon!==horizon)continue;
   const index=indexByDate.get(event.signalDate);
   if(!Number.isSafeInteger(index)||!familyByRule.has(event.ruleId))
    throw Error('信号历史日期或研究战法与审计配置不匹配');
   rawRuleEvents++;
   const family=familyByRule.get(event.ruleId);
   const familyKey=event.symbol+'|'+family;
   const ruleKey=event.symbol+'|'+event.ruleId;
   if(!familyGroups.has(familyKey))familyGroups.set(familyKey,new Set());
   if(!ruleGroups.has(ruleKey))ruleGroups.set(ruleKey,new Set());
   familyGroups.get(familyKey).add(index);
   ruleGroups.get(ruleKey).add(index);
  }
  const familyExposureDays=[...familyGroups.values()].reduce((sum,set)=>sum+set.size,0);
  const nonoverlapFamilyEpisodes=[...familyGroups.values()]
   .reduce((sum,set)=>sum+countEpisodes(set,horizon),0);
  const byRule=Object.fromEntries(catalog.map(rule=>[rule.id,{
   signalDays:0,nonoverlapEpisodes:0,serialRepeatDays:0,
   suggestedWeightAction:'unchanged'
  }]));
  for(const [key,days] of ruleGroups){
   // Symbols are six digits in validated V6 historical datasets.
   const id=key.slice(key.indexOf('|')+1),row=byRule[id];
   row.signalDays+=days.size;
   row.nonoverlapEpisodes+=countEpisodes(days,horizon);
  }
  for(const row of Object.values(byRule))
   row.serialRepeatDays=row.signalDays-row.nonoverlapEpisodes;
  byHorizon[horizon]={
   rawRuleEvents,
   familyExposureDays,
   sameDayFamilyDuplicates:rawRuleEvents-familyExposureDays,
   nonoverlapFamilyEpisodes,
   serialRepeatFamilyDays:familyExposureDays-nonoverlapFamilyEpisodes,
   byRule
  };
 }
 return {schemaVersion:1,status:'descriptive-only',
  unit:'symbol + predeclared research family + trading-session index',
  byHorizon,weightsChanged:false,autoPromotion:false,
  caveat:'相邻信号可对应重叠持仓，分段只给出非重叠观察的保守数量，不等于统计独立样本量、已成交订单或经认证的收益。全部匹配事件（包括无法成交和亏损结果）仍在原始事件表中。'};
}
module.exports={summarizeTemporalSignalEpisodes};
