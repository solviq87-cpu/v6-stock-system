import {h,button,section,field,note,empty,table,format,dateTime} from './ui.js';
const arr=x=>Array.isArray(x)?x:[],finite=x=>typeof x==='number'&&Number.isFinite(x),val=x=>x==null?'未知':String(x);
const num=x=>finite(x)?format(x,2):'未知',pct=x=>finite(x)?format(x*100,2)+'%':'未知';
const facts=rows=>h('dl',{class:'fy-facts'},rows.map(([label,value])=>h('div',{class:'fy-fact'},h('dt',{},label),h('dd',{},val(value)))));
const reasons={
 ORIGINAL_HISTORY_UNAVAILABLE:'原历史档案尚无足够记录',ORIGINAL_HISTORY_VERSION_UNAVAILABLE:'原历史版本或接收凭据不完整',ORIGINAL_HISTORY_GATE_REJECTED:'历史未通过原多源门禁',
 ORIGINAL_TRADING_CALENDAR_UNAVAILABLE:'连续交易日日历证据不足',MISSING_HELD_OR_PLANNED_HISTORY:'部分持仓或计划缺少同口径历史',
 FEWER_THAN_SIXTY_ALIGNED_RETURNS:'少于60个对齐的历史回报样本',INSUFFICIENT_ALIGNED_EVIDENCE:'同口径、同日期的历史回报不足',FEWER_THAN_TEN_TAIL_OBSERVATIONS:'尾部不足10个样本，VaR和ES保持未知',
 ORIGINAL_PLAN_RECEIPTS_UNAVAILABLE:'尚无5秒内、匹配当前账本和原报价的计划检查回执',ORIGINAL_PLAN_SIZING_UNAVAILABLE:'原计划尚未确认数量、费用或全部门禁',
 MISSING_AUTHORITATIVE_EQUITY_BOUNDARIES:'缺少同一收益期内每次入出金前后的完整原权益边界',NO_UNIQUE_BOUNDED_XIRR:'现金流不能确认唯一的年化内部收益率',
 CAPITAL_QUOTE_OR_POLICY_UNAVAILABLE:'当前原报价、权益或压力假设尚不齐备',PRIOR_LIQUIDITY_UNAVAILABLE:'前一交易日原始成交量额证据不足',
 NO_OPEN_POSITION_RISK:'当前没有持仓可计算组合历史风险',CURRENT_PORTFOLIO_VALUATION_UNAVAILABLE:'持仓当前原始报价不齐，无法确认组合权重',
 PORTFOLIO_HISTORY_SYMBOL_BUDGET:'本次历史标的超过有界读取预算',PORTFOLIO_CONTEXT_OVER_BUDGET:'本次组合上下文超出读取预算',
 SAME_TIME_EXIT_OR_ENTRY_COST_UNAVAILABLE:'同一时点的退出、买入及成本条件不足',COMPARABLE_CANDIDATE_ALLOCATION_UNAVAILABLE:'候选无法在同等资本和原计划数量内形成可比方案',
 FEWER_THAN_TWELVE_PAIRED_HORIZONS:'少于12个相互独立、期限相同的历史区间',MISSING_CONTINUOUS_DAILY_EQUITY_EVIDENCE:'缺少连续交易日的完整权益边界',
 PENDING_CASH_RESERVATION_MISMATCH:'待买委托含费冻结资金超出账户现金',PENDING_BUY_BUDGET_UNKNOWN:'待买委托含费预算未知',
 PENDING_SELL_RESERVATION_MISMATCH:'待卖委托冻结数量与持仓不一致',ORPHAN_SELL_RESERVATION:'待卖冻结没有对应持仓'
};
const reason=x=>reasons[x]||(/^[A-Z0-9_]+$/.test(x||'')?'所需原始证据尚未齐备':x)||'证据不足，保持未知';
const gaps=value=>{const rows=[...new Set(arr(value).filter(Boolean))];return rows.length?h('ul',{class:'fy-muted'},rows.map(x=>h('li',{},reason(x)))):null;};
function disclosure(title,...children){return h('details',{class:'fy-details'},h('summary',{},title),...children);}
function riskBudgetView(title,budget){
 if(!budget)return null;
 return disclosure(title,budget.reason?note(reason(budget.reason)):null,
  facts([['额度依据',budget.policyScope==='original-plan-effective-position-cap'?'原计划与原后台检查共同确认的有效单股上限':'原账户统一风险政策'],['政策版本',budget.policyVersion]]),
  table([{label:'额度',value:x=>({single:'单股',gross:'总敞口',sector:'行业',strategy:'策略'})[x.kind]||x.kind},{label:'上限',value:x=>finite(x.limitPct)?num(x.limitPct)+'%':'未知'},{label:'原权益下剩余额度',value:x=>num(x.remainingAtOriginalEquity)},{label:'含费后剩余额度',value:x=>num(x.remainingAfterEstimatedFee)}],arr(budget.budgets)));
}

