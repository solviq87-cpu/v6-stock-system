'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const source=process.env.V6_REASON_BASELINE_REF?execFileSync('git',['show',process.env.V6_REASON_BASELINE_REF+':V6_BO/server.js'],{cwd:path.dirname(root),encoding:'utf8',maxBuffer:4*1024*1024}):fs.readFileSync(path.join(root,'server.js'),'utf8');
const monday=Date.parse('2026-11-16T10:00:00+08:00');
function cache(fetch){let time=monday;class Clock extends Date{static now(){return time;}}
 const start=source.indexOf('let _ztReasonCache ='),end=source.indexOf('// 把 "电力人工智能',start);
 const c=vm.createContext({Date:Clock,require:require('node:module').createRequire(path.join(root,'server.js')),console:{error(){}},
  dataTradeDay:async()=> '2026-11-16',lastTradeDay:()=> '20261116',em:{fetchZtReason:fetch}});
 vm.runInContext(source.slice(start,end),c);return{api:c.ztReasonCached,advance:ms=>{time+=ms;}};
}
test('reason source day comes from supplier first-limit epoch rather than requested date',async()=>{
 const a=cache(async()=>new Map([['600000',{reason:'原始原因',firstTime:new Date('2026-11-16T09:31:00+08:00')}]]));
 const r=(await a.api('20261116')).get('600000');assert.equal(r.reasonTradeDate,'2026-11-16');assert.equal(r.reasonSource,'ths');assert.equal(r.reasonDateStatus,'matched');assert.equal(r.reasonDateBasis,'provider-first-limit-time');
});
test('missing, HHmmss-like epoch and future provider reason times remain unknown',async()=>{
 for(const firstTime of [null,new Date(92500*1000),new Date(monday+1000),new Date(NaN)]){
  const a=cache(async()=>new Map([['600000',{reason:'待核验',firstTime}]]));const r=(await a.api('20261116')).get('600000');
  assert.equal(r.reasonTradeDate,null);assert.equal(r.reasonDateStatus,'unknown');assert.equal(r.reasonRequestedDate,'2026-11-16');
 }
});
test('same-day verified reasons survive an expired-cache network failure or empty response',async()=>{
 for(const fail of [false,true]){let calls=0;const a=cache(async()=>{calls++;if(calls===1)return new Map([['600000',{reason:'有效同日',firstTime:new Date('2026-11-16T09:31:00+08:00')}]]);if(fail)throw Error('fixture');return new Map();});
  const first=(await a.api('20261116')).get('600000');a.advance(11*60000);const kept=(await a.api('20261116')).get('600000');assert.equal(kept.reasonTradeDate,'2026-11-16');assert.equal(kept.reason,'有效同日');assert.equal(kept.reasonReceivedAt,first.reasonReceivedAt);
 }
});

test('a partial undated refresh cannot erase a previously verified reason for the same stock and day',async()=>{
 let count=0;const a=cache(async()=>new Map([['600000',++count===1?{reason:'有效同日',firstTime:new Date('2026-11-16T09:31:00+08:00')}:{reason:'未知新包',firstTime:null}]]));
 await a.api('20261116');a.advance(11*60000);const kept=(await a.api('20261116')).get('600000');assert.equal(kept.reason,'有效同日');assert.equal(kept.reasonDateStatus,'matched');
});
function injection(rows,map,previous=[],throws=false,reviewRows=[]){
 const start=source.indexOf('    let thsTopics = [];',source.indexOf('async function refreshSectorsZT()'));
 const end=source.indexOf('    // ---- 同花顺涨停原因 →',start);
 const c=vm.createContext({zt:rows,_ztDay:'20261116',_previousZtByCode:new Map(previous.map(row=>[row.code,row])),requestedTradeDate:'2026-11-16',S:{ztReviewPool:reviewRows,ztReviewPoolMeta:{tradeDate:'2026-11-16'}},
  require:require('node:module').createRequire(path.join(root,'server.js')),ztTopics:()=>[],ztReasonCached:async()=>{if(throws)throw Error('fixture');return map;},console:{error(){}}});
 return vm.runInContext('(async()=>{'+source.slice(start,end)+'return zt;})()',c);
}
const verified=(day='2026-11-16',code='600000')=>({code,reason:'原始原因',reasonTradeDate:day,reasonSource:'ths',reasonDateStatus:'matched',reasonReceivedAt:monday-1000});
test('actual production injection rejects same-code prior-day reasons and keeps their real date visible',async()=>{
 const [row]=await injection([{code:'600000'}],new Map([['600000',verified('2026-11-13')]]));
 assert.equal(row.reason,'');assert.equal(row.reasonTradeDate,'2026-11-13');assert.equal(row.reasonDateStatus,'mismatch');
});
test('actual injection preserves same-day evidence during timeout but never borrows another stock',async()=>{
 const [kept]=await injection([{code:'600000'}],new Map(),[verified()],true);assert.equal(kept.reason,'原始原因');assert.equal(kept.reasonDateStatus,'matched');
 const [unknown]=await injection([{code:'600000'}],new Map([['600000',verified('2026-11-16','600001')]]));assert.equal(unknown.reason,'');assert.equal(unknown.reasonDateStatus,'unknown');
});
test('review production projection preserves exact reason provenance independently of global topic source',()=>{
 const start=source.indexOf('      reasonRaw: z.reason'),end=source.indexOf('      floatCap:',start);assert.ok(start>0&&end>start);
 const c=vm.createContext({z:verified(),S:{ztTopicSrc:'global-sector-statistics'}});const item=vm.runInContext('({'+source.slice(start,end)+'})',c);
 assert.equal(item.reasonRaw,'原始原因');assert.equal(item.reasonTradeDate,'2026-11-16');assert.equal(item.reasonSource,'ths');assert.equal(item.reasonDateStatus,'matched');
});
test('the real THS mapper retains full supplier first-limit time as the date evidence input',async()=>{
 const emSource=fs.readFileSync(path.join(root,'em.js'),'utf8'),start=emSource.indexOf('async function fetchZtReason('),end=emSource.indexOf('\n}',start)+2;
 const at=Date.parse('2026-11-16T09:31:00+08:00');const c=vm.createContext({Date,curlGet:async()=>({data:{info:[{code:'600000',reason_type:'原始原因',first_limit_up_time:at/1000}]}}),_srcWarn(){}});
 vm.runInContext(emSource.slice(start,end),c);const mapped=(await c.fetchZtReason('20261116')).get('600000');assert.equal(mapped.firstTime.getTime(),at);
 const {normalizeReasonEvidence}=require('../src/core/limit-reason-evidence');assert.equal(normalizeReasonEvidence(mapped,{requestedDate:'20261116',receivedAt:monday,source:'ths'}).reasonTradeDate,'2026-11-16');
});

test('readonly CLS reasons survive THS injection without entering the strategy pool',async()=>{
 const readonly={...verified(),sources:['cls'],reasonSource:'cls',reason:'CLS完整原因'};
 const [strategy]=await injection([{code:'600000'}],new Map([['600000',verified()]]),[],false,[readonly]);
 assert.equal(strategy.reasonSource,'ths');assert.equal(strategy.reason,'原始原因');assert.equal(readonly.reasonSource,'cls');assert.equal(readonly.reason,'CLS完整原因');
});
