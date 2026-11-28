'use strict';
// Synthetic receipts only: exercise original production consumers and ledger.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Q=require('../src/core/stock-observation-queue'),D=require('../src/core/deep-research-evidence'),E=require('../src/strategy/research36');
const now=Date.parse('2026-11-27T15:00:00+08:00'),symbol='600000',digest=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
const temp=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-native-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const capture=()=>({status:'captured',observation:{revision:1,observationHash:'a'.repeat(64)},history:{provider:'declared',rawHash:'b'.repeat(64)}});
function intent(t,type='news-evidence-revision',id='c'.repeat(64),extra={}){return {symbol,decisionAt:t,trigger:'push-attempt',signalRefs:[{code:symbol,type,id,ts:now-100}],...extra};}
test('F14.3 original persistent queue deduplicates stable original revisions, never different revisions or unrelated producer IDs',t=>{
 const root=temp(t);let clock=now;t.mock.method(Date,'now',()=>clock);
 const first=Q.enqueueStockObservation(root,intent(clock));clock+=1000;
 const retry=Q.enqueueStockObservation(root,intent(clock,'news-evidence-revision','c'.repeat(64),{messageHash:'d'.repeat(64)}));assert.equal(retry.id,first.id);assert.equal(retry.reuseBasis,'stable-producer-references');
 assert.notEqual(Q.enqueueStockObservation(root,intent(clock,'news-evidence-revision','e'.repeat(64))).id,first.id);
 Q.enqueueStockObservation(root,intent(clock,'涨停'));const bad=intent(clock,'unknown');Q.enqueueStockObservation(root,bad);clock+=1;Q.enqueueStockObservation(root,{...bad,decisionAt:clock});
 const v=Q.readStockObservationQueue(root,{now:clock});assert.equal(v.counts.total,5);assert.equal(v.pending.filter(r=>r.triggerEvidence.kind==='news').length,2);assert.equal(v.pending.filter(r=>r.triggerEvidence.kind==='market').length,1);assert.equal(v.pending.filter(r=>r.triggerEvidence.kind==='unknown').length,2);assert.equal(v.exactlyOnce,false);assert.equal(v.canNotify,false);
});
test('F14.3 real queue consumer and restart preserve pending versus future attempts at the original cutoff',async t=>{
 const root=temp(t);let clock=now;t.mock.method(Date,'now',()=>clock);const first=Q.enqueueStockObservation(root,intent(clock));clock+=1000;
 await Q.processStockObservationQueue(root,{capture:async()=>{clock+=500;return capture()},now:()=>clock});
 const old=Q.readStockObservationQueue(root,{now:now+999});assert.equal(old.counts.pending,1);assert.equal(old.counts.attempts,0);assert.equal(old.lastSuccess,null);assert.equal(old.pending[0].id,first.id);
 const current=Q.readStockObservationQueue(root,{now:clock});assert.equal(current.counts.completed,1);assert.equal(current.counts.attempts,1);assert.equal(current.lastSuccess.result.observation.revision,1);assert.ok(current.bytes>old.bytes);
 clock+=1000;Q.enqueueStockObservation(root,intent(clock,'涨停'));assert.equal(Q.readStockObservationQueue(root,{now:now+2000}).counts.total,1);assert.equal(Q.readStockObservationQueue(root,{now:now-1}).counts.total,0);
});
const date=i=>new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),at=(d,h='15:00:00')=>Date.parse(d+'T'+h+'+08:00');
const days=Array.from({length:140},(_,i)=>date(i)),dates=days.filter(d=>![0,6].includes(new Date(d).getUTCDay())),published=at(dates[20],'10:00:00'),recorded=published+2000,asOf=at(dates[90])+10000;
const proof=(id,t,extra={})=>({id,source:'issuer-public',sourceUrl:'https://example.org/disclosure/'+id,revision:1,publishedAt:t,firstKnownAt:t,recordedAt:t,symbol,...extra});
const event=()=>proof('financial-event',published,{eventType:'earnings',firstKnownAt:recorded,recordedAt:recorded,title:'财报披露'});
const actual=()=>proof('actual',published,{announcementAt:published,firstKnownAt:recorded,recordedAt:recorded,value:120,period:'2026Q3',metric:'净利润',unit:'万元',higherIsBetter:true,eventRef:{source:'issuer-public',id:'financial-event',revision:1}});
function financialInput(){
 const calendar={schemaVersion:1,exchange:'SSE',source:'declared-calendar',from:days[0],to:days.at(-1),sessions:days.map(d=>({date:d,open:dates.includes(d)}))};
 const eventCalendar={status:'available',calendar,tradeDates:dates,metadata:{source:calendar.source,sha256:digest(calendar),knowledgeAvailableAt:new Date(at(dates[0])).toISOString(),supportedExchanges:['SSE']}};
 const bars=dates.map(d=>({role:'stock',code:symbol,date:d,period:'日K',priceBasis:'unadjusted',source:'stock-provider',knownAt:at(d)+1000,open:100,high:112,low:99,close:110,corporateAction:false,suspended:false}));
 const market=dates.map(d=>({indexEvidence:{name:'中证全指',source:'index-provider',receivedAt:at(d)+1000,rows:[{date:d,open:100,close:101,knownAt:at(d)+1000}]}}));
 return {events:[event()],actuals:[actual()],eventCalendar,archive:{bars,market}};
}
test('F09.5 original deep report binds first disclosure to mature 20/60-session original archive outcomes',()=>{
 const input=financialInput(),f=actual(),revised={...f,revision:2,publishedAt:published+86400000,firstKnownAt:published+86400000,recordedAt:published+86400000,value:80};input.actuals.push(revised);
 const r=D.buildDeepResearchEvidence(input,{asOf}),row=r.modules[68].rows[0];assert.equal(row.actual,80);assert.equal(row.firstDisclosure.first.value,120);assert.equal(row.firstDisclosure.restated,true);assert.equal(row.firstDisclosure.first.revision,1);assert.equal(row.firstDisclosure.firstEvent.id,'financial-event');assert.deepEqual(row.firstDisclosure.mediumTerm.map(x=>x.horizonSessions),[20,60]);assert.equal(row.firstDisclosure.mediumTerm[0].stockReturnPct,10);assert.equal(row.firstDisclosure.mediumTerm[0].excessReturnPct,9);assert.equal(row.firstDisclosure.actualExecutionVerified,false);assert.equal(r.canTrade,false);
});
test('F09.5 missing first revision, late link, restated event and forged imported outcomes cannot backfill first disclosure',()=>{
 for(const mutate of [i=>{i.actuals[0].revision=2},i=>{i.actuals[0].eventRef.id='unrelated'},i=>{i.events.push({...event(),revision:2,recordedAt:recorded+1000,firstKnownAt:recorded+1000})},i=>{i.events[0].recordedAt=recorded+10000},i=>{i.archive.bars=[];i.eventOutcomes=[proof('fake-outcome',asOf,{eventSource:'issuer-public',eventId:'financial-event',eventRevision:1,horizonSessions:20,startAt:at(dates[21],'09:30:00'),endAt:at(dates[40]),stock:{currency:'CNY',priceBasis:'unadjusted',corporateAction:false,source:'stock-provider',startPrice:100,endPrice:500}})]}]){const i=financialInput();mutate(i);const v=D.buildDeepResearchEvidence(i,{asOf}).modules[68].rows[0].firstDisclosure;assert.equal(v.mediumTerm.length,0);assert.equal(v.canTrade,false);}
});
test('F09.4/F18.2 original event report separates signed operating order, same-industry prices and missing event-free controls',()=>{
 const i=financialInput(),t=published-10000,relation=proof('business',t,{source:'company-doc',from:symbol,to:'product:alpha',productId:'alpha',stage:'downstream',relation:'customer',relationClass:'business',bodyScope:'declared-body',documentText:'主营产品甲。已签订产品甲合同。',businessClause:'主营产品甲',validFrom:t-1000,industryFacts:{order:{status:'signed',confirmedAt:t,clause:'已签订产品甲合同'}}});i.relations=[relation];
 const members=[symbol,'600001','600002','600003','600004','600005'],previous=dates[14],start=at(dates[13]),end=at(previous),known=end+1000;
 i.workspaceEvents=[{kind:'analysis',hash:'f'.repeat(64),sequence:1,recordedAt:known+1000,data:{symbol,provider:'eastmoney',tradeDate:previous,asOf:known,priceBasis:'unadjusted',context:{marketLinkageEvidence:{provider:'eastmoney',symbol,tradeDate:previous,knownAt:known,window:{start,end},returnBasis:'price',benchmark:{provider:'eastmoney',code:'000985',name:'全A',return:.01,knownAt:known},classification:{provider:'eastmoney',version:'v1',knownAt:start,effectiveAt:start},methodology:{noCorporateActions:true},boards:[{code:'A',name:'行业甲',category:'industry',members,membersKnownAt:start,membersEffectiveAt:start,return:.01,knownAt:known}],stocks:members.map(symbol=>({symbol,return:.01,knownAt:known}))}}}}];
 i.archive.bars.push(...members.slice(1).flatMap(code=>i.archive.bars.filter(b=>b.code===symbol).map(b=>({...b,code,close:102}))));
 let r=D.buildDeepResearchEvidence(i,{asOf}).modules[67].businessResearch.rows[0];assert.equal(r.operatingOrders.length,1);assert.equal(r.operatingOrders[0].order.realizedRevenue,null);assert.equal(r.noEventMatchedControl,null);assert.equal(r.screenAssociation,null);assert.equal(r.currentCandidateCertified,false);assert.equal(r.priceLeadership.find(x=>x.horizonSessions===5).relativePriceLeading,true);
 i.archive.bars.filter(b=>b.code===symbol&&b.date>=dates[21]).forEach(b=>b.close=100);r=D.buildDeepResearchEvidence(i,{asOf}).modules[67].businessResearch.rows[0];assert.equal(r.operatingOrders.length,1);assert.equal(r.priceLeadership.find(x=>x.horizonSessions===5).relativePriceLeading,false);
 i.relations[0].recordedAt=recorded+10000;assert.equal(D.buildDeepResearchEvidence(i,{asOf}).modules[67].businessResearch.rows.length,0);
});
test('F09 native comparison calls original position ledger with no-fill, cost stress and original RSV evidence',()=>{
 const bars=Array.from({length:62},(_,i)=>{const d=date(i),t=at(d),close=10+i*.02;return {date:d,open:close,high:close+.1,low:close-.1,close,volume:1000000,source:'declared-daily',priceBasis:'unadjusted',final:true,observedAt:t,availableAt:t,recordedAt:t,isST:false,suspended:false,tradable:true}});
 const evidenceByDate=Object.fromEntries(bars.map(b=>[b.date,{[symbol]:Object.fromEntries(['ma5Over10','ma10Over20','closeOver20'].map(k=>[k,{value:1.1,unit:'ratio',code:symbol,source:'declared-provider',evidenceId:'sample',observedAt:b.availableAt,availableAt:b.availableAt,recordedAt:b.availableAt}]))}]));
 const r=E.compareResearch36({strategyIds:['ma_trend','sector_resonance','quality:rsv14_reversal_confirmation'],stocks:[{symbol,market:'main',bars}],evidenceByDate,options:{start:45,end:56,topN:1,holdDays:1,tradingDates:bars.map(b=>b.date)}});
 assert.equal(r.status,'descriptive-only');assert.equal(r.rows.length,6);const base=r.rows[0],stress=r.rows[3];assert.ok(base.report.trades.every(t=>t.sellDay>t.buyDay));assert.ok(stress.summary.markedReturnPct<base.summary.markedReturnPct);assert.equal(r.rows[1].summary.markedReturnPct,null);assert.equal(r.rows[2].report.research36.nativeRule,'quality-volume-reversal-research/rsv14_reversal_confirmation');assert.equal(r.canTrade,false);
});
test('F11.3 original global trial budget counts failed inspected trials across model packs and rejects holdout reuse',()=>{
 const {assessGlobalTrialBudget}=require('../src/core/factor-global-trial-budget'),days=dates.slice(0,90),pack='a'.repeat(64);
 const reports=Array.from({length:6},(_,i)=>({mode:'v6-factor-shadow-evolution-v1',packFingerprint:i%2?pack:'b'.repeat(64),fingerprint:digest(i),status:'shadow-retained',lastObservationDay:days[40+i*5+4],trialAudit:{schemaVersion:1,status:'consumed',firstHoldoutDay:days[40+i*5],lastHoldoutDay:days[40+i*5+4],holdoutDays:5,candidateFingerprint:digest(['candidate',i])},canTrade:false,productionWeightsChanged:false}));
 const r=assessGlobalTrialBudget(reports,days,pack);assert.equal(r.status,'budget-exhausted');assert.equal(r.usedTrials,6);assert.equal(r.remainingTrials,0);assert.equal(r.canTrade,false);
 assert.throws(()=>assessGlobalTrialBudget([...reports,{...reports[0],fingerprint:'f'.repeat(64)}],days,pack),/复用/);
});
async function noticeFixture(t){
 const root=temp(t),dir=path.join(root,'book'),api=await import('../src/research/shortline/web-notices.mjs'),{settingsAt}=await import('../public/nova/shortline/settings.mjs');
 const stamp=Date.parse('2026-11-27T16:00:00+08:00');let clock=stamp;t.mock.method(Date,'now',()=>clock);
 const state={scope:'live',settingsHistory:[{version:1,effectiveAt:new Date(stamp-1000).toISOString(),config:{...settingsAt({}),dailyReviewTime:'15:30'}}],catalog:[],trades:[],plans:[],checks:[],candidates:[],versions:[],market:[],signals:[],marketHistory:[]};
 const endpoint='https://fcm.googleapis.com/fcm/send/abcdefghijk',device=action=>api.noticeDeviceAction({root,dir,book:'main',action,payload:{endpoint},replica:false});device('notice:subscribe');
 const tick=extra=>api.tickWebNotices({root,dir,book:'main',state,day:'2026-11-27',tradingDay:true,primary:true,now:stamp,...extra});
 return {api,root,dir,stamp,state,device,tick,view:()=>api.noticeView({dir,state,book:'main'}),advance:ms=>{clock+=ms;}};
}
test('F14.5 original notice ledger persists gateway acceptance without falsely certifying device receipt or reading',async t=>{
 const f=await noticeFixture(t);let calls=0;const result=await f.tick({sendPush:async()=>{calls++;f.advance(50);return {status:201}}});assert.equal(calls,1);assert.equal(result.sent,1);const v=f.view(),r=v.deliveryEvidence[0];assert.equal(r.gatewayStatus,'accepted');assert.equal(r.gatewayStatusCode,201);assert.equal(r.recordedAt,f.stamp+50);assert.equal(r.receiverConfirmed,false);assert.equal(r.readConfirmed,false);assert.ok(!JSON.stringify(v).includes('fcm.googleapis.com'));
 await f.tick({sendPush:async()=>{calls++;return 201}});assert.equal(calls,1);
});
test('F14.4/F14.5 original device revocation during dispatch does not restore the device or receipt; stale primary cannot dispatch',async t=>{
 const f=await noticeFixture(t);let calls=0;await f.tick({isPrimary:()=>false,sendPush:async()=>{calls++;return 201}});assert.equal(calls,0);
 const result=await f.tick({sendPush:async()=>{calls++;f.device('notice:unsubscribe');return 201}});assert.equal(result.sent,0);assert.equal(f.view().devices,0);assert.deepEqual(f.view().deliveryEvidence,[]);
 await f.tick({sendPush:async()=>{calls++;return 201}});assert.equal(calls,1);
});
test('F14.5 gateway timeout is unknown and retry is not a device delivery claim',async t=>{
 const f=await noticeFixture(t);await f.tick({sendPush:async()=>{throw Error('timeout')}});const r=f.view().deliveryEvidence[0];assert.equal(r.gatewayStatus,'unknown');assert.equal(r.gatewayStatusCode,null);assert.equal(r.receiverConfirmed,false);assert.equal(r.readConfirmed,false);
});
test('F12.5 original model approval refuses failed validation without writing versions',async()=>{
 const {learningAction}=await import('../public/nova/shortline/learning.mjs');const state={scope:'live',versions:[],candidates:[{id:'not-approved',status:'待人工审批',steps:[{name:'数据',status:'失败'}]}]};const before=structuredClone(state);assert.throws(()=>learningAction(state,'learn:decision',{id:'not-approved',decision:'approve',reviewer:'operator',reason:'review'}),/五项验证/);assert.deepEqual(state,before);
});
