'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {updateLifecycle}=require('../src/strategy/signal-pool-lifecycle');
const at=(day,hour='15:15:00')=>Date.parse(day+'T'+hour+'+08:00');
const d1='2026-11-04',d2='2026-11-05',d3='2026-11-06';
const pattern=(id='rule-a',side='bullish')=>({id,side,status:'matched'});
const row=(date,matched=[pattern()],patch={})=>({symbol:'600001',name:'研究样本',patternDate:date,
 quality:{usable:true,fresh:true,simulated:false},patterns:{usable:true,matched},...patch});
const run=(items,previous=[],now=at(d3))=>updateLifecycle({items,previous,now});
const seed=(date=d1,now=at(date))=>run([row(date)],[],now).states;
const state=(items,previous,now)=>run(items,previous,now).states[0];
test('first observation freezes date, research clock, rule identities and no invented confirmation',()=>{
 const result=run([row(d1,[pattern('b'),pattern('a'),pattern('a')])],[],at(d1));const s=result.states[0];
 assert.equal(s.stage,'observe');assert.deepEqual(s.discovery,{mode:'research-clock-only',firstSeenDate:d1,firstObservedAt:at(d1),firstMatched:['a','b'],continuousMatched:['a','b'],lastObservedAt:at(d1),confirmedDate:null,confirmedObservedAt:null,confirmationDelayMs:null});
 assert.deepEqual(result.pools['新发现观察池'][0].discovery,s.discovery);assert.equal(result.canTrade,false);assert.equal(result.canNotify,false);
});
test('same-day repeat freezes first receipt; a later dated shared rule records actual research-clock delay',()=>{
 const a=seed(),same=state([row(d1)],a,at(d1,'16:00:00'));assert.equal(same.streak,1);assert.equal(same.discovery.firstObservedAt,at(d1));assert.equal(same.discovery.confirmedDate,null);
 const b=state([row(d2)], [same],at(d2));assert.equal(b.stage,'focus');assert.equal(b.discovery.confirmedDate,d2);assert.equal(b.discovery.confirmedObservedAt,at(d2));assert.equal(b.discovery.confirmationDelayMs,at(d2)-at(d1));
 const c=state([row(d3)],[b],at(d3));assert.equal(c.discovery.confirmedDate,d2);assert.equal(c.discovery.firstSeenDate,d1);assert.equal(c.discovery.confirmationDelayMs,b.discovery.confirmationDelayMs);
});
test('different initial rule cannot inherit confirmation or elapsed latency',()=>{
 const a=seed();const b=state([row(d2,[pattern('rule-b')])],a,at(d2));
 assert.equal(b.discovery.firstSeenDate,d2);assert.equal(b.discovery.confirmedDate,null);
 const c=state([row(d3,[pattern('rule-b')])],[b],at(d3));assert.equal(c.discovery.confirmedDate,d3);assert.equal(c.discovery.confirmationDelayMs,at(d3)-at(d2));
});
test('risk veto clears a bullish streak; next clean observation is not promoted',()=>{
 const a=seed();const risky=state([row(d2,[pattern(),pattern('risk','bearish')])],a,at(d2));
 assert.equal(risky.stage,'risk-review');assert.equal(risky.streak,0);assert.equal(risky.discovery,null);
 const next=state([row(d3)],[risky],at(d3));assert.equal(next.stage,'observe');assert.equal(next.streak,1);assert.equal(next.discovery.firstSeenDate,d3);
});
test('same-day unavailable or risk state cannot restore stale focus streak',()=>{
 const a=seed(),b=state([row(d2)],a,at(d2));assert.equal(b.stage,'focus');
 for(const patch of [{quality:{usable:false,fresh:false,simulated:false}},{blockedBySafety:true}]){
  const bad=state([row(d2,[pattern()],patch)],[b],at(d2,'15:16:00'));
  const next=state([row(d2)],[bad],at(d2,'15:17:00'));assert.equal(next.stage,'observe');assert.equal(next.streak,1);assert.equal(next.discovery.confirmedDate,null);
 }
});
test('duplicate current symbol fails closed independent of input order and preserves older research date',()=>{
 const old=seed();const good=row(d2),bad=row(d2,[pattern('risk','bearish')]);
 for(const items of [[good,bad],[bad,good]]){const v=run(items,old,at(d2));assert.equal(v.states.length,1);assert.equal(v.states[0].dataStatus,'unavailable');assert.equal(v.states[0].lastSeen,d1);assert.equal(v.states[0].discovery,null);assert.equal(Object.values(v.pools).flat().length,0);}
});
test('duplicate or malformed prior state cannot authorize confirmation',()=>{
 const old=seed()[0];for(const previous of [[old,{...old,stage:'risk-review'}],[{...old,streak:Infinity}],[{...old,lastSeen:d3}]]){
  const v=run([row(d2)],previous,at(d2));assert.equal(v.states[0].dataStatus,'unavailable');assert.equal(v.states[0].confirmed,false);assert.equal(Object.values(v.pools).flat().length,0);
 }
});
test('older source date and backwards evaluation clock cannot replace newer research observation',()=>{
 const old=seed(d2,at(d2,'16:00:00'));
 for(const [date,now] of [[d1,at(d2,'16:01:00')],[d2,at(d2,'15:30:00')]]){
  const s=state([row(date)],old,now);assert.equal(s.dataStatus,'unavailable');assert.equal(s.lastSeen,d2);assert.equal(s.confirmed,false);
 }
});
test('invalid date, absent simulation qualification, or unusable pattern is not an opportunity',()=>{
 const old=seed();for(const value of [row(null),row(d2,[pattern()],{quality:{usable:'yes',fresh:true,simulated:false}}),row(d2,[pattern()],{quality:{usable:true,fresh:true}}),row(d2,[pattern()],{patterns:{usable:false,matched:[pattern()]}})]){
  const s=state([value],old,at(d2));assert.equal(s.dataStatus,'unavailable');assert.equal(s.lastSeen,d1);assert.equal(s.discovery,null);
 }
});
test('legacy state and same-clock replay never backfill a discovery delay',()=>{
 const legacy={...seed()[0]};delete legacy.discovery;
 const b=state([row(d2)],[legacy],at(d2));assert.equal(b.stage,'focus');assert.equal(b.discovery.firstSeenDate,d2);assert.equal(b.discovery.confirmationDelayMs,null);
 const sameClock=state([row(d2)],seed(d1,at(d2)),at(d2));assert.equal(sameClock.discovery.confirmedDate,null);assert.equal(sameClock.discovery.confirmationDelayMs,null);
});
test('mutated pool projection cannot rewrite frozen state and old-format state remains accepted',()=>{
 const a=run([row(d1)],[],at(d1));a.pools['新发现观察池'][0].discovery.firstMatched[0]='fake';assert.deepEqual(a.states[0].discovery.firstMatched,['rule-a']);
 const prev=JSON.parse(JSON.stringify(a.states)),b=state([row(d2)],prev,at(d2));b.discovery.firstMatched.push('new');assert.deepEqual(prev[0].discovery.firstMatched,['rule-a']);
});
test('an initially unavailable undated state can recover as a new observation',()=>{
 const missing=state([row(null)],[],at(d1));assert.equal(missing.lastSeen,null);assert.equal(missing.dataStatus,'unavailable');
 const good=state([row(d2)],[missing],at(d2));assert.equal(good.stage,'observe');assert.equal(good.discovery.firstSeenDate,d2);
});
test('alternating initial rules cannot pretend one rule persisted across all observations',()=>{
 const a=state([row(d1,[pattern('a'),pattern('b')])],[],at(d1));
 const b=state([row(d2,[pattern('a')])],[a],at(d2));assert.deepEqual(b.discovery.continuousMatched,['a']);
 const c=state([row(d3,[pattern('b')])],[b],at(d3));assert.equal(c.discovery.firstSeenDate,d3);assert.equal(c.discovery.confirmationDelayMs,null);
});
test('rollback quarantine keeps the evaluation watermark until time catches up',()=>{
 const a=seed(d2,at(d2,'16:00:00'));
 const b=state([row(d2)],a,at(d2,'15:30:00'));assert.equal(b.dataStatus,'unavailable');
 const c=state([row(d2)],[b],at(d2,'15:45:00'));assert.equal(c.dataStatus,'unavailable');assert.equal(c.evaluatedAt,at(d2,'16:00:00'));
 const d=state([row(d2)],[c],at(d2,'16:01:00'));assert.equal(d.stage,'observe');assert.equal(d.streak,1);
});
