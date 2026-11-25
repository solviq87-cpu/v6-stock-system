'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateTemplateLibrary}=require('../src/core/intelligence-templates');
const {buildIntelligenceResearch}=require('../src/core/intelligence-research');
const catalog=require('../public/nova/shortline/catalog.json');
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
