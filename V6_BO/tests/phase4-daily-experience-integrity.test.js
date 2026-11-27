'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildReview,mistakeSummary}=require('../public/nova/shortline/review.mjs');
const {predict,readLearningRows}=require('../public/nova/shortline/learning.mjs');
const {sampleEvidenceTime,settlementObservation,uniqueEvidenceRows}=require('../public/nova/shortline/sample-quality.mjs');
const day='2026-11-20',cutoff=Date.parse(day+'T16:00:00+08:00'),before=Date.parse(day+'T15:00:00+08:00');
const t=(patch={})=>({id:'t1',code:'600001',name:'甲',date:day,strategy:'趋势',trend:'多头',factors:['承接'],
 entryTime:day+'T09:30',exitTime:day+'T14:00',createdAt:day+'T06:01:00Z',pnl:3,snapshotVerified:true,repeatable:true,...patch});
const check=(patch={})=>({id:'c1',code:'600001',name:'甲',date:day,createdAt:day+'T05:00:00Z',asOf:day+' 13:00',position:10,strategy:'趋势',...patch});
const report=(state,asOf=cutoff)=>buildReview(state,{date:day,depth:'deep',asOf});
test('sample clocks reject impossible dates, time rollover and date-only receipts',()=>{
 for(const v of ['2026-02-30 15:00','2026-11-20 24:00','2026-11-20 14:99','2026-11-20',cutoff+.5])
  assert.equal(sampleEvidenceTime(v),null);
 assert.equal(sampleEvidenceTime(day+' 16:00'),cutoff);
 assert.equal(sampleEvidenceTime(day+'T08:00:00Z'),cutoff);
});
test('daily review cannot include late checks, late settlements or entries with no exit',()=>{
 const state={checks:[check(),check({id:'late',name:'迟到校验',createdAt:day+'T08:00:01Z'})],
  trades:[t(),t({id:'later',name:'迟到结算',createdAt:day+'T08:00:01Z'}),t({id:'open',name:'未平仓',exitTime:null}),
   t({id:'bad',name:'倒序记录',entryTime:day+'T14:30'})]};
 const out=report(state);
 assert.equal(out.totals.checks,1);assert.equal(out.totals.trades,1);
 assert.equal(out.evidenceScope.withheldChecks,1);
 for(const s of ['迟到校验','迟到结算','未平仓','倒序记录'])assert.ok(!out.text.includes(s));
 assert.equal(report(state,before).totals.trades,1);
});
test('review distinguishes unknown legacy receipt from known experience and preserves post-review annotations',()=>{
 const state={trades:[t({createdAt:undefined,pnl:-5,knownRiskFactors:['未核验风险']})],
  notes:[{id:'n',kind:'annotation',date:day,text:'以后补写的解释',createdAt:'2026-11-21T01:00:00Z'}]};
 const out=report(state);
 assert.equal(out.totals.trades,1);assert.equal(out.evidenceScope.legacyUnclockedTrades,1);
 assert.ok(out.text.includes('仅描述性复盘'));assert.ok(out.text.includes('事后或时点待核批注'));
 assert.ok(out.groups.find(g=>g.title==='高频亏损与体系优化').lines.every(l=>!l.includes('未核验风险')));
 assert.equal(readLearningRows(state,cutoff).length,0);
});
test('duplicate visible settlements count once, conflicting identities contribute no experience',()=>{
 const a=t(),same=JSON.parse(JSON.stringify(a)),conflict={...a,pnl:-4};
 let out=report({trades:[a,same]});
 assert.equal(out.totals.trades,1);assert.equal(out.evidenceScope.duplicateTrades,1);
 assert.equal(predict({trades:[a,same]},{asOf:cutoff}).n,1);
 out=report({trades:[a,conflict]});
 assert.equal(out.totals.trades,0);assert.equal(out.evidenceScope.tradeConflicts,2);
 assert.equal(predict({trades:[a,conflict]},{asOf:cutoff}).n,0);
 const late={...conflict,createdAt:day+'T08:00:01Z'};
 assert.equal(predict({trades:[a,late]},{asOf:cutoff}).n,1);
});
test('original paper settlement identity cannot be multiplied using a different local id',()=>{
 const p={accountId:'pool',exitEventId:'sell-1'};
 const a=t({paperSettlement:p}),b={...a,id:'different',pnl:10};
 assert.equal(uniqueEvidenceRows([a,b],{settlements:true}).rows.length,0);
 assert.equal(predict({trades:[a,b]},{asOf:cutoff}).n,0);
 assert.equal(predict({trades:[a,a]},{asOf:cutoff}).n,1);
});
test('receipt before actual settlement or a future exact-second exit is not a mature sample',()=>{
 for(const patch of [{createdAt:day+'T05:00:00Z'},{exitTimestamp:cutoff+1},
  {knownAt:cutoff+1},{pnl:true},{pnl:'3'}]){
  const row=t(patch);assert.equal(settlementObservation(row,cutoff,{requireReceipt:true}),null);
  assert.equal(readLearningRows({trades:[row]},cutoff).length,0);
 }
 const row=t({exitTimestamp:cutoff,exitTime:day+'T16:00',createdAt:new Date(cutoff).toISOString()});
 assert.equal(readLearningRows({trades:[row]},cutoff).length,1);
});
test('same-purpose comparison keeps teaching copies outside formal prediction',()=>{
 const a=t(),demo={...a,sampleSet:'test',pnl:90};
 const p=predict({scope:'live',trades:[a,demo]},{asOf:cutoff});
 assert.equal(p.n,1);assert.equal(p.experience.cohorts[0].references[0].returnPct,3);
 assert.equal(p.experience.calibratedProbability,null);assert.equal(p.experience.canTrade,false);
});
test('conditional experience exposes success, failure, flat and source references without inventing a calibrated probability',()=>{
 const rows=[t(),t({id:'t2',code:'600002',pnl:-2}),t({id:'t3',code:'600003',pnl:0})];
 const state={trades:rows},old=JSON.stringify(state);
 const p=predict(state,{asOf:cutoff,strategy:'趋势',trend:'多头',factors:['承接']});
 const [settled,kline]=p.experience.cohorts;
 assert.equal(p.n,3);assert.equal(settled.n,3);assert.equal(settled.wins,1);assert.equal(settled.losses,1);assert.equal(settled.flat,1);
 assert.deepEqual(settled.references.map(r=>r.outcome).sort(),['flat','negative','positive']);
 assert.equal(kline.n,0);assert.equal(settled.supportSufficient,false);
 assert.equal(p.experience.mixedOutcomeBases,false);assert.equal(p.experience.calibratedProbability,null);
 assert.equal(JSON.stringify(state),old);
});
test('a later or different-stock plan cannot be described as the actual pre-entry plan',()=>{
 const row=t({planId:'p'}),base={id:'p',code:row.code,frozenAt:day+' 09:00',logic:'事前逻辑'};
 for(const patch of [{frozenAt:day+' 10:00'},{code:'600002'},{knownAt:day+' 10:00'}]){
  const r=report({trades:[row],plans:[{...base,...patch}]});
  assert.ok(!r.text.includes('事前逻辑'));
 }
 assert.ok(report({trades:[row],plans:[base]}).text.includes('事前逻辑'));
});
test('historical mistake counts do not double count or import tomorrow’s known losses',()=>{
 const row=t({pnl:-3,violations:['追高'],knownRiskFactors:['风险']});
 const late={...row,id:'late',createdAt:'2026-11-21T01:00:00Z'};
 const result=mistakeSummary({trades:[row,row,late]},day);
 assert.deepEqual(result.map(x=>x.count),[1,1]);
});

