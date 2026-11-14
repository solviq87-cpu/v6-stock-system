'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildTradeEvents,validateEvents}=require('../src/core/paper-authority-events');
const t={t:123,side:'买入',code:'600000',shares:100,price:10,amount:1000,fee:5,basis:1005};
test('single-file trade events emitted once and survive replay',()=>{
 const a={pool:{trades:[]},pre:{trades:[]}};
 const b={pool:{trades:[t]},pre:{trades:[]}};
 const events=buildTradeEvents(a,b);
 assert.equal(events.length,1);assert.equal(events[0].account,'pool');
 assert.deepEqual(buildTradeEvents(b,b,JSON.parse(JSON.stringify(events))),events);
 assert.equal(validateEvents(events),true);
});
test('multiple account trades recorded without inventing balances',()=>{
 const a={pool:{trades:[]},pre:{trades:[]}};
 const b={pool:{trades:[t]},pre:{trades:[{...t,code:'000001'}]}};
 assert.equal(buildTradeEvents(a,b).length,2);
 assert.equal(a.pool.trades.length,0);
});
test('tampered or duplicate events fail closed',()=>{
 const e=buildTradeEvents({pool:{trades:[]},pre:{trades:[]}},{pool:{trades:[t]},pre:{trades:[]}});
 assert.throws(()=>validateEvents([...e,...e]));
 assert.throws(()=>validateEvents([{...e[0],trade:{...t,amount:999}}]));
});
