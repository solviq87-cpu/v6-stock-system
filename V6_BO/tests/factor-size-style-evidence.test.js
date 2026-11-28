'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildSizePartition,compareSizeVersions}=require('../src/core/factor-size-style-evidence');
const day='2026-11-25',at=Date.parse(day+'T16:00:00+08:00'),source='archived-cap-provider',dataset='dataset-v1';
const options={provider:source,datasetId:dataset,signalDay:day};
const rows=()=>Array.from({length:10},(_,i)=>{const symbol=String(600000+i);return {symbol,signalAt:at,returnPct:i,values:{a:i,b:10-i},
 sizeEvidence:{symbol,tradeDate:day,source,datasetId:dataset,evidenceId:'cap-'+symbol,basis:'total-market-cap',unit:'CNY',valueYuan:(i+1)*1e9,observedAt:at-1000,knownAt:at-500}};});
const weights={original:{a:1,b:1},accepted:{a:1,b:2},proposed:{a:2,b:1}};
test('F29 complete frozen size partition rejects missing, duplicate, tied or late capital evidence',()=>{
 const input=rows(),p=buildSizePartition(input,options);
 assert.equal(p.status,'declared-point-in-time-partition');
 assert.deepEqual(p.groups[0].members.map(r=>r.symbol),input.slice(0,5).map(r=>r.symbol));
 assert.deepEqual(buildSizePartition(input.map(r=>({...r,returnPct:-999})),options),p);
 for(const mutate of [x=>delete x[1].sizeEvidence,x=>x[1].symbol=x[0].symbol,x=>x[4].sizeEvidence.valueYuan=x[5].sizeEvidence.valueYuan,
  x=>x[1].sizeEvidence.knownAt=at+1,x=>x[1].sizeEvidence.unit='shares',x=>x[1].sizeEvidence.datasetId='different']){
  const bad=rows();mutate(bad);assert.equal(buildSizePartition(bad,options).status,'unknown');
 }
});
test('F29 F12 three original versions use identical mature rows and earlier fixed groups',()=>{
 const input=rows(),partition=buildSizePartition(input,options),calls=[];
 const score=(ds,ids,w)=>{calls.push(ds[0].rows.map(x=>x.symbol));return {days:1,meanIC:w.a>w.b?.8:0};};
 const a=compareSizeVersions([{day,targetDate:'2026-12-02',rows:input,sizePartition:partition}],['a','b'],weights,score);
 assert.equal(a.pairedDays,1);assert.equal(a.rows[0].smallerMinusLargerGrossPct,-5);assert.equal(a.rows[0].versions.proposed.equalGroupIC,.8);
 assert.deepEqual(calls.slice(0,3),calls.slice(3,6));assert.deepEqual(calls.slice(0,3),calls.slice(6,9));assert.equal(a.canTrade,false);
 assert.equal(compareSizeVersions([{day,rows:input.slice(1),sizePartition:partition}],['a','b'],weights,score).status,'unknown');
});

const {styleShock}=require('../src/core/portfolio-defense-evidence');
test('F29 F45 relative size shock counts existing and remaining buy exposure and original fees once',()=>{
 const partition=buildSizePartition(rows(),options),h={eq:2000000,rows:[{symbol:'600000',value:500000},{symbol:'600009',value:300000}]},
 p={fees:500,rows:[{symbol:'600000',value:100000}]},a={version:'fixed',gapPct:10,liquidityPriceShockPct:5,additionalLiquidationCostBps:300};
 const r=styleShock(h,p,partition,a);
 assert.equal(r.status,'conditional-style-scenarios');assert.equal(r.scenarios[0].heldMarkLoss,725);assert.equal(r.scenarios[0].additionalPendingMarkLoss,145);
 assert.equal(r.scenarios[0].allPendingFillLoss,875);assert.equal(r.scenarios[0].allPendingFillEquityAfter,19125);assert.equal(r.scenarios[1].heldMarkLoss,435);
 assert.equal(r.scenarios[0].canTrade,false);assert.equal(r.realizedLoss,null);assert.equal(r.otherGroupUnchanged,true);
 for(const bad of [null,{...p,rows:[{symbol:'999999',value:100000}]},{...p,fees:null}])assert.equal(styleShock(h,bad,partition,a).status,'unknown');
 assert.equal(styleShock(h,p,partition,{...a,gapPct:NaN}).status,'unknown');
 assert.equal(styleShock(h,p,null,a).status,'unknown');
});

test('F29 repeated exact stock evidence counts once; conflicting repeated signal invalidates size partition',()=>{
 const input=rows(),prior=buildSizePartition(input,options);
 const repeated=[...input,{...input[0],signalId:'other-rule'}],result=buildSizePartition(repeated,options);
 assert.equal(result.status,'declared-point-in-time-partition');assert.equal(result.expected,10);assert.equal(result.originalSignalCount,11);
 assert.equal(result.duplicateSignalCount,1);assert.deepEqual(result.groups,prior.groups);
 const bad={...input[0],signalId:'other-rule',sizeEvidence:{...input[0].sizeEvidence,valueYuan:2e9}};
 assert.equal(buildSizePartition([...input,bad],options).status,'unknown');
});

