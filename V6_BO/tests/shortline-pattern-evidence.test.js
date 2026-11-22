'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const catalog=require('../public/nova/shortline/catalog.json');
const code='600001',day='2026-11-20';
const base={catalog,b:{date:day,code,name:'甲',sector:'设备'},f:{position:'低位'}};
const group=(members,leader=code)=>({name:'设备',type:'主线',count:members.length,members,leader,ladderComplete:true});
const analyze=async data=>(await import('../public/nova/shortline/pattern-evidence.mjs')).addPatternEvidence({...base,...data},new Map());
test('格外证据不覆盖已有事实；证据缺失不补造未知标签',async()=>{
  assert.equal((await analyze({})).size,0);
  const {addPatternEvidence}=await import('../public/nova/shortline/pattern-evidence.mjs');
  const seed=new Map([['17:0',{pass:false,source:'prior'}]]);
  const market={date:day,theme:'设备',themes:[group([{code,level:4}])]};
  addPatternEvidence({...base,market},seed);
  assert.equal(seed.get('17:0').source,'prior');assert.equal(seed.get('23:1').pass,true);
  assert.equal(seed.has('26:3'),false);
});

test('同期板块梯队及连续收盘口径可算，市场缺日或晚到的修订不会提前利用',async()=>{
  const g=group([{code,level:1},{code:'600002',name:'乙',level:4}],'乙');
  const m={date:day,theme:'设备',upLimit:2,height:4,themes:[g],downLimit:9,breakRate:21};
  const prev={date:'2026-11-19',themes:[group([{code:'600002',name:'乙',level:3}],'乙')],downLimit:15,breakRate:35};
  const f=await analyze({market:m,marketSeries:[prev,m]});
  for(const id of ['17:0','17:1','17:3','17:4','23:3','23:5','39:1','39:2','26:0'])assert.equal(f.get(id)?.pass,true,id);
  assert.equal((await analyze({market:m,marketSeries:[{...prev,date:'2026-11-17'},m]})).has('39:1'),false);
  assert.equal((await analyze({market:m,marketSeries:[{...prev,availableAt:'2026-11-21 09:30'},m]})).has('39:2'),false);
  assert.equal((await analyze({market:{...m,date:'2026-11-23'}})).has('17:1'),false);
});

test('放量拉升、同板块抗跌仅消费当前标的和当时可见的连续分钟',async()=>{
  const rows=[];
  for(let i=0;i<15;i++){
    const date=day+' 09:'+String(31+i).padStart(2,'0');
    const close=i>=12?10.05+(i-12)*.07:10;
    rows.push({role:'stock',code,date,open:10,close,high:Math.max(10,close),low:9.99,volume:i>=12?300:80});
    const price=10-i*.02;
    rows.push({role:'sector',code:'BK1001',sector:'设备',date,open:price,close:price,high:price,low:price,volume:80});
  }
  const b={...base.b,date:day+' 09:45'};
  let f=await analyze({b,intraday:rows});
  assert.equal(f.get('7:0')?.pass,true);assert.equal(f.get('2:4')?.pass,true);
  f=await analyze({b,intraday:rows.filter(r=>r.date!==day+' 09:40')});
  assert.equal(f.has('7:0'),false);
  const future={...rows.at(-2),date:day+' 09:46',close:1000,high:1000,volume:99999};
  assert.deepEqual(await analyze({b,intraday:[...rows,future]}),await analyze({b,intraday:rows}));
  const late=rows.map(r=>r.date===day+' 09:45'?{...r,availableAt:day+' 14:00'}:r);
  assert.notEqual((await analyze({b,intraday:late})).get('7:0')?.pass,true);
});

