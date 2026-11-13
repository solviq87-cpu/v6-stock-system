(function(root){
 'use strict';
 const doc=root.document;if(!doc)return;
 const el=id=>doc.getElementById(id),button=el('riskCenterRead');if(!button)return;
 const token=el('token'),status=el('riskCenterStatus'),content=el('riskCenterContent');
 let generation=0;
 const labels={market:'市场与来源','manual-holdings':'手工持仓观察',news:'新闻证据','research-agent':'研究代理','strategy-decay':'策略衰减'};
 const agentLabels={unconfigured:'尚未配置',planning:'计划中',reflection:'已有研究记录',idle:'等待新证据',
  'needs-data':'等待有来源的数据','preview-ready':'研究预检就绪','research-cycle-completed-not-certified':'研究流程已完成，尚未认证',
  'blocked-invalid-agent-journal':'档案校验失败','failed-stop-and-audit-before-retry':'已暂停，需核查档案',unchanged:'证据尚无变化'};
 const clock=value=>Number.isSafeInteger(value)&&value>0&&value<=8e15?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 中国时间':'未知';
 const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 function node(tag,value,parent){const n=doc.createElement(tag);if(value!==undefined)n.textContent=value;if(parent)parent.appendChild(n);return n;}
 function block(title){const n=node('article',undefined,content);n.className='card';node('h3',title,n);return n;}
 function list(parent,rows,empty){if(!rows?.length){node('p',empty,parent);return;}const ul=node('ul',undefined,parent);for(const row of rows)node('li',(labels[row.domain]||'证据')+'：'+row.message,ul);}
 function render(result){
  if(result?.mode!=='research-risk-center-readonly'||result.canTrade!==false||result.canNotify!==false||
    !Array.isArray(result.supports)||!Array.isArray(result.contra)||!Array.isArray(result.missing)||
    !result.market||!result.manualHoldings||!result.news||!result.researchAgent||result.strategyDecay?.status!=='unknown')throw Error('shape');
  const market=block('市场与来源质量'),q=result.market.quotes;
  node('p',q?'逐票近期报价 '+q.recent+' / '+q.total+'；过期 '+q.stale+'；未来时点 '+q.future+'；未知 '+q.unknown+'。来源尚未认证。':'市场证据不可用，风险未知。',market);
  node('p','快照接收 '+clock(result.market.receivedAt)+'；接收时间不代替逐票原始报价时点。',market);
  const sourceStatus={unconfigured:'未配置','invalid-or-stale':'校验失败或过期','research-only':'已有未认证研究资料'};
  node('p','可选研究来源：'+(sourceStatus[result.market.optionalStatus]||'未知'),market);
  for(const s of result.market.sources||[]){const labels={observed:'已有来源声明',unavailable:'不可用',timeout:'超时','permission-pending':'等待许可'};node('p',s.provider+' · '+(labels[s.status]||'未知'),market);}
  const holdings=block('手工持仓浮亏与集中度'),h=result.manualHoldings;
  if(h.status!=='evaluated')node('p','持仓资料未配置或未通过校验，浮亏与集中度未知。',holdings);
  else{
   node('p','观察 '+h.positions.length+' 只手工申报持仓；报价不可用 '+h.counts.missingOrUnusableQuotes+' 只。未读取实际账户。',holdings);
   for(const p of h.positions)node('p',p.symbol+' · 成本涨跌 '+(p.drawdownFromCostPct===null?'未知':p.drawdownFromCostPct+'%')+' · 申报仓位 '+(p.weightPct===null?'未知':p.weightPct+'%'),holdings);
  }
  const news=block('新闻修订与撤稿'),n=result.news;
  if(!n.summary)node('p','新闻证据不可用，不能判断当前消息风险。',news);
  else{
   node('p','归档版本 '+n.summary.totalRevisions+'；当前事件 '+n.summary.currentEvents+'；撤稿 '+n.summary.retractedEvents+'；未知 '+n.summary.unknownEvents+'。仅展示最近50个版本。',news);
   if(!n.rows.length)node('p','暂无归档证据，不能据此判断没有风险。',news);
   for(const row of n.rows){
    const entry=node('div',undefined,news),kinds={original:'原始',revised:'修订',retracted:'撤稿'};
    node('h4',(kinds[row.kind]||'未知')+' · '+(row.title||'标题未知'),entry);
    node('p',(row.source||'来源未知')+' · '+(row.current?'当前版本':'已被后版替代')+' · 发布 '+clock(row.publishedAt),entry);
    const url=safeUrl(row.url);if(url){const a=node('a','查看原始来源',entry);a.href=url;a.target='_blank';a.rel='noopener noreferrer';}
   }
  }
  node('p','标题词、来源声明及既有利好利空分类不代表已确认消息。',news);
  const agent=block('研究状态');node('p','研究代理：'+(agentLabels[result.researchAgent.status]||'已有研究状态，尚待核验'),agent);
  node('p','资料日期 '+(result.researchAgent.sourceDay||'未知')+'；最近检查 '+clock(result.researchAgent.checkTime),agent);
  node('p','策略衰减：未知。'+result.strategyDecay.reason,agent);
  const evidence=block('观察依据与缺失项');evidence.className='card risk-center-evidence';
  const columns=node('div',undefined,evidence);columns.className='risk-center-evidence-grid';
  for(const [title,rows,empty] of [['已有观察',result.supports,'尚无足够观察事项；风险保持未知。'],['冲突与限制',result.contra,'尚无可核验的相反证据。'],['缺失证据',result.missing,'没有列出的缺失项也不构成安全认证。']]){
   const column=node('section',undefined,columns);node('h4',title,column);list(column,rows,empty);
  }
 }
 function clear(message='尚未读取；风险未知。'){
  generation++;content.replaceChildren();status.textContent=message;button.disabled=false;
 }
 token?.addEventListener('input',()=>clear());token?.addEventListener('change',()=>clear());
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear('页面已隐藏，私有风险结果已清空。');});
 root.addEventListener?.('pagehide',()=>clear('页面已隐藏，私有风险结果已清空。'));
 root.addEventListener?.('offline',()=>clear('网络离线，私有风险结果已清空。'));
 button.addEventListener('click',async()=>{
  const current=++generation,secret=token?.value.trim()||'';
  content.replaceChildren();status.textContent='正在读取已有风险证据…';button.disabled=true;
  const active=()=>current===generation&&secret===(token?.value.trim()||'')&&!doc.hidden;
  try{
   const response=await root.fetch('/api/research/risk-center',{method:'GET',cache:'no-store',
    headers:secret?{Authorization:'Bearer '+secret}:{}});
   const data=await response.json();if(!active())return;
   if(!response.ok||!data.ok)throw Error('unavailable');
   render(data.result);status.textContent='研究观察 · '+clock(data.result.generatedAt)+'；不代表安全评级或交易建议。';
  }catch{if(active()){content.replaceChildren();status.textContent='读取失败：权限不足或证据不可用；风险未知。';}}
  finally{if(current===generation)button.disabled=false;}
 });
})(typeof window==='object'?window:globalThis);
