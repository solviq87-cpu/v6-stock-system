'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const research=require('../src/core/intelligence-research');
const modules=Promise.all([import('../src/research/shortline/center-feedback.mjs'),
  import('../public/nova/shortline/learning.mjs'),import('../public/nova/shortline/factor-dictionary.mjs'),
  import('../src/research/shortline/store.mjs')]);
const at=(day,clock='15:00:00')=>Date.parse(day+'T'+clock+'+08:00');
const clone=value=>structuredClone(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

const {feedbackFixture:fixture}=require('./helpers/intelligence-feedback-fixture');
const report=x=>research.buildIntelligenceResearch({day:x.day,now:x.now,archive:x.state,calendar:x.calendar});

test('中心提案由原证据稳定复算，抓取时钟和当前Q改变不会改变待验证的同一组权重',async()=>{
  const x=await fixture(),a=report(x),b=report({...x,now:x.now+10000});
  assert.equal(a.feedback.validationBridge.proposalImportSupported,true);
  assert.equal(a.feedback.validationBridge.ready,true);
  assert.equal(a.feedback.proposalFingerprint,b.feedback.proposalFingerprint);
  assert.equal(a.feedback.proposal.archiveRevision,1);assert.equal(a.feedback.proposal.baselineVersion,1);
  assert.match(a.feedback.proposal.inputEvidenceFingerprint,/^[a-f0-9]{64}$/);
  const [,{learningAction}]=await modules,[{applyCenterFeedback}]=await modules;
  const baseline=clone(x.state.versions),r=applyCenterFeedback(x.state,{...x,state:undefined,proposalFingerprint:a.feedback.proposalFingerprint});
  const candidate=x.state.candidates.at(-1),expected={...baseline[0].weights};
  for(const change of a.feedback.proposal.changes)expected[change.factorId]=change.candidateWeight;
  assert.deepEqual(candidate.weights,expected);
  assert.equal(candidate.centerFeedback.sameProposedWeights,true);assert.equal(candidate.reviewRefs.length,0);
  assert.deepEqual(r.steps.map(row=>row.name),['训练集验证','时间外验证','样本外测试','成本压力校验','风险检查']);
  assert.deepEqual(r.steps.map(row=>row.status),Array(5).fill('通过'));
  assert.equal(r.status,'待人工审批');assert.deepEqual(x.state.versions,baseline);
  const approved=learningAction(x.state,'learn:decision',{id:r.candidateId,decision:'approve',reviewer:'隔离测试',reason:'核验同一提案与全部原验证记录'});
  assert.deepEqual(approved.weights,expected);assert.equal(approved.number,2);
  assert.throws(()=>learningAction(x.state,'learn:decision',{id:r.candidateId,decision:'approve',reviewer:'重复',reason:'重复'}));
});

test('证据和基线变更拒绝旧指纹，不接受普通学习操作中的任意中心weights',async()=>{
  const x=await fixture(),fingerprint=report(x).feedback.proposalFingerprint;
  const [{applyCenterFeedback},{learningAction}]=await modules;
  for(const change of [s=>s.revision++,s=>s.versions[0].weights['TL-01']+=.1,s=>s.bars[100].amount+=5000,s=>s.trades[0].pnl-=1]){
    const state=clone(x.state);change(state);
    assert.throws(()=>applyCenterFeedback(state,{...x,proposalFingerprint:fingerprint}),/变化|不一致/);
    assert.equal(state.candidates.length,0);assert.equal(state.versions.length,1);
  }
  assert.throws(()=>learningAction(x.state,'learn:center-feedback',{weights:{'TL-01':99},proposalFingerprint:fingerprint}),/未知学习/);
});

test('晚到成交从原训练分界清除；中心拟合或批准时间穿过首个留出日则整项拒绝',async()=>{
  const x=await fixture(),first=report(x),[{applyCenterFeedback},{validateCenterCandidate}]=await modules;
  const clean=clone(x.state),normal=applyCenterFeedback(clean,{...x,proposalFingerprint:first.feedback.proposalFingerprint});
  const late=clone(x.state),boundary=first.feedback.proposal.ranges.validation.start;
  late.trades[0].createdAt=new Date(at(boundary,'01:00:00')).toISOString();
  const updated=report({...x,state:late});
  const checked=applyCenterFeedback(late,{...x,proposalFingerprint:updated.feedback.proposalFingerprint});
  assert.equal(checked.counts[0],normal.counts[0]-1);
  assert.ok(!late.candidates.at(-1).sourceIds.includes(late.trades[0].id));
  const p=first.feedback.proposal,weights={...x.state.versions[0].weights};for(const change of p.changes)weights[change.factorId]=change.candidateWeight;
  const internal={...p,now:x.now,weights,changedFactorIds:p.changes.map(row=>row.factorId),proposalFingerprint:first.feedback.proposalFingerprint};
  for(const override of [{maxTrainingLabelKnownAt:at(boundary,'00:00:00')},{baselineApprovedAt:new Date(at(boundary,'00:00:00')).toISOString()}])
    assert.throws(()=>validateCenterCandidate(clone(x.state),{...internal,...override}),/晚于首个留出日/);
});

test('原始留出期不重用，失败后也不能再次搜索同一窗口',async()=>{
  const x=await fixture(),[{applyCenterFeedback}]=await modules;
  for(const trade of x.state.trades)trade.pnl=-2;
  const first=report(x),result=applyCenterFeedback(x.state,{...x,proposalFingerprint:first.feedback.proposalFingerprint});
  assert.equal(result.status,'验证未通过');assert.equal(result.steps[0].status,'未通过');assert.ok(result.steps.slice(1).every(row=>row.status==='未运行'));
  const again=report(x);
  assert.throws(()=>applyCenterFeedback(x.state,{...x,proposalFingerprint:again.feedback.proposalFingerprint}),/已经测试过/);
  assert.equal(x.state.candidates.length,1);assert.equal(x.state.versions.length,1);
});

test('不猜测因子映射，缺同名原训练特征或词典成员会阻断',async()=>{
  const x=await fixture(),[{applyCenterFeedback}]=await modules;
  const missing=clone(x.state);for(const check of missing.checks)check.factorCodes=[];
  const r=report({...x,state:missing});
  assert.throws(()=>applyCenterFeedback(missing,{...x,proposalFingerprint:r.feedback.proposalFingerprint}),/同名已观察特征/);
  const unknown=clone(x.state);unknown.versions[0].weights['XX-01']=unknown.versions[0].weights['TL-01'];delete unknown.versions[0].weights['TL-01'];
  for(const check of unknown.checks){const o=check.factorObservations['TL-01'];check.factorObservations['XX-01']={...o,factorCode:'XX-01'};delete check.factorObservations['TL-01'];}
  const u=report({...x,state:unknown});
  assert.throws(()=>applyCenterFeedback(unknown,{...x,proposalFingerprint:u.feedback.proposalFingerprint}),/同名词典/);
});

test('演示、缺事前计划、未成熟收益不能从中心提案进入正式候选',async()=>{
  const x=await fixture(),[{applyCenterFeedback}]=await modules;
  for(const mutate of [s=>s.scope='demo',s=>s.plans=[],s=>s.trades.forEach(row=>row.createdAt=new Date(x.now+1000).toISOString())]){
    const state=clone(x.state);mutate(state);const r=report({...x,state});
    assert.equal(r.feedback.validationBridge.ready,false);
    assert.throws(()=>applyCenterFeedback(state,{...x,proposalFingerprint:r.feedback.proposalFingerprint||'a'.repeat(64)}));
    assert.equal(state.candidates.length,0);
  }
});

test('质量反馈只引用已核实来源异常，固定Q权重不受策略输赢影响',async()=>{
  const x=await fixture();x.state.bars[10].high=0;
  const a=report(x);for(const trade of x.state.trades)trade.pnl=-99;const b=report(x);
  assert.ok(a.feedback.qualityCandidates.length>0);
  assert.deepEqual(a.feedback.qualityFeedback,b.feedback.qualityFeedback);
  assert.deepEqual(a.feedback.qualityFeedback.fixedWeights,{realtime:.35,completeness:.25,consistency:.2,continuity:.1,anomaly:.1});
  assert.equal(a.feedback.qualityFeedback.strategyProfitChangesQuality,false);
  assert.equal(a.feedback.qualityFeedback.changesOriginalGates,false);
  assert.equal(a.feedback.qualityCandidates[0].proposedScore,null,'缺实时报价时保持Q未知');
  assert.ok(a.feedback.qualityCandidates[0].proposedComponents.find(row=>row.id==='anomaly').value<1);
});

test('原私有档案锁和revision保护中心导入；直接HTTP形状、副本和命名档案不能伪造内部来源',async t=>{
  const x=await fixture(),[,,,{shortlineJob}]=await modules,root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-center-feedback-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const state=clone(x.state);delete state.catalog;delete state.dictionaryVersion;
  fs.writeFileSync(path.join(root,'research.json'),JSON.stringify({digest:digest(state),state}),{mode:0o600});
  const observed=await shortlineJob({root}),r=report({...x,state:observed.state});
  const input={action:'learn:center-feedback',revision:1,payload:{}};
  const centerFeedback={day:x.day,now:x.now,proposalFingerprint:r.feedback.proposalFingerprint,calendar:x.calendar};
  const before=fs.readFileSync(path.join(root,'research.json'));
  for(const args of [{root,input},{root,input,centerFeedback,replica:true},{root,input:{...input,revision:0},centerFeedback},
    {root,input:{...input,payload:{weights:{'TL-01':100}}},centerFeedback}])await assert.rejects(shortlineJob(args));
  assert.deepEqual(fs.readFileSync(path.join(root,'research.json')),before);
  await assert.rejects(shortlineJob({root,input,centerFeedback}),error=>error.httpStatus===403);
  assert.deepEqual(fs.readFileSync(path.join(root,'research.json')),before);
  await assert.rejects(shortlineJob({root,input,centerFeedback,beforeCenterCommit:()=>false}),error=>error.httpStatus===403);
  assert.deepEqual(fs.readFileSync(path.join(root,'research.json')),before);
  const imported=await shortlineJob({root,input,centerFeedback,beforeCenterCommit:()=>true});assert.equal(imported.state.revision,2);
  assert.equal(imported.result.status,'待人工审批');assert.equal(imported.state.versions.length,1);
  assert.equal((await shortlineJob({root})).state.candidates[0].centerFeedback.proposalFingerprint,r.feedback.proposalFingerprint);
});

test('中心实际新冻结观察完整传入反馈重算，不能退回旧check或丢失history上下文',async()=>{
  const x=await fixture(),[{applyCenterFeedback}]=await modules;
  const original=research.extractArchiveResearchInputs(x.state,{now:x.now}).observations;
  const frozenObservations=original.map(row=>{
    const signalAt=at(row.day,'16:05:00');
    return {...row,id:'center-'+row.id,originCheckId:row.id,originalSignalAt:row.signalAt,signalAt,
      recordedAt:new Date(signalAt).toISOString(),asOf:new Date(signalAt).toISOString(),captureProtocol:'center-hfq-history-v1'};
  });
  const bars=x.state.bars.map(row=>({...row,source:row.source==='eastmoney'?'eastmoney-public-history':row.source,
    observedAt:at(row.date,'16:00:00'),knownAt:at(row.date,'16:00:00'),sourceTimestamp:null,
    periodEndAt:at(row.date),sourceDate:row.date,observationKind:'historical-daily-bar',captureProtocol:'center-hfq-history-v1',
    rawHash:digest({testReceipt:row}),rawRowHash:digest(row),firstKnownBasis:'actual-provider-receipt',canTrade:false}));
  const input={day:x.day,now:at(x.day,'16:10:00'),bars,calendar:x.calendar,frozenObservations,
    historyCoverage:{protocol:'center-hfq-history-v1',codes:['600000','600001','600002','600003','600004'],admittedRows:bars.length}};
  const viewed=research.buildIntelligenceResearch({...input,archive:x.state});
  assert.equal(viewed.feedback.validationBridge.ready,true);
  assert.ok(viewed.factors.rejectionReasons['signal-price-first-known-after-signal']>0,'old check is not backdated');
  const fingerprint=viewed.feedback.proposalFingerprint;
  assert.throws(()=>applyCenterFeedback(clone(x.state),{...input,frozenObservations:[],proposalFingerprint:fingerprint}),/变化/);
  const state=clone(x.state),result=applyCenterFeedback(state,{...input,proposalFingerprint:fingerprint});
  assert.equal(result.proposalFingerprint,fingerprint);assert.equal(result.status,'待人工审批');
  assert.equal(state.candidates[0].centerFeedback.sameProposedWeights,true);
  assert.equal(state.candidates[0].centerFeedback.inputEvidenceFingerprint,viewed.feedback.proposal.inputEvidenceFingerprint);
  assert.equal(state.versions.length,1);
});


test('中心成熟成交以唯一可见身份计数：原样重试不放大门槛，冲突成交及计划全部隔离',async()=>{
  const x=await fixture(),base=report(x),original=clone(x.state.trades[0]);
  assert.equal(base.feedback.validationBridge.ready,true);
  const retry=clone(x.state);retry.trades.push(clone(original));
  const same=report({...x,state:retry}).feedback;
  assert.equal(same.matureTrades,base.feedback.matureTrades);
  assert.equal(same.tradeEvidenceAudit.duplicateTrades,1);
  assert.equal(same.proposalFingerprint,base.feedback.proposalFingerprint);
  const repeated=clone(x.state);repeated.trades=Array.from({length:36},()=>clone(original));
  const before=JSON.stringify(repeated),r=report({...x,state:repeated}).feedback;
  assert.equal(r.matureTrades,1);assert.equal(r.tradeEvidenceAudit.duplicateTrades,35);
  assert.equal(r.validationBridge.ready,false);assert.equal(r.excludedTrades.length,35);
  assert.equal(JSON.stringify(repeated),before);
  const conflict=clone(x.state);conflict.trades=[clone(original),{...clone(original),pnl:original.pnl+1}];
  const c=report({...x,state:conflict}).feedback;
  assert.equal(c.matureTrades,0);assert.equal(c.tradeEvidenceAudit.conflictingTrades,2);
  assert.equal(c.validationBridge.ready,false);
  const duplicateSettlement=clone(x.state),paperSettlement={accountId:'pool',exitEventId:'same-event'};
  duplicateSettlement.trades=[{...clone(original),paperSettlement},{...clone(original),id:'other-id',paperSettlement}];
  const s=report({...x,state:duplicateSettlement}).feedback;
  assert.equal(s.matureTrades,0);assert.equal(s.tradeEvidenceAudit.conflictingTrades,2);
  const badPlan=clone(x.state);badPlan.trades=[clone(original)];
  const plan=badPlan.plans.find(p=>p.id===original.planId);
  badPlan.plans.push({...plan,code:'600999'});
  const p=report({...x,state:badPlan}).feedback;
  assert.equal(p.matureTrades,0);assert.equal(p.tradeEvidenceAudit.conflictingPlans,2);
  const missing=clone(x.state);missing.trades=[{...clone(original),id:null}];
  assert.equal(report({...x,state:missing}).feedback.matureTrades,0);
  const late=clone(x.state);late.trades=[clone(original),{...clone(original),createdAt:new Date(x.now+1).toISOString(),pnl:99}];
  const l=report({...x,state:late}).feedback;
  assert.equal(l.matureTrades,1);assert.equal(l.tradeEvidenceAudit.conflictingTrades,0);
});
