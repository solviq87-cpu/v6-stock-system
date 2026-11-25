'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {decisionFeedbackHttp}=require('../src/server/decision-feedback-http');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const {feedbackFixture}=require('./helpers/intelligence-feedback-fixture');
const day='2026-11-25',now=Date.parse(day+'T16:00:00+08:00'),fingerprint='a'.repeat(64);
const input={day,revision:1,proposalFingerprint:fingerprint};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function http(options={}){
  const response={},calls=[];
  const req={method:options.method||'POST',headers:{host:'localhost',...options.headers}};
  const res={writeHead:(status,headers)=>Object.assign(response,{status,headers}),end:value=>{response.body=JSON.parse(value);}};
  await decisionFeedbackHttp(req,res,{body:options.body??JSON.stringify(options.input??input),
    url:new URL('http://localhost/api/decision-center/feedback'+(options.query||'')),authenticate:options.authenticate||(()=>true),
    isReplica:options.isReplica||(()=>false),isOpenDay:options.isOpenDay||((value)=>value===day),root:'/private/shortline',historyRoot:'/private/shortline/center-history',clock:()=>now,
    job:async(payload,control)=>{calls.push({payload,control});return options.job?options.job(payload,control):{ok:true,result:{candidateId:'candidate-original',status:'待人工审批'}};}});
  return {...response,calls};
}

test('HTTP只转发日期版本和指纹，并把实时授权函数留在主线程',async()=>{
  const r=await http();assert.equal(r.status,200);assert.equal(r.calls.length,1);
  assert.deepEqual(r.calls[0].payload,{action:'intelligence-feedback',root:'/private/shortline',historyRoot:'/private/shortline/center-history',
    book:'main',replica:false,day,now,revision:1,proposalFingerprint:fingerprint});
  assert.equal(r.calls[0].control.authorize(),true);
  assert.match(r.headers['Cache-Control'],/private.*no-store/);assert.equal(r.body.result.candidateId,'candidate-original');
});

test('HTTP拒绝任意weights、路径/时钟注入、错账户、错误日期和缺失交易日历',async()=>{
  const cases=[{input:{...input,weights:{'TL-01':999}}},{input:{...input,root:'/elsewhere'}},{input:{...input,now:1}},
    {input:{...input,revision:'1'}},{input:{...input,revision:-1}},{input:{...input,proposalFingerprint:'bad'}},
    {input:{...input,day:'2026-02-30'},isOpenDay:()=>true},{input:{...input,day:'2026-13-01'},isOpenDay:()=>true},
    {input:{...input,day:'2026-11-26'},isOpenDay:()=>true},{headers:{'x-v6-research-book':'demo'}},
    {headers:{'x-v6-research-book':'book-0000000000000000'}},{query:'?book=main'},{body:'null'},{body:'[]'},{body:'not-json'},
    {isOpenDay:()=>false}];
  for(const options of cases){const r=await http(options);assert.equal(r.status,400);assert.equal(r.calls.length,0);}
  const missing=await http({isOpenDay:()=>{throw Error('日历未覆盖');}});
  assert.equal(missing.status,422);assert.match(missing.body.error,/交易日历覆盖/);assert.equal(missing.calls.length,0);
});

test('HTTP身份和主副角色在调度前复查；作业期间失权不泄露成功回执',async()=>{
  for(const [options,status] of [[{authenticate:()=>false},403],[{isReplica:()=>true},409],[{method:'GET'},405]]){
    const r=await http(options);assert.equal(r.status,status);assert.equal(r.calls.length,0);
  }
  let authChecks=0;
  const before=await http({authenticate:()=>++authChecks===1});assert.equal(before.status,403);assert.equal(before.calls.length,0);
  let edit=true;
  const during=await http({authenticate:()=>edit,job:async(_,control)=>{
    assert.equal(control.authorize(),true);edit=false;assert.equal(control.authorize(),false);
    return {ok:false,httpStatus:403,error:'提交前授权已撤销'};
  }});
  assert.equal(during.status,403);assert.equal(during.body.result,undefined);
  const failed=await http({job:()=>{throw Error('worker失联');}});assert.equal(failed.status,503);
  const conflict=await http({job:()=>({ok:false,httpStatus:409,error:'档案版本已变'})});assert.equal(conflict.status,409);
});

