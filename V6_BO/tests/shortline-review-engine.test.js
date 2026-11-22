const test=require('node:test');
const assert=require('node:assert/strict');
const { buildReview, reviewAction }=require('../public/nova/shortline/review.mjs');

const date='2026-11-20';
const report=(s,period='day')=>buildReview(s,{date,period,depth:'deep'});
const prices={sh:'多头',cy:'多头',trend:'多头',adv:3000,dec:1500};
const daily=(d,u,l,b,h,leader,diffusion)=>({...prices,date:d,upLimit:u,downLimit:l,breakRate:b,height:h,leader,diffusion,theme:'原始题材'});
function original(){
  return [
    daily('2026-11-18',40,12,31,4,1,40),
    daily('2026-11-19',45,9,26,4,2,48),
    daily(date,53,7,23,5,3,55)
  ];
}
test('盘面快照、情绪证据和关键词不受截止时点后的修订影响',()=>{
  const rows=original(), expected=report({market:rows});
  const state={market:rows.map(r=>({...r,theme:'事后题材',upLimit:0,availableAt:'2026-11-21 09:01'})),marketHistory:rows};
  assert.equal(expected.totals.stage,'发酵');
  assert.deepEqual(report(state),expected);
  const note=reviewAction(state,'review:generate',{date,period:'day',depth:'deep'});
  assert.equal(note.text,expected.text);
  assert(!note.tags.includes('事后题材'));
});
test('迟到的首条盘面不能生成历史情绪判定或开仓预案',()=>{
  const rows=original();
  rows.at(-1).availableAt=date+' 15:01';
  const r=report({market:rows,checks:[{date,code:'600001',name:'测试',position:20,eligible:['龙头战法']}]});
  assert.equal(r.totals.stage,'未判定');
  assert.match(r.text,/所选日期暂无盘面记录/);
  assert.match(r.text,/模拟仓位上限 0%/);
});
test('周报时间轴与持仓期间观察使用各自收盘时可见的版本',()=>{
  const rows=original();
  const early=rows[0],later={...early,theme:'次日修订',availableAt:'2026-11-19 08:00'};
  const trade={id:'t',date:early.date,entryTime:early.date+'T10:00',exitTime:'2026-11-19T13:00',pnl:1,reviewable:true,
    name:'收盘观察样本',code:'000001',strategy:'低吸'};
  const r=report({market:[later,...rows.slice(1)],marketHistory:[early],trades:[trade]},'week');
  const timeline=r.groups.find(g=>g.title==='情绪与主线时间轴').lines;
  assert(timeline.some(l=>l.includes(early.date)&&l.includes('原始题材')));
  assert(!timeline.some(l=>l.includes('次日修订')));
  const observation=r.groups.find(g=>g.title==='个人交易复盘').lines.find(l=>l.startsWith('持仓期间收盘观察'));
  assert.match(observation,/原始题材/);
  assert(!observation.includes('次日修订'));
});
test('结算截止、盈亏分类和主观批注保持独立',()=>{
  const t={id:'a',code:'000001',name:'执行样本',date,exitTime:date+'T14:59',pnl:-4,reviewable:true};
  const state={market:original(),trades:[t,{...t,id:'b',name:'未来交易',exitTime:'2026-11-23T09:30'}]};
  const r=report(state);
  assert.equal(r.totals.trades,1);
  assert.match(r.text,/亏损样本.*已核记录未见违规/);
  assert(!r.text.includes('未来交易'));
  assert.throws(()=>reviewAction(state,'review:note',{date,kind:'mistake',tradeId:'b',text:'未来交易'}),/已结算/);
  const n=reviewAction(state,'review:note',{date,kind:'annotation',tradeId:'a',text:'人工交易观察'});
  assert.equal(n.tradeId,'a');
  assert.equal(t.text,undefined);
  assert.match(report(state).text,/人工批注[\s\S]*人工交易观察/);
});
