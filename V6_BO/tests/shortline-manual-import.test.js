'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const M=require('../src/core/manual-decision-loop');
const S=require('../src/core/research-workspace-store');
const {importManualDecisionLoop}=require('../src/research/shortline-manual-import');
const at=s=>Date.parse(s+'+08:00');
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shortline-manual-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'manual'),ws=path.join(dir,'workspace'),target=path.join(dir,'shortline');
  const data={symbol:'600001',name:'合成甲',tradeDate:'2026-08-14',asOf:at('2026-08-14T15:00:00'),
    systems:[{id:'verified-selection',label:'示例条件组',verdict:'pass'}],regime:'up',regimeMeaning:'上证方向分组'};
  const run=S.appendEvent(ws,'analysis',data,{requestId:'source_0001',now:data.asOf});
  let n=0,now=at('2026-08-17T08:00:00');
  const op=(action,fields={})=>M.execute(root,{action,requestId:'test_'+String(++n).padStart(8,'0'),
    expectedRevision:M.view(root).revision,...fields},{workspaceRoot:ws,now});
  const time=s=>{now=at(s)};
  const plan=()=>op('freeze',{runId:run.hash,shares:300,limitPrice:'10.00'}).recordId;
  const state={trades:[{id:'other',source:'V6 模拟成交'}],explanations:[{id:'own-note',text:'独立解释'}],candidates:[],versions:[]};
  const sync=()=>importManualDecisionLoop(state,{root,now});
  return {dir,root,ws,target,state,op,time,plan,sync};
}
const b1={reference:'native-buy-1',quantity:100,price:'10.0000',fee:'5.00',side:'buy',executedAt:'2026-08-17T10:00:00+08:00'};
const b2={reference:'native-buy-2',quantity:100,price:'10.1000',fee:'5.00',side:'buy',executedAt:'2026-08-17T10:05:10+08:00'};
const s1={reference:'native-sell-1',quantity:200,price:'11.00',fee:'6.00',side:'sell',executedAt:'2026-08-18T11:00:00+08:00'};
function fills(x,planId) {
  x.time('2026-08-17T10:05:30');x.op('fill',{planId,fill:b1});x.op('fill',{planId,fill:b2});
  x.time('2026-08-18T11:01:00');x.op('fill',{planId,fill:s1});
}
function match(x,planId,rows=[b1,b2,s1]){
  return x.op('reconcile',{planId,statement:{sourceLabel:'本人测试交割单',rows}});
}
function capture(root){return fs.readdirSync(root).sort().map(name=>[name,fs.readFileSync(path.join(root,name),'utf8')]);}

test('原生建议、未执行和未匹配交割保持关联；费用和时点逐字段一致后才进入样本',t=>{
  const x=setup(t);
  assert.equal(x.sync().changed,false);assert.equal(fs.existsSync(x.root),false);
  const p=x.plan(),skipped=x.plan();x.op('not-executed',{planId:skipped,reason:'未达到原计划'});
  x.sync();assert.equal(x.state.manualLoopLinks.length,2);assert.equal(x.state.trades.length,1);
  assert.ok(x.state.explanations.some(n=>n.manualPlanId===skipped&&n.text==='未达到原计划'));
  fills(x,p);x.sync();assert.match(x.state.manualLoopLinks.find(l=>l.planId===p).missing[0],/等待.*对账/);
  match(x,p,[b1,b2,{...s1,fee:'5.00'}]);x.sync();assert.equal(x.state.trades.length,1);
  assert.match(x.state.manualLoopLinks.find(l=>l.planId===p).missing[0],/不一致/);
  match(x,p);x.op('review',{planId:p,note:'本人记录的主观解释'});
  const bytes=capture(x.root),r=x.sync(),row=x.state.trades.find(t=>t.manualDecision);
  assert.equal(r.imported,1);assert.equal(r.retracted,0);assert.deepEqual(r.exitDays,['2026-08-18']);
  assert.equal(row.entryTime,'2026-08-17T10:00');assert.equal(row.exitTime,'2026-08-18T11:00');
  assert.equal(row.shares,200);assert.equal(row.costBasis,2020);assert.equal(row.cost,16);
  assert.equal(row.pnlAmount,174);assert.equal(row.entryPrice,10.05);assert.equal(row.exitPrice,11);
  assert.equal(row.snapshotVerified,true);assert.equal(row.planId,null);assert.equal(row.brokerVerified,false);
  assert.deepEqual(row.factors,['原研究通过·示例条件组']);assert.ok(row.violations.includes('追高'));
  assert.equal(row.disciplineFacts.find(f=>f.rule==='违反止损').status,'资料不足');
  assert.ok(x.state.explanations.some(n=>n.tradeId===row.id&&n.text==='本人记录的主观解释'));
  assert.equal(JSON.stringify(row).includes('本人记录的主观解释'),false);
  const frozen=structuredClone(x.state);assert.equal(x.sync().changed,false);assert.deepEqual(x.state,frozen);
  assert.deepEqual(capture(x.root),bytes);
});

