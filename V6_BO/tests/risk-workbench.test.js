'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {buildAccountEquityEvidence,buildEquityHistory}=require('../src/core/account-equity-evidence');
const {buildPortfolioStressEvidence}=require('../src/core/portfolio-stress-evidence');
const {buildEffectiveRiskEvidence}=require('../src/core/effective-risk-evidence');
const {buildRiskActionEvidence}=require('../src/core/risk-action-evidence');
const {buildRiskWorkbench,filterRiskWorkbench,planRootCause}=require('../src/core/risk-workbench');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const {observePaperPlans}=require('../src/core/paper-plan-observer');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');

const entryDay='2026-11-23',day='2026-11-24',code='600000';
const at=(date,value='10:00:00')=>Date.parse(date+'T'+value+'+08:00');
const calendar={isOpen:date=>[entryDay,day].includes(date)};
const planId='plan-00000000-0000-4000-8000-000000000031';
function linked(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-risk-workbench-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let now=at(entryDay);
  const file=path.join(root,'authority.json'),service=createPaperApplicationService({file,clock:()=>now,calendar});
  const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code,day:entryDay,name:'隔离账户样本',
    calculatedAt:now-30000,strategyAt:now-40000,quoteBasis:{source:'tencent',quoteAt:now-31000},
    plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
  const plan=bindAuthoritativePlan({id:planId,sampleSet:'real',frozenAt:new Date(now-20000).toISOString(),...decisionPlanPayload(card)},card);
  function quote(price=9.3,quoteAt=now,symbol=code) {
    const raw={code:symbol,name:'隔离账户样本',price,preClose:10,volume:100000,quoteSource:'tencent',quoteMode:'public-live-unverified',
      quoteAt,receivedAt:quoteAt,canTrade:true,suspended:false,tradable:true};
    return {symbol,price,quoteSource:'tencent',provider:'tencent',quoteAt,timestamp:quoteAt,receivedAt:quoteAt,
      tradeDate:aShareCalendarDate(quoteAt),mode:'public-live-unverified',canTrade:true,volumeUnit:'shares',volume:raw.volume*100,
      upperLimit:11,lowerLimit:9,suspended:false,tradable:true,
      inputProvenance:createAutomaticInputProvenance({stock:raw,observation:raw,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
  }
  const initial={initial:100000,enabled:true,cash:100000,realized:0,positions:{},trades:[]};
  const opening=service.adoptLegacy(initial);
  const trade={t:now,side:'买入',code,name:'隔离账户样本',price:10,shares:200,amount:2000,fee:5,basis:2005,pnl:null,reason:'作战台计划['+plan.id+'] '+code+' · 原账户风控'};
  service.saveLegacy({...initial,cash:97995,positions:{[code]:{code,name:'隔离账户样本',shares:200,buyPrice:10,buyTs:now,basis:2005}},trades:[trade]},
    opening.revision,{quotes:{[code]:quote(10)}});
  now=at(day);
  function actions(quotes={[code]:quote()},extra={}) {
    return buildRiskActionEvidence({book:service.read(),plans:[plan],quotes,now,calendar,continuous:true,
      originalExitChecks:{[planId]:{allowed:true,reason:'原退出检查已核对',checkedAt:now,quoteAt:quotes[code]?.quoteAt}},...extra});
  }
  function inputs(extra={}) {
    const book=service.read(),quotes=extra.quotes || {[code]:quote()};
    const equity=buildAccountEquityEvidence({book,accountId:'pool',quotes,now});
    const history=buildEquityHistory({observations:[equity],accountId:'pool',accountEpoch:equity.accountEpoch,now});
    const rules=buildEffectiveRiskEvidence({book,accountId:'pool',quotes,now,calendar,
      automaticPolicy:{version:'original-fixed-research',enabled:true,parameters:{maxPos:5,sl:.05,tp:.1}}});
    const stress=buildPortfolioStressEvidence({equity,now,classifications:[{symbol:code,themes:['AI'],source:'dabanke',
      sourceRecordId:'isolated-day',version:'isolated-classification-v1',day,knownAt:now-5000}]});
    return {accountId:'pool',now,equity,equityHistory:{accountId:'pool',accountEpoch:equity.accountEpoch,history},
      rules,actions:actions(quotes),stress,system:{missing:[]},...extra};
  }
  function sell(quantity,price=9.3,volume=quantity*100) {
    const book=service.read();
    if (!book.orders.exit)service.submit({orderId:'exit',symbol:code,side:'sell',quantity:200,limitPrice:price,tradeDate:day});
    return service.fill('exit','exit-fill-'+service.read().account.events.length,{symbol:code,source:'simulated',provider:'isolated-trade',
      tradeDate:day,timestamp:now,price,volumeUnit:'shares',volume,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
  }
  function observed(quotes={[code]:quote()},observedAt=now) {
    return observePaperPlans({plans:[plan],book:service.read(),quotes,day,now:observedAt,calendar,continuous:true,
      exitEligibilityByPlan:{[planId]:{allowed:true,reason:'原退出检查',checkedAt:observedAt,quoteAt:quotes[code]?.quoteAt}}});
  }
  return {root,file,service,plan,quote,actions,inputs,sell,observed,get now(){return now;},setNow(value){now=value;}};
}
const risk=(report,root)=>report.risks.find(row=>row.rootCauseId===root);

test('missing inputs remain unknown and all seven risk domains use the same evidence contract',()=>{
  const report=buildRiskWorkbench({accountId:'pool',now:at(day)});
  assert.equal(report.summary.status,'incomplete-evidence');assert.ok(report.summary.unknown>0);
  assert.deepEqual(report.summary.categories.map(row=>row.id),['data','market','stock','portfolio','strategy','execution','system']);
  assert.equal(risk(report,'account/valuation').status,'unknown');assert.equal(report.canTrade,false);assert.equal(report.writesAccount,false);
  for (const row of report.risks) {
    for (const key of ['object','facts','source','sourceAt','impact','restrictions','checks','releaseConditions','status','followUp','severity','evidenceStatus','executionStatus'])
      assert.ok(Object.hasOwn(row,key),key);
    assert.ok(row.facts.length);assert.ok(row.checks.length);assert.ok(row.releaseConditions.length);assert.equal(row.canTrade,false);
  }
});

test('real authority, effective pending exposure and execution constraints are composed without changing the ledger',t=>{
  const f=linked(t);
  f.service.submit({orderId:'new-pending',symbol:'600001',side:'buy',quantity:100,limitPrice:10,tradeDate:day});
  f.service.configure({expectedRevision:f.service.read().revision,riskPolicy:{version:'limit-evidence-v1',maxPositionPct:1,maxGrossExposurePct:2}});
  const before=fs.readFileSync(f.file,'utf8'),input=f.inputs(),report=buildRiskWorkbench(input);
  assert.equal(report.rules.occupancy.pendingBuyValue,1000);assert.equal(report.equity.source.snapshotFingerprint,f.service.read().fingerprint);
  assert.equal(risk(report,'rule/maxPositionPct').status,'active');assert.equal(risk(report,'rule/maxGrossExposurePct').severity,'critical');
  assert.equal(risk(report,planRootCause(planId,'stop')).executionStatus,'allowed');
  assert.equal(report.actions.items[0].constraints.sellableQuantity,200);assert.equal(fs.readFileSync(f.file,'utf8'),before);
});

test('a risk card does not claim an unconfigured original rule is enabled',t=>{
  const f=linked(t),report=buildRiskWorkbench(f.inputs());
  for (const row of report.risks.filter(row=>row.rootCauseId.startsWith('rule/'))) {
    assert.equal(row.status,'unknown');assert.match(row.facts.join(' '),/未配置|未启用/);
    assert.doesNotMatch(row.facts.join(' '),/已启用，版本/);
  }
});

test('same-root price conflict is one actionable row retaining both source facts',t=>{
  const f=linked(t),report=buildRiskWorkbench(f.inputs({market:{conflicts:[{code,status:'source-conflict',quoteAt:f.now}]}}));
  const rows=report.risks.filter(row=>row.rootCauseId==='quote/'+code);assert.equal(rows.length,1);
  const row=rows[0];assert.equal(row.status,'active');assert.equal(row.evidenceStatus,'conflict');
  assert.ok(row.sources.some(s=>s.source==='tencent'));assert.ok(row.sources.some(s=>s.source==='原独立来源报价诊断'));
  assert.match(row.facts.join(' '),/持仓原始报价/);assert.match(row.facts.join(' '),/多源价格或时点核对/);
});

test('fully matched original exit resolves independently of any present quote or old trigger',t=>{
  const f=linked(t),observation=f.observed();f.sell(200);
  const report=buildRiskWorkbench(f.inputs({quotes:{},planAlerts:observation.alerts}));
  for (const kind of ['stop','target']) {
    const row=risk(report,planRootCause(planId,kind));assert.equal(row.status,'resolved');assert.equal(row.executionStatus,'filled');
    assert.equal(row.priceDependent,false);assert.equal(row.source,'原权威成交事件');assert.equal(row.sourceAt,f.now);
  }
  assert.equal(report.actions.items[0].continueObserving,false);assert.equal(report.actions.items[0].constraints.remainingQuantity,0);
});

test('partial exit retains plan, original order references and remaining holding observation',t=>{
  const f=linked(t);f.sell(100);const report=buildRiskWorkbench(f.inputs());
  const row=risk(report,planRootCause(planId,'stop'));
  assert.equal(row.executionStatus,'partially-filled');assert.equal(row.status,'active');assert.match(row.followUp,/剩余持仓/);
  assert.deepEqual(row.references.orderIds,['exit']);assert.equal(report.actions.items[0].constraints.remainingQuantity,100);
  assert.equal(report.actions.items[0].continueObserving,true);
});

test('an exit order and ledger mismatch stays pending reconciliation and cannot resolve the risk',t=>{
  const f=linked(t);
  f.service.submit({orderId:'exit',symbol:code,side:'sell',quantity:200,limitPrice:9.3,tradeDate:day});
  const book=f.service.read();book.orders.exit.state.filledQuantity=100;
  const actions=f.actions({[code]:f.quote()},{book}),report=buildRiskWorkbench(f.inputs({actions}));
  assert.equal(actions.items[0].status,'pending-reconciliation');
  const row=risk(report,planRootCause(planId,'stop'));
  assert.equal(row.status,'unknown');assert.notEqual(row.evidenceStatus,'available');
  assert.equal(row.executionStatus,'pending-reconciliation');
});

test('a newer same-plan observation supersedes an old trigger instead of reopening it',t=>{
  const f=linked(t),observation=f.observed();f.setNow(f.now+5000);
  const report=buildRiskWorkbench(f.inputs({quotes:{[code]:f.quote(10)},planAlerts:observation.alerts}));
  const row=risk(report,planRootCause(planId,'stop'));assert.equal(row.status,'resolved');
  assert.match(row.facts.join(' '),/未触发/);assert.doesNotMatch(row.facts.join(' '),/已观察到触及计划止损/);
});

test('stale price with retained historical trigger produces unknown and cannot derive a new liquidation',t=>{
  const f=linked(t),observation=f.observed(),old=f.quote();f.setNow(f.now+20000);
  const report=buildRiskWorkbench(f.inputs({quotes:{[code]:old},planAlerts:observation.alerts,
    actions:f.actions({[code]:old},{observations:observation.records})}));
  assert.equal(report.equity.equity,null);assert.equal(report.actions.items[0].condition.status,'unknown');
  assert.equal(risk(report,planRootCause(planId,'stop')).status,'unknown');
  assert.equal(report.actions.items[0].historicalTriggers.length,1);
  assert.match(risk(report,'account/valuation').restrictions.join(' '),/不得用陈旧估值推导自动清仓/);
});

test('same-time condition notification and action retain both original evidence references',t=>{
  const f=linked(t),observation=f.observed(),report=buildRiskWorkbench(f.inputs({planAlerts:observation.alerts}));
  const row=risk(report,planRootCause(planId,'stop')),all=row.evidenceReferences || [row.references];
  assert.ok(all.some(ref=>ref.observationId===observation.alerts[0].observationId));
  assert.ok(all.some(ref=>ref.planId===planId && Array.isArray(ref.orderIds)));
  assert.equal(report.risks.filter(r=>r.rootCauseId===row.rootCauseId).length,1);
});

test('strategy results preserve upstream meaning and provenance, while missing source remains unknown',t=>{
  const f=linked(t),strategy={status:'validated',riskStatus:'active',severity:'warning',source:'strategy-team',version:'decay-v1',
    knownAt:f.now-1000,conclusion:'独立样本显示近期收益衰减',sampleCount:85,reason:'已有收益衰减证据，禁止据此自动放宽阈值'};
  const report=buildRiskWorkbench(f.inputs({strategy}));assert.deepEqual(report.strategy,strategy);
  const row=risk(report,'strategy/research-evidence');assert.equal(row.evidenceStatus,'available');
  assert.equal(row.status,'active');assert.equal(row.severity,'warning');
  assert.match(row.facts.join(' '),/衰减/);assert.equal(row.source,'strategy-team');
  const unknown=buildRiskWorkbench(f.inputs({strategy:{...strategy,source:null}}));
  assert.equal(risk(unknown,'strategy/research-evidence').status,'unknown');
});

test('manual holdings stay visibly separate from authority and negative or missing research evidence is retained',t=>{
  const f=linked(t),research={manualHoldings:{status:'evaluated',positions:[{symbol:code,quantity:99900}]},
    supports:[{domain:'news',code:'RETRACTED_NEWS',message:'新闻发生撤稿',reference:'600001'}],
    contra:[{domain:'manual-holdings',code:'MANUAL_INPUTS_NOT_ACCOUNT_ATTESTATION',message:'申报资料未认证账户',reference:code}],
    missing:[{domain:'news',code:'UNKNOWN_NEWS_EVIDENCE',message:'缺少原始新闻时间',reference:code}]};
  const report=buildRiskWorkbench(f.inputs({research}));
  assert.equal(report.manualHoldings.accountAuthority,false);assert.match(report.manualHoldings.label,/非权威账户/);
  assert.equal(report.equity.positions[0].quantity,200);assert.equal(report.equity.manualHoldingsIncluded,false);
  assert.ok(report.risks.some(row=>row.object.type==='manual-security' && row.facts.includes('申报资料未认证账户')));
  assert.ok(report.risks.some(row=>row.facts.includes('缺少原始新闻时间')));
});

test('security filtering reuses backend rows and retains shared account risks without another calculation',t=>{
  const f=linked(t),report=buildRiskWorkbench(f.inputs({research:{supports:[{domain:'news',code:'RETRACTED_NEWS',message:'别股新闻',reference:'600001'}]}}));
  const filtered=filterRiskWorkbench(report,code);
  assert.equal(filtered.selectedCode,code);assert.ok(filtered.risks.some(r=>r.object.type==='account'));
  assert.equal(filtered.risks.some(r=>r.object.type==='security' && r.object.id==='600001'),false);
  assert.equal(filtered.risks.find(r=>r.rootCauseId==='quote/'+code),risk(report,'quote/'+code));
  assert.equal(filtered.equity,report.equity);assert.throws(()=>filterRiskWorkbench(report,'bad'),/代码/);
});

test('mixed account or reset epoch evidence cannot be relabeled as a different account',t=>{
  const f=linked(t),input=f.inputs();
  assert.throws(()=>buildRiskWorkbench({...input,accountId:'pre'}),/账户/);
  assert.throws(()=>buildRiskWorkbench({...input,equityHistory:{...input.equityHistory,accountEpoch:'f'.repeat(64)}}),/阶段|期间|epoch|账户/);
});
