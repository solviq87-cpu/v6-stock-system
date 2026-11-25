'use strict';

// A read-only projection of the same original snapshot used by the account
// service. It delegates the actual rules; it never owns a second safety policy.
const {reconcileAccountSnapshot,defensiveStatus}=require('./account-safety-state');
const {aShareCalendarDate}=require('./a-share-calendar');
const VERSION='fayo-original-account-safety-view-1';
const time=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;

function buildAccountSafetyRiskEvidence({book=null,accountId='pool',now=Date.now()}={}) {
  if(!['pool','pre'].includes(accountId)||!time(now))throw Error('原账户安全投影参数无效');
  const known=book?.schemaVersion===1&&Number.isSafeInteger(book.revision)&&book.revision>0&&
    /^[a-f0-9]{64}$/.test(book.fingerprint||'');
  const account={type:'account',id:accountId,label:accountId==='pool'?'A·跟单盘':'B·预选盘'};
  const references={accountRevision:known?book.revision:null,inputVersion:known?book.fingerprint:null,
    projectionVersion:VERSION,authority:'original-paper-account',affectedAction:'new-exposure'};
  let reconciliation=null,defensive=null;const missing=[];
  if(known){
    try{reconciliation=reconcileAccountSnapshot(book,{tradeDate:aShareCalendarDate(now)});}
    catch{missing.push('原账本对账函数本次未返回可核验结果');}
    try{defensive=defensiveStatus(book);}
    catch{missing.push('原防御事件链本次无法核验');}
  }else missing.push('未取得原账户服务校验后的同一账本快照');
  const reconciliationKnown=reconciliation?.accountRevision===references.accountRevision&&
    typeof reconciliation?.newExposureAllowed==='boolean';
  const reconciliationBlocked=reconciliationKnown&&reconciliation.newExposureAllowed===false;
  const last=Array.isArray(book?.defensiveControl?.events)?book.defensiveControl.events.at(-1):null;
  const receiptVerified=Boolean(defensive&&last&&last.state===defensive.state&&last.hash===defensive.receipt&&
    last.at===defensive.changedAt&&time(last.at)&&last.at<=now);
  const defenseBlocked=receiptVerified&&defensive.state==='restricted';
  const approvedRelease=receiptVerified&&defensive.state==='open'&&last.approved===true;
  const releaseConfirmed=approvedRelease&&reconciliationKnown&&reconciliation.newExposureAllowed===true;
  if(!receiptVerified)missing.push('原账户防御事件或原始变更时点缺失；不据此解除已知风险');
  else if(defensive.state==='open'&&!approvedRelease)missing.push('原防御状态缺少明确批准解除的对应回执');
  else if(approvedRelease&&!releaseConfirmed)missing.push('防御审批已记录，但原对账仍未允许新增敞口');
  const authority=(ruleId,ruleVersion,exceeded,available)=>({kind:'effective-rule',source:'original-paper-account',
    observedAt:now,ruleId,ruleVersion,enabled:known,configurationStatus:known?'active':'unknown',
    exceeded:available?exceeded:null});
  const action=(blocked,reason)=>({allowed:blocked?false:null,evidenceStatus:blocked?'available':'unknown',
    checkedAt:now,scope:'new-exposure-only',reason});
  const common={object:account,category:'execution',priceDependent:false,
    checks:['核对同一原账本版本、原对账和防御事件链','撤单与卖出继续逐项经过原权限、T+1、冻结、价格及数量门禁'],
    canTrade:false};
  const risks=[{
    ...common,rootCauseId:'account/reconciliation',
    severity:reconciliationBlocked?'critical':reconciliationKnown?'info':'unknown',
    evidenceStatus:reconciliationKnown?'available':'missing',
    status:reconciliationBlocked?'active':reconciliationKnown?'resolved':'unknown',
    source:'原账户 reconcileAccountSnapshot 同账本计算回执',sourceAt:reconciliationKnown?now:null,
    firstKnowableAt:reconciliationKnown?now:null,
    facts:reconciliationKnown?[
      reconciliationBlocked?'原对账正在阻止新增风险':'原内部对账本次未命中新增风险限制',
      '内部一致性：'+(reconciliation.internallyConsistent?'一致':'不一致'),
      ...reconciliation.reasonCodes,'独立外部托管或券商对账仍未接入']:
      ['原内部对账结果无法评估；保留上次有效风险'],
    impact:'展示原新增风险门禁的实际对账限制；内部一致不等于外部账户已完成对账',
    restrictions:reconciliationBlocked?['原账户阻止新增敞口；不替代原可卖性和撤单核验']:['本投影不授予任何订单执行权限'],
    releaseConditions:['同一原账本取得新的对账回执，newExposureAllowed 为 true；防御审批另行核对'],
    references:{...references,reasonCodes:reconciliation?.reasonCodes||[]},
    authorityEvidence:authority('original-account-reconciliation','original-account-snapshot-schema-1',reconciliationBlocked,reconciliationKnown),
    actionEvidence:action(reconciliationBlocked,reconciliationBlocked?'原对账阻止新增风险；原卖出和撤单仍逐项核验':'仅核对原内部对账；完整交易资格尚未核验'),
    recoveryEvidence:reconciliationKnown&&!reconciliationBlocked?{kind:'account-reconciled',confirmed:true,
      checkedAt:now,source:'original-account-reconciliation',inputVersion:references.inputVersion}:null
  },{
    ...common,rootCauseId:'account/defensive-control',
    severity:defenseBlocked?'critical':releaseConfirmed?'info':'unknown',
    evidenceStatus:defenseBlocked||releaseConfirmed?'available':'missing',
    status:defenseBlocked?'active':releaseConfirmed?'resolved':'unknown',
    source:'原账户 defensiveControl 事件链及批准回执',sourceAt:receiptVerified?defensive.changedAt:null,
    firstKnowableAt:receiptVerified?defensive.changedAt:null,
    facts:defenseBlocked?['原账户防御限制已锁存；亏损指标恢复不等于批准解除',defensive.reason,...defensive.reasonCodes]:
      releaseConfirmed?['原账户已取得明确批准解除回执，且同一账本对账通过','原报价、权限和新意图仍须重新核验']:
      ['防御解除条件无法确认；保留已知限制',...missing],
    impact:'限制新增风险，保留原可执行处置；该状态不是个股下跌或策略失效的预测',
    restrictions:defenseBlocked?['原账户继续阻止新增敞口；撤单、卖出及结算各按原规则核验']:['本投影不授予交易权限，也不恢复已过期计划'],
    releaseConditions:['原防御链最新事件为 open 且 approved=true、回执哈希一致，并且同一账本 newExposureAllowed=true'],
    references:{...references,defensiveReceipt:receiptVerified?defensive.receipt:null,
      defensiveState:defensive?.state||null,approvedRelease},
    authorityEvidence:authority('original-account-defensive-control','original-defensive-control-v1',defenseBlocked,defenseBlocked||releaseConfirmed),
    actionEvidence:action(defenseBlocked,defenseBlocked?'原防御阻止新增风险；原允许的卖出和撤单仍须逐项核验':'防御解除不等于订单执行许可'),
    recoveryEvidence:releaseConfirmed?{kind:'original-defensive-release',confirmed:true,checkedAt:defensive.changedAt,
      source:'original-account-defensive-control',receipt:defensive.receipt,inputVersion:references.inputVersion}:null
  }];
  return {schemaVersion:1,version:VERSION,accountId,accountRevision:references.accountRevision,
    inputVersion:references.inputVersion,observedAt:now,reconciliation,
    defensive:defensive?{...defensive,receiptVerified,approvedRelease,releaseConfirmed}:null,
    risks,missing,readOnly:true,canTrade:false,writesAccount:false};
}

module.exports={buildAccountSafetyRiskEvidence,VERSION};