test('原生重开/成交撤销/修正按计划ID撤回重投，待审批候选失效；人工样本和上线参数保留',t=>{
  const x=setup(t),p=x.plan();fills(x,p);match(x,p);
  x.op('review',{planId:p,note:'平仓复核'});x.sync();
  const old=x.state.trades.find(t=>t.manualDecision);
  x.state.candidates=[
    {id:'pending',sourceIds:[old.id],status:'待人工审批'},
    {id:'live',sourceIds:[old.id],status:'已晋级'},
    {id:'independent',sourceIds:['other'],status:'待人工审批'}
  ];
  x.state.versions=[{candidateId:'live',number:1,weights:{'a':2}}];
  const versions=structuredClone(x.state.versions);
  x.time('2026-08-19T10:00:00');x.op('reopen',{planId:p,reason:'对账纠错'});
  const retraction=x.sync();assert.equal(retraction.retracted,1);assert.equal(retraction.invalidated,1);
  assert.equal(x.state.trades.length,1);assert.equal(x.state.trades[0].id,'other');
  assert.equal(x.state.candidates[0].status,'原始成交证据已失效');assert.equal(x.state.candidates[1].status,'已晋级');
  assert.equal(x.state.candidates[2].status,'待人工审批');assert.deepEqual(x.state.versions,versions);
  assert.ok(x.state.explanations.some(n=>n.id==='own-note'));assert.ok(!x.state.explanations.some(n=>n.tradeId===old.id));
  const sellId=M.view(x.root).plans[0].fills.find(f=>f.side==='sell').id;
  x.op('void-fill',{planId:p,fillId:sellId,reason:'原费用录入有误'});x.sync();
  assert.equal(x.state.manualLoopLinks[0].currentShares,200);
  const fixed={...s1,reference:'replacement-sell',fee:'7.50'};
  x.op('fill',{planId:p,fill:fixed});match(x,p,[b1,b2,fixed]);x.sync();
  const replacement=x.state.trades.find(t=>t.manualDecision);
  assert.equal(replacement.id,old.id);assert.equal(replacement.pnlAmount,172.5);
  assert.notEqual(replacement.sourceFingerprint,old.sourceFingerprint);
  assert.ok(replacement.createdAt>old.createdAt);
});

test('晚冻结仅保留已对账执行事实；来源档案回退、损坏均不清除先前投影',t=>{
  const x=setup(t);x.time('2026-08-17T10:03:00');const p=x.plan();
  fills(x,p);match(x,p);x.sync();const known=structuredClone(x.state);
  const row=x.state.trades.find(t=>t.manualDecision);
  assert.equal(row.snapshotVerified,false);assert.deepEqual(row.factors,[]);assert.equal(row.violations.length,0);
  const rev=M.view(x.root).revision,file=path.join(x.root,String(rev).padStart(6,'0')+'.json');
  fs.writeFileSync(file,'{}');assert.equal(x.sync().issues.length,1);assert.deepEqual(x.state,known);
  fs.unlinkSync(file);assert.equal(x.sync().issues.length,1);assert.deepEqual(x.state,known);
});

test('原生成功结算通过正式 syncManualLedger 自动落库、重读幂等且原档字节不变',async t=>{
  const x=setup(t),p=x.plan();fills(x,p);match(x,p);
  const {syncManualLedger,shortlineJob}=await import('../src/research/shortline/store.mjs');
  const before=capture(x.root);
  const first=await syncManualLedger(x.target,x.root);assert.equal(first.changed,true);assert.equal(first.imported,1);
  const archive=await shortlineJob({root:x.target});
  assert.equal(archive.state.trades[0].manualDecision.planId,p);
  assert.ok(archive.state.notes.some(n=>n.date==='2026-08-18'));
  const duplicate=await syncManualLedger(x.target,x.root);assert.equal(duplicate.changed,false);assert.equal(duplicate.revision,first.revision);
  assert.deepEqual((await shortlineJob({root:x.target})).state,archive.state);
  assert.deepEqual(capture(x.root),before);
});
