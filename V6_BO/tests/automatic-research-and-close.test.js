'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAutomaticResearch,causalHistory}=require('../src/research/automatic-research');
const {fetchResearchHistory}=require('../src/research/public-history-fallback');
const {fetchCloseFlow}=require('../src/research/close-stock-details');
const {createCloseReviewReader}=require('../src/core/close-review-evidence');
const {validateUpload}=require('../src/strategy/research-upload-validator');

const symbol='600001',friday='2026-11-20',monday='2026-11-23';
const close=day=>Date.parse(day+'T15:30:00+08:00');
const calendar=[];
for(let t=Date.parse('2026-09-01T00:00Z');t<=close(monday);t+=86400000){
 const d=new Date(t);if(d.getUTCDay()%6!==0)calendar.push(d.toISOString().slice(0,10));
}
const bar=(date,knownAt=close(date))=>({date,knownAt,open:11,high:12,low:10,close:11,volume:100000});
const readerPaths=t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'automatic-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return Object.fromEntries(['observationRoot','evidenceRoot','workspaceRoot','reportDirectory'].map(k=>[k,path.join(dir,k)]));
};

test('automatic research coalesces reads, follows the next session and never re-dates late history',async t=>{
 const paths=readerPaths(t);let day=friday,fetches=0;
 t.mock.method(Date,'now',()=>close(day));
 const run=createAutomaticResearch({paths:()=>paths,getDay:()=>day,clock:()=>close(day),defaultSymbol:()=>symbol,
  calendar:()=>({tradeDates:calendar}),closeMember:()=>({name:'测试标的',knownAt:close(day),level:2,breakCount:0}),
  fetchHistory:async()=>{
   fetches++;const bars=calendar.filter(d=>d<=day).map(d=>bar(d,close(day)));
   return {status:'observed-unverified',priceBasis:'unadjusted',units:{volume:'shares'},retrievedAt:close(day),
    stock:{symbol,name:null,source:'sina',provider:'sina',priceBasis:'unadjusted',bars},provenance:{source:'sina'}};
  }});
 const [first,again]=await Promise.all([run(),run(symbol)]);assert.equal(first,again);assert.equal(fetches,1);
 assert.equal(first.name,'测试标的');assert.equal(first.tradeDate,friday);assert.equal(first.systems.length,4);
 assert.equal(first.research36.evaluations.length,36);assert.equal(first.research36.pipeline.barsUsed,first.stock.bars.length);
 assert.equal(first.history,null);assert.equal(first.canTrade,false);
 day=monday;const next=await run();assert.equal(next.tradeDate,monday);assert.equal(fetches,2);assert.equal(next.history,null);
 assert.equal(next.stock.bars.find(b=>b.date===friday).knownAt,close(friday));
 await assert.rejects(run('../600001'),/代码/);
});
test('replay observes field-level receipt times, preserves true zero and rejects a calendar gap',()=>{
 const dates=calendar.slice(-40),bars=dates.map(d=>({...bar(d),amount:0,amountKnownAt:close(d),tradable:false,statusKnownAt:close(monday)+86400000}));
 const stock={symbol,name:'样本',provider:'eastmoney',bars};
 const history=causalHistory(stock,dates);assert.equal(history.source,'imported');assert.equal(history.stocks[0].bars[0].amount,0);
 assert.equal(history.stocks[0].bars[0].tradable,undefined);assert.equal(validateUpload(history,{now:close(monday)}),null);
 assert.equal(causalHistory({...stock,bars:bars.filter((_,i)=>i!==20)},dates),null);
});
test('public daily backup handles a failed primary and excludes the unfinished daily candle',async()=>{
 const at=Date.parse(monday+'T10:30:00+08:00'),bars=[friday,monday].map(day=>({day,open:'10',high:'11',low:'9',close:'10',volume:'30000'}));
 const response=await fetchResearchHistory({symbol,historyDays:30,provider:'auto'},{clock:()=>at,primary:async()=>{throw Error('offline');},
  request:async()=>({raw:Buffer.from(JSON.stringify({result:{status:{code:0},data:bars}}))})});
 assert.deepEqual(response.stock.bars.map(b=>[b.date,b.knownAt,b.volume]),[[friday,at,30000]]);
});
test('net flow joins require the requested security and day, keep zero and signed amounts under their own vendor',async()=>{
 const east=(code,day,value)=>({rc:0,data:{code,market:1,klines:[[day,value,...Array(13).fill(0)].join(',')]}});
 const query=(a,b)=>fetchCloseFlow(symbol,friday,{clock:()=>close(friday),request:async url=>({raw:Buffer.from(JSON.stringify(url.includes('eastmoney')?a:b))})});
 assert.equal((await query(east(symbol,friday,0),[])).mainInflow,0);
 const fallback=await query(east('600002',friday,150),[{opendate:friday,daima:'sh'+symbol,r0_net:'-123.40'}]);
 assert.equal(fallback.mainInflow,-123.4);assert.match(fallback.flowSource,/新浪/);
 assert.equal(await query(east(symbol,monday,33),[{opendate:friday,daima:'sh600003',r0_net:45}]),null);
});
test('two dated provider reports preserve different reasons for the same stock across a restart',async t=>{
 const {reportDirectory}=readerPaths(t);let day=friday;
 const opts={reportDirectory,clock:()=>close(day),market:{
  fetchZtReason:async d=>new Map([[symbol,{reason:'来源批次 '+d,reasonTradeDate:d}]]),
  fetchDTCount:async()=>({qdate:day.replaceAll('-',''),tc:0}),fetchIdxRt:async()=>[],get:async()=>null},
  fetchPool:async(d,type)=>({tradeDate:d,complete:true,totalCount:type==='sealed'?1:0,records:type==='sealed'?[{symbol,name:'样本',consecutiveLimits:1}]:[]})};
 const read=createCloseReviewReader(opts);
 for(day of [friday,monday]){const r=await read(day,null,{seatsReady:false});assert.equal(r.reasons[0].text,'来源批次 '+day);}
 const restart=createCloseReviewReader(opts);assert.equal(restart.retained(friday).reasons[0].text,'来源批次 '+friday);
 assert.equal(restart.retained(monday).reasons[0].text,'来源批次 '+monday);assert.equal(restart.retained('2026-11-24'),null);assert.equal(restart.retained('../'),null);
});
test('shortlist ranks only same-date evidenced observations, keeps both selection and risk distinct from the full universe',async()=>{
 const {selectResearchPicks,projectClosingWorkspace}=await import('../public/nova/market.js');
 const rows=Array.from({length:7},(_,i)=>({code:String(600001+i),name:i===6?'*ST测试':'样本'+i,level:i===6?9:2+i%2,breakCount:i,firstSeal:'09:36:00',
  detailSource:'测试行情源',sealAmount:i===0?0:i*120000,turnover:9.3,mainInflow:-8000,
  reasonRaw:'同期公告与复盘 '+i,reasonDateStatus:'matched',reasonTradeDate:i===5?'2026-11-19':friday,reasonSource:'同花顺涨停聚焦'}));
 const state={closeSession:{day:friday},marketRecovery:{closeWatch:{complete:true,day:friday,knownAt:close(friday),source:'测试行情源',items:rows}}};
 const picked=selectResearchPicks(state,{now:close(friday)});assert.deepEqual(picked.items.map(x=>x.code),['600002','600004','600001']);
 assert.ok(picked.items.every(x=>x.selectionWhy.includes('首封')&&x.selectionRisk&&x.reasonRaw));
 const joined=projectClosingWorkspace({...state,review:{date:friday,items:[{code:symbol,turnover:null,sealAmount:null,mainInflow:null}]}},close(friday));
 assert.deepEqual(['turnover','sealAmount','mainInflow'].map(k=>joined.review.items.find(r=>r.code===symbol)[k]),[9.3,0,-8000]);
 assert.deepEqual(selectResearchPicks({...state,closeSession:{day:monday}},{now:close(monday)}).items,[]);
});
