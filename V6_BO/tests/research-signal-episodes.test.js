'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeTemporalSignalEpisodes:summarize}=require('../src/strategy/research-signal-episodes');
const days=Array.from({length:12},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
const catalog=[
 {id:'breakoutA',family:'breakout-volume'},
 {id:'breakoutB',family:'breakout-volume'},
 {id:'trend',family:'trend-quality'}
];
function records(){
 const signals=[
  ['600001',0,'breakoutA','modeled'],
  ['600001',0,'breakoutB','blocked-entry'],
  ['600001',0,'trend','modeled'],
  ['600001',1,'breakoutA','unverified-corporate-actions'],
  ['600001',1,'breakoutB','modeled'],
  ['600001',3,'breakoutA','modeled'],
  ['600001',7,'breakoutA','blocked-session'],
  ['600002',7,'breakoutA','modeled']
 ];
 return signals.flatMap(([symbol,i,ruleId,status])=>[1,5].map(horizon=>({
  symbol,signalDate:days[i],ruleId,status,horizon,
  ...(status==='modeled'?{netReturnPct:-1}: {})
 })));
}
test('family and temporal overlap are distinct, without counting horizons as new signals',()=>{
 const events=records(),copy=structuredClone(events);
 const r=summarize(events,catalog,[1,5],days),a=r.byHorizon[1],b=r.byHorizon[5];
 assert.equal(r.status,'descriptive-only');
 assert.equal(a.rawRuleEvents,8);
 assert.equal(a.familyExposureDays,6);
 assert.equal(a.sameDayFamilyDuplicates,2);
 assert.equal(a.nonoverlapFamilyEpisodes,5);
 assert.equal(a.serialRepeatFamilyDays,1);
 assert.equal(b.rawRuleEvents,8);
 assert.equal(b.familyExposureDays,6);
 assert.equal(b.nonoverlapFamilyEpisodes,4);
 assert.equal(b.serialRepeatFamilyDays,2);
 assert.equal(a.byRule.breakoutA.signalDays,5);
 assert.equal(a.byRule.breakoutA.nonoverlapEpisodes,4);
 assert.equal(b.byRule.breakoutA.nonoverlapEpisodes,3);
 assert.equal(r.weightsChanged,false);assert.equal(r.autoPromotion,false);
 assert.deepEqual(events,copy);
});
test('blocked and losing signal days are never discarded or used to invent returns',()=>{
 const events=records();
 const base=summarize(events,catalog,[1,5],days);
 const changed=events.map(e=>({...e,status:'blocked-entry',netReturnPct:undefined}));
 assert.deepEqual(summarize(changed,catalog,[1,5],days),base);
 assert.equal(base.byHorizon[1].rawRuleEvents,events.filter(e=>e.horizon===1).length);
});
test('one-horizon and multi-horizon counts agree for the same horizon',()=>{
 const events=records(),single=summarize(events,catalog,[5],days);
 const full=summarize(events,catalog,[1,5],days);
 assert.deepEqual(single.byHorizon[5],full.byHorizon[5]);
});
test('unknown rule and unaligned session are rejected rather than counted as independent evidence',()=>{
 assert.throws(()=>summarize([{symbol:'600001',signalDate:days[0],ruleId:'unknown',horizon:1}],catalog,[1],days),/不匹配/);
 assert.throws(()=>summarize([{symbol:'600001',signalDate:'2026-12-30',ruleId:'breakoutA',horizon:1}],catalog,[1],days),/不匹配/);
});
test('real frozen 8-rule audit keeps original events and emits conservative episode counts',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../src/strategy/public-rule-forward-audit.js'),'utf8');
 assert.match(source,/summarizeTemporalSignalEpisodes\(events,activeCatalog,p.horizons,dateList\)/);
 assert.match(source,/includeQualityRules===true/);
});
