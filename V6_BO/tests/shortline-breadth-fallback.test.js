'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createBreadthFallback}=require('../src/research/shortline-breadth-fallback');

const day='2026-11-20',now=Date.parse('2026-11-22T16:20:00+08:00'),quoteAt=Date.parse(day+'T15:10:00+08:00');
const req={day,latestClosedDay:day};
const no=async()=>null;
function reader({r={},clock=()=>now,...opts}={}){
  const calls=[];
  const read=createBreadthFallback({clock,fetchSnapshot:no,fetchIndex:no,fetchBatchQuotes:no,...opts,
    request:async u=>{
      const url=new URL(u);calls.push(url);
      const v=r[url.hostname];if(v===undefined)throw Error('未提供该站点');
      const raw=typeof v==='function'?v(url):v;
      return {raw:Buffer.isBuffer(raw)?raw:Buffer.from(typeof raw==='string'?raw:JSON.stringify(raw)),status:200,headers:{}};
    }});
  return {read,calls};
}
function legu(date=day,time='15:00:00',up=297,down=4897,flat=22){
  return '<span class="market-activity-time">'+date+' '+time+'</span>'+
    '<meta name="description" content="'+date+'，A股赚钱效益分布，其中30家涨停，68家跌停，'+up+'家上涨，'+down+'家下跌，详情">'+
    '<table><tr><td>上涨</td><td>'+up+'</td><td>下跌</td><td>'+down+'</td><td>平盘</td><td>'+flat+'</td></tr></table>即沪深两市上涨个股所占比例';
}
const index=(code,amount,extra={})=>({code,tradeDate:day,receivedAt:now,quoteAt,turnoverAmountYuan:amount,...extra});
const native=(code,pct,extra={})=>({code,pct,amount:300,price:7,tradeDate:day,quoteSource:'tencent',quoteAt,receivedAt:now,...extra});
function snapshot(size=3001){
  const stocks=Array.from({length:size},(_,i)=>{
    const code=i===0?'920000':i===1?'000001':String([600000,601000,603000][Math.floor((i-2)/1000)]+(i-2)%1000);
    return {code,latestPrice:7,pctChange:i%2?-1:1,vendorQuoteAt:quoteAt,amount:10};
  });
  return {source:'eastmoney-clist-unverified-live',scope:'沪深京 A 股报价列表',retrievedAt:new Date(now).toISOString(),universeSize:size,stocks};
}
function sinaLine(key,gbkName,amount,stamp=day+' 15:40:00'){
  const fs=Array(33).fill('0');fs[2]='10';fs[3]='11';fs[9]=String(amount);[fs[30],fs[31]]=stamp.split(' ');
  return Buffer.concat([Buffer.from('var hq_str_'+key+'="'),gbkName,Buffer.from(','+fs.slice(1).join(',')+'";\n')]);
}
const shName=Buffer.from('c9cfd6a4d6b8cafd','hex'),szName=Buffer.from('c9eed6a4b3c9d6b8','hex');

