'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcilePaperAccount:reconcile}=require('../src/core/paper-account-reconciliation');
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const trade=(t,side,code,shares,amount,fee)=>({t,side,code,shares,amount,fee,tradeId:String(t)});
// Independent cent-allocation reference follows the existing paper-account-ledger:
// rounded debit/credit, rounded consumed lot cost, remaining cost = old - consumed.
function fixture(initialCash,trades){
 let cash=initialCash,realized=0;
 const positions={};
 for(const t of trades){const lots=positions[t.code]??=[];
  if(t.side==='BUY'){const debit=money(t.amount+t.fee);cash=money(cash-debit);lots.push({shares:t.shares,basis:debit});}
  else{let remaining=t.shares,basis=0;while(remaining>0){const lot=lots[0];assert.ok(lot);const take=Math.min(remaining,lot.shares),consumed=money(lot.basis*take/lot.shares);basis+=consumed;lot.basis=money(lot.basis-consumed);lot.shares-=take;remaining-=take;if(lot.shares===0)lots.shift();}cash=money(cash+money(t.amount-t.fee));realized=money(realized+money(t.amount-t.fee-basis));}
 }
 const snapshot={};for(const [symbol,lots] of Object.entries(positions))if(lots.length)snapshot[symbol]={shares:lots.reduce((n,l)=>n+l.shares,0),basis:money(lots.reduce((n,l)=>n+l.basis,0))};
 return {initialCash,trades,account:{cash,realized,positions:snapshot}};
}
test('a temporary sell-fee overdraft is rejected even when later proceeds recover cash',()=>{
 const x=fixture(2005,[trade(1,'BUY','600001',200,2000,5),trade(2,'SELL','600001',100,1,5),trade(3,'SELL','600001',100,500,5)]);
 assert.equal(x.account.cash,491);const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.ok(r.errors.some(e=>e.includes('现金为负数')));
});
test('the reconciliation tolerance cannot authorize a one-cent temporary purchase overdraft',()=>{
 const x=fixture(1004.99,[trade(1,'BUY','600001',100,1000,5),trade(2,'SELL','600001',100,1100,5)]);
 const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.ok(r.errors.some(e=>e.includes('现金为负数')));
});
test('exact cash exhaustion remains a legitimate zero balance',()=>{
 const x=fixture(1005,[trade(1,'BUY','600001',100,1000,5)]);assert.equal(x.account.cash,0);assert.equal(reconcile(x).ok,true);
});
test('a partial disposal uses the authority consumed-cent basis rather than rounding the remaining lot independently',()=>{
 for(let cost=1000;cost<1010;cost++){const x=fixture(10000,[trade(1,'BUY','600001',200,cost+.01,0),trade(2,'SELL','600001',100,600,0)]);const r=reconcile({...x,tolerance:0});assert.equal(r.ok,true,JSON.stringify({cost,report:r}));}
});
test('successive partial sales conserve cash and realized profit at full liquidation in 1900 deterministic cases',()=>{
 for(let cost=1000;cost<1100;cost++)for(let n=2;n<=20;n++){
  const trades=[trade(1,'BUY','600001',n*100,cost+.01,0)];for(let j=0;j<n;j++)trades.push(trade(j+2,'SELL','600001',100,100,0));
  const x=fixture(10000,trades);assert.equal(x.account.realized,money(x.account.cash-x.initialCash));const r=reconcile({...x,tolerance:0});assert.equal(r.ok,true,JSON.stringify({cost,n,report:r}));
 }
});
test('FIFO multiple lots and fees retain exact cash, cost basis, profit and input nonmutation',()=>{
 const trades=[trade(1,'BUY','600001',200,1000,5.01),trade(2,'BUY','600001',300,1511,5.02),trade(3,'SELL','600001',300,1800,6),trade(4,'SELL','600001',100,650,5),trade(5,'BUY','600002',100,800,5)];
 const x={...fixture(10000,trades),tolerance:0},before=JSON.stringify(x);const r=reconcile(x);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(JSON.stringify(x),before);
});
test('sale fees with enough cash do not manufacture a false overdraft',()=>{
 const x=fixture(3000,[trade(1,'BUY','600001',200,2000,5),trade(2,'SELL','600001',100,1,5),trade(3,'SELL','600001',100,500,5)]);assert.equal(reconcile(x).ok,true);
});
