'use strict';
// Synthetic fixtures with an explicit test calendar, never supplier observations.
const {digest}=require('../../src/core/research-workspace-store');
const dates=Array.from({length:240},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10)).filter(d=>![0,6].includes(new Date(d).getUTCDay()));
const at=(index,hour='16:30')=>Date.parse(dates[index]+'T'+hour+':00+08:00');
function fixture({index=70,symbol='600000',provider='tencent',priceShift=0}={}){
 const bars=dates.slice(0,index+1).map((date,i)=>({date,open:10+i*.01+priceShift,close:10.05+i*.01+priceShift,high:10.15+i*.01+priceShift,low:9.9+i*.01+priceShift,volume:10000+i,amount:100000,
  knownAt:at(i),statusKnownAt:at(i,'09:00'),suspended:false,tradable:true,isST:false,corporateAction:false,corporateActionKnownAt:at(i,'09:00')}));
 const observationHash=digest({symbol,provider,bars});
 return {asOf:at(index),stock:{symbol,name:'合成验证股票',provider,source:provider,priceBasis:'unadjusted',observedAt:at(index),bars},observation:{observationHash},
  history:{status:'observed-unverified'},calendar:{metadata:{sha256:'a'.repeat(64),source:'synthetic-explicit-calendar'},nextTradeDate:dates[index+1]},analysis:{tradeDates:dates},
  evidenceBundle:{symbol,provider,priceBasis:'unadjusted',decisionAt:at(index),recordedAt:at(index),observationHash,hash:digest({observationHash,index}),sourceRefs:[{source:provider,url:'https://example.org/data?q=private-test-value',sha256:'b'.repeat(64),receivedAt:at(index)}]},
  research36:{code:symbol,version:'synthetic-v1',evaluations:[{id:'test-rule',name:'合成资金条件',checks:[{field:'funds',value:0,pass:false,op:'>',threshold:0,evidence:{source:provider,recordedAt:at(index),observedAt:at(index)}}]}]}};
}
function native(index=70,symbol='600000'){
 const pack=require('../../strategies/a-share-strategy-pack.json');
 return {gptEvidence:{symbol,date:dates[index],knownAt:at(index),source:'synthetic-native-gpt-factor-fixture',scores:Object.fromEntries([...new Set(pack.strategies.flatMap(s=>s.rules.map(r=>r.field)))].map(k=>[k,k==='riskScore'?0:100]))},
  pythonEvidence:{symbol,date:dates[index],observedThrough:dates[index],knownAt:at(index),evaluatorVersion:'python-native/synthetic-fixture-v1',provenance:'python-runtime:isolated-test-only',rounds:[1,2,3].map(round=>({round,verdict:'pass',reason:'合成独立运行验证',observedThrough:dates[index]}))}};
}
function event(data,sequence=1,recordedAt=data.asOf){return {kind:'analysis',hash:digest({sequence,data,recordedAt}),sequence,recordedAt,data};}
module.exports={dates,at,fixture,native,event};
