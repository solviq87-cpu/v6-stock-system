'use strict';
// Deterministic counterexamples only; never ingest these fixtures as market evidence.
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildThemeCrowding}=require('../src/core/deep-research-evidence');
const t=Date.parse('2026-11-27T10:00:00+08:00');
const make=()=>{
  const members=['600000','600001','600002','600003','600004'];
  return {id:'theme-1',revision:1,source:'supplied-provider',evidenceId:'proof-1',
    publishedAt:t,firstKnownAt:t,recordedAt:t,name:'研究题材',membershipComplete:true,
    snapshotAt:t,members,stocks:members.map((symbol,i)=>({symbol,amount:[60,20,10,5,5][i],
      turnoverPct:12,changePct:6,limitUp:i<2,quoteAt:t,source:'supplied-quotes'}))};
};
function assess(edit,asOf=t){
  const q=make();edit(q);return buildThemeCrowding({themes:[q]},{asOf});
}
for(const [name,edit] of [
  ['future receipt',q=>q.stocks[0].receivedAt=t+1],
  ['explicitly unknown receipt',q=>q.stocks[0].receivedAt=null],
  ['knowledge before original quote',q=>q.stocks[0].knownAt=t-1],
  ['missing member',q=>q.stocks.pop()],
  ['member recorded after parent record',q=>q.stocks[0].recordedAt=t+1],
  ['knowledge after parent first known',q=>q.stocks[0].firstKnownAt=t+1]
]){
  test('C 22.2 incomplete or inconsistent member: '+name,()=>{
    const r=assess(edit),row=r.rows[0];
    assert.equal(row.coveragePct,80);
    assert.equal(row.current,false);
    assert.equal(row.status,'partial-data');
    assert.equal(row.metrics.turnoverConcentrationTop3Pct,null);
    assert.equal(r.riskObservations.length,0);
    assert.equal(r.canTrade,false);
    assert.equal(r.canNotify,false);
  });
}
test('C 22.2 valid receipt after quote but within parent knowledge retains original quote',()=>{
  const r=assess(q=>{
    q.snapshotAt=t-5;
    for(const s of q.stocks){s.quoteAt=t-5;s.receivedAt=t;}
  });
  assert.equal(r.rows[0].coveragePct,100);
  assert.equal(r.rows[0].current,true);
  assert.equal(r.rows[0].memberEvidence[0].quoteAt,t-5);
  assert.equal(r.riskObservations.length,1);
});
test('C 22.2 legacy complete parent provenance retains research observation',()=>{
  const r=assess(()=>{});
  assert.equal(r.rows[0].metrics.turnoverConcentrationTop3Pct,90);
  assert.equal(r.rows[0].current,true);
  assert.equal(r.riskObservations.length,1);
  assert.equal(r.riskObservations[0].isTradeInstruction,false);
});
test('C 22.2 stale member quotes are not renewed by fresh parent or receipt',()=>{
  const r=assess(q=>{for(const s of q.stocks){s.quoteAt=t-15001;s.receivedAt=t;}});
  assert.equal(r.rows[0].coveragePct,100);
  assert.equal(r.rows[0].current,false);
  assert.equal(r.riskObservations.length,0);
});