test('F29 adjacent prior frozen reference uses only original nonconflicting known calendar edges',()=>{
 const {sizeReferenceDays}=require('../src/core/factor-size-style-evidence'),prior='2026-11-24',c={days:[prior,day],nextEvidenceByDay:{[prior]:{nextTradingDay:day,source:'archive',knownAt:at-1}},conflictingDays:[]};
 assert.deepEqual(sizeReferenceDays(c,at),[day,prior]);
 assert.deepEqual(sizeReferenceDays(null,at),[day]);
 assert.deepEqual(sizeReferenceDays({...c,conflictingDays:[prior]},at),[day]);
 assert.deepEqual(sizeReferenceDays({...c,nextEvidenceByDay:{[prior]:{...c.nextEvidenceByDay[prior],knownAt:at+1}}},at),[day]);
 assert.deepEqual(sizeReferenceDays({...c,days:[day,prior]},at),[day]);
});

test('F29.3 overlapping frozen groups cannot conceal a missing member or inflate the same-sample IC',()=>{
 const input=rows(),p=buildSizePartition(input,options),calls=[];
 const score=(ds,ids,w)=>{calls.push(ds[0].rows.length);return {days:1,meanIC:.5};};
 const run=partition=>compareSizeVersions([{day,targetDate:'2026-12-02',rows:input,sizePartition:partition}],['a','b'],weights,score);
 const overlap={...p,groups:[p.groups[0],{...p.groups[1],members:[p.groups[0].members[0],...p.groups[1].members.slice(1)]}]};
 assert.equal(run(overlap).status,'unknown');assert.equal(calls.length,0);
 for(const bad of [{...p,signalDay:'2026-11-24'},{...p,expected:11},{...p,observed:9},{...p,groups:p.groups.slice().reverse()},
  {...p,groups:[p.groups[0],{...p.groups[1],members:[null,...p.groups[1].members.slice(1)]}]}]){
  assert.equal(run(bad).status,'unknown');assert.equal(calls.length,0);
 }
 assert.equal(run(p).pairedDays,1);assert.equal(calls.length,9);
});

test('F29.3/F47.4 a partially matured original size cohort cannot hide an omitted member even with five observations per group',()=>{
 const input=Array.from({length:12},(_,i)=>{const symbol=String(600000+i);return {symbol,signalAt:at,returnPct:i,values:{a:i,b:12-i},sizeEvidence:{symbol,tradeDate:day,source,datasetId:dataset,evidenceId:'cap-'+symbol,basis:'total-market-cap',unit:'CNY',valueYuan:(i+1)*1e9,observedAt:at-1000,knownAt:at-500}};});
 const p=buildSizePartition(input,options),calls=[];
 const score=(ds,ids,w)=>{calls.push(ds[0].rows.length);return {days:1,meanIC:.5};};
 const run=rows=>compareSizeVersions([{day,targetDate:'2026-12-02',rows,sizePartition:p}],['a','b'],weights,score);
 assert.equal(p.expected,12);
 for(const missing of [0,5,6,11]){
  const r=run(input.filter((_,i)=>i!==missing));
  assert.equal(r.status,'unknown');assert.equal(r.pairedDays,0);assert.equal(r.expectedDays,1);assert.deepEqual(r.rows,[]);assert.equal(calls.length,0);
 }
 const r=run(input);assert.equal(r.pairedDays,1);assert.deepEqual(calls,[12,6,6,12,6,6,12,6,6]);assert.equal(r.canTrade,false);
});

test('F29.4/F45 style pressure requires the whole original frozen cohort, including securities not held',()=>{
 const partition=buildSizePartition(rows(),options),h={eq:2000000,rows:[{symbol:'600000',value:500000},{symbol:'600009',value:300000}]},
 p={fees:500,rows:[{symbol:'600000',value:100000}]},a={version:'fixed',gapPct:10,liquidityPriceShockPct:5,additionalLiquidationCostBps:300};
 const [small,large]=partition.groups;
 const invalid=[
  {...partition,groups:[{...small,members:small.members.slice(0,-1)},large]},
  {...partition,groups:[small,{...large,members:large.members.slice(1)}]},
  {...partition,expected:11},
  {...partition,observed:9},
  {...partition,groups:[large,small]},
  {...partition,groups:[null,large]},
  {...partition,groups:[{...small,members:[...small.members,large.members[0]]},{...large,members:large.members.slice(1)}]},
  {...partition,expected:8,observed:8,groups:[{...small,members:small.members.slice(0,3)},large]}
 ];
 for(const bad of invalid){
  const r=styleShock(h,p,bad,a);
  assert.equal(r.status,'unknown');assert.deepEqual(r.scenarios,[]);assert.equal(r.canTrade,false);
 }
 const valid=styleShock(h,p,partition,a);
 assert.equal(valid.status,'conditional-style-scenarios');assert.equal(valid.scenarios.length,2);
 assert.equal(valid.scenarios[0].allPendingFillLoss,875);assert.equal(valid.canTrade,false);
});
