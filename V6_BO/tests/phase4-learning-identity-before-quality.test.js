'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readLearningRows,learningAction,predict}=require('../public/nova/shortline/learning.mjs');
const {candidateEvidenceReview,approvedModelEvidenceReview,uniqueEvidenceRows}=require('../public/nova/shortline/sample-quality.mjs');
const {buildIntelligenceResearch}=require('../src/core/intelligence-research');
const day='2024-06-10',now=Date.parse(day+'T15:10:00+08:00'),id='trade-1',planId='plan-1';
const trade=()=>({id,planId,checkId:'check-1',code:'600000',date:'2024-06-06',entryTime:'2024-06-06T09:32',exitTime:'2024-06-07T11:00',exitDate:'2024-06-07',
 createdAt:'2024-06-07T03:01:00Z',snapshotVerified:true,repeatable:true,source:'V6 模拟成交',pnl:3,strategy:'趋势',factors:['承接']});
const plan=()=>({id:planId,code:'600000',frozenAt:'2024-06-05T07:06:00Z'});
const check=()=>({id:'check-1',code:'600000',date:'2024-06-05',asOf:'2024-06-05 15:00',createdAt:'2024-06-05T07:05:00Z',factorCodes:['TL-01']});
const state=()=>({scope:'live',trades:[trade()],plans:[plan()],checks:[check()],bars:[],candidates:[],versions:[]});
const rows=s=>readLearningRows(s,now).filter(r=>r.learningOutcomeBasis==='recorded-settlement');
const proof={accountId:'pool',exitEventId:'event-1'};
const cases=[
 ['clean original settlement',s=>{},1,1],
 ['exact retry',s=>s.trades.push({...s.trades[0]}),1,1],
 ['invalid pnl copy',s=>s.trades.push({...s.trades[0],pnl:null}),0,0],
 ['missing receipt copy',s=>s.trades.push({...s.trades[0],createdAt:null}),0,0],
 ['malformed receipt copy',s=>s.trades.push({...s.trades[0],createdAt:'bad-clock'}),0,0],
 ['future exit is not later archive proof',s=>s.trades.push({...s.trades[0],exitTime:'2024-06-11T11:00',exitDate:'2024-06-11'}),0,0],
 ['quality tag cannot conceal same identity',s=>s.trades.push({...s.trades[0],blackSwan:true}),0,0],
 ['malformed secondary alias must keep local ID conflict',s=>s.trades.push({...s.trades[0],paperSettlement:{accountId:'pool',exitEventId:null}}),0,0],
 ['same exit event different ID invalid copy',s=>{s.trades[0].paperSettlement=proof;s.trades.push({...s.trades[0],id:'other',pnl:null});},0,0],
 ['explicitly later creation',s=>s.trades.push({...s.trades[0],createdAt:new Date(now+1).toISOString(),pnl:99}),1,1],
 ['explicitly later recording',s=>s.trades.push({...s.trades[0],recordedAt:new Date(now+1).toISOString(),pnl:null}),1,1],
 ['separate demo copy',s=>s.trades.push({...s.trades[0],sampleSet:'demo',pnl:99}),1,1],
 ['separate synthetic copy',s=>s.trades.push({...s.trades[0],synthetic:true,pnl:99}),1,1],
 ['missing local ID with settlement alias',s=>{s.trades[0].id=null;s.trades[0].paperSettlement=proof;},0,0],
 ['malformed frozen plan copy',s=>s.plans.push({...s.plans[0],code:'600999',frozenAt:'bad'}),1,0],
 ['explicit later frozen plan',s=>s.plans.push({...s.plans[0],frozenAt:new Date(now+1).toISOString(),code:'600999'}),1,1],
 ...[{sampleSet:'demo'},{sampleSet:'synthetic'},{sampleScope:'demo'},{simulated:true},{fixture:true},{mock:true},{source:'fixture'},{quality:'演示样本'}].map((patch,i)=>['teaching marker '+i,s=>Object.assign(s.trades[0],patch),0,0])
];
for(const [name,alter,training,center] of cases)test('strict settlement identity: '+name,()=>{
 const s=state();alter(s);const before=JSON.stringify(s);
 assert.equal(rows(s).length,training);
 assert.equal(buildIntelligenceResearch({day,now,archive:s}).feedback.matureTrades,center);
 assert.equal(JSON.stringify(s),before);
});
test('check identity is resolved before filtering mismatched security or malformed time',()=>{
 for(const patch of [{code:'600999'},{createdAt:'bad-clock'},{factorCodes:['TL-02']}]){
  const s=state();s.checks.push({...s.checks[0],...patch});
  assert.equal(rows(s).length,1);assert.ok(!rows(s)[0].factors.includes('TL-01'));assert.equal(rows(s)[0].numericFactors,null);
 }
 const s=state();s.checks.push({...s.checks[0],createdAt:'2024-06-07T03:01:00Z',code:'600999'});
 assert.ok(rows(s)[0].factors.includes('TL-01'));
});
test('known source conflict blocks candidate approval and approved scoring without rewriting the model',()=>{
 const s=state(),names=['训练集验证','时间外验证','样本外测试','成本压力校验','风险检查'];
 const c={id:'candidate',createdAt:'2024-06-08T08:00:00Z',baseVersion:0,status:'待人工审批',sampleScope:'live',
 sourceIds:[id],steps:names.map(name=>({name,status:'通过'})),weights:{'承接':2},threshold:0,strategyThresholds:{},minSupport:6};
 s.candidates=[c];s.trades.push({...s.trades[0],pnl:null});
 assert.equal(candidateEvidenceReview(s,c,now).status,'requires-revalidation');
 assert.equal(candidateEvidenceReview(s,c,now).affectedSources,1);
 const before=JSON.stringify(s);
 assert.throws(()=>learningAction(s,'learn:decision',{id:c.id,decision:'approve',reviewer:'隔离验证',reason:'来源冲突'}),/来源样本.*重新独立验证/);
 assert.equal(JSON.stringify(s),before);
 const v={number:1,candidateId:c.id,approvedAt:'2024-06-09T08:00:00Z',weights:c.weights,threshold:0,strategyThresholds:{},minSupport:6};
 s.versions=[v];
 assert.equal(approvedModelEvidenceReview(s,v,now).status,'requires-revalidation');
 assert.equal(predict(s,{asOf:now,factors:['承接']}).score,null);
});
test('later and teaching duplicates do not falsely revoke an earlier real source',()=>{
 const s=state(),c={sourceIds:[id],createdAt:'2024-06-08T08:00:00Z'};
 s.trades.push({...s.trades[0],sampleSet:'demo',pnl:99},{...s.trades[0],createdAt:new Date(now+1).toISOString(),pnl:null});
 assert.equal(candidateEvidenceReview(s,c,now).status,'no-known-revocation');
 assert.equal(candidateEvidenceReview(s,c,now+1).status,'requires-revalidation');
});
test('malformed secondary alias retains local ID for conflict audit',()=>{
 const good={...trade(),paperSettlement:proof},bad={...good,paperSettlement:{accountId:'pool'}};
 const out=uniqueEvidenceRows([good,bad],{requireIdentity:true,settlements:true});
 assert.equal(out.rows.length,0);assert.equal(out.conflicts,2);
});