function directory(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-feedback-http-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
function writeArchive(root,state){
  const clean=structuredClone(state);delete clean.catalog;delete clean.dictionaryVersion;
  fs.writeFileSync(path.join(root,'research.json'),JSON.stringify({digest:hash(clean),state:clean}),{mode:0o600});
}
async function workerFixture(t){
  const x=await feedbackFixture(),root=directory(t),historyRoot=path.join(root,'center-history');
  x.state.marketHistory=x.calendar.days.slice(0,-1).map((date,index)=>({date,nextTradingDay:x.calendar.days[index+1],
    calendarKnownAt:x.calendar.knownAt,knownAt:x.calendar.knownAt,calendarSource:x.calendar.source,source:x.calendar.source}));
  writeArchive(root,x.state);
  const read=await runWorkspaceJob({action:'intelligence-research',root,historyRoot,book:'main',replica:false,day:x.day,now:x.now,quotes:[]});
  assert.equal(read.ok,true);assert.equal(read.result.feedback.validationBridge.ready,true);
  const payload={action:'intelligence-feedback',root,historyRoot,book:'main',replica:false,day:x.day,now:x.now,
    revision:read.result.feedback.archiveRevision,proposalFingerprint:read.result.feedback.proposalFingerprint};
  return {...x,root,historyRoot,read,payload};
}

test('真实worker GET→POST交付同一提案的五项原验证回执，原成交和批准版本不变',async t=>{
  const x=await workerFixture(t),before=JSON.parse(fs.readFileSync(path.join(x.root,'research.json'))).state;
  let authChecks=0;
  const result=await runWorkspaceJob(x.payload,{authorize:()=>{authChecks++;return true;}});
  assert.equal(result.ok,true);assert.equal(result.revision,2);assert.ok(authChecks>=2);
  assert.equal(result.result.proposalFingerprint,x.payload.proposalFingerprint);
  assert.equal(result.result.status,'待人工审批');assert.equal(result.result.steps.length,5);
  const after=JSON.parse(fs.readFileSync(path.join(x.root,'research.json'))).state;
  assert.deepEqual(after.versions,before.versions);assert.deepEqual(after.trades,before.trades);assert.deepEqual(after.plans,before.plans);
  assert.equal(after.candidates.length,1);assert.equal(after.candidates[0].centerFeedback.sameProposedWeights,true);
  assert.match(after.candidates[0].centerFeedback.calendarEvidenceFingerprint,/^[a-f0-9]{64}$/);
});

test('真实worker提交点授权握手被拒绝时，研究档案逐字节保留',async t=>{
  const x=await workerFixture(t),file=path.join(x.root,'research.json'),before=fs.readFileSync(file);
  let authChecks=0;
  const revoked=await runWorkspaceJob(x.payload,{authorize:()=>++authChecks===1});
  assert.equal(revoked.ok,false);assert.equal(revoked.httpStatus,403);assert.ok(authChecks>=2);
  assert.deepEqual(fs.readFileSync(file),before);
  const missing=await runWorkspaceJob(x.payload);assert.equal(missing.ok,false);assert.deepEqual(fs.readFileSync(file),before);
});

test('真实worker拒绝过期revision、错误历史价格指纹和变更的日历证据，均不保存候选',async t=>{
  const x=await workerFixture(t),file=path.join(x.root,'research.json');
  const mutations=[{state:s=>{s.revision++;},expected:409},
    {state:s=>{s.bars[100].amount+=5000;},expected:422},
    {state:s=>{s.marketHistory.forEach(row=>row.calendarSource='other-original-calendar');},expected:422}];
  for(const change of mutations){
    const modified=structuredClone(x.state);change.state(modified);writeArchive(x.root,modified);
    const before=fs.readFileSync(file),result=await runWorkspaceJob(x.payload,{authorize:()=>true});
    assert.equal(result.ok,false);assert.equal(result.httpStatus,change.expected);assert.deepEqual(fs.readFileSync(file),before);
  }
});

test('反馈排在只读任务之后时，另一设备先提交的revision仍在锁内拒绝覆盖',async t=>{
  const x=await workerFixture(t),{shortlineJob}=await import('../src/research/shortline/store.mjs');
  const reading=runWorkspaceJob({action:'intelligence-research',root:x.root,historyRoot:x.historyRoot,day:x.day,now:x.now,quotes:[]});
  const queued=runWorkspaceJob(x.payload,{authorize:()=>true});
  const edit=await shortlineJob({root:x.root,input:{revision:1,action:'book:lock',payload:{locked:true}}});
  assert.equal(edit.state.revision,2);
  const before=fs.readFileSync(path.join(x.root,'research.json'));
  assert.equal((await reading).ok,true);
  const rejected=await queued;assert.equal(rejected.ok,false);assert.equal(rejected.httpStatus,409);
  assert.deepEqual(fs.readFileSync(path.join(x.root,'research.json')),before);
});

test('真实worker发现独立历史链损坏时拒绝提交，不将回退读取当作历史认证',async t=>{
  const x=await workerFixture(t),file=path.join(x.root,'research.json'),before=fs.readFileSync(file);
  fs.mkdirSync(path.join(x.historyRoot,'receipts'),{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(x.historyRoot,'receipts','000001.json'),'{}',{mode:0o600});
  const result=await runWorkspaceJob(x.payload,{authorize:()=>true});
  assert.equal(result.ok,false);assert.equal(result.httpStatus,422);assert.match(result.error,/历史|完整|校验/);
  assert.deepEqual(fs.readFileSync(file),before);
});
