(function(root){
 'use strict';
 const labels={original:'原始',revised:'修订',retracted:'已撤稿'};
 const states={superseded:'已被后续版本替代',retracted:'已撤稿 · 不作支持依据',unknown:'时间或原文不完整 · 未知',
  'source-declared-unverified':'来源声明 · 未独立核实'};
 function allowedUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
 const clock=value=>Number.isSafeInteger(value)?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 中国时间':'未知';
 function render(doc,container,result){
  container.replaceChildren();
  for(const row of result.rows||[]){
   const e=row.evidence||{},card=doc.createElement('article');card.className='news-evidence-row';
   const line=(tag,value)=>{const el=doc.createElement(tag);el.textContent=value;card.appendChild(el);return el;};
   line('h4',(labels[e.kind]||'未知')+' · '+(e.title||'无标题'));
   line('p',states[row.supportStatus]||'证据状态未知');
   line('p',(e.source||'来源未知')+' · '+(e.securities||[]).join('、'));
   line('p',e.bodyScope==='provider-summary'?'内容范围：供应商摘要，未取得完整正文':'内容范围：导入正文，未独立核实');
   line('p','发布 '+clock(e.publishedAt)+'；接收 '+clock(e.receivedAt)+'；修订/撤稿 '+clock(e.revisedAt));
   const url=allowedUrl(e.url);
   if(url){const a=doc.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='原始链接 · '+url;card.appendChild(a);}
   else line('p','原始链接未知');
   const details=doc.createElement('details'),summary=doc.createElement('summary');summary.textContent='正文与证据链';details.appendChild(summary);
   const body=doc.createElement('p');body.textContent=e.body||'正文缺失';details.appendChild(body);
   const chain=doc.createElement('p');chain.textContent='版本 '+row.sequence+' · 正文SHA256 '+(e.bodyHash||'未知')+' · 前版 '+(e.supersedes||'无')+' · '+(e.uncertainty||[]).join('；');details.appendChild(chain);
   card.appendChild(details);container.appendChild(card);
  }
 }
 if(typeof module==='object'&&module.exports)module.exports={allowedUrl,clock,render};
 if(!root.document)return;
 const doc=root.document,button=doc.getElementById('newsEvidenceLoad');if(!button)return;
 const token=doc.getElementById('token'),symbolInput=doc.getElementById('newsEvidenceSymbol'),status=doc.getElementById('newsEvidenceStatus'),rows=doc.getElementById('newsEvidenceRows');let generation=0;
 const clear=()=>{generation++;rows.replaceChildren();status.textContent='尚未查询';button.disabled=false;};
 for(const input of [token,symbolInput])for(const event of ['input','change'])input?.addEventListener(event,clear);
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear();});
 root.addEventListener?.('pagehide',clear);
 root.addEventListener?.('offline',clear);
 button.addEventListener('click',async()=>{
  const g=++generation,secret=token?.value.trim()||'',symbol=symbolInput.value.trim();
  const active=()=>g===generation&&secret===(token?.value.trim()||'')&&symbol===symbolInput.value.trim()&&!doc.hidden;
  rows.replaceChildren();status.textContent='读取新闻证据…';button.disabled=true;
  try{
   if(symbol&&!/^\d{6}$/.test(symbol))throw Error('请输入六位证券代码');
   const response=await fetch('/api/research/news-evidence'+(symbol?'?symbol='+encodeURIComponent(symbol):''),{
    headers:secret?{Authorization:'Bearer '+secret}:{},cache:'no-store'});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'权限不足或证据不可用');
   if(!active())return;
   render(doc,rows,data.result);const s=data.result.summary;
   status.textContent=s.currentEvents?'当前事件 '+s.currentEvents+' · 已撤稿 '+s.retractedEvents+' · 未知 '+s.unknownEvents+' · 完整来源声明 '+s.eligibleForResearchSupport:'暂无已归档新闻；不能据此断言无风险';
  }catch(e){if(active()){rows.replaceChildren();status.textContent='证据未知：'+e.message;}}
  finally{if(active())button.disabled=false;}
 });
})(typeof window==='object'?window:globalThis);
