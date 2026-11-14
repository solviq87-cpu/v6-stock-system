(function(root){
'use strict';
const doc=root.document,el=id=>doc?.getElementById(id);if(!el('factorAgentStatus'))return;
el('factorAgentStatus').style.overflowWrap='anywhere';
const names={unconfigured:'尚未配置研究数据',planning:'正在制定研究计划',reflection:'已记录研究结果',idle:'等待新的数据或候选',
 'needs-data':'等待有来源的数据','preview-ready':'研究预检就绪',
 'blocked-invalid-agent-journal':'研究记忆校验未通过',unchanged:'数据与研究血缘未变化',
 'research-cycle-completed-not-certified':'本轮研究流程已完成','failed-stop-and-audit-before-retry':'已暂停，需核查研究档案'};
const actions={'run-capture-research-cycle':'封存今天的研究信号','run-observe-research-cycle':'观察已冻结信号的后续表现','provide-current-day-authorized-source':'等待今天收盘后带来源的数据','provide-causal-current-day-picks-and-factor-evidence':'补齐选股当时的因子证据','configure-private-research-agent':'配置研究数据与独立存储',
 'provide-sealed-prior-research-or-explicit-preregistration':'准备封存研究报告或事前候选',
 'await-preregistered-prefix-h5-maturity':'等待已冻结样本成熟','await-signals-frozen-after-preregistration':'等待候选登记之后的新信号',
 'await-independent-matured-h5-days':'等待新的独立验证日','await-global-trial-budget':'等待研究试验额度恢复',
 'await-next-source-or-research-lineage':'等待新数据或候选','audit-private-research-artifacts-before-retry':'核查研究档案后再继续'};
let epoch=0,active=null;
function sync(){el('factorAgentRefresh').disabled=false;el('publicFactorRun').disabled=active?.kind==='run';}
function empty(){el('factorAgentOutput').textContent='';el('factorAgentCatalog').replaceChildren();el('publicFactorOutput').textContent='';}
function clear(message='数据或凭据已变化，请重新读取',privateInput=false){epoch++;const old=active;active=null;old?.controller.abort();empty();if(privateInput)el('publicFactorFile').value='';el('factorAgentStatus').textContent=message;el('publicFactorStatus').textContent=message;sync();}
function current(c){return c.id===epoch&&c.token===(el('token')?.value.trim()||'')&&!doc.hidden&&root.navigator?.onLine!==false&&(c.kind!=='run'||c.file===el('publicFactorFile').files?.[0]);}
function valid(c){return current(c)&&!c.controller.signal.aborted;}
async function json(url,options,c){const response=await root.fetch(url,{...options,signal:c.controller.signal,cache:'no-store',headers:{'Content-Type':'application/json',...(c.token?{Authorization:'Bearer '+c.token}:{})}});if(response.status===401||response.status===403){const e=Error('权限已失效，请重新认证');e.denied=true;throw e;}const value=await response.json();if(value?.locked||value?.needPassword){const e=Error('权限已失效，请重新认证');e.denied=true;throw e;}if(!response.ok||!value?.ok)throw Error('请求未完成，请稍后重试');return value;}
async function run(kind){
 if(doc.hidden||root.navigator?.onLine===false){clear('页面隐藏或网络离线，请恢复后重新读取',true);return;}
 const file=el('publicFactorFile').files?.[0];if(kind==='run'&&(!file||file.size>2*1024*1024)){el('publicFactorStatus').textContent=file?'文件不能超过2MiB':'请选择带来源和原始发布时间的历史JSON';return;}
 const id=++epoch;active?.controller.abort();const c={id,kind,file,token:el('token')?.value.trim()||'',controller:new AbortController()};active=c;empty();sync();
 const status=el(kind==='run'?'publicFactorStatus':'factorAgentStatus');status.textContent=kind==='run'?'正在计算研究因子…':'正在读取研究状态…';let timedOut=false;
 const aborted=new Promise((_,reject)=>c.controller.signal.addEventListener('abort',()=>{const e=Error('aborted');e.name='AbortError';reject(e);},{once:true}));
 const timer=root.setTimeout(()=>{timedOut=true;c.controller.abort();},kind==='run'?60000:15000);
 try{await Promise.race([(async()=>{
  if(kind==='run'){const payload=JSON.parse(await file.text());if(!valid(c))return;const d=await json('/api/research/public-factors',{method:'POST',body:JSON.stringify(payload)},c);if(!valid(c))return;el('publicFactorOutput').textContent=JSON.stringify(d.result,null,2);status.textContent='研究因子已计算；缺失和无效数据保留为未知。';}
  else{const d=await json('/api/research/agent-status',{},c);if(!valid(c))return;const s=d.agent;if(!s||typeof s!=='object')throw Error('研究状态格式无效');
   const model=typeof s.modelName==='string'?s.modelName.slice(0,60):'未记录',digest=typeof s.modelDigest==='string'?s.modelDigest.slice(0,16):'未记录';
   status.textContent=(names[s.status]||s.status)+' · 下一步：'+(actions[s.nextAction]||s.nextAction||'等待新证据')+' · 建议模型：'+model+' / 摘要 '+digest;
   el('factorAgentOutput').textContent=JSON.stringify(s,(k,v)=>/^(?:hypothesis|hypotheses|fullHypothesis|prompt|systemPrompt|userPrompt)$/i.test(k)?undefined:v,2);
   for(const f of Array.isArray(d.catalog)?d.catalog:[]){const row=doc.createElement('p'),a=doc.createElement('a');a.href=f.source;a.textContent=f.label;a.target='_blank';a.rel='noopener noreferrer';row.append(a,doc.createTextNode(' · '+f.formula));el('factorAgentCatalog').append(row);}
  }
 })(),aborted]);}catch(e){if(current(c)){if(e.denied)clear('权限已失效，私有研究已清空；请重新认证',true);else{empty();status.textContent=timedOut?'等待超时，请重新读取；已提交的服务端研究可能继续执行':'未完成：'+(e.name==='SyntaxError'?'JSON格式无效':e.message);}}}
 finally{root.clearTimeout(timer);if(id===epoch){active=null;sync();}}
}
el('factorAgentRefresh').addEventListener('click',()=>run('read'));el('publicFactorRun').addEventListener('click',()=>run('run'));
el('publicFactorFile').addEventListener('change',()=>clear());for(const event of ['input','change'])el('token')?.addEventListener(event,()=>clear(undefined,true));
root.addEventListener?.('offline',()=>clear('网络离线，私有研究已清空',true));root.addEventListener?.('pagehide',()=>clear('页面已离开，私有研究已清空',true));doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear('页面隐藏，私有研究已清空',true);});
sync();
})(typeof window==='object'?window:globalThis);
