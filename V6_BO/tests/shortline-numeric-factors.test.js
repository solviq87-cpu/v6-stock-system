'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const catalog=require('../public/nova/shortline/catalog.json');
const numeric=require('../public/nova/shortline/numeric-factors');
const research=require('../src/core/intelligence-research');
const {feedbackFixture}=require('./helpers/intelligence-feedback-fixture');
const at=(day,clock='15:00:00')=>Date.parse(day+'T'+clock+'+08:00'),clone=structuredClone;
const modules=Promise.all([import('../public/nova/shortline/backtest.mjs'),import('../public/nova/shortline/market.mjs'),
  import('../public/nova/shortline/learning.mjs'),import('../src/research/shortline/center-feedback.mjs'),import('../public/nova/shortline/factor-dictionary.mjs')]);
function observedState(){
  const day='2026-11-20',code='600001';
  return {scope:'live',catalog,bars:[{date:day,code,source:'eastmoney',knownAt:at(day),period:'日K',role:'stock',name:'单元测试观察',
    open:10,high:10.5,low:10,close:10.3,volume:10000,turnover:5,sector:'半导体',auctionGap:2,auctionRatio:1.8,
    auctionAmount:30000000,sectorAuctionUpPct:70,auctionNetBuy:1000000}],market:[],marketHistory:[],checks:[],plans:[],trades:[],
    versions:[],notes:[],explanations:[],corrections:[],day,date:day,code};
}
function addRulePanels(x){
  for(const check of x.state.checks){
    const j=Number(check.code)-600000,facts=new Map();
    for(let i=0;i<5;i++)for(const id of [14,36])facts.set(id+':'+i,{pass:i<j,source:'单元测试中的已归档逐条件观察 '+i});
    check.method='行情自动识别';check.factorCodes=[];check.factorObservations={};
    check.recognition={candidates:[],ruleObservations:numeric.buildRulePanel({catalog,facts,code:check.code,day:check.date,
      cutoff:at(check.date,'15:05:00'),dictionaryVersion:x.state.dictionaryVersion,
      inputs:[{code:check.code,date:check.date,source:'eastmoney',knownAt:at(check.date)}]})};
  }
  return x;
}
function shiftFixture(x,days){
  const ms=days*86400000;
  const walk=value=>{
    if(Array.isArray(value))return value.map(walk);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v)]));
    if(typeof value==='number'&&value>1e12)return value+ms;
    if(typeof value==='string'&&/^\d{4}-\d\d-\d\d/.test(value))return new Date(Date.parse(value.slice(0,10)+'T00:00:00Z')+ms).toISOString().slice(0,10)+value.slice(10);
    return value;
  };
  return walk(x);
}

test('共同指纹实现与Node SHA256一致，并且定义字段顺序不改变指纹',()=>{
  for(const value of ['',{},'中文🙂',{z:[1,null,'长文本'],a:3},Array(1000).fill('a')])
    assert.equal(numeric.fingerprint(value),crypto.createHash('sha256').update(numeric.stable(value)).digest('hex'));
  assert.equal(numeric.fingerprint({a:1,b:2}),numeric.fingerprint({b:2,a:1}));
});

test('原自动识别完整保存95项而保留top8展示；明确全失败为0，缺项为null',async()=>{
  const [{deriveCheckInput},{autoValidate},,,{dictionaryVersion}]=await modules,s=observedState();
  const first=deriveCheckInput(s,s),panel=first.recognition.ruleObservations;
  assert.equal(panel.rules.length,95);assert.ok(first.recognition.candidates.length<=8);
  const auction=panel.rules.find(row=>row.factorCode==='YZ-14');assert.equal(auction.value,100);assert.equal(auction.states,'ppppp');
  assert.equal(panel.rules.find(row=>row.factorCode==='YZ-95').value,null);
  assert.equal(panel.dictionaryVersion,dictionaryVersion);assert.equal(panel.inputs[0].source,'eastmoney');
  assert.ok(Buffer.byteLength(JSON.stringify(panel))<20000,'whole catalog is referenced by version/hash rather than duplicated per condition');
  const check={...autoValidate(s,{...s,recognition:{ruleObservations:{fake:true}}}),id:'observed',createdAt:new Date(at(s.day,'15:01:00')).toISOString()};
  const result=research.extractArchiveResearchInputs({...s,checks:[check],dictionaryVersion},{now:at(s.day,'16:00:00')});
  assert.equal(result.observations[0].values['YZ-14'],100);assert.equal(result.ruleCoverage.fullPanelChecks,1);
  assert.equal(result.ruleCoverage.rules.length,95);assert.equal(result.ruleCoverage.rules.find(row=>row.factorId==='YZ-95').unknownChecks,1);
  for(const key of ['auctionGap','auctionRatio','auctionAmount','sectorAuctionUpPct','auctionNetBuy'])s.bars[0][key]=0;
  const failed=deriveCheckInput(s,s);assert.equal(failed.recognition.ruleObservations.rules.find(row=>row.factorCode==='YZ-14').value,0);
  assert.ok(!failed.recognition.candidates.some(row=>row.name==='竞价模式战法'));
  delete s.bars[0].auctionRatio;
  const unknown=deriveCheckInput(s,s).recognition.ruleObservations.rules.find(row=>row.factorCode==='YZ-14');
  assert.equal(unknown.value,null);assert.equal([...unknown.states].filter(v=>v==='?').length,1);assert.equal(unknown.states[1],'?');
});

