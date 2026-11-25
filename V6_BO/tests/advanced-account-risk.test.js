'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('../src/core/advanced-account-risk');
const eq=assert.equal;
test("existing quote gate rejects stale and switches to exact fresh row",()=>{
 const now=Date.parse("2026-11-25T10:00:00+08:00"),code="600000";
 const stock={code,name:"示例",price:9,preClose:10,quoteAt:now-1000,receivedAt:now,quoteSource:"provider",canTrade:true,suspended:false};
 const wire={...stock,price:8,quoteAt:now-16000};
 const x=mod.selectAdvancedRiskQuotes({codes:[code],stocks:[stock],lastPx:new Map([[code,{wireQuote:wire}]]),now,limitFor:()=>.1});
 eq(x[code].quote.price,9);eq(x[code].quote.quoteAt,stock.quoteAt);eq(x[code].limitDown,true);
 const y=mod.selectAdvancedRiskQuotes({codes:[code],stocks:[{...stock,canTrade:false}],lastPx:new Map([[code,{wireQuote:wire}]]),now,limitFor:()=>.1});
 eq(y[code].quote.price,8);eq(y[code].limitDown,null);
});
test("account lot maturity and pending sell reservation remain separate; stale valuation stays unknown",()=>{
 const day="2026-11-25",now=Date.parse(day+"T10:00:00+08:00"),code="600000";
 const book={revision:3,paperOnly:true,brokerConnected:false,feePolicy:{version:"v1",feeBps:3,minFee:5,sellTaxBps:5},
 account:{cash:10000,events:[],positions:{[code]:{quantity:300,lots:[{quantity:200,buyDate:"2026-11-24"},{quantity:100,buyDate:day}]}}},
 orders:{s:{order:{symbol:code,side:"sell"},state:{terminal:false,remainingQuantity:100},events:[]}}};
 const quote={code,price:10,quoteAt:now-16000,receivedAt:now,quoteSource:"provider",canTrade:true};
 const input={account:"pool",day,now,marketOpen:true,continuous:true,quotes:{[code]:{quote,limitDown:null,suspended:null}}};
 const x=mod.accountExitDiagnostics(book,input);
 eq(x.status,"observed-unverified");eq(x.positions[0].sellable,100);eq(x.positions[0].orderFrozen,100);eq(x.positions[0].estimatedFee,null);eq(x.equity,null);eq(x.completeReconciliation,false);eq(x.canTrade,false);
 const closed=mod.accountExitDiagnostics(book,{...input,marketOpen:false,continuous:false});
 eq(closed.positions[0].sellable,null);eq(closed.positions[0].matureUnreserved,100);
 const bad=mod.accountExitDiagnostics({...book,orders:{s:{...book.orders.s,state:{terminal:false,remainingQuantity:300}}}},input);
 eq(bad.status,"unknown");eq(bad.reason,"LOT_OR_FROZEN_MISMATCH");
 eq(book.account.positions[code].quantity,300);
});
test("duplicate ledger events and unmatched fills fail closed",()=>{
 const day="2026-11-25",now=Date.parse(day+"T10:00:00+08:00");
 const book={revision:2,paperOnly:true,brokerConnected:false,account:{cash:1000,positions:{},events:[{eventId:"same"},{eventId:"same"}]},orders:{}};
 const input={account:"pre",day,now,marketOpen:true,continuous:true};
 eq(mod.accountExitDiagnostics(book,input).reason,"DUPLICATE_OR_INVALID_LEDGER_EVENT");
 const x=mod.accountExitDiagnostics({...book,account:{...book.account,events:[{eventId:"orphan"}]}},input);
 eq(x.reason,"ORPHAN_LEDGER_EVENT");eq(x.writesAccount,false);
});
test("fresh valuation and estimated original fee are not execution permission",()=>{
 const day="2026-11-25",now=Date.parse(day+"T10:00:00+08:00"),code="600000";
 const book={revision:4,paperOnly:true,brokerConnected:false,feePolicy:{version:"v1",feeBps:3,minFee:5,sellTaxBps:5},account:{cash:1000,events:[],positions:{[code]:{quantity:100,lots:[{quantity:100,buyDate:"2026-11-24"}]}}},orders:{}};
 const x=mod.accountExitDiagnostics(book,{account:"pool",day,now,marketOpen:true,continuous:true,quotes:{[code]:{quote:{code,price:10,quoteAt:now-1000,receivedAt:now,quoteSource:"provider",canTrade:true,suspended:false},limitDown:false,suspended:false}}});
 eq(x.positions[0].estimatedFee,5.5);eq(x.positions[0].feeVersion,"v1");eq(x.equity,2000);eq(x.positions[0].estimatedMarketImpact,null);eq(x.positions[0].guaranteedFill,false);eq(x.canTrade,false);
});
test('worker reads original account without modifying it and rejects corrupt peer',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-advanced-risk-'));
 try{
  const pool=path.join(root,'pool.json'),pre=path.join(root,'pre.json');
  require('../src/core/paper-application-service').createPaperApplicationService({file:pool}).initialize(10000);
  fs.writeFileSync(pre,'{invalid',{mode:0o600});
  const before=[fs.readFileSync(pool,'utf8'),fs.readFileSync(pre,'utf8')];
  const {runAdvancedAccountRiskJob}=require('../src/server/advanced-account-risk-job');
  const now=Date.now(),day=require('../src/core/a-share-calendar').aShareCalendarDate(now);
  const input={root,day,requestAt:now,marketOpen:false,continuous:false,quotes:{},replica:false};
  const pending=runAdvancedAccountRiskJob(input);
  assert.equal((await runAdvancedAccountRiskJob(input)).status,'busy');
  const x=await pending;assert.equal(x.status,'incomplete');
  assert.equal(x.accounts[0].cash,10000);assert.equal(x.accounts[1].status,'unknown');
  assert.equal(x.accounts[1].reason,'ORIGINAL_READ_REJECTED_OR_UNAVAILABLE');assert.equal(x.canTrade,false);
  assert.deepEqual([fs.readFileSync(pool,'utf8'),fs.readFileSync(pre,'utf8')],before);
  assert.equal((await runAdvancedAccountRiskJob({...input,replica:true})).status,'replica');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
