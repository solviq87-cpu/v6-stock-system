'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {attributeIndependentStrategies}=require('../src/core/independent-strategy-attribution');
const {runOfflineResearchClosure}=require('../src/core/offline-research-closure');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),stocks:[{code:'000001',market:'main',bars:dates.map((date,i)=>({date,open:10+i*.01,high:10.5+i*.01,low:9.5+i*.01,close:10+i*.01,volume:10000}))}]};
const signal={system:'fourteen',symbol:'000001',date:dates[33],verdict:'pass',provenance:'native-evaluator-test'};
test('no supplied independent evidence never fabricates four strategy returns',()=>{const r=attributeIndependentStrategies(history);for(const s of Object.values(r.systems)){assert.equal(s.status,'not-evaluated');assert.equal(s.winRatePct,null);}});
test('dated native evidence yields strictly later execution and cost-aware return',()=>{const r=attributeIndependentStrategies(history,{evidence:[signal]});assert.equal(r.systems.fourteen.paperTrades,1);assert.equal(r.systems.bazi.status,'not-evaluated');assert.equal(r.records[0].outcome.entryDate,dates[34]);assert.equal(r.records[0].outcome.exitDate,dates[35]);const high=attributeIndependentStrategies(history,{evidence:[signal],feeBps:100,slippageBps:100,sellTaxBps:100});assert.ok(high.records[0].outcome.netReturnPct<r.records[0].outcome.netReturnPct);});
test('reject duplicates, fake provenance and unrecognized strategy',()=>{assert.throws(()=>attributeIndependentStrategies(history,{evidence:[signal,signal]}),/重复/);assert.throws(()=>attributeIndependentStrategies(history,{evidence:[{...signal,provenance:''}]}),/来源/);assert.throws(()=>attributeIndependentStrategies(history,{evidence:[{...signal,system:'invented'}]}),/无效/);});
test('unknown and final-session signals never create fake trades',()=>{const r=attributeIndependentStrategies(history,{evidence:[{...signal,verdict:'unknown'},{...signal,date:dates[39]}]});assert.equal(r.systems.fourteen.paperTrades,0);assert.equal(r.systems.fourteen.winRatePct,null);});
test('offline closure exposes four independent unavailable states without changing ranking',()=>{const r=runOfflineResearchClosure(history);assert.equal(r.strategyAttribution.systems.python.status,'not-evaluated');assert.equal(r.canTrade,false);assert.equal(r.ranking.length,1);});

test('independent attribution rejects adjusted execution prices',()=>{
 assert.throws(()=>attributeIndependentStrategies({...history,priceBasis:'hfq'},{evidence:[signal]}),/未复权/);
});
test('opening locked limits and suspended rows cannot be estimated fills',()=>{
 const locked=structuredClone(history),b=locked.stocks[0].bars[34],prior=locked.stocks[0].bars[33];
 b.open=Math.round(prior.close*110)/100;b.high=b.open+.01;b.low=prior.close;b.close=prior.close;
 assert.equal(attributeIndependentStrategies(locked,{evidence:[signal]}).records[0].outcome.status,'blocked');
 const halted=structuredClone(history);halted.stocks[0].bars[34].suspended=true;
 assert.equal(attributeIndependentStrategies(halted,{evidence:[signal]}).records[0].outcome.status,'blocked');
});
test('a 20 percent board uses the original opening-price gate, not a fixed 10 percent rule',()=>{
 const board=structuredClone(history),stock=board.stocks[0],b=stock.bars[34],prior=stock.bars[33];
 stock.market='chinext';b.open=b.close=b.high=b.low=Math.round(prior.close*110)/100;
 assert.equal(attributeIndependentStrategies(board,{evidence:[signal]}).records[0].outcome.status,'paper-estimate');
});