test('independent dated Shanghai/Shenzhen width and unrounded turnover preserve source and actual known time',async()=>{
  const {read,calls}=reader({r:{'www.legulegu.com':legu()},fetchIndex:async()=>[index('1.000001',70e9),index('0.399001',91e9)]});
  const [a,b]=await Promise.all([read(req),read(req)]);
  assert.deepEqual(a.market,{amount:1610});assert.deepEqual(b,a);
  assert.equal(a.coverage[0].total,5216);assert.equal(a.coverage[0].adv,297);
  assert.equal(a.coverage[0].flat,22);assert.equal(a.coverage[0].knownAt,now);
  assert.match(a.coverage[0].scope,/沪深两市/);assert.equal(a.coverage[0].quoteAt,Date.parse(day+'T15:00:00+08:00'));
  assert.equal(calls.filter(u=>u.hostname==='www.legulegu.com').length,1);
});
test('width parser rejects wrong day, intraday, conflicting provider totals and scope changes',async()=>{
  for(const raw of [legu('2026-11-19'),legu(day,'14:59:59'),legu().replace('297家上涨','298家上涨'),
    legu().replace('即沪深两市上涨个股所占比例','股票'),legu(day,'15:00:00',3,5,2)]){
    const r=await reader({r:{'www.legulegu.com':raw}}).read({...req,needAmount:false});
    assert.deepEqual(r.coverage,[]);assert.deepEqual(r.market,{});
  }
});
test('all-A publication needs every reported instrument, all three exchanges, correct receipt and actual close dates',async()=>{
  const read=async s=>(await reader({fetchSnapshot:async()=>s}).read({...req,needAmount:false}));
  const s=snapshot(),valid=await read(s);
  assert.equal(valid.market.adv,1501);assert.equal(valid.market.dec,1500);assert.equal(valid.fieldSources.adv.knownAt,now);
  const cold=structuredClone(s);cold.stocks[13].vendorQuoteAt-=86400000;
  assert.deepEqual((await read(cold)).market,{});assert.equal((await read(cold)).coverage[0].observed,3000);
  for(const edit of [t=>t.stocks.pop(),t=>t.stocks[111].code=t.stocks[110].code,t=>t.stocks[2].vendorQuoteAt=now+1,
    t=>t.stocks[0].code='002001',t=>t.scope='沪深',t=>t.retrievedAt=new Date(now+1).toISOString()]){
    const copy=structuredClone(s);edit(copy);assert.deepEqual((await read(copy)).market,{});
  }
});
test('mixed dated, future and undated native rows yield only their verified provider cohort',async()=>{
  const rows=[native('600000',1),native('600001',-1,{tradeDate:'2026-11-19'}),
    native('000001',0,{quoteAt:null}),native('300000',1,{quoteAt:now+1}),native('920001',-1,{quoteSource:'sina'})];
  const r=await reader().read({...req,state:{stocks:rows,breadth:{[day]:{n:5000,up:3000,down:2000,day,at:now}}},needAmount:false});
  assert.deepEqual(r.market,{});assert.equal(r.coverage.length,2);
  assert.equal(r.coverage[0].observed,1);assert.equal(r.coverage[0].total,5);assert.equal(r.coverage[1].dec,1);
});
test('Sina dated full index lines supply independent turnover with fractional yuan',async()=>{
  const sina=Buffer.concat([sinaLine('sh000001',shName,702573853116),sinaLine('sz399001',szName,719626569821.594)]);
  const partial=[index('1.000001',8e9),index('0.399001',7e9,{receivedAt:quoteAt-1})];
  const r=await reader({fetchIndex:async()=>partial,r:{'hq.sinajs.cn':sina}}).read({...req,needBreadth:false});
  assert.equal(r.market.amount,(702573853116+719626569821.594)/1e8);assert.match(r.fieldSources.amount.source,/新浪/);
  for(const invalid of [sinaLine('sz399001',szName,5,'2026-11-19 15:10:00'),sinaLine('sz399001',shName,40)]){
    const off=await reader({fetchIndex:async()=>partial,r:{'hq.sinajs.cn':invalid}}).read({...req,needBreadth:false});
    assert.deepEqual(off.market,{});assert.equal(off.coverage[0].scope,'沪市成交额');
  }
});
test('historical exchange source validates product and trade date, never promotes one product to all exchanges',async()=>{
  const product={PRODUCT_CODE:'01',TRADE_DATE:'20261120',TRADE_AMT:'4845.85'};
  for(const [obj,expected] of [[product,4845.85e8],[{...product,TRADE_DATE:'20261119'},undefined],[{...product,PRODUCT_CODE:'00'},undefined]]){
    const {read,calls}=reader({r:{'query.sse.com.cn':{result:[obj]}}});
    const x=await read({day,latestClosedDay:'2026-11-23',needBreadth:false});
    assert.deepEqual(x.market,{});assert.equal(x.coverage[0]?.amountCny,expected);
    assert.deepEqual(calls.map(v=>v.host),['query.sse.com.cn']);
  }
});
test('sector index must have identical exchange, BK id, name, date, and valid raw OHLCV',async()=>{
  const name='半导体',code='BK1036',data={market:90,code,name,klines:[day+',301,311,315,292,5200,8500000,1,3.2']};
  for(const [d,good] of [[data,true],[{...data,name:'其他板块'},false],[{...data,market:1},false],[{...data,klines:[day+',301,311,299,292,1,3']},false]]){
    const result=await reader({fetchSectorBars:async()=>({rc:0,data:d})}).read({...req,sectorName:name,sectorCode:code,needBreadth:false,needAmount:false});
    assert.equal(result.sector?.volumeLots,good?5200:undefined);assert.equal(result.sector?.change,good?3.2:undefined);
  }
});
test('dated member evidence and raw dated quotes supply sector sample without approximating its index',async()=>{
  const g={day,knownAt:now,source:'当日涨停池',name:'半导体',members:['600000','000001']},fetchBatchQuotes=async()=>[native('600000',5),native('000001',-1)];
  const opts={...req,sectorMembers:g,needAmount:false,needBreadth:false};
  const x=await reader({fetchBatchQuotes}).read(opts);assert.equal(x.sector,null);
  assert.equal(x.coverage[0].adv,1);assert.equal(x.coverage[0].meanChange,2);assert.equal(x.coverage[0].amountCny,600);
  for(const override of [{day:'2026-11-19'},{knownAt:now+1}, {source:''}]){
    const off=await reader({fetchBatchQuotes}).read({...opts,sectorMembers:{...g,...override}});assert.deepEqual(off.coverage,[]);
  }
  // Undated tags in the native review list are excluded even when the pool header is dated.
  const state={ztReviewPoolMeta:{sources:[{source:'cls',providerComplete:true,status:'available',tradeDate:day,receivedAt:now}]},
    ztReviewPool:[{sources:['cls'],tradeDate:day,clsObservation:{tradeDate:day,receivedAt:now},plates:[{name:g.name}],code:'600000'},
      {sources:['cls'],tradeDate:day,clsObservation:{tradeDate:'2026-11-19',receivedAt:now},plates:[{name:g.name}],code:'000001'}]};
  const nativeGroup=await reader({fetchBatchQuotes}).read({...opts,sectorMembers:null,state});
  assert.equal(nativeGroup.coverage[0].total,1);assert.equal(nativeGroup.coverage[0].observed,1);
});
test('before settled close and invalid dates no sources are queried',async()=>{
  const {read,calls}=reader({clock:()=>Date.parse(day+'T14:59:59+08:00')});
  for(const date of [day,'2026-11-31','2026-11-22']){
    const q=await read({...req,day:date});assert.deepEqual(q.market,{});assert.equal(q.knownAt,null);
  }
  assert.equal(calls.length,0);
});
test('cold market recovery reuses CLS original pool validator and verifies hot-sector member prices independently',async()=>{
  const item=(code,name,plates)=>({secu_code:code,secu_name:name,num_stocks:2,time:day+' 14:56:03',
    plate:plates.map(n=>({secu_code:n==='同题材'?'state-sector':'state-other',secu_name:n}))});
  const cls={code:200,data:[item('sh600000','浦发银行',['同题材','其他']),item('sz000001','平安银行',['同题材'])]};
  const fetchBatchQuotes=async()=>[native('600000',5),native('000001',2)],opts={...req,needAmount:false,needBreadth:false};
  const good=await reader({fetchBatchQuotes,r:{'x-quote.cls.cn':cls}}).read(opts);
  assert.equal(good.sector,null);assert.match(good.coverage[0].scope,/同题材/);assert.match(good.coverage[0].source,/财联社.*腾讯/);
  assert.equal(good.coverage[0].meanChange,3.5);assert.equal(good.coverage[0].observed,2);
  cls.data[1].time='2026-11-19 15:00:00';
  const mixed=await reader({fetchBatchQuotes,r:{'x-quote.cls.cn':cls}}).read(opts);
  assert.deepEqual(mixed.coverage,[]);
});
test('native CLS sector data binds the dated plate code to the exact unadjusted board and keeps independent BK taxonomies separate',async()=>{
  const g={day,knownAt:now,source:'财联社同日涨停池题材成员',code:'cls82261',name:'电子',members:['600000']};
  const data={secu_code:g.code,date:20261120,close_px:1527.2,open_px:1578.12,high_px:1604.02,low_px:1527.2,
    preclose_px:1620.41,business_amount:11722175578,business_balance:353230307591};
  const {read,calls}=reader({r:{'x-quote.cls.cn':{code:200,data:[data]}},fetchSectorBars:no});
  const o={...req,needAmount:false,needBreadth:false,sectorName:g.name,sectorMembers:g};
  const r=await read(o);
  assert.equal(r.sector.code,g.code);assert.equal(r.sector.close,1527.2);assert.equal(r.sector.volumeShares,11722175578);
  assert.equal(r.sector.amountCny,353230307591);assert.equal(r.sector.priceBasis,'unadjusted');
  const bk=await read({...o,sectorCode:'BK1036'});
  assert.equal(bk.sector,null);assert.match(bk.coverage[0].scope,/cls82261/);
  assert.equal(calls.at(0).searchParams.get('type'),'d1');assert.equal(calls.at(0).searchParams.get('secu_code'),g.code);
  const wrong=await reader({r:{'x-quote.cls.cn':{code:200,data:[{...data,secu_code:'cls80364'}]}}}).read(o);
  assert.equal(wrong.sector,null);
});
