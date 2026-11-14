'use strict';
(()=>{
const el=id=>document.getElementById(id),buttons=['completeRun','paperAppend','paperRead'];
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
  el('completeOutput').textContent=JSON.stringify(result,null,2);
  el('completeStatus').textContent=action==='read'?'账户已恢复':action==='append'?(data.updated?'账户已保存':'历史未变化，无重复记账'):'研究完成；外部数据与实盘成交未验收';
 }catch(e){el('completeStatus').textContent='处理失败：'+e.message;}
 finally{buttons.forEach(id=>el(id).disabled=false);}
}
el('completeRun').addEventListener('click',()=>run('complete'));el('paperAppend').addEventListener('click',()=>run('append'));el('paperRead').addEventListener('click',()=>run('read'));
})();
