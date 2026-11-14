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
    // 严格行情模式下证据必须绑定当前标的；无标的字段的历史本地证据仍兼容。
    const matching={};
    if(trusted){
      for(const [field,proof] of Object.entries(supplied)){
        if(proof&&proof.source===feedQuality.source&&proof.simulated!==true&&proof.mode!=='simulation'&&
           (!proof.code||String(proof.code)===String(stock.code))&&
           (!proof.symbol||String(proof.symbol)===String(stock.code))){
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
  // 批量评分禁止将一个共享 evidence 对象广播给所有股票。
  // 每只股票只能使用自身的 factorEvidence；单股 evaluateCandidate 仍支持显式 evidence。
  const isolatedOptions=factorOptions?.requireEvidence||factorOptions?.requireFeedValidation
    ? {...factorOptions,evidence:undefined} : factorOptions;
  return stocks.map(stock=>evaluateCandidate({stock,market,strategies,factorOptions:isolatedOptions}))
    .sort((a,b)=>Number(b.pass)-Number(a.pass)||b.finalScore-a.finalScore);
}
module.exports={loadPack,evaluateCandidate,rankCandidates};