test('同期公告分类要求标的与来源匹配、原发表与接收时点双重门槛',async()=>{
  const msg={code,type:'资产注入',title:'公司收到资产注入公告',source:'法定信息披露平台',
    publishedAt:day+' 10:20',knownAt:day+' 10:30'};
  const b={...base.b,announcements:[msg]};
  assert.equal((await analyze({b})).get('41:0')?.pass,true);
  for(const change of [{knownAt:day+' 15:12'},{publishedAt:day+' 10:32'},{publishedAt:day},{code:'600002'},{source:''},{title:'终止资产注入'}])
    assert.equal((await analyze({b:{...b,announcements:[{...msg,...change}]}})).has('41:0'),false);
  assert.equal((await analyze({b:{...b,announcements:[]}})).has('4:4'),false);
});

test('计划风险收益必须以决策前冻结的同标的计划为证据',async()=>{
  const b={...base.b,frozenPlan:{code,frozenAt:day+' 09:15',entryPrice:10,stopPrice:9,targetPrice:13,exitStyle:'反弹止盈'}};
  assert.equal((await analyze({b})).get('18:3')?.pass,true);
  assert.equal((await analyze({b})).get('48:4')?.pass,true);
  assert.equal((await analyze({b:{...b,frozenPlan:{...b.frozenPlan,frozenAt:day+' 20:00'}}})).has('18:3'),false);
});

test('V6 自动校验入口读取带源时点的巨潮中性标题并触发风控，过晚或模糊公告不入选',async()=>{
  const {autoValidate}=await import('../public/nova/shortline/market.mjs');
  const bar={code,date:day,period:'日K',name:'甲',role:'stock',open:10,close:10.2,high:10.4,low:9.8,volume:4500,turnover:5};
  const announcement={code,title:'关于公司收到中国证券监督管理委员会立案告知书的公告',source:'巨潮资讯 · 未独立核验',publishedAt:day+'T07:31:00Z',knownAt:day+'T08:00:03Z',verified:false};
  const s={catalog,bars:[bar],market:[],plans:[],trades:[],checks:[],corrections:[],notes:[],versions:[],
    v6Observation:{latestClosed:true,day,code,observedAt:day+' 16:01',observedAtMs:Date.parse(day+'T08:01:10Z'),stock:{code,announcements:[announcement]}}};
  const result=autoValidate(s,{code,date:day});
  assert.ok(result.selected.includes('56:2'));assert.equal(result.position,0);assert.ok(result.recognition.evidence.some(t=>t.includes('未独立核验')));
  s.v6Observation.stock.announcements=[{...announcement,title:'关于公司未收到立案告知书的澄清公告'}];
  assert.ok(!autoValidate(s,{code,date:day}).selected.includes('56:2'));
  s.v6Observation.stock.announcements=[{...announcement,knownAt:day+'T08:01:11Z'}];
  assert.ok(!autoValidate(s,{code,date:day}).selected.includes('56:2'));
});

test('V6 正常校验与回测能自动完整识别分支龙头；缺单独催化或声明晚到则不能完整匹配',async()=>{
  const {autoValidate}=await import('../public/nova/shortline/market.mjs'),{signals}=await import('../public/nova/shortline/backtest.mjs');
  const proof={code,source:'板块分类与收盘指数归档',reference:'archive-11-20',knownAt:day+' 15:00',publishedAt:day+' 14:59'};
  const b={...base.b,period:'日K',role:'stock',open:10,close:10.2,high:10.4,low:9.9,volume:10000,
    classificationEvidence:{...proof,parent:'半导体',branch:'设备',branchLeader:code,parentLeader:'600099',branchChange:4,parentChange:1},
    sectorAnnouncements:[{...proof,sector:'设备',type:'独立催化',eventId:'设备行业单独公告'}]};
  const s={catalog,bars:[b],market:[{date:day,theme:'半导体',themeType:'主线'}],plans:[],trades:[],checks:[],versions:[],corrections:[],notes:[]};
  const check=autoValidate(s,{code,date:day});
  assert.ok(check.matches.includes('分支龙头战法'));assert.equal(check.position,0);
  assert.ok(signals(s).some(sig=>sig.strategy==='分支龙头战法'));
  b.sectorAnnouncements=[];assert.ok(!autoValidate(s,{code,date:day}).matches.includes('分支龙头战法'));
  b.classificationEvidence.knownAt=day+' 15:01';assert.ok(!autoValidate(s,{code,date:day}).selected.includes('50:0'));
});

