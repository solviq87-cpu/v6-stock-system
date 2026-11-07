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
