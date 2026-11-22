'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const day='2026-11-20',code='600001';
const date=n=>'2026-11-'+String(n).padStart(2,'0');
const bar=(d,x={})=>({code,date:d,role:'stock',period:'日K',open:10,close:10,low:9.9,high:10.1,volume:10000,...x});
const modulePromise=import('../public/nova/shortline/stock-risk-evidence.mjs');
async function scan(context,seed=[]){
  const {addStockRiskEvidence}=await modulePromise;
  const facts=new Map(seed);addStockRiskEvidence({b:bar(day),asOf:day+' 15:00',...context},facts);
  return facts;
}
const yes=(facts,...keys)=>keys.forEach(key=>assert.equal(facts.get(key)?.pass,true,key));
const unknown=(facts,...keys)=>keys.forEach(key=>assert.equal(facts.has(key),false,key));

test('风险仅由有时点的个股与标的上下文触发；情绪和助攻缺失保持未知',async()=>{
  const f=await scan({f:{sectorAssists:0,sectorLeader:'未知',position:'高位'},stage:'高潮',market:{date:day,breakRate:69}});
  unknown(f,'20:1','20:3','30:0','37:0','40:3','55:2','59:1','61:0','64:0','68:0','70:3');
  const old=await scan({b:bar(day,{tradingStatus:'停牌',availableAt:'2026-11-23 10:00'})});
  assert.equal(old.size,0);
});

test('高位低开与放量滞涨、缩量连板兑现及前日一字开板使用连续交易日',async()=>{
  const h=[bar(date(18),{limitUp:10,streak:3,volume:40000}),bar(date(19),{limitUp:10,streak:4,volume:30000,sector:'机器人',sectorAssists:4})];
  let f=await scan({b:bar(day,{auctionGap:-6}),history:h,f:{change:-.1,ratio:2}});
  yes(f,'11:0','30:0','30:3');
  f=await scan({b:bar(day,{streak:5,limitUp:10,turnover:.6,sealRatio:.4,sector:'机器人',sectorAssists:0}),history:h,
    stage:'分歧',market:{date:day,breakRate:43}});
  yes(f,'40:0','40:1','40:2','40:3','20:1','20:2','20:3');
  f=await scan({b:bar(day,{close:9.5,limitUp:11}),history:[bar(date(19),{high:10,low:10,limitUp:10,streak:3})],f:{change:-5,ratio:2.2}});
  yes(f,'46:3');
  f=await scan({b:bar(day,{auctionGap:-6}),history:[bar(date(12),{streak:5})]});
  unknown(f,'30:0');
});

test('基本面需有同标的披露来源和可知时间，金融企业不套用普通工商偿债口径',async()=>{
  const attrs={fundamentalSource:'交易所披露',financialPeriodEnd:'2026-09-30',fundamentalPublishedAt:'2026-10-26 18:00',
    fundamentalKnownAt:'2026-10-26 18:20',issuerIndustry:'机械设备',debtToAssetsPct:86,cashToShortDebtPct:35,
    goodwillToNetAssetsPct:42,pledgedSharesPct:51,top10FloatHolderPct:83};
  let f=await scan({b:bar(day,attrs)});yes(f,'56:5','65:2','69:1','69:2');
  f=await scan({b:bar(day,{...attrs,issuerIndustry:'银行'})});unknown(f,'69:2');
  for(const patch of [{fundamentalKnownAt:day+' 15:01'},{fundamentalKnownAt:''},{financialPeriodEnd:'2020-09-30'},{fundamentalSource:''}]){
    f=await scan({b:bar(day,{...attrs,...patch})});unknown(f,'56:5','65:2','69:1','69:2');
  }
});

