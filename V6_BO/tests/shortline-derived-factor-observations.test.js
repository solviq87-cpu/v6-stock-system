'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {observeDerivedFactors:read}=require('../public/nova/shortline/derived-factor-observations.mjs');
const {structureDemo}=require('../public/nova/shortline/structure.mjs');
const {seedDemo}=require('../src/research/shortline/demo.mjs');
const dates=['2025-07-16','2025-07-17','2025-07-18'],[start,prev,day]=dates,code='600101';
const at=(d,h='15:20')=>Date.parse(d+'T'+h+':00+08:00');
const observation=(d=day)=>({day:d,code,stock:{code},observedAtMs:at(d,'16:00'),latestClosed:true,latestClosedDay:d});
const sampleTape=(s='V6/eastmoney')=>[
 [10,10,9.9,9.98,100],[9.98,10.03,9.92,9.97,100],[9.97,10.01,9.94,9.98,100],
 [9.98,10.03,9.97,10.02,120],[10.02,10.05,10.01,10.04,130],[10.04,10.09,10.03,10.07,100]
].map(([open,high,low,close,volume],i)=>({role:'stock',code,period:'5m',source:s,priceBasis:'unadjusted',volumeUnit:'shares',date:day+' '+['09:35','09:40','09:45','09:50','09:55','10:00'][i],
 open,high,low,close,volume,amount:volume*close,knownAt:at(day,'15:02')+i}));