function defensiveControls(ctx,account,onChanged){
 const state=account.defensive?.state,canEdit=ctx.role==='edit'||ctx.canEdit===true;
 const root=section('原账户防御控制','限制会在原提交、成交与自动模拟写入时检查；解除后仍须通过原报价、仓位、亏损和交易时钟门禁。');
 root.append(facts([['当前状态',state==='restricted'?'已限制新增风险':state==='open'?'未加附加限制':'未知'],['最近变更',account.defensive?.changedAt?dateTime(account.defensive.changedAt):'尚无防御审批'],['依据',account.defensive?.reason||'沿用原账户门禁']]));
 if(!canEdit||!['open','restricted'].includes(state)||!Number.isSafeInteger(account.revision))return root;
 const explanation=h('textarea',{rows:2,maxlength:240,'aria-label':'防御审批理由',placeholder:'填写检查依据与本次操作理由'}),status=note('先核对本次账户版本，再准备操作。'),review=h('div',{}),form=h('div',{class:'fy-stack','data-result-action':'defense'});
 let proposal=null,busy=false;
 const clear=()=>{proposal=null;review.replaceChildren();};
 for(const event of ['input','change'])form.addEventListener(event,e=>{e.stopPropagation();clear();});
 const stage=next=>{
  if(busy||ctx.signal?.aborted)return;
  const text=explanation.value.trim();if(!text){status.textContent='请填写本次防御操作理由。';explanation.focus();return;}
  proposal=Object.freeze({action:'set-defense',accountId:account.account,expectedRevision:account.revision,state:next,reason:text,...(next==='open'?{acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'}:{})});
  const captured=proposal;
  const confirm=button(next==='open'?'确认审批解除':'确认限制新增',async()=>{
   if(busy||proposal!==captured||ctx.signal?.aborted)return;busy=true;confirm.disabled=true;cancel.disabled=true;
   try{
    await ctx.api('/api/research/order-account',{method:'POST',body:captured,signal:ctx.signal});
    if(ctx.signal?.aborted)return;clear();onChanged('防御操作已记录到原账户，请重新读取最新风险与审批回执。');
   }catch(error){if(!ctx.signal?.aborted){clear();status.textContent=(error.message||'操作未完成')+'。请重新读取并核对，不会自动重试或更新审批版本。';}}
   finally{busy=false;}
  },next==='open'?'primary':'danger');
  const cancel=button('取消',clear,'quiet');
  const box=h('section',{class:'fy-review',role:'alertdialog','aria-label':next==='open'?'审批解除防御':'限制新增风险',tabindex:'-1'},h('h3',{},next==='open'?'审批解除防御':'限制新增风险'),
   facts([['账户',account.account==='pool'?'精选模拟账户':'预选模拟账户'],['本次账户版本',account.revision],['理由',captured.reason]]),
   note(next==='open'?'服务端将重新核对原账本、冻结预算、未完成买单和原亏损证据；本次审批不会生成委托。':'确认后会阻止新增买入、待买单继续成交和新增认购支出。原撤单与符合条件的卖出仍可使用。'),h('div',{class:'fy-toolbar'},confirm,cancel));
  review.replaceChildren(box);box.focus();
 };
 form.append(field('操作理由',explanation),h('div',{class:'fy-toolbar'},button(state==='restricted'?'准备审批解除':'准备限制新增',()=>stage(state==='restricted'?'open':'restricted'),'secondary')),status,review);
 root.append(form);ctx.signal?.addEventListener('abort',clear,{once:true});return root;
}

function portfolioView(r){
 if(r?.mode!=='original-account-portfolio-evidence'||r.canTrade!==false||r.writesAccount!==false)return section('组合证据','',note(reason(r?.reason)));
 const root=h('div',{class:'fy-stack'}),coverage=r.coverage||{},tail=r.tail||{},performance=r.performance||{},observed=r.observedEquityPerformance;
 if(observed?.scope==='original-observed-equity-window-v1'&&observed.canTrade===false&&observed.accountMutated===false&&observed.fullPeriodCertified===false){
  const known=observed.status==='observed-unverified';
  root.append(section('最近连续权益观察','只比较原模拟账本已对账的连续采样区间；外部入出金、完整收益期仍未知。',
   facts([['开始',known?dateTime(observed.from):'未知'],['结束',known?dateTime(observed.to):'未知'],['权益变动',known?num(observed.equityChange):'未知'],['区间权益变动率',known?pct(observed.returnRatio):'未知'],['观察点最大回撤',known&&finite(observed.observedMaxDrawdownPct)?num(observed.observedMaxDrawdownPct)+'%':'未知'],['样本数',known?observed.sampleCount:'未知']]),
   known?note('只显示最近连续区间，不代表完整收益期或连续账户最大回撤。'):note(reason(observed.reason))));
 }
 root.append(section('历史风险与证据覆盖','按当前持仓权重分析同日历史场景。后复权价格变动单独标注，不能替代账户实际净值或总收益。',
  facts([['对齐样本',tail.sampleCount??coverage.alignedSamples],['样本区间',coverage.start&&coverage.end?coverage.start+' 至 '+coverage.end:'未知'],['已核对计划回执',val(coverage.verifiedPlanReceipts)+' / '+val(coverage.planCount)],['日波动',pct(tail.dailyVolatility)],['日下行偏差',pct(tail.dailyDownsideDeviation)],['历史 VaR',pct(tail.historicalVaR)],['历史 ES',pct(tail.historicalES)],['尾部样本',tail.tailCount],['置信水平',pct(tail.confidence)]]),
  tail.reason||tail.tailReason?note(reason(tail.reason||tail.tailReason)):null,gaps(coverage.missing),
  disclosure('来源、版本和假设',facts([['来源',coverage.source],['数据版本',coverage.dataVersion],['指标版本',tail.factorVersion],['最近可知时点',dateTime(coverage.availableAt)]]),gaps([...arr(r.assumptions),...arr(tail.assumptions)])),
  arr(tail.contributions).length?disclosure('逐股风险贡献',table([{label:'代码',value:x=>x.symbol},{label:'当前权重',value:x=>pct(x.weight)},{label:'波动贡献',value:x=>pct(x.volatilityContribution)},{label:'下行贡献',value:x=>pct(x.downsideContribution)},{label:'VaR 场景贡献',value:x=>pct(x.varScenarioContribution)},{label:'ES 贡献',value:x=>pct(x.tailLossContribution)}],tail.contributions)):null,
  arr(tail.industryContributions).length?disclosure('行业与主题风险贡献',...['industryContributions','themeContributions'].map(key=>table([{label:key==='industryContributions'?'行业':'主题',value:x=>x.group},{label:'权重',value:x=>pct(x.weight)},{label:'波动贡献',value:x=>pct(x.volatilityContribution)},{label:'下行贡献',value:x=>pct(x.downsideContribution)},{label:'VaR 场景贡献',value:x=>pct(x.varScenarioContribution)},{label:'ES 贡献',value:x=>pct(x.tailLossContribution)}],arr(tail[key])))):null,
  arr(tail.correlations).length?disclosure('相关性变化',table([{label:'股票组合',value:x=>arr(x.symbols).join(' / ')},{label:'最近30期',value:x=>num(x.recent30)},{label:'此前30期',value:x=>num(x.previous30)},{label:'变化',value:x=>num(x.change)}],tail.correlations)):null));
 const capacities=arr(r.capacity);
 root.append(section('资金规模与容量压力','按原账户权益的不同倍数、前日原始量额参与率、原费用及冲击假设比较。',capacities.length?capacities.map(item=>disclosure(item.symbol+' · 容量情景',item.reason?note(reason(item.reason)):table([{label:'情景资本',value:x=>num(x.capital)},{label:'期望股数',value:x=>val(x.desiredShares)},{label:'容量内估计股数',value:x=>val(x.estimatedShares)},{label:'满足比例',value:x=>pct(x.fillFraction)},{label:'费用',value:x=>num(x.estimatedFee)},{label:'冲击压力',value:x=>num(x.estimatedMarketImpact)}],arr(item.rows)),facts([['历史日',item.observedDate],['参与率上限',r.scenarioPolicy?.maxParticipationPct==null?'未知':num(r.scenarioPolicy.maxParticipationPct)+'%'],['费用版本',item.feeVersion]]))):empty('尚无可核对的持仓或原计划'),note('冲击是压力假设，真实成交和净收益保持未知。')));
 root.append(section('原计划仓位预演','使用原后台计划、同一原始报价和有时效的原门禁回执；本页不提交订单。',arr(r.previews).length?r.previews.map(item=>disclosure(item.symbol+' · 计划预演',item.reason?note(reason(item.reason)):facts([['假设数量',item.quantity],['假设价格',num(item.price)],['费用',num(item.estimatedFee)],['成交后现金',num(item.cashAfter)],['成交后可用现金',num(item.availableCashAfter)],['总仓位',pct(item.totalWeight)],['单股仓位',pct(item.symbolWeight)],['原门禁',item.originalGateStatus==='allowed'?'本次原检查通过，仍非执行授权':'未通过 / 未知']]),
  ...['industry','theme','strategy'].map((key,i)=>arr(item[key]).length?table([{label:['行业','主题','策略'][i],value:x=>x.group},{label:'假设成交后权重',value:x=>pct(x.weight)}],item[key]):null),
  riskBudgetView('原风险额度',item.riskBudgetAfter),
  item.planAllocationBudgetAfter&&item.riskBudgetAfter?.policyScope!=='original-plan-effective-position-cap'?riskBudgetView('原计划有效额度',item.planAllocationBudgetAfter):null,
  item.incrementalPortfolioRisk?.metrics?disclosure('同一样本下的增量风险',table([{label:'指标',value:x=>x.label},{label:'当前',value:x=>pct(x.before)},{label:'假设成交后',value:x=>pct(x.after)},{label:'变化',value:x=>pct(x.change)}],Object.entries(item.incrementalPortfolioRisk.metrics).map(([key,row])=>({...row,label:({dailyVolatility:'日波动',dailyDownsideDeviation:'日下行',historicalVaR:'历史 VaR',historicalES:'历史 ES'})[key]})))):null)):note(reason('ORIGINAL_PLAN_RECEIPTS_UNAVAILABLE'))));
 root.append(section('继续持有与候选机会成本','同等资本、相同历史区间和持有期，计入持有或替换路径的费用与冲击。结果不构成自动换仓。',arr(r.opportunityComparisons).length?table([{label:'原持仓 / 候选',value:x=>x.holdSymbol+' / '+x.candidateSymbol},{label:'比较资本',value:x=>num(x.capital)},{label:'可卖比较 / 冻结股数',value:x=>val(x.comparedShares)+' / '+val(x.lockedOrFrozenShares)},{label:'持有期 / 样本',value:x=>val(x.horizonSessions)+' / '+val(x.sampleCount)},{label:'继续持有历史均值',value:x=>pct(x.hold?.meanNetReturn)},{label:'候选历史均值',value:x=>pct(x.candidate?.meanNetReturn)},{label:'增量交易成本',value:x=>num(x.incrementalTransactionCost)},{label:'状态',value:x=>x.reason?reason(x.reason):'可比历史压力场景'}],r.opportunityComparisons):empty('尚无同时满足原门禁与可比证据的组合')));
 root.append(section('现金流调整后的绩效','外部入出金与投资盈亏分别计算。重置或修改本金开启新的原账户收益期。',facts([['投资盈亏',num(performance.investmentPnl)],['外部净现金流',num(performance.externalNetFlow)],['时间加权收益 TWR',pct(performance.timeWeightedReturn)],['资金加权年化收益 MWR',pct(performance.moneyWeightedAnnualReturn)],['同区间基准',pct(performance.benchmarkReturn)],['基准差额',pct(performance.benchmarkExcess)],['夏普比率',num(performance.riskAdjustedReturn?.sharpe)],['索提诺比率',num(performance.riskAdjustedReturn?.sortino)]]),performance.reason?note(reason(performance.reason)):null,gaps(performance.missing),performance.moneyWeightedReason?note(reason(performance.moneyWeightedReason)):null,performance.riskAdjustedReason?note(reason(performance.riskAdjustedReason)):null));
 return root;
}

export function renderAdvancedAccountRisk(ctx,data,{onChanged=()=>{}}={}){
 const root=section('权威模拟账户 · 退出、对账与组合风险','沿用原账本、原报价和风险门禁；所有估计都有来源与缺项，成交能力不能由报告确认。');root.classList.remove('fy-panel');
 if(ctx.role!=='edit'&&ctx.canEdit!==true){root.append(note('需要原编辑身份才能查看私有账户风险证据。'));return root;}
 if(data?.mode!=='advanced-account-risk-readonly'||data.canTrade!==false||data.writesAccount!==false){root.append(note('高级账户风险证据尚未取得，保持未知。'));return root;}
 root.append(facts([['读取状态',({observed:'已读取原账户证据',incomplete:'部分证据不足',replica:'副本，需在原主实例核对',busy:'已有读取任务，请稍后重试',timeout:'读取超时','role-changed':'实例角色已变化'})[data.status]||'证据不足'],['本进程读取样本',data.telemetry?.sampleCount],['读取 P50 / P95 (ms)',data.telemetry?.sampleCount?val(data.telemetry.p50Ms)+' / '+val(data.telemetry.p95Ms):'未知']]));
 for(const account of arr(data.accounts)){
  const name=account.account==='pool'?'精选模拟账户':'预选模拟账户',box=section(name,'原账户版本 '+val(account.revision)+' · '+dateTime(account.checkedAt));
  box.classList.remove('fy-panel');const reconciliation=account.reconciliation;
  box.append(...[facts([['原账本检查',account.originalReadValidation===true?'已通过':'未知 / 需核对'],['内部对账',reconciliation?.internallyConsistent===true?'一致（仅已列明范围）':'未知 / 异常'],['期初至当前数量流水',reconciliation?.quantityFlowVerified===true?'已核对':'历史凭据不足'],['现金',num(account.cash)],['冻结资金',num(account.reservedCash)],['可用资金',num(account.availableCash)],['原始报价权益估计',num(account.equity)]]),gaps(reconciliation?.missing),gaps(reconciliation?.reasonCodes)].filter(Boolean));
  const exits=new Map(arr(account.portfolioEvidence?.exits).map(row=>[row.symbol,row])),rows=arr(account.positions).map(row=>({...row,exit:exits.get(row.symbol)}));
  box.append(rows.length?table([{label:'代码',value:x=>x.symbol},{label:'持有 / 可卖批次',value:x=>val(x.quantity)+' / '+val(x.sellable)},{label:'卖单冻结',value:x=>val(x.orderFrozen)},{label:'退出费用',value:x=>num(x.estimatedFee)},{label:'冲击压力',value:x=>num(x.exit?.estimatedMarketImpact)},{label:'条件退出天数',value:x=>val(x.exit?.conditionalSessions)},{label:'原始报价',value:x=>x.quoteAt?dateTime(x.quoteAt):'未知'}],rows):empty(account.status==='observed-unverified'?'原账本暂无持仓':'持仓证据未知'));
  const alerts=[...arr(account.alerts),...rows.flatMap(row=>arr(row.alerts)),...arr(account.portfolioEvidence?.exits).flatMap(row=>arr(row.alerts))];
  if(alerts.length)box.append(disclosure('触发依据、限制与解除条件',...alerts.map(x=>h('article',{class:'fy-item'},h('strong',{},val(x.object)+' · '+(({critical:'严重',high:'高',warning:'警告'})[x.severity]||'待核对')),facts([['触发依据',x.basis],['限制',x.restriction],['建议检查',x.check],['解除条件',x.release]])))));
  box.append(defensiveControls(ctx,account,onChanged),portfolioView(account.portfolioEvidence));root.append(box);
 }
 for(const [account,governance] of Object.entries(data.governance||{}))if(['pool','pre'].includes(account)&&governance){
  root.append(section((account==='pool'?'精选':'预选')+'账户 · 原历史与隔离回放','按本账户相关证券读取原档案，各账户的重叠记录不相加。原始接收时点、入库时点和复核记录分别保留。',
   facts([['档案状态',governance.captures?'已有原始归档，供应商时钟仍有缺项':'尚无归档'],['采集批次',governance.captures],['有原始字节的回执',governance.rawReceipts],['原始字节缺项',governance.missingRawReceipts],['数据版本',governance.dataVersions],['发现修订',governance.revisionCount],['仍在隔离',governance.quarantine?.open],['已有复核',governance.quarantine?.reviewed]]),gaps(governance.missing),
   arr(governance.quarantine?.entries).length?disclosure('隔离范围与复核状态',table([{label:'代码 / 截至日期',value:x=>x.code+' / '+x.day},{label:'状态',value:x=>x.status==='reviewed-original-gates-passed'?'复核后通过原门禁':'仍在隔离'},{label:'影响记录',value:x=>val(x.affectedRows)},{label:'原始字节',value:x=>x.rawEvidencePreserved?'已保留':'不完整'},{label:'复核次数',value:x=>val(x.reviewCount)},{label:'最后复核',value:x=>dateTime(x.lastReviewAt)}],governance.quarantine.entries)):null,
   arr(governance.versions).length?disclosure('最近数据版本的时间证据',table([{label:'代码 / 日期',value:x=>x.code+' / '+x.day},{label:'来源 / 版本',value:x=>x.source+' / '+x.version},{label:'本系统收到',value:x=>dateTime(x.receivedAt)},{label:'可用时点',value:x=>dateTime(x.availableAt)},{label:'供应商原发布时点',value:x=>dateTime(x.originalAt)}],governance.versions)):null));
 }
 return root;
}