test('晚到源、缺来源、篡改数值/定义/目录版本不能变成完整可用观察，也不回退top8',async()=>{
  const [,{autoValidate},,,{dictionaryVersion}]=await modules,s=observedState();
  const base={...autoValidate(s,s),id:'source',createdAt:new Date(at(s.day,'15:01:00')).toISOString()};
  for(const mutate of [p=>p.inputs[0].knownAt=at(s.day,'16:00:00'),p=>p.inputs[0].source=null,
    p=>p.rules.find(r=>r.factorCode==='YZ-14').value=99,p=>p.catalogFingerprint='被替换定义',p=>p.dictionaryVersion='stale-version']){
    const check=clone(base);mutate(check.recognition.ruleObservations);
    const r=research.extractArchiveResearchInputs({...s,checks:[check],dictionaryVersion},{now:at(s.day,'17:00:00')});
    assert.equal(r.ruleCoverage.invalidPanels,1);assert.equal(r.ruleCoverage.legacyPartialChecks,0);
    assert.equal(r.observations.some(row=>Object.hasOwn(row.values,'YZ-14')),false);
  }
  s.bars[0].knownAt=at(s.day,'16:00:00');const late=autoValidate(s,s);
  assert.equal(late.recognition.ruleObservations.rules.find(row=>row.factorCode==='YZ-14').value,null);
});

test('数值原始输入严格绑定个股与日期范围；原指数、市场和板块上下文保留独立身份',async()=>{
  const [,,,,{dictionaryVersion}]=await modules,day='2026-11-20',code='600000',facts=new Map();
  for(let i=0;i<5;i++)facts.set('14:'+i,{pass:true,source:'原竞价观察'});
  const raw={role:'stock',code,date:day,source:'eastmoney',knownAt:at(day),quoteAt:at(day)-1000};
  const panel=inputs=>numeric.buildRulePanel({catalog,facts,code,day,cutoff:at(day,'15:05:00'),dictionaryVersion,inputs});
  const read=value=>numeric.readRulePanel(value,catalog,{code,day,at:at(day,'15:06:00'),recordedAt:at(day,'15:06:00')});
  for(const change of [{code:'600001'},{code:null},{role:'unrecognized'},{date:'2026-11-23'},
    {date:'2026-02-30'},{date:null},{role:'trusted-close-snapshot',code:'600001'},
    {role:'sector-peer',code:'600001',subjectCode:'600002',sector:'半导体'}]){
    const result=read(panel([{...raw,...change}]));
    assert.equal(result.values['YZ-14'],undefined);assert.ok(result.rejected.length);
  }
  const valid=panel([{...raw,date:'2026-11-19'},raw,{...raw,role:'index',code:'000001'},
    {...raw,role:'sector',code:'行业半导体'},{...raw,role:'market',code:null},
    {...raw,role:'sector-peer',code:'600001',subjectCode:code,sector:'半导体'}]);
  assert.equal(read(valid).values['YZ-14'],100);
  for(const patch of [{code:'600001'},{day:'2026-02-30'},{endDay:'2026-11-23'}]){
    const altered=clone(valid);Object.assign(altered.inputs[0],patch);
    assert.equal(read(altered).values['YZ-14'],undefined);
  }
  for(const field of ['sampleScope','sampleSet','scope']){
    assert.equal(read(panel([{...raw,[field]:'demo'}])).values['YZ-14'],undefined);
    const altered=clone(valid);altered[field]='demo';assert.equal(read(altered).values['YZ-14'],undefined);
    const check={code,date:day,asOf:day+' 15:05',createdAt:new Date(at(day,'15:06:00')).toISOString(),
      [field]:'demo',recognition:{ruleObservations:valid}};
    assert.deepEqual(numeric.readNumericCheck(check,catalog,at(day,'16:00:00')).values,{});
  }
});

