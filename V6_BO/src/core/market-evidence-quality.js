'use strict';
/**
 * Research-only evidence completeness, not price accuracy, source certification,
 * a ranking of vendors, a transaction signal, or a probability.
 * The final 15 points are deliberately unobtainable without an external
 * exchange-grade proof; a perfect parity check alone never grants permissions.
 */
function evaluateMarketEvidence({catalogued,timestampComparable,volumeUnitVerified,
 amountUnitVerified,amountCoverageGapBars,amountComparedBars,comparedBars,discrepancies}){
 const amountComplete=amountUnitVerified&&amountCoverageGapBars===0&&
  amountComparedBars===comparedBars&&comparedBars>0;
 const findings=[];
 if(!catalogued)findings.push('UPSTREAM_IDENTITY_NOT_CATALOGUED');
 if(!timestampComparable)findings.push('OBSERVATION_TIME_NOT_COMPARABLE');
 if(!volumeUnitVerified)findings.push('SHARE_UNIT_NOT_VERIFIED');
 if(!amountComplete)findings.push('TURNOVER_COVERAGE_INCOMPLETE');
 if(discrepancies>0)findings.push('CROSS_SOURCE_DISCREPANCY');
 const evidenceCompletenessScore=Math.min(85,15+10+
  (discrepancies===0?25:0)+(catalogued?15:0)+
  (timestampComparable?10:0)+(volumeUnitVerified?10:0)+(amountComplete?10:0));
 const status=discrepancies>0?'quarantined-conflict':
  findings.length?'incomplete-evidence':'consistent-research-only';
 return {schemaVersion:1,status,evidenceCompletenessScore,
  maxWithoutExternalCertification:85,findings,
  amountCoverageComplete:amountComplete,
  scoreMeaning:'仅表示字段、口径、上游登记、时点与一致性证据覆盖程度，不是行情正确率或价格真实概率',
  independentlyVerified:false,exchangeVerified:false,
  canTrade:false,releaseReady:false};
}
module.exports={evaluateMarketEvidence};
