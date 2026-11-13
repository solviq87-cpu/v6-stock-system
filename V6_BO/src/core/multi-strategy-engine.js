'use strict';
const { evaluateStrategy, validMinScore } = require('./strategy-engine');
const { classifyMarket } = require('./market-regime');

const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
// Invalid or negative weights must not reverse score contributions or create negative denominators.
const nonnegative=(v,defaultValue=1)=>v===null||v===undefined||v===''?defaultValue:(Number.isFinite(Number(v))&&Number(v)>=0?Number(v):0);

function scoreStrategy(snapshot, strategy, regimeWeights) {
  const base=evaluateStrategy(snapshot,strategy);
  const family=strategy.family||strategy.name||'default';
  const multiplier=nonnegative(regimeWeights[family],1);
  // Invalid configuration cannot inflate the aggregate score of another passing strategy.
  const normalized=validMinScore(strategy.minScore)
    ? (base.minScore>0?clamp(base.score/base.minScore*100):clamp(base.score)) : 0;
  return {...base,family,strategyWeight:nonnegative(strategy.strategyWeight,1),multiplier,normalized:+normalized.toFixed(2),
    adjusted:+clamp(normalized*multiplier).toFixed(2)};
}

function evaluateMultiStrategy({snapshot={},market={},strategies=[]}={}) {
  const regime=classifyMarket(market);
  const results=strategies
    .filter(s=>s&&Array.isArray(s.rules))
    .map(s=>({name:s.name||s.family||'unnamed',...scoreStrategy(snapshot,s,regime.weights)}));
  const totalWeight=results.reduce((a,r)=>a+r.strategyWeight,0)||1;
  const score=results.reduce((a,r)=>a+r.adjusted*r.strategyWeight,0)/totalWeight;
  const winners=results.filter(r=>r.pass && r.strategyWeight>0 && r.multiplier>0).sort((a,b)=>b.adjusted-a.adjusted);
  const riskPenalty=clamp(n(snapshot.riskScore,0))*0.22;
  const finalScore=clamp(score-riskPenalty);
  return {
    finalScore:+finalScore.toFixed(2),
    regime,
    pass:winners.length>0 && finalScore>=45,
    strategies:results.sort((a,b)=>b.adjusted-a.adjusted),
    topDrivers:winners.slice(0,3).map(r=>({strategy:r.name,score:r.adjusted,hits:r.hits.slice(0,4)})),
    riskPenalty:+riskPenalty.toFixed(2)
  };
}
module.exports={evaluateMultiStrategy};
