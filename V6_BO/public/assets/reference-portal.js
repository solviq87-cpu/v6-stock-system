/* Reference-inspired V6 portal. Presentation and deep links only.
 * All counts remain unknown until the real V6 controller reports them. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&root.document)api.install(root);
})(typeof window==='object'?window:globalThis,function(){
'use strict';
// The 11-tab main homepage is the existing #vx-dashboard. The reference
// screenshot below is only the review subpage and must not hijack / or /m.
const MAIN_TABS=Object.freeze([
 ['首页','/#vx-dashboard'],['行情','/#v6-market'],['选股','/picks.html'],
 ['策略','/#v6-strategy'],['回测','/#workspace-analysis'],
 ['复盘','/#v6-review'],['资讯','/#v6-news'],['资金流','/#sectors'],
 ['风控','/#holdSec1'],['模拟盘','/#v6-paper'],['我的','/#workspace-settings']
]);
const LINKS=[
 ['⌂','首页','/#vx-dashboard'],['▥','盘面总览','/#v6-market'],
 ['🌐','外围市场','/#global'],['🎯','选股核心','/#v6-stock'],
 ['▣','我的持仓','/#holdSec1'],['⇄','模拟盘','/#v6-paper'],
 ['▤','消息面','/#v6-news'],['▣','明日计划','/#v6-plan'],
 ['◈','我的十四条','/#myrules'],['◎','复盘·学习','/#v6-review'],
 ['▦','工具','/#workspace-analysis']
];
const ACTIONS=[
 {title:'选股核心',detail:'四套策略与评分',icon:'🎯',href:'/#v6-stock',accent:'cyan'},
 {title:'涨停预测',detail:'候选与风险',icon:'◎',href:'/#preselect',accent:'violet'},
 {title:'板次日接力',detail:'首板与连板',icon:'🚀',href:'/#yierList',accent:'pink'},
 {title:'趋势票池',detail:'趋势与资金',icon:'▥',href:'/#trendPool',accent:'cyan'},
 {title:'盘中异动',detail:'实时状态以原始时间为准',icon:'⚡',href:'/#amTopBox',accent:'amber'},
 {title:'风控控制',detail:'账户权限保护',icon:'🛡',href:'/#holdSec1',accent:'red'},
 {title:'模拟盘',detail:'持仓与成交',icon:'⇄',href:'/#v6-paper',accent:'cyan'},
 {title:'我的持仓',detail:'盯盘与风险',icon:'▣',href:'/#holdSec1',accent:'violet'}
];
const METRICS=[
 ['今日涨停总数','ztCount','只'],['首板','', '只'],['连板','', '只'],
 ['题材数','','条'],['炸板','','只'],['5日线上','','只'],['破前高','','只']
];
const MARKET=[
 ['市场主线排行','/#mainline','主线与涨停结构','cyan'],
 ['涨停板 · 板块分类','/#ztBySector','题材及连板梯队','violet'],
 ['板块资金排行','/#sectors','主力净流入/净流出','pink']
];
function make(doc,tag,cls,value){
 const e=doc.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;
}
function safeHref(href){return /^\/(?:[a-z0-9-]+\.html)?(?:#[A-Za-z][\w-]*)?$/.test(href);}
function install(root){
 const doc=root.document;
 function start(){
  const dash=doc.getElementById('vx-dashboard');
  if(!dash||doc.getElementById('v6ReferencePortal'))return;
  const portal=make(doc,'section','v6-reference-portal');
  portal.id='v6ReferencePortal';
  portal.setAttribute('aria-label','天枢智策 V6 一键直达工作台');
  const mast=make(doc,'div','v6-portal-mast');
  const brand=make(doc,'div','v6-portal-brand');
  brand.append(make(doc,'span','v6-portal-mark','△'));
  const words=make(doc,'div');
  words.append(make(doc,'h1','','天枢智策 V6'),make(doc,'p','','AI量化选股 · 多策略 · 多源行情 · 实盘/模拟一体化'));
  brand.append(words);
  const right=make(doc,'div','v6-portal-status');
  const source=make(doc,'span','','数据源：以实际服务状态为准');
  const updated=make(doc,'span','','更新：等待有效快照');
  const badge=make(doc,'span','v6-portal-state','● 待核验');
  right.append(source,updated,badge);
  mast.append(brand,right);
  const nav=make(doc,'nav','v6-portal-nav');
  nav.setAttribute('aria-label','一键进入各功能模块');
  for(const [icon,label,href] of LINKS){
   if(!safeHref(href))continue;
   const a=make(doc,'a','v6-portal-navlink',icon+' '+label);
   a.href=href;
   if(label==='首页')a.setAttribute('aria-current','page');
   nav.append(a);
  }
  const heading=make(doc,'div','v6-portal-heading');
  const title=make(doc,'strong','','复盘 · 学习');
  const subtitle=make(doc,'span','','每日复盘 · 涨停形态与归因');
  const refresh=make(doc,'span','v6-portal-updated','数据状态以原系统为准');
  heading.append(title,subtitle,refresh);
  const metricGrid=make(doc,'div','v6-portal-metrics');
  const metricValues=[];
  for(const [name,id,unit] of METRICS){
   const href=name==='今日涨停总数'?'/#v6-review':'/#review';
   const a=make(doc,'a','v6-portal-metric');a.href=href;
   const label=make(doc,'span','',name);
   const val=make(doc,'strong','','—');
   const suffix=make(doc,'small','',unit+' · 待核验');
   a.append(label,val,suffix);metricGrid.append(a);
   metricValues.push({id,val,suffix});
  }
  const triple=make(doc,'div','v6-portal-triple');
  for(const [title,href,detail,tone] of MARKET){
   const a=make(doc,'a','v6-portal-panel v6-portal-'+tone);
   a.href=href;
   a.append(make(doc,'h2','',title+' ›'),make(doc,'p','',detail));
   const lines=make(doc,'div','v6-portal-panel-placeholder');
   lines.append(make(doc,'span','','真实数据请点开查看'),make(doc,'span','','不会展示演示行情'));
   a.append(lines);triple.append(a);
  }
  // Three reference panels mirror the original V6 market, limit-up sector
  // and capital-flow DOM. Never fabricate a chart or overwrite source data.
  const liveRankSources=[
    {id:'mainline',title:'市场主线排行'},
    {id:'ztBySector',title:'涨停板 · 板块分类'},
    {id:'sectors',title:'板块资金排行'}
  ];
  const rankHosts=[...triple.querySelectorAll('.v6-portal-panel')];
  const rankObserver=typeof root.MutationObserver==='function'?new root.MutationObserver(()=>queueRanks()):null;
  let rankPending=false;
  let rankDisconnected=false;
  function queueRanks(){
    if(rankPending)return;
    rankPending=true;
    Promise.resolve().then(()=>{rankPending=false;renderRanks();});
  }
  function renderRanks(){
    liveRankSources.forEach((entry,index)=>{
      const source=doc.getElementById(entry.id),host=rankHosts[index];
      if(!host)return;
      let container=host.querySelector('.v6-portal-live-ranking');
      if(!container){
        container=make(doc,'div','v6-portal-live-ranking');
        host.querySelector('.v6-portal-panel-placeholder')?.replaceWith(container);
        if(!container.parentElement)host.append(container);
      }
      container.replaceChildren();
      if(rankDisconnected){
        container.append(make(doc,'p','v6-portal-no-data','行情连接中断 · 排行榜已停止实时展示，请进入原模块核对历史时点。'));
        return;
      }
      // #sectors is a table: direct children can be a single TBODY, so
      // extract individual TD rows instead of rendering the entire table as
      // one giant line. Other two sources are card containers.
      const rows=source?(entry.id==='sectors'
        ?[...source.querySelectorAll('tr')].filter(node=>node.querySelector('td'))
        :[...source.children].filter(node=>node.textContent?.trim())):[];
      if(!rows.length){
        container.append(make(doc,'p','v6-portal-no-data','暂无可核验的原系统排行数据，点击进入查看来源和日期。'));
        return;
      }
      const subset=rows.slice(0,6);
      for(const row of subset){
        const line=make(doc,'div','v6-portal-rank-row');
        const parts=String(row.textContent||'').replace(/\s+/g,' ').trim();
        line.textContent=parts.slice(0,140);
        container.append(line);
      }
      container.append(make(doc,'small','v6-portal-rank-source','展示原模块已渲染数据 · 请点开核验时点'));
    });
  }
  for(const entry of liveRankSources){
    const source=doc.getElementById(entry.id);
    if(source&&rankObserver)rankObserver.observe(source,{childList:true,subtree:true,characterData:true});
  }
  renderRanks();
  // A disconnected dashboard must not keep presenting retained sector rows as
  // if they were current. Preserve the old source DOM for historical review.
  root.addEventListener?.('v6-dashboard-offline',()=>{
    rankDisconnected=true;
    renderRanks();
  });
  root.addEventListener?.('v6-dashboard-data',()=>{
    rankDisconnected=false;
    queueRanks();
  });
  const table=make(doc,'section','v6-portal-table');
  table.append(make(doc,'h2','','每日复盘 · 涨停形态与归因'));
  const tableHint=make(doc,'p','','涨停数量、股票名单、封板强度及原因以原复盘接口为准。点击进入查看逐股证据。');
  table.append(tableHint);
  const chips=make(doc,'div','v6-portal-chips');
  for(const [name,href] of [['全部涨停','/#v6-review'],['首板','/#review'],['连板','/#review'],['市场主线','/#mainline'],['今日新高','/#v6-stock'],['逐股事件证据','/#review']]){
   const a=make(doc,'a','',name+' ↗');a.href=href;chips.append(a);
  }
  table.append(chips);
  const actions=make(doc,'div','v6-portal-actions');
  for(const item of ACTIONS){
   const a=make(doc,'a','v6-portal-action v6-portal-'+item.accent);
   a.href=item.href;
   a.append(make(doc,'span','v6-portal-action-icon',item.icon));
   const desc=make(doc,'span');
   desc.append(make(doc,'strong','',item.title),make(doc,'small','',item.detail));
   a.append(desc);actions.append(a);
  }
  const foot=make(doc,'div','v6-portal-footer');
  const more=make(doc,'button','','▦ 全部功能 · 搜索直达');
  more.type='button';
  more.addEventListener('click',()=>root.V6FeatureHub?.open?.());
  foot.append(make(doc,'span','','每个卡片均指向现有模块 · 未经核验的行情不显示数字'),more);
  portal.append(mast,nav,heading,metricGrid,triple,table,actions,foot);
  // This reference is the REVIEW subpage, never the global homepage.
  // Preserve #vx-dashboard as the true homepage and its live data controllers.
  const reviewModule=doc.getElementById('v6-review')?.closest('.workspace-module');
  if(!reviewModule)return;
  const reviewHeading=reviewModule.querySelector('.sec');
  if(reviewHeading)reviewHeading.after(portal);
  else reviewModule.prepend(portal);
  // Existing V6 app.js owns the authoritative review view. Reuse its
  // already-rendered DOM and observe its updates; never request a second
  // potentially inconsistent quote/review source.
  const reviewSource=doc.getElementById('review');
  const summarySource=doc.getElementById('rvSummary');
  const timeSource=doc.getElementById('rvTime');
  const detailRows=make(doc,'div','v6-portal-real-rows');
  detailRows.setAttribute('aria-live','polite');
  table.append(detailRows);
  function textValue(node){return String(node?.textContent||'').trim();}
  function reviewSync(){
    const raw=timeSource?textValue(timeSource):'';
    const stale=/非当日|日期未知|可能非当日|过期|失败|未知/.test(raw);
    const countMatch=raw.match(/共\s*(\d{1,4})\s*只涨停/);
    const numbers=summarySource?[...summarySource.querySelectorAll('.tag')].map(x=>textValue(x)):[];
    const findNumber=label=>{
      const row=numbers.find(x=>x.startsWith(label));
      const m=row?.match(/(\d{1,4})/);
      return m?Number(m[1]):null;
    };
    const total=!stale&&countMatch?Number(countMatch[1]):null;
    const vals=[total,findNumber('首板'),findNumber('连板'),findNumber('题材'),
      null,findNumber('站5日线'),findNumber('破前高')];
    for(let i=0;i<metricValues.length;i++){
      const val=vals[i];
      const valid=Number.isSafeInteger(val)&&val>=0&&total!==null;
      metricValues[i].val.textContent=valid?String(val):'—';
      metricValues[i].suffix.textContent=valid?METRICS[i][2]+' · 原复盘快照':METRICS[i][2]+' · 待核验';
    }
    refresh.textContent=raw||'等待服务端复盘';
    detailRows.replaceChildren();
    if(total===null){
      detailRows.append(make(doc,'p','v6-portal-no-data','复盘尚未取得有效的当日数据；历史复盘请打开原版详细列表核对日期。'));
      return;
    }
    // Mirror every currently rendered original review card, not just the
    // first 12. This is source DOM coverage, not a certified market total.
    const cards=[...(reviewSource?.querySelectorAll('.rvc')||[])];
    if(!cards.length){
      detailRows.append(make(doc,'p','v6-portal-no-data','真实复盘统计已到达，股票明细仍在原复盘模块加载中。'));
      return;
    }
    const shown=new Set();
    for(const card of cards){
      const header=card.querySelector('.rvc-h');
      const code=textValue(header?.querySelector('span.muted'));
      const title=textValue(header);
      if(!/^\d{6}$/.test(code)||shown.has(code))continue;
      if(shown.size>=200)break;
      shown.add(code);
      const link=make(doc,'a','v6-portal-stock-row');
      link.href='/#review';
      link.dataset.reviewCode=code;
      link.append(make(doc,'strong','',title.slice(0,100)),
        make(doc,'span','',textValue(card.querySelector('.rvc-reason')).slice(0,170)||'涨停题材及事件原因尚无可核验证据'),
        make(doc,'small','','查看该股票原复盘明细与事件证据（如有） ↗'));
      link.addEventListener('click',event=>{
        const latest=[...(reviewSource?.querySelectorAll('.rvc')||[])].find(row=>
          textValue(row.querySelector('.rvc-h span.muted'))===code);
        if(!latest)return;
        event.preventDefault();
        for(let parent=latest.parentElement;parent;parent=parent.parentElement){
          if(parent.tagName==='DETAILS')parent.open=true;
          if(parent===reviewModule)break;
        }
        const evidence=latest.querySelector('.rv-evidence-trigger');
        if(evidence)evidence.click(); // available when evidence PR is installed
        else latest.scrollIntoView?.({block:'center',behavior:'auto'});
      });
      detailRows.append(link);
    }
    tableHint.textContent='当前原复盘已渲染 '+shown.size+' 条不同证券记录'+
      (cards.length>200?'（最多显示200条；其余请进入原复盘）':'')+
      '；不代表全市场涨停清单已独立核实，题材标签不是涨停原因因果认证。';
  }
  // The source is redrawn by the existing V6 controller; a microtask avoids
  // reading half-written card markup and an observer loop on our own output.
  let pending=false;
  function queueReviewSync(){
    if(pending)return;
    pending=true;
    Promise.resolve().then(()=>{pending=false;reviewSync();});
  }
  if(typeof root.MutationObserver==='function'){
    const observer=new root.MutationObserver(queueReviewSync);
    for(const node of [reviewSource,summarySource,timeSource]){
      if(node)observer.observe(node,{childList:true,subtree:true,characterData:true});
    }
  }
  reviewSync();
  // Reuse the existing market data snapshot. No additional polling/fetching.
  function sync(){
   const value=doc.getElementById('ztCount')?.textContent||'';
   const m=value.match(/(?:^|[^\d])(\d{1,4})\s*只/);
   // A DOM text value alone lacks the source/clock guarantee. Keep unknown
   // until the live controller explicitly provides a trustworthy provenance.
   const state=root.__v6Dashboard;
   const valid=state&&state.trading===true&&state.snapshotRetained!==true&&
     state.dataQuality?.verified===true&&state.snapshotDay;
   if(valid&&m){
     metricValues[0].val.textContent=m[1];
     metricValues[0].suffix.textContent='只 · 原服务端已核验';
   }else{
     metricValues[0].val.textContent='—';
     metricValues[0].suffix.textContent='只 · 待核验';
   }
   const label=state&&state.snapshotDay;
   updated.textContent=typeof label==='string'&&/^\d{8}$/.test(label)?
     '交易日：'+label.slice(0,4)+'-'+label.slice(4,6)+'-'+label.slice(6):'更新：等待有效快照';
   badge.textContent=valid?'● 已核验':'● 待核验';
  }
  sync();
  root.addEventListener?.('v6-dashboard-data',sync);
  root.addEventListener?.('v6-dashboard-offline',()=>{badge.textContent='● 连接中断';metricValues[0].val.textContent='—';});
  // All route anchors still exist in the original legacy controller.
  root.V6ReferencePortal={LINKS,ACTIONS,safeHref};
 }
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
}
return {MAIN_TABS,LINKS,ACTIONS,METRICS,safeHref,install};
});