test('原五关实际验证正交数值预测，首次批准建立独立基线，批准前旧模型不变',async t=>{
  t.mock.timers.enable({apis:['Date'],now:at('2024-07-01','16:00:00')});
  const [,,{learningAction,predict}]=await modules,x=addRulePanels(await feedbackFixture()),before=clone(x.state.versions);
  const c=learningAction(x.state,'learn:candidate',{weights:{'YZ-14':999},numericModel:{forged:true}});
  assert.equal(c.factorSchema,numeric.MODEL);assert.equal(c.numericModel.target,'verified-settlement-net-return-percent');
  assert.equal(c.numericModel.parameters.length,1);assert.equal(c.numericModel.parameters[0].factorId,'YZ-14');
  assert.ok(c.numericModel.suppressed.some(row=>row.factorId==='YZ-36'&&row.reason==='linearly-redundant-in-training'));
  assert.deepEqual(c.steps.map(row=>row.status),Array(5).fill('通过'));assert.equal(c.status,'待人工审批');
  assert.deepEqual(x.state.versions,before);assert.ok(!c.numericModel.sourceIds.some(id=>id.startsWith('k-')));
  const check=x.state.checks.at(-1),vector=numeric.readNumericCheck(check,catalog,at('2024-07-01','16:00:00'));
  assert.equal(predict(x.state,{asOf:'2024-07-01T16:00',numericFactors:vector}).factorSchema,'legacy-presence-weights');
  const approved=learningAction(x.state,'learn:decision',{id:c.id,decision:'approve',reviewer:'单元测试',reason:'核对同一数值模型及五项验证'});
  assert.equal(approved.numericModel.fingerprint,c.numericModel.fingerprint);assert.ok(approved.scoringFingerprint);
  const scored=predict(x.state,{asOf:'2024-07-01T16:01',numericFactors:vector});
  assert.equal(scored.factorSchema,numeric.MODEL);assert.ok(scored.score>0);
  assert.equal(predict(x.state,{asOf:'2024-07-01T16:01',numericFactors:{values:{'YZ-14':80},definitions:{}}}).score,null);
  const report=research.buildIntelligenceResearch({archive:x.state,day:check.date,now:at('2024-07-01','16:01:00'),calendar:x.calendar});
  assert.equal(report.factors.approvedScoring.status,'missing-compatible-factor-observations');assert.equal(report.factors.approvedScoring.modelVersion,2);
  assert.ok(report.factors.approvedScoring.rows.every(row=>row.day===check.date&&row.modelFingerprint===approved.numericModel.fingerprint));
  assert.ok(report.factors.approvedScoring.rows.every(row=>row.eligibleForNextSession===false&&row.missing.includes('数值模型在原信号后才批准')));
});

test('数值验证失败不会借旧boolean模型通过；留出收益变更不回流训练，重复信号不增样本',async()=>{
  const [,,{learningAction}]=await modules,base=addRulePanels(await feedbackFixture()),clean=clone(base.state);
  const reference=learningAction(clean,'learn:candidate',{});
  const reversed=clone(base.state);
  for(const check of reversed.checks)if(check.date>=reference.trainEnd){
    for(const rule of check.recognition.ruleObservations.rules.filter(row=>['YZ-14','YZ-36'].includes(row.factorCode))){
      rule.states=[...rule.states].map(value=>value==='p'?'f':'p').join('');
      rule.value=[...rule.states].filter(value=>value==='p').length/rule.states.length*100;
    }
  }
  const bad=learningAction(reversed,'learn:candidate',{});
  assert.equal(bad.steps[0].status,'通过');assert.equal(bad.steps[1].status,'未通过');assert.equal(bad.status,'验证未通过');
  assert.deepEqual(bad.numericModel,reference.numericModel,'held-out factor values do not refit the training basis');
  assert.throws(()=>learningAction(reversed,'learn:decision',{id:bad.id,decision:'approve',reviewer:'x',reason:'x'}),/五项/);
  const duplicate=clone(base.state);duplicate.trades.push({...duplicate.trades[0],id:'duplicate-same-frozen-signal'});
  assert.equal(learningAction(duplicate,'learn:candidate',{}).numericModel.trainingRows,reference.numericModel.trainingRows);
  const tampered=clone(clean),c=tampered.candidates.at(-1);c.numericModel.parameters[0].center+=1;
  assert.throws(()=>learningAction(tampered,'learn:decision',{id:c.id,decision:'approve',reviewer:'x',reason:'x'}),/已变化/);
});

