'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {barsToIndicators}=require('../src/strategy/historical-indicators');
const {validateFeed}=require('../src/strategy/feed-quality');
const now=Date.parse('2026-11-05T08:00:00Z');
const bars=Array.from({length:30},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,open:10,high:11,low:9,close:10,volume:100}));
const stock={feed:{source:'imported',timestamp:now},bars,close:10};
test('indicators reject missing or null volume rather than manufacturing zero',()=>{
 for(const value of [undefined,null,'',false,'   ']){
  const modified=bars.map(x=>({...x}));
  if(value===undefined)delete modified[0].volume;else modified[0].volume=value;
  assert.equal(barsToIndicators(modified).valid,false,String(value));
 }
});
test('indicators reject null rows without throwing',()=>{
 assert.equal(barsToIndicators([null,...bars]).valid,false);
});
test('feed quality fails closed on invalid freshness parameters',()=>{
 for(const opts of [{now:NaN},{now:Infinity},{maxAgeMs:NaN},{maxAgeMs:-1},{maxAgeMs:Infinity}])
  assert.equal(validateFeed(stock,{now,...opts}).usable,false,JSON.stringify(opts));
});
test('feed quality rejects invalid snapshot close instead of silently accepting',()=>{
 for(const close of [null,'',false,NaN,Infinity,-1])
  assert.equal(validateFeed({...stock,close},{now}).usable,false,String(close));
});
test('feed quality handles absent stock and invalid timestamp safely',()=>{
 assert.equal(validateFeed(null,{now}).usable,false);
 assert.equal(validateFeed({...stock,feed:{source:'imported',timestamp:Infinity}},{now}).usable,false);
});

const live={...stock,feed:{source:'eastmoney',timestamp:now}};
test('strict real feed cannot hide negative provenance behind a positive provider',()=>{
 for(const item of [
  {...live,simulated:true},{...live,feed:{...live.feed,mode:'simulation'}},
  {...live,mode:'public-live',quoteMode:'fixture'},{...live,feed:{...live.feed,imported:true}},
  {...live,feed:{...live.feed,source:'eastmoney',dataMode:'backtest'}},
  {...live,readOnlyBackup:true}
 ]){
  const result=validateFeed(item,{now,requireReal:true});
  assert.equal(result.usable,false);
  assert.equal(result.fresh,false);
 }
 const simulated=validateFeed({...live,simulated:true},{now});
 assert.equal(simulated.simulated,true);
 assert.equal(simulated.usable,true);
});
test('strict real feed rejects future bars relative to either clock',()=>{
 const dated=(end)=>bars.map((b,i)=>({...b,date:new Date(Date.parse(end+'T00:00:00Z')-(bars.length-1-i)*86400000).toISOString().slice(0,10)}));
 for(const [last,t] of [['2026-11-06',now],['2026-11-05',now-86400000]]){
  const q=validateFeed({...live,bars:dated(last),feed:{...live.feed,timestamp:t}},{now,requireReal:true,maxAgeMs:172800000});
  assert.equal(q.usable,false);
  assert.equal(q.fresh,false);
 }
 assert.equal(validateFeed({...live,bars:dated('2026-11-05')},{now,requireReal:true}).usable,true);
});
test('strict real feed cannot turn undated history into dated evidence',()=>{
 const undated=bars.map(({date,...bar})=>bar);
 assert.equal(validateFeed({...live,bars:undated},{now,requireReal:true}).usable,false);
 assert.equal(validateFeed({...stock,bars:undated},{now}).usable,true);
});
test('freshness never reports success for an invalid or future timestamp',()=>{
 for(const timestamp of [undefined,NaN,Infinity,-1,now+.5,now+1]){
  const q=validateFeed({...live,feed:{...live.feed,timestamp}},{now,requireReal:true});
  assert.equal(q.fresh,false);
  assert.equal(q.usable,false);
 }
 assert.equal(validateFeed({...live,feed:{...live.feed,timestamp:now+1}},{now}).fresh,false);
 assert.equal(validateFeed(live,{now:NaN}).fresh,false);
});
test('fresh feed clock exposes separate last bar date and age',()=>{
 const q=validateFeed(live,{now,requireReal:true});
 assert.equal(q.usable,true);
 assert.equal(q.fresh,true);
 assert.equal(q.barDate,'2026-09-30');
 assert.equal(q.barAgeDays,36);
 assert.equal(q.freshnessBasis,'feed-timestamp-only');
});
test('real-feed date comparison uses China calendar day',()=>{
 const clock=Date.parse('2026-11-04T16:00:00Z');
 const dated=bars.map((b,i)=>({...b,date:new Date(Date.parse('2026-11-05T00:00:00Z')-(bars.length-1-i)*86400000).toISOString().slice(0,10)}));
 const input={...live,bars:dated,feed:{...live.feed,timestamp:clock}};
 assert.equal(validateFeed(input,{now:clock,requireReal:true}).usable,true);
 assert.equal(validateFeed({...input,feed:{...input.feed,timestamp:clock-1}},{now:clock,requireReal:true}).usable,false);
});
test('freshness keeps exact age boundary and legacy historical modes',()=>{
 assert.equal(validateFeed(live,{now:now+900000,requireReal:true}).fresh,true);
 assert.equal(validateFeed(live,{now:now+900001,requireReal:true}).fresh,false);
 assert.equal(validateFeed(stock,{now}).usable,true);
 assert.equal(validateFeed(stock,{now,requireReal:true}).usable,false);
});
