'use strict';
// Synthetic offline evidence; never sent to market APIs or used as page defaults.
const {at,dates}=require('./research-workspace-fixtures');
function evidence({index=70,symbol='600000',provider='tencent',activation=false}={}){
 const start=at(index-1,'15:00'),end=at(index,'15:00'),knownAt=at(index);
 const a=['600000','600001','600002','600003','600004'],b=['000001','000002','000003','000004','000005'];
 const returns=[.03,.02,.01,0,-.01,-.025,-.015,-.01,0,0];
 const board=(code,name,category,members,ret)=>({code,name,category,members,membersKnownAt:start,membersEffectiveAt:start,return:ret,knownAt});
 return {provider,symbol,tradeDate:dates[index],knownAt,window:{start,end},returnBasis:'price',
  benchmark:{provider,code:'synthetic-index',name:'合成验证指数',methodologyVersion:'synthetic-constant-shares/v1',return:0,startValue:1000,knownAt},
  classification:{provider,version:'synthetic-frozen-industry/v1',knownAt:start,effectiveAt:start},
  methodology:{weightsKnownAt:start,weightsEffectiveAt:start,noCorporateActions:true,completeConstituents:true},
  boards:[board('A','合成行业甲','industry',a,.01),board('B','合成行业乙','industry',b,-.01),board('C','合成重叠概念','concept',[...a,b[0]],0)],
  stocks:[...a,...b].map((code,i)=>({symbol:code,return:returns[i],weight:.1,indexMember:true,primaryIndustry:i<5?'A':'B',turnover:1000000-i*10000,knownAt,
   ...(activation?{activation:{at:end-4*3600000+i*60000,confirmedAt:end-4*3600000+i*60000+30000,knownAt,definitionVersion:'synthetic-price-volume-event/v1'}}:{})}))};
}
module.exports={evidence};
