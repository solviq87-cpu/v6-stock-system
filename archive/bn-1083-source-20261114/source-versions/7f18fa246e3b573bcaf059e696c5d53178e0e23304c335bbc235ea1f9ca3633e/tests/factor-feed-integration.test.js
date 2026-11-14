 'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateCandidate,rankCandidates}=require('../src/strategy/strategy-service');
const factors=require('../strategies/extended-factor-pack.json').factors;
const now=Date.parse('2026-11-04T10:00:00Z');
const bars=Array.from({length:35},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,open:10,high:11,low:9,close:10,volume:100000+i*1000}));
const stock={code:'000001',close:10,bars,feed:{source:'eastmoney',timestamp:now}};
for(const f of factors)stock[f.field]=80;
const evidence=Object.fromEntries(factors.map(f=>[f.field,{source:'eastmoney',timestamp:now}]));
test('默认评分不受行情门禁影响',()=>{
 assert.equal(evaluateCandidate({stock}).finalScore,evaluateCandidate({stock,factorOptions:{requireFeedValidation:false}}).finalScore);
});
test('行情门禁拒绝无行情元信息的扩展因子',()=>{
 const r=evaluateCandidate({stock:{...stock,feed:undefined,factorEvidence:evidence},factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(r.extendedFactors.available,0);assert.equal(r.factorFusion.applied,false);assert.equal(r.feedQuality.usable,false);
});
test('行情门禁拒绝模拟行情与伪造来源证据',()=>{
 const a=evaluateCandidate({stock:{...stock,feed:{source:'simulated',timestamp:now},factorEvidence:evidence},factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(a.extendedFactors.available,0);
 const b=evaluateCandidate({stock:{...stock,factorEvidence:Object.fromEntries(factors.map(f=>[f.field,{source:'akshare',timestamp:now}]))},factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(b.extendedFactors.available,0);
});
test('行情门禁拒绝过期行情与超前因子证据',()=>{
 const a=evaluateCandidate({stock:{...stock,feed:{source:'eastmoney',timestamp:now-3600000},factorEvidence:evidence},factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(a.extendedFactors.available,0);assert.equal(a.feedQuality.fresh,false);
 const future=Object.fromEntries(factors.map(f=>[f.field,{source:'eastmoney',timestamp:now+120000}]));
 const b=evaluateCandidate({stock:{...stock,factorEvidence:future},factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(b.extendedFactors.available,0);
});
test('批量评分隔离每只股票的行情证据',()=>{
 const good={...stock,factorEvidence:evidence};const bad={...stock,code:'000002',feed:{source:'simulated',timestamp:now},factorEvidence:evidence};
 const rs=rankCandidates({stocks:[good,bad],factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(rs.find(x=>x.snapshot.code==='000001').extendedFactors.available,15);
 assert.equal(rs.find(x=>x.snapshot.code==='000002').extendedFactors.available,0);
});

test('过期因子证据不得复用新鲜行情通过校验',()=>{
 const stale=Object.fromEntries(factors.map(f=>[f.field,{source:'eastmoney',timestamp:now-3600000}]));
 const r=evaluateCandidate({stock:{...stock,factorEvidence:stale},factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(r.extendedFactors.available,0);
});
test('严格阻断开关拒绝模拟行情但默认兼容不变',()=>{
 const fake={...stock,feed:{source:'simulated',timestamp:now},factorEvidence:evidence};
 const r=evaluateCandidate({stock:fake,factorOptions:{requireFeedValidation:true,blockUntrustedCandidates:true,asOf:now}});
 assert.equal(r.pass,false);assert.equal(r.feedBlocked,true);
 const compatible=evaluateCandidate({stock:fake,factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(compatible.feedBlocked,false);
});
test('批量评分严格阻断仅针对不可信股票',()=>{
 const rs=rankCandidates({stocks:[{...stock,factorEvidence:evidence},{...stock,code:'000002',feed:{source:'simulated',timestamp:now}}],factorOptions:{requireFeedValidation:true,blockUntrustedCandidates:true,asOf:now}});
 assert.equal(rs.find(x=>x.snapshot.code==='000002').feedBlocked,true);
 assert.equal(rs.find(x=>x.snapshot.code==='000001').feedBlocked,false);
});
