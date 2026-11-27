'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditKlineSourceContinuity,dailyKlineMetadataValid,dailyProviderRowsValid}=require('../src/core/kline-source-continuity');
const adapters=[require('../src/strategy/cached-kline-adapter').adaptCachedKline,require('../src/strategy/research-v2-cached-kline-adapter').adaptCachedKline];
const row=date=>({date,open:10,high:11,low:9,close:10,volume:100});
const dates=Array.from({length:30},(_,i)=>new Date(Date.UTC(2026,9,27+i)).toISOString().slice(0,10));
const last=dates.at(-1),at=(day,clock)=>Date.parse(day+'T'+clock+'+08:00');
const after=at(last,'15:20:00'),mid=at(last,'14:00:00'),later=at('2026-11-26','09:00:00');
function rows(){return dates.map(row)}
function run(primaryBars,fallbackBars,options={}){
 return auditKlineSourceContinuity({primaryBars,fallbackBars,expectedDates:dates,...options});
}
test('row-level period and price basis cannot hide behind a valid daily snapshot',()=>{
 for(const patch of [{frequency:'5m'},{period:'1m'},{priceBasis:'unadjusted'},
  {adjust:'qfq',adjustment:'hfq'},{priceAdjustment:{mode:'hfq'}},{priceAdjustment:{}}, {priceBasis:[]} ]){
  const r=rows();Object.assign(r[5],patch);
  assert.equal(dailyKlineMetadataValid({adjust:'qfq',rows:r},{expectedBasis:'qfq'}),false);
  for(const adapt of adapters)
   assert.equal(adapt('600000',{adjust:'qfq',rows:r,receivedAt:after},{cachedAt:after,now:after}).stock,null);
 }
});
test('provider row validation rejects explicit mixed price bases and non-daily periods',()=>{
 const a=row(dates[0]),b=row(dates[1]);
 assert.equal(dailyProviderRowsValid([{...a,adjust:'qfq'},{...b,adjust:'hfq'}],after),false);
 assert.equal(dailyProviderRowsValid([a,{...b,frequency:'5m'}],after),false);
 assert.equal(dailyProviderRowsValid([{...a,adjust:'qfq'},{...b,priceAdjustment:{mode:'qfq'},period:'daily'}],after),true);
});
test('main and backup cannot silently mix incompatible price bases even without overlapping dates',()=>{
 const a={...row(dates[0]),adjust:'qfq'},b={...row(dates[1]),priceBasis:'unadjusted'};
 assert.throws(()=>run([a],[b]),/复权/);
 assert.throws(()=>run([a],[{...row(dates[0]),priceBasis:'hfq'}]),/复权/);
 assert.throws(()=>run([a,{...row(dates[1]),frequency:'5m'}],[]),/周期/);
});
test('overlapping bars cannot launder conflicting explicit trading states or zero activity',()=>{
 for(const flag of ['suspended','isST','tradable']){
  const a={...row(dates[0]),volume:flag==='suspended'?0:100,[flag]:true};
  const b={...a,[flag]:false};
  assert.throws(()=>run([a],[b]),/风险状态冲突/);
 }
 assert.throws(()=>run([row(dates[0])],[{...row(dates[0]),volume:0}]),/零成交/);
 assert.throws(()=>run([{...row(dates[0]),suspended:true}],[]),/停牌/);
 assert.throws(()=>run([{...row(dates[0]),tradable:'false'}],[]),/风险状态无效/);
});
test('identical source labels cannot masquerade as a main-backup switch',()=>{
 assert.throws(()=>run([row(dates[0])],[row(dates[1])],{primaryName:'same',fallbackName:'same'}),/标识重复/);
});
test('legacy unknown and partially declared price bases are disclosed, not certified',()=>{
 const a={...row(dates[0]),adjust:'qfq'},b=row(dates[1]);
 const partial=run([a],[b]);assert.equal(partial.priceBasisEvidence.status,'partial');
 assert.equal(partial.priceBasisEvidence.declaredBasis,'qfq');assert.equal(partial.priceBasisEvidence.verified,false);
 const unknown=run([row(dates[0])],[b]);assert.equal(unknown.priceBasisEvidence.status,'unknown');
 const consistent=run([a],[{...b,priceAdjustment:{mode:'qfq'}}]);
 assert.equal(consistent.priceBasisEvidence.status,'declared-consistent');assert.equal(consistent.canTrade,false);
});
test('explicit unfinished bars remain rejected after a later cache refresh',()=>{
 for(const adapt of adapters)for(const patch of [{complete:false},{finalized:false},{complete:'true'},{observedAt:mid},{receivedAt:mid}]){
  const r=rows();Object.assign(r.at(-1),patch);
  assert.equal(adapt('600000',{adjust:'qfq',rows:r,receivedAt:after},{cachedAt:later,now:later}).stock,null);
 }
 for(const adapt of adapters){
  assert.equal(adapt('600000',{adjust:'qfq',rows:rows(),receivedAt:after,observedAt:mid},{cachedAt:later,now:later}).stock,null);
  assert.equal(adapt('600000',{adjust:'qfq',rows:rows(),receivedAt:after,finalized:false},{cachedAt:later,now:later}).stock,null);
 }
});
test('nested observation times cannot predate the bar date or exceed its enclosing observation',()=>{
 for(const adapt of adapters)for(const stamp of [at(dates[3],'16:00:00'),after+1,NaN,after+.5]){
  const r=rows();r[4].observedAt=stamp;
  assert.equal(adapt('600000',{adjust:'qfq',rows:r,receivedAt:after},{cachedAt:after,now:later}).stock,null);
 }
});
test('valid original observations and absent legacy metadata retain research compatibility',()=>{
 for(const adapt of adapters){
  const legacy=adapt('600000',{rows:rows(),receivedAt:after},{cachedAt:later,now:later});
  assert.equal(legacy.error,null);assert.equal(legacy.stock.feed.timestamp,after);
  const r=rows();Object.assign(r.at(-1),{observedAt:after,receivedAt:after,complete:true,finalized:true,priceBasis:'qfq',frequency:'1d'});
  const good=adapt('600000',{adjust:'qfq',priceAdjustment:{mode:'qfq'},rows:r,receivedAt:after},{cachedAt:later,now:later});
  assert.equal(good.error,null);assert.equal(good.stock.feed.timestamp,after);assert.equal(good.stock.dataAudit.verifiedLive,false);
 }
});
