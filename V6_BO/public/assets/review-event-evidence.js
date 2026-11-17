(function(root){
'use strict';
// Read-only, per-stock context in the existing limit-up review. A tagged topic
// or same-security news item is NOT a verified cause for a price move.
const DAY_MS=86400000;
const VALID_START=946684800000,VALID_END=4102444800000;
function validTime(t){return Number.isSafeInteger(t)&&t>=VALID_START&&t<VALID_END;}
function reviewCutoff(date){
 const s=String(date||'').replace(/-/g,'');
 if(!/^\d{8}$/.test(s))return null;
 const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
 const closeAt=Date.parse(iso+'T15:00:00+08:00');
 if(!validTime(closeAt)||new Date(closeAt+8*3600000).toISOString().slice(0,10)!==iso)return null;
 return {day:s,closeAt};
}
function allowedUrl(value){
 try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}
 catch{return null;}
}
function clock(value){
 return validTime(value)?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 北京时间':'未知';
}
function classify(row,closeAt){
 const e=row.evidence||{};
 if(e.kind==='retracted'||row.supportStatus==='retracted')return {key:'retracted',label:'已撤稿 · 不得作为支持依据'};
 if(row.current!==true||row.supportStatus==='superseded')return {key:'superseded',label:'已被修订版本替代 · 不得作为现行依据'};
 if(!validTime(e.publishedAt)||!validTime(e.receivedAt)||!validTime(row.recordedAt))
  return {key:'unknown',label:'原始发布时间／收录时间不完整 · 无法判断当日可见性'};
 if(e.publishedAt>closeAt)return {key:'postclose',label:'收盘后发布 · 不能解释当日盘中涨停'};
 if(e.receivedAt>closeAt||row.recordedAt>closeAt)
  return {key:'late',label:'收盘后才收录 · 不能证明盘中已知'};
 if(e.publishedAt<closeAt-7*DAY_MS)return {key:'old',label:'7天以前的旧闻 · 不能当成当日事件'};
 return {key:'context',label:'收盘前已收录的关联线索 · 并非涨停因果认证'};
}
function view(result,{code,date,limit=8}={}){
 const day=reviewCutoff(date);
 if(!/^\d{6}$/.test(String(code||''))||!day||!Number.isSafeInteger(limit)||limit<1||limit>20)
  throw Error('INVALID_REVIEW_EVIDENCE_QUERY');
 if(!result||!Array.isArray(result.rows)||result.rows.length>200)
  throw Error('INVALID_NEWS_EVIDENCE_RESPONSE');
 const byEvent=new Map();
 for(const row of result.rows){
  if(!row||!row.evidence||!Array.isArray(row.evidence.securities)||!row.evidence.securities.includes(code))continue;
  const e=row.evidence;
  const k=JSON.stringify([e.source,e.eventId]);
  if(!byEvent.has(k)||Number(row.sequence)>Number(byEvent.get(k).sequence))byEvent.set(k,row);
 }
 const all=[...byEvent.values()].sort((a,b)=>(Number(b.sequence)||0)-(Number(a.sequence)||0));
 return {code,reviewDay:day.day,closeAt:day.closeAt,total:all.length,items:all.slice(0,limit).map(row=>{
  const e=row.evidence;
  return {title:typeof e.title==='string'?e.title:'无标题',source:typeof e.source==='string'?e.source:'来源未知',
   summary:typeof e.body==='string'?e.body.slice(0,350):'未提供摘要或正文',
   bodyScope:e.bodyScope==='provider-summary'?'供应商摘要（未取到公告/新闻完整正文）':'导入正文（尚未独立核实）',
   url:allowedUrl(e.url),kind:e.kind,publishedAt:e.publishedAt,receivedAt:e.receivedAt,
   recordedAt:row.recordedAt,revisedAt:e.revisedAt,sequence:row.sequence,
   status:classify(row,day.closeAt),verified:false};
 })};
}
function append(doc,parent,tag,value,cls){
 const node=doc.createElement(tag);
 if(cls)node.className=cls;
 node.textContent=String(value);
 parent.appendChild(node);
 return node;
}
function render(doc,panel,model){
 panel.replaceChildren();
 append(doc,panel,'p','仅显示已归档且关联该证券代码的新闻线索；题材标签、供应商摘要、行情结构均不能独立证明涨停原因。尚未完成官方公告原文核验。','rv-evidence-note');
 if(!model.items.length){
  append(doc,panel,'p','暂无该股已归档事件。不是“没有利好/利空”，而是当前证据不足。','rv-evidence-empty');
  return;
 }
 append(doc,panel,'p','匹配事件 '+model.total+' 条；展示最近 '+model.items.length+' 条，按归档版本排列。','rv-evidence-count');
 for(const item of model.items){
  const card=doc.createElement('article');
  card.className='rv-event-card rv-event-'+item.status.key;
  append(doc,card,'h4','事件线索：'+item.title);
  append(doc,card,'p',item.status.label,'rv-event-state');
  append(doc,card,'p','来源：'+item.source+' · '+item.bodyScope+' · 来源声明未独立核实');
  append(doc,card,'p','事件实际发生日期：未核实（不能用新闻发布时间代替）。');
  append(doc,card,'p','公司业务关联：供应商仅关联了证券代码，尚无业务合同或公告正文交叉证明。');
  append(doc,card,'p','发布 '+clock(item.publishedAt)+'；接收 '+clock(item.receivedAt)+'；归档 '+clock(item.recordedAt));
  if(item.revisedAt!=null)append(doc,card,'p','修订／撤稿时间 '+clock(item.revisedAt));
  append(doc,card,'p',item.summary,'rv-event-summary');
  if(item.url){
   const a=append(doc,card,'a','查看来源原文（外部网站）');
   a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
  }else append(doc,card,'p','原始链接未取得 · 无法核对','rv-evidence-empty');
  panel.appendChild(card);
 }
}
function bind(doc){
 const review=doc.getElementById('review');
 if(!review||typeof root.fetch!=='function'||!review.parentElement?.parentElement)return;
 const host=review.parentElement.parentElement;
 // Original app.js redraws #review every five seconds. The detail view MUST
 // live outside that ephemeral node or every successful request disappears.
 const drawer=doc.createElement('section');drawer.className='rv-evidence-drawer';drawer.hidden=true;
 drawer.setAttribute('aria-label','涨停逐股事件与来源');drawer.setAttribute('aria-live','polite');
 const toolbar=doc.createElement('div');toolbar.className='rv-evidence-toolbar';
 const heading=doc.createElement('strong');heading.textContent='逐股事件 · 日期与来源';
 const close=doc.createElement('button');close.type='button';close.className='rv-evidence-close';
 close.textContent='关闭证据';close.setAttribute('aria-label','关闭事件证据面板');
 toolbar.appendChild(heading);toolbar.appendChild(close);
 const results=doc.createElement('div');results.className='rv-evidence-results';
 drawer.appendChild(toolbar);drawer.appendChild(results);
 host.insertBefore(drawer,review.parentElement);
 let generation=0,identity=null;
 const authToken=()=>{
   try{return typeof root.getRelToken==='function'?String(root.getRelToken()||''):'';}
   catch{return '';}
 };
 const sameOrigin=path=>new URL(path,root.location&&root.location.href||'http://localhost/').href;
 const clear=()=>{
   generation++;identity=null;drawer.hidden=true;results.replaceChildren();
 };
 close.addEventListener('click',clear);
 function decorate(){
   for(const card of review.querySelectorAll('.rvc:not([data-review-evidence-ready])')){
     card.dataset.reviewEvidenceReady='true';
     const code=String(card.querySelector('.rvc-h span.muted')?.textContent||'').trim();
     if(!/^\d{6}$/.test(code))continue;
     const label=card.querySelector('.rvc-reason');
     if(label)for(const node of label.childNodes){
       if(node.nodeType===3&&node.textContent.includes('🔥 涨停原因：'))
         node.textContent=node.textContent.replace('🔥 涨停原因：','🔥 涨停题材（标签不代表事件因果）：');
     }
     const wrapper=doc.createElement('div');wrapper.className='rv-evidence';
     const button=doc.createElement('button');
     button.className='rv-evidence-trigger';button.type='button';button.dataset.code=code;
     button.textContent='📎 逐股事件 · 日期与来源（点开核对）';
     wrapper.appendChild(button);card.appendChild(wrapper);
   }
 }
 if(typeof root.MutationObserver==='function'){
   new root.MutationObserver(decorate).observe(review,{childList:true,subtree:true});
   const role=doc.getElementById('roleState');
   if(role)new root.MutationObserver(clear).observe(role,{childList:true,characterData:true,subtree:true});
 }
 decorate();
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear();});
 root.addEventListener?.('pagehide',clear);
 root.addEventListener?.('offline',clear);
 root.addEventListener?.('focus',clear);
 review.addEventListener('click',async ev=>{
   const btn=ev.target&&typeof ev.target.closest==='function'?ev.target.closest('.rv-evidence-trigger'):null;
   if(!btn||!review.contains(btn))return;
   const code=btn.dataset.code,auth=authToken(),current=++generation;
   // Clicking the same item closes an already-open evidence panel.
   if(!drawer.hidden&&identity===code){clear();return;}
   identity=code;drawer.hidden=false;heading.textContent='逐股事件 · '+code+' · 日期与来源';
   results.textContent='读取对应复盘日与事件来源…';
   drawer.scrollIntoView?.({block:'nearest',behavior:'auto'});
   const active=()=>current===generation&&identity===code&&!drawer.hidden
     &&authToken()===auth&&!doc.hidden;
   try{
     if(!/^\d{6}$/.test(String(code||'')))throw Error('证券代码无效');
     // Absolute same-origin URLs bypass the legacy fetch shim that appends
     // credentials to /api/ relative paths. Credentials belong ONLY in headers.
     const headers=auth?{Authorization:'Bearer '+auth}:{};
     const stateResponse=await root.fetch(sameOrigin('/api/state'),{
       headers,cache:'no-store',credentials:'same-origin'});
     if(!stateResponse.ok)throw Error('无法校验当前复盘日期');
     const state=await stateResponse.json();if(!active())return;
     const snapshot=state&&state.review,day=String(snapshot&&snapshot.date||'').replace(/-/g,'');
     if(!snapshot||!Array.isArray(snapshot.items)||!snapshot.items.some(x=>x&&x.code===code))
       throw Error('该股票不在当前复盘快照，请刷新页面后重试');
     const shown=doc.getElementById('rvTime')?.textContent||'';
     if(!/^\d{8}$/.test(day)||!shown.includes(day.slice(4,6)+'-'+day.slice(6,8)))
       throw Error('页面复盘归属日与云端不同，请先刷新');
     heading.textContent='逐股事件 · '+code+' · '+day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8);
     const response=await root.fetch(sameOrigin('/api/research/news-evidence?symbol='+encodeURIComponent(code)),{
       headers,cache:'no-store',credentials:'same-origin'});
     if(!response.ok)throw Error('当前权限不足或新闻证据归档暂不可用');
     const data=await response.json();if(!active())return;
     if(!data||data.ok!==true||!data.result)throw Error('证据接口返回不完整');
     render(doc,results,view(data.result,{code,date:day}));
   }catch(e){if(active())results.textContent='证据暂不可核实：'+(e&&e.message||'查询失败')+'。题材标签不得冒充已核实的涨停原因。';}
 });
}
if(typeof module==='object'&&module.exports)module.exports={reviewCutoff,allowedUrl,clock,classify,view,render,bind};
if(root.document){
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>bind(root.document),{once:true});
 else bind(root.document);
}
})(typeof window==='object'?window:globalThis);
