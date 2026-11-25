'use strict';
const catalog=require('../../public/nova/shortline/catalog.json');
const at=(day,clock='15:00:00')=>Date.parse(day+'T'+clock+'+08:00');
const arrays=['market','marketHistory','checks','plans','trades','explanations','candidates','versions','notes','bars','corrections','checkins'];
// Explicit unit-test observations; they are never persisted outside a temporary
// owner-only archive or exposed as production performance.
async function feedbackFixture(){
  const {dictionaryVersion}=await import('../../public/nova/shortline/factor-dictionary.mjs');
  const days=[];
  for(let offset=0;days.length<104;offset++){
    const date=new Date(Date.UTC(2024,0,2+offset));
    if(![0,6].includes(date.getUTCDay()))days.push(date.toISOString().slice(0,10));
  }
  const state={scope:'live',revision:1,schemaVersion:1,researchOnly:true,canTrade:false,canNotify:false,
    ...Object.fromEntries(arrays.map(key=>[key,[]])),catalog,dictionaryVersion};
  state.versions.push({number:1,approvedAt:'2023-12-01T00:00:00Z',weights:{'TL-01':1,'ZJ-01':.5,'上涨特征':2,'下跌特征':-2}});
  for(let i=0;i<days.length;i++)for(let j=0;j<5;j++){
    const day=days[i],code=String(600000+j),close=(10+j)*(1+(j-2)/1000)**i;
    for(const source of ['eastmoney','baostock'])state.bars.push({date:day,code,source,adjustment:'hfq',observedAt:at(day),knownAt:at(day)+1000,
      currency:'CNY',volumeUnit:'shares',amountUnit:'CNY',open:close,high:close*1.01,low:close*.99,close:source==='baostock'?close*1.00001:close,
      volume:100000,amount:close*100000,suspended:false,sampleSet:'real'});
    if(i===days.length-1)continue;
    const id='check-'+i+'-'+j;
    state.checks.push({id,code,date:day,asOf:day+' 15:05',createdAt:new Date(at(day,'15:05:00')).toISOString(),
      market:{systemicSelloff:false},emotion:{stage:'修复'},matches:['趋势突破'],factorCodes:['TL-01','ZJ-01'],
      factorObservations:Object.fromEntries([['TL-01',j*10],['ZJ-01',j*20+3]].map(([factorCode,value])=>[factorCode,
        {factorCode,symbol:code,tradeDate:day,knownAt:at(day,'15:02:00'),source:'eastmoney',value,unit:'score',sampleSet:'real'}]))});
    if(i>=days.length-2)continue;
    const entry=days[i+1],exit=days[i+2],planId='plan-'+i+'-'+j;
    state.plans.push({id:planId,code,frozenAt:new Date(at(day,'15:06:00')).toISOString()});
    state.trades.push({id:'trade-'+i+'-'+j,code,planId,checkId:id,date:entry,entryTime:entry+'T09:32',exitTime:exit+'T11:00',exitDate:exit,
      createdAt:new Date(at(exit,'11:01:00')).toISOString(),entryPrice:10,exitPrice:j>=3?10.3:9.8,shares:100,cost:0,position:5,
      strategy:'趋势突破',trend:'多头',factors:[j>=3?'上涨特征':'下跌特征'],snapshotVerified:true,repeatable:true,pnl:j>=3?3:-2});
  }
  const day=days.at(-1),now=at(day,'15:10:00'),calendar={days,source:'sse-calendar',knownAt:at(days[0],'08:00:00')};
  return {state,day,now,calendar};
}

module.exports={feedbackFixture};
