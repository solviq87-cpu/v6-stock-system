'use strict';
const fs=require('fs'), path=require('path');
const {normalizeStock}=require('./snapshot-normalizer');
const {applyRiskFilter}=require('./risk-filter');
const {evaluateMultiStrategy}=require('../core/multi-strategy-engine');

function loadPack(file=path.join(__dirname,'../../strategies/a-share-strategy-pack.json')){
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function evaluateCandidate({stock={},market={},strategies}={}){
  const snapshot=normalizeStock(stock);
  const risk=applyRiskFilter(snapshot);
  const pack=strategies||loadPack();
  const list=Array.isArray(pack)?pack:(pack.strategies||[]);
  const result=evaluateMultiStrategy({snapshot,market,strategies:list});
  return {
    ...result,
    pass: risk.pass && result.pass,
    blocked:risk.hardBlock,
    riskFilter:risk,
    snapshot
  };
}
function rankCandidates({stocks=[],market={},strategies}={}){
  return stocks.map(stock=>evaluateCandidate({stock,market,strategies}))
    .sort((a,b)=>b.finalScore-a.finalScore);
}
module.exports={loadPack,evaluateCandidate,rankCandidates};
