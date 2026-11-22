'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../public/nova/shortline/catalog.json');
const {autoValidate}=require('../public/nova/shortline/market.mjs');
const {signals}=require('../public/nova/shortline/backtest.mjs');
const {createShortlineCloseRunner}=require('../src/research/shortline-close-runner');
const code='600001',date='2026-11-20';
const b={code,date,period:'日K',name:'测试',role:'stock',open:10,close:10.3,high:10.5,low:10,volume:10000,turnover:5,sector:'半导体',auctionGap:2,auctionRatio:1.8,auctionAmount:30000000,sectorAuctionUpPct:70,auctionNetBuy:1000000};
const state=()=>({catalog,bars:[{...b}],market:[],checks:[],trades:[],versions:[],plans:[],notes:[],explanations:[],corrections:[]});
test('同一客观竞价数据自动匹配目录14，校验和K线匹配一致，未知周期拦截',()=>{
 const s=state(),r=autoValidate(s,{code,date});
 assert.deepEqual(r.matches,['竞价模式战法']);assert.equal(r.position,0);assert.equal(r.emotion.stage,'未判定');
 assert.equal(signals(s)[0].strategy,'竞价模式战法');
 delete s.bars[0].auctionRatio;
 const incomplete=autoValidate(s,{date,code,selected:['14:0','14:1','14:2','14:3','14:4']});
 assert.equal(incomplete.strategy,'未判定');
 assert.ok(incomplete.recognition.candidates.find(x=>x.name==='竞价模式战法').missing.includes('竞价量比'));
});
test('同日收盘后的可信证据只用于当前标的的盘后研究，历史特征保持原时点',()=>{
 const s=state();s.bars[0].availableAt=date+' 16:00';
 assert.equal(autoValidate(s,{date,code,asOf:date+' 17:00'}).strategy,'未判定');
 s.v6Observation={day:date,code,latestClosed:true,observedAt:date+' 16:01',stock:{code},missing:[]};
 assert.equal(autoValidate(s,{date,code}).strategy,'竞价模式战法');
 assert.equal(signals(s,date).length,0);
 s.v6Observation.code='600002';assert.equal(autoValidate(s,{date,code}).strategy,'未判定');
});
test('主实例收盘轮转自动归档，盘中及副本跳过，重复标的不重复派发',async()=>{
 let now=1e8,minute=914,replica=false;const calls=[];
 const tick=createShortlineCloseRunner({session:()=>({openDay:true,minute,day:'20261120'}),isReplica:()=>replica,pool:()=>[code,code,'600002'],root:'ignored',clock:()=>now,
   readSource:async p=>({...p,latestClosed:true}),job:async r=>{if(r.input)calls.push(r.input);return {ok:true,state:{revision:1,checks:[]}}}});
 await tick();minute=925;replica=true;await tick();assert.equal(calls.length,0);
 replica=false;await tick();await tick();now+=61000;await tick();now+=61000;await tick();
 assert.deepEqual(calls.map(x=>x.payload.code),[code,'600002']);
});
test('原生盘后校验自动进入后续收益跟踪，冻结以前查不到，已过入场时点不能事后取收益',()=>{
 const s=state();s.bars[0].availableAt=date+' 16:00';
 s.v6Observation={day:date,code,latestClosed:true,observedAt:date+' 16:01',stock:{code}};
 const c=autoValidate(s,{code,date});c.createdAt=date+'T08:02:00Z';s.checks.push(c);
 s.bars.push({...b,date:'2026-11-23'});
 assert.equal(signals(s,date+' 15:00').length,0);
 const f=signals(s,'2026-11-23').find(x=>x.date===date);
 assert.equal(f.decisionAt,date+' 16:02');assert.equal(f.outcomes[1].end,'2026-11-23');
 c.createdAt='2026-11-23T03:00:00Z';
 assert.equal(signals(s,'2026-11-23').find(x=>x.date===date).outcomes[1],null);
});
