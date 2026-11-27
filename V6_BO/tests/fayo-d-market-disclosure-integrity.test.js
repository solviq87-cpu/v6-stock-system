'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const CLS=require('../src/core/cls-limit-up-pool');
const EXT=require('../external_data');
const J=require('../src/core/news-evidence-journal');
const F=require('../src/core/public-stock-financials');
const NOW=Date.parse('2026-11-26T16:05:00+08:00'),DAY='2026-11-26',CODE='600000';
const pool=()=>({code:200,data:[{secu_code:'sh600000',secu_name:'股票',time:DAY+' 09:30:00',num_stocks:1,last_px:10,is_st:0}]});
const norm=(x=pool(),opts={})=>CLS.normalizeClsLimitPool(x,{requestedDate:DAY,receivedAt:NOW,...opts});
test('limit pool cannot accept ambiguous or impossible receipt dates or a future requested session',()=>{
 for(const receivedAt of ['2026-11-26 16:05:00','2026-11-26T16:05:00','2026-02-30T16:05:00+08:00']){
  const r=norm(pool(),{receivedAt});assert.equal(r.complete,false);assert.equal(r.errors[0].code,'cls-received-time-invalid');
 }
 assert.equal(norm(pool(),{requestedDate:'2026-11-27'}).errors[0].code,'cls-requested-date-future');
 const good=norm(pool(),{receivedAt:new Date(NOW).toISOString()});assert.equal(good.complete,true);assert.equal(good.items[0].quoteAt,null);
});
test('limit pool security must be an exact provider string, never a coercible array',()=>{
 const x=pool();x.data[0].secu_code=['sh600000'];const r=norm(x);
 assert.equal(r.complete,false);assert.equal(r.items.length,0);assert.equal(r.errors[0].code,'cls-item-identity-invalid');
});
test('future limit pool request or a throwing start clock makes no supplier calls',async()=>{
 let calls=0;const requestJson=async()=>{calls++;return {raw:JSON.stringify(pool())}};
 const r=await CLS.fetchClsLimitPool({date:'2026-11-27'},{now:NOW,requestJson});
 assert.equal(r.complete,false);assert.equal(r.errors[0].code,'cls-requested-date-future');
 const bad=await CLS.fetchClsLimitPool({date:DAY},{now:()=>{throw Error('clock')},requestJson});
 assert.equal(bad.complete,false);assert.equal(calls,0);
});
const rn='RPT_RZRQ_TOTALNEW',margin=(row,success=true)=>({success,result:{data:[{DATE:DAY+' 00:00:00',...row}]}});
test('margin balance retains true zero, missing and distinct RZYE_SZ field',()=>{
 const r=EXT.normalizeMarginResponse(margin({RZYE:0,RZYE_SZ:99,RQYE:'20.5',RZJME:'',RQMCL:0}),rn,NOW);
 assert.equal(r.rzBalance,0);assert.equal(r.rzBalanceSzReported,99);assert.equal(r.rqBalance,20.5);
 assert.equal(r.rzBuy,null);assert.equal(r.rqSell,0);assert.equal(r.date,DAY);assert.equal(r.sourceQuoteAt,null);assert.equal(r.canTrade,false);
 const separate=EXT.normalizeMarginResponse(margin({RZYE_SZ:99}),rn,NOW);
 assert.equal(separate.rzBalance,null);assert.equal(separate.rzBalanceSzReported,99);
});
test('margin rejects invalid report, dates, false success and coercible or negative balances',()=>{
 for(const row of [{DATE:'2026-02-30',RZYE:10},{DATE:'2026-11-27',RZYE:10},{RZYE:'0x10'},{RZYE:[10]},{RZYE:-1},{RZYE:true}]){
  assert.equal(EXT.normalizeMarginResponse(margin(row),rn,NOW),null);
 }
 assert.equal(EXT.normalizeMarginResponse(margin({RZYE:10},false),rn,NOW),null);
 assert.equal(EXT.normalizeMarginResponse(margin({RZYE:10}),'unregistered-report',NOW),null);
});
const raw=(code='news-a',extra={})=>({code,title:'公司公告',summary:'原始内容',showTime:DAY+' 15:00:00',url:'https://example.invalid/news',stockList:['1.600000','0.000001'],...extra});
function journalRoot(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-d-news-conflict-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('conflicting provider editions quarantine the ID before append, independent of input order',t=>{
 for(const reverse of [false,true]){
  const root=journalRoot(t),versions=[raw(),raw('news-a',{summary:'不同内容'})];
  if(reverse)versions.reverse();
  const result=J.captureProviderBatch(root,[...versions,raw('unrelated')],{now:NOW});
  assert.equal(result.captured,1);assert.equal(result.rejected,2);assert.ok(result.rejectedEventIds.includes('news-a'));
  const events=J.readJournal(root,{now:NOW});assert.equal(events.length,1);assert.equal(events[0].evidence.eventId,'unrelated');
 }
});
test('same news security order permutations do not create new revisions or conflicts',t=>{
 const root=journalRoot(t),first=raw(),other=raw('news-a',{stockList:[...first.stockList].reverse()});
 const result=J.captureProviderBatch(root,[first,other],{now:NOW});
 assert.equal(result.captured,1);assert.equal(result.rejected,0);
 assert.equal(J.captureProviderBatch(root,[other],{now:NOW+1}).captured,0);
 assert.equal(J.readJournal(root,{now:NOW+1}).length,1);
});
test('a repeated original cannot hide a competing retraction in the same provider batch',t=>{
 const root=journalRoot(t);const first=raw();J.captureProviderBatch(root,[first],{now:NOW});
 const retraction=raw('news-a',{retracted:true,revisedAt:DAY+' 16:05:01',summary:'撤回'});
 const conflict=J.captureProviderBatch(root,[first,retraction],{now:NOW+2000});
 assert.equal(conflict.captured,0);assert.equal(conflict.rejected,2);assert.ok(conflict.rejectedEventIds.includes('news-a'));
 assert.equal(J.readJournal(root,{now:NOW+2000}).length,1);
 const good=J.captureProviderBatch(root,[retraction],{now:NOW+3000});assert.equal(good.captured,1);
 assert.equal(J.readJournal(root,{now:NOW+3000}).at(-1).evidence.kind,'retracted');
});
const report=(day='2026-09-30',patch={})=>({SECURITY_CODE:CODE,SECUCODE:CODE+'.SH',CURRENCY:'CNY',REPORT_DATE:day,
 NOTICE_DATE:'2026-10-31',UPDATE_DATE:'2026-10-31',ROEJQ:0,ZCFZL:40,PARENTNETPROFITTZ:20,TOTALOPERATEREVETZ:10,...patch});
const bytes=rows=>JSON.stringify({success:true,result:{data:rows}});
const period=()=>F.parseFinancials(bytes([report()]),{symbol:CODE,kind:'period',receivedAt:NOW});
const quarter=p=>F.parseFinancials(bytes([report()]),{symbol:CODE,kind:'quarter',receivedAt:NOW,period:p});
const view=(p,q,asOf=NOW)=>F.financialFeatures({symbol:CODE,source:'eastmoney-financials',datasets:{period:p,quarter:q}},{code:CODE,asOf});
test('quarter parser requires a valid period receipt and rejects conflicting explicit currency or revision fields',()=>{
 for(const p of [{...period(),rawHash:'bad'},{...period(),source:'another'},{...period(),simulated:true}]){
  assert.throws(()=>quarter(p),/报告期/);
 }
 const p=period();
 for(const row of [report(undefined,{CURRENCY:'USD'}),report(undefined,{UPDATE_DATE:'2026-11-01'})]){
  assert.throws(()=>F.parseFinancials(bytes([row]),{symbol:CODE,kind:'quarter',receivedAt:NOW,period:p}));
 }
 assert.equal(view(p,quarter(p)).earningsGrowthPct.value,20);
});
test('financial features recheck each quarter anchor and typed decision time, not merely a claimed hash',()=>{
 const p=period(),q=quarter(p);
 for(const change of [{reportDate:'2026-06-30'},{publicationDate:'2026-11-01',updatedDate:'2026-11-01'},{currency:'USD'},{periodKind:'period'}]){
  const bad={...q,records:[{...q.records[0],...change}]};
  assert.equal(view(p,bad).earningsGrowthPct,undefined);
  assert.equal(view(p,bad).roePct.value,0);
 }
 assert.deepEqual(view(p,q,String(NOW)),{});
 assert.equal(view({...p,records:[{...p.records[0],reportDate:'2026-09-29'}]},q).roePct,undefined);
});
test('financial invalid start clock never calls supplier; receipt rollback cannot publish a later quarter',async()=>{
 let calls=0;const requestJson=async()=>{calls++;return {raw:bytes([report()])};};
 const bad=await F.fetchPublicStockFinancials({symbol:CODE},{requestJson,now:()=>NaN});
 assert.equal(calls,0);assert.equal(bad.rawEvidence.length,0);assert.equal(bad.errors[0].code,'FINANCIAL_CLOCK_INVALID');
 const times=[NOW,NOW,NOW+1000,NOW-1];
 const result=await F.fetchPublicStockFinancials({symbol:CODE},{requestJson,now:()=>times.shift()});
 assert.equal(calls,2);assert.equal(result.rawEvidence.length,1);assert.ok(result.datasets.period);
 assert.equal(result.datasets.quarter,undefined);assert.equal(result.errors[0].code,'FINANCIAL_CLOCK_INVALID');
});
test('valid financial receipts remain separate and preserve zero and original dates',async()=>{
 const r=await F.fetchPublicStockFinancials({symbol:CODE},{requestJson:async()=>({raw:bytes([report()])}),now:()=>NOW});
 assert.equal(r.errors.length,0);assert.equal(r.rawEvidence.length,2);
 assert.equal(r.datasets.quarter.periodRawHash,r.datasets.period.rawHash);
 assert.equal(view(r.datasets.period,r.datasets.quarter).roePct.value,0);
 assert.equal(r.canTrade,false);
});
