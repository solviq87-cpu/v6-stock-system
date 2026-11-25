'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const catalog=require('../public/nova/shortline/catalog.json');
const numeric=require('../public/nova/shortline/numeric-factors');
const {prepareDecisionPlanResearch}=require('../src/core/decision-plan-research');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const modules=Promise.all([import('../public/nova/shortline/factor-dictionary.mjs'),import('../src/research/shortline/store.mjs')]);
const at=(day,time='15:00:00')=>Date.parse(day+'T'+time+'+08:00');
const chinaDay=clock=>new Date(clock+28800000).toISOString().slice(0,10);
const priorDay=day=>new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const arrays=['market','marketHistory','checks','plans','trades','explanations','candidates','versions','notes','bars','corrections','checkins'];

async function fixture({now=at('2026-11-25','10:00:00')}={}){
  const [{dictionaryVersion}]=await modules,day=chinaDay(now),previous=priorDay(day),code='600000';
  const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),day,code,calculatedAt:now-2000,strategyAt:now-10000,
    quoteBasis:{source:'tencent',quoteAt:now-3000,receivedAt:now-2500,price:10},strategyBasis:{day,score:88,quoteAt:now-10000},
    plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:19.6}};
  const makeCheck=(id,signalDay,clock='15:05:00',pass=true)=>{
    const cutoff=at(signalDay,clock),facts=new Map();
    for(let i=0;i<5;i++)facts.set('14:'+i,{pass,source:'已归档竞价逐条件证据 '+(i+1)});
    return {id,code,date:signalDay,name:'单元测试的真实结构观察',sampleSet:'real',method:'行情自动识别',
      asOf:new Date(cutoff+28800000).toISOString().slice(0,16).replace('T',' '),createdAt:new Date(cutoff+5000).toISOString(),
      factors:[],factorCodes:[],factorObservations:{},matches:[],risks:[],recognition:{candidates:[],
        ruleObservations:numeric.buildRulePanel({catalog,facts,code,day:signalDay,cutoff:cutoff+1234,dictionaryVersion,
          inputs:[{code,date:signalDay,role:'stock',source:'eastmoney',knownAt:cutoff-1000,quoteAt:cutoff-2000}]})}};
  };
  const check=makeCheck('check-before',previous);
  const state={scope:'live',schemaVersion:1,revision:1,researchOnly:true,canTrade:false,canNotify:false,
    ...Object.fromEntries(arrays.map(key=>[key,[]])),catalog,dictionaryVersion,checks:[check],
    marketHistory:[{date:previous,nextTradingDay:day,source:'交易所归档日历',calendarSource:'交易所归档日历',
      calendarKnownAt:at(previous,'14:00:00'),knownAt:at(previous,'14:01:00')}]};
  return {now,day,previous,card,check,state,makeCheck};
}
function directory(t,state){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-plan-research-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const clean=structuredClone(state);delete clean.catalog;delete clean.dictionaryVersion;
  fs.writeFileSync(path.join(root,'research.json'),JSON.stringify({digest:hash(clean),state:clean}),{mode:0o600});
  return {root,file:path.join(root,'research.json')};
}

test('冻结事前完整数值观察不依赖已批准模型，优先原评分来源并保留原日期和真实零值',async()=>{
  const x=await fixture(),today=x.makeCheck('check-today',x.day,'09:45:00',false);
  x.state.checks.push(today);x.card.factorRanking={sourceCheckId:x.check.id};
  const before=structuredClone(x.state),linked=prepareDecisionPlanResearch(x.card,x.state,{now:x.now});
  assert.equal(linked.payload.checkId,x.check.id);assert.equal(linked.researchReference.selectedBy,'approved-ranking-reference');
  assert.equal(linked.researchReference.signalDay,x.previous);assert.equal(linked.researchReference.targetDay,x.day);
  assert.equal(linked.researchReference.calendarEvidence.to,x.day);assert.equal(linked.researchReference.numericFactors.values['YZ-14'],100);
  assert.equal(linked.researchReference.numericFactors.values['YZ-95'],undefined);assert.deepEqual(x.state,before);
  assert.deepEqual(prepareDecisionPlanResearch(x.card,x.state,{now:x.now+60000}),linked,'later reads do not rewrite original knowledge times');
  delete x.card.factorRanking;
  const current=prepareDecisionPlanResearch(x.card,x.state,{now:x.now});
  assert.equal(current.payload.checkId,today.id);assert.equal(current.researchReference.numericFactors.values['YZ-14'],0);
  assert.equal(current.researchReference.selectedBy,'same-session');assert.deepEqual(x.state.versions,[]);
  for(const key of ['checkFingerprint','observationFingerprint','factorDefinitionFingerprint','calendarEvidenceFingerprint'])
    assert.match(current.researchReference[key],/^[a-f0-9]{64}$/);
});

