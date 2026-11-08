'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {historicalExplanations}=require('../src/core/research-explanation-projection');
function history(source='imported'){
 const bars=[];
 for(let i=0;bars.length<46;i++){
  const d=new Date(Date.UTC(2026,0,5+i));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  const value=10+bars.length*.055;
  bars.push({date:d.toISOString().slice(0,10),open:value,high:value+.2,
    low:value-.2,close:value+.06,volume:1000000,amount:11000000});
 }
 return {source,provider:'unit-fixture-research',asOf:bars.at(-1).date,
  stocks:[{symbol:'600001',name:'测试股票',market:'main',bars}]};
}
test('dated imported sample has traced explanations but no official or live candidates',()=>{
 const h=history(),before=structuredClone(h);
 const out=historicalExplanations(h);
 assert.equal(out.mode,'historical-selection-evidence');
 assert.equal(out.status,'evaluated');
 assert.equal(out.dataStatus,'imported-unverified');
 assert.equal(out.canTrade,false);
 assert.equal(out.verifiedLive,false);
 assert.equal(out.officialCandidates,0);
 assert.equal(out.total,1);
 assert.equal(out.candidates.length,1);
 assert.equal(out.candidates[0].historicalOnly,true);
 assert.equal(out.candidates[0].rationale.selection.officialCandidate,false);
 assert.ok(Array.isArray(out.candidates[0].rationale.selection.rules));
 assert.ok(Array.isArray(out.candidates[0].rationale.factors));
 assert.equal(out.candidates[0].rationale.whyUp.confirmedCauses.length,0);
 assert.equal(out.candidates[0].rationale.price.status,'imported-unverified');
 assert.deepEqual(h,before,'must not mutate historical input');
});
test('simulation has no present-day rising attribution and no official watchlist',()=>{
 const out=historicalExplanations(history('fixture'));
 assert.equal(out.dataStatus,'simulated');
 assert.equal(out.candidates.length,1);
 assert.equal(out.candidates[0].rationale.selection.watchEligible,false);
 assert.equal(out.candidates[0].rationale.selection.officialCandidate,false);
 assert.equal(out.candidates[0].rationale.whyUp.observedRise,false);
 assert.equal(out.researchWatchlist.length,0);
});
test('same-day market sector linkage is imported and unverified, never a proven cause',()=>{
 const h=history();
 const observed=Date.parse(h.asOf+'T14:55:00+08:00');
 const market={linkage:{market:{source:'market-fixture',observedAt:observed,
   tradeDate:h.asOf,breadthScore:65,coverage:.91},
   sectors:{'600001':{name:'人工智能',relativeStrengthScore:82,source:'sector-fixture',
     tradeDate:h.asOf,observedAt:observed}}}};
 const out=historicalExplanations(h,{market});
 const reason=out.candidates[0].rationale;
 assert.equal(reason.market.status,'imported-unverified');
 assert.equal(reason.sector.status,'imported-unverified');
 assert.equal(reason.sector.name,'人工智能');
 assert.equal(reason.whyUp.confirmedCauses.length,0);
 assert.ok(reason.whyUp.possibleContributors.some(x=>x.includes('板块')));
});
test('stale market and mismatched sector dates remain unknown',()=>{
 const h=history();
 const observed=Date.parse(h.asOf+'T10:00:00+08:00');
 const market={linkage:{market:{source:'market-fixture',observedAt:observed,
   tradeDate:h.asOf,breadthScore:95,coverage:.95},
   sectors:{'600001':{name:'人工智能',relativeStrengthScore:99,source:'sector-fixture',
     tradeDate:'2025-01-01',observedAt:observed}}}};
 const out=historicalExplanations(h,{market});
 const reason=out.candidates[0].rationale;
 assert.equal(reason.market.status,'unknown');
 assert.equal(reason.sector.status,'unknown');
 assert.ok(reason.whyUp.possibleContributors.every(x=>!x.includes('所属板块相对强度')));
});
test('undated historical bars cannot be presented as dated market selection',()=>{
 const h=history();h.stocks[0].bars.forEach(b=>delete b.date);
 const out=historicalExplanations(h);
 assert.equal(out.status,'not-evaluated');
 assert.equal(out.candidates.length,0);
 assert.equal(out.verifiedLive,false);
});
test('complete workbench integrates additional explanation into existing route result',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/core/complete-workbench.js'),'utf8');
 const route=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.ok(src.includes('selectionEvidence=historicalExplanations'));
 assert.ok(src.includes('strategies:{coverage:native.coverage,details:native.details,replay:native.replay},selectionEvidence'));
 assert.ok(route.includes("if (p === '/api/research/complete-run')"));
 assert.ok(route.includes("if(!requireEditor(res,req.__tok,req))return;"));
});
