'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertUnadjustedExecutionPriceBasis:priceBasis}=require('../src/core/historical-execution-price-basis');
const {corporateAction,entitlement}=require('../src/core/corporate-actions');
const {reconcilePaperAccount:reconcile}=require('../src/core/paper-account-reconciliation');
const {performanceStatistics:stats}=require('../src/core/performance-statistics');

// A-1: execution-only price metadata must not be contradicted at a lower level.
const rawHistory=()=>({priceBasis:'unadjusted',priceAdjustment:{mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'},stocks:[{code:'600000',bars:[{date:'2026-11-26',open:10,high:11,low:9,close:10,volume:1000}]}]});
test('A1: stock-level adjusted basis is rejected even with a raw dataset declaration',()=>{
 const h=rawHistory();h.stocks[0].priceBasis='qfq';assert.throws(()=>priceBasis(h),/未复权/);
});
test('A1: stock and bar adjustment metadata cannot bypass execution gate',()=>{
 const h=rawHistory();h.stocks[0].priceAdjustment={mode:'hfq'};assert.throws(()=>priceBasis(h),/未复权/);
 delete h.stocks[0].priceAdjustment;h.stocks[0].bars[0].priceAdjustment={mode:'unadjusted',provider:'baostock-adjustflag-1'};assert.throws(()=>priceBasis(h),/矛盾/);
});
test('A1: explicitly missing or adjusted bar basis is not a legacy omission',()=>{
 for(const basis of [null,'','qfq','hfq','unknown']){const h=rawHistory();h.stocks[0].bars[0].priceBasis=basis;assert.throws(()=>priceBasis(h),/未复权/);}
});
test('A1: known adjusted provider labels are refused at all hierarchy levels',()=>{
 for(const select of [h=>h,h=>h.stocks[0],h=>h.stocks[0].bars[0]]){
  const h=rawHistory();select(h).provider=' BAOSTOCK-ADJUSTFLAG-2 ';assert.throws(()=>priceBasis(h),/矛盾/);
 }
});
test('A1: raw and omitted metadata remain backward-readable but unverified',()=>{
 const h=rawHistory(),b=h.stocks[0].bars[0];b.priceBasis='unadjusted';b.provider='baostock-adjustflag-3';assert.deepEqual(priceBasis(h),{basis:'declared-unadjusted-unverified',verifiedExternal:false,canTrade:false});
 delete h.priceBasis;delete h.priceAdjustment;assert.deepEqual(priceBasis(h),{basis:'legacy-undeclared-unverified',verifiedExternal:false,canTrade:false});
});

// A-2: historical company action dates must be real days, not Date.parse rollover.
function actionBar(date='2026-03-02',publishedAt='2026-03-01T15:00:00+08:00'){
 return {date,corporateAction:{type:'cash-and-shares',source:'fixture',netCashPerShare:.12,shareMultiplier:1.5,referenceClose:10,publishedAt,cashDate:date,sharesAvailableDate:date}};
}
test('A2: impossible effective calendar dates are refused',()=>{
 assert.throws(()=>corporateAction(actionBar('2026-02-30','2026-02-27T15:00:00+08:00')),/权益证据/);
});
test('A2: impossible publication calendar dates are refused even if parsed before execution',()=>{
 assert.throws(()=>corporateAction(actionBar('2026-03-03','2026-02-30T15:00:00+08:00')),/权益证据/);
});
test('A2: exact opening timestamp remains valid; one second late is not',()=>{
 const valid=actionBar('2026-03-02','2026-03-02T09:30:00+08:00');assert.equal(corporateAction(valid),valid.corporateAction);
 assert.throws(()=>corporateAction(actionBar('2026-03-02','2026-03-02T09:30:01+08:00')),/权益证据/);assert.equal(corporateAction({date:'2026-03-02'}),null);
});

// A-3: entitlements cannot introduce malformed shares or unsafe currency values.
test('A3: only nonnegative safe integer original share counts are accepted',()=>{
 for(const bad of [-100,1.5,true,'100',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>entitlement(bad,{shareMultiplier:2,netCashPerShare:0}),/股数/);
});
test('A3: direct invalid cash and multiplier evidence is refused',()=>{
 for(const action of [{shareMultiplier:1,netCashPerShare:-1},{shareMultiplier:1,netCashPerShare:'1'},{shareMultiplier:-1,netCashPerShare:0},{shareMultiplier:'1',netCashPerShare:0}])assert.throws(()=>entitlement(100,action),/权益证据/);
});
test('A3: finite or infinite unsafe currency arithmetic must not yield a payout',()=>{
 for(const perShare of [1e14,Number.MAX_VALUE])assert.throws(()=>entitlement(100,{shareMultiplier:1,netCashPerShare:perShare}),/金额/);
});
test('A3: positive whole-share entitlement, zero shares and original cash precision stay unchanged',()=>{
 assert.deepEqual(entitlement(100,{shareMultiplier:1.5,netCashPerShare:.12}),{shares:150,cash:12});
 assert.deepEqual(entitlement(0,{shareMultiplier:1,netCashPerShare:0}),{shares:0,cash:0});
 assert.throws(()=>entitlement(3,{shareMultiplier:1.5,netCashPerShare:0}),/零碎股/);
});

// A-4: missing or malformed account and trade evidence cannot masquerade as zero.
const empty=()=>({initialCash:0,trades:[],account:{cash:0,realized:0,positions:{}}});
const invalidNumbers=[null,'',' ',false,[],[0],{}];
test('A4: unknown opening cash cannot certify an empty account',()=>{
 for(const value of invalidNumbers){const x=empty();x.initialCash=value;const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);}
});
test('A4: missing actual cash/P&L has a null value and null difference, not a fake zero',()=>{
 for(const key of ['cash','realized'])for(const value of invalidNumbers){const x=empty();x.account[key]=value;const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.equal(r[key].actual,null);assert.equal(r[key].diff,null);}
});
test('A4: malformed position quantities and bases are unknown, not an empty position',()=>{
 for(const key of ['shares','basis'])for(const value of invalidNumbers){const x=empty();x.account.positions['600000']={shares:0,basis:0,[key]:value};const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.equal(r.positions.differences[0][key==='shares'?'actualShares':'actualBasis'],null);assert.equal(r.positions.differences[0][key==='shares'?'shareDiff':'basisDiff'],null);}
});
test('A4: coercible arrays and booleans in trade shares, amounts and fees cannot be reconciled',()=>{
 for(const key of ['shares','amount','fee']){
  const x={initialCash:10,trades:[{t:1,side:'BUY',code:'600000',shares:1,amount:1,fee:0,[key]:key==='fee'?[]:true}],account:{cash:9,realized:0,positions:{'600000':{shares:1,basis:1}}}};
  const r=reconcile(x);assert.equal(r.ok,false);assert.equal(r.complete,false);
 }
});
test('A4: explicit numeric zero, valid legacy numeric strings and absent positions remain supported',()=>{
 assert.equal(reconcile(empty()).ok,true);
 const x={initialCash:'10',trades:[{t:1,side:'BUY',code:'600000',shares:'1',amount:'1',fee:'0'}],account:{cash:'9',realized:'0',positions:{'600000':{qty:'1',costBasis:'1'}}}};
 assert.equal(reconcile(x).ok,true);assert.equal(reconcile({...empty(),account:{cash:0,realized:0,positions:{'600000':{shares:0,basis:0}}}}).ok,true);
});

// A-5: a missing trade must not disappear from the win-rate denominator.
test('A5: malformed and missing realized P&L cannot improve win-rate by exclusion',()=>{
 for(const netPnl of [null,undefined,'-1',NaN,Infinity])assert.throws(()=>stats([{value:100}],{initialCash:100,trades:[{netPnl:1},{netPnl}]}),/平仓|绩效/);
 const sparse=Array(2);sparse[0]={netPnl:1};assert.throws(()=>stats([{value:100}],{initialCash:100,trades:sparse}),/平仓|绩效/);
});
test('A5: overflow in returns, variance or percent cannot escape as an infinite statistic',()=>{
 for(const [initialCash,equity] of [[1e-300,[{value:1e300}]],[1,[{value:1e200},{value:1e200}]],[1,[{value:1e307}]]])assert.throws(()=>stats(equity,{initialCash}),/绩效.*范围|收益.*范围/);
});
test('A5: ordinary realized wins, losses and flat trades retain the full denominator',()=>{
 const r=stats([{value:101},{value:100}],{initialCash:100,trades:[{netPnl:1},{netPnl:-1},{netPnl:0}]});assert.equal(r.closedTrades,3);assert.ok(Math.abs(r.winRatePct-100/3)<1e-10);assert.equal(r.returnPct,0);assert.ok(Number.isFinite(r.annualizedVolatilityPct));assert.equal(r.annualizedReturnPct,null);
 const noTrades=stats([{equity:100}],{initialCash:100});assert.equal(noTrades.winRatePct,null);assert.equal(noTrades.closedTrades,0);
});
