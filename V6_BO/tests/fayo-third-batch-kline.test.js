'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessDailyBarFinality}=require('../src/core/a-share-calendar');
const continuity=require('../src/core/kline-source-continuity');
const adapters=[require('../src/strategy/cached-kline-adapter').adaptCachedKline,require('../src/strategy/research-v2-cached-kline-adapter').adaptCachedKline];
const at=s=>Date.parse(s+'+08:00'),mid=at('2026-11-25T14:00:00'),after=at('2026-11-25T15:20:00'),tomorrow=at('2026-11-26T09:00:00');
const row=date=>({date,open:10,high:11,low:9,close:10,volume:100});
const rows=Array.from({length:30},(_,i)=>row(new Date(Date.UTC(2026,9,27+i)).toISOString().slice(0,10)));
test('an original intraday daily bar is not finalized by midnight or later cache rewrites',()=>{
 assert.equal(assessDailyBarFinality('2026-11-25',{observedAt:mid,now:tomorrow}).usable,false);
 for(const adapt of adapters){
  assert.equal(adapt('000001',{rows,receivedAt:mid,adjust:'qfq'},{cachedAt:after,now:after}).stock,null);
  assert.equal(adapt('000001',{rows,receivedAt:mid,adjust:'qfq'},{cachedAt:tomorrow,now:tomorrow}).stock,null);
  const good=adapt('000001',{rows,receivedAt:after,adjust:'qfq'},{cachedAt:tomorrow,now:tomorrow});
  assert.equal(good.error,null);assert.equal(good.stock.feed.timestamp,after);
 }
});
test('explicitly incompatible adjustment, aliases and minute intervals cannot enter daily research',()=>{
 for(const adapt of adapters)for(const meta of [{adjust:'unadjusted'},{adjust:'qfq',adjustment:'hfq'},{frequency:'5m'},{period:'1m'}]){
  assert.equal(adapt('000001',{rows,receivedAt:after,...meta},{cachedAt:after,now:after}).stock,null);
 }
});
test('daily provider rows reject duplicates, descending dates, minute labels and future dates',()=>{
 const a=row('2026-11-24'),b=row('2026-11-25');
 assert.equal(continuity.dailyProviderRowsValid([a,b],after),true);
 for(const bad of [[a,a],[b,a],[row('2026-11-25 09:31')],[row('2026-11-26')],[{...a,high:1}],[{...a,volume:-1}]]){
  assert.equal(continuity.dailyProviderRowsValid(bad,after),false);
 }
});
test('missing exchange sessions remain explicit without fabricated bars',()=>{
 const a=row('2026-11-23'),b=row('2026-11-25');
 const result=continuity.auditKlineSourceContinuity({primaryBars:[a,b],fallbackBars:[],expectedDates:['2026-11-23','2026-11-24','2026-11-25']});
 assert.equal(result.complete,false);assert.deepEqual(result.gaps,['2026-11-24']);assert.equal(result.bars.length,2);
});
test('Tencent raw day response cannot impersonate adjusted stock history',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../em.js'),'utf8');
 const start=source.indexOf('async function fetchKlineTx('),end=source.indexOf('\n}\n',start)+2;
 const fn=new Function('txMarket','txRaw','txJSON','require',source.slice(start,end)+';return fetchKlineTx;');
 const daily=[['2026-11-25','10','10','11','9','100']];
 const make=payload=>fn(()=> 'sz',()=> '000001',async()=>({data:{sz000001:payload}}),()=>continuity);
 assert.equal(await make({day:daily})('000001'),null);
 const adjusted=await make({qfqday:daily})('000001');assert.equal(adjusted.adjust,'qfq');
 const index=await make({day:daily})('0.000001');assert.equal(index.adjust,'unadjusted');
 assert.equal(await make({qfqday:[...daily,...daily]})('000001'),null);
});
