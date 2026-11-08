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
  const factors=rationale.factors||[];
  if(factors.length)add(d,'p','扩展因子（未经逐项核验）：'+factors.map(f=>f.label+' '+(f.score??'未知')).join('；'),'muted');
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

async function run(action){
 buttons.forEach(id=>el(id).disabled=true);el('completeStatus').textContent='正在处理…';el('completeOutput').textContent='';el('completeSummary').replaceChildren();
 try{
  let input=action==='read'?{}:JSON.parse(el('payload').value),payload;
  if(action==='complete')payload=input.history?input:{history:input};
  else payload={accountId:el('paperAccountId').value,action,...(action==='append'?{history:input.history||input,...(input.paperConfig?{config:input.paperConfig}:{})}:{})};
  const token=el('token').value.trim();
  const response=await fetch('/api/research/'+(action==='complete'?'complete-run':'paper-account'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});
  const data=await response.json();if(!data.ok)throw Error(data.error||data.msg||'权限不足或请求失败');
  const result=data.result||data,metrics=result.backtest?.metrics||result.report?.metrics;
  if(metrics)for(const [label,value] of [['期末资产',metrics.finalEquity],['研究收益率 (%)',metrics.returnPct],['最大回撤 (%)',metrics.maxDrawdownPct],['已平仓笔数',metrics.closedTrades]]){
   const card=document.createElement('article');card.className='card';const heading=document.createElement('div'),number=document.createElement('h3');heading.textContent=label;number.textContent=value??'—';card.append(heading,number);el('completeSummary').append(card);
  }
  if(action==='complete')renderSelection(result.selectionEvidence);
  else {const old=el('historicalSelection');if(old)old.remove();}
  el('completeOutput').textContent=JSON.stringify(result,null,2);
  el('completeStatus').textContent=action==='read'?'账户已恢复':action==='append'?(data.updated?'账户已保存':'历史未变化，无重复记账'):'研究完成；外部数据与实盘成交未验收';
 }catch(e){el('completeStatus').textContent='处理失败：'+e.message;}
 finally{buttons.forEach(id=>el(id).disabled=false);}
}
el('completeRun').addEventListener('click',()=>run('complete'));el('paperAppend').addEventListener('click',()=>run('append'));el('paperRead').addEventListener('click',()=>run('read'));
})();
