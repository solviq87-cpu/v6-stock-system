'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalog,evaluateOpenSourceRules}=require('../src/strategy/open-source-research-signals');
const {historicalExplanations}=require('../src/core/research-explanation-projection');
function sample(price=10.5,source='imported'){
 const bars=[];
 for(let i=0;bars.length<50;i++){
  const d=new Date(Date.UTC(2026,0,5+i));if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  const close=bars.length===49?price:10+(bars.length%2?.1:-.1);
  bars.push({date:d.toISOString().slice(0,10),open:close,high:close+.2,
    low:close-.2,close,volume:bars.length===49?2000000:1000000,amount:close*1000000});
 }
 return {source,asOf:bars.at(-1).date,stocks:[{symbol:'600001',name:'研究股票',market:'main',bars}]};
}
const result=(h,options)=>evaluateOpenSourceRules(h.stocks[0],options);
test('public research catalog has source citations, bounded daily rules and no verified performance',()=>{
 assert.equal(catalog.length,2);
 assert.ok(catalog.every(x=>x.source.startsWith('https://')&&x.minBars>=31&&x.validatedPerformance===false));
});
test('Boll CCI ATR and ATR RSI detect a supplied close breakout and preserve input',()=>{
 const h=sample(10.5),original=structuredClone(h),r=result(h);
 assert.deepEqual(r.strategies.map(x=>x.status),['candidate','candidate']);
 assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);assert.equal(r.verifiedLive,false);
 assert.equal(r.strategies[0].metrics.close,10.5);
 assert.ok(r.strategies[0].metrics.priorBollUpper<10.5);
 assert.ok(r.strategies[0].metrics.cci14>100);
 assert.ok(r.strategies[1].metrics.rsi5Previous<=55);
 assert.ok(r.strategies[1].metrics.rsi5>55);
 assert.deepEqual(h,original);
});
test('independent thresholds give distinct hit lists, no fictional universal match',()=>{
 const x=result(sample(10.1));
 assert.equal(x.strategies[0].status,'not_matched');
 assert.equal(x.strategies[1].status,'candidate');
 assert.ok(x.strategies[0].reasons.some(r=>r.startsWith('未通过：')));
 const noVolume=sample(10.5);noVolume.stocks[0].bars.at(-1).volume=1000000;
 assert.equal(result(noVolume).strategies[0].status,'not_matched');
});
test('invalid, undated mix and incomplete data do not become zeros or buy signals',()=>{
 const mutations=[
  s=>s.bars.splice(0,23),
  s=>s.bars.at(-1).close=null,
  s=>s.bars.at(-1).complete=false,
  s=>delete s.bars.at(-1).date,
  s=>s.bars.at(-1).date=s.bars.at(-2).date,
  s=>s.bars.at(-1).high=s.bars.at(-1).low-.1,
 ];
 for(const change of mutations){
  const s=sample().stocks[0];change(s);
  const x=evaluateOpenSourceRules(s);
  assert.ok(x.strategies.every(r=>r.status==='insufficient_data'),JSON.stringify(x));
 }
});
test('ST, halt and zero-volume on dated last bar block candidate signals',()=>{
 for(const mutate of [s=>s.isST=true,s=>s.suspended=true,
   s=>s.bars.at(-1).isST=true,s=>s.bars.at(-1).suspended=true,
   s=>s.bars.at(-1).volume=0]){
  const h=sample();mutate(h.stocks[0]);const x=result(h);
  assert.ok(x.strategies.every(r=>r.status==='risk_blocked'));
 }
});
test('risk-off market keeps technical research signals while withholding trade authorization',()=>{
 const x=result(sample(10.5),{marketRisk:'risk_off'});
 assert.equal(x.marketRisk,'risk_off');
 assert.ok(x.strategies.every(r=>r.status==='candidate'));
 assert.ok(x.strategies.every(r=>r.marketWarning.includes('弱市')));
 assert.equal(x.canTrade,false);
});
test('historical integrated research adds real computed rule IDs to strategy filters',()=>{
 const h=sample(10.5),report=historicalExplanations(h);
 assert.equal(report.candidates.length,1);
 const card=report.candidates[0],ids=card.rationale.selection.rules.map(r=>r.id);
 assert.ok(ids.includes('opensource:vnpy_boll_cci_atr'));
 assert.ok(ids.includes('opensource:vnpy_atr_rsi'));
 assert.ok(card.rationale.openSourceResearch.strategies.some(r=>r.status==='candidate'));
 assert.equal(card.rationale.selection.officialCandidate,false);
 assert.equal(report.officialCandidates,0);
 assert.equal(report.researchWatchlist.length,1);
 assert.ok(report.researchWatchlist[0].matchedRules.some(r=>r.id==='opensource:vnpy_boll_cci_atr'));
 assert.equal(report.openSourceCatalog.length,2);
});
test('historical simulated source stays excluded from research watchlist',()=>{
 const report=historicalExplanations(sample(10.5,'fixture'));
 assert.ok(report.candidates[0].rationale.selection.rules.some(x=>x.id.startsWith('opensource:')));
 assert.equal(report.candidates[0].rationale.selection.watchEligible,false);
 assert.equal(report.researchWatchlist.length,0);
});
