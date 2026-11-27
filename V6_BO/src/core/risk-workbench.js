'use strict';

// A common presentation contract over existing authority/evidence readers. No
// caller of this module can submit an order, change a rule, or repair a ledger.
const crypto = require('node:crypto');
const {validateEquityEvidence} = require('./account-equity-evidence');
const {riskState,copyStateEvidence,resolutionCheck,reductionCheck}=require('./risk-state-contract');
const VERSION = 'fayo-risk-workbench-20261126-v1';
const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const time = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const text = value => typeof value === 'string' ? value.slice(0,600) : '';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SEVERITY = {critical:0,warning:1,unknown:2,info:3};
const CATEGORIES = ['data','market','stock','portfolio','strategy','execution','system'];
const REASONS={QUOTE_SOURCE_CONFLICT:'报价来源冲突',QUOTE_MISSING:'缺少逐票报价',QUOTE_STALE:'原始报价已过期',
  POSITION_COST_BASIS_MISSING:'持仓成本证据缺失',POSITION_LOT_QUANTITY_UNVERIFIED:'持仓批次数量未核对',
  POSITION_LOT_SELLABILITY_UNVERIFIED:'可卖批次日期未知',FROZEN_SELL_QUANTITY_UNVERIFIED:'冻结数量证据缺失',
  FROZEN_SELL_QUANTITY_CONFLICT:'冻结数量与可卖数量冲突',FILL_CASH_EVIDENCE_UNVERIFIED:'成交现金变动未核对',
  CORPORATE_CASH_EVIDENCE_UNVERIFIED:'公司行为权益变动未核对',UNRECONCILED_CAPITAL_CHANGE:'存在无法核对的资金变动',
  CLASSIFICATION_MISSING:'缺少当时有效的题材分类',CLASSIFICATION_SOURCE_CONFLICT:'分类来源冲突',
  CURRENT_POSITION_VALUATION_MISSING:'持仓当前估值缺失',SELLABLE_QUANTITY_UNVERIFIED:'可卖数量尚未核对',
  OBSERVATION_GAP:'权益观察时段缺档',VALUATION_OR_CASH_GAP:'估值或资金变动证据缺档',OBSERVATION_NOT_CURRENT:'权益观察尚未更新到当前时点'};
function missingText(value){
  const code=typeof value==='string'?value:value?.code;
  const message=REASONS[code]||text(value?.message||value?.reason)||text(code);
  return [value?.symbol,message].filter(Boolean).join(' · ');
}

function boundedSummary(row) {
  const coverage={};
  for(const field of ['facts','restrictions','checks','releaseConditions']){
    const all=list(row[field]);coverage[field]={total:all.length,shown:all.length>40?39:all.length,complete:all.length<=40};
    if(all.length>40)row[field]=[...all.slice(0,39),'另有 '+(all.length-39)+' 条，请展开对应完整证据。'];
  }
  return {...row,summaryCoverage:coverage};
}

function typedRiskRow(row,now){
  let state=riskState(row,now);
  if(row.status==='resolved'&&state.assessmentState!=='not-triggered'){
    row={...row,status:'unknown'};state=riskState(row,now);
  }
  return {...row,...state};
}
function riskRow(input,now=Date.now()) {
  const rootCauseId = text(input.rootCauseId);
  if (!rootCauseId) throw Error('风险必须保留根因标识');
  const row={
    id: 'risk-' + hash([rootCauseId,input.object?.type,input.object?.id]).slice(0,24),rootCauseId,
    category:CATEGORIES.includes(input.category)?input.category:'system',
    object:input.object || {type:'system',id:'runtime',label:'系统'},
    severity:Object.hasOwn(SEVERITY,input.severity)?input.severity:'unknown',
    evidenceStatus:input.evidenceStatus || 'unknown',executionStatus:input.executionStatus || 'not-applicable',
    facts:list(input.facts).map(text).filter(Boolean),source:text(input.source)||'缺少来源',sourceAt:time(input.sourceAt),
    impact:text(input.impact)||'证据不足，影响尚不能完整判断',
    restrictions:list(input.restrictions).map(text).filter(Boolean),checks:list(input.checks).map(text).filter(Boolean),
    releaseConditions:list(input.releaseConditions).map(text).filter(Boolean),
    status:['active','resolved','unknown'].includes(input.status)?input.status:'unknown',
    references:input.references || {},priceDependent:input.priceDependent===true,
    followUp:input.followUp || '保留观察；新证据由原后端重新核验',canTrade:false,
    ...copyStateEvidence(input)
  };
  return typedRiskRow(row,now);
}

