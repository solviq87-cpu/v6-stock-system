'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildIntelligenceVisuals}=require('../src/core/intelligence-visuals');
const day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00'),code='600000';
const quote=patch=>({code,name:'原始观测',sector:'芯片',price:10,pct:2,mktcap:1000000000,
  quoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified',
  poolDay:day,score:85,baziDims:{trend:0},baziWhy:{trend:'原趋势分为零'},...patch});
const build=(state={},decision={},patch={})=>buildIntelligenceVisuals(state,decision,{day,now,code,...patch});
const axis=(result,id)=>result.radar.axes.find(row=>row.id===id);
const council=(sourceAt,patch={})=>({cards:[{code,day,authority:'fayo-decision-center',calculatedAt:now,
  strategyBasis:{day,quoteAt:now-1000},council:{views:[{id:'fundamental',score:72,missing:[],
    evidence:[{known:true,source:'原公司资料',sourceAt,text:'已留存的基本面评分'}]}]},...patch}]});

test('market heatmap keeps exact original market-cap amounts and excludes incompatible or contradictory observations',()=>{
  const rows=[quote(),quote({code:'600001',mktcap:0}),quote({code:'600002',quoteAt:now+1}),
    quote({code:'600003',receivedAt:now-2000}),quote({code:'600004',quoteAt:Date.parse('2026-11-24T10:00:00+08:00')}),
    quote({code:'600005',synthetic:true}),quote({code:'600006',mktcap:2000000000}),quote({code:'600006',mktcap:3000000000})];
  const state={stocks:rows},before=JSON.stringify(state),result=build(state);
  assert.equal(result.heatmap.observedCount,1);assert.equal(result.heatmap.items[0].marketCapYuan,1000000000);
  assert.equal(result.heatmap.items[0].quoteAt,now-1000);assert.equal(result.heatmap.items[0].knownAt,now-500);
  assert.equal(result.heatmap.excluded,7);assert.equal(result.canTrade,false);assert.equal(JSON.stringify(state),before);
  const identical=build({stocks:[quote(),quote()]});
  assert.equal(identical.heatmap.observedCount,1,'the same original quote is deduplicated, not treated as contradictory');
});

test('radar preserves an observed zero and leaves every missing dimension unknown',()=>{
  const result=build({candidatePool:[quote()]});
  assert.equal(result.radar.axes.length,9);assert.equal(axis(result,'trend').value,0);
  assert.equal(axis(result,'selection').value,85);assert.equal(axis(result,'fundamental').value,null);
  assert.equal(axis(result,'fundamental').knownAt,null);assert.equal(result.radar.known,2);
  assert.equal(build().radar.known,0);
});

test('conflicting strategy dates and simulated candidate flags cannot become a current radar',()=>{
  for(const patch of [{poolDay:'2026-11-24'},{sourceTradeDate:'2026-11-24'},{tradeDate:'2026-11-24'},
    {quoteAt:now+1},{quoteSource:''},{mock:true},{synthetic:true},{fixture:true},{simulated:true},{readOnlyBackup:true}]){
    const result=build({candidatePool:[quote(patch)]});
    assert.equal(result.radar.known,0,JSON.stringify(patch));
    assert.ok(result.radar.axes.every(row=>row.value===null),JSON.stringify(patch));
  }
});

test('council radar retains original evidence time rather than refreshing it to the request calculation time',()=>{
  const original=now-3600000,state={candidatePool:[quote()]},decision=council(original),before=JSON.stringify(decision);
  const result=build(state,decision),fundamental=axis(result,'fundamental');
  assert.equal(fundamental.value,72);assert.equal(fundamental.knownAt,original);
  assert.notEqual(fundamental.knownAt,decision.cards[0].calculatedAt);
  assert.ok(fundamental.sourceTimes.some(row=>row.source==='原公司资料'&&row.sourceAt===original));
  assert.equal(JSON.stringify(decision),before);
});

test('future or unknown council evidence clocks cannot be dated with the server request time',()=>{
  for(const at of [now+1,null,undefined]){
    const result=build({candidatePool:[quote()]},council(at));
    assert.equal(axis(result,'fundamental').value,null,String(at));
    assert.equal(axis(result,'fundamental').knownAt,null,String(at));
  }
});

test('a different stock or decision day cannot supply the selected radar council',()=>{
  for(const patch of [{code:'600001'},{day:'2026-11-24'}]){
    const result=build({candidatePool:[quote()]},council(now-3600000,patch));
    assert.equal(axis(result,'fundamental').value,null,JSON.stringify(patch));
  }
});

test('emotion stages and money flows only appear with actual attributed evidence; net sector amounts do not create links',()=>{
  const empty=build({sectors:[{name:'芯片',mainInflow:1000000}],marketRecovery:{}});
  assert.equal(empty.emotion.phase,null);assert.equal(empty.sankey.status,'missing-data');assert.deepEqual(empty.sankey.links,[]);
  const state={marketRecovery:{emotion:{date:day,value:'修复',knownAt:now-10000,source:'原多日情绪引擎'}},
    fundFlowLinks:{day,unit:'CNY',kind:'observed-transfer',source:'原来源去向明细',knownAt:now-2000,
      links:[{from:'来源甲',to:'去向乙',amount:100000},{from:'甲',to:'甲',amount:5},{from:'甲',to:'乙',amount:0}]}};
  const result=build(state);assert.equal(result.emotion.phase,'回暖');assert.equal(result.emotion.originalPhase,'修复');
  assert.equal(result.emotion.knownAt,now-10000);assert.equal(result.sankey.links.length,1);
  assert.equal(result.sankey.links[0].amount,100000);assert.equal(result.sankey.links[0].knownAt,now-2000);
  for(const patch of [{day:'2026-11-24'},{knownAt:now+1},{unit:'USD'},{kind:'sector-net'}])
    assert.equal(build({...state,fundFlowLinks:{...state.fundFlowLinks,...patch}}).sankey.links.length,0);
});
