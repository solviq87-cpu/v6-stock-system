'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {normalizeBaoStockBundle}=require('../src/core/baostock-eod-research-bridge');
const {runOnce:publishOnce,parse}=require('../scripts/baostock-eod-research');
const {adaptAuthorizedHistory}=require('../src/core/factor-authorized-market-bridge');
const at=(d,t='16:05:00')=>Date.parse(d+'T'+t+'+08:00');
function weekdays(){
 const dates=[];
 for(let day=Date.parse('2026-09-01T00:00:00Z');day<=Date.parse('2026-11-09T00:00:00Z');day+=86400000){
  const d=new Date(day);
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6)dates.push(d.toISOString().slice(0,10));
 }
 return dates;
}
const days=weekdays(),end=days.at(-1),now=at(end,'16:06:00');
const codes=['sh.600001','sh.600002','sh.600003','sz.000001','sz.000002'];
function bundle(){
 const dates=[...days],start=dates[0];
 return {schemaVersion:1,mode:'baostock-eod-research-export-v1',
  source:'baostock',completed:true,datasetId:'baostock-private-research-v1',
  asOf:end,observedAt:at(end),claimedProviderCertified:false,canTrade:false,
  calendar:{source:'baostock:query_trade_dates',errorCode:'0',complete:true,
   startDate:start,endDate:end,observedAt:at(end,'16:00:00'),tradeDates:dates},
  stocks:codes.map((code,j)=>({
   code,kline:{source:'baostock:query_history_k_data_plus',
    errorCode:'0',complete:true,frequency:'d',adjustflag:'3',
    startDate:start,endDate:end,observedAt:at(end,'16:02:00'),
    rows:dates.map((date,i)=>{
     const halt=j===1&&i===5;
     const close=(10+j/10+i/100).toFixed(2);
     return {date,code,open:close,high:halt?close:(Number(close)+.03).toFixed(2),
      low:halt?close:(Number(close)-.03).toFixed(2),close,
      volume:halt?'0':'100',amount:halt?'0':'1000',
      adjustflag:'3',tradestatus:halt?'0':'1'};
    })},
   adjust:{source:'baostock:query_adjust_factor',errorCode:'0',complete:true,
    startDate:start,endDate:end,observedAt:at(end,'16:03:00'),
    rows:j===0?[{code,dividOperateDate:dates[10]}]:[]}
  }))};
}
function tmp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-baostock-eod-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
test('BaoStock native unadjusted, halts, corporate-action dates and exchange calendar are preserved',()=>{
 const b=bundle(),result=normalizeBaoStockBundle(b,{now});
 assert.equal(result.status,'local-research-adapted-not-certified');
 assert.equal(result.history.source,'imported');
 assert.equal(result.history.provider,'baostock');
 assert.equal(result.history.priceBasis,'unadjusted');
 assert.deepEqual(result.history.priceAdjustment,{mode:'unadjusted',provider:'baostock-adjustflag-3'});
 assert.equal(result.history.upstream,'baostock');
 assert.equal(result.history.volumeUnit,'shares');
 assert.equal(result.history.amountUnit,'CNY');
 assert.equal(result.history.amountBasis,'actual-unadjusted-turnover');
 assert.equal(result.history.observedAt,b.observedAt);
 assert.equal(result.history.stocks.length,codes.length);
 assert.equal(result.history.stocks[0].corporateActions[0],days[10]);
 assert.equal(result.history.stocks[1].bars[5].suspended,true);
 assert.equal(result.history.stocks[1].bars[5].volume,0);
 assert.equal(result.market.calendar.length,days.length);
 assert.equal(result.market.stocks[0].bars.length,days.length);
 assert.equal(result.market.externalSnapshotFingerprint.length,64);
 assert.equal(result.commercialLicenseVerified,false);
 assert.equal(result.canTrade,false);
 assert.deepEqual(adaptAuthorizedHistory(result.history,{now}),result.market);
});
test('missing actual original timestamps, unadjusted flags or confirmed calendar never enter research',()=>{
 const mutations=[
  x=>delete x.observedAt,
  x=>x.observedAt=at(end,'15:59:00'),
  x=>x.observedAt=now+1000,
  x=>x.asOf=days.at(-2),
  x=>delete x.calendar,
  x=>x.calendar.source='guessed-weekdays',
  x=>x.calendar.complete=false,
  x=>x.calendar.tradeDates.splice(5,1),
  x=>x.calendar.tradeDates[5]=x.calendar.tradeDates[4],
  x=>x.stocks[0].kline.adjustflag='2',
  x=>x.stocks[0].kline.frequency='w',
  x=>x.stocks[0].kline.complete=false,
  x=>x.stocks[0].kline.rows[0].adjustflag='2',
  x=>x.stocks[0].kline.rows[3].date='2026-09-30',
  x=>x.stocks[0].kline.rows[3].code='sh.600099',
  x=>x.stocks[0].kline.rows[3].tradestatus='',
  x=>x.stocks[0].kline.rows[3].close='',
  x=>x.stocks[0].kline.rows[3].volume='NaN',
  x=>x.stocks[0].adjust.errorCode='-1',
  x=>x.stocks[0].adjust.complete=false,
  x=>x.stocks[0].adjust.rows[0].code='sz.000099',
  x=>x.stocks[0].adjust.rows[0].dividOperateDate='2027-02-01',
  x=>x.claimedProviderCertified=true
 ];
 for(const change of mutations){
  const b=bundle();change(b);
  assert.throws(()=>normalizeBaoStockBundle(b,{now}),
   undefined,'Invalid collection evidence must not be silently normalized');
 }
});
test('halts and active trading must agree with explicit BaoStock transaction amounts',()=>{
 const b=bundle();b.stocks[1].kline.rows[5].volume='100';
 assert.throws(()=>normalizeBaoStockBundle(b,{now}),/停牌/);
 const x=bundle();x.stocks[0].kline.rows[0].volume='0';
 assert.throws(()=>normalizeBaoStockBundle(x,{now}),/停牌/);
 const z=bundle();z.stocks[2].kline.rows[0].high='0.01';
 assert.throws(()=>normalizeBaoStockBundle(z,{now}),/OHLCV/);
});
test('empty adjustment query is accepted only if query complete and within date coverage',()=>{
 const b=bundle();
 b.stocks.forEach(x=>x.adjust.rows=[]);
 const r=normalizeBaoStockBundle(b,{now});
 assert.ok(r.history.stocks.every(x=>x.corporateActions.length===0));
 const uncertain=bundle();uncertain.stocks[0].adjust.complete=false;
 assert.throws(()=>normalizeBaoStockBundle(uncertain,{now}),/查询失败/);
 const early=bundle();early.stocks[0].adjust.endDate=days[12];
 assert.throws(()=>normalizeBaoStockBundle(early,{now}),/覆盖范围/);
});
test('private normalized history is immutable, idempotent and never stores upstream raw payload',t=>{
 const dir=tmp(t),src=path.join(dir,'native.json'),
  out=path.join(dir,'private','baostock-history.json');
 const b=bundle();b.privateRawToken='never-write-this';
 fs.writeFileSync(src,JSON.stringify(b));
 const first=publishOnce({file:src,out,now});
 assert.equal(first.status,'local-research-adapted-not-certified');
 assert.equal(first.stockCount,5);
 assert.equal(first.providerLicenseIndependentlyVerified,false);
 assert.equal(fs.statSync(out).mode&0o777,0o600);
 assert.ok(!fs.readFileSync(out,'utf8').includes('never-write-this'));
 assert.equal(publishOnce({file:src,out,now}).status,'unchanged');
 const changed=bundle();changed.stocks[0].kline.rows[0].close='10.01';
 fs.writeFileSync(src,JSON.stringify(changed));
 assert.throws(()=>publishOnce({file:src,out,now}));
 assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).stocks[0].bars[0].close,10);
 assert.throws(()=>parse([src,path.join(dir,'public','data.json')]),/公开/);
 const alias=path.join(dir,'private-alias');
 fs.symlinkSync(path.dirname(out),alias);
 assert.throws(()=>parse([src,path.join(alias,'test.json')]),/符号链接/);
});
test('BaoStock collector requires explicit operator opt-in before any network import',t=>{
 const python=spawnSync('python3',['--version'],{encoding:'utf8'});
 if(python.error||python.status!==0){t.skip('Python3 unavailable in local environment');return;}
 const dir=tmp(t),script=path.join(__dirname,'../scripts/collect-baostock-eod-research.py');
 const result=spawnSync('python3',[script,'--codes','600001',
  '--start','2026-09-01','--end','2026-11-09',
  '--output',path.join(dir,'private','native.json')],{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.ok(!fs.existsSync(path.join(dir,'private','native.json')));
 assert.match(result.stderr,/无研究包发布/);
});


test('BaoStock original collection-time chronology is bounded even though exchange time is unverified',()=>{
 const beforeCutoff=bundle();
 beforeCutoff.calendar.observedAt=at(end,'15:59:59');
 assert.throws(()=>normalizeBaoStockBundle(beforeCutoff,{now}),/时点/);
 const oldQuote=bundle();
 oldQuote.stocks[0].kline.observedAt=at(days.at(-2),'16:02:00');
 assert.throws(()=>normalizeBaoStockBundle(oldQuote,{now}),/查询顺序/);
 const overlong=bundle();
 overlong.observedAt=at(end,'16:12:00');
 assert.throws(()=>normalizeBaoStockBundle(overlong,{now:at(end,'16:12:00')}),/超限/);
 const sequential=bundle();
 sequential.startedAt=at(end,'16:00:00');
 sequential.stocks.forEach((s,i)=>{
  s.kline.observedAt=at(end,'16:0'+i+':10');
  s.adjust.observedAt=at(end,'16:0'+i+':20');
 });
 assert.equal(normalizeBaoStockBundle(sequential,{now}).history.provider,'baostock');
 // The second query must not move behind the previous stock's completed
 // adjustment query, even if all original fields contain valid numbers.
 sequential.stocks[1].kline.observedAt=at(end,'16:00:15');
 assert.throws(()=>normalizeBaoStockBundle(sequential,{now}),/查询顺序/);
});
