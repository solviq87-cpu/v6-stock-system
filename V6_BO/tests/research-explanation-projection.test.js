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
 assert.ok(src.includes('const strategies={coverage:native.coverage,details:native.details,replay:native.replay}'));
 assert.ok(src.includes('strategies,selectionEvidence,eightPointFlow'));
 assert.ok(route.includes("if (p === '/api/research/complete-run')"));
 assert.ok(route.includes("if(!requireEditor(res,req.__tok,req))return;"));
});

function universeSample(){
 const h=history(),s=h.stocks[0],last=s.bars.at(-1),price=Math.round(s.bars.at(-2).close*110)/100;
 Object.assign(s,{isST:false,limitPct:10,sealQualityScore:90,auctionQualityScore:90,sectorHeatScore:90});
 for(const k of ['trendScore','relativeStrengthScore','maAlignmentScore','momentumScore','closeStrengthScore','turnoverQualityScore','breakoutScore','volumeScore','positionScore','fundFlowScore','liquidityScore','oversoldScore','reversalScore'])s[k]=90;
 s.riskScore=10;
 Object.assign(last,{open:price,high:price,low:price,close:price});
 h.universeHistory=[{symbol:s.symbol,from:s.bars[0].date,through:h.asOf,eligible:true,
  source:'isolated-membership',knownAt:'2025-12-31T00:00:00Z'}];
 return h;
}
function master(overrides={}){return {source:'isolated-security-master',dataVersion:'fixture-v1',
 knownAt:'2025-12-31T00:00:00Z',availableAt:'2025-12-31T01:00:00Z',listedOn:'2000-01-01',delistedOn:null,
 board:'main',isST:false,suspended:false,limitPct:10,priceBasis:'unadjusted',corporateActionStatus:'none',actionIds:[],
 feeVersion:'fixture-fee-v1',evidenceHash:'a'.repeat(64),...overrides};}
test('历史股票池已排除的证券保留规则证据但不进入研究观察池',()=>{
 const h=universeSample(),allowed=historicalExplanations(h);assert.equal(allowed.researchWatchlist.length,1);
 assert.equal(allowed.candidates[0].historicalModelPassed,true);assert.equal(allowed.modelPassedCount,1);
 h.universeHistory[0].eligible=false;const before=structuredClone(h),out=historicalExplanations(h),c=out.candidates[0];
 assert.ok(c.rationale.selection.rules.length>0);assert.equal(c.rationale.selection.watchEligible,false);
 assert.equal(c.rationale.pointInTimeUniverse.eligible,false);assert.equal(c.rationale.pointInTimeUniverse.reason,'NOT_IN_POINT_IN_TIME_UNIVERSE');
 assert.equal(c.historicalModelPassed,false);assert.equal(out.modelPassedCount,0);assert.equal(out.researchWatchlist.length,0);
 assert.equal(out.canTrade,false);assert.deepEqual(h,before);
});
test('股票池首次可知时点按原历史收盘截点核对，不使用之后的纳入信息',()=>{
 const h=universeSample(),row=h.universeHistory[0];row.knownAt=h.asOf+'T15:00:00+08:00';
 assert.equal(historicalExplanations(h).researchWatchlist.length,1);
 row.knownAt=h.asOf+'T15:00:00.001+08:00';const out=historicalExplanations(h);
 assert.equal(out.researchWatchlist.length,0);assert.equal(out.candidates[0].rationale.pointInTimeUniverse.reason,'NO_POINT_IN_TIME_MEMBERSHIP');
 row.knownAt='2025-12-31T00:00:00Z';row.through=h.stocks[0].bars.at(-2).date;
 assert.equal(historicalExplanations(h).researchWatchlist.length,0);
});
test('证券主数据的迟到、ST、停牌及退市状态分别限制历史观察资格',()=>{
 for(const [change,reason] of [
  [{availableAt:'2026-03-31T00:00:00Z'},'SECURITY_MASTER_NOT_AVAILABLE'],
  [{isST:true},'HISTORICAL_ST'],[{suspended:true},'HISTORICAL_SUSPENSION'],
  [{delistedOn:'2026-03-01'},'DELISTED']]){
  const h=universeSample(),row=h.universeHistory[0];row.eligible=false;row.securityMaster=master(change);
  const out=historicalExplanations(h);assert.equal(out.researchWatchlist.length,0);
  assert.equal(out.candidates[0].rationale.pointInTimeUniverse.reason,reason);
 }
 const h=universeSample();h.universeHistory[0].securityMaster=master();
 const good=historicalExplanations(h);assert.equal(good.researchWatchlist.length,1);
 assert.equal(good.candidates[0].rationale.pointInTimeUniverse.verified,false);
});
test('每只证券按自身历史股票池身份核对，缺记录不借用其他证券资格',()=>{
 const h=universeSample(),second=structuredClone(h.stocks[0]);second.symbol='600002';h.stocks.push(second);
 const out=historicalExplanations(h);assert.deepEqual(out.researchWatchlist.map(c=>c.symbol),['600001']);
 const c=out.candidates.find(c=>c.symbol==='600002');assert.equal(c.rationale.selection.watchEligible,false);
 assert.equal(c.rationale.pointInTimeUniverse.reason,'NO_POINT_IN_TIME_MEMBERSHIP');
});
test('没有历史股票池的旧研究保留未知，不伪造身份认证',()=>{
 const h=universeSample();delete h.universeHistory;const out=historicalExplanations(h),e=out.candidates[0].rationale.pointInTimeUniverse;
 assert.equal(out.researchWatchlist.length,1);assert.equal(e.declared,false);assert.equal(e.verified,false);
 assert.equal(out.verifiedLive,false);assert.equal(out.canTrade,false);
});
test('历史解释复用原股票池校验，重叠及非法身份不能绕过直接调用',()=>{
 const h=universeSample();h.universeHistory.push({...h.universeHistory[0]});
 assert.throws(()=>historicalExplanations(h),/重叠/);
 h.universeHistory.pop();h.universeHistory[0].symbol=600001;assert.throws(()=>historicalExplanations(h),/证券身份/);
});
