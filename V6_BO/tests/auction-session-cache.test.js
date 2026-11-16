'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),baseline=process.env.V6_BACKEND_POOL_BASELINE_REF;
const read=file=>baseline?execFileSync('git',['show',baseline+':V6_BO/'+file],{cwd:path.dirname(root),encoding:'utf8',maxBuffer:4*1024*1024}):fs.readFileSync(path.join(root,file),'utf8');
const server=read('server.js');
const now=Date.parse('2026-11-16T10:00:00+08:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function fn(source,name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);return source.slice(source.slice(start-6,start)==='async '?start-6:start,source.indexOf('\n}',start)+2);}
function auction(fetch,day='2026-11-16',state={}){
 const calls=[],c=vm.createContext({S:state,NP:{localDate:()=>day},Date:Clock,em:{fetchAuctionTicks:async(...args)=>{calls.push(args);return fetch(...args);}}});
 vm.runInContext(fn(server,'auctionTicksFor'),c);return {c,calls,scan:c.auctionTicksFor};
}
const ticks=date=>({tradeDate:date,preClose:10,bars:[{t:'09:25',price:10,quoteAt:Date.parse(date+'T09:25:00+08:00')}]});
test('auction cache never stamps Friday supplier data as Monday and retains old good evidence',async()=>{
 const state={auctionTicks:{'600000':{date:'2026-11-13',ok:true,data:ticks('2026-11-13'),failAt:0}}};
 const a=auction(()=>ticks('2026-11-13'),'2026-11-16',state);
 assert.equal(await a.scan('600000'),null);assert.equal(state.auctionTicks['600000'].data.tradeDate,'2026-11-13');assert.equal(state.auctionTicks['600000'].date,'2026-11-13');
 assert.equal(a.calls[0][1],'2026-11-16');assert.equal(await a.scan('600000'),null);assert.equal(a.calls.length,1);
 assert.equal((await a.scan('600000','2026-11-13')).tradeDate,'2026-11-13');
});
test('auction cache requires supplier date and supports explicit compact target dates',async()=>{
 const a=auction(()=>ticks('2026-11-13'),'2026-11-15');assert.equal((await a.scan('600000','20261113')).tradeDate,'2026-11-13');
 assert.equal(a.calls[0][1],'2026-11-13');
 const missing=auction(()=>({preClose:10,bars:[]}));assert.equal(await missing.scan('600000'),null);
 const invalid=auction(()=>ticks('2026-02-30'));assert.equal(await invalid.scan('600000','2026-02-30'),null);assert.equal(invalid.calls.length,0);
});
test('auction failure TTL preserves historical data and retries after fifteen minutes',async()=>{
 let instant=now,calls=0;class RetryClock extends Date{static now(){return instant;}}
 const state={auctionTicks:{'600000':{date:'2026-11-13',ok:true,data:ticks('2026-11-13'),failAt:0}}};
 const c=vm.createContext({S:state,NP:{localDate:()=> '2026-11-16'},Date:RetryClock,
  em:{fetchAuctionTicks:async()=>{calls++;if(calls===1)throw Error('fixture');return ticks('2026-11-16');}}});
 vm.runInContext(fn(server,'auctionTicksFor'),c);
 assert.equal(await c.auctionTicksFor('600000'),null);assert.equal(state.auctionTicks['600000'].data.tradeDate,'2026-11-13');
 assert.equal(await c.auctionTicksFor('600000'),null);assert.equal(calls,1);
 instant+=16*60000;assert.equal((await c.auctionTicksFor('600000')).tradeDate,'2026-11-16');assert.equal(calls,2);assert.equal(state.auctionTicks['600000'].failAt,0);
});
