const test=require('node:test');
const assert=require('node:assert/strict');
const {learningSnapshot,renderLearningSnapshot,learningAction,renderLearning,predict,study}=require('../public/nova/shortline/learning.mjs');
const {sampleMatches,isTestSample}=require('../public/nova/shortline/sample-quality.mjs');
const {settingsAt}=require('../public/nova/shortline/settings.mjs');
const baseline=settingsAt({});
const setting=(effectiveAt,patch)=>({version:1,effectiveAt,config:{...baseline,...patch}});
const sample=(day,pnl,i=0,changes={})=>({id:day+'/'+i,date:day,entryTime:day+'T09:35',exitTime:day+'T11:29',
  createdAt:day+'T05:00:00Z',snapshotVerified:true,strategy:'龙头',trend:'多头',factors:['主线承接'],pnl,code:'60000'+i,...changes});
const closed={code:'600000',name:'样本',entryTime:'2024-01-03T10:00',exitTime:'2024-01-03T14:00',entryPrice:10,exitPrice:12,shares:100,position:7,cost:0,exitReason:'主动离场'};
test('质量多选语义与用途相互独立，兼容旧的教学/冲击标注',()=>{
  assert.equal(sampleMatches({repeatable:false,blackSwan:true},'extreme'),false);
  const both={blackSwan:true,extreme:true,sampleSet:'test'};
  for(const q of ['all','extreme','blackSwan'])assert.equal(sampleMatches(both,q),true);
  for(const q of ['standard','excludeBlackSwan','excludeExtreme'])assert.equal(sampleMatches(both,q),false);
  assert.ok(sampleMatches({blackSwan:'否'},'standard'));
  assert.ok(isTestSample({quality:'教学样本'}));
  assert.equal(isTestSample({sourceSet:'模拟成交'}),false);
  assert.equal(isTestSample({sampleSet:'real',name:'正常标的'}),false);
});
test('正式预测/统计始终区分测试样本；浏览可显式包含，演示档案可独立练习',()=>{
  const t=sample('2024-02-01',5),state={scope:'live',trades:[t,{...t,id:'x',sampleSet:'test',pnl:-8},{...t,id:'sh',quality:'黑天鹅',pnl:90}]};
  const asOf='2024-03-01T10:00';
  assert.equal(predict(state,{asOf,includeTest:true}).n,1);
  assert.equal(learningSnapshot(state,{asOf}).totals.n,1);
  assert.equal(learningSnapshot(state,{asOf,includeTest:true}).totals.n,2);
  assert.equal(learningSnapshot(state,{asOf,selection:'blackSwan'}).totals.expectedReturn,90);
  assert.equal(learningSnapshot({...state,scope:'demo'},{asOf}).totals.n,2);
  assert.equal(study(state.trades).single.find(x=>x.key==='主线承接').n,1);
  assert.equal(learningSnapshot(state,{asOf:'2024-02-01T12:00'}).totals.n,0);
  assert.equal(learningSnapshot(state,{asOf:'2024-02-01T13:01'}).totals.n,1);
});
test('半衰期开关只在生效时刻以后改变条件胜率与盈亏比，不修改历史曲线回撤',()=>{
  const trades=[sample('2024-01-01',10),sample('2024-01-01',-1,1),sample('2024-05-01',2),sample('2024-05-01',-4,1),sample('2024-05-01',-4,2)];
  const state={trades,settingsHistory:[setting('2024-05-02T02:00:00Z',{decayEnabled:true,decayHalfLifeDays:30})]};
  const a=predict(state,{asOf:'2024-05-02T09:59',factors:['主线承接']}),b=predict(state,{asOf:'2024-05-02T10:00',factors:['主线承接']});
  assert.equal(a.winRate,40);assert.equal(a.payoff,2);
  assert.ok(b.payoff<a.payoff);assert.ok(b.winRate<a.winRate);assert.equal(b.maxDrawdown,a.maxDrawdown);
  assert.equal(learningSnapshot(state,{asOf:'2024-05-02T14:00'}).factorByTrend[0].winRate,b.winRate);
  assert.equal(learningSnapshot({trades},{asOf:'2024-06-01'}).decay.decayEnabled,false);
});
function cohort(){
  const trades=[];
  for(let n=0;n<50;n++){
    const day=new Date(Date.UTC(2024,0,n+1)).toISOString().slice(0,10);
    for(let i=0;i<4;i++)trades.push(sample(day,i<2?(n<16?4:1):-2,i,{factors:[i<2?'强势':'弱势']}));
  }
  return trades;
}
test('训练期间冻结衰减设置，测试记录不进入正式候选/无法晋级到正式档案',()=>{
  const trades=cohort(),testRows=trades.map(r=>({...r,id:'t/'+r.id,sampleSet:'test'}));
  const standard={trades},fresh=learningAction(standard,'learn:candidate',{});
  const late={trades:[...trades,...testRows],settingsHistory:[setting('2024-02-22T00:00:00Z',{decayEnabled:true,decayHalfLifeDays:7})]};
  const no=learningAction(late,'learn:candidate',{includeTest:true,scope:'demo'});
  assert.deepEqual(no.weights,fresh.weights);assert.deepEqual(no.sourceIds,fresh.sourceIds);assert.equal(no.decay.decayEnabled,false);
  const early={trades,settingsHistory:[setting('2023-12-01T00:00:00Z',{decayEnabled:true,decayHalfLifeDays:7})]};
  const weighted=learningAction(early,'learn:candidate',{});assert.notDeepEqual(weighted.weights,fresh.weights);assert.equal(weighted.decay.settingsVersion,1);
  assert.equal(learningAction({scope:'live',trades:testRows},'learn:auto-candidate',{}),null);
  const demo={scope:'demo',trades:testRows};const c=learningAction(demo,'learn:candidate',{});
  assert.equal(c.sampleScope,'demo');assert.equal(c.status,'待人工审批');
  const decision={id:c.id,reviewer:'核验',reason:'复核验证记录',decision:'approve'};
  assert.throws(()=>learningAction({...demo,scope:'live'},'learn:decision',decision),/测试样本/);
  assert.equal(learningAction(demo,'learn:decision',decision).sampleScope,'demo');
});
test('冻结计划与成交不可改写，追加备注单独存储；盈利交易照实标出追高和超仓',()=>{
  const state={plans:[{id:'p',...closed,frozenAt:'2024-01-02T05:00:00Z',entryMax:9,maxPosition:3,stop:8,target:14,intendedDate:'2024-01-03',strategy:'龙头'}]};
  const p=structuredClone(state.plans[0]);
  const t=learningAction(state,'learn:trade',{...closed,planId:'p',quality:'黑天鹅',sampleSet:'test',violations:[]});
  assert.ok(t.pnl>0);assert.ok(t.violations.includes('追高'));assert.ok(t.violations.includes('超仓'));assert.equal(t.sampleSet,'test');
  const copy=structuredClone(t),note=learningAction(state,'learn:note',{planId:'p',text:'补充解释',stop:2,entryMax:100});
  learningAction(state,'learn:note',{tradeId:t.id,text:'已复核',pnl:300});
  assert.ok(note.planId);assert.deepEqual(state.plans[0],p);assert.deepEqual(state.trades[0],copy);
  assert.equal(state.explanations.length,2);assert.throws(()=>learningAction(state,'learn:trade-update',{id:t.id}));
  assert.equal(learningSnapshot(state,{includeTest:true}).totals.n,0);
  assert.equal(learningSnapshot(state,{includeTest:true,selection:'blackSwan',asOf:Date.now()+60000}).totals.n,1);
});
test('自定义标签由冻结时已生效目录校验；补注不能改变事前特征',()=>{
  const state={settingsHistory:[setting('2020-01-01T00:00:00Z',{customTags:['主动回封']})]};
  const p={...closed,strategy:'龙头',entryMax:10,maxPosition:4,stop:9,target:12,trend:'震荡',logic:'观察次日',customTags:['事后标签']};
  assert.throws(()=>learningAction(state,'learn:plan',p),/标签/);assert.equal(state.plans.length,0);
  const archived=learningAction(state,'learn:plan',{...p,customTags:['主动回封']});
  learningAction(state,'learn:note',{planId:archived.id,text:'事后',customTags:['事后标签']});
  assert.deepEqual(archived.customTags,['主动回封']);
});
test('因子和战法按三种环境统计；三个完整月两项同降才触发预警，迟到的记录不能补齐过去月份',()=>{
  const rows=[];
  for(const [month,results] of [[1,[4,4,4,4,-1]],[2,[3,3,3,-2,-2]],[3,[2,2,-4,-4,-4]]]){
    for(const [i,pnl] of results.entries())rows.push(sample('2024-0'+month+'-10',pnl,i,{trend:['多头','震荡','空头'][month-1],
      attribution:pnl>0?'主线发酵、主线发酵':'流动性不足',factors:['<失效>']}));
  }
  const get=(trades,asOf='2024-04-18')=>learningSnapshot({trades},{asOf});
  const s=get(rows);assert.equal(s.factorByTrend.length,3);assert.equal(s.strategyByTrend.length,3);
  assert.equal(s.alerts.length,1);assert.deepEqual(s.alerts[0].periods.map(p=>[p.winRate,p.payoff]),[[80,4],[60,1.5],[40,0.5]]);
  assert.deepEqual(s.attribution.profit,[{term:'主线发酵',count:9}]);assert.deepEqual(s.attribution.loss,[{term:'流动性不足',count:6}]);
  assert.equal(get(rows,'2024-03-28').alerts.length,0);assert.equal(get(rows.slice(1)).alerts.length,0);
  const late=rows.map((r,i)=>i===0?{...r,createdAt:'2024-04-01T01:00:00Z'}:r);assert.equal(get(late).alerts.length,0);
  const html=renderLearningSnapshot(s);assert.ok(html.includes('&lt;失效&gt;'));assert.ok(!html.includes('<失效>'));assert.match(html,/盈利/);
  assert.equal(renderLearningSnapshot(get([])),'');
});
test('交易与版本原生渲染含质量筛选/显式测试开关，空库可录入',()=>{
  const root={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
  const ui={state:{},root};
  renderLearning(ui,'trades');assert.match(root.innerHTML,/录入已结算交易/);assert.match(root.innerHTML,/id="learn-tests"/);assert.match(root.innerHTML,/绩效预览/);
  renderLearning(ui,'versions');assert.match(root.innerHTML,/生成并验证候选/);assert.match(root.innerHTML,/id="learn-quality"/);
});
test('结构化压力标签在信号原时刻取值，后到公告及标题线索不会提前进入因子统计',()=>{
  const t=sample('2024-01-05',3),d='2024-01-04',early=Date.parse(d+'T15:10:00+08:00');
  const fact={id:'risk',code:t.code,category:'减持',verified:true,source:'东方财富董监高及关联人员持股变动表',description:'已公布持股减少 20000 股',eventDay:d,value:20000,unit:'股',riskTag:'已公告减持',expires:'2024-01-10',knownAt:early};
  const report={code:t.code,day:d,knownAt:early,facts:[fact,{...fact,id:'late',riskTag:'后到事实',knownAt:Date.parse(t.date+'T15:00:00+08:00')}],clues:[{...fact,id:'title',riskTag:'标题'}]};
  const state={trades:[t],pressureHistory:[report]};
  const factors=learningSnapshot(state,{asOf:'2024-01-18T12:00'}).factorByTrend.map(f=>f.factor);
  assert.ok(factors.includes('压力·已公告减持'));assert.ok(!factors.includes('压力·后到事实'));assert.ok(!factors.includes('压力·标题'));
});
test('字典因子须来自同标的已登记校验，冻结字段保留 TL/GG 可知代码',()=>{
 const t=sample('2024-02-01',3,0,{checkId:'f'}),c={id:'f',code:t.code,asOf:'2024-02-01 09:20',createdAt:'2024-02-01T01:21:00Z',factorCodes:['TL-02','GG-01']};
 const view=check=>learningSnapshot({trades:[t],checks:[check]},{asOf:'2024-02-02T15:00'}).factorByTrend.map(v=>v.factor);
 assert.ok(view(c).includes('TL-02'));assert.ok(view(c).includes('GG-01'));
 assert.ok(!view({...c,code:'600002'}).includes('TL-02'));assert.ok(!view({...c,createdAt:'2024-02-01T02:01:00Z'}).includes('TL-02'));
 const s={checks:[{...c,date:t.date,name:'样本',matches:['龙头']}]};
 const r=learningAction(s,'learn:trade',{...closed,entryTime:t.entryTime,exitTime:t.exitTime});
 assert.ok(r.factors.includes('GG-01'));assert.ok(r.factors.includes('TL-02'));
});
