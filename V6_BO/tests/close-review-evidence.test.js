'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createCloseReviewReader,summarizePromotion,marketTurnover,reasonFromF10}=require('../src/core/close-review-evidence');
const {fetchReviewLimitPool}=require('../src/core/public-market-context');
const DAY='2026-11-20',PREVIOUS='2026-11-19',AT=Date.parse(DAY+'T19:00:00+08:00');
const pool=(day,items,complete=true)=>({tradeDate:day,complete,totalCount:items.length,
 records:items.map(([symbol,consecutiveLimits])=>({symbol,consecutiveLimits}))});

test('complete same-source pools compute tiers, including true zero promotion, without using a different date',()=>{
 const current=pool(DAY,[['600001',3],['600002',2],['600004',1]]);
 const previous=pool(PREVIOUS,[['600001',2],['600002',1],['600003',3],['600004',2]]);
 const expected={previousDay:PREVIOUS,stages:[{level:3,total:1,promoted:0},{level:2,total:2,promoted:1},{level:1,total:1,promoted:1}],
  failed:[{code:'600003',name:undefined,level:3},{code:'600004',name:undefined,level:2}]};
 assert.deepEqual(summarizePromotion(current,previous),expected);
 assert.equal(summarizePromotion(current,{...previous,tradeDate:DAY}),null);
 assert.equal(summarizePromotion(current,{...previous,complete:false}),null);
});

test('the pool helper rejects the vendor silently serving latest for a historical request',async()=>{
 const json={rc:0,data:{qdate:'20261120',tc:0,pool:[]}};
 await assert.rejects(fetchReviewLimitPool(PREVIOUS,'sealed',async()=>({json})),/不同交易日/);
 const current=await fetchReviewLimitPool(DAY,'sealed',async()=>({json}));
 assert.equal(current.complete,true);
 assert.deepEqual(current.records,[]);
 const withMetrics=await fetchReviewLimitPool(DAY,'sealed',async()=>({json:{rc:0,data:{
  qdate:'20261120',tc:1,pool:[{c:'600001',hs:'9.5',ltsz:5e9}]
 }}}));
 assert.equal(withMetrics.records[0].turnoverPct,9.5);
 assert.equal(withMetrics.records[0].floatCapCny,5e9);
});

test('supplemental reader coalesces requests and isolates mismatched reasons, seat dates and pool overlaps',async()=>{
 const own=pool(DAY,[['600001',2]]);
 let calls=0;
 const market={
  fetchZtReason:async()=>new Map([['600001',{reason:'同日标注',firstTime:new Date(AT-3600000)}],
   ['600002',{reason:'旧日标注',firstTime:new Date(AT-86400000)}]]),
  fetchDTCount:async()=>({qdate:'20261120',tc:0}),
  fetchIdxRt:async()=>[],
  fetchLhb:async(day,{onSeat})=>{
   for(const [date,dept,net] of [[DAY,'机构专用',-3000],[DAY,'深股通专用',7000],[PREVIOUS,'营业部',4000]]){
    onSeat({TRADE_DATE:date,SECURITY_CODE:'600001',OPERATEDEPT_NAME:dept,NET:net});
   }
  },
  get:async target=>{
   const type=new URL(target).searchParams.get('filter').match(/00[13]/)[0];
   return {result:{data:[{MUTUAL_TYPE:type,TRADE_DATE:DAY,DEAL_AMT:123}]}};
  }
 };
 const fetchPool=async(day,kind)=>{
  calls++;
  if(day===PREVIOUS)throw Error('historical source missing');
  return kind==='sealed'?own:pool(DAY,[['600001',null]]);
 };
 const read=createCloseReviewReader({market,fetchPool,fetchReason:async()=>null,clock:()=>AT});
 const results=await Promise.all([read(DAY,PREVIOUS,{seatsReady:true}),read(DAY,PREVIOUS,{seatsReady:true})]);
 assert.equal(results[0],results[1]);
 const result=results[0];
 assert.equal(calls,3);
 assert.equal(result.sealRate,null);
 assert.equal(result.promotion,null);
 assert.equal(result.down,0);
 assert.equal(result.northTurnover,246e6);
 assert.deepEqual(result.reasons,[{code:'600001',text:'同日标注',source:'同花顺涨停聚焦'}]);
 assert.deepEqual(result.seats.map(row=>[row.category,row.net]),[['互联互通',7000],['机构专用',-3000]]);
 assert.equal((await read(DAY,PREVIOUS,{seatsReady:true})),result);
 assert.equal(calls,3);
});

