'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {canonicalTheme,references,groupPool}=require('../public/nova/shortline/structure-core.js');
const uiPath='../public/nova/shortline/structure.mjs',logicPath='../public/nova/shortline/structure-events.mjs';
const day='2026-11-20',at=Date.parse(day+'T15:30:00+08:00');
test('保留不同供应商原名与ID，显式别名按股票去重，局部导入不能确认龙头与缺档',async()=>{
  assert.equal(canonicalTheme('ＡＩ 算力'),'算力');assert.equal(canonicalTheme('芯片'),'半导体');assert.equal(canonicalTheme('汽车芯片'),'汽车芯片');
  const input={date:day,source:'封板池',provider:'ths',knownAt:at,scope:'同花顺沪深短线',totalCount:2,complete:true,
    sealed:[{code:'600001',name:'甲',level:3,refs:references([{name:'算力',provider:'cls',code:'cls800001'},{name:'AI算力',provider:'ths',code:'885999'}])},
    {code:'600002',name:'乙',level:1,refs:references('算力',{provider:'ths'})}]};
  const [g]=groupPool(input);assert.equal(g.members.length,2);assert.equal(g.refs.length,3);assert.deepEqual(g.gaps,[2]);assert.equal(g.leader.code,'600001');assert.equal(g.members[1].role,'助攻');
  const {datedPools,structureForStock}=await import(uiPath);
  const state={importedLimitPools:[{id:'t1',tradeDate:day,knownAt:at+1,source:'手工导出',provider:'ths-desktop',scope:'选中范围',complete:false,rows:[{code:'600001',tradeDate:day,streak:3,theme:'芯片',boardCode:'885756'},{code:'600002',tradeDate:day,streak:1,theme:'半导体'},{code:'600002',tradeDate:day,streak:1,theme:'芯片'}]}],market:[{date:day,knownAt:at,structurePools:[input]}]};
  assert.equal(datedPools(state,day,at-1).length,0);assert.equal(datedPools(state,day,at).length,1);
  const groups=structureForStock(state,'600001',day,at+1),imported=groups.find(r=>r.name==='半导体');
  assert.equal(imported.leader,null);assert.deepEqual(imported.gaps,[]);assert.deepEqual(imported.peers.map(r=>r.code),['600002']);
  assert.ok(imported.refs.some(r=>r.rawName==='芯片'&&r.boardId==='885756'));
});
test('并列未核首封不造龙头，已冻结昨日龙头续板且新首板随后出现才记补涨候选',async()=>{
  const {structureDemo}=await import(uiPath),demo=structureDemo();
  const [g]=groupPool(demo[1],demo[0]);assert.equal(g.members[1].role,'补涨候选');assert.equal(g.gaps[0],2);
  assert.equal(groupPool(demo[1],{...demo[0],scope:'其他来源'})[0].members[1].role,'助攻');
  const tied={...demo[0],sealed:demo[0].sealed.map(r=>({...r,level:2,firstSealTime:'09:40'}))};
  assert.equal(groupPool(tied)[0].leader,null);
  tied.sealed[1].firstSealTime='09:40:15';assert.equal(groupPool(tied)[0].leader,null);
});
test('同花顺股票与板块导航使用真实目录 ID；异源ID、无映射名称只按名称检索',async()=>{
  const {thsStockLink,thsBoardLink}=await import(uiPath);
  assert.equal(thsStockLink('600000').url,'https://stockpage.10jqka.com.cn/600000/');assert.equal(thsStockLink('foo/600000'),null);
  assert.equal(thsBoardLink({name:'半导体',kind:'industry',refs:[{provider:'eastmoney',boardId:'BK1036'}]}).pageId,'881121');
  assert.equal(thsBoardLink({name:'芯片概念',kind:'theme',refs:[{provider:'ths',boardId:'885756'}]}).pageId,'301085');
  assert.equal(thsBoardLink({name:'算力',refs:[{provider:'cls',boardId:'cls80131'}]}).kind,'search');
  assert.equal(thsBoardLink({name:'<iframe>'}),null);
});
test('炸板三分类要求独立的撤单、承接与同期板块证据；首封时间和队列变小不足',async()=>{
  const {classifyBreak,sectorIdsFor}=await import(logicPath),code='600001';
  const tick=(m,close,role='stock')=>({date:day+' 10:'+m,period:'1m',role,code:role==='stock'?code:'BK1036',name:role==='sector'?'半导体':'甲',secid:role==='sector'?'90.BK1036':'1.'+code,
    source:'东财实测',knownAt:at,open:close,close,high:close,low:close,volume:50});
  const timeline=[tick('01',11),tick('02',10.90),tick('03',10.80),tick('04',10.70),tick('01',100,'sector'),tick('02',98.8,'sector')];
  const s={code,name:'甲',upLimit:11,refs:references('半导体',{provider:'eastmoney',kind:'industry'}),orderEvents:[{code,type:'cancel',side:'buy',price:11,quantity:51,queueBefore:100,time:day+' 10:01:30',knownAt:at,source:'已归档成交队列'}]};
  const ids=sectorIdsFor(s,day,timeline,at);assert.deepEqual(ids,['BK1036']);
  const result=classifyBreak(s,day,timeline,at,ids);
  assert.match(result.status,/封单后撤炸板/);assert.match(result.status,/承接不足炸板/);assert.match(result.status,/板块跳水带崩炸板/);
  assert.equal(classifyBreak(s,day,timeline,at-1,ids).status,'未判定');assert.doesNotMatch(classifyBreak({...s,orderEvents:[],bidQueueShrank:true},day,timeline,at,[]).status,/后撤|板块跳水/);
});
test('高标名单跟踪断板/核按钮/反包及同时反馈；缺交易/错来源/高点未核时不升级',async()=>{
  const {highEvents}=await import(logicPath),{structureDemo}=await import(uiPath),series=structureDemo(),d=series[2].date,code=series[0].sealed[0].code;
  const bars=[{date:d,role:'stock',code,volume:100,limitDown:9,limitUp:11,open:9,close:9,high:10,knownAt:series[2].knownAt}];
  const feedback=highEvents(series,bars,at);for(const n of ['断板','核按钮','反包','高标反馈'])assert.ok(feedback.some(e=>e.type===n),n);
  assert.ok(highEvents(series,[],at).some(e=>e.type==='断板后再封'));
  assert.ok(!highEvents(series,[],series[1].knownAt).some(e=>e.type==='断板'));
});
test('只比较观察时点以前已经成熟的四种风格，结果支持黑天鹅和教学样本筛选',async()=>{
  const {styleRotation}=await import(logicPath),names=['高标抱团战法','首板套利战法','赛道趋势低吸战法','远端超跌反弹战法'];
  const rows=names.flatMap((strategy,i)=>Array.from({length:5},(_,j)=>({date:'2026-11-13',decisionAt:'2026-11-13 15:00',code:'6000'+i+j,strategy,features:{position:'低位',maState:'多头排列'},outcomes:{1:{availableAt:day+' 15:15',end:day,close:i===0?3:1}}})));
  assert.equal(styleRotation(rows,day,at).preferred,'高标连板');assert.equal(styleRotation(rows,day,at-3600000).stats[0].n,0);
  rows[0].blackSwan=true;assert.equal(styleRotation(rows,day,at,1,'standard').preferred,null);
  rows[5].outcomes[1].sampleSet='test';assert.equal(styleRotation(rows,day,at,1,'all','real').stats.find(x=>x.name==='低位首板').n,4);
});
test('原生快照赋 TL-02 与下一交易日证据，部分覆盖、未来获知和周末日期均不采用',async()=>{
  const {createShortlineV6Reader}=require('../src/research/shortline-v6-data');
  const code='600001',symbols=[code,'600002'],source={source:'cls',status:'available',providerComplete:true,tradeDate:day,receivedAt:at};
  const data={ztReviewPoolMeta:{sources:[source]},ztReviewPool:symbols.map((code,i)=>({code,sources:['cls'],tradeDate:day,clsObservation:{receivedAt:at,tradeDate:day},plates:[{name:i?'算力':'AI算力',code:'cls80122'}]}))};
  const sealed={complete:true,tradeDate:day,totalCount:2,records:symbols.map((symbol,i)=>({symbol,consecutiveLimits:i?1:3}))};
  let calendar={calendarSource:'交易所公告',nextTradingDay:'2026-11-23',calendarKnownAt:at-1000};
  const read=()=>createShortlineV6Reader({clock:()=>at,getState:()=>data,readCloseReviewEvidence:()=>({day,sealed}),fetchHistory:()=>null,fetchPreviousPool:()=>null,previousTradeDay:()=>'2026-11-19',getLatestClosedDay:()=>day,calendarFor:()=>calendar})({code,day});
  const good=await read();assert.deepEqual(good.stock.factorCodes,['TL-02']);assert.match(good.stock.factorEvidence['TL-02'].text,/2板缺档/);
  assert.equal(good.stock.nextTradingDay,'2026-11-23');assert.equal(good.market[0].calendarKnownAt,at-1000);
  data.ztReviewPool.pop();calendar={...calendar,calendarKnownAt:at+1};const bad=await read();assert.equal(bad.stock.factorCodes,undefined);assert.equal(bad.stock.nextTradingDay,undefined);
  calendar={...calendar,nextTradingDay:'2026-11-21',calendarKnownAt:at};assert.equal((await read()).stock.nextTradingDay,undefined);
});
test('同题材清单也支持池外已知个股归属；入口传原交易日和统一质量筛选',async()=>{
  const {structureDemo,structureForStock,renderStructure}=await import(uiPath),frames=structureDemo(),p=frames.at(-1),code='600009';
  const state={market:frames.map(f=>({date:f.date,knownAt:f.knownAt,structurePools:[f]})),v6Observation:{code,day:p.date,observedAtMs:p.knownAt,stock:{themeRefs:references('AI算力',{provider:'cls'})}}};
  assert.ok(structureForStock(state,code,p.date,p.knownAt).some(g=>g.peers.length>0));
  assert.deepEqual(structureForStock(state,code,p.date,p.knownAt-1),[]);
  const clicked={dataset:{view:'backtest',target:'600101'}},root={querySelectorAll:q=>q==='[data-target]'?[clicked]:[],innerHTML:''};
  let dest;renderStructure({state,root,stock:code,date:p.date,sampleFilter:'excludeBlackSwan',open:(...v)=>dest=v,esc:String});
  assert.match(root.innerHTML,/600101/);clicked.onclick();assert.deepEqual(dest,['backtest',{code:'600101',date:p.date,sample:'excludeBlackSwan'}]);
});
