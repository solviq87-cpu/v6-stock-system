'use strict';
const fs=require('fs'), path=require('path');
const {normalizeStock}=require('./snapshot-normalizer');
const {applyRiskFilter}=require('./risk-filter');
const {evaluateMultiStrategy}=require('../core/multi-strategy-engine');
const {scoreExtendedFactors,mergeLegacyAndExtended}=require('./extended-factor-engine');
const {evaluatePlaybooks}=require('./research-playbook-engine');

function loadPack(file=path.join(__dirname,'../../strategies/a-share-strategy-pack.json')){
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function evaluateCandidate({stock={},market={},strategies,factorOptions}={}){
  const snapshot=normalizeStock(stock);
  const risk=applyRiskFilter(snapshot);
  const pack=strategies||loadPack();
  const list=Array.isArray(pack)?pack:(pack.strategies||[]);
  const legacy=evaluateMultiStrategy({snapshot,market,strategies:list});
  const result=mergeLegacyAndExtended(legacy,scoreExtendedFactors(stock,undefined,factorOptions||{}));
  const playbookAnalysis=evaluatePlaybooks(stock);
  return {
    ...result,
    pass: risk.pass && result.pass,
    blocked:risk.hardBlock,
    riskFilter:risk,
    playbookAnalysis,
    // 战法作为独立证据展示，不叠加未经回测验证的分数。
    snapshot
  };
}
function rankCandidates({stocks=[],market={},strategies,factorOptions}={}){
  return stocks.map(stock=>evaluateCandidate({stock,market,strategies,factorOptions}))
    .sort((a,b)=>Number(b.pass)-Number(a.pass)||b.finalScore-a.finalScore);
}
module.exports={loadPack,evaluateCandidate,rankCandidates};
