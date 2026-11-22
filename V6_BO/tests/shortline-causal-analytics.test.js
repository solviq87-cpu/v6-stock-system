'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'../public/nova/shortline');
const {signals,kLearningRows,applyLiveSignalWindow,backtestAction,parseKCsv,ohlcvReplayState,ohlcvReplaySignals,renderBacktest}=require(path.join(base,'backtest.mjs'));
const {returnStudy,stressStudies,analysisSelectors}=require(path.join(base,'backtest-analytics.mjs'));
const {settingsAt}=require(path.join(base,'settings.mjs'));
const exampleCsv=fs.readFileSync(path.join(base,'sample-kline.csv'),'utf8');
const catalog=require(path.join(base,'catalog.json'));
const features={shape:'小阳线',volume:'平量',turnover:'健康换手',indexTrend:'多头',themeCycle:'发酵',resonance:'共振'};
const dates=['2025-01-02','2025-01-03','2025-01-13','2025-01-14','2025-01-15','2025-01-16','2025-01-17','2025-01-20','2025-01-21','2025-01-22'];
function archive(){
  const bars=[],checks=[];
  for(const code of ['600000','000001'])dates.forEach((d,i)=>{
    bars.push({code,date:d,period:'日K',open:10,high:12,low:9,close:11,volume:10000,availableAt:d+' 15:01',name:code});
    const names=i===1?['A','B']:['A'];
    checks.push({code,date:d,name:code,capture:{features,context:{}},matches:names,eligible:names,position:10,risks:[],factors:['试盘'],
      asOf:d+' 15:01',createdAt:d+'T15:02:00+08:00'});
  });
  return {bars,checks,catalog,market:[]};
}
test('one first signal per symbol/period/strategy cooldown uses visible bars through long gaps, independent of maturity and actual future closes',()=>{
  const s=archive();
  let out=signals(s);
  const signal=(code,i)=>out.find(r=>r.code===code&&r.date===dates[i]);
  assert.deepEqual(signal('600000',0).strategies,['A']);assert.deepEqual(signal('000001',0).strategies,['A']);
  assert.deepEqual(signal('600000',1).strategies,['B']);assert.deepEqual(signal('600000',1).gate.eligible,['B']);
  assert.equal(signal('600000',1).suppressedStrategies[0].first,dates[0]);
  assert.equal(signal('600000',2),undefined);assert.deepEqual(signal('600000',3).strategies,['A']);
  const original=signals(s,dates[3]);
  const future=structuredClone(s);future.bars.forEach(b=>{if(b.date>dates[3]){b.close=3;b.high=60;b.low=1;b.volume=0;}});
  assert.deepEqual(signals(future,dates[3]),original);
  assert.equal(original.find(r=>r.date===dates[0]).outcomes[5],null);
  assert.ok(signal('600000',0).outcomes[5]);
  const extra={...s.bars[0],date:'2025-01-10',availableAt:'2030-01-01 15:00'};
  out=signals({...s,bars:[...s.bars,extra]});
  assert.equal(signal('600000',2),undefined);
  const live=applyLiveSignalWindow(s,{code:'600000',date:dates[1],matches:['A','B'],eligible:['A','B'],position:12,risks:[]},dates[1]+' 15:02');
  assert.deepEqual(live.eligible,['B']);
  const repeated=applyLiveSignalWindow(s,{code:'600000',date:dates[2],matches:['A'],eligible:['A'],position:12,risks:[]},dates[2]+' 15:02');
  assert.equal(repeated.position,0);assert.deepEqual(repeated.eligible,[]);
});
test('dated policy changes and late receipts do not rewrite earlier detections; intraday period has an independent window',()=>{
  const s=archive(),defaults=settingsAt(s);
  s.settingsHistory=[{version:1,effectiveAt:dates[2]+'T14:59:00+08:00',config:{...defaults,debounceBars:1}}];
  assert.deepEqual(signals(s,dates[1]),signals({...s,settingsHistory:[]},dates[1]));
  assert.ok(signals(s).find(r=>r.date===dates[2]&&r.strategy==='A'));
  const day=dates[0],frames=['1m','5m'];
  s.bars.push(...frames.map(period=>({code:'600000',name:'浦发银行',period,date:day+' 10:00',availableAt:day+' 10:00',open:10,high:11,low:9,close:10,volume:100,auctionGap:2,auctionRatio:2,auctionAmount:3e7,sectorAuctionUpPct:80,auctionNetBuy:100000})));
  for(const p of frames)assert.ok(signals(s,day).find(r=>r.period===p&&r.strategies.includes('竞价模式战法')));
});
test('historical blacklist is evaluated on the decision clock; future and unproven news cannot become signal factors',()=>{
  const bars=parseKCsv(exampleCsv);const s={catalog,bars,market:[]};const before=signals(s),chosen=before.find(r=>!r.gate);
  const target=bars.find(b=>b.code===chosen.code&&b.date===chosen.date);
  const effective=chosen.date+'T15:00:01+08:00',config={...settingsAt(s),blockedStocks:[chosen.code]};
  s.settingsHistory=[{version:1,effectiveAt:effective,config}];
  assert.deepEqual(signals(s,chosen.date).find(r=>r.id===chosen.id),signals({...s,settingsHistory:[]},chosen.date).find(r=>r.id===chosen.id));
  s.settingsHistory[0].effectiveAt=chosen.date+'T14:59:59+08:00';
  const blocked=signals(s,chosen.date).find(r=>r.id===chosen.id);
  assert.equal(blocked.type,'受限观察');assert.equal(blocked.gate.position,0);
  Object.assign(target,{announcementType:'业绩预增',newsSource:'公开原文',newsPublishedAt:chosen.date+' 10:00',newsKnownAt:chosen.date+' 15:01'});
  const announcement=catalog.find(c=>c.id===41).factors[0];
  assert.equal(signals(s,chosen.date).find(r=>r.id===chosen.id).factors.includes(announcement),false);
  target.newsKnownAt=chosen.date+' 14:59';
  assert.ok(signals(s,chosen.date).find(r=>r.id===chosen.id).factors.includes(announcement));
});
test('source purpose and shock tags are preserved through holding windows and never used to choose signal fires',()=>{
  const s=archive(),first=signals(s).find(r=>r.code==='600000'&&r.date===dates[0]);
  const on=b=>b.code==='600000' && b.date===dates[3];
  const flagged=s.bars.find(on);
  flagged.blackSwan='政策冲击';flagged.sampleSet='test';flagged.extreme=true;
  const at=signals(s,dates[0]).find(r=>r.id===first.id);assert.deepEqual(at.strategies,first.strategies);
  assert.equal(at.outcomes[5],null);
  const mature=signals(s).find(r=>r.id===first.id);assert.equal(mature.outcomes[5].sampleSet,'test');
  assert.equal(mature.outcomes[5].blackSwan,true);assert.equal(mature.outcomes[5].extreme,true);
  assert.equal(kLearningRows(s).some(r=>r.id===first.id),false);
  const audit=kLearningRows(s,undefined,{includeTests:true,quality:'all'}).find(r=>r.id===first.id);
  assert.equal(audit.exitTime,mature.outcomes[5].availableAt);assert.equal(audit.decisionAt,first.decisionAt);
});
test('new live CSV preserves first receipt and source, rejects test bars and adjusted input, with a separate causal raw-OHLCV replay',()=>{
  const s={scope:'live',catalog,bars:[],market:[]};
  assert.throws(()=>backtestAction(s,'k:import',{csv:exampleCsv}),/教学|测试/);
  // This source is a fixture for the LIVE input pathway; no network or user archive is involved.
  const csv=exampleCsv.replaceAll('合成教学样本甲','测试路径甲').replaceAll('合成教学样本乙','测试路径乙');
  backtestAction(s,'k:import',{csv,priceBasis:'unadjusted'});
  assert.ok(s.bars.every(b=>Number.isFinite(b.knownAt)&&b.sampleSource==='CSV 导入'&&b.priceBasis==='unadjusted'));
  const known=s.bars[0].knownAt;
  assert.equal(backtestAction(s,'k:import',{csv,priceBasis:'unadjusted'}).duplicates,192);
  assert.equal(s.bars[0].knownAt,known);assert.deepEqual(signals(s),[]);
  const immediately=ohlcvReplaySignals(s);assert.ok(immediately.length);assert.ok(immediately.some(r=>r.outcomes[5]));
  assert.ok(immediately.every(r=>r.studyMode==='ohlcvReplay'&&r.features.indexTrend==='缺失'&&r.originalKnownAt));
  assert.deepEqual(ohlcvReplaySignals(s,undefined,known-1),[]);
  const injected=structuredClone(s);
  injected.settingsHistory=[{version:99,effectiveAt:'2020-01-01T00:00Z',config:{...settingsAt(s),blockedStocks:['000001','600001'],debounceBars:60}}];
  for(const b of injected.bars)Object.assign(b,{turnover:199,announcementType:'重组',events:'二波',blackSwan:'突发',selected:'41:0',indexTrend:'疯狂',newsStatus:'无重大利空'});
  assert.deepEqual(ohlcvReplaySignals(injected),immediately);assert.deepEqual(kLearningRows(injected),[]);
  assert.equal(ohlcvReplayState({bars:[{...s.bars[0],priceBasis:'qfq'}]}).bars.length,0);
});
const mk=(id,date,gross,entry,exit,at,extra={})=>({id,date,code:'600000',strategy:'A',strategies:['A'],type:'确认信号',factors:['量能'],outcomes:{5:{entry,end:exit,availableAt:at,close:gross}},...extra});
test('distribution bins, matched A/B periods, round-trip fee, side slippage and deterministic non-overlap stress exclude immature labels',()=>{
  const rows=[
    mk('1','2025-01-02',-5,'2025-01-03','2025-01-09','2025-01-09 15:00'),
    mk('2','2025-01-06',10,'2025-01-07','2025-01-13','2025-01-13 15:00',{strategies:['A','B']}),
    mk('3','2025-01-08',0,'2025-01-09','2025-01-15','2025-01-15 15:00'),
    mk('4','2025-01-09',200,'2025-01-10','2025-01-16','2025-01-22 15:00')
  ];
  const opts={start:'2025-01-02',end:'2025-01-16',horizon:5,costBps:0,slipBps:0};
  const a=returnStudy(rows,{...opts,selector:'战法 · A'});
  assert.equal(a.n,3);assert.equal(a.settled,1);assert.equal(Math.round(a.maxDrawdown),5);
  assert.deepEqual(a.bins.map(b=>b.n),[0,0,1,1,0,1]);
  assert.deepEqual(returnStudy(rows.slice().reverse(),opts),a);
  const b=returnStudy(rows,{...opts,selector:'战法 · B'});assert.equal(b.n,1);assert.equal(b.gross,10);
  assert.equal(returnStudy(rows,{...opts,selector:'因子 · 量能'}).n,3);
  assert.deepEqual(analysisSelectors(rows).sort(),['因子 · 量能','战法 · A','战法 · B'].sort());
  const stress=stressStudies(rows,{...opts,costBps:10,slipBps:5},['战法 · A','战法 · B']);
  assert.equal(stress.length,6);assert.ok(stress[0].net>stress[1].net&&stress[1].net>stress[2].net);
  const expectedNet=((1.10*.9995*.9995)/(1.0005*1.0005)-1)*100;
  assert.ok(Math.abs(stress[3].net-expectedNet)<1e-10);assert.equal(stress[3].n,b.n);
  rows[1].outcomes[5].extreme=true;assert.equal(returnStudy(rows,{...opts,quality:'excludeExtreme'}).n,2);
});
test('view switches through the same return distribution, A/B, stress and independent raw-price replay entry points',()=>{
  const handlers=new Map(),tabs=new Map();
  const root={innerHTML:'',querySelector(q){return {addEventListener:(e,cb)=>handlers.set(q+e,cb)};},
    querySelectorAll(q){return q==='[data-ktab]'?['signals','distribution','compare'].map(ktab=>({dataset:{ktab},addEventListener:(_,f)=>tabs.set(ktab,f)})):[];}};
  const state={catalog,bars:parseKCsv(exampleCsv).map(b=>({...b,priceBasis:'unadjusted'}))};
  renderBacktest({state,root});tabs.get('distribution')();assert.match(root.innerHTML,/净收益分布/);
  tabs.get('compare')();assert.match(root.innerHTML,/批量成本压力测试/);assert.match(root.innerHTML,/kStressGroups/);
  handlers.get('#kModechange')({target:{value:'replay'}});assert.match(root.innerHTML,/回放结果独立于正式学习/);
});
test('older CSV rows without server receipt remain quarantined; identical unadjusted reimport can attest provenance atomically',()=>{
  const csv=exampleCsv.replaceAll('合成教学样本甲','路径甲').replaceAll('合成教学样本乙','路径乙');
  const bars=parseKCsv(csv).map(row=>{const {sampleSet,sampleSource,...legacy}=row;return legacy;});
  const state={scope:'live',catalog,bars,market:[]};assert.deepEqual(signals(state),[]);assert.deepEqual(ohlcvReplaySignals(state),[]);
  const conflict=csv.replace('20.57,20.78','20.58,20.78');
  assert.throws(()=>backtestAction(state,'k:import',{csv:conflict,priceBasis:'unadjusted'}),/冲突/);
  assert.ok(state.bars.every(b=>b.knownAt==null));
  assert.equal(backtestAction(state,'k:import',{csv,priceBasis:'unadjusted'}).duplicates,bars.length);
  assert.ok(state.bars.every(b=>b.knownAt>0&&b.priceBasis==='unadjusted'));assert.deepEqual(signals(state),[]);
  assert.ok(ohlcvReplaySignals(state).length>0);
});
test('live inputs isolate stock, index, sector, minutes and frozen checks before feature, outcome, similarity and cooldown calculation',()=>{
  const {deriveCheckInput,similarCases}=require(path.join(base,'backtest.mjs'));
  const s={...archive(),scope:'live'};
  for(const b of s.bars)Object.assign(b,{sector:'银行',knownAt:Date.parse(b.availableAt.replace(' ','T')+':00+08:00'),priceBasis:'unadjusted'});
  const day=dates.at(-1),at=Date.parse(day+'T16:00:00+08:00');
  s.v6Observation={day,code:'600000',observedAt:day+' 16:00',observedAtMs:at,latestClosed:true,stock:{code:'600000',sector:'银行'},minuteBars:[]};
  const mixed=structuredClone(s);
  const extreme=mixed.bars.map(b=>({...b,open:11,close:999,high:2000,low:.01,volume:9e11,sampleSet:'test'}));
  const fake={...extreme[0],date:day,knownAt:at-7200000,availableAt:day+' 14:00',indexTrend:'空头',themeCycle:'退潮'};
  mixed.bars.unshift(...extreme,{...fake,code:'全A',role:'index'},{...fake,role:'sector',code:'银行'}, {...fake,period:'1m',date:day+' 14:59'});
  mixed.v6Observation.minuteBars.push({...fake,period:'1m',date:day+' 14:59',role:'sector',code:'银行'});
  mixed.checks.unshift(...s.checks.map(c=>({...c,sampleSet:'test',matches:['测试战法'],eligible:['测试战法'],createdAt:c.date+'T15:01:30+08:00'})));
  mixed.market.push({sampleSet:'test',date:day,trend:'空头',availableAt:day+' 15:00'});
  const official=signals(s);
  assert.ok(official.length>0&&official.some(x=>x.outcomes[5]));
  assert.deepEqual(signals(mixed),official);assert.deepEqual(kLearningRows(mixed),kLearningRows(s));
  assert.deepEqual(deriveCheckInput(mixed,{code:'600000',date:day}),deriveCheckInput(s,{code:'600000',date:day}));
  const result={code:'600000',date:day,matches:['A'],eligible:['A'],position:12,risks:[]};
  assert.deepEqual(applyLiveSignalWindow(mixed,result,at),applyLiveSignalWindow(s,result,at));
  assert.deepEqual(similarCases(mixed,official[0]),similarCases(s,official[0]));
  const preview=signals(mixed,undefined,{sampleSet:'test'});
  assert.ok(preview.some(r=>r.strategies.includes('测试战法'))&&preview.every(r=>r.sampleSet==='test'));
  assert.deepEqual(ohlcvReplaySignals(mixed),ohlcvReplaySignals(s));
});
test('a testing bar at the identical live key cannot replace or prevent import of a real bar',()=>{
  const csv='date,code,name,open,high,low,close,volume\n2025-01-02,600000,浦发银行,10,12,9,11,1000';
  const s={scope:'live',catalog,bars:[{...parseKCsv(csv)[0],sampleSet:'test',high:9000}]};
  assert.equal(backtestAction(s,'k:import',{csv,priceBasis:'unadjusted'}).count,1);
  assert.equal(backtestAction(s,'k:import',{csv,priceBasis:'unadjusted'}).duplicates,1);
  assert.deepEqual(s.bars.map(b=>[b.sampleSet,b.high]),[['test',9000],['real',12]]);
});