test('逻辑核验、集体错杀必须有已知来源和可计算证据，未来值或仅有价格跌幅不足以判定',async()=>{
  const proof={source:'官方记录',reference:'公告 / 归档指纹',publishedAt:day+' 14:50',knownAt:day+' 14:55'};
  const thesis={...proof,code,planId:'归档计划一',frozenAt:day+' 09:00',
    conditions:[{criterion:'订单金额下限',source:'公告数据',observed:3,threshold:2,operator:'>=',observedAt:day+' 13:00',knownAt:day+' 14:30'}]};
  const shock={...proof,sector:'设备',claim:'全行业停工',finding:'负面消息核心事实不实',evidenceText:'当日核查公告确认生产继续'};
  const b={...base.b,thesisEvidence:thesis,sectorClarification:shock,sectorDrawdownPct:-5,sectorDeclinersPct:80,sectorRecoveryPct:2};
  let f=await analyze({b});assert.equal(f.get('24:2')?.pass,true);assert.equal(f.get('16:0')?.pass,true);
  thesis.conditions[0].knownAt=day+' 15:01';shock.knownAt=day+' 15:01';
  f=await analyze({b});assert.equal(f.has('24:2'),false);assert.equal(f.has('16:0'),false);
  f=await analyze({b:{...b,sectorClarification:undefined,thesisEvidence:undefined}});assert.equal(f.has('24:2'),false);assert.equal(f.has('16:0'),false);
});

test('高标抱团的横盘轮动特征要求已判定阶段和连续市场数据，未判定不会替代混沌',async()=>{
  const rotate=(date,theme,change)=>({date,theme,themeType:'主线',trend:'震荡',indexChange:change});
  const m=rotate(day,'设备',.3),rows=[rotate('2026-11-18','有色',-.5),rotate('2026-11-19','电池',.4),m];
  assert.equal((await analyze({market:m,marketSeries:rows,stage:'分歧'})).get('26:3')?.pass,true);
  assert.equal((await analyze({market:m,marketSeries:rows,stage:'未判定'})).has('26:3'),false);
  assert.equal((await analyze({market:m,marketSeries:rows.slice(1),stage:'分歧'})).has('26:3'),false);
});

test('可选 CSV 证据字段有结构及数值边界，拒绝错误 JSON 与伪数字',async()=>{
  const {parsePatternColumns}=await import('../public/nova/shortline/pattern-evidence.mjs');
  assert.deepEqual(parsePatternColumns({sectorActiveBuyPct:'3.1',announcements:'[{"title":"季度业绩预增公告"}]'}),{sectorActiveBuyPct:3.1,announcements:[{title:'季度业绩预增公告'}]});
  assert.throws(()=>parsePatternColumns({sectorClarification:'yes'}));
  assert.throws(()=>parsePatternColumns({activeSellPct:' '}));assert.throws(()=>parsePatternColumns({activeSellPct:'101'}));
});

test('箱体先在历史区间验证两侧，再在当前放量突破；同根无需同时位于上下沿',async()=>{
  const {autoValidate}=await import('../public/nova/shortline/market.mjs');
  const b={...base.b,role:'stock',period:'日K',open:10.5,high:11.4,low:10.45,close:11.3,volume:200};
  const history=Array.from({length:20},(_,i)=>({...b,date:'2026-10-'+String(i+1).padStart(2,'0'),open:10.5,low:10.3,high:10.8,close:10.55,volume:100}));
  history[3]={...history[3],low:10,close:10.6};history[12]={...history[12],high:11,close:10.4};
  const s={catalog,bars:[...history,b],market:[],plans:[],trades:[],checks:[],versions:[],corrections:[],notes:[]};
  assert.ok(autoValidate(s,{code,date:day}).matches.includes('箱体震荡战法'));
});
