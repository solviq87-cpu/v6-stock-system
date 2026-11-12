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
 const fetchAllStocksTx=loadFunction('async function fetchAllStocksTx(base) {','function normalizeStock(d)','fetchAllStocksTx',context);
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
