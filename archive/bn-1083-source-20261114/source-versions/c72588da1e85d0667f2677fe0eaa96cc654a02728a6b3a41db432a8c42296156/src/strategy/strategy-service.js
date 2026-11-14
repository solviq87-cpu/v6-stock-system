'use strict';
const fs=require('fs'), path=require('path');
const {normalizeStock}=require('./snapshot-normalizer');
const {applyRiskFilter}=require('./risk-filter');
const {evaluateMultiStrategy}=require('../core/multi-strategy-engine');
const {scoreExtendedFactors,mergeLegacyAndExtended}=require('./extended-factor-engine');
const {evaluatePlaybooks}=require('./research-playbook-engine');
const {validateFeed}=require('./feed-quality');

function loadPack(file=path.join(__dirname,'../../strategies/a-share-strategy-pack.json')){
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function evaluateCandidate({stock={},market={},strategies,factorOptions}={}){
  const snapshot=normalizeStock(stock);
  const risk=applyRiskFilter(snapshot);
  const pack=strategies||loadPack();
  const list=Array.isArray(pack)?pack:(pack.strategies||[]);
  const legacy=evaluateMultiStrategy({snapshot,market,strategies:list});
  // 可选严格行情门禁：没有真实、有效且新鲜的行情，不允许扩展因子参与融合。
  // 原始策略与风险过滤仍按旧逻辑计算，绝不静默改写原始阈值。
  const opts=factorOptions||{};
  let feedQuality=null;
  let evidenceOptions=opts;
  if(opts.requireFeedValidation){
    feedQuality=validateFeed(stock,{now:opts.asOf??Date.now(),maxAgeMs:opts.maxAgeMs??900000,requireReal:true});
    const trusted=feedQuality.usable&&feedQuality.fresh&&!feedQuality.simulated;
    const supplied=opts.evidence||stock.factorEvidence||{};
    const matching={};
    if(trusted){
      for(const [field,proof] of Object.entries(supplied)){
        if(proof&&proof.source===feedQuality.source&&proof.simulated!==true&&proof.mode!=='simulation'){
          const t=typeof proof.timestamp==='number'?proof.timestamp:Date.parse(proof.timestamp);
          if(Number.isFinite(t)&&t<=feedQuality.timestamp+60000&&t<=Number(opts.asOf??Date.now())+60000&&Number(opts.asOf??Date.now())-t<=Number(opts.maxEvidenceAgeMs??opts.maxAgeMs??900000))matching[field]=proof;
        }
      }
    }
    evidenceOptions={...opts,requireEvidence:true,evidence:matching};
  }
  const result=mergeLegacyAndExtended(legacy,scoreExtendedFactors(stock,undefined,evidenceOptions));
  const playbookAnalysis=evaluatePlaybooks(stock);
  const feedBlocked=Boolean(opts.requireFeedValidation&&opts.blockUntrustedCandidates&&(!feedQuality.usable||!feedQuality.fresh||feedQuality.simulated));
  return {
    ...result,
    pass: !feedBlocked && risk.pass && result.pass,
    ...(opts.requireFeedValidation?{feedBlocked}:{}),
    blocked:risk.hardBlock,
    riskFilter:risk,
    ...(opts.requireFeedValidation?{feedQuality}:{}),
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
