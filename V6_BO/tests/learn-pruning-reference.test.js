'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function run(signals,limit){
 const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
 const start=source.indexOf('function pruneSignals(limit = 2600) {'),end=source.indexOf('// ⚠️ 原「概率量纲清洗',start);
 const context={S:{learn:{signals:structuredClone(signals)}},normDate:d=>d,console:{log(){},warn(){}}};vm.createContext(context);
 vm.runInContext(source.slice(start,end),context);const result=context.pruneSignals(limit);
 return JSON.parse(JSON.stringify({result,signals:context.S.learn.signals}));
}
test('learning prune returns an explicit no-drop summary and preserves below-limit samples',()=>{
 const samples=[{date:'2026-11-01',type:'yier',ts:2,resolved:false}];const r=run(samples,2);
 assert.deepEqual(r.result,{total:1,dropped:0,droppedByType:{}});assert.deepEqual(r.signals,samples);
});
test('late rare yier and lianban survive abundant resolved auction samples within a day quota',()=>{
 const samples=Array.from({length:20},(_,i)=>({date:'2026-11-01',type:'auczt',ts:i,resolved:true}));
 samples.push({date:'2026-11-01',type:'yier',ts:100,resolved:false},{date:'2026-11-01',type:'lianban',ts:101,resolved:false});
 const r=run(samples,4);assert.deepEqual(r.signals.map(s=>s.type),['auczt','auczt','yier','lianban']);
 assert.deepEqual(r.result,{total:4,dropped:18,droppedByType:{auczt:18}});
});
test('equal-frequency types retain resolved first then earlier registration deterministically',()=>{
 const samples=[{date:'2026-11-01',type:'x',ts:5,resolved:false},{date:'2026-11-01',type:'x',ts:3,resolved:true},{date:'2026-11-01',type:'x',ts:1,resolved:true}];
 assert.deepEqual(run(samples,2).signals.map(s=>s.ts),[1,3]);
 assert.deepEqual(run(samples,2),run(samples.slice().reverse(),2));
});
test('day quotas retain dates when possible and drop reporting counts every excluded sample',()=>{
 const samples=[];for(let day=1;day<=3;day++)for(let i=0;i<5;i++)samples.push({date:'2026-11-0'+day,type:i===4?'yier':'auczt',ts:day*10+i,resolved:i<4});
 const r=run(samples,6);assert.equal(new Set(r.signals.map(s=>s.date)).size,3);assert.equal(r.signals.filter(s=>s.type==='yier').length,3);
 assert.equal(r.result.total+r.result.dropped,samples.length);assert.equal(Object.values(r.result.droppedByType).reduce((a,b)=>a+b,0),r.result.dropped);
});
async function txRows(time){
 const source=fs.readFileSync(require.resolve('../em.js'),'utf8'),start=source.indexOf('async function fetchBatchSnapshotTx(codes)'),end=source.indexOf('// 新浪全A列表',start);
 const f=Array(60).fill('0');Object.assign(f,{1:'fixture',3:'10',4:'9',6:'100',30:time,32:'1',33:'11',34:'9',37:'100',38:'1',44:'1',45:'1'});
 const now=Date.parse('2026-11-06T02:00:00Z');class Clock extends Date{static now(){return now;}}
 const context={Date:Clock,TextDecoder,txMarket:()=> 'sh',txGet:async()=>Buffer.from('v_sh600519="'+f.join('~')+'";'),require:x=>require(require('node:path').resolve(__dirname,'..',x))};
 const helpers=source.slice(source.indexOf('function batchQuoteAtPublication('),source.indexOf('async function fetchBatchSnapshotEM(codes)'));
 vm.createContext(context);vm.runInContext(helpers+source.slice(start,end),context);return JSON.parse(JSON.stringify(await context.fetchBatchSnapshotTx(['600519'])));
}
test('existing Tencent batch path preserves vendor time separately from reception time',async()=>{
 const [r]=await txRows('20261106095900');assert.equal(r.quoteAt,Date.parse('2026-11-06T01:59:00Z'));assert.equal(r.receivedAt,Date.parse('2026-11-06T02:00:00Z'));assert.equal(r.quoteFreshness,'stale');assert.equal(r.price,10);
});
test('existing Tencent batch labels recent, future and missing provider times without inventing timestamps',async()=>{
 assert.equal((await txRows('20261106100000'))[0].quoteFreshness,'recent-unverified');
 assert.equal((await txRows('20261106100001'))[0].quoteFreshness,'future');
 const [r]=await txRows('invalid');assert.equal(r.quoteAt,null);assert.equal(r.quoteFreshness,'unknown');
});
