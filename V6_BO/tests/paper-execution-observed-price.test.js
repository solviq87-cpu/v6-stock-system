'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
function extract(start,end,context){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);vm.createContext(context);vm.runInContext(source.slice(a,b),context);return context;}
test('paper buy executes at the checked observation, not a different pool price',()=>{
 const acc={enabled:true,cash:10000,positions:{},trades:[]};const c={PAPER_CFG:{pool:{maxPos:1,name:'test'}},PAPER:{pool:acc},S:{ztCodes:new Set()},A:{isLimitUp:()=>false},Date,isReplica:()=>false,isContinuousTrading:()=>true,paperPxFresh:()=>10,paperAuthorityQuotes:()=>({600519:{price:10}}),paperEquity:()=>10000,paperFeeAmount:()=>5,paperLotOf:()=>100,skipAdd:()=>{},numNeutral:()=>0,dataCapOf:()=>100,savePaper:()=>true,pushPaperDigest:()=>{}};
 extract('function paperBuy(key, cands, pm, reasonOf)', '// ---------------- A股 T+1',c);
 c.paperBuy('pool',[{code:'600519',name:'样本',price:20,pct:0}],new Map([['600519',20]]),()=> 'test');
 assert.equal(acc.trades.length,1);assert.equal(acc.trades[0].price,10);assert.equal(acc.positions['600519'].buyPrice,10);
});
test('paper sell ignores stale pool price and does not raise profit peak from it',()=>{
 const pos={code:'600519',name:'样本',buyPrice:10,lastPrice:10,shares:100,peak:0,buyTs:1};const sold=[];
 const c={PAPER_CFG:{pool:{tp:0.1,sl:-0.03,expireDays:10}},PAPER:{pool:{enabled:true,positions:{'600519':pos}}},Date,paperPxFresh:()=>0,paperTouch:()=>{},paperSell:(...a)=>sold.push(a),tradeDaysSince:()=>1,paperT1Locked:()=>false,isLimitDownPrice:()=>false,linkedStop:()=>-0.03,effStopOf:()=>-0.03};
 extract('function paperCheck(key, pm)', 'function paperCheckAll(pm)',c);
 c.paperCheck('pool',new Map([['600519',20]]));assert.equal(sold.length,0);assert.equal(pos.peak,0);assert.equal(pos.pxStale,true);
 c.paperPxFresh=()=>11;c.paperCheck('pool',new Map([['600519',20]]));assert.equal(sold.length,1);assert.equal(sold[0][2],11);
});
