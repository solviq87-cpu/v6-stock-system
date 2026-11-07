'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ledgerBacktest}=require('../src/strategy/research-v2-position-ledger-backtest');
const {adaptCachedKline}=require('../src/strategy/research-v2-cached-kline-adapter');
const {scanUniverse}=require('../src/strategy/research-v2-universe-scanner');
const bars=()=>Array.from({length:32},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
 open:10,high:11,low:9,close:10,volume:100000}));
const stock=()=>({symbol:'000001',market:'main',bars:bars()});
const run=(s,opts={})=>ledgerBacktest({stocks:[s],start:27,end:31,selectCandidates:()=>[s.symbol],...opts});
test('滑点后的买卖成交价都在逐日限价范围内',()=>{
 const s=stock();Object.assign(s.bars[28],{open:10.99,upperLimit:11});Object.assign(s.bars[29],{open:9.01,lowerLimit:9});
 const t=run(s,{slippageBps:100}).trades[0];assert.equal(t.entry,11);assert.equal(t.exit,9);
});
test('卖出日不可交易时继续持仓并于恢复后卖出',()=>{
 const s=stock();s.bars[29].tradable=false;const r=run(s);assert.equal(r.trades[0].sellDay,30);
 assert.equal(r.equity.find(e=>e.day===29).openPositions,1);
});
test('执行日缺省的标的级限制仍生效；逐日状态优先',()=>{
 const s=stock();s.suspended=true;s.bars[27].suspended=false;
 assert.ok(!run(s).orders.some(x=>x.status==='filled'));s.bars[28].suspended=false;
 assert.ok(run(s).orders.some(x=>x.side==='buy'&&x.status==='filled'));
});
test('候选重复时仍可填满两个不同标的的名额',()=>{
 const a=stock(),b={...stock(),symbol:'000002'};const r=run(a,{stocks:[a,b],topN:2,selectCandidates:()=>[a.symbol,a.symbol,b.symbol]});
 assert.deepEqual(r.orders.filter(x=>x.day===28&&x.status==='filled').map(x=>x.symbol),[a.symbol,b.symbol]);
});
test('缓存保留逐日限价和风险标志，扫描使用最后一日风险状态',()=>{
 const rows=bars(),now=Date.UTC(2025,2,1);Object.assign(rows.at(-1),{upperLimit:11,lowerLimit:9,isST:true,suspended:false,tradable:true});
 const r=adaptCachedKline('000001',{rows},{now,cachedAt:now});assert.equal(r.stock.bars.at(-1).upperLimit,11);
 const item=scanUniverse({stocks:[r.stock],now}).items[0];assert.equal(item.tradable,false);assert.equal(item.strategy.riskFilter.hardBlock,true);
 rows[4].tradable='false';assert.ok(adaptCachedKline('000001',{rows},{now,cachedAt:now}).error);
 delete rows[4].tradable;rows[4].upperLimit=8;rows[4].lowerLimit=9;assert.ok(adaptCachedKline('000001',{rows},{now,cachedAt:now}).error);
});
