'use strict';
const fs=require('fs');
const path=require('path');
const {evaluateMultiStrategy}=require('../src/core/multi-strategy-engine');
const {filterCandidate}=require('../src/core/risk-filter');
const pack=JSON.parse(fs.readFileSync(path.join(__dirname,'../strategies/a-share-strategy-pack.json'),'utf8'));
const result=evaluateMultiStrategy({
 snapshot:{trendScore:75,relativeStrengthScore:70,maAlignmentScore:70,momentumScore:65,closeStrengthScore:65,turnoverQualityScore:60,breakoutScore:68,volumeScore:62,positionScore:65,fundFlowScore:70,liquidityScore:70,riskScore:25,oversoldScore:20,reversalScore:20},
 market:{breadthScore:68,indexTrendScore:72,marketVolumeScore:65,riskScore:30,volatilityScore:42,sentimentScore:70},
 strategies:pack.strategies
});
const risk=filterCandidate({code:'000001',riskScore:25,avgTurnover:1e8},{minTurnover:1e7});
if (!Number.isFinite(result.finalScore) || !risk.pass) throw new Error('strategy smoke failed');
console.log(JSON.stringify({ok:true,finalScore:result.finalScore,regime:result.regime.regime,topDrivers:result.topDrivers.map(x=>x.strategy)}));
