'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateTemplateLibrary}=require('../src/core/intelligence-templates');
const {buildIntelligenceResearch}=require('../src/core/intelligence-research');
const catalog=require('../public/nova/shortline/catalog.json');
const numeric=require('../public/nova/shortline/numeric-factors.js');
const day='2026-11-25',prior='2026-11-24',code='600001';
const at=(d,clock='15:01:00')=>Date.parse(d+'T'+clock+'+08:00');
const calendar={days:[prior,day,'2026-11-26'],source:'sse-calendar',knownAt:at(prior,'08:00:00')};
function frame(date,level){return {date,previousDay:date===day?prior:'2026-11-23',knownAt:at(date),provider:'eastmoney',
  source:'东方财富收盘池',scope:'同源涨停专题池',complete:true,totalCount:1,sealed:[{code,level,close:10,upLimit:10}]};}
function check(extra={}){
  return {id:'check',code,name:code,date:day,createdAt:new Date(at(day,'15:02:00')).toISOString(),method:'行情自动识别',
    market:{date:day,knownAt:at(day),source:'原同日盘面'},emotion:{stage:'回暖',evidence:['同源宽度与封板率回升'],missing:[]},
    recognition:{candidates:catalog.filter(row=>[1,2,8,10,18,39,45,50,77,78,87].includes(row.id)).map(row=>
      ({name:row.name,total:row.factors.length,matched:row.factors.length,missing:[],failed:[]}))},...extra};
}
function archive(level=1){return {scope:'live',checks:[check()],market:[
  {date:prior,knownAt:at(prior),source:'原收盘盘面',structurePools:[frame(prior,1)]},
  {date:day,knownAt:at(day),source:'原收盘盘面',structurePools:[frame(day,level)]}],bars:[]};}
const run=a=>evaluateTemplateLibrary(a,{day,now:at(day,'15:10:00'),calendar,catalog});
function panelArchive({level=1,editFacts=()=>{},inputs}={}){
  const a=archive(level),facts=new Map();a.dictionaryVersion='template-test-dictionary-v1';
  for(const rule of catalog)for(const [index] of rule.factors.entries())
    facts.set(rule.id+':'+index,{pass:true,source:'原归档条件 '+rule.id+':'+index});
  editFacts(facts);
  a.checks[0].asOf=new Date(at(day,'15:01:30')).toISOString();
  a.checks[0].recognition.ruleObservations=numeric.buildRulePanel({catalog,facts,code,day,
    cutoff:a.checks[0].asOf,dictionaryVersion:a.dictionaryVersion,
    inputs:inputs??[{code,date:day,source:'eastmoney',knownAt:at(day),sourceTimestamp:at(day,'15:00:00')}]});
  return a;
}

test('five existing-rule templates now evaluate complete condition records and explicit board identities',()=>{
  const current=archive(1),before=JSON.stringify(current),groups=run(current);
  assert.equal(groups.length,5);
  assert.equal(groups.find(row=>row.definition.id==='first-board').observations.length,1);
  assert.equal(groups.find(row=>row.definition.id==='weak-to-strong-reversal').observations.length,1);
  assert.equal(groups.find(row=>row.definition.id==='leader').observations.length,1);
  assert.equal(groups.find(row=>row.definition.id==='emotion-timing').observations.length,1);
  assert.equal(groups.find(row=>row.definition.id==='one-to-two').observations.length,0);
  assert.equal(run(archive(2)).find(row=>row.definition.id==='one-to-two').observations.length,1);
  assert.equal(JSON.stringify(current),before);
  assert.ok(groups.every(row=>row.canTrade===false&&row.affectsResonance===false&&row.validationStatus==='not-oos-validated'));
});

