'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../myrules');
const rows=()=>Array.from({length:65},(_,i)=>({date:'d'+i,close:10+i*.1,high:10.1+i*.1,volume:100+i,amount:1e8,pct:i===40?10:1}));
function input(){const rs=rows();rs.at(-1).close=20;rs.at(-1).volume=1000;return {stock:{code:'600001',name:'样本',price:20,floatCap:7e9,amount:1e8,sealAmount:3e8,limitUpCount:1,breakCount:0,preClose:10},rows:rs,
 sector:{name:'样本',pct:2,ztCount:3},auction:{auctionAmount:2e8,auctionPct:4},profitRatio:35,lhb:{whale:true,whaleNet:1e7,why:'样本'},
 aucTicks:{preClose:10,bars:[{t:'09:15',price:10,vol:10},{t:'09:20',price:10.1,vol:20},{t:'09:25',price:10.4,vol:100}]}}}
const item=(x,n,cfg)=>M.evaluateOne(x,cfg).items.find(r=>r.i===n);
test('invalid prices and rounded cap boundaries are never favorable evidence',()=>{
 for(const price of [0,-1,NaN,Infinity,true,'10']){const x=input();x.stock.price=price;assert.equal(item(x,2).unknown,true)}
 const x=input();x.stock.floatCap=49.99e8;assert.equal(item(x,1).ok,false);
 x.stock.floatCap=100.01e8;assert.equal(item(x,1).ok,false);
 x.stock.floatCap=50e8;assert.equal(item(x,1).ok,true);
});
test('moving averages and complete gene windows do not treat missing closes or percentages as zero',()=>{
 const x=input();x.rows[20].close=null;assert.equal(item(x,3).unknown,true);
 x.rows=rows().slice(-30);assert.equal(item(x,4).unknown,true);
 x.rows=rows();x.rows.at(-2).pct=null;assert.equal(item(x,4).unknown,true);
 x.rows=rows();x.rows.at(-2).volume=null;assert.equal(item(x,4).unknown,true);
 assert.equal(M.maOf([{close:10},{close:null}],2),null);
});
test('sector OR preserves known positive evidence but cannot turn missing evidence into known rejection',()=>{
 const x=input();x.sector={name:'样本',pct:0};assert.equal(item(x,5).unknown,true);
 x.sector.ztCount=0;assert.equal(item(x,5).ok,false);assert.equal(item(x,5).unknown,undefined);
 x.sector={name:'样本',pct:2};assert.equal(item(x,5).ok,true);
});
test('auction turnover and change need actual finite inputs',()=>{
 for(const patch of [{auctionAmount:null},{auctionPct:null},{auctionAmount:-1},{auctionAmount:'70000000'},{amountUnit:'USD'}]){
  const x=input();x.auction={...x.auction,...patch};assert.equal(item(x,6).unknown,true);
 }
});
test('four ratios use complete actual yuan amounts, never a share count',()=>{
 const x=input();x.rows.at(-2).amount=null;assert.equal(item(x,8).unknown,true);
 x.rows.at(-2).amount=0;assert.equal(item(x,8).unknown,true);
 x.rows.at(-2).amount=1e8;x.rows.at(-2).amountUnit='shares';assert.equal(item(x,8).unknown,true);
 delete x.rows.at(-2).amountUnit;x.stock.sealAmount=null;assert.equal(item(x,8).unknown,true);
 x.stock.sealAmount=3e8;assert.equal(item(x,8).ok,true);
});
test('unknown consecutive boards blocks admission without claiming a confirmed exclusion',()=>{
 for(const lb of [undefined,null,-1,1.5,'0',NaN]){
  const x=input();x.stock.limitUpCount=lb;const r=M.evaluateOne(x);
  assert.equal(item(x,11).unknown,true);assert.equal(r.pass,false);assert.equal(r.verdict,'unknown');
  assert.equal(r.exclusionPending,true);assert.deepEqual(r.excluded,[]);
 }
 const x=input();x.stock.limitUpCount=4;assert.equal(M.evaluateOne(x).verdict,'fail');
 x.stock.limitUpCount=0;assert.equal(item(x,11).ok,true);assert.equal(item(x,9).ok,false);
 x.stock.limitUpCount=1;assert.equal(item(x,9).ok,true);
 x.stock.breakCount=null;assert.equal(item(x,9).unknown,true);
});
test('the original 60-session left-peak rule actually requires 60 prior highs',()=>{
 const x=input();x.rows=x.rows.slice(-60);assert.equal(item(x,13).unknown,true);
 x.rows=rows();x.rows.at(-1).close=20;x.rows.at(-1).volume=1000;
 assert.equal(item(x,13).ok,true);x.rows.at(-30).high=null;assert.equal(item(x,13).unknown,true);
 x.rows=rows();x.rows.at(-1).close=20;x.rows.at(-2).volume=0;assert.equal(item(x,13).unknown,true);
});
test('auction ticks support the workspace volume field without inventing a 99x ratio',()=>{
 const x=input();x.aucTicks.bars=x.aucTicks.bars.map(({vol,...b})=>({...b,volume:vol}));
 assert.equal(item(x,14).ok,true);assert.equal(item(x,7).ok,true);
 x.aucTicks.bars[0].volume=0;x.aucTicks.bars[1].volume=0;assert.equal(item(x,14).unknown,true);
 x.aucTicks.bars[0].volume=1;x.aucTicks.bars[0].vol=2;assert.equal(item(x,14).unknown,true);
});
test('malformed auction windows or conflicting reference closes stay unknown',()=>{
 for(const patch of [{t:'09:26'},{t:'09:20'},{price:NaN}]){
  const x=input();Object.assign(x.aucTicks.bars[0],patch);assert.equal(item(x,7).unknown,true);assert.equal(item(x,14).unknown,true);
 }
 const x=input();delete x.stock.preClose;delete x.aucTicks.preClose;assert.equal(item(x,7).unknown,true);
 x.stock.preClose=10;x.aucTicks.preClose=11;assert.equal(item(x,7).unknown,true);
 x.aucTicks.bars=x.aucTicks.bars.slice(0,2);assert.equal(item(x,14).unknown,true);
});
test('malformed chip evidence or whale labels cannot supply a native hit',()=>{
 const x=input();x.profitRatio=101;assert.equal(item(x,10).unknown,true);
 x.profitRatio=35;x.rows.at(-2).high=null;assert.equal(item(x,10).unknown,true);
 x.rows=rows();x.lhb={whale:'true',whaleNet:100};assert.equal(item(x,12).unknown,true);
 x.lhb={whale:true,whaleNet:0};assert.equal(item(x,12).unknown,true);
 x.lhb={whale:false,netBuy:0};assert.equal(item(x,12).ok,false);
});
test('valid rule set retains original thresholds, exactly 14 distinct identities and coverage accounting',()=>{
 const x=input(),before=JSON.stringify(x),r=M.evaluateOne(x);
 assert.equal(r.items.length,14);assert.equal(new Set(r.items.map(i=>i.i)).size,14);
 assert.equal(r.known+r.unknown,14);assert.equal(r.hits+r.missList.length,r.known);
 assert.equal(r.evaluatorVersion,'v6-fourteen-native-2');assert.equal(JSON.stringify(x),before);
 assert.equal(M.DEFAULTS.minHits,6);assert.equal(M.DEFAULTS.maxLianBan,4);
 assert.equal(M.evaluateOne(x,{minHits:99}).pass,false);
});