function planRootCause(planId,kind) { return 'plan/'+planId+'/'+kind; }
function riskForPlanAlert(alert,now=Date.now()) {
  return riskRow({rootCauseId:planRootCause(alert.planId,alert.kind),category:'execution',
    object:{type:'security',id:alert.code,label:alert.name||alert.code},
    severity:alert.kind==='stop'?'critical':alert.kind==='target'?'warning':'info',
    evidenceStatus:'available',executionStatus:alert.availability==='allowed'?'allowed':alert.availability==='blocked'?'condition-triggered':'unknown',
    facts:[({entry:'已观察到进入计划买区',stop:'已观察到触及计划止损',target:'已观察到触及计划目标'})[alert.kind]||'计划条件观察',
      finite(alert.price)?'原始报价 '+alert.price+' 元':'价格证据缺失',alert.reason],
    source:alert.source,sourceAt:alert.quoteAt,impact:'计划条件已触发；观察、提交和成交需要分别核对',
    restrictions:[alert.reason||'仍须通过原账户执行门禁','计划止损或目标价不承诺为成交价'],
    checks:['检查原计划、可卖数量、冻结、交易时段、报价和流动性','查看原订单及成交回执'],
    releaseConditions:['取得同一计划的新鲜观察或权威结算证据；缺档不解除'],
    status:'active',priceDependent:true,actionEvidence:{allowed:alert.availability==='allowed'?true:alert.availability==='blocked'?false:null,
      reason:alert.reason,evidenceStatus:['allowed','blocked'].includes(alert.availability)?'available':'missing',checkedAt:alert.quoteAt},
    references:{planId:alert.planId,observationId:alert.observationId,
      alertId:alert.id,entryEventId:alert.entryEventId||null,kind:alert.kind}
  },now);
}

