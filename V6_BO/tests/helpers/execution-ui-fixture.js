'use strict';
// Isolated original-book/plan inputs shared by presentation checks. Never used
// by the running application, a feed adapter, or an order execution callback.
const {bindAuthoritativePlan,decisionPlanPayload}=require('../../src/core/paper-decision-plan');
function executionInput({day='2026-11-16',now=Date.parse(day+'T15:30:00+08:00'),entered=false}={}){
 const stamp=time=>Date.parse(day+'T'+time+'+08:00'),planId='plan-00000000-0000-4000-8000-000000000001';
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600001',name:'执行证据隔离验证',day,
  calculatedAt:stamp('09:29:40'),strategyAt:stamp('09:29:00'),quoteBasis:{source:'tencent',quoteAt:stamp('09:29:39')},
  plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
 const plan=bindAuthoritativePlan({id:planId,sampleSet:'real',frozenAt:new Date(stamp('09:29:50')).toISOString(),...decisionPlanPayload(card)},card);
 const entry={eventId:'original-buy',orderId:'buy-order',side:'buy',symbol:card.code,quantity:200,tradeDate:day,
  timestamp:stamp('10:00:00'),price:10,reason:'作战台计划['+planId+'] 原账户风控'};
 const book={revision:1,legacy:{enabled:true},feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},
  account:{cash:10000,events:entered?[entry]:[],positions:entered?{[card.code]:{quantity:200,
   lots:[{quantity:200,buyDate:day,sellableDate:null,sourceEventId:entry.eventId}]}}:{}},orders:{}};
 return {day,now,plans:[plan],book,observations:[],conditionalOrders:[],candidates:[card],
  sources:{archiveRevision:1,observationRevision:0,conditionalRevision:0,ledgerReadAt:now}};
}
module.exports={executionInput};
