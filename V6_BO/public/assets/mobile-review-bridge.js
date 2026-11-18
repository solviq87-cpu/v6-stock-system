/* Mobile review bridge: one service, existing mobile digest DOM, no new requests.
 * The compact panel is a preview, not a second independently computed review. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&root.document)api.install(root);
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const ROUTES=Object.freeze([
  ['复盘','/#v6-review'],['资金流','/#sectors'],
  ['风险与持仓','/#holdSec1'],['全部功能','/#workspace-settings']
 ]);
 function clean(value,limit=120){
  return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,limit);
 }
 function model(input={}){
  const status=clean(input.status,150);
  const retained=/休市|最近交易日|快照|非实时|断开|离线|上次画面|未开盘/.test(status);
  const zt=clean(input.zt,140)||'涨停数据尚未就绪';
  const sector=clean(input.sector,140)||'板块数据尚未就绪';
  const rows=Array.isArray(input.sectorRows)?input.sectorRows.map(x=>clean(x,110)).filter(Boolean).slice(0,5):[];
  return {zt,sector,rows,source:retained?'最近展示状态／非实时 · '+(status||'数据时点未核验'):
   '共享速览数据 · 原始报价时间仍须逐股核验',hasData:!!rows.length};
 }
 function install(root){
  const doc=root.document;
  function start(){
   if(!doc.body?.classList.contains('mobile-workspace'))return;
   const app=doc.getElementById('app');
   const mood=doc.getElementById('moodCard');
   const nav=doc.querySelector('.v6-mobile-reference-nav');
   if(!app||!mood||!nav||doc.getElementById('v6MobileReviewBridge'))return;
   for(const [label,href] of ROUTES){
    if([...nav.querySelectorAll('a[href]')].some(a=>a.getAttribute('href')===href))continue;
    const a=doc.createElement('a');a.href=href;a.textContent=label;
    a.className='v6-mobile-review-link';nav.append(a);
   }
   const section=doc.createElement('section');
   section.id='v6MobileReviewBridge';
   section.className='v6-mobile-review-bridge';
   section.setAttribute('aria-label','复盘与板块速览');
   const heading=doc.createElement('div');heading.className='v6-mobile-review-title';
   const h2=doc.createElement('h2');h2.textContent='复盘 · 板块联动';
   const link=doc.createElement('a');link.href='/#v6-review';
   link.textContent='完整涨停复盘 ›';
   heading.append(h2,link);
   const status=doc.createElement('p');status.className='v6-mobile-review-provenance';
   status.setAttribute('role','status');
   const grid=doc.createElement('div');grid.className='v6-mobile-review-grid';
   function card(title,href){
    const a=doc.createElement('a');a.className='v6-mobile-review-card';a.href=href;
    const name=doc.createElement('span');name.textContent=title;
    const value=doc.createElement('strong');value.textContent='等待原服务端数据';
    a.append(name,value);grid.append(a);return value;
   }
   const zt=card('涨停池 · 当前速览','/#v6-review');
   const sector=card('板块 · 当前速览','/#sectors');
   const ranked=doc.createElement('div');ranked.className='v6-mobile-review-ranked';
   const caption=doc.createElement('h3');caption.textContent='板块速览 · 原模块前五行';
   const list=doc.createElement('ol');ranked.append(caption,list);
   const note=doc.createElement('p');note.className='v6-mobile-review-note';
   note.textContent='此处仅复用手机已有的行情速览，不代表全市场涨停清单或逐股原因认证。完整复盘、来源日期与事件证据请打开原业务模块。';
   section.append(heading,status,grid,ranked,note);
   // The same shared-digest preview belongs in the visible mobile terminal.
   // Place it after the live index strip when the terminal is mounted; the
   // legacy authenticated card remains the safe fallback on older shells.
   const modern=doc.getElementById('vx-dashboard')?.querySelector('.vx-market-strip');
   if(modern&&app.contains(modern))modern.after(section);
   else mood.after(section);
   const read=()=>({
    status:doc.getElementById('sub')?.textContent,
    zt:doc.getElementById('ztMeta')?.textContent,
    sector:doc.getElementById('secMeta')?.textContent,
    sectorRows:[...(doc.getElementById('secBody')?.querySelectorAll('.row')||[])].map(x=>x.textContent)
   });
   function render(){
    const value=model(read());
    status.textContent=value.source;
    zt.textContent=value.zt;
    sector.textContent=value.sector;
    list.replaceChildren();
    if(!value.hasData){
     const li=doc.createElement('li');li.textContent='板块数据待加载';list.append(li);
    }else{
     for(const row of value.rows){
      const li=doc.createElement('li');li.textContent=row;list.append(li);
     }
    }
   }
   let queued=false;
   function queue(){
    if(queued)return;
    queued=true;
    Promise.resolve().then(()=>{queued=false;render();});
   }
   if(typeof root.MutationObserver==='function'){
    const observer=new root.MutationObserver(queue);
    for(const id of ['sub','ztMeta','secMeta','secBody']){
     const node=doc.getElementById(id);
     if(node)observer.observe(node,{childList:true,subtree:true,characterData:true});
    }
   }
   root.addEventListener?.('offline',queue);
   root.addEventListener?.('online',queue);
   render();
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
 }
 return {ROUTES,clean,model,install};
});
