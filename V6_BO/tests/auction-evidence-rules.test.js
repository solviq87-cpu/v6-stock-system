'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evaluateAuctionEvidence,evaluateAuctionBatch,RULES}=
 require('../src/strategy/auction-evidence-rules');
const run=require('../scripts/auction-evidence-report').run;
const tradeDate='2026-11-09';
const stamp=t=>Date.parse(tradeDate+'T'+t+'+08:00');
const asOf=stamp('09:26:00');
const q=(time,price,volume,opts={})=>({
 code:'000001',source:'authorized-feed-declared-unverified',quoteAt:stamp(time),
 receivedAt:stamp(time)+2000,indicativePrice:price,
 indicativeMatchedVolume:volume,...opts});
function stock(mod={}){
 return {code:'000001',source:'authorized-feed-declared-unverified',
  previousClose:10,dailyAverageAmount20:200000000,sectorRank:3,
  previousFirstBoardVerified:true,limitPct:10,
  snapshots:[
    q('09:17:00',10.7,10000),
    q('09:20:30',10.15,20000),
    q('09:23:00',10.20,30000),
    q('09:25:05',10.20,40000,{executed:true,executedAmount:8000000})
  ],...mod};
}
test('3 independent auction rules are audit-only candidates, not official score, push or execution',()=>{
 const r=evaluateAuctionEvidence(stock(),{asOf,tradeDate});
 assert.equal(RULES.length,3);
 assert.equal(r.status,'research_candidates');assert.equal(r.matchedRuleCount,3);
 assert.equal(r.independentFamilyCount,3);
 assert.ok(r.rules.every(x=>x.status==='candidate'));
 assert.equal(r.factors.openGapPct,2);
 assert.equal(r.factors.openingAmountRatio20,.04);
 assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 assert.equal(r.providerLicensed,false);assert.equal(r.exchangeVerified,false);
 assert.equal(r.weightsChanged,false);assert.equal(r.certifiedLive,false);
 assert.ok(r.rules[0].evidence.some(x=>x.includes('非真实成交量')));
});
test('OR across complete rules: 9:20 preliminary observation never becomes a fictitious 9:25 open',()=>{
 const s=stock({snapshots:stock().snapshots.slice(0,3)});
 const r=evaluateAuctionEvidence(s,{asOf:stamp('09:24:00'),tradeDate});
 assert.equal(r.matchedRuleCount,1);
 assert.equal(r.independentFamilyCount,1);
 assert.equal(r.factors.finalQuoteAt,null);
 assert.equal(r.rules[0].status,'candidate');
 assert.equal(r.rules[1].status,'insufficient_data');
 assert.equal(r.rules[2].status,'insufficient_data');
});
test('missing independent prior close, matching volume, amount baseline and sector identity do not become zero',()=>{
 const s=stock({previousClose:null});
 const r=evaluateAuctionEvidence(s,{asOf,tradeDate});
 assert.equal(r.status,'insufficient_data');
 assert.equal(r.matchedRuleCount,0);
 const missing=stock({dailyAverageAmount20:null,sectorRank:null,previousFirstBoardVerified:null,
  snapshots:stock().snapshots.slice(0,1)});
 const m=evaluateAuctionEvidence(missing,{asOf,tradeDate});
 assert.equal(m.matchedRuleCount,0);
 assert.ok(m.rules.every(x=>x.status==='insufficient_data'));
});
test('future, received-before-quote, stale receipt, wrong day and duplicated timestamps fail closed',()=>{
 const base=stock();
 const variations=[
  [q('09:25:20',10.2,40000,{executed:true,executedAmount:8000000}),stamp('09:25:10')],
  [q('09:20:30',10.2,20000,{receivedAt:stamp('09:20:29')}),asOf],
  [q('09:20:30',10.2,20000,{receivedAt:stamp('09:22:30')}),asOf],
  [q('09:20:30',10.2,20000,{code:'600001'}),asOf],
  [q('09:20:30',10.2,20000,{source:'other-feed'}),asOf],
  [q('09:20:30',10.2,20000,{indicativeMatchedVolume:-1}),asOf],
  [q('09:20:30',10.2,20000,{quoteAt:Date.parse('2026-11-08T09:20:30+08:00')}),asOf]
 ];
 for(const [bad,now] of variations){
  const r=evaluateAuctionEvidence({...base,snapshots:[bad]}, {asOf:now,tradeDate});
  assert.equal(r.status,'insufficient_data');
  assert.equal(r.matchedRuleCount,0);
 }
 const duplicate=evaluateAuctionEvidence({...base,snapshots:[base.snapshots[0],base.snapshots[0]]},
  {asOf,tradeDate});
 assert.equal(duplicate.matchedRuleCount,0);
});
test('stale 9:19 indicative price cannot stand in for a valid final opening auction',()=>{
 const r=evaluateAuctionEvidence(stock({snapshots:[
  q('09:19:00',10.8,40000),q('09:23:00',10.3,30000)
 ]}),{asOf,tradeDate});
 assert.equal(r.matchedRuleCount,0);
 assert.equal(r.factors.finalQuoteAt,null);
 assert.equal(r.rules[1].status,'insufficient_data');
});
test('auction fake-final flag outside 09:25, even with an amount, fails closed',()=>{
 const r=evaluateAuctionEvidence(stock({snapshots:[
  q('09:24:45',10.1,50000,{executed:true,executedAmount:10000000})
 ]}),{asOf,tradeDate});
 assert.equal(r.status,'insufficient_data');
});
test('9:20 cancellable-price spike that fades is a blocking risk even if tentative volume looks strong',()=>{
 const r=evaluateAuctionEvidence(stock({snapshots:[
  q('09:17:00',10.8,10000),
  q('09:20:30',10.08,10000),
  q('09:23:00',10.08,25000),
  q('09:25:05',10.05,30000,{executed:true,executedAmount:8000000})
 ]}),{asOf,tradeDate});
 assert.equal(r.status,'risk_blocked');
 assert.equal(r.matchedRuleCount,0);
 assert.ok(r.rules.every(x=>x.status==='risk_blocked'));
 assert.match(r.risks.join(' '),/9:20前/);
});
test('ST, suspended and near-limit gaps override any bullish match',()=>{
 for(const flag of [{isST:true},{suspended:true},{ipoNoLimit:true}]){
  const r=evaluateAuctionEvidence(stock(flag),{asOf,tradeDate});
  assert.equal(r.status,'risk_blocked');
  assert.equal(r.matchedRuleCount,0);
 }
 const r=evaluateAuctionEvidence(stock({snapshots:stock().snapshots.map(x=>
   x.executed?{...x,indicativePrice:10.95}:x)}),{asOf,tradeDate});
 assert.equal(r.status,'risk_blocked');
 assert.equal(r.matchedRuleCount,0);
 assert.match(r.risks.join(' '),/涨幅上限/);
});
test('pure research batch de-duplicates each symbol and keeps blocked stocks out of watchlist',()=>{
 const a=stock();
 const b=stock({code:'000002',isST:true,snapshots:stock().snapshots.map(x=>({...x,code:'000002'}))});
 const input={asOf,tradeDate,stocks:[a,b]};
 const r=evaluateAuctionBatch(input);
 assert.equal(r.total,2);
 assert.equal(r.matchedStocks,1);
 assert.equal(r.researchWatchlist[0].code,'000001');
 assert.equal(r.researchWatchlist[0].families.length,3);
 assert.equal(r.canTrade,false);
 assert.throws(()=>evaluateAuctionBatch({...input,stocks:[a,a]}),/重复证券/);
 assert.throws(()=>evaluateAuctionBatch({...input,stocks:[]}),/1-100/);
});
test('a severe intermediate quote dip must not be hidden by a later last-point rebound',()=>{
 const r=evaluateAuctionEvidence(stock({snapshots:[
  q('09:20:30',10.15,20000),
  q('09:21:20',9.9,22000),
  q('09:23:30',10.25,30000)
 ]}),{asOf:stamp('09:24:00'),tradeDate});
 assert.equal(r.rules[0].status,'not_matched');
 assert.ok(r.factors.indicativeMaxDrawdownPct<-1);
 assert.equal(r.matchedRuleCount,0);
});
test('virtual matched volume falling inside 9:20-9:25 is not stable auction support',()=>{
 const r=evaluateAuctionEvidence(stock({snapshots:[
  q('09:20:30',10.15,25000),
  q('09:21:30',10.16,17000),
  q('09:23:30',10.20,45000)
 ]}),{asOf:stamp('09:24:00'),tradeDate});
 assert.equal(r.rules[0].status,'not_matched');
 assert.equal(r.matchedRuleCount,0);
});
test('invalid far-future clocks and quote timestamps cannot bypass the date validation',()=>{
 const r=evaluateAuctionEvidence(stock(),{asOf:8640000000000000,tradeDate});
 assert.equal(r.status,'insufficient_data');
 const broken=stock({snapshots:[q('09:25:05',10.2,30000,{quoteAt:8640000000000000})]});
 const r2=evaluateAuctionEvidence(broken,{asOf,tradeDate});
 assert.equal(r2.status,'insufficient_data');
});

test('offline CLI never opens a remote network or writes over an existing file',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-auction-research-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'auction.json');
 const body=JSON.stringify({asOf,tradeDate,stocks:[stock()]});
 fs.writeFileSync(file,body);
 const result=run([file]);
 assert.equal(result.matchedStocks,1);
 assert.equal(fs.readFileSync(file,'utf8'),body);
 assert.throws(()=>run(['relative.json']),/绝对|用法/);
 const linked=path.join(dir,'linked.json');fs.symlinkSync(file,linked);
 assert.throws(()=>run([linked]),/不安全/);
});
