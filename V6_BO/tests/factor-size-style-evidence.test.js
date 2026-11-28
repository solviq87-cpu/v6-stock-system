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
