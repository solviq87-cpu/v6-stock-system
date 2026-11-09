'use strict';
/**
 * User research preference, not a validated claim that a company is
 * index-heavy or low-return. Cannot alter original strategies or orders.
 */
const sectorFamilies=Object.freeze([
 {id:'banking',label:'银行',pattern:/银行/},
 {id:'insurance',label:'保险',pattern:/保险/},
 {id:'brokerage',label:'证券/券商',pattern:/证券|券商/},
 {id:'baijiu',label:'白酒',pattern:/白酒/}
]);
function assessWeakMarketSectorPreference(rationale){
 const base={schemaVersion:1,mode:'historical-research-preference',
  status:'unknown',action:'no-change',family:null,marketRegime:'unknown',
  researchDeprioritized:false,originalRulesChanged:false,
  weightsChanged:false,canTrade:false,autoPromotion:false,
  reason:'缺少同交易日来源完整的大盘与板块证据，不能推断应避让的板块'};
 const m=rationale?.marketSectorResilience,s=rationale?.sector,p=rationale?.price;
 if(m?.status!=='market-sector-observed-unverified'||
    !['systemic-selloff-observed','broad-selloff-observed',
      'broad-advance-observed','mixed-observed'].includes(m.marketRegime)||
    p?.status!=='imported-unverified'||!m.tradeDate||m.tradeDate!==p?.date||
    s?.status!=='imported-unverified'||!s.name||
    m.sectorName!==s.name||m.sectorSource!==s.source)
  return base;
 const marketRegime=m.marketRegime;
 const down=['systemic-selloff-observed','broad-selloff-observed'].includes(marketRegime);
 const matched=sectorFamilies.find(f=>f.pattern.test(s.name));
 if(!down)return {...base,status:'observed-unverified',marketRegime,
  reason:'没有满足已定义的广泛下跌条件，弱市板块偏好不作调整'};
 if(!matched)return {...base,status:'observed-unverified',marketRegime,
  reason:'市场弱势，但所属板块不属于用户指定的银行、保险、证券/券商或白酒研究避让名单'};
 return {...base,status:'observed-unverified',marketRegime,
  action:'deprioritize',researchDeprioritized:true,family:matched.id,
  reason:'弱市已导入指数与板块证据；按用户偏好，'+matched.label+
   '研究观察降优先级。保留命中与风险证据，不自动剔除历史样本或认定真实指数权重'};
}
module.exports={sectorFamilies,assessWeakMarketSectorPreference};