test('晚到、跨股、教学、缺来源、数值或定义篡改、旧词典与不完整观察均不伪造checkId',async()=>{
  const base=await fixture();
  const mutations=[x=>x.check.createdAt=new Date(x.card.calculatedAt+1).toISOString(),x=>x.check.code='600001',
    x=>x.check.sampleSet='test',x=>x.state.scope='demo',x=>x.check.synthetic=true,
    x=>x.state.sampleScope='demo',x=>x.check.sampleScope='demo',x=>x.check.recognition.ruleObservations.sampleScope='demo',
    x=>x.check.recognition.ruleObservations.inputs[0].sampleScope='demo',
    x=>x.check.recognition.ruleObservations.inputs[0].knownAt=x.card.calculatedAt+1,
    x=>x.check.recognition.ruleObservations.inputs[0].source=null,
    x=>x.check.recognition.ruleObservations.inputs[0].source='mock',
    x=>x.check.recognition.ruleObservations.inputs[0].code='600001',
    x=>x.check.recognition.ruleObservations.inputs[0].code=null,
    x=>x.check.recognition.ruleObservations.inputs[0].day='2026-02-30',
    x=>x.check.recognition.ruleObservations.inputs[0].endDay=x.day,
    x=>x.check.recognition.ruleObservations.inputs[0].role='unknown-scope',
    x=>x.check.recognition.ruleObservations.inputs[0]=null,
    x=>x.check.recognition.ruleObservations.rules.find(r=>r.factorCode==='YZ-14').value=99,
    x=>x.check.recognition.ruleObservations.catalogFingerprint='b'.repeat(64),
    x=>x.check.recognition.ruleObservations.dictionaryVersion='other-dictionary',
    x=>{const row=x.check.recognition.ruleObservations.rules.find(r=>r.factorCode==='YZ-14');row.states='?????';row.sources={};row.value=null;},
    x=>delete x.check.recognition.ruleObservations,
    x=>x.state.checks.push(structuredClone(x.check)),
    x=>x.check.asOf=x.day+' 11:00'];
  for(const mutate of mutations){
    const state=structuredClone(base.state),x={...base,state,check:state.checks[0]};mutate(x);
    const result=prepareDecisionPlanResearch(x.card,x.state,{now:x.now});
    assert.equal(result.payload.checkId,undefined);assert.equal(result.researchReference.status,'missing');
    assert.ok(result.researchReference.missing.length);assert.equal(result.researchReference.numericFactors,undefined);
    assert.equal(result.payload.stop,9,'a missing research observation does not rewrite the legal paper plan');
  }
});

test('builder收到异股原始记录本身也不能生成可绑定个股数值',async()=>{
  const x=await fixture(),facts=new Map();for(let i=0;i<5;i++)facts.set('14:'+i,{pass:true,source:'原策略条件回执'});
  x.check.recognition.ruleObservations=numeric.buildRulePanel({catalog,facts,code:x.card.code,day:x.previous,
    cutoff:at(x.previous,'15:05:00'),dictionaryVersion:x.state.dictionaryVersion,
    inputs:[{role:'stock',code:'600001',date:x.previous,source:'eastmoney',knownAt:at(x.previous),quoteAt:at(x.previous)-1000}]});
  const result=prepareDecisionPlanResearch(x.card,x.state,{now:x.now});
  assert.equal(result.payload.checkId,undefined);assert.equal(result.researchReference.status,'missing');
});

test('前日只按档案原相邻交易日边关联；缺失、晚知、冲突日历不从工作日推断',async()=>{
  const base=await fixture();
  for(const mutate of [x=>x.marketHistory=[],x=>x.marketHistory[0].nextTradingDay='2026-11-26',
    x=>x.marketHistory[0].calendarKnownAt=at(base.day,'09:00:00'),
    x=>x.marketHistory[0].knownAt=base.card.calculatedAt+1,
    x=>x.marketHistory.push({...x.marketHistory[0],nextTradingDay:'2026-11-27'}),
    x=>x.marketHistory[0].calendarSource='synthetic-calendar']){
    const state=structuredClone(base.state);mutate(state);
    const result=prepareDecisionPlanResearch(base.card,state,{now:base.now});
    assert.equal(result.payload.checkId,undefined);assert.match(result.researchReference.missing.join(' '),/交易日/);
  }
  const state=structuredClone(base.state);state.marketHistory=[];state.checks[0].market=structuredClone(base.state.marketHistory[0]);
  assert.equal(prepareDecisionPlanResearch(base.card,state,{now:base.now}).payload.checkId,base.check.id,'original calendar retained in the check is usable');
});

