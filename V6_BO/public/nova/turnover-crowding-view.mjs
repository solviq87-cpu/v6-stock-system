const finite=x=>typeof x==='number'&&Number.isFinite(x);
const ratio=x=>finite(x)&&x>=0&&x<=1+1e-12;
const n=x=>x.toLocaleString('zh-CN',{maximumFractionDigits:6});
const clock=x=>Number.isSafeInteger(x)&&x>0&&Number.isFinite(new Date(x).getTime())?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
const statuses={'insufficient-history':'历史可比交易日不足','slot-already-frozen':'本时段首份样本已冻结，等待下一时段','disputed-slot':'本时段证据冲突，停止历史比较','out-of-order':'迟到采样已隔离','invalid-or-incomplete-snapshot':'成交额、时点或全池覆盖不足'};
export function turnoverCrowdingView(v){
 if(!v||v.mode!=='same-slot-turnover-hhi-v1')return null;
 const warning='成交额集中程度，不等于资金净流入、主力身份或交易信号。';
 const metrics=[];
 const valid=ratio(v.currentHHI)&&Number.isSafeInteger(v.universeSize)&&v.universeSize>=2&&v.canTrade===false&&v.canNotify===false;
 if(valid)metrics.push(['全池成交额HHI',n(v.currentHHI)],['采样证券数',String(v.universeSize)],['采样截至',clock(v.asOf)]);
 const comparable=valid&&v.status==='observed-unverified'&&v.referenceDays===20&&v.referenceDaysRequired===20&&Array.isArray(v.references)&&v.references.length===20&&
  finite(v.empiricalPercentile)&&v.empiricalPercentile>=0&&v.empiricalPercentile<=100&&ratio(v.historicalMin)&&ratio(v.historicalMax)&&v.historicalMin<=v.historicalMax;
 if(comparable)metrics.push(['同样本同时段历史分位',n(v.empiricalPercentile)+'%'],['历史HHI范围',n(v.historicalMin)+' ～ '+n(v.historicalMax)]);
 const liquidity=v.liquidity;
 if(v.canTrade===false&&v.canNotify===false&&liquidity?.mode==='same-slot-market-turnover-v1'&&liquidity.canTrade===false&&liquidity.canNotify===false&&
    Number.isSafeInteger(liquidity.expectedSecurities)&&liquidity.expectedSecurities>=2&&Number.isSafeInteger(liquidity.validSecurities)&&liquidity.validSecurities>=0){
  metrics.push(['成交额有效证券覆盖',String(liquidity.validSecurities)+' / '+String(liquidity.expectedSecurities)]);
  if(liquidity.completeSnapshot===true&&liquidity.validSecurities===liquidity.expectedSecurities&&finite(liquidity.currentAmount)&&liquidity.currentAmount>0&&liquidity.unit==='provider-CNY-unverified'){
   metrics.push(['完整样本累计成交额（元，供应商口径）',n(liquidity.currentAmount)]);
   if(liquidity.status==='observed-unverified'&&liquidity.comparableDays===20&&liquidity.referenceDaysRequired===20&&finite(liquidity.referenceMedianAmount)&&liquidity.referenceMedianAmount>0&&finite(liquidity.relativeChangePct)){
    metrics.push(['同期成交额中位基准（元）',n(liquidity.referenceMedianAmount)],['同期成交额相对变化',n(liquidity.relativeChangePct)+'%']);
   }else metrics.push(['同期成交额比较','匹配时点的完整历史覆盖不足']);
  }else metrics.push(['同期成交额比较','当前成交额或有效证券覆盖不足，不判缩量']);
  if(liquidity.dataRecovery?.status==='coverage-reobserved'&&liquidity.dataRecovery.riskCleared===false)
   metrics.push(['数据覆盖恢复',clock(liquidity.dataRecovery.reobservedAt)+'；不解除原风险']);
 }
 const industry=v.industry;
 if(valid&&industry?.status==='observed-unverified'&&industry.canTrade===false&&industry.covered===v.universeSize&&ratio(industry.industryHHI)&&typeof industry.classificationVersion==='string'){
  metrics.push(['行业成交额HHI',n(industry.industryHHI)],['行业分类版本',industry.classificationVersion]);
  for(const x of Array.isArray(industry.topIndustries)?industry.topIndustries.slice(0,3):[]){
   if(typeof x?.name==='string'&&ratio(x.share))metrics.push([x.name+' 成交额占比',n(x.share*100)+'%']);
  }
 }else if(valid)metrics.push(['行业成交额HHI','缺少完整、无重叠的冻结行业成分']);
 const coverage=Number.isSafeInteger(v.referenceDays)&&v.referenceDays>=0&&v.referenceDays<=20?v.referenceDays+' / 20 个可比观察日':'历史样本未知';
 return {title:'成交集中度与历史拥挤研究',description:(comparable?'同源、同股票池、同五分钟时段历史比较':statuses[v.status]||'历史分位待证据')+' · '+coverage+'。'+warning,metrics};
}
