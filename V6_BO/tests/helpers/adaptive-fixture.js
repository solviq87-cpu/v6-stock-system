'use strict';
function fixture(n=100){
 const dates=Array.from({length:n},(_,i)=>new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10));
 const bars=base=>dates.map((date,i)=>{const close=base+i*.2;return {date,statusKnownAt:date+'T09:00:00+08:00',isST:false,suspended:false,tradable:true,knownAt:date+'T15:05:00+08:00',sessionCloseAt:date+'T15:00:00+08:00',open:close-.03,close,high:close+.05,low:close-.05,volume:1000000,originalRuleSignals:{fourteen:true}}});
 const indices=Object.fromEntries(['shanghai','shenzhen','chinext','a50'].map(id=>[id,{provider:'test-fixture',version:id+'-1',instrument:'index',bars:bars(100)}]));
 const sectorEvidence=dates.map(date=>{const prior=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);return {schemaVersion:1,source:'imported',kind:'sector',provider:'test-fixture',version:'sector-'+date,sourceRecordId:'row-'+date,tradeDate:date,publishedAt:prior+'T16:00:00+08:00',knownAt:prior+'T16:01:00+08:00',classificationAsOf:prior,sectors:{600000:'电子',600001:'机械'}}});
 const weightEvidence=sectorEvidence.map(e=>({source:'imported',provider:'test-fixture',version:'weights-'+e.tradeDate,tradeDate:e.tradeDate,weightsAsOf:e.classificationAsOf,publishedAt:e.publishedAt,knownAt:e.knownAt,weights:{600000:{shanghai:.2,shenzhen:0,chinext:0,a50:0},600001:{shanghai:.3,shenzhen:0,chinext:0,a50:0}}}));
 return {schemaVersion:1,source:'simulated',provider:'test-fixture-not-market-data',version:'fixture-v1',asOf:dates.at(-1),decisionAt:dates.at(-1)+'T16:00:00+08:00',indices,stocks:[{symbol:'600000',market:'main',name:'研究样本甲',bars:bars(20)},{symbol:'600001',market:'main',name:'研究样本乙',bars:bars(30)}],sectorEvidence,weightEvidence,tradingCalendar:{schemaVersion:1,exchange:'SSE',source:'fixture-all-days-open-not-official',from:dates[0],to:dates.at(-1),sessions:dates.map(date=>({date,open:true}))}};
}
module.exports={fixture};