test('锁内固定准备时checkId重核，冻结引用可读回且不改观察、成交或已批准版本',async t=>{
  const [, {shortlineJob}]=await modules,x=await fixture({now:Date.now()}),dir=directory(t,x.state);
  const prepared=prepareDecisionPlanResearch(x.card,x.state,{now:x.now});assert.equal(prepared.payload.checkId,x.check.id);
  const result=await shortlineJob({root:dir.root,decisionPlan:x.card,beforeDecisionCommit:()=>true,
    input:{revision:1,action:'learn:plan',payload:prepared.payload}});
  assert.equal(result.result.checkId,x.check.id);assert.equal(result.result.researchFactorReference.status,'linked');
  assert.equal(result.result.researchFactorReference.checkFingerprint,prepared.researchReference.checkFingerprint);
  assert.equal(result.result.researchFactorReference.frozenAt,result.result.frozenAt);assert.equal(result.state.revision,2);
  assert.deepEqual(result.state.checks,x.state.checks);assert.deepEqual(result.state.trades,x.state.trades);assert.deepEqual(result.state.versions,x.state.versions);
  const read=await shortlineJob({root:dir.root});assert.deepEqual(read.state.plans[0],JSON.parse(JSON.stringify(result.result)));
});

test('准备时缺项或所选校验锁内失效均保持缺项，不补绑别的观察且合法计划仍可冻结',async t=>{
  const [, {shortlineJob}]=await modules;
  for(const invalidate of [false,true]){
    const x=await fixture({now:Date.now()}),prepared=prepareDecisionPlanResearch(x.card,x.state,{now:x.now});
    x.state.checks.push({...structuredClone(x.check),id:'another-already-recorded-check'});
    if(invalidate)x.check.createdAt=new Date(x.card.calculatedAt+1).toISOString();
    else delete prepared.payload.checkId;
    const dir=directory(t,x.state),result=await shortlineJob({root:dir.root,decisionPlan:x.card,beforeDecisionCommit:()=>true,
      input:{revision:1,action:'learn:plan',payload:prepared.payload}});
    assert.equal(result.result.checkId,null);assert.equal(result.result.researchFactorReference.status,'missing');
    assert.ok(result.result.researchFactorReference.missing.length);assert.equal(result.result.entryMin,9.8);assert.equal(result.state.revision,2);
  }
});

test('计划提交回调缺失、false或异常均拒绝写盘，普通研究动作保留原授权合同',async t=>{
  const [, {shortlineJob}]=await modules,x=await fixture({now:Date.now()}),dir=directory(t,x.state);
  const payload=prepareDecisionPlanResearch(x.card,x.state,{now:x.now}).payload,before=fs.readFileSync(dir.file);
  for(const beforeDecisionCommit of [undefined,()=>false,()=>{throw Error('revoked');}]){
    await assert.rejects(shortlineJob({root:dir.root,decisionPlan:x.card,beforeDecisionCommit,
      input:{revision:1,action:'learn:plan',payload}}),error=>error.httpStatus===403);
    assert.deepEqual(fs.readFileSync(dir.file),before);
  }
  const normal=await shortlineJob({root:dir.root,input:{revision:1,action:'book:lock',payload:{locked:true}}});
  assert.equal(normal.ok,true);assert.equal(normal.state.resetLocked,true);
});

test('真实worker准备计划绑定同一事前校验，提交授权握手通过后才保存',async t=>{
  const x=await fixture({now:Date.now()}),dir=directory(t,x.state);
  const payload=prepareDecisionPlanResearch(x.card,x.state,{now:x.now}).payload;let calls=0;
  const result=await runWorkspaceJob({action:'shortline',root:dir.root,book:'main',replica:false,decisionPlan:x.card,
    input:{revision:1,action:'learn:plan',payload}},{authorize:()=>{calls++;return true;}});
  assert.equal(result.ok,true,result.error);assert.ok(calls>=2);assert.equal(result.result.checkId,x.check.id);
  assert.equal(result.result.researchFactorReference.status,'linked');assert.equal(result.state.revision,2);
  const saved=JSON.parse(fs.readFileSync(dir.file)).state;
  assert.deepEqual(saved.checks,x.state.checks);assert.deepEqual(saved.trades,x.state.trades);assert.deepEqual(saved.versions,x.state.versions);
});

test('真实worker计算后在提交点撤权或原档案revision变化均拒写，不返回冻结计划',async t=>{
  const x=await fixture({now:Date.now()}),dir=directory(t,x.state),payload=prepareDecisionPlanResearch(x.card,x.state,{now:x.now}).payload;
  const request={action:'shortline',root:dir.root,book:'main',replica:false,decisionPlan:x.card,input:{revision:1,action:'learn:plan',payload}};
  const before=fs.readFileSync(dir.file);let calls=0;
  const revoked=await runWorkspaceJob(request,{authorize:()=>++calls===1});
  assert.equal(revoked.ok,false);assert.equal(revoked.httpStatus,403);assert.ok(calls>=2);assert.equal(revoked.result,undefined);
  assert.deepEqual(fs.readFileSync(dir.file),before);
  const missing=await runWorkspaceJob(request);assert.equal(missing.httpStatus,403);assert.deepEqual(fs.readFileSync(dir.file),before);
  const conflict=await runWorkspaceJob({...request,input:{...request.input,revision:0}},{authorize:()=>true});
  assert.equal(conflict.httpStatus,409);assert.deepEqual(fs.readFileSync(dir.file),before);
});
