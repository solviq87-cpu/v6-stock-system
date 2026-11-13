/* Standalone radar reads existing market evidence without computing a scanner. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id),tabs=[...document.querySelectorAll('[data-tab]')];
  const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  const fmt=v=>num(v)==null?'—':v.toLocaleString('zh-CN',{maximumFractionDigits:2});
  const token=()=>{try{return localStorage.getItem('qd_device')||localStorage.getItem('qd_token')||'';}catch{return '';}};
  const labels={sh:'上证指数',sz:'深证成指',cyb:'创业板指',kc50:'科创50'};
  let generation=0;
  function select(name){
    tabs.forEach(t=>{const active=t.dataset.tab===name;t.setAttribute('aria-selected',String(active));
      t.tabIndex=active?0:-1;$(t.dataset.tab).hidden=!active;});
  }
  tabs.forEach((t,i)=>{
    t.id='tab-'+t.dataset.tab;t.setAttribute('aria-controls',t.dataset.tab);
    $(t.dataset.tab).setAttribute('aria-labelledby',t.id);
    t.addEventListener('click',()=>select(t.dataset.tab));
    t.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();const next=tabs[(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
      select(next.dataset.tab);next.focus();
    });
  });
  function render(items={},source=''){
    $('indexes').replaceChildren();
    for(const [key,label] of Object.entries(labels)){
      const x=items[key],card=document.createElement('article');card.className='metric';
      const title=document.createElement('small'),value=document.createElement('strong'),change=document.createElement('span'),evidence=document.createElement('span');
      title.textContent=label;value.textContent=fmt(x?.price);
      const pct=num(x?.changePct);change.textContent=pct==null?'涨跌未知':(pct>0?'+':'')+fmt(pct)+'%';
      const time=num(x?.quoteAt),validTime=time!==null&&time>0&&Number.isFinite(new Date(time).getTime());
      evidence.textContent='来源：'+String(x?.quoteSource||x?.source||source||'未知').slice(0,80)+' · 报价时间：'+
        (validTime?new Date(time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知');
      card.append(title,value,change,evidence);$('indexes').append(card);
    }
  }
  function invalidate(){generation++;render();$('status').textContent='数据不可用';$('freshness').textContent='报价时间未知';
    $('notice').textContent='授权或连接已变化，旧指数已清除，请重新读取。';$('refresh').disabled=false;}
  async function load(){
    const seq=++generation,b=$('refresh'),t=token();b.disabled=true;render();
    $('notice').textContent='正在读取现有指数证据…';
    try{
      const r=await fetch('/api/reference-indexes',{method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json',...(t?{Authorization:'Bearer '+t}:{})}});
      if(seq!==generation)return;
      if(t!==token())throw Error('授权已变化');
      if(!r.ok)throw Error('HTTP '+r.status);
      const d=await r.json();if(seq!==generation)return;
      if(!d||d.ok===false||d.locked===true||d.isMock===true||d.simulated===true)throw Error('接口未返回可核验数据');
      if(!d.items||Array.isArray(d.items)||typeof d.items!=='object')throw Error('指数结构无法识别');
      render(d.items,d.source);
      const known=Object.keys(labels).filter(k=>num(d.items[k]?.price)>0).length;
      $('status').textContent=known?'已读取 '+known+' 项指数 · 非实时认证':'指数未就绪';
      $('freshness').textContent='逐票报价时间见指数卡；接收时点不替代报价时间';
      $('notice').textContent='板块、市场广度、风险均未独立核验；指数快照不代表市场强弱结论。';
    }catch(e){if(seq!==generation)return;render();$('status').textContent='数据不可用';$('freshness').textContent='报价时间未知';
      $('notice').textContent='指数接口不可用，旧结果已清除：'+String(e.message||e).slice(0,120);}
    finally{if(seq===generation)b.disabled=false;}
  }
  $('refresh').addEventListener('click',load);
  window.addEventListener('offline',invalidate);window.addEventListener('pagehide',invalidate);
  window.addEventListener('storage',e=>{if(['qd_device','qd_token'].includes(e.key)||e.key===null)invalidate();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();});
  select('overview');load();
})();
