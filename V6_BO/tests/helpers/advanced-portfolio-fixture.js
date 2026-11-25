'use strict';
// Isolated deterministic test inputs. Reports must be computed by the original
// account/core consumer; these fixtures are never written into runtime storage.
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00'),priorDay='2026-11-24';
const close=d=>Date.parse(d+'T15:00:00+08:00');
const current=code=>({quote:{code,price:10,quoteAt:now-1000,receivedAt:now-500,quoteSource:'provider',canTrade:true},suspended:false,limitDown:false});
function historyFixture(codes=['600000','600001'],count=221){
 const last=Date.parse(priorDay),dates=Array.from({length:count},(_,i)=>new Date(last-(count-1-i)*86400000).toISOString().slice(0,10)),knownAt=close(priorDay)+3600000;
 const calendarDates=[...dates,day],nextEvidenceByDay=Object.fromEntries(calendarDates.slice(0,-1).map((d,i)=>[d,{nextTradingDay:calendarDates[i+1],knownAt,source:'explicit-test-calendar-receipt'}]));
 const bars=codes.flatMap((code,j)=>['eastmoney-public-history','baostock'].flatMap(source=>dates.map((date,i)=>{
  const price=10+i*.003+Math.sin(i/(j+2))*.1;
  return {code,date,day:date,market:'CN',adjustment:'hfq',source,currency:'CNY',volumeUnit:'shares',amountUnit:'CNY',open:price,high:price+.1,low:price-.1,close:price,volume:1000000,amount:10000000,suspended:false,knownAt,availableAt:knownAt+100,observedAt:knownAt,sourceTimestamp:null,periodEndAt:close(date),sourceDate:date,observationKind:'historical-daily-bar',captureProtocol:'center-hfq-history-v1',rawHash:hash([code,source]),rawRowHash:hash([code,date,source,price]),archiveHash:hash(['original-archive',code]),archiveSequence:1,firstKnownBasis:'actual-provider-receipt',sampleSet:'real',researchOnly:true,canTrade:false};
 })));
 return {bars,marketCalendars:{CN:{days:calendarDates,source:'explicit-test-calendar-receipt',knownAt,nextEvidenceByDay,conflictingDays:[]}}};
}
function fixtures(){
 const book={schemaVersion:1,revision:3,initialCash:10000,paperOnly:true,brokerConnected:false,fingerprint:hash('original-validated-book'),feePolicy:{version:'original-fees-v1',feeBps:3,minFee:5,sellTaxBps:5},legacy:{enabled:true},account:{cash:10000,events:[],eventHashes:{},positions:{'600000':{quantity:1000,lots:[{quantity:1000,buyDate:priorDay,price:10,fee:0,cost:10000,sourceEventId:'opening-600000'}]}}},orders:{}};
 const id='plan-00000000-0000-4000-8000-000000000001',decisionId=hash('original-decision');
 const plan={id,code:'600001',sampleSet:'real',strategy:'作战台条件计划',intendedDate:day,decisionAuthority:'fayo-decision-center',decisionId,frozenAt:new Date(now-2000).toISOString(),entryMin:9,entryMax:11,stop:8,target:12,maxPosition:50};
 plan.decisionEvidence={authority:'fayo-decision-center',decisionId,code:plan.code,day,plan:{buyLow:9,buyHigh:11,stop:8,target:12,positionPct:50}};
 const quotes={'600000':current('600000'),'600001':current('600001')};
 const receipt={allowed:true,planId:id,decisionId,maxPositionPct:50,scope:'original-paper-account-observation',checkedAt:now-1000,quoteAt:quotes[plan.code].quote.quoteAt,quotePrice:10,quoteSource:'provider',accountRevision:book.revision,accountFingerprint:book.fingerprint,quantity:900,fee:5,reason:'original checked receipt'};
 const input={account:'pool',day,now,marketOpen:true,continuous:true,quotes,portfolioContextStatus:'bounded',portfolioContext:{history:historyFixture(),plans:{pool:[plan],pre:[]},planChecks:{pool:{[id]:receipt}},classifications:{'600000':{industry:'bank',theme:'income',source:'original-classification',dataVersion:'v1',knownAt:now-10000},'600001':{industry:'industry',theme:'growth',source:'original-classification',dataVersion:'v1',knownAt:now-10000}}}};
 return {book,plan,receipt,input};
}


function withEquityEvidence(fixture=fixtures()){
 const {book,input}=fixture,initialAt=close(priorDay)-70*86400000,finalEquity=20000,externalFlow=2000;
 const returns=Array.from({length:70},(_,i)=>i%2?.004:-.002),growth=xs=>xs.reduce((p,r)=>p*(1+r),1);
 const initialEquity=(finalEquity-externalFlow*growth(returns.slice(30)))/growth(returns),rows=[],edges={};
 let equity=initialEquity,previous=new Date(initialAt+28800000).toISOString().slice(0,10);
 for(let i=0;i<returns.length;i++){
  const at=initialAt+(i+1)*86400000,date=new Date(at+28800000).toISOString().slice(0,10),equityBeforeFlow=equity*(1+returns[i]),flow=i===29?externalFlow:0;
  equity=equityBeforeFlow+flow;rows.push({at,knownAt:at+1000,equityBeforeFlow,externalFlow:flow,equityAfterFlow:equity,evidenceRef:hash(['equity-boundary',i])});
  edges[previous]={nextTradingDay:date,source:'explicit-test-calendar-receipt',knownAt:now-1000};previous=date;
 }
 input.portfolioContext.equityEvidence={pool:{scope:'original-paper-account-equity-boundaries-v1',account:'pool',periodId:'original-period-0',accountRevision:book.revision,bookFingerprint:book.fingerprint,source:'isolated-equity-boundary-inputs',dataVersion:hash(rows),factorVersion:'test-original-equity-v1',knownAt:now-1000,initialAt,initialEquity,initialEvidenceRef:hash(['opening-equity',initialAt]),rows,benchmark:{source:'isolated-benchmark-inputs',dataVersion:'v1',knownAt:now-1000,initialAt,finalAt:rows.at(-1).at,initialValue:100,finalValue:106},dailyEvidence:{source:'isolated-equity-boundary-inputs',dataVersion:hash(rows),knownAt:now-1000,riskFreeAnnual:0,riskFreeBasis:'explicit-zero-assumption',calendar:{source:'explicit-test-calendar-receipt',knownAt:now-1000,nextEvidenceByDay:edges}}}};
 return fixture;
}
module.exports={fixtures,withEquityEvidence,historyFixture,current,hash,day,now,priorDay,close};