function verifiedExit(item,now){
  const e=item.execution;
  return item.status==='filled'&&!!text(item.entryEventId)&&item.constraints?.remainingQuantity===0&&
    item.continueObserving===false&&e?.evidenceStatus==='available'&&e.allowed===false&&e.checkedAt===now&&
    !!time(item.sourceAt)&&item.sourceAt<=now&&list(item.fills).some(fill=>fill?.source==='original-paper-ledger'&&
      fill.executionAt===item.sourceAt&&Number.isSafeInteger(fill.quantity)&&fill.quantity>0)&&
    !list(item.orders).some(order=>order?.evidenceStatus==='conflict');
}
function verifiedCondition(item,now){
  const c=item.condition,p=item.constraints?.price,q=item.constraints?.remainingQuantity;
  if(!text(item.planId)||!['observing','condition-triggered','allowed','partially-filled','submitted','failed'].includes(item.status)||
    !Number.isSafeInteger(q)||q<0||!c||!p||!time(c.quoteAt)||c.quoteAt>now||now-c.quoteAt>15000||
    c.observedAt!==now||!text(c.source)||c.source!==p.source||c.quoteAt!==p.quoteAt||
    !finite(c.price)||c.price<=0||c.price!==p.current||
    !finite(p.stop)||p.stop<=0||!finite(p.target)||p.target<=p.stop||
    (q>0?!text(item.entryEventId):!!item.entryEventId))return false;
  const expected=q>0?(c.price<=p.stop?'stop':c.price>=p.target?'target':null):null;
  return expected?c.status==='triggered'&&c.kind===expected:c.status==='not-triggered'&&c.kind===null;
}
function supersedesAlert(item,alert,now){
  if(item.planId!==alert.planId||item.code!==alert.code||
    (item.entryEventId??null)!==(alert.entryEventId??null)&&!(alert.kind==='entry'&&alert.entryEventId==null))return false;
  return verifiedExit(item,now)&&item.sourceAt>=alert.quoteAt||
    verifiedCondition(item,now)&&item.condition.quoteAt>alert.quoteAt;
}
function buildRiskWorkbench({accountId='pool',now=Date.now(),equity=null,equityHistory=null,rules=null,actions=null,
  stress=null,research=null,market={},system={},classifications=[],strategy=null,alerts=null,planAlerts=[],accountSafety=null}={}) {
  if(!['pool','pre'].includes(accountId)||!Number.isSafeInteger(now)||now<=0)throw Error('风险工作台账户或时钟无效');
  for(const item of [equity,equityHistory,rules,actions,stress,alerts,accountSafety])if(item?.accountId&&item.accountId!==accountId)
    throw Error('风险子报告与原账户不一致');
  for(const item of [equityHistory,stress,alerts])if(equity?.accountEpoch&&item?.accountEpoch&&item.accountEpoch!==equity.accountEpoch)
    throw Error('风险子报告与原账户期间不一致');
  if(equity){
    validateEquityEvidence(equity);
    if(equity.observedAt!==now)throw Error('当前风险报告必须使用同一时点的权益证据，历史观察不能重新标为当前');
    for(const item of [rules,actions])if(item){
      if(item.accountId!==accountId||item.accountRevision!==equity.source.accountRevision||
          item.accountEpoch!==equity.accountEpoch||
          item.authoritySnapshotFingerprint!==equity.source.snapshotFingerprint)
        throw Error('风险规则或动作与原账户快照不一致');
    }
    if(stress&&(stress.equityEvidenceId!==equity.fingerprint||
        stress.authoritySnapshotFingerprint!==equity.source.snapshotFingerprint||stress.asOf!==equity.observedAt))
      throw Error('压力结果与同一权益证据不一致');
  }
  for(const item of [rules,actions,stress])if(item&&item.generatedAt!==now)
    throw Error('当前风险子报告时点不一致');
  const risks=[],add=input=>risks.push(riskRow(input,now));
  const account={type:'account',id:accountId,label:accountId==='pool'?'A·跟单盘':'B·预选盘'};
  if(accountSafety?.accountRevision!=null&&equity?.source&&
    (accountSafety.accountRevision!==equity.source.accountRevision||accountSafety.inputVersion!==equity.source.snapshotFingerprint))
    throw Error('原账户安全证据与权益证据不是同一权威账本快照');
  for(const row of list(accountSafety?.risks)){
    if(!['account/reconciliation','account/defensive-control'].includes(row.rootCauseId)||row.object?.id!==accountId)
      throw Error('原账户安全风险对象不一致');
    add(row);
  }
  const equityComplete=equity?.status==='complete';
  const valuationQuoteTimes=list(equity?.positions).map(row=>time(row.quote?.quoteAt));
  const valuationAt=valuationQuoteTimes.length?(valuationQuoteTimes.every(Boolean)?Math.min(...valuationQuoteTimes):null):equity?.observedAt;
  add({rootCauseId:'account/valuation',category:'portfolio',object:account,
    severity:equityComplete?'info':'unknown',evidenceStatus:equityComplete?'available':equity?.status==='partial'?'partial':'missing',
    facts:equityComplete?['当前权益 '+equity.equity+' 元；持仓估值覆盖已核对']:
      ['当前精确权益未知',...list(equity?.missing).map(missingText)],source:'原权威模拟账户及逐票原始报价',sourceAt:valuationAt,
    impact:'权益、浮盈亏和组合风险仅覆盖已核实的账户与报价',
    restrictions:equityComplete?[]:['暂停依赖缺失或失效估值的新判断','不得用陈旧估值推导自动清仓'],
    checks:['核对现金、逐票报价时点和估值覆盖缺口'],releaseConditions:['原账户可读且全部剩余持仓取得可用原始报价'],
    status:equityComplete?'resolved':'unknown',priceDependent:true});
  for(const p of list(equity?.positions)) {
    const good=finite(p.price)&&p.evidenceStatus==='available';
    add({rootCauseId:'quote/'+p.symbol,category:'data',object:{type:'security',id:p.symbol,label:p.symbol},
      severity:good?'info':'unknown',evidenceStatus:good?'available':p.evidenceStatus||'missing',
      facts:good?['持仓原始报价 '+p.price+' 元']:list(p.reasons).length?p.reasons.map(missingText):['该持仓没有当前可用报价'],
      source:p.quote?.quoteSource||p.quote?.source||p.quote?.provider,sourceAt:p.quote?.quoteAt,
      impact:'该持仓估值与依赖实时价格的风险判断受影响',restrictions:good?[]:['不得借用接收时刻、旧价或其他周期价格触发退出'],
      checks:['核对原始报价、来源及冲突回执'],releaseConditions:['同标的原始报价通过原门禁且冲突已核对'],
      status:good?'resolved':'unknown',priceDependent:true,references:{kind:'position-valuation'}});
  }
  const quoteCounts=research?.market?.quotes;
  add({rootCauseId:'market/evidence',category:'market',object:{type:'market',id:'A-share',label:'A股市场'},
    evidenceStatus:quoteCounts?.total?'partial':'missing',severity:'unknown',
    facts:[quoteCounts?'逐票近期 '+quoteCounts.recent+' / '+quoteCounts.total+'；近期不等于来源已认证':'尚无完整市场逐票证据',
      ...list(research?.missing).filter(x=>x.domain==='market').map(x=>x.message)],
    source:'原市场风险证据',sourceAt:research?.market?.receivedAt,
    impact:'市场风险结论的覆盖和来源认证尚有限制',restrictions:['数据不足保持未知；不以缺数判定安全'],
    checks:['展开市场统计范围与逐票原始时点'],releaseConditions:['取得完整、同口径、可校验的市场证据'],status:'unknown'});
  for(const conflict of list(market.conflicts)) {
    // A new projection time cannot renew the original diagnostic observation.
    const at=conflict.checkedAt!=null?(time(conflict.checkedAt)||Date.parse(conflict.checkedAt)):time(conflict.quoteAt);
    if(!/conflict|ambiguous/.test(conflict.status||''))continue;
    const fresh=finite(at)&&at<=now&&now-at<=15000;
    add({rootCauseId:'quote/'+conflict.code,category:'data',object:{type:'security',id:conflict.code,label:conflict.code},
      evidenceStatus:fresh?'conflict':'stale',severity:fresh?'warning':'unknown',facts:['多源价格或时点核对：'+conflict.status],
      source:'原独立来源报价诊断',sourceAt:at,impact:'来源冲突尚未取得可用一致性证据',
      restrictions:['暂停消费该次冲突数据的新判断','保留原交易门禁'],checks:['核对各供应商原始价、时点与统计口径'],
      releaseConditions:['新的独立报价回执通过原一致性校验'],status:fresh?'active':'unknown',priceDependent:true,
      references:{kind:'source-consensus'}});
  }
  // Persisted incidents need positive evidence of resolution. In particular,
  // disappearance from a diagnostic cache and absence of a holding mean
  // different things; neither proves independent sources agree again.
  for(const group of list(alerts?.groups).filter(group=>group.rootCauseId?.startsWith('quote/'))){
    const code=group.rootCauseId.slice('quote/'.length);
    if(!/^\d{6}$/.test(code))continue;
    const previous=list(group.risks),hadConsensus=previous.some(row=>row.references?.kind==='source-consensus'||
      row.source==='原独立来源报价诊断'||list(row.sources).some(source=>source.source==='原独立来源报价诊断'));
    const diagnostic=list(market.conflicts).find(row=>row?.code===code);
    const currentConflict=list(market.conflicts).some(row=>row?.code===code&&/conflict|ambiguous/.test(row.status||''));
    if(hadConsensus&&group.status==='resolved')continue;
    if(hadConsensus&&!currentConflict){
      let gate=null;
      try{gate=require('./intelligence-research').decisionCrosscheckGate(diagnostic,{code,day:equity?.day||new Date(now+28800000).toISOString().slice(0,10),now});}catch{}
      const clear=gate?.status==='observed-agreement'&&gate.canAdmit===true&&diagnostic?.status==='sources-agree-unverified';
      const checkedAt=typeof diagnostic?.checkedAt==='number'?diagnostic.checkedAt:Date.parse(diagnostic?.checkedAt||'');
      add({rootCauseId:group.rootCauseId,category:'data',object:{type:'security',id:code,label:code},
        severity:clear?'info':'unknown',evidenceStatus:clear?'available':'missing',
        facts:clear?['新的原多源回执通过既有一致性检查；来源认证及交易门禁仍独立保留']:
          ['此前来源冲突尚无新的完整一致性回执；单源价格恢复或诊断消失不表示冲突已解除'],
        source:'原独立来源报价诊断',sourceAt:clear?checkedAt:null,
        impact:clear?'本次已核对的来源分歧解除；不新增报价使用权限':'来源冲突的后续状态未知',
        restrictions:['沿用原数据与执行门禁，不以缺失回执恢复依赖冲突数据的新判断'],
        checks:['核对同一标的的独立供应商、原始报价时点与原一致性结果'],
        releaseConditions:['新的完整多源回执通过既有一致性检查'],status:clear?'resolved':'unknown',
        priceDependent:true,references:{kind:'source-consensus',sourceEvidence:gate?.sourceEvidence||[]}});
      continue;
    }
    const positionOnly=previous.length>0&&previous.every(row=>row.references?.kind==='position-valuation')&&!hadConsensus;
    const activeSymbols=rules?.occupancy?.activeOrderSymbols;
    if(!positionOnly||!equity||!Array.isArray(activeSymbols)||activeSymbols.includes(code)||
        list(equity.positions).some(position=>position.symbol===code&&position.quantity>0)||currentConflict||
        risks.some(row=>row.rootCauseId===group.rootCauseId))continue;
    add({rootCauseId:group.rootCauseId,category:'data',object:{type:'security',id:code,label:code},
      severity:'info',evidenceStatus:'available',facts:['原权威账户已无该标的持仓或未完成委托，持仓估值缺口不再适用'],
      source:'原权威账户快照',sourceAt:equity.observedAt,
      impact:'只解除该账户持仓估值的适用范围，不证明市场报价、来源或其他风险已恢复',
      restrictions:['原市场来源及交易门禁保持；重新持有或挂单须重新核验'],
      checks:['核对原成交、当前持仓及活动委托'],
      releaseConditions:['同一账户期间的权威快照证明该标的没有剩余持仓和活动委托'],
      status:'resolved',priceDependent:false,references:{kind:'position-valuation',accountRevision:equity.source.accountRevision}});
  }
  if(!rules)add({rootCauseId:'account/policy',category:'system',object:account,severity:'unknown',evidenceStatus:'missing',
    facts:['账户实际生效配置尚不可读'],source:'原账户风控策略',impact:'不能证明任何新增展示限额已启用',
    restrictions:['保留原账户执行门禁'],checks:['读取权威账户版本和策略变更记录'],releaseConditions:['取得同一账户实际生效策略'],status:'unknown'});
  for(const rule of list(rules?.rules)) {
    const configured=rule.enabled===true&&rule.configurationStatus==='active',known=finite(rule.used)&&configured&&rule.evidenceStatus==='available'&&typeof rule.exceeded==='boolean'&&!!text(rules.policyVersion);
    const breach=known&&rule.exceeded===true;
    const configurationLabel=configured?'已启用，版本 '+rules.policyVersion:
      rule.configurationStatus==='not-configured'?'未配置':rule.configurationStatus==='disabled'?'已停用':
      rule.configurationStatus==='invalid'?'配置未通过核验':'配置未知';
    const quoteTimes=list(rules?.quoteEvidence).map(row=>time(row.quoteAt));
    const sourceAt=quoteTimes.length?(quoteTimes.every(Boolean)?Math.min(...quoteTimes):null):rules.generatedAt;
    add({rootCauseId:'rule/'+rule.id,category:rule.id?.toLowerCase().includes('strategy')?'strategy':'portfolio',object:account,
      severity:breach?'critical':known?'info':'unknown',evidenceStatus:known?'available':rule.evidenceStatus||'unknown',
      facts:[rule.label+'：'+configurationLabel,
        configured?'限额 '+rule.limit+' '+rule.unit+'；占用 '+(finite(rule.used)?rule.used:'未知')+'；剩余 '+(finite(rule.remaining)?rule.remaining:'未知'):'页面展示不表示该项限制已启用',...list(rule.missing)],
      source:'原权威账户 riskPolicy',sourceAt,
      impact:breach?'当前风险占用达到或超出原限制':'按原账户有效配置核对风险占用',
      restrictions:breach?['原风险门禁限制新增敞口']:configured&&!known?['缺少证据时沿原门禁拒绝依赖该证据的新增风险']:[],
      checks:['核对持仓与未成交买单剩余敞口','核对当前账户规则及版本'],
      releaseConditions:['在原配置下取得完整证据且风险占用回到限额内；不自动放宽阈值'],
      status:breach?'active':known?'resolved':'unknown',references:{ruleId:rule.id,policyVersion:rules.policyVersion,
        policyConfiguredAt:rules.policyConfiguredAt,inputVersion:equity?.source?.snapshotFingerprint||null},
      authorityEvidence:{kind:'effective-rule',ruleId:rule.id,ruleVersion:rules.policyVersion,
        source:'original-paper-account',observedAt:rules.generatedAt,enabled:configured,
        configurationStatus:rule.configurationStatus,exceeded:known?rule.exceeded:null}});
  }
  for(const item of list(actions?.items)) {
    const filled=verifiedExit(item,now),conditionKnown=verifiedCondition(item,now);
    const reconciliation=item.status==='pending-reconciliation'||item.status==='filled'&&!filled;
    const kinds=item.planId?['stop','target']:[item.condition?.kind||'exit'];
    for(const kind of kinds){
    const triggered=!filled&&conditionKnown&&item.condition.status==='triggered'&&item.condition.kind===kind;
    const unknown=reconciliation||!filled&&!conditionKnown;
    add({rootCauseId:planRootCause(item.planId||item.id,kind),category:'execution',object:{type:'security',id:item.code,label:item.code},
      severity:triggered?(kind==='stop'?'critical':'warning'):unknown?'unknown':'info',
      evidenceStatus:reconciliation?'conflict':unknown?(['stale','conflict','missing','partial','unknown'].includes(item.execution?.evidenceStatus)?item.execution.evidenceStatus:'missing'):'available',executionStatus:item.status,
      facts:[filled?'原账本已核对该批次全部退出':triggered?(kind==='stop'?'触及计划止损':'触及计划目标'):unknown?'当前条件未知':'新鲜同计划观察未触发'+(kind==='stop'?'止损':'目标')+'条件',
        item.execution?.reason,...list(item.missing)],source:filled?'原权威成交事件':item.condition?.source||'原计划观察与权威订单',sourceAt:filled?item.sourceAt:item.condition?.quoteAt,
      impact:'风险动作受可卖数量、T+1、冻结、时段和流动性约束',restrictions:[item.execution?.reason,'计划止损价不承诺为成交价'],
      checks:['查看可卖数量、当日买入限制和订单真实状态'],
      releaseConditions:['原账本证明退出完成，或新鲜同计划观察明确解除触发；观察缺档不解除'],
      status:reconciliation?'unknown':triggered?'active':unknown?'unknown':'resolved',priceDependent:!filled,
      references:{planId:item.planId,entryEventId:item.entryEventId,orderIds:item.orderIds,kind},
      actionEvidence:reconciliation||!filled&&!conditionKnown?null:item.execution,
      followUp:item.continueObserving?'部分退出后继续观察剩余持仓':'保留计划和订单证据'});
    }
  }
  for(const alert of planAlerts){
    // Only the same plan, security and lot's verified fill or newer valid
    // observation can supersede an original trigger. Keep the journal intact.
    if(alert&&list(actions?.items).some(item=>supersedesAlert(item,alert,now)))continue;
    if(alert&&time(alert.quoteAt)&&alert.quoteAt<=now&&now-alert.quoteAt<=15000)risks.push(riskForPlanAlert(alert,now));
  }
  add({rootCauseId:'stock/news-evidence',category:'stock',object:{type:'security',id:'all',label:'个股新闻证据'},
    severity:'unknown',evidenceStatus:research?.news?.status==='observed-unverified'?'partial':'missing',
    facts:[research?.news?.summary?'当前新闻档案 '+research.news.summary.currentEvents+' 项，来源声明仍需独立核验':'尚无可核验的个股新闻档案'],
    source:'原新闻证据档案',sourceAt:null,impact:'缺少新闻不能判定个股不存在消息风险',restrictions:['不能用标题分类直接触发交易'],
    checks:['核对直接关联个股、原文与发布时间'],releaseConditions:['取得对应完整原始新闻证据'],status:'unknown'});
  for(const item of [...list(research?.supports),...list(research?.contra),...list(research?.missing).map(row=>({...row,missing:true}))].filter(item=>['news','manual-holdings'].includes(item.domain))){
    const manual=item.domain==='manual-holdings';
    add({rootCauseId:(manual?'manual/':'news/')+item.code+'/'+(item.reference||'all'),category:'stock',
      object:{type:manual?'manual-security':'security',id:item.reference||'all',label:manual?'手工申报持仓':'新闻观察'},
      severity:item.missing?'unknown':'warning',evidenceStatus:item.missing?'missing':'partial',facts:[item.message],source:manual?'原手工持仓观察资料':'原新闻证据档案',sourceAt:null,
      impact:manual?'申报持仓未认证为权威账户，不参与权威权益或执行数量':'新闻修订或撤回会影响此前判断',
      restrictions:['未完成核验的线索不直接触发交易'],checks:[manual?'核对原申报资料及实际账户':'核对原文、修订时间和撤回记录'],
      releaseConditions:['取得对应完整原始证据并核对'],status:'unknown'});
  }
  for(const group of list(stress?.groups).filter(group=>group.positionCount>=2))add({rootCauseId:'theme/'+group.theme,category:'portfolio',object:account,
    severity:'warning',evidenceStatus:'partial',facts:['共同题材 '+group.theme+'，覆盖 '+group.positionCount+' 个持仓：'+list(group.symbols).join('、')],
    source:'原归档分类与同一权威权益证据',sourceAt:stress.asOf,
    impact:'这些持仓可能在共同题材退潮情景中同时承压；主题重叠不等于统计相关性',
    restrictions:['压力假设不新增交易权限，不表示最大可能损失保证'],checks:['核对题材分类时点、价格覆盖和暂不可卖仓位'],
    releaseConditions:['新的同口径分类与仓位证据不再显示该重叠'],status:'active'});
  const completeClassification=stress?.current===true&&stress.asOf===now&&stress.status==='observed'&&
    stress.classificationCoverage?.classified===stress.classificationCoverage?.positions&&
    list(stress.classifications).every(row=>row.status==='available')&&!list(stress.missing).length;
  if(completeClassification)for(const group of list(alerts?.groups).filter(group=>group.rootCauseId?.startsWith('theme/'))){
    const theme=group.rootCauseId.slice('theme/'.length);
    if(!theme||risks.some(row=>row.rootCauseId===group.rootCauseId))continue;
    add({rootCauseId:group.rootCauseId,category:'portfolio',object:account,severity:'info',evidenceStatus:'available',
      facts:['完整的当前分类与权威仓位证据不再显示共同题材 '+theme+' 的多仓重叠'],
      source:'原归档分类与同一权威权益证据',sourceAt:stress.asOf,
      impact:'只解除该题材的当前分类重叠；不代表统计相关性或其他组合风险消失',
      restrictions:['保留原组合限额及执行门禁'],checks:['核对完整分类覆盖、原来源时点及全部持仓'],
      releaseConditions:['完整当前分类不再显示该题材两只及以上持仓重叠'],
      status:'resolved',references:{kind:'theme-overlap',equityEvidenceId:stress.equityEvidenceId}});
  }
  const strategyEvidence=strategy||research?.strategyDecay||{status:'unknown',reason:'策略组尚未提供经校验的收益衰减或模型校准结果'};
  const strategyKnown=['available','observed','validated'].includes(strategyEvidence.status)&&time(strategyEvidence.knownAt)&&strategyEvidence.knownAt<=now&&strategyEvidence.version&&strategyEvidence.source;
  const strategyState=strategyKnown&&['active','resolved','unknown'].includes(strategyEvidence.riskStatus)?strategyEvidence.riskStatus:'unknown';
  add({rootCauseId:'strategy/research-evidence',category:'strategy',object:{type:'strategy',id:'research',label:'策略有效性'},
    severity:strategyKnown&&Object.hasOwn(SEVERITY,strategyEvidence.severity)?strategyEvidence.severity:'unknown',evidenceStatus:strategyKnown?'available':'unknown',facts:[strategyEvidence.reason||strategyEvidence.conclusion||'研究结论尚待策略组独立验证'],
    source:strategyEvidence.source||'原研究风险中心',sourceAt:strategyEvidence.knownAt,
    impact:strategyKnown?'展示策略组原结论、版本及样本限制':'不能据此认定策略有效、失效或已完成校准',restrictions:['本组不生成收益衰减结论、不调整权重或阈值'],
    checks:['查看策略组结果、版本、成熟样本与未知原因'],releaseConditions:['策略组提供同一时点可核验的研究结论'],status:strategyState,
    references:{strategyVersion:strategyEvidence.version||null,inputVersion:strategyEvidence.inputVersion||null},firstKnowableAt:strategyEvidence.knownAt,
    accumulationEvidence:strategyEvidence.accumulationEvidence});
  const gaps=list(equityHistory?.history?.gaps||equityHistory?.missing).map(missingText);
  add({rootCauseId:'account/equity-history',category:'portfolio',object:account,severity:'unknown',
    evidenceStatus:equityHistory?.history?.status==='observed'?'available':'partial',
    facts:gaps.length?gaps:['权益回撤仅代表有效连续观察区间；已结算盈亏曲线另行展示'],
    source:'原账户派生权益观察档',sourceAt:equityHistory?.history?.to,
    impact:'观察缺档或无法核对的资金变动会中断回撤统计',restrictions:['累计已结算盈亏回撤不能作为连续账户最大回撤'],
    checks:['核对观察起止时点、断档和资金变动'],releaseConditions:['所选窗口拥有完整、可核验的连续权益证据'],status:'unknown'});
  for(const issue of list(system.missing))add({rootCauseId:'system/'+hash(issue).slice(0,16),category:'system',object:account,
    severity:'unknown',evidenceStatus:'missing',facts:[issue],source:'原运行状态',sourceAt:null,
    impact:'对应派生证据不可用',restrictions:['不从缺失记录推出安全或成交完成'],checks:['核对运行状态及原私有档案'],
    releaseConditions:['原档案和运行状态恢复并校验'],status:'unknown'});
  for(const health of list(system.observationHealth))add({rootCauseId:'system/risk-observer/'+health.accountId,
    category:'system',object:{type:'account',id:health.accountId,label:health.accountId==='pool'?'A·跟单盘':'B·预选盘'},
    severity:health.error?'warning':'info',evidenceStatus:health.error?'missing':'available',
    facts:health.error?[health.error,health.summary].filter(Boolean):['本次原账户派生观察已完成核验；历史缺档仍保留'],
    source:'原账户派生观察运行回执',sourceAt:health.checkedAt,
    impact:health.error?'该账户派生观察缺档，其他账户继续独立核验':'已恢复后续观察；不补造故障期间数据',
    restrictions:health.error?['不从未记录区间推导安全、成交或精确连续回撤']:[],
    checks:['核对该账户权益观察档、提醒持久记录及主实例状态'],
    releaseConditions:['该账户在原主实例完成一次真实观察与持久核验'],status:health.error?'unknown':'resolved'});
  for(const check of list(system.authorityChecks)){
    if(!['authority-unavailable','quote-reader-failed'].includes(check.kind)||!time(check.checkedAt)||check.checkedAt>now)continue;
    const failed=check.success===false,recovered=check.success===true&&check.recoveryConfirmed===true;
    add({rootCauseId:'system/'+check.kind,category:check.kind==='quote-reader-failed'?'data':'system',object:account,
      severity:failed?'critical':recovered?'info':'unknown',evidenceStatus:failed||recovered?'available':'missing',
      source:check.source,sourceAt:check.checkedAt,dataAt:failed?null:check.dataAt??check.checkedAt,
      facts:[failed?'原权威账户或关键报价读取失败，已记录本次后端错误事实':recovered?'原后端已完成对应恢复核验':'对应恢复证据仍不完整'],
      impact:check.kind==='quote-reader-failed'?'报价读取链路不可可靠使用；不能据此推断任何个股正在下跌':'原账户状态当前不可可靠核验',
      restrictions:['沿原账户和报价门禁核验每次动作；本证据不生成新交易权限'],
      checks:['核对原账户、原数据链及同一实例角色；保全故障和恢复回执'],
      releaseConditions:[check.kind==='authority-unavailable'?'原账户读取并完成原账本完整性及对账校验':'取得原数据链恢复及有效逐票报价回执'],
      status:failed?'active':recovered?'resolved':'unknown',
      authorityEvidence:{kind:check.kind,source:check.source,observedAt:check.checkedAt,detected:failed},
      recoveryEvidence:recovered?{kind:check.kind==='authority-unavailable'?'account-reconciled':'original-quotes-restored',
        confirmed:true,checkedAt:check.checkedAt,source:check.source}:null});
  }
  // Root causes share a single presentation row. Keep every contributing fact
  // and source; a benign duplicate cannot override a conflict/unknown report.
  const grouped=new Map();
  for(const row of risks){
    const prior=grouped.get(row.rootCauseId);
    if(!prior){grouped.set(row.rootCauseId,{...row,relatedRiskIds:[row.id],sources:[{source:row.source,sourceAt:row.sourceAt}],evidenceReferences:[row.references]});continue;}
    const rank=r=>r.status==='resolved'?10:SEVERITY[r.severity];
    const chosen=rank(row)<rank(prior)?row:prior;
    // Severity, evidence and execution answer different questions. A severe
    // historical trigger must not turn a conflicting original order into an
    // executable action merely because its severity sorts before "unknown".
    const unresolved=[prior,row].filter(item=>item.status!=='resolved');
    const relevant=unresolved.length?unresolved:[prior,row];
    const scopeConflict=prior.scopeConflict===true||prior.object?.type!==row.object?.type||prior.object?.id!==row.object?.id;
    const evidenceStatus=scopeConflict?'conflict':['conflict','stale','missing','unknown','partial','available']
      .find(status=>relevant.some(item=>item.evidenceStatus===status))||'unknown';
    const reconciliation=relevant.some(item=>item.executionStatus==='pending-reconciliation');
    const executionStates=new Set(relevant.map(item=>item.executionStatus));
    const executionStatus=reconciliation?'pending-reconciliation':
      executionStates.has('unknown')?'unknown':
      ['partially-filled','submitted','failed','condition-triggered','allowed','observing','filled','not-applicable']
        .find(status=>executionStates.has(status))||'unknown';
    const status=scopeConflict||reconciliation?'unknown':unresolved.some(item=>item.status==='active')?'active':
      unresolved.length?'unknown':'resolved';
    const originalBlock=relevant.find(item=>item.actionState==='blocked'&&item.actionEvidence?.allowed===false);
    const originalChecks=relevant.filter(item=>item.actionEvidence!=null);
    const actionEvidence=scopeConflict||reconciliation||executionStatus==='unknown'?null:
      originalBlock?originalBlock.actionEvidence:originalChecks.some(item=>item.actionState!=='allowed')?null:chosen.actionEvidence;
    grouped.set(row.rootCauseId,typedRiskRow({...chosen,id:prior.id,relatedRiskIds:[...new Set([...prior.relatedRiskIds,row.id])],
      evidenceStatus,executionStatus:scopeConflict?'unknown':executionStatus,status,scopeConflict,
      actionEvidence,
      facts:[...new Set([...prior.facts,...row.facts])],restrictions:[...new Set([...prior.restrictions,...row.restrictions])],
      checks:[...new Set([...prior.checks,...row.checks])],releaseConditions:[...new Set([...prior.releaseConditions,...row.releaseConditions])],
      sources:[...prior.sources,{source:row.source,sourceAt:row.sourceAt}],
      evidenceReferences:[...prior.evidenceReferences,row.references],
      references:{...prior.references,...row.references,orderIds:[...new Set([...list(prior.references?.orderIds),...list(row.references?.orderIds)])]}},now));
  }
  // A failed upstream module can omit an entire root. Keep that unresolved
  // record in the shared result so home/mobile summaries cannot lose it.
  for(const prior of list(alerts?.groups)){
    if(prior.status==='resolved'||grouped.has(prior.rootCauseId))continue;
    const saved=list(prior.risks)[0];if(!saved)continue;
    grouped.set(prior.rootCauseId,{...saved,status:'unknown',evidenceStatus:'missing',executionStatus:'unknown',
      facts:['本次原模块未返回该风险证据；原风险未解除',...list(saved.facts)],actionEvidence:null,
      resolutionBlockedReason:'等待同一原模块的新有效证据及相应恢复条件',canTrade:false});
  }
  const retainedLevel=row=>row.status==='resolved'?0:Math.max(row.riskLevel||0,row.lastValidRisk?.riskLevel||0);
  const rows=[...grouped.values()].map(row=>{
    let next=typedRiskRow(row,now);
    const prior=list(alerts?.groups).find(group=>group.rootCauseId===row.rootCauseId);
    if(prior&&prior.status!=='resolved'){
      next.lastValidRisk=prior.lastValidRisk||null;
      if(next.status==='resolved'){
        const check=resolutionCheck({risks:[next]},prior.lastValidRisk||{risks:prior.risks,
          sourceAt:prior.resolutionBaselineAt||Math.max(0,...list(prior.risks).map(r=>time(r.sourceAt)&&r.sourceAt<=now?r.sourceAt:0))||prior.firstSeenAt},now);
        if(!check.allowed)next={...next,status:'unknown',...riskState({...next,status:'unknown'},now),resolutionBlockedReason:check.reason};
      }
      if(next.status==='active'&&prior.lastValidRisk&&next.riskLevel!==null&&next.riskLevel<prior.lastValidRisk.riskLevel){
        const check=reductionCheck({risks:[next]},prior.lastValidRisk,now);
        if(!check.allowed)next={...next,status:'unknown',...riskState({...next,status:'unknown'},now),
          resolutionBlockedReason:'不能确认风险降级：'+check.reason};
      }
    }
    return boundedSummary(next);
  }).sort((a,b)=>(a.status==='resolved')-(b.status==='resolved')||retainedLevel(b)-retainedLevel(a)||
    SEVERITY[a.severity]-SEVERITY[b.severity]||a.rootCauseId.localeCompare(b.rootCauseId));
  const active=rows.filter(r=>r.status!=='resolved');
  return {schemaVersion:1,protocol:'fayo-risk-workbench-v1',version:VERSION,generatedAt:now,account,
    accountEpoch:equity?.accountEpoch||null,accountRevision:equity?.source?.accountRevision??null,
    summary:{status:active.some(r=>r.evidenceStatus!=='available'||r.assessmentState==='unable-to-assess')?'incomplete-evidence':'observed',
      actionable:active.filter(r=>['critical','warning'].includes(r.severity)).length,
      unknown:active.filter(r=>r.severity==='unknown'||r.evidenceStatus!=='available'||r.assessmentState==='unable-to-assess').length,
      highestRiskLevel:Math.max(0,...rows.map(retainedLevel))||null,
      assessmentCounts:{detected:rows.filter(r=>r.assessmentState==='risk-detected').length,
        notTriggered:rows.filter(r=>r.assessmentState==='not-triggered').length,unable:rows.filter(r=>r.assessmentState==='unable-to-assess').length},
      categories:CATEGORIES.map(id=>({id,count:active.filter(r=>r.category===id).length}))},
    risks:rows,equity,equityHistory,rules,actions,stress,alerts,
    equityMissingMessages:list(equity?.missing).map(missingText),stressMissingMessages:list(stress?.missing).map(missingText),
    manualHoldings:research?.manualHoldings?{...research.manualHoldings,accountAuthority:false,label:'手工申报持仓，非权威账户'}:null,
    strategy:strategyEvidence,classifications,instance:{role:system.replica?'replica':'primary'},
    readOnly:true,canTrade:false,writesAccount:false,
    scope:'派生风险证据；权限、资金、持仓、成交及交易资格继续由原账户服务裁决'};
}

function filterRiskWorkbench(report,code) {
  if(!code)return report;
  if(!/^\d{6}$/.test(code))throw Error('风险标的代码无效');
  return {...report,selectedCode:code,risks:report.risks.filter(r=>!['security','manual-security'].includes(r.object.type)||r.object.id===code||r.object.id==='all'),
    actions:report.actions?{...report.actions,items:report.actions.items.filter(r=>r.code===code)}:null};
}
module.exports={buildRiskWorkbench,filterRiskWorkbench,riskForPlanAlert,planRootCause,riskRow,missingText,VERSION};