test('缺事前检查/计划、伪净收益和晚到资料不能建立数值基线，YZ不能映射旧boolean权重',async()=>{
  const [,,{learningAction}]=await modules;
  for(const mutate of [x=>x.state.plans=[],x=>x.state.checks.forEach(c=>c.createdAt='2025-01-01T00:00:00Z'),
    x=>x.state.trades.forEach(row=>row.cost+=10000),x=>x.state.checks.forEach(c=>c.recognition.ruleObservations.inputs[0].knownAt=at('2025-01-01'))]){
    const x=addRulePanels(await feedbackFixture());mutate(x);
    const c=learningAction(x.state,'learn:candidate',{});assert.equal(c.numericModel,null);
  }
  const x=addRulePanels(await feedbackFixture());x.state.versions[0].weights['YZ-14']=2;
  const report=research.buildIntelligenceResearch({archive:x.state,day:x.day,now:x.now,calendar:x.calendar});
  const row=report.feedback.candidates.find(c=>c.factorId==='YZ-14');
  assert.equal(row.baselineStatus,'incompatible-legacy-presence-weight');assert.equal(row.candidateWeight,null);
  assert.equal(report.feedback.validationBridge.ready,false);
});

test('作战台冻结引用进入真实净收益训练；同ID校验事后改写或缺少冻结引用不能补样本',async()=>{
  const [,,{learningAction}]=await modules;
  const {prepareDecisionPlanResearch}=require('../src/core/decision-plan-research');
  const {bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
  const x=addRulePanels(await feedbackFixture());x.state.trades=x.state.trades.slice(0,150);x.state.bars=[];
  const checkIds=new Set(x.state.trades.map(row=>row.checkId)),planIds=new Set(x.state.trades.map(row=>row.planId));
  x.state.checks=x.state.checks.filter(check=>checkIds.has(check.id));x.state.plans=x.state.plans.filter(plan=>planIds.has(plan.id));
  x.state.marketHistory=x.calendar.days.slice(0,-1).map((date,i)=>({date,nextTradingDay:x.calendar.days[i+1],
    calendarSource:x.calendar.source,source:x.calendar.source,calendarKnownAt:x.calendar.knownAt,knownAt:x.calendar.knownAt}));
  for(const trade of x.state.trades){
    const plan=x.state.plans.find(row=>row.id===trade.planId),day=trade.entryTime.slice(0,10),clock=at(day,'09:30:00');
    const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:trade.code,day,calculatedAt:clock,
      strategyAt:clock-1000,plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:5}};
    const prepared=prepareDecisionPlanResearch(card,x.state,{now:clock});assert.equal(prepared.payload.checkId,trade.checkId);
    Object.assign(plan,prepared.payload,{frozenAt:new Date(clock+60000).toISOString()});bindAuthoritativePlan(plan,card);
    plan.researchFactorReference={...prepared.researchReference,frozenAt:plan.frozenAt};
  }
  const before=learningAction(clone(x.state),'learn:candidate',{});assert.ok(before.numericModel);assert.ok(before.numericModel.trainingRows>=12);
  const rewritten=clone(x.state);
  for(const check of rewritten.checks)check.name='同ID的事后改写';
  assert.ok(Object.keys(numeric.readNumericCheck(rewritten.checks[0],catalog,x.now).values).length,
    'rewritten check still has valid numeric observations; the frozen hash must reject it');
  assert.equal(learningAction(rewritten,'learn:candidate',{}).numericModel,null);
  const legacy=clone(x.state);legacy.plans.forEach(plan=>delete plan.researchFactorReference);
  assert.equal(learningAction(legacy,'learn:candidate',{}).numericModel,null);
  const values=clone(x.state);values.plans.forEach(plan=>plan.researchFactorReference.numericFactors.values['YZ-14']+=1);
  assert.equal(learningAction(values,'learn:candidate',{}).numericModel,null);
});

