'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const src=fs.readFileSync(require.resolve('../em.js'),'utf8');

function loadFunction(startMarker,endMarker,name,context){
 const start=src.indexOf(startMarker);
 const end=src.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,`missing function ${name}`);
 vm.createContext(context);
 vm.runInContext(src.slice(start,end)+`\nthis.${name}=${name};`,context);
 return context[name];
}

test('tencent merge keeps unknown money flow as null and preserves genuine zero',async()=>{
 const context={
  FULL_MIN_OK:1,
  loadUniverse:()=>[],
  fetchBatchSnapshotTx:async()=>[
   {code:'000001',name:'A',price:10},
   {code:'000002',name:'B',price:11}
  ]
 };
 loadFunction('function batchQuoteAtPublication(row, now) {','function batchQuoteWarn','batchQuoteAtPublication',context);
 const fetchAllStocksTx=loadFunction('async function fetchAllStocksTx(','function normalizeStock(d)','fetchAllStocksTx',context);
 const base=[{code:'000001',mainInflow:undefined,mainPct:null},{code:'000002',mainInflow:0,mainPct:0}];
 while(base.length<1000)base.push({code:String(base.length+1).padStart(6,'0')});
 const out=await fetchAllStocksTx(base);
 const unknown=out.find(x=>x.code==='000001');
 const zero=out.find(x=>x.code==='000002');
 assert.equal(unknown.mainInflow,null);
 assert.equal(unknown.mainPct,null);
 assert.equal(zero.mainInflow,0);
 assert.equal(zero.mainPct,0);
});

test('全市场补价只访问缺报价的代码，慢批次结束时再次校验原时点',async()=>{
 const at=Date.parse('2026-11-20T10:00:00+08:00');
 let now=at,requested;
 class Clock extends Date{static now(){return now;}}
 const raw={code:'000001',price:10,pct:1,quoteAt:at,receivedAt:at,quoteSource:'eastmoney',canTrade:true};
 const unknown={code:'000002',price:11,pct:1,quoteAt:null,receivedAt:at,quoteSource:'eastmoney',mainInflow:0};
 // The cache predates the first symbol in the supplier's current result.
 const codes=Array.from({length:1000},(_,i)=>String(i+2).padStart(6,'0'));
 const context={Date:Clock,FULL_MIN_OK:4000,loadUniverse:()=>codes,
  fetchBatchSnapshotTx:async query=>{
   requested=query;now+=20000;
   return [{code:'000002',price:12,quoteAt:now,receivedAt:now,quoteSource:'tencent',canTrade:true}];
  }};
 loadFunction('function batchQuoteAtPublication(row, now) {','function batchQuoteWarn','batchQuoteAtPublication',context);
 const fill=loadFunction('async function fetchAllStocksTx(','function normalizeStock(d)','fetchAllStocksTx',context);
 const [retained,filled]=await fill([raw,unknown]);
 assert.equal(requested.length,1000);
 assert.equal(requested[0],'000002');
 assert.equal(retained.quoteAt,at);
 assert.equal(retained.receivedAt,at);
 assert.equal(retained.quoteFreshness,'stale');
 assert.equal(retained.canTrade,false);
 assert.equal(filled.quoteSource,'tencent');
 assert.equal(filled.mainInflow,0);
 assert.equal(filled.quoteAt,now);
});

test('sina source records unknown money flow as null instead of fabricated zero',async()=>{
 let page=0;
 const context={
  txGet:async()=>{
   page+=1;
   if(page!==1)return Buffer.from('[]','utf8');
   return Buffer.from(JSON.stringify([{
    code:'000001',name:'平安银行',trade:'12.3',changepercent:'1.2',
    volume:'10000',amount:'12000000',turnoverratio:'1.1',high:'12.5',low:'12.0',open:'12.1',settlement:'12.0',
    mktcap:'1000',nmc:'900'
   }]),'utf8');
  },
  delay:async()=>{},
  console:{error(){}}
 };
 const fetchAllStocksSina=loadFunction('async function fetchAllStocksSina() {','async function fetchGlobal()','fetchAllStocksSina',context);
 const rows=await fetchAllStocksSina();
 assert.equal(rows.length,1);
 assert.equal(rows[0].mainInflow,null);
 assert.equal(rows[0].mainPct,null);
});
