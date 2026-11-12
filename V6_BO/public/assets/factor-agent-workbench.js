(function(){
'use strict';
const el=id=>document.getElementById(id);
if(!el('factorAgentStatus'))return;
const names={unconfigured:'尚未配置研究数据',planning:'正在制定研究计划',reflection:'已记录研究结果',idle:'等待新的数据或候选',
 'needs-data':'等待有来源的数据','preview-ready':'研究预检就绪',
 'blocked-invalid-agent-journal':'研究记忆校验未通过',unchanged:'数据与研究血缘未变化',
 'research-cycle-completed-not-certified':'本轮研究流程已完成','failed-stop-and-audit-before-retry':'已暂停，需核查研究档案'};
const actions={'run-capture-research-cycle':'封存今天的研究信号','run-observe-research-cycle':'观察已冻结信号的后续表现','provide-current-day-authorized-source':'等待今天收盘后带来源的数据','provide-causal-current-day-picks-and-factor-evidence':'补齐选股当时的因子证据','configure-private-research-agent':'配置研究数据与独立存储',
 'provide-sealed-prior-research-or-explicit-preregistration':'准备封存研究报告或事前候选',
 'await-preregistered-prefix-h5-maturity':'等待已冻结样本成熟',
 'await-signals-frozen-after-preregistration':'等待候选登记之后的新信号',
 'await-independent-matured-h5-days':'等待新的独立验证日',
 'await-global-trial-budget':'等待研究试验额度恢复',
 'await-next-source-or-research-lineage':'等待新数据或候选',
 'audit-private-research-artifacts-before-retry':'核查研究档案后再继续'};
function headers(){const token=el('token')?.value||'';return {'Content-Type':'application/json',Authorization:'Bearer '+token};}
async function request(url,options={}){const r=await fetch(url,{...options,cache:'no-store',headers:headers()});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'请求未完成');return j;}
el('factorAgentRefresh').addEventListener('click',async()=>{
 const status=el('factorAgentStatus');status.textContent='正在读取研究状态…';
 try{
  const d=await request('/api/research/agent-status'),s=d.agent;
  status.textContent=(names[s.status]||s.status)+' · 下一步：'+(actions[s.nextAction]||s.nextAction||'等待新证据');
  el('factorAgentOutput').textContent=JSON.stringify(s,null,2);
  const list=el('factorAgentCatalog');list.replaceChildren();
  for(const f of d.catalog){const row=document.createElement('p'),a=document.createElement('a');a.href=f.source;a.textContent=f.label;a.target='_blank';a.rel='noopener noreferrer';row.append(a,document.createTextNode(' · '+f.formula));list.append(row);}
 }catch(e){status.textContent=e.message;el('factorAgentOutput').textContent='';el('factorAgentCatalog').replaceChildren();}
});
el('publicFactorRun').addEventListener('click',async()=>{
 const file=el('publicFactorFile').files?.[0],status=el('publicFactorStatus');
 if(!file){status.textContent='请选择带来源和原始发布时间的历史JSON';return;}
 if(file.size>2*1024*1024){status.textContent='文件不能超过2MiB';return;}
 status.textContent='正在计算研究因子…';
 try{const payload=JSON.parse(await file.text());const d=await request('/api/research/public-factors',{method:'POST',body:JSON.stringify(payload)});
  el('publicFactorOutput').textContent=JSON.stringify(d.result,null,2);status.textContent='研究因子已计算；缺失和无效数据保留为未知。';
 }catch(e){status.textContent=e.message;el('publicFactorOutput').textContent='';}
});
})();