test('发布版教学包可复算高标负反馈及题材发酵时长，教学证据不会成为正式因素',()=>{
 const s={scope:'demo',catalog:JSON.parse(fs.readFileSync(path.join(__dirname,'../public/nova/shortline/catalog.json'))),market:[],bars:[],notes:[],checks:[],trades:[],plans:[]};
 seedDemo(s);
 const f=read(s,observation());
 assert.equal(f['QX-01'].value,-7.11);assert.equal(f['QX-01'].sampleSet,'test');assert.deepEqual(f['QX-01'].cohortCodes,[code]);
 assert.equal(f['TL-01'],undefined,'另一只同题材股票缺收盘反馈，不凑齐样本');
 const stage=s.bars.find(b=>b.code==='000001'&&b.themeCycle==='发酵');
 assert.ok(stage);
 const o={...observation(stage.date),code:stage.code,stock:{code:stage.code}};
 const rec=read(s,o)['TL-05'];assert.ok(rec);assert.equal(rec.total,rec.value);assert.equal(rec.observed,rec.total);assert.ok(rec.knownAt<=o.observedAtMs);
 assert.equal(read({...s,scope:'live'},observation())['QX-01'],undefined);
 const ambiguous=structuredClone(s);ambiguous.bars.push({...stage,themeCycle:'分歧'});assert.equal(read(ambiguous,o)['TL-05'],undefined);
});
test('龙头溢价差使用冻结完整队列和同源全员收盘反馈，未来观测不改变当时证据',()=>{
 const frames=structureDemo().slice(0,3);
 const f=frames[2];
 f.outcomes['600103']={change:-1.11,knownAt:f.knownAt,source:'教学演示'};
 const s={scope:'demo',market:frames.map(p=>({date:p.date,previousDay:p.previousDay,knownAt:p.knownAt,source:p.source,sampleSet:'test',structurePools:[p]}))};
 const ref=read(s,observation())['TL-01'];assert.equal(ref.value,-6);assert.equal(ref.unit,'百分点');assert.equal(ref.observed,2);assert.equal(ref.leaderCode,code);
 const historical={...observation(),latestClosed:false};assert.deepEqual(read(s,historical),{});
 for(const modify of [
  x=>x.market[1].structurePools[0].complete=false,
  x=>x.market[1].structurePools[0].knownAt=at(day,'10:00'),
  x=>x.market[2].structurePools[0].outcomes['600103'].knownAt=at(day,'17:00'),
  x=>x.market[2].structurePools[0].outcomes['600103'].source='不同口径来源',
  x=>x.market[2].structurePools[0].scope='另一市场范围',
  x=>x.market[1].structurePools[0].sealed.push(x.market[1].structurePools[0].sealed[0])
 ]){const changed=structuredClone(s);modify(changed);assert.equal(read(changed,observation())['TL-01'],undefined);}
});
test('成交额占比严格核实同日同证券、供应商、币种及原收盘时间',()=>{
 const q={code,tradeDate:day,source:'tencent',quoteAt:at(day,'15:00'),knownAt:at(day,'15:03'),amountCny:123e6,floatCapCny:5e9,unit:'CNY'};
 const run=x=>read({}, {...observation(),stock:{code,capitalSnapshot:x}})['LX-03'];
 const f=run(q);assert.equal(f.value,2.46);assert.equal(f.unit,'%');assert.equal(f.knownAt,q.knownAt);
 for(const patch of [{code:'600102'},{tradeDate:prev},{source:''},{unit:'亿元'},{quoteAt:at(day,'14:59')},{quoteAt:at(prev)},{knownAt:at(day,'16:01')},{floatCapCny:0},{availableAt:at(day,'15:30')}])assert.equal(run({...q,...patch}),undefined);
});
test('完整开盘时段计算兑现、均价回踩和量能跟随，缺K、错量纲和迟到明细不进入证据',()=>{
 const bars=sampleTape();const run=bs=>read({}, {...observation(),minuteBars:bs});
 const r=run(bars);
 assert.equal(r['JP-03'].value,0.2);assert.ok(r['LX-01']);assert.equal(r['LX-01'].observed,6);assert.equal(r['LX-01'].knownAt,bars.at(-1).knownAt);
 assert.equal(r['LX-02'],undefined);
 const up=structuredClone(bars);up[0].open=9.9;
 assert.equal(run(up)['LX-02'].value,1.1667);assert.equal(run(up)['JP-03'],undefined);
 assert.equal(run(bars.slice(1))['JP-03'],undefined);assert.equal(run([...bars,bars[0]])['JP-03'],undefined);
 assert.equal(run(bars.map(b=>({...b,amount:b.amount/100})))['LX-01'],undefined);
 const late=structuredClone(bars);late[2].knownAt=at(day,'17:00');assert.equal(run(late)['JP-03'],undefined);
 assert.equal(run(bars.map(b=>({...b,source:'未知报价单位'})))['LX-01'],undefined);
 assert.equal(run(bars.map(b=>({...b,volumeUnit:'手'})))['LX-02'],undefined);
});
test('溢价修复使用连续交易日与同一计算、来源及范围，仅统计已观察到的回升',()=>{
 const make=(d,p,v,n)=>({date:d,previousDay:p,knownAt:at(d),source:'收盘输出',premium:v,fieldSources:{premium:{n,previousDay:p,knownAt:at(d),source:'前日池 / 收盘反馈',
  method:'上一交易日冻结成分的当日收盘涨幅等权平均',sources:[{tradeDate:p,scope:'沪深同一范围',source:'前日池',receivedAt:at(p)},{tradeDate:d,scope:'昨日池表现',source:'收盘反馈',receivedAt:at(d)}]}}});
 const s={market:[make(prev,start,-2.2,12),make(day,prev,0.3,15)]};
 const r=read(s,observation())['QX-03'];assert.equal(r.value,2.5);assert.equal(r.unit,'百分点');assert.equal(r.previousObserved,12);assert.equal(r.observed,15);
 for(const mod of [x=>x.market[1].fieldSources.premium.sources[0].scope='缩小后的池',x=>x.market[1].previousDay=start,
  x=>x.market[0].fieldSources.premium.sources[1].receivedAt=at(day,'18:00'),x=>x.market[1].premium=-3]){
  const n=structuredClone(s);mod(n);assert.equal(read(n,observation())['QX-03'],undefined);
 }
 assert.deepEqual(read(s,{...observation(),stock:{code:'600002'}}),{});
});
