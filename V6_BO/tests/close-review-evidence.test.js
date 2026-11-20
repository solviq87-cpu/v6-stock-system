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
