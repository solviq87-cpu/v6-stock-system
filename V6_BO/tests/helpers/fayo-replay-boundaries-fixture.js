'use strict';
// Isolated synthetic inputs for the existing archive readers, never live data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const S=require('../../src/core/research-workspace-store'),D=require('../../src/core/research-workspace-decision');
const J=require('../../src/core/news-evidence-journal'),{createPaperExecutionReportStore}=require('../../src/core/paper-execution-report-store');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../../src/core/paper-decision-plan');
const {observePaperPlans}=require('../../src/core/paper-plan-observer'),{createAutomaticInputProvenance}=require('../../src/core/paper-input-provenance');
const {fixture,at,dates}=require('./research-workspace-fixtures');
const close=d=>Date.parse(d+'T15:00:00+08:00');
function linkedInput(index,{benchmark='000001',method='fixture-v1',basis='price'}={}){
 const tradeDate=dates[index],start=close(dates[index-1]),end=close(tradeDate),knownAt=at(index),provider='tencent',symbol='600000';
 return {provider,symbol,tradeDate,knownAt,window:{start,end},returnBasis:basis,
  benchmark:{provider,code:benchmark,name:benchmark,methodologyVersion:method,return:.01,startValue:3000,knownAt},
  classification:{provider,version:'fixture-v1',knownAt:start,effectiveAt:start},methodology:{noCorporateActions:true,completeConstituents:false},
  boards:[{code:'BK0001',name:'隔离测试板块',category:'industry',members:[symbol],membersKnownAt:start,membersEffectiveAt:start,return:.02,knownAt}],stocks:[{symbol,return:.03,knownAt}]};
}
function createReplayFixture(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-replay-boundaries-')),day=dates[70],stamp=time=>Date.parse(day+'T'+time+'+08:00');
 const roots={root:path.join(base,'workspace'),newsRoot:path.join(base,'news'),manualRoot:path.join(base,'manual'),shortlineRoot:path.join(base,'shortline'),signalRoot:path.join(base,'signals')};
 const runs=[68,69,70].map(index=>S.appendEvent(roots.root,'analysis',D.buildWorkspaceDecision(fixture({index}),{marketLinkageEvidence:linkedInput(index,{benchmark:index===68?'000001':'399001'})}),{now:at(index),requestId:'replay_boundary_analysis_'+index}));
 const card=(code='600000')=>({authority:'fayo-decision-center',decisionId:S.digest(code),code,name:'隔离测试计划',day,calculatedAt:stamp('09:19:40'),strategyAt:stamp('09:19:00'),quoteBasis:{source:'tencent',quoteAt:stamp('09:19:39')},plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}});
 const makePlan=(code,id)=>{const c=card(code);return bindAuthoritativePlan({id,sampleSet:'real',frozenAt:new Date(stamp('09:20:00')).toISOString(),...decisionPlanPayload(c)},c);};
 const plan=makePlan('600000','plan-00000000-0000-4000-8000-000000000001'),other=makePlan('600001','plan-00000000-0000-4000-8000-000000000002');
 const entry={eventId:'isolated-original-buy',orderId:'isolated-order',side:'buy',symbol:'600000',quantity:200,tradeDate:day,timestamp:stamp('09:35:00'),price:10,reason:'作战台计划['+plan.id+'] 原账户风控'};
 const book=entered=>({revision:1,legacy:{enabled:true},feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},account:{cash:10000,events:entered?[entry]:[],positions:entered?{'600000':{quantity:200,lots:[{quantity:200,buyDate:day,sellableDate:null,sourceEventId:entry.eventId}]}}:{}},orders:{}});
 const quoteAt=stamp('14:00:00'),source={code:'600000',name:'隔离报价',price:9.3,preClose:10,volume:100000,quoteSource:'tencent',quoteMode:'public-live-unverified',quoteAt,receivedAt:quoteAt,canTrade:true,suspended:false,tradable:true};
 const quote={symbol:'600000',price:9.3,quoteSource:'tencent',provider:'tencent',quoteAt,timestamp:quoteAt,receivedAt:quoteAt,tradeDate:day,mode:'public-live-unverified',volumeUnit:'shares',volume:10000000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true,
  inputProvenance:createAutomaticInputProvenance({stock:source,observation:source,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
 const observed=observePaperPlans({plans:[plan],book:book(true),quotes:{'600000':quote},day,now:quoteAt,calendar:{isOpen:d=>d===day},continuous:true,
  entryEligibilityByPlan:{[plan.id]:{allowed:true,reason:'隔离原预检',checkedAt:quoteAt,quoteAt}},exitEligibilityByPlan:{[plan.id]:{allowed:false,reason:'原T+1门禁',checkedAt:quoteAt,quoteAt}}});
 if(observed.rejected.length)throw Error('isolated quote fixture rejected');
 let clock=stamp('15:15:00');
 const reportRoot=path.join(roots.shortlineRoot,'execution-reports'),store=createPaperExecutionReportStore({root:reportRoot,clock:()=>clock,canWrite:()=>true});
 const save=(time,entered,plans)=>{clock=stamp(time);return store.save({day,now:clock,book:book(entered),plans,observations:entered&&plans.includes(plan)?observed.records:[],conditionalOrders:[],sources:{archiveRevision:1,observationRevision:0,conditionalRevision:0,ledgerReadAt:clock}});};
 const reports=[save('15:15:00',false,[plan]),save('15:30:00',true,[plan]),save('16:00:00',true,[plan,other]),save('17:00:00',true,[])];
 const arrays=['market','marketHistory','checks','plans','trades','explanations','candidates','versions','notes','bars','corrections','checkins'];
 const state={scope:'live',revision:1,schemaVersion:1,researchOnly:true,canTrade:false,canNotify:false,...Object.fromEntries(arrays.map(k=>[k,[]])),plans:[plan]};
 fs.writeFileSync(path.join(roots.shortlineRoot,'research.json'),JSON.stringify({digest:crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex'),state}),{mode:0o600});
 const raw={schemaVersion:1,source:'isolated-news',eventId:'late-event',sourceRevisionId:'edition-1',kind:'original',supersedes:null,url:'https://example.org/isolated',title:'隔离迟到新闻1亿元',body:'隔离测试原文；不是真实行情或公告。',bodyScope:'declared-body',securities:['600000'],publishedAt:at(69,'10:00'),receivedAt:stamp('13:59:00'),revisedAt:null};
 const first=J.appendBatch(roots.newsRoot,[raw],{now:stamp('14:00:00')}).results[0];
 const second=J.appendBatch(roots.newsRoot,[{...raw,sourceRevisionId:'edition-2',kind:'revised',supersedes:first.eventHash,title:'隔离新闻修订',receivedAt:stamp('14:59:00'),revisedAt:stamp('14:30:00')}],{now:stamp('15:00:00')}).results[0];
 const third=J.appendBatch(roots.newsRoot,[{...raw,sourceRevisionId:'edition-3',kind:'retracted',supersedes:second.eventHash,title:'隔离新闻撤稿',receivedAt:stamp('16:59:00'),revisedAt:stamp('16:55:00')}],{now:stamp('17:00:00')}).results[0];
 J.appendBatch(roots.newsRoot,Array.from({length:52},(_,i)=>({...raw,eventId:'page-event-'+i,sourceRevisionId:'original',title:'隔离分页新闻 '+i,publishedAt:i===0?null:stamp('17:05:00'),receivedAt:stamp('17:09:00')})),{now:stamp('17:10:00')});
 return {base,roots,day,stamp,runs,plan,entry,reports,reportRoot,news:[first,second,third],asOf:stamp('17:30:00.123'),cleanup:()=>fs.rmSync(base,{recursive:true,force:true})};
}
module.exports={createReplayFixture,linkedInput};