test('template names or partial matches cannot replace missing original per-condition evidence',()=>{
  const a=archive();a.checks[0].matches=['首板套利战法'];a.checks[0].recognition.candidates=[];
  assert.equal(run(a).find(row=>row.definition.id==='first-board').status,'missing-evidence');
  const b=archive(),rule=b.checks[0].recognition.candidates.find(row=>row.name==='首板套利战法');
  rule.matched--;rule.missing=[catalog.find(row=>row.id===8).factors[0]];
  const observed=run(b).find(row=>row.definition.id==='first-board');
  assert.equal(observed.observations.length,0);assert.equal(observed.evaluations[0].rules[0].conditions[0].status,'unknown');
});

test('one-to-two refuses a prior board first known after today opened and missing calendar edges',()=>{
  const a=archive(2);a.market[0].knownAt=at(day,'09:45:00');a.market[0].structurePools[0].knownAt=at(day,'09:45:00');
  assert.equal(run(a).find(row=>row.definition.id==='one-to-two').status,'missing-evidence');
  const b=evaluateTemplateLibrary(archive(2),{day,now:at(day,'15:10:00'),catalog,calendar:null});
  assert.equal(b.find(row=>row.definition.id==='one-to-two').observations.length,0);
});

test('known emotion requires its original market timing and explanatory evidence',()=>{
  const a=archive();a.checks[0].emotion.missing=['缺少同日封板率'];
  assert.equal(run(a).find(row=>row.definition.id==='emotion-timing').status,'missing-evidence');
  const b=archive();b.checks[0].market.knownAt=at(day,'15:03:00');
  assert.equal(run(b).find(row=>row.definition.id==='emotion-timing').observations.length,0);
});

test('latest recorded condition failure removes the current observation without accumulating duplicate votes',()=>{
  const a=archive(),later=check({id:'later',createdAt:new Date(at(day,'15:03:00')).toISOString()});
  const rule=later.recognition.candidates.find(row=>row.name==='首板套利战法');
  rule.matched--;rule.failed=[catalog.find(row=>row.id===8).factors[0]];a.checks.push(later);
  const group=run(a).find(row=>row.definition.id==='first-board');
  assert.equal(group.evaluations.length,1);assert.equal(group.evaluations[0].checkId,'later');
  assert.equal(group.status,'conditions-failed');assert.equal(group.observations.length,0);
});

test('research API groups expose all six evaluator states without claiming out-of-sample certification',()=>{
  const report=buildIntelligenceResearch({day,now:at(day,'15:10:00'),archive:archive(),calendar});
  assert.equal(report.templates.groups.length,6);
  assert.ok(report.templates.groups.every(row=>row.status==='implemented-evidence-evaluator'));
  assert.ok(report.templates.groups.every(row=>row.validationStatus==='not-oos-validated'));
  const first=report.templates.groups.find(row=>row.id==='first-board');
  assert.equal(first.observationCount,1);assert.equal(first.evidenceStatus,'observed-unvalidated');
});

test('validated full panels supply template conditions absent from the top-eight display with original provenance',()=>{
  const a=panelArchive(),check=a.checks[0];
  check.recognition.candidates=catalog.filter(rule=>[14,15,16,17,19,20,21,22].includes(rule.id)).map(rule=>
    ({name:rule.name,total:rule.factors.length,matched:rule.factors.length,missing:[],failed:[]}));
  const before=JSON.stringify(a),groups=run(a),first=groups.find(row=>row.definition.id==='first-board');
  assert.equal(first.observations.length,1);const proof=first.observations[0].rules[0];
  assert.equal(proof.ruleCode,'YZ-08');assert.equal(proof.panelStatus,'validated');
  assert.equal(proof.source,'shortline-condition-evaluator');assert.equal(proof.knownAt,check.createdAt);
  assert.equal(proof.observationCutoff,at(day,'15:01:30'));assert.equal(proof.dictionaryVersion,a.dictionaryVersion);
  assert.equal(proof.conditions[0].source,'原归档条件 8:0');assert.equal(proof.conditions[0].ordinal,1);
  assert.deepEqual(proof.conditions.map(row=>row.name),catalog.find(rule=>rule.id===8).factors);
  assert.equal(groups.find(row=>row.definition.id==='weak-to-strong-reversal').observations.length,1);
  assert.equal(groups.find(row=>row.definition.id==='leader').observations.length,1);
  assert.equal(groups.find(row=>row.definition.id==='emotion-timing').observations.length,1);
  assert.equal(run(panelArchive({level:2})).find(row=>row.definition.id==='one-to-two').observations.length,1);
  const report=buildIntelligenceResearch({day,now:at(day,'15:10:00'),archive:a,calendar});
  assert.equal(report.factors.ruleCoverage.fullPanelChecks,1);
  assert.equal(report.templates.groups.find(row=>row.id==='first-board').observationCount,1);
  assert.equal(JSON.stringify(a),before);
});

