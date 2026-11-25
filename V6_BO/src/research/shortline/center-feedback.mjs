import {createHash} from 'node:crypto';
import research from '../../core/intelligence-research.js';
import {dictionaryVersion,factorDictionary} from '../../../public/nova/shortline/factor-dictionary.mjs';
import {validateCenterCandidate} from '../../../public/nova/shortline/learning.mjs';
import {MODEL,validModel,stable} from '../../../public/nova/shortline/numeric-factors.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw Error(message);};

/** Called under the original archive lock. Neither weights nor validation
 * results are supplied by HTTP, and the original approval reducer is retained. */
export function applyCenterFeedback(state,{day,now=Date.now(),proposalFingerprint,bars=null,calendar=null,marketCalendars={},
  frozenObservations=[],historyCoverage=null,config}={}){
  if(state.scope==='demo'||!Number.isSafeInteger(state.revision)||state.revision<0)fail('中心反馈只接受主研究档案');
  if(typeof proposalFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(proposalFingerprint))fail('中心提案指纹无效，请重新读取');
  const report=research.buildIntelligenceResearch({day,now,archive:{...state,dictionaryVersion},bars,calendar,marketCalendars,
    frozenObservations,historyCoverage,...(config?{config}:{})});
  const {feedback}=report,proposal=feedback.proposal;
  if(!proposal||feedback.proposalFingerprint!==proposalFingerprint)fail('中心提案或原始证据已变化，请重新读取后验证');
  if(proposal.archiveRevision!==state.revision||proposal.dictionaryVersion!==dictionaryVersion)fail('档案或因子词典版本不匹配');
  const baseline=[...(state.versions||[])].reverse().find(row=>row.approvedAt&&row.weights&&row.sampleScope!=='demo');
  if(!baseline||baseline.number!==proposal.baselineVersion)fail('获批权重基线已变化，请重新生成中心提案');
  const baselineEvidence={number:baseline.number,approvedAt:baseline.approvedAt,weights:baseline.weights,
    threshold:baseline.threshold,strategyThresholds:baseline.strategyThresholds,minSupport:baseline.minSupport,
    ...(baseline.numericModel?{numericModel:baseline.numericModel,scoringFingerprint:baseline.scoringFingerprint}:{})};
  if(hash(baselineEvidence)!==proposal.baselineFingerprint)fail('获批权重基线指纹不一致');
  const dictionary=factorDictionary(state.catalog||[]),weights={...baseline.weights},changedFactorIds=[];
  for(const change of proposal.changes){
    if(!dictionary.byCode.has(change.factorId)||!Object.hasOwn(weights,change.factorId)||
        weights[change.factorId]!==change.baselineWeight||!Number.isFinite(change.candidateWeight)||
        change.baselineWeight===0||Math.abs(change.candidateWeight/change.baselineWeight-1)>.08000001)
      fail('中心因子缺少同名词典、已审批权重或超过原调整边界，禁止猜测映射');
    weights[change.factorId]=change.candidateWeight;changedFactorIds.push(change.factorId);
  }
  if(proposal.numericModel){
    if(proposal.factorSchema!==MODEL||!validModel(proposal.numericModel)||!validModel(baseline.numericModel)||
        stable(weights)!==stable(proposal.numericModel.weights)||
        stable(proposal.numericModel.parameters)!==stable(baseline.numericModel.parameters)||
        stable(proposal.numericModel.definitions)!==stable(baseline.numericModel.definitions)||
        proposal.numericModel.adjustment?.parentModelFingerprint!==baseline.numericModel.fingerprint)
      fail('中心数值提案必须沿用同一已批准定义与正交基底，不得用同名标签替换');
  }else if(baseline.numericModel||changedFactorIds.some(id=>id.startsWith('YZ-')))
    fail('YZ数值因子与旧boolean权重语义不兼容，需原五关和人工批准建立数值基线');
  const candidate=validateCenterCandidate(state,{...proposal,now,weights,changedFactorIds,proposalFingerprint});
  return {candidateId:candidate.id,status:candidate.status,proposalFingerprint,baselineVersion:proposal.baselineVersion,
    dictionaryVersion,weightsFingerprint:hash(candidate.weights),steps:candidate.steps,counts:candidate.counts,
    approvalRequired:true,approvalAction:'learn:decision',approvalEndpoint:'/api/research/shortline',
    productionWeightsChanged:false,originalGatesChanged:false,canTrade:false,canNotify:false};
}
