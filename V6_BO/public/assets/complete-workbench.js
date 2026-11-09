'use strict';
(()=>{
const el=id=>document.getElementById(id),buttons=['completeRun','paperAppend','paperRead'];

function renderSelection(report){
 const old=el('historicalSelection');if(old)old.remove();
 if(!report||!Array.isArray(report.candidates))return;
 const root=document.createElement('section');root.id='historicalSelection';root.className='card';
 el('completeSummary').after(root);
 const add=(parent,tag,value,cls)=>{
  const child=document.createElement(tag);child.textContent=String(value??'—');
  if(cls)child.className=cls;parent.append(child);return child;
 };
 add(root,'h3','历史选股理由 · 大盘 / 板块 / 个股联动');
 add(root,'p','截至 '+(report.asOf||'日期未知')+' · '+(report.dataStatus||report.status)+
   ' · 历史研究，非实时行情，不能作为实盘委托','muted');
 if(report.status!=='evaluated'){
  add(root,'p',report.reason||'本次历史数据不足，无法生成选股理由','muted');return;
 }
 const controls=document.createElement('div');controls.className='decision-actions';root.append(controls);
 const label=add(controls,'label','按命中策略查看：');
 const select=document.createElement('select');label.append(select);
 const options=new Map();
 for(const c of report.candidates)for(const rule of c.rationale?.selection?.rules||[])
  if(!options.has(rule.id))options.set(rule.id,rule.name||rule.id);
 const option=(value,title)=>{
  const o=document.createElement('option');o.value=value;o.textContent=title;select.append(o);
 };
 option('','全部股票');for(const [id,name] of options)option(id,name);
 const count=add(root,'p','','muted');
 const list=document.createElement('div');root.append(list);
 const more=document.createElement('button');more.type='button';more.textContent='显示更多历史股票';
 root.append(more);let visible=0,rows=[];
 function stockDetail(item){
  const d=document.createElement('details');d.className='card';
  const rationale=item.rationale||{},selection=rationale.selection||{};
  add(d,'summary',(item.symbol||'')+' '+(item.name||'')+
    ' · 命中 '+(selection.ruleCount??0)+' 项 · '+(item.dataStatus||'未核实'));
  add(d,'p','入选说明：'+(selection.explanation||'暂无足够证据'));
  for(const rule of selection.rules||[]){
   add(d,'p','✓ '+(rule.name||rule.id)+'｜'+(rule.evidence||[]).filter(Boolean).join('；'));
  }
  const market=rationale.market||{},sector=rationale.sector||{};
  add(d,'p','大盘：'+(market.status==='imported-unverified'?('宽度分数 '+(market.breadthScore??'未知')):'证据不足')+
   '；板块：'+(sector.name||'未知')+'｜'+(sector.relativeStrength??'未知'));
  const resilience=rationale.marketSectorResilience||{};
  if(resilience.status==='market-sector-observed-unverified'){
    add(d,'p','大盘状态：'+resilience.marketRegime+
      '｜指数均值 '+(resilience.coreBenchmarkChangePct??'未知')+
      '%｜板块涨跌 '+(resilience.sectorChangePct??'未知')+
      '%｜相对超额 '+(resilience.relativeToCorePct??'未知')+
      '%｜'+resilience.sectorRegime,'muted');
    if((resilience.support||[]).length)
      add(d,'p','逆势/抗跌观察：'+resilience.support.join('；'),'muted');
  }else if(resilience.status==='market-observed-sector-unverified'){
    add(d,'p','已导入大盘指数，但缺少可核实的同日板块涨跌幅，暂不判断逆势强弱','muted');
  }
  const weakPreference=rationale.weakMarketPreference;
  if(weakPreference?.researchDeprioritized)
    add(d,'p','弱市板块偏好：观察次序降低｜'+weakPreference.reason+
      '（保留命中记录；不改正式策略权重）','muted');
  const factors=rationale.factors||[];
  if(factors.length)add(d,'p','扩展因子（未经逐项核验）：'+factors.map(f=>f.label+' '+(f.score??'未知')).join('；'),'muted');
  const qualityFactors=rationale.qualityFactors||[];
  if(qualityFactors.length)
    add(d,'p','趋势/量价/恢复因子：'+qualityFactors.map(f=>
      f.label+' '+(f.value===null||f.value===undefined?'未知':f.value+f.unit)+
      '（'+f.status+'）').join('；'),'muted');
  const linkedFactors=rationale.linkedFactors||[];
  if(linkedFactors.length)
    add(d,'p','新增研究因子：'+linkedFactors.map(f=>
      f.label+' '+(f.value===null||f.value===undefined?'未知':f.value+f.unit)+
      '（'+f.status+'）').join('；'),'muted');
  const linkedContext=rationale.linkedFactorResearch?.contextEvidence;
  if(linkedContext?.status==='imported-unverified')
    add(d,'p','20日联动：'+linkedContext.marketIndex+'指数 '+linkedContext.metrics.marketReturn20Pct+
      '%｜'+linkedContext.sectorName+'板块 '+linkedContext.metrics.sectorReturn20Pct+
      '%｜个股 '+linkedContext.metrics.stockReturn20Pct+
      '%（导入历史数据，未经独立核验）','muted');
  else add(d,'p','20日大盘—板块—个股联动：缺少同日对齐的独立指数/板块历史数据，暂不判断','muted');
  const cohort=rationale.sectorCohortRps;
  if(cohort?.status==='imported-unverified')
    add(d,'p','板块横向研究分位：'+cohort.sector+
     '｜20日收益 '+cohort.return20Pct+
     '%｜样本内分位 '+cohort.rpsPct+
     '/100（仅比较本批'+cohort.cohortSectors+'个板块；不代表全市场强度或资金流）','muted');
  const price=rationale.price||{},rise=rationale.whyUp||{};
  add(d,'p','历史收盘涨跌：'+(typeof price.changePct==='number'?price.changePct+'%':'不可核实')+
   '；'+(rise.conclusion||'无法核实上涨原因'));
  if((rise.possibleContributors||[]).length)
    add(d,'p','可能相关、未经证实：'+rise.possibleContributors.join('；'));
  const bulletin=rationale.issuerEvidence;
  if(bulletin?.status==='headline-research-only'){
   const summary=(bulletin.events||[]).slice(0,6).map(x=>
    x.title+'（'+x.publishedAt+'；'+x.category+'；标题未核实正文）');
   add(d,'p','上市公司公告研究：'+summary.join('；'),'muted');
  }
  const risks=rationale.risks||[];
  add(d,'p','风险：'+(risks.length?risks.join('；'):'暂未发现可核实的风险线索，不代表没有风险'),'muted');
  return d;
 }
 function draw(){
  const filtered=rows;
  count.textContent='匹配 '+filtered.length+' 只；显示 '+Math.min(visible,filtered.length)+' 只（全部为历史研究样本）';
  list.replaceChildren(...filtered.slice(0,visible).map(stockDetail));
  more.hidden=visible>=filtered.length;
 }
 function refilter(){
  const id=select.value;
  rows=report.candidates.filter(c=>!id||(c.rationale?.selection?.rules||[]).some(r=>r.id===id));
  if(rows.some(c=>c.rationale?.selection?.researchDeprioritized))
    rows.sort((a,b)=>Number(!!a.rationale?.selection?.researchDeprioritized)-
      Number(!!b.rationale?.selection?.researchDeprioritized));
  visible=Math.min(30,rows.length);draw();
 }
 select.addEventListener('change',refilter);
 more.addEventListener('click',()=>{visible=Math.min(rows.length,visible+30);draw();});
 refilter();
}

function renderForwardAudit(report){
 const existing=el('publicRuleAuditSummary');if(existing)existing.remove();
 if(!report)return;
 const root=document.createElement('section');root.id='publicRuleAuditSummary';root.className='card';
 el('completeSummary').after(root);
 const add=(tag,value)=>{
  const child=document.createElement(tag);child.textContent=String(value??'—');root.append(child);return child;
 };
 add('h3','新增公开战法 · 独立未来表现验证');
 add('p','历史研究，不是实盘收益；区分无法成交、公司行为未核对与有效模型样本。');
 if(report.status==='unavailable'){
  add('p','无法验证：'+(report.reason||'历史证据不足'));return;
 }
 const overlap=report.overlapDiagnostics;
 if(overlap?.status==='descriptive-only'){
  add('p','信号去重（同股同交易日）：原始命中 '+overlap.rawRuleSignals+
   '｜股票日 '+overlap.uniqueStockDays+
   '｜独立家族证据次数 '+overlap.independentFamilyExposures+
   '｜同家族重复命中 '+overlap.sameFamilyDuplicateSignals+
   '。同日共振不是独立回测样本，自动权重保持不变。');
 }
 const horizon=report.configuration?.horizons||[];
 const episodes=report.temporalOverlapDiagnostics;
 if(episodes?.status==='descriptive-only'){
  const summary=horizon.map(days=>{
   const x=episodes.byHorizon?.[days];
   if(!x)return null;
   return days+'日：原始 '+x.rawRuleEvents+
     ' / 同家族股票日 '+x.familyExposureDays+
     ' / 非重叠分段 '+x.nonoverlapFamilyEpisodes;
  }).filter(Boolean);
  if(summary.length)add('p','连续信号去重（只读研究）：'+summary.join('；')+
   '。分段数不等于统计独立样本量，不用于自动升降权。');
 }
 const weightReview=report.weightReviewDiagnostics;
 if(weightReview){
  add('p','战法权重人工复核：'+(weightReview.status==='descriptive-only'?
   '按5日冻结历史窗口评估升权/降权复核优先级':'证据尚不足')+
   '。从不自动修改原四套策略或15因子的实际权重。');
 }
 for(const rule of report.rules||[]){
  const detail=document.createElement('details');detail.className='card';root.append(detail);
  const heading=document.createElement('summary');heading.textContent=rule.label||rule.id;detail.append(heading);
  const cohit=overlap?.byRule?.[rule.id];
  if(cohit){
   const note=document.createElement('p');
   note.textContent='联动去重：命中交易日 '+cohit.signalDays+
    '｜同家族重叠 '+cohit.sameFamilyOverlapDays+
    '｜跨家族共振 '+cohit.otherFamilyOverlapDays+
    '｜权重建议：'+cohit.reviewNote+'（本次未改权重）';
   detail.append(note);
  }
  const review=weightReview?.byRule?.[rule.id];
  if(review){
   const kinds={'manual-up-review':'可人工复核升权假设',
    'manual-down-review':'可人工复核降权假设',
    'hold-mixed-evidence':'证据混合，保持观察',
    'insufficient-evidence':'证据不足，保持不变'};
   const row=document.createElement('p');
   row.textContent='权重评审：'+(kinds[review.review]||'未知')+
    '｜5日有效模拟 '+review.modeledEvents+
    '｜非重叠分段 '+(review.nonoverlapEpisodes??'未知')+
    '｜阻断 '+review.blockedEvents+
    '｜原因 '+(review.blockers?.length?review.blockers.join('、'):review.reason)+
    '（只读，不改权重）';
   detail.append(row);
  }
  const diagnostic=report.ruleInputDiagnostics?.[rule.id];
  if(diagnostic){
    const note=document.createElement('p');
    note.textContent='信号日证据：命中 '+diagnostic.candidateDays+
      ' ｜未命中 '+diagnostic.notMatchedDays+
      ' ｜数据不足 '+diagnostic.unverifiedInputDays+
      ' ｜风险阻断 '+diagnostic.blockedDays+
      '（数据不足不等于策略失效）';
    detail.append(note);
  }
  for(const days of horizon){
   const stats=rule.byHorizon?.[days]||{};
   const row=document.createElement('p');
   row.textContent='未来 '+days+' 日：信号 '+(stats.signals??0)+
    ' ｜可建模 '+(stats.modeled??0)+' ｜无法建模 '+((stats.signals??0)-(stats.modeled??0))+
    ' ｜净收益均值 '+(stats.averageNetReturnPct==null?'未验证':stats.averageNetReturnPct+'%')+
    ' ｜胜率 '+(stats.winRatePct==null?'未验证':stats.winRatePct+'%');
   detail.append(row);
  }
 }
 add('p','未经独立行情与成交对账；未完成模型训练及统计有效性认证，且弱市/暴跌亏损样本不能删除。');
}

function renderEightPointFlow(report){
 const old=el('eightPointSummary');if(old)old.remove();
 if(!report||!Array.isArray(report.workstreams))return;
 const root=document.createElement('section');root.id='eightPointSummary';root.className='card';
 el('completeSummary').after(root);
 const add=(parent,tag,value,cls)=>{
  const x=document.createElement(tag);x.textContent=String(value??'—');
  if(cls)x.className=cls;parent.append(x);return x;
 };
 add(root,'h3','V6 八项整体联动 · 单次研究证据');
 add(root,'p','本报告同时覆盖八项代码链路。代码接通不等于已真实验收或部署，'+
  '原四套策略、权重与模拟盘资金均不被此报告修改。','muted');
 add(root,'p','历史样本日期 '+(report.asOf||'缺少统一日期')+
  '｜代码链路 '+(report.coverage?.codeConnected??0)+'/8'+
  '｜外部已验收 '+(report.coverage?.externalAccepted??0)+'/8','muted');
 const descriptors={
  market:x=>'上证/深证/创业板/A50证据：'+(Object.keys(x.indices||{}).join('、')||'未知')+
   '｜广度 '+(x.breadthPct??'未知')+'｜市场状态 '+(x.regime||'未知'),
  sector:x=>'有效板块 '+(x.sectors?.length||0)+'｜个股关联 '+(x.stockSectorLinks||0)+
   '｜弱市研究降序 '+(x.weakMarketDeprioritizedCount||0),
  stock:x=>'历史候选 '+(x.candidates||0)+'｜观察池本轮 '+(x.watch?.length||0)+
   '｜上期观察 '+(x.previousStateCount||0)+
   '｜缺价保留 '+(x.retainedUnavailableCount||0)+
   (x.notPersistedAcrossDates?'｜此入口不写跨日状态':'｜本机状态单独持久化'),
  explanation:x=>'逐股解释 '+(x.stocks?.length||0)+
   '｜公告标题 '+(x.issuerHeadlinesUnverified||0)+'｜上涨直接因果：未认证',
  risk:x=>'模拟盘账本核对 '+(x.paperLedgerBalanced?'通过':'未通过')+
   '｜历史回测核对 '+(x.backtestBalanced?'通过':'未通过')+
   '｜持仓提醒需通过本机私有接口核验',
  learning:x=>'5日冻结研究战法评审 '+(x.perRule?.length||0)+
   '｜大跌保护 '+(x.marketShock?.status==='observed-unverified'?
    (x.manualReviewPausedForShock?'暂缓人工调权复核':'未触发'):'数据未知')+'｜实际权重不变',
  publicRules:x=>'原有策略入口 '+(x.originalStrategyKeys?.length||0)+
   '｜新增研究战法目录 '+(x.researchCatalogCount||0)+'｜研究战法不直接晋级正式策略',
  testing:x=>'历史数据检查 '+(x.dataQualityChecked?'已执行':'未执行')+
   '｜CI/实际部署：必须使用独立日志验证'
 };
 const phaseLabels={'imported-observed-unverified':'已导入历史证据，待外部核验',
  'unavailable':'证据不足','historical-research-only':'历史研究已接入',
  'existing-guards-reconciled':'离线账本已核对',
  'reconciliation-unavailable':'账本核对未通过',
  'manual-review-only':'仅供人工复核',
  'needs-opt-in-forward-audit':'尚未启用历史前瞻审计',
  'research-layer-attached':'研究规则已接入',
  'local-evidence-constructed-ci-not-self-attested':'离线证据已汇总，CI另验收'};
 for(const line of report.workstreams){
  const info=report.dimensions?.[line.id]||{},card=document.createElement('details');
  card.className='card';root.append(card);
  add(card,'summary',line.label+'｜'+(phaseLabels[line.status]||'待核验'));
  add(card,'p',descriptors[line.id]?.(info)||'证据待核对');
  for(const missing of line.unresolved||[])add(card,'p','待验收：'+missing,'muted');
 }
 add(root,'p',(report.externalBlockers||[]).join('；'),'muted');
}

async function run(action){
 buttons.forEach(id=>el(id).disabled=true);el('completeStatus').textContent='正在处理…';el('completeOutput').textContent='';el('completeSummary').replaceChildren();
 for(const id of ['historicalSelection','publicRuleAuditSummary','eightPointSummary']){const old=el(id);if(old)old.remove();}
 try{
  let input=action==='read'?{}:JSON.parse(el('payload').value),payload;
  if(action==='complete'){
    payload=input.history?input:{history:input};
    if(el('publicRuleAuditEnabled')?.checked===true)payload.validatePublicRules=true;
    if(el('linkedRulesAuditEnabled')?.checked===true){
      payload.validatePublicRules=true;
      if(payload.publicRuleAuditOptions!==undefined&&
        (!payload.publicRuleAuditOptions||typeof payload.publicRuleAuditOptions!=='object'||
         Array.isArray(payload.publicRuleAuditOptions)))throw Error('公开战法回测配置必须为对象');
      payload.publicRuleAuditOptions={...(payload.publicRuleAuditOptions||{}),includeLinkedRules:true};
    }
    if(el('qualityRulesAuditEnabled')?.checked===true){
      payload.validatePublicRules=true;
      if(payload.publicRuleAuditOptions!==undefined&&
        (!payload.publicRuleAuditOptions||typeof payload.publicRuleAuditOptions!=='object'||
         Array.isArray(payload.publicRuleAuditOptions)))throw Error('公开战法回测配置必须为对象');
      payload.publicRuleAuditOptions={...(payload.publicRuleAuditOptions||{}),includeQualityRules:true};
    }
  }else{
    payload={accountId:el('paperAccountId').value,action,...(action==='append'?{history:input.history||input,...(input.paperConfig?{config:input.paperConfig}:{})}:{})};
  }
  const token=el('token').value.trim();
  const response=await fetch('/api/research/'+(action==='complete'?'complete-run':'paper-account'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});
  const data=await response.json();if(!data.ok)throw Error(data.error||data.msg||'权限不足或请求失败');
  const result=data.result||data,metrics=result.backtest?.metrics||result.report?.metrics;
  if(metrics)for(const [label,value] of [['期末资产',metrics.finalEquity],['研究收益率 (%)',metrics.returnPct],['最大回撤 (%)',metrics.maxDrawdownPct],['已平仓笔数',metrics.closedTrades]]){
   const card=document.createElement('article');card.className='card';const heading=document.createElement('div'),number=document.createElement('h3');heading.textContent=label;number.textContent=value??'—';card.append(heading,number);el('completeSummary').append(card);
  }
  if(action==='complete'){
    renderSelection(result.selectionEvidence);
    renderForwardAudit(result.publicRuleForwardAudit);
    renderEightPointFlow(result.eightPointFlow);
  }else {
    const old=el('historicalSelection');if(old)old.remove();
    const audit=el('publicRuleAuditSummary');if(audit)audit.remove();
    const integrated=el('eightPointSummary');if(integrated)integrated.remove();
  }
  el('completeOutput').textContent=JSON.stringify(result,null,2);
  el('completeStatus').textContent=action==='read'?'账户已恢复':action==='append'?(data.updated?'账户已保存':'历史未变化，无重复记账'):'研究完成；外部数据与实盘成交未验收';
 }catch(e){el('completeStatus').textContent='处理失败：'+e.message;}
 finally{buttons.forEach(id=>el(id).disabled=false);}
}
el('completeRun').addEventListener('click',()=>run('complete'));el('paperAppend').addEventListener('click',()=>run('append'));el('paperRead').addEventListener('click',()=>run('read'));
})();