test('validated failures and partial unknowns take precedence over a passing legacy display without inventing zeros',()=>{
  const failed=panelArchive({editFacts:facts=>facts.set('8:0',{pass:false,source:'原归档明确未通过'})});
  const failure=run(failed).find(row=>row.definition.id==='first-board');
  assert.equal(failure.status,'conditions-failed');assert.equal(failure.observations.length,0);
  assert.equal(failure.evaluations[0].rules[0].conditions[0].status,'failed');
  const unknown=panelArchive({editFacts:facts=>facts.delete('8:0')});
  const group=run(unknown).find(row=>row.definition.id==='first-board'),proof=group.evaluations[0].rules[0];
  assert.equal(group.status,'missing-evidence');assert.equal(group.observations.length,0);
  assert.equal(proof.conditions[0].status,'unknown');assert.equal(proof.conditions[0].source,null);
  assert.equal(proof.conditions[1].status,'passed');assert.equal(proof.conditions[1].source,'原归档条件 8:1');
  assert.equal(unknown.checks[0].recognition.ruleObservations.rules.find(row=>row.factorCode==='YZ-08').value,null);
});

test('invalid full panels are quarantined as a whole, including unrelated bad rules, without a legacy fallback',()=>{
  for(const mutate of [
    panel=>panel.dictionaryVersion='incompatible-dictionary',
    panel=>panel.catalogFingerprint='incompatible-catalog',
    panel=>panel.cutoff=at(day,'15:02:01'),
    panel=>panel.inputs[0].knownAt=at(day,'15:03:00'),
    panel=>panel.rules[94].sources={},
    panel=>panel.rules[94].value=99,
    panel=>panel.rules[94]=null,
    panel=>panel.rules.pop()
  ]){
    const a=panelArchive();mutate(a.checks[0].recognition.ruleObservations);
    const group=run(a).find(row=>row.definition.id==='first-board'),proof=group.evaluations[0].rules[0];
    assert.equal(group.status,'missing-evidence');assert.equal(group.observations.length,0);
    assert.equal(proof.panelStatus,'invalid');assert.ok(proof.rejected.length>0);
    assert.ok(proof.conditions.every(row=>row.status==='unknown'));assert.match(proof.reason,/已隔离/);
  }
});

test('known-looking states without original input provenance stay unknown and a later invalid panel replaces the older observation',()=>{
  const a=panelArchive({inputs:[]}),group=run(a).find(row=>row.definition.id==='first-board');
  assert.equal(group.status,'missing-evidence');assert.equal(group.observations.length,0);
  assert.ok(group.evaluations[0].rules[0].conditions.every(row=>row.status==='unknown'));
  assert.match(group.evaluations[0].rules[0].reason,/原始输入缺少来源或有效可知时点/);
  const b=panelArchive(),later=structuredClone(b.checks[0]);
  later.id='later-invalid-panel';later.createdAt=new Date(at(day,'15:03:00')).toISOString();
  later.recognition.ruleObservations.settingsFingerprint='invalid-settings';b.checks.push(later);
  const current=run(b).find(row=>row.definition.id==='first-board');
  assert.equal(current.evaluations.length,1);assert.equal(current.evaluations[0].checkId,later.id);
  assert.equal(current.status,'missing-evidence');assert.equal(current.observations.length,0);
});
