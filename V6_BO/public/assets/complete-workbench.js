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
  const price=rationale.price||{},rise=rationale.whyUp||{};
  add(d,'p','历史收盘涨跌：'+(typeof price.changePct==='number'?price.changePct+'%':'不可核实')+
   '；'+(rise.conclusion||'无法核实上涨原因'));
  if((rise.possibleContributors||[]).length)
    add(d,'p','可能相关、未经证实：'+rise.possibleContributors.join('；'));
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

async function run(action){
 buttons.forEach(id=>el(id).disabled=true);el('completeStatus').textContent='正在处理…';el('completeOutput').textContent='';el('completeSummary').replaceChildren();
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
  }else {
    const old=el('historicalSelection');if(old)old.remove();
    const audit=el('publicRuleAuditSummary');if(audit)audit.remove();
  }
  el('completeOutput').textContent=JSON.stringify(result,null,2);
  el('completeStatus').textContent=action==='read'?'账户已恢复':action==='append'?(data.updated?'账户已保存':'历史未变化，无重复记账'):'研究完成；外部数据与实盘成交未验收';
 }catch(e){el('completeStatus').textContent='处理失败：'+e.message;}
 finally{buttons.forEach(id=>el(id).disabled=false);}
}
el('completeRun').addEventListener('click',()=>run('complete'));el('paperAppend').addEventListener('click',()=>run('append'));el('paperRead').addEventListener('click',()=>run('read'));
})();
