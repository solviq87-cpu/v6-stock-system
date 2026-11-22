const test=require('node:test');
const assert=require('node:assert/strict');
const { learningAction,predict,stats,auditTrade }=require('../public/nova/shortline/learning.mjs');

const base={code:'600000',name:'样本',entryTime:'2024-02-01T10:00',exitTime:'2024-02-02T11:10',entryPrice:10,exitPrice:9,shares:100,cost:2,position:5,strategy:'趋势突破',trend:'多头',exitReason:'主动离场'};
test('历史补录保留中性判断；净收益包含费用；主观解释独立存储',()=>{
  const state={};
  const trade=learningAction(state,'learn:trade',{...base,explanation:'市场变化',violations:['追高'],pnl:123,snapshotVerified:true});
  assert.equal(trade.pnl,-10.2);
  assert.deepEqual(trade.violations,[]);
  assert.equal(trade.reviewable,false);
  assert.equal(trade.snapshotVerified,false);
  assert.equal(trade.explanation,undefined);
  assert.equal(state.explanations[0].tradeId,trade.id);
  assert.throws(()=>learningAction(state,'learn:trade',base),/已存在/);
});
test('盈亏变化不改变客观纪律；事前计划覆盖五项检查',()=>{
  const plan={...base,strategy:'龙头首阴',frozenAt:'2024-01-01T00:00:00Z',holdUntil:'2024-02-03T10:00',entryMax:8,maxPosition:2,stop:7,target:13};
  const t={...base,stopAction:'可成交后继续持有'};
  const actual=auditTrade(plan,t);
  assert.deepEqual(actual.map(i=>i.status),Array(5).fill('触发'));
  assert.deepEqual(auditTrade(plan,{...t,pnl:95}),actual);
});
test('截止时刻不使用尚未平仓或尚未登记的样本；隔离样本不参与预测',()=>{
  const trade={...base,id:'a',factors:['突破'],repeatable:true,snapshotVerified:true,pnl:4,createdAt:'2024-02-03T00:00:00Z'};
  const state={trades:[trade,{...trade,blackSwan:true}]};
  const input={factors:['突破'],strategy:'趋势突破'};
  assert.equal(predict(state,{...input,asOf:'2024-02-02'}).n,0);
  assert.equal(predict(state,{...input,asOf:'2024-02-03'}).n,0);
  assert.equal(predict(state,{...input,asOf:'2024-02-04'}).n,1);
  assert.equal(stats([trade]).payoff,null);
});
function candidatesFixture(){
  const trades=[];
  for(let d=0;d<50;d++){
    let date=new Date(Date.UTC(2024,0,1+d)).toISOString().slice(0,10);
    for(let k=0;k<4;k++)trades.push({...base,id:d+'/'+k,date,code:'60000'+k,entryTime:date+'T09:32',exitTime:date+'T15:00',createdAt:date+'T07:01:00Z',pnl:k<2?2:-2,factors:[k<2?'共振':'衰退'],snapshotVerified:true,repeatable:true});
  }
  return {trades};
}
test('先验证、后审批，不能重复晋级或重用独立留出期',()=>{
  const s=candidatesFixture();
  const c=learningAction(s,'learn:candidate',{weights:{'假因子':99},status:'已晋级'});
  assert.equal(c.steps.length,5);
  assert.equal(c.status,'待人工审批');
  assert.equal(s.versions.length,0);
  assert.equal(c.weights['假因子'],undefined);
  assert.equal(c.counts.length,3);
  const p={id:c.id,decision:'approve',reviewer:'测试员',reason:'逐项复核通过'};
  assert.equal(learningAction(s,'learn:decision',p).number,1);
  assert.throws(()=>learningAction(s,'learn:decision',p));
  assert.throws(()=>learningAction(s,'learn:candidate',{}));
  assert.equal(s.versions.length,1);
});
test('未通过验证时跳过后续阶段，人为传入审批状态无效',()=>{
  const state=candidatesFixture();
  for(const r of state.trades) r.pnl=-1;
  const c=learningAction(state,'learn:candidate',{});
  assert.equal(c.steps[0].status,'未通过');
  assert.ok(c.steps.slice(1).every(r=>r.status==='未运行'));
  assert.throws(()=>learningAction(state,'learn:decision',{id:c.id,decision:'approve',status:'待人工审批'}));
});
test('冻结存档由服务端定时；历史成交不能靠篡改时间关联新计划',()=>{
  const state={};
  const p=learningAction(state,'learn:plan',{...base,entryMax:10,stop:9,target:12,maxPosition:10,logic:'依据可观察突破',frozenAt:'2020-01-01T00:00:00Z'});
  assert.ok(Date.now()-Date.parse(p.frozenAt)<1000);
  assert.throws(()=>learningAction(state,'learn:trade',{...base,planId:p.id}),/冻结/);
  assert.throws(()=>learningAction(state,'learn:plan-update',{id:p.id,stop:1}));
  assert.equal(p.stop,9);
});
test('人工研究反馈仅使用训练截止前记录且关联事前特征的假设',()=>{
  const clean=candidatesFixture(),notes=candidatesFixture();
  notes.notes=Array.from({length:3},(_,i)=>({id:'note-'+i,tradeId:i+'/0',factor:'共振',createdAt:'2024-01-20T00:00:00Z'}));
  notes.notes.push({id:'late',tradeId:'0/0',factor:'共振',createdAt:'2024-03-01T00:00:00Z'},{id:'absent',tradeId:'1/0',factor:'未观察因子',createdAt:'2024-01-20T00:00:00Z'});
  const c=learningAction(notes,'learn:candidate',{});
  assert.equal(c.reviewRefs.length,3);
  assert.ok(c.weights['共振']>learningAction(clean,'learn:candidate',{}).weights['共振']);
});
test('跨验证分界的持仓、延后登记的收益从训练中清除',()=>{
  const s=candidatesFixture(),baseCandidate=learningAction(candidatesFixture(),'learn:candidate',{});
  s.trades[0].exitTime=baseCandidate.trainEnd+'T14:00';
  s.trades[1].createdAt=baseCandidate.trainEnd+'T00:00:00Z';
  const c=learningAction(s,'learn:candidate',{});
  assert.equal(c.counts[0],baseCandidate.counts[0]-2);
  assert.deepEqual(c.counts.slice(1),baseCandidate.counts.slice(1));
});