test('新独立窗口的中心提案在同一获批正交基底上调权，完整模型进入原五关与人工审批',async t=>{
  t.mock.timers.enable({apis:['Date'],now:at('2023-12-20','16:00:00')});
  const [,,{learningAction}, {applyCenterFeedback}]=await modules;
  const past=addRulePanels(shiftFixture(await feedbackFixture(),-200));
  const first=learningAction(past.state,'learn:candidate',{});
  const approved=learningAction(past.state,'learn:decision',{id:first.id,decision:'approve',reviewer:'单元测试',reason:'建立真实数值基线'});
  const x=addRulePanels(await feedbackFixture());x.state.versions=[approved];x.state.candidates=[first];
  t.mock.timers.setTime(x.now);
  const report=research.buildIntelligenceResearch({archive:x.state,day:x.day,now:x.now,calendar:x.calendar});
  assert.equal(report.feedback.validationBridge.ready,true);assert.equal(report.feedback.proposal.factorSchema,numeric.MODEL);
  assert.deepEqual(report.feedback.proposal.numericModel.parameters,approved.numericModel.parameters);
  assert.equal(report.feedback.candidates[0].metricBasis,'approved-frozen-orthogonal-basis');
  const signalDay=x.state.checks.at(-1).date;
  const projection=research.buildIntelligenceResearch({archive:x.state,day:signalDay,now:x.now,calendar:x.calendar}).factors.approvedScoring;
  assert.equal(projection.status,'ready');assert.ok(projection.rows.every(row=>row.signalDay===signalDay&&row.day===signalDay&&row.targetDay===x.day&&row.eligibleForNextSession));
  assert.ok(projection.trainingLabelKnownAtMax<Date.parse(projection.approvedAt));
  const lateCalendar={...x.calendar,knownAt:x.now};
  const blocked=research.buildIntelligenceResearch({archive:x.state,day:signalDay,now:x.now,calendar:lateCalendar}).factors.approvedScoring;
  assert.ok(blocked.rows.every(row=>!row.eligibleForNextSession&&row.missing.includes('下一交易日日历在原观察后才取得')));
  const before=clone(x.state.versions),result=applyCenterFeedback(x.state,{...x,proposalFingerprint:report.feedback.proposalFingerprint});
  assert.equal(result.status,'待人工审批');assert.deepEqual(result.steps.map(row=>row.status),Array(5).fill('通过'));
  assert.deepEqual(x.state.versions,before);assert.equal(x.state.candidates.at(-1).numericModel.fingerprint,report.feedback.proposal.numericModel.fingerprint);
  assert.throws(()=>applyCenterFeedback(x.state,{...x,proposalFingerprint:report.feedback.proposalFingerprint}),/已经测试过/);
});

test('同名规则的阈值定义变化不能混合IC或沿用原批准模型评分',async()=>{
  const [,,{learningAction}]=await modules,x=addRulePanels(await feedbackFixture());
  const candidate=learningAction(clone(x.state),'learn:candidate',{}),check=x.state.checks[0];
  const original=numeric.readNumericCheck(check,catalog,x.now);
  assert.ok(Number.isFinite(numeric.numericScore(candidate.numericModel,original).score));
  check.recognition.ruleObservations.settings={minAssist:9};
  check.recognition.ruleObservations.settingsFingerprint=numeric.fingerprint(check.recognition.ruleObservations.settings);
  const changed=numeric.readNumericCheck(check,catalog,x.now);
  assert.equal(numeric.numericScore(candidate.numericModel,changed).score,null);
  const report=research.buildIntelligenceResearch({archive:x.state,day:x.day,now:x.now,calendar:x.calendar});
  assert.equal(report.factors.descriptive['YZ-14'].status,'mixed-factor-definition-versions');
  assert.equal(report.factors.descriptive['YZ-14'].meanIC,null);
});

