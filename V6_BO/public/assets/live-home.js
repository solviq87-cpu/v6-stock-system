/* The main page uses existing #vx-dashboard real V6 widgets, never demo values.
 * This layer only aligns the approved cyber-blue presentation and clickable cards. */
(function(root){
 'use strict';
 const doc=root.document;
 if(!doc)return;
 function init(){
  const dashboard=doc.getElementById('vx-dashboard');
  if(!dashboard||doc.getElementById('v6LiveHomeNav'))return;
  const routes=[
   ['首页','/#vx-dashboard'],['行情','/#v6-market'],['选股','/picks.html'],
   ['策略','/#v6-strategy'],['回测','/#workspace-analysis'],
   ['复盘','/#v6-review'],['资讯','/#v6-news'],['资金流','/#sectors'],
   ['风控','/#holdSec1'],['模拟盘','/#v6-paper'],['我的','/#workspace-settings']
  ];
  const nav=doc.createElement('nav');nav.id='v6LiveHomeNav';nav.className='v6-live-home-nav';
  nav.setAttribute('aria-label','天枢智策 V6 首页功能直达');
  for(const [name,href] of routes){
   const a=doc.createElement('a');a.href=href;a.textContent=name;nav.append(a);
  }
  const heading=dashboard.querySelector('.ow-page-heading');
  if(heading)heading.after(nav);
  // Existing cards are live controller outputs. Enhance their click surface
  // only when it cannot interfere with buttons, selects, or stock row actions.
  const targets=[
   ['.vx-signals','/#v6-stock'],['.vx-strategies','/#v6-strategy'],
   ['.vx-mood','/#v6-market'],['.vx-environment','/#holdSec1'],
   ['.vx-risk-panel','/#holdSec1'],['.vx-performance','/#workspace-analysis'],
   ['.vx-push-panel','/#vx-pushes']
  ];
  for(const [selector,href] of targets){
   const card=dashboard.querySelector(selector);if(!card)continue;
   card.classList.add('v6-live-clickable');
   card.tabIndex=0;
   card.setAttribute('role','link');
   card.setAttribute('aria-label',(card.querySelector('h2')?.textContent||'查看模块').trim()+' · 查看详情');
   const go=()=>root.location.assign(href);
   card.addEventListener('click',e=>{
    if(e.target.closest('a,button,input,select,textarea,summary,[role=tab],[data-vx-index]'))return;
    go();
   });
   card.addEventListener('keydown',e=>{
    if(e.target!==card||!['Enter',' '].includes(e.key))return;
    e.preventDefault();go();
   });
  }
  // Only the existing dashboard data event is used; no independent API calls.
  const connection=doc.createElement('span');connection.className='v6-live-home-provenance';
  connection.setAttribute('role','status');
  connection.textContent='行情数据等待原服务端核验';
  nav.after(connection);
  function sync(data){
   if(!data||!Number.isFinite(data.observedAt)||data.observedAt>Date.now()||
      Date.now()-data.observedAt>180000){
    connection.textContent='行情可能过期或未验证 · 不作为自动交易依据';
    return;
   }
   const day=typeof data.snapshotDay==='string'?data.snapshotDay:'未知';
   connection.textContent='服务端快照日 '+day+' · 来源 '+String(data.source||'未知')+
      ' · 接收时间 '+new Date(data.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+
      '（报价新鲜度需逐票核验）';
  }
  sync(root.__v6Dashboard);
  root.addEventListener('v6-dashboard-data',event=>sync(event.detail));
  root.addEventListener('v6-dashboard-offline',()=>{connection.textContent='连接已断开 · 当前快照不能作为实时依据';});
 }
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='object'?window:globalThis);
