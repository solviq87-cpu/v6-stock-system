const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {parseKCsv,backtestAction,signals,kLearningRows,similarCases,equityStats}=require('../public/nova/shortline/backtest.mjs');

const catalog=JSON.parse(readFileSync(new URL('../public/nova/shortline/catalog.json',require('node:url').pathToFileURL(__filename).href)));
const csv=readFileSync(new URL('../public/nova/shortline/sample-kline.csv',require('node:url').pathToFileURL(__filename).href),'utf8');
const example=()=>({catalog,bars:parseKCsv(csv),market:[],corrections:[]});
const auctionEvidence={auctionGap:2,auctionRatio:2,auctionAmount:30000000,sectorAuctionUpPct:80,auctionNetBuy:100000};

test('CSV import deduplicates identical records and rejects a conflicting batch atomically',()=>{
  const s={catalog,bars:[]};
  const first=backtestAction(s,'k:import',{csv});
  assert.equal(first.count,192);
  assert.deepEqual(backtestAction(s,'k:import',{csv}),{count:0,duplicates:192});
  const before=structuredClone(s.bars);
  assert.throws(()=>backtestAction(s,'k:import',{csv:csv.replace('合成教学样本甲','其它名称')}),/冲突/);
  assert.deepEqual(s.bars,before);
  assert.throws(()=>parseKCsv('date,code,open,high,low,close,volume\n2025-02-31,000001,1,2,1,2,30'),/日期/);
});

test('adding or altering all later OHLCV cannot change any features or decisions at the cutoff',()=>{
  const s=example(),until='2025-05-16';
  const truncated={...s,bars:s.bars.filter(b=>b.date<=until)};
  const changed={...s,bars:s.bars.map(b=>b.date<=until?b:{...b,close:b.close*200,high:b.high*200,indexTrend:'空头',themeCycle:'退潮'})};
  const ref=signals(truncated,until);assert.ok(ref.length);
  assert.deepEqual(signals(s,until),ref);
  assert.deepEqual(signals(changed,until),ref);
  const full=new Map(signals(changed).map(s=>[s.id,s]));
  for(const signal of ref){
    assert.deepEqual(full.get(signal.id).features,signal.features);
    assert.equal(full.get(signal.id).strategy,signal.strategy);
    for(const o of Object.values(signal.outcomes))if(o)assert.ok(o.end<=until);
  }
});

test('forward outcomes are unavailable at signal time and use the next session open',()=>{
  const s=example(),sig=signals(s).find(s=>s.outcomes[10]);
  const at=signals(s,sig.date).find(x=>x.id===sig.id);
  assert.ok(Object.values(at.outcomes).every(o=>o===null));
  const next=s.bars.find(b=>b.date>sig.date&&b.code===sig.code);
  const after=signals(s,next.date).find(x=>x.id===sig.id);
  assert.equal(after.outcomes[1].close,Math.round((next.close/next.open-1)*1e6)/1e4);
  assert.equal(after.outcomes[2],null);
  const late={...s,bars:s.bars.map(b=>b===next?{...b,availableAt:'2040-01-01'}:b)};
  assert.equal(signals(late,next.date).find(x=>x.id===sig.id).outcomes[1],null);
});

test('similarity is ranked using signal-time features, both outcome sides mature by query time',()=>{
  const s=example();
  const fixtures=signals(s).map(target=>({target,res:similarCases(s,target)}));
  assert.ok(fixtures.some(x=>x.res.success.length));
  assert.ok(fixtures.some(x=>x.res.failure.length));
  for(const {target,res} of fixtures)for(const side of [res.success,res.failure]){
    for(const [i,r] of side.entries()){
      assert.ok(r.date<target.date);
      assert.ok(r.outcomes[5].end<=target.date);
      assert.ok(r.similarity>=.6 && (i===0||side[i-1].similarity>=r.similarity));
    }
    const past={...s,bars:s.bars.filter(b=>b.date<=target.date)};
    assert.deepEqual(similarCases(past,target),res);
  }
  const q={...fixtures[0].target,features:{...fixtures[0].target.features,turnover:'缺失'}};
  assert.deepEqual(similarCases(s,q).missing,['换手']);
  assert.equal(similarCases(s,q).distributions[5].n,0);
});

test('later signal corrections leave causal report and training rows unchanged',()=>{
  const s=example(),original=signals(s),rows=kLearningRows(s);
  backtestAction(s,'k:correct',{id:original[0].id,mode:'撤销信号',reason:'盘后复查发现重复形态',strategy:''});
  assert.equal(s.corrections.length,1);
  assert.deepEqual(signals(s),original);
  assert.deepEqual(kLearningRows(s),rows);
});

test('automatically detected auction strategy remains blocked under absent market evidence; shocks excluded from learning',()=>{
  const s=example(),b=s.bars[40],signalId=['stock',b.code,b.period,b.date].join('/');
  Object.assign(b,auctionEvidence);
  let row=signals(s).find(x=>x.id===signalId);
  assert.equal(row.gate.position,0);
  assert.equal(row.type,'受限观察');
  assert.equal(kLearningRows(s).some(r=>r.id===row.id),false);
  const study=signals(s).find(x=>!x.gate&&x.outcomes[5]);
  s.bars.find(b=>b.date===study.date&&b.code===study.code).blackSwan='政策冲击';
  assert.equal(signals(s).find(r=>r.id===study.id).blackSwan,true);
  assert.equal(kLearningRows(s).some(r=>r.id===study.id),false);
});

test('late market revisions and daily closing context stay unavailable to historical and intraday signals',()=>{
  const s=example(),b=s.bars[50];Object.assign(b,auctionEvidence);delete b.indexTrend;
  s.market=[{date:b.date,trend:'空头',availableAt:'2030-01-01 15:00'}];
  s.marketHistory=[{date:b.date,trend:'多头',availableAt:b.date+' 15:00'}];
  assert.equal(signals(s,b.date).find(r=>r.code===b.code&&r.date===b.date).features.indexTrend,'多头');
  const intrabar={...b,period:'5m',date:b.date+' 10:00',availableAt:b.date+' 10:00'};
  s.bars.push(intrabar);
  assert.equal(signals(s,b.date).find(r=>r.period==='5m').features.indexTrend,'缺失');
});

test('drawdown uses chronological non-overlapping settlements',()=>{
  const r=(date,end,close)=>({date,code:'000001',outcomes:{5:{end,close}}});
  assert.deepEqual(equityStats([r('2025-01-07','2025-01-14',-20),r('2025-01-02','2025-01-08',-90),r('2025-01-01','2025-01-07',10)]),{n:2,drawdown:-20,totalReturn:-12});
});

test('strategy IDs in historical annotations cannot create an unsupported signal',()=>{
  const s={catalog,bars:[{date:'2025-04-01',code:'000001',name:'测试',period:'日K',open:10,high:10.3,low:9.9,close:10.2,volume:60,selected:'14:0|14:1|14:2|14:3|14:4'}]};
  assert.deepEqual(signals(s),[]);
  assert.throws(()=>backtestAction({...s,scope:'live'},'k:import',{csv}),/教学数据/);
});