test('停牌、实时报价价差与全成分板块断层分开判定，封板数不充当全板块上涨数',async()=>{
  const attrs={tradingStatus:'停牌',sector:'设备',sectorLeader:code,sectorTotalCount:30,sectorObservedCount:30,
    sectorAdvancingCount:1,sectorBreadthSource:'行情汇总',sectorBreadthAt:day+' 15:00',sectorBreadthReceivedAt:day+' 15:00'};
  let f=await scan({b:bar(day,attrs),f:{change:2}});yes(f,'57:1','68:0','68:1');
  for (const patch of [{sectorObservedCount:29},{sectorLeader:'000001'},{sectorBreadthAt:date(19)+' 15:00'}]){
    f=await scan({b:bar(day,{...attrs,...patch}),f:{change:2}});unknown(f,'68:0','68:1');
  }
  f=await scan({b:bar(day,{bid1:9.8,ask1:10.2,quoteAt:day+' 14:59',quoteReceivedAt:day+' 14:59',quoteSource:'盘口'})});yes(f,'57:1');unknown(f,'57:2');
  f=await scan({b:bar(day,{bid1:9.8,ask1:10.2,quoteAt:day+' 10:00',quoteReceivedAt:day+' 14:59',quoteSource:'盘口'})});unknown(f,'57:1');
});

test('自述动机、已有持仓、冻结止损分别有独立证据，不以盈亏或价格触达推断执行',async()=>{
  const hold={code,shares:100,avgCost:8,source:'历史持仓快照',observedAt:day+' 14:59',knownAt:day+' 15:00'};
  const plan={code,stopPrice:11,entryPrice:12,strategy:'连板接力战法',frozenAt:day+'T01:00:00Z'};
  const traderRecord={code,source:'本人交易日志',decisionId:'note-1',decisionAt:day+' 10:00',recordedAt:day+' 10:05',motive:'赌回流'};
  let f=await scan({b:bar(day,{holdingSnapshot:hold,frozenPlan:plan,traderRecord}),sector:{change:-3},stage:'退潮'});
  yes(f,'52:0','64:0','64:2','67:0','70:1');unknown(f,'55:2','55:3');
  f=await scan({b:bar(day,{traderRecord:{...traderRecord,recordedAt:day+' 17:00'},frozenPlan:plan}),stage:'退潮'});
  unknown(f,'70:1','64:0','52:0');
  f=await scan({b:bar(day,{holdingSnapshot:hold,frozenPlan:{...plan,frozenAt:day+'T08:00:00Z'}}),stage:'退潮'});
  unknown(f,'52:0','67:0');
});

test('连续剧烈跳水缺少连续成交分钟时保持未知；利空叠加按独立事实计数',async()=>{
  const rows=[10,9.6,9.9,9.5].map((close,i)=>({...bar(day+' 10:0'+i,{close}),period:'1分钟'}));
  let f=await scan({intraday:rows});yes(f,'60:1');
  f=await scan({intraday:rows.slice(0,2).concat({...rows[2],date:day+' 11:30'}, {...rows[3],date:day+' 13:00'})});unknown(f,'60:1');
  const yesFact={pass:true,source:'已归档披露'};
  f=await scan({},[['49:2',yesFact],['56:2',yesFact]]);unknown(f,'61:0');
  f=await scan({},[['49:2',yesFact],['56:0',yesFact]]);yes(f,'61:0');
});
test('CSV经真实自动识别接口触发停牌硬风控，即使竞价战法已全部命中也保持零仓位',async()=>{
  const {readFileSync}=require('node:fs'),path=require('node:path');
  const catalog=JSON.parse(readFileSync(path.resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
  const {backtestAction}=await import('../public/nova/shortline/backtest.mjs');
  const {autoValidate}=await import('../public/nova/shortline/market.mjs');
  const market=[[30,22,39,3,-1,35],[40,16,32,4,.5,45],[55,10,26,5,2,58]].map((a,i)=>({
    date:date(18+i),upLimit:a[0],downLimit:a[1],breakRate:a[2],height:a[3],leader:a[4],diffusion:a[5],
    trend:'多头',sh:'多头',cy:'多头'}));
  const s={catalog,bars:[],market,trades:[]};
  const csv='code,date,open,high,low,close,volume,auctionGap,auctionRatio,auctionAmount,sectorAuctionUpPct,auctionNetBuy,tradingStatus\n'+
    [code,day,10,10.2,9.9,10.1,30000,2,2,3e7,80,1e6,'停牌'].join(',');
  backtestAction(s,'k:import',{csv});
  const r=autoValidate(s,{code,date:day});
  assert.ok(r.matches.includes('竞价模式战法'));assert.ok(r.selected.includes('57:1'));assert.equal(r.position,0);
  assert.ok(r.recognition.evidence.some(x=>x.includes('停牌')));
});