test('automatic historical review shows late settlement and check only as retrospective archive additions',()=>{
 const row=t({name:'历史成交补录',createdAt:'2026-11-21T01:00:00Z'}),c=check({name:'历史校验补录',createdAt:'2026-11-21T01:00:00Z'});
 const state={trades:[row],checks:[c]};
 const out=buildReview(state,{date:day,depth:'deep'}),group=out.groups.find(g=>g.title.startsWith('事后补录'));
 assert.equal(out.totals.trades,0);assert.equal(out.totals.checks,0);
 assert.ok(group.lines.some(x=>x.includes(row.name)));assert.ok(group.lines.some(x=>x.includes(c.name)));
 assert.ok(!out.tags.includes(row.name));assert.ok(!out.groups.find(g=>g.title==='下一交易日预案').lines.some(x=>x.includes(c.name)));
 assert.ok(!report(state).groups.some(g=>g.title.startsWith('事后补录')));
 assert.equal(readLearningRows(state,cutoff).length,0);
});
test('settlement aliases and later receipt boundaries do not backdate the experience label',()=>{
 const exit=Date.parse(day+'T14:00:00+08:00');
 assert.equal(settlementObservation(t({exitTimestamp:exit-60000}),cutoff),null);
 assert.equal(settlementObservation(t({exitDate:'2026-11-19'}),cutoff),null);
 assert.equal(settlementObservation(t({recordedAt:day+'T05:59:59Z'}),cutoff),null);
 const row=t({exitTimestamp:exit+30000,recordedAt:day+'T07:00:01Z'});
 const obs=settlementObservation(row,cutoff,{requireReceipt:true});
 assert.equal(obs.knownAt,Date.parse(day+'T07:00:01Z'));
 assert.equal(readLearningRows({trades:[row]},cutoff)[0].labelKnownAt,day+'T15:01');
});
test('same ID teaching check or later correction cannot replace the pre-entry dictionary observation',()=>{
 const row=t({checkId:'c1'}),c=check({createdAt:day+'T01:20:00Z',asOf:day+' 09:19',factorCodes:['TL-02']});
 const late={...c,createdAt:day+'T07:00:00Z',factorCodes:['GG-01']};
 const demo={...c,sampleSet:'test',factorCodes:['GG-01']};
 const f=checks=>readLearningRows({trades:[row],checks},cutoff)[0].factors;
 assert.ok(f([c,late,demo]).includes('TL-02'));assert.ok(!f([c,late,demo]).includes('GG-01'));
 assert.ok(!f([c,{...c,factorCodes:['GG-01']}]).includes('TL-02'));
});
