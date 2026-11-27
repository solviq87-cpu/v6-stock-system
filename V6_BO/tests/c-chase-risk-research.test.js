'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-20',code='600001',at=day+' 15:00';
const bar=(date=day,extra={})=>({code,date,role:'stock',period:'日K',priceBasis:'unadjusted',open:10,high:12,low:9,close:11,volume:10000,...extra});
function history(n=20){
 const a=[];let t=new Date(day+'T12:00:00Z');
 while(a.length<n){t.setUTCDate(t.getUTCDate()-1);if([0,6].includes(t.getUTCDay()))continue;a.unshift(bar(t.toISOString().slice(0,10),{close:10}));}
 return a;
}
async function scan(extra={}){return (await api).buildChaseRiskResearch({b:bar(),history:history(),asOf:at,...extra});}
test('C23.0 declared daily CSV availability preserves suspension; precise knownAt remains required',async()=>{
 const r=await api,b=bar(day,{availableAt:day,tradingStatus:'停牌'}),f=new Map();
 r.addStockRiskEvidence({b,asOf:at},f);assert.equal(f.get('57:1')?.pass,true);
 for(const patch of [{knownAt:day},{availableAt:null},{availableAt:'2026-11-23'}]){
  const facts=new Map();r.addStockRiskEvidence({b:{...b,...patch},asOf:at},facts);assert.equal(facts.has('57:1'),false);
 }
});
test('C23.1 real 20-row window exposes rank and range position separately',async()=>{
 const r=await scan();assert.equal(r.priceRange.count,20);assert.equal(r.priceRange.closeRankPct,100);
 assert.ok(Math.abs(r.priceRange.rangePositionPct-200/3)<1e-10);assert.equal(r.canTrade,false);
});
test('C23.1 missing weekday, duplicate conflict and adjusted prior cannot produce full range',async()=>{
 const h=history();
 for(const rows of [h.slice(1),h.filter((_,i)=>i!==9),[...h,{...h[9],close:11}],h.map((x,i)=>i===9?{...x,priceBasis:'hfq'}:x)])
  assert.equal((await scan({history:rows})).priceRange,null);
 assert.equal((await scan({history:[...h,{...h[9]}]})).priceRange.count,20);
});
test('C23.1 future revision does not rewrite original range; explicit corporate action breaks it',async()=>{
 const h=history();
 assert.equal((await scan({history:[...h,{...h[9],close:11,knownAt:day+' 15:01'}]})).priceRange.count,20);
 assert.equal((await scan({history:h.map((x,i)=>i===9?{...x,corporateAction:true}:x)})).priceRange,null);
 assert.equal((await scan({b:bar(day,{priceBasis:null})})).priceRange,null);
});
test('C23.1 range breakout is not clamped to a fake percentile; flat range stays unknown',async()=>{
 const r=await scan({b:bar(day,{high:14,close:13})});assert.equal(r.priceRange.aboveRange,true);assert.ok(r.priceRange.rangePositionPct>100);assert.equal(r.priceRange.closeRankPct,100);
 const flat=history().map(x=>({...x,open:10,low:10,high:10,close:10}));
 assert.equal((await scan({history:flat})).priceRange.rangePositionPct,null);
});
test('C23.2 only same-date same-prior-window market and sector returns are compared',async()=>{
 const prev=history().at(-1).date,b=bar(day,{sector:'设备'}),market={date:day,previousDay:prev,indexChange:2},sector={date:day,previousDay:prev,code:'设备',role:'sector',change:3};
 const r=await scan({b,market,sector});assert.ok(Math.abs(r.relativeStrength.versusIndexPctPoints-8)<1e-10);assert.ok(Math.abs(r.relativeStrength.versusSectorPctPoints-7)<1e-10);
 assert.equal((await scan({b,market:{...market,previousDay:'2026-11-18'},sector:{...sector,code:'医药'}})).relativeStrength,null);
});
test('C23.2 conflict, late market, missing return and wrong role cannot supply relative return',async()=>{
 const prev=history().at(-1).date,b=bar(day,{sector:'设备'}),m={date:day,previousDay:prev,indexChange:0},s={date:day,previousDay:prev,sector:'设备',role:'sector',change:0};
 for(const patch of [{conflict:true},{knownAt:day+' 15:01'},{indexChange:null},{previousDay:null},{indexChange:-101}]){
  const r=await scan({b,market:{...m,...patch},sector:s});assert.equal(r.relativeStrength.indexChange,null);assert.equal(r.relativeStrength.sectorChange,0);
 }
 assert.equal((await scan({b,market:m,sector:{...s,role:'stock'}})).relativeStrength.sectorChange,null);
});
test('C23.3 signed active-buy share distinguishes withdrawal, zero and different turnover',async()=>{
 const h=history();Object.assign(h.at(-1),{source:'原始日汇总',amount:1000,netActiveBuy:100});
 const r=await scan({history:h,b:bar(day,{source:'原始日汇总',amount:2000,netActiveBuy:-100})});
 assert.equal(r.activeBuy.turnedNegative,true);assert.equal(r.activeBuy.deltaPctPoints,-15);
 assert.equal((await scan({history:h,b:bar(day,{source:'原始日汇总',amount:2000,netActiveBuy:0})})).activeBuy.currentSharePct,0);
});
test('C23.3 missing or incomparable declared flow cannot be treated as a real outflow',async()=>{
 const h=history();Object.assign(h.at(-1),{source:'原始日汇总',amount:1000,netActiveBuy:100});
 for(const patch of [{source:'其他来源'},{netActiveBuy:null},{netActiveBuy:3000},{amount:0},{source:null}])
  assert.equal((await scan({history:h,b:bar(day,{source:'原始日汇总',amount:2000,netActiveBuy:-100,...patch})})).activeBuy,null);
});
test('C23.4 daily reversal is a price-only observation, not a fabricated intraday path',async()=>{
 const r=await scan({b:bar(day,{open:10,high:12,low:9,close:10})});
 assert.ok(Math.abs(r.reversal.drawdownFromHighPct-100/6)<1e-10);assert.equal(r.reversal.basis,'daily-ohlc-not-intraday-path');
 const flat=await scan({b:bar(day,{open:10,high:10,low:10,close:10})});assert.equal(flat.reversal.drawdownFromHighPct,0);assert.equal(flat.reversal.closePositionPctOfRange,null);
 for(const patch of [{high:9},{suspended:true},{sourceConflict:true},{priceBasis:'hfq'}])assert.equal((await scan({b:bar(day,patch)})).reversal,null);
});
test('C23.5 frozen plan gross payoff and break-even are not actual costs or predicted probabilities',async()=>{
 const plan={code,intendedDate:day,frozenAt:day+' 09:00',entryPrice:11,stopPrice:10,targetPrice:13};
 const r=await scan({plan});assert.equal(r.grossPayoff.grossRewardRisk,2);assert.ok(Math.abs(r.grossPayoff.breakEvenWinRatePct-100/3)<1e-10);assert.equal(r.canTrade,false);
 for(const patch of [{entryPrice:10},{stopPrice:11},{targetPrice:11},{targetPrice:null},{knownAt:day+' 15:01'},{intendedDate:'2026-11-23'},{conflict:true}])
  assert.equal((await scan({plan:{...plan,...patch}})).grossPayoff,null);
});
test('C23.integration original deriveCheckInput and autoValidate carry read-only evidence',async()=>{
 const {deriveCheckInput}=await import('../public/nova/shortline/backtest.mjs'),{autoValidate}=await import('../public/nova/shortline/market.mjs');
 const catalog=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
 const state={catalog,bars:[...history(),bar()],market:[],trades:[],plans:[]};
 const d=deriveCheckInput(state,{code,date:day}),a=autoValidate(state,{code,date:day});
 assert.equal(d.recognition.chaseRiskResearch.priceRange.count,20);assert.equal(a.recognition.chaseRiskResearch.canTrade,false);
 assert.equal(a.recognition.chaseRiskResearch.priceRange.closeRankPct,100);
});