test('market turnover requires both verified same-day closing exchange quotes',()=>{
 const rows=['1.000001','0.399001'].map(code=>({code,tradeDate:DAY,quoteAt:AT,turnoverAmountYuan:1e8}));
 assert.equal(marketTurnover(rows,DAY),2e8);
 assert.equal(marketTurnover(rows,PREVIOUS),null);
 assert.equal(marketTurnover([{...rows[0],quoteAt:Date.parse(DAY+'T14:59:59+08:00')},rows[1]],DAY),null);
});

test('F10 fallback accepts only a dated same-row limit-up attribution',()=>{
 const notice='<tr><td>今天</td><td>异动提醒：<a href="?w=2026-11-20%AA">更多</a><span>10:00分触及涨停，分析或为：印制电路板+覆铜板</span></td></tr>';
 assert.equal(reasonFromF10(notice,DAY),'印制电路板+覆铜板');
 assert.equal(reasonFromF10(notice,PREVIOUS),null);
 assert.equal(reasonFromF10(notice.replace('2026-11-20%AA','趋势'),DAY),null);
 assert.equal(reasonFromF10(notice+notice.replace('覆铜板','商业航天'),DAY),null);
});

test('an incomplete refresh preserves only verified same-session fields, then accepts fresh valid values',async()=>{
 let now=AT,mode='ready';
 const next='2026-11-23';
 const market={
  fetchZtReason:async()=>mode==='ready'?new Map([['600001',{reason:'可核实原标注',reasonTradeDate:DAY}]]):new Map(),
  fetchDTCount:async day=>mode==='outage'?{qdate:'20261119',tc:80}:{qdate:day,tc:mode==='recovered'?0:7},
  fetchIdxRt:async()=>[],
  fetchLhb:async(day,{onSeat})=>{
   if(mode==='outage')throw Error('provider timed out');
   onSeat({TRADE_DATE:day,SECURITY_CODE:'600001',OPERATEDEPT_NAME:'机构专用',NET:3000});
  },
  get:async()=>null
 };
 const fetchPool=async(day,kind)=>{
  if(day===PREVIOUS)throw Error('not available');
  if(mode==='outage')return pool(PREVIOUS,[['600099',4]]);
  if(kind==='broken')return pool(day,[]);
  return pool(day,[[day===DAY?'600001':'600002',mode==='recovered'?3:2]]);
 };
 const read=createCloseReviewReader({market,fetchPool,fetchReason:async()=>null,clock:()=>now});
 await read(DAY,PREVIOUS,{seatsReady:true});
 now+=300001;
 mode='outage';
 const retained=await read(DAY,PREVIOUS,{seatsReady:true});
 assert.deepEqual(retained.retained.sort(),['broken','down','reasons','sealed','seats']);
 assert.equal(retained.down,7);
 assert.equal(retained.sealRate,1);
 assert.equal(retained.reasons[0].code,'600001');
 assert.equal(retained.seatsStatus,'observed');
 assert.equal(retained.retryAfterMs,120000);
 now+=120001;
 mode='recovered';
 const recovered=await read(DAY,PREVIOUS,{seatsReady:true});
 assert.equal(recovered.down,0);
 assert.equal(recovered.sealed.records[0].consecutiveLimits,3);
 assert.equal(recovered.retryAfterMs,null);
 const tomorrow=await read(next,DAY,{seatsReady:true});
 assert.equal(tomorrow.sealed.records[0].symbol,'600002');
 assert.equal(tomorrow.reasons.length,0);
 assert.deepEqual(tomorrow.retained,[]);
});

test('a verified saved sealed pool supplies the requested previous session after restart',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-close-review-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const poolFile=path.join(root,'data','limit.json');
 const next='2026-11-23';
 let now=AT;
 const market={
  fetchZtReason:async()=>new Map(),fetchDTCount:async()=>null,fetchIdxRt:async()=>[],fetchLhb:async()=>null,get:async()=>null
 };
 const reader=fetchPool=>createCloseReviewReader({market,poolFile,fetchPool,fetchReason:async()=>null,clock:()=>now});
 const friday=reader(async(day,kind)=>kind==='sealed'?pool(day,[['600001',2]]):pool(day,[]));
 await friday(DAY,PREVIOUS,{seatsReady:false});
 const saved=JSON.parse(fs.readFileSync(poolFile,'utf8'));
 assert.equal(saved.pools[0].tradeDate,DAY);
 now=Date.parse(next+'T19:00:00+08:00');
 const afterRestart=reader(async(day,kind)=>{
  if(day===DAY)return pool(next,[['600099',6]]);
  return kind==='sealed'?pool(next,[['600001',3]]):pool(next,[]);
 });
 const monday=await afterRestart(next,DAY,{seatsReady:false});
 assert.equal(monday.promotion.previousDay,DAY);
 assert.deepEqual(monday.promotion.stages,[{level:2,total:1,promoted:1}]);
 assert.ok(monday.retained.includes('previousPool'));
 assert.equal(monday.sealed.records[0].symbol,'600001');
});