test('原权威模拟结算沿用含买入费用的收益分母，不能被普通手工成交分母错误拒绝',async()=>{
  const [,,{learningAction}]=await modules,x=addRulePanels(await feedbackFixture());
  for(const row of x.state.trades){
    row.exitPrice=Number(row.code)-600000>=3?11:9.8;row.cost=30;row.costBasis=1020;
    row.pnlAmount=Math.round(((row.exitPrice-row.entryPrice)*row.shares-row.cost)*100)/100;
    row.pnl=Math.round(row.pnlAmount/row.costBasis*10000)/100;
    // This isolated fixture models one distinct original exit event per trade.
    // Production uses the account ledger's original exitEventId, not a derived alias.
    row.paperSettlement={accountId:'pool',exitEventId:'fixture-exit:'+row.id,symbol:row.code,costBasisCents:102000,realizedCents:Math.round(row.pnlAmount*100),
      exitGrossCents:Math.round(row.exitPrice*row.shares*100),exitFeeCents:1000,
      entryFills:[{quantity:100,costCents:102000,grossCents:100000,time:at(row.date,'09:32:00')}]};
  }
  const candidate=learningAction(x.state,'learn:candidate',{});
  assert.equal(candidate.numericModel.target,'verified-settlement-net-return-percent');
  assert.deepEqual(candidate.steps.map(row=>row.status),Array(5).fill('通过'));
  assert.equal(candidate.numericCoverage.scorableCounts.reduce((a,b)=>a+b,0),500);
});


test('共享撤销门禁覆盖原数值训练血缘及中心继承的历史验证来源',()=>{
 const {candidateEvidenceReview,approvedModelEvidenceReview}=require('../public/nova/shortline/sample-quality.mjs');
 const time=d=>'2024-07-'+String(d).padStart(2,'0')+'T08:00:00Z',point=d=>Date.parse(time(d));
 const review={status:'revalidated',firstQuarantinedAt:time(8),lastQuarantinedAt:time(8),revalidatedAt:time(9)};
 const evidence={code:'600000',entryTime:'2024-07-01T09:32',exitTime:'2024-07-02T11:00',
  createdAt:time(2),snapshotVerified:true,repeatable:true,pnl:2};
 const training={...evidence,id:'training',planEvidenceReview:review},held={...evidence,id:'validation',planEvidenceReview:review};
 const old={id:'old',createdAt:time(5),sourceIds:['validation'],numericModel:{sourceIds:['training'],trainCutoff:time(4)}};
 const base={number:1,candidateId:'old',numericModel:old.numericModel};
 const newCandidate={id:'new',createdAt:time(10),baseVersion:1,sourceIds:['different'],centerFeedback:{},numericModel:old.numericModel};
 const next={number:2,candidateId:'new',numericModel:old.numericModel};
 const state={scope:'live',trades:[training,held],candidates:[old,newCandidate],versions:[base,next]};
 assert.equal(candidateEvidenceReview(state,newCandidate,point(11)).affectedSources,1);
 assert.equal(approvedModelEvidenceReview(state,next,point(11)).affectedSources,2);
 assert.equal(approvedModelEvidenceReview(state,base,point(7)).status,'no-known-revocation');
 assert.equal(approvedModelEvidenceReview({...state,candidates:[]},base,point(11)).affectedSources,1);
 assert.equal(candidateEvidenceReview(state,{sourceIds:['training'],createdAt:time(10)},point(11)).status,'no-known-revocation');
 assert.equal(approvedModelEvidenceReview(state,null,point(11)).status,'unavailable');
});

