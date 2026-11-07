'use strict';
const {evaluateCandidate}=require('../src/strategy/strategy-service');
const r=evaluateCandidate({
 stock:{pctChange:4.2,volumeRatio:1.8,turnoverRate:8,amount:2e8,trendScore:78,relativeStrength:82,capitalScore:70,positionScore:66,riskScore:18},
 market:{breadthScore:70,indexTrendScore:72,marketVolumeScore:68,sentimentScore:65,riskScore:25,volatilityScore:38}
});
if(!Number.isFinite(r.finalScore)) throw new Error('invalid score');
console.log(JSON.stringify({pass:r.pass,score:r.finalScore,regime:r.regime.regime,blocked:r.blocked}));
