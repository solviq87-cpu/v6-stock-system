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
 // Recheck the frozen comparison at the shared display boundary. These
 // numbers describe traded participation, not execution liquidity or an alert.
 const p=v.participationContext;
 if(valid&&p?.mode==='same-original-minute-participation-v1'&&p.canTrade===false&&p.canNotify===false&&p.liquidityVerified===false&&p.indexLeadTimeMs===null){
  const positive=x=>finite(x)&&x>0;
  const share=x=>finite(x)&&x>=0&&x<=1;
  const refs=Array.isArray(v.references)?v.references:[];
  const hashOK=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const same=hashOK(p.minuteProfileHash)?refs.filter(r=>r&&r.minuteProfileHash===p.minuteProfileHash&&r.memberHash===v.memberHash&&r.unit===v.monetaryUnit&&r.source===v.source&&r.slot===v.slot&&r.universeSize===v.universeSize&&positive(r.totalTurnover)&&share(r.upShare)&&r.end<v.startedAt):[];
  const sorted=xs=>[...xs].sort((a,b)=>a-b),amounts=sorted(same.map(r=>r.totalTurnover)),shares=sorted(same.map(r=>r.upShare));
  const historicalMedian=amounts.length===20?amounts[9]/2+amounts[10]/2:null;
  const complete=comparable&&p.status==='observed-unverified'&&p.referenceDays===20&&p.referenceDaysRequired===20&&same.length===20&&new Set(same.map(r=>r.date)).size===20&&p.turnoverBasis==='provider-cumulative-CNY-unverified'&&p.thresholdBasis==='exploratory-strict-below-prior-20th-percentile'&&
   share(p.currentUpShare)&&share(p.currentDownShare)&&p.currentUpShare+p.currentDownShare<=1+1e-12&&positive(p.currentTurnover)&&p.historicalTurnoverMedian===historicalMedian&&p.historicalTurnoverQ20===amounts[3]&&p.historicalUpShareQ20===shares[3]&&finite(p.turnoverRatioToMedian)&&p.turnoverRatioToMedian===p.currentTurnover/historicalMedian;
  const joint=complete&&p.currentDownShare>.5&&p.currentUpShare<p.historicalUpShareQ20&&p.currentTurnover<p.historicalTurnoverQ20;
  if(complete&&p.observation===(joint?'weak-breadth-low-turnover':'no-joint-observation')){
   metrics.push(['同时段广度','上涨 '+n(100*p.currentUpShare)+'% / 下跌 '+n(100*p.currentDownShare)+'%'],['成交额 / 历史中位数',n(100*p.turnoverRatioToMedian)+'%'],['联合研究观察',joint?'弱广度与低成交额并存（仅研究）':'未见该联合现象，不代表风险解除']);
  }else metrics.push(['联合研究观察','可比样本不足或证据待核']);
 }
 const a=v.dormantActivity;
 if(a?.mode==='fixed-slot-dormant-activity-v1'&&v.canTrade===false&&v.canNotify===false){
  const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=15000;
  const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x);
  const positive=x=>finite(x)&&x>0;
  const ready=valid&&a.status==='descriptive-observation'&&a.canTrade===false&&a.canNotify===false&&a.independentValueVerified===false&&a.marketImpactVerified===false&&a.calendarExternallyVerified===false&&a.source===v.source&&a.unit===v.monetaryUnit&&a.observationAt===v.asOf&&a.referenceDays===21&&a.baselineDaysRequired===20&&a.confirmationDaysRequired===2&&/^[a-f0-9]{64}$/.test(a.calendarHash||'')&&Array.isArray(a.dates)&&a.dates.length===22&&a.dates.every((d,i)=>date(d)&&(!i||d>a.dates[i-1]))&&a.dates.at(-1)===v.date&&[a.attempted,a.evaluated,a.unknown,a.matched,a.singleDayOnly].every(count)&&a.attempted<=v.universeSize&&a.evaluated+a.unknown===a.attempted&&a.matched+a.singleDayOnly<=a.evaluated&&Array.isArray(a.rows)&&a.rows.length===Math.min(20,a.matched)&&new Set(a.rows.map(r=>r?.symbol)).size===a.rows.length&&a.rows.every(r=>r&&/^(?:60|68|00|30)\d{4}$/.test(r.symbol)&&r.canTrade===false&&r.canNotify===false&&count(r.cohortSize)&&r.cohortSize>=10&&/^[a-f0-9]{64}$/.test(r.cohortFingerprint||'')&&Number.isSafeInteger(r.dormantDays)&&r.dormantDays>=15&&r.dormantDays<=20&&positive(r.priorMedian)&&Array.isArray(r.confirmation)&&r.confirmation.length===2&&r.confirmation.every((x,i)=>x.date===a.dates[20+i]&&positive(x.amountCny)&&x.amountCny>=1000000&&positive(x.floatMarketValueCny)&&positive(x.amountToFloatCap)&&positive(x.peerMedian)&&Math.abs(x.amountToFloatCap-x.amountCny/x.floatMarketValueCny)<=1e-8&&x.amountToFloatCap+1e-8>=2*r.priorMedian&&x.amountToFloatCap+1e-8>=1.5*x.peerMedian));
  metrics.push(['沉寂活跃研究',ready?'连续两次同口径观察 '+a.matched+' 只（仅研究）':'缺少连续22个同口径采样日或市值证据']);
  if(ready){metrics.push(['同规模比较覆盖',a.evaluated+' / '+a.attempted+' 只；单日未确认 '+a.singleDayOnly+' 只']);if(a.rows.length)metrics.push(['研究观察代码',a.rows.map(r=>r.symbol).join('、')+(a.truncated?'（仅列20只）':'')]);}
 }
 const coverage=Number.isSafeInteger(v.referenceDays)&&v.referenceDays>=0&&v.referenceDays<=20?v.referenceDays+' / 20 个可比观察日':'历史样本未知';
 return {title:'成交集中度与历史拥挤研究',description:(comparable?'同源、同股票池、同五分钟时段历史比较':statuses[v.status]||'历史分位待证据')+' · '+coverage+'。'+warning+(p?' 广度与成交额比较不代表真实流动性或领先指数。':'')+(a?' 沉寂活跃仅为累计成交额/同刻流通市值代理的探索性观察，不代表真实换手或未来收益。':''),metrics};
}