test('原生智能中心、短线评分及自动调权共用已撤销模型来源门禁',async t=>{
 t.mock.timers.enable({apis:['Date'],now:at('2024-07-01','16:00:00')});
 const [,,{learningAction,predict}]=await modules,x=addRulePanels(await feedbackFixture());
 const c=learningAction(x.state,'learn:candidate',{});
 const approved=learningAction(x.state,'learn:decision',{id:c.id,decision:'approve',reviewer:'隔离验收',reason:'保留原审批'});
 const row=x.state.trades.find(r=>c.numericModel.sourceIds.includes(r.id));assert.ok(row);
 const check=x.state.checks.at(-1),clock=at('2024-07-01','16:03:00');
 const first=new Date(at('2024-07-01','16:02:00')).toISOString();
 row.planEvidenceReview={status:'quarantined',firstQuarantinedAt:first,lastQuarantinedAt:first};
 const before=JSON.stringify(x.state),report=research.buildIntelligenceResearch({archive:x.state,day:check.date,now:clock,calendar:x.calendar});
 assert.equal(report.factors.approvedScoring.status,'requires-source-revalidation');
 assert.equal(report.factors.approvedScoring.modelVersion,approved.number);
 assert.equal(report.factors.approvedScoring.modelFingerprint,approved.numericModel.fingerprint);
 assert.deepEqual(report.factors.approvedScoring.rows,[]);
 assert.equal(report.feedback.modelEvidenceReview.status,'requires-revalidation');
 assert.equal(report.feedback.proposal,null);assert.equal(report.feedback.validationBridge.ready,false);
 assert.ok(report.feedback.excludedTrades.some(r=>r.id===row.id&&r.reason==='withdrawn-learning-source'));
 assert.ok(report.feedback.validationBridge.missing.some(r=>r.includes('来源样本已撤销')));
 assert.equal(predict(x.state,{asOf:clock}).score,null);assert.equal(JSON.stringify(x.state),before);
 row.planEvidenceReview.status='revalidated';row.planEvidenceReview.revalidatedAt=new Date(clock).toISOString();
 assert.equal(research.buildIntelligenceResearch({archive:x.state,day:check.date,now:clock,calendar:x.calendar}).factors.approvedScoring.status,'requires-source-revalidation');
});

test('恢复来源必须保持原结算质量，晚到归档不能反向改变历史审批',()=>{
 const {candidateEvidenceReview,approvedModelEvidenceReview,verifiedLearningObservation,sampleMatches}=require('../public/nova/shortline/sample-quality.mjs');
 const time=d=>'2024-07-'+String(d).padStart(2,'0')+'T08:00:00Z',point=d=>Date.parse(time(d));
 const original={id:'restored',code:'600000',entryTime:'2024-07-01T09:32',exitTime:'2024-07-02T11:00',
  createdAt:time(2),snapshotVerified:true,repeatable:true,pnl:2};
 const review={status:'revalidated',firstQuarantinedAt:time(8),lastQuarantinedAt:time(8),revalidatedAt:time(9)};
 const valid={...original,planEvidenceReview:review};
 const c={id:'candidate',createdAt:time(10),sourceIds:[original.id]};
 const v={number:1,candidateId:c.id,approvedAt:time(10)};
 const cutoff=point(11);
 const state=trades=>({scope:'live',trades,candidates:[c],versions:[v]});
 const check=(trades,expected,asOf=cutoff)=>{
  const s=state(trades),before=JSON.stringify(s);
  assert.equal(candidateEvidenceReview(s,c,asOf).status,expected);
  assert.equal(approvedModelEvidenceReview(s,v,asOf).status,expected);
  assert.equal(JSON.stringify(s),before);
 };
 const good='no-known-revocation',bad='requires-revalidation';
 check([valid],good);check([valid,{...valid}],good);
 for(const patch of [{pnl:null},{snapshotVerified:false},{blackSwan:true},{createdAt:null},
  {repeatable:false},{exitTime:'bad-clock'},{extreme:true}]){
  const damaged={...valid,...patch};
  assert.ok(!verifiedLearningObservation(damaged,cutoff)||!sampleMatches(damaged,'standard'));
  check([damaged],bad);
 }
 check([{id:original.id,planEvidenceReview:review}],bad);
 check([{...original,planEvidenceReview:false}],bad);
 check([{...valid,planEvidenceReview:{...review,revalidatedAt:null}}],bad);
 check([valid,{...valid,pnl:3}],bad);
 check([valid,{...valid,sampleSet:'demo',pnl:99}],good);
 const later={...original,createdAt:time(12),planEvidenceReview:{status:'quarantined',firstQuarantinedAt:time(8),lastQuarantinedAt:time(8)}};
 check([original,later],good);check([later],good);
 check([original,later],bad,point(12));
 check([{...original,snapshotVerified:false,planEvidenceReview:{status:'quarantined',firstQuarantinedAt:time(12),lastQuarantinedAt:time(12)}}],good);
 assert.equal(candidateEvidenceReview(state([valid]),{...c,createdAt:time(7)},cutoff).status,bad);
 assert.equal(candidateEvidenceReview(state([valid]),{...c,createdAt:time(8)},cutoff).status,bad);
 check([],good); // the candidate may instead reference a historical K-line label
});
