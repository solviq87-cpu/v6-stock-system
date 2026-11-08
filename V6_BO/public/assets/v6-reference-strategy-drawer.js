(() => {
  'use strict';
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const legacy=[['legacy:rule14','十四条选股'],['legacy:bazi','八字口诀'],['legacy:gpt','GPT 五策略'],['legacy:python','Python 三轮']];
  const rank=$('.ranking');
  if(!rank)return;
  const bar=document.createElement('div');
  bar.className='v6-strategy-quick';
  bar.setAttribute('aria-label','全部选股策略');
  bar.innerHTML='<span>策略股票</span>'+legacy.map(([id,name])=>'<button type="button" data-quick-strategy="'+id+'">'+name+'</button>').join('')+
    '<button type="button" data-quick-strategy="__all__">全部策略 / 新增战法</button>';
  const rankTabs=rank.querySelector('.rank-tabs');
  rankTabs?.insertAdjacentElement('afterend',bar);
  const drawer=document.createElement('div');
  drawer.className='v6-strategy-drawer';
  drawer.hidden=true;
  drawer.innerHTML='<div class="v6-drawer-shade" data-close></div><section class="v6-drawer-sheet" role="dialog" aria-modal="true" aria-labelledby="v6-drawer-title">'+
    '<div class="v6-drawer-head"><strong id="v6-drawer-title">策略选股</strong><button type="button" data-close aria-label="关闭策略抽屉">×</button></div>'+
    '<p class="v6-drawer-meta" id="v6-drawer-status">正在读取策略来源</p>'+
    '<label class="v6-drawer-search">搜索策略/股票 <input id="v6-drawer-search" placeholder="输入名称或代码"></label>'+
    '<div class="v6-drawer-groups" id="v6-drawer-groups"></div>'+
    '<div class="v6-drawer-stocks" id="v6-drawer-stocks"></div>'+
    '<div class="v6-drawer-detail" id="v6-drawer-detail"></div></section>';
  document.body.append(drawer);
  let selected='__all__',catalog=[],items=[],error=null,search='';
  let previousFocus=null;
  function open(id){
    previousFocus=document.activeElement;
    selected=id;drawer.hidden=false;document.body.classList.add('v6-drawer-open');
    render();drawer.querySelector('[data-close]')?.focus();
    refresh();
  }
  function close(){
    drawer.hidden=true;document.body.classList.remove('v6-drawer-open');previousFocus?.focus?.();
  }
  function button(e){const trigger=e.target.closest('[data-quick-strategy]');if(trigger)open(trigger.dataset.quickStrategy)}
  bar.addEventListener('click',button);
  drawer.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',close));
  drawer.addEventListener('keydown',e=>{if(e.key==='Escape'){close();return;}
    if(e.key==='Tab'){const controls=[...drawer.querySelectorAll('button,input,a')].filter(x=>x.offsetParent!==null);
      if(!controls.length)return;const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}
      else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
    }});
  drawer.querySelector('#v6-drawer-search').addEventListener('input',e=>{search=e.target.value.trim().toLowerCase();render()});
  async function refresh(){
    error=null;
    try{
      const response=await fetch('/api/dashboard-strategy-catalog',{headers:{accept:'application/json'},cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json();
      if(!data.ok||!Array.isArray(data.catalog)||!Array.isArray(data.items))throw Error('接口返回无效');
      catalog=data.catalog;items=data.items;
      error=data.source==='unconfigured'?'尚未配置合格行情快照，策略结果暂为空':null;
    }catch(e){catalog=[];items=[];error='接口暂不可用：'+(e?.message||'未知错误')}
    render();
  }
  function render(){
    const title=selected==='__all__'?'全部策略 / 新增战法':(catalog.find(x=>x.id===selected)?.label||legacy.find(x=>x[0]===selected)?.[1]||selected);
    drawer.querySelector('#v6-drawer-title').textContent=title;
    drawer.querySelector('#v6-drawer-status').textContent=error||'只展示有真实策略归属证据的股票；研究候选不代表交易指令';
    const groups=new Map();
    for(const [id,label] of legacy){if(!groups.has('原有四套体系'))groups.set('原有四套体系',[]);
      groups.get('原有四套体系').push({id,label,status:'provenance-required'});}
    for(const c of catalog){if(!groups.has(c.group))groups.set(c.group,[]);groups.get(c.group).push(c);}
    drawer.querySelector('#v6-drawer-groups').innerHTML=[...groups].map(([g,arr])=>
      '<div class="v6-drawer-group"><strong>'+esc(g)+'</strong><div>'+
      arr.filter(s=>!search||s.label.toLowerCase().includes(search)||s.id.toLowerCase().includes(search)).map(s=>
      '<button type="button" data-id="'+esc(s.id)+'" class="'+(selected===s.id?'active':'')+'">'+esc(s.label)+'</button>').join('')+
      '</div></div>').join('');
    drawer.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{selected=b.dataset.id;render()});
    const stocks=selected==='__all__'?items.filter(x=>x.matchedIds?.length):items.filter(x=>x.matchedIds?.includes(selected));
    const matching=stocks.filter(x=>!search||String(x.symbol).toLowerCase().includes(search)||String(x.name).toLowerCase().includes(search));
    const target=drawer.querySelector('#v6-drawer-stocks');
    if(!matching.length){
      const planned=catalog.find(x=>x.id===selected)?.status;
      target.innerHTML='<div class="v6-drawer-empty">'+
        (planned==='not-integrated'?'该策略仍为研究候选，尚未接入运行引擎':
        selected.startsWith('legacy:')?'原有策略尚缺逐票归属数据，不能用其他策略股票冒充':
        error||'当前没有可核验的命中股票')+'</div>';
    }else{
      target.innerHTML='<table><thead><tr><th>股票</th><th>评分</th><th>数据状态</th><th>分析</th></tr></thead><tbody>'+
        matching.map(x=>'<tr><td>'+esc(x.name)+' <small>'+esc(x.symbol)+'</small></td><td>'+esc(x.score??'--')+
          '</td><td>'+esc(x.dataStatus)+'</td><td><button type="button" data-stock="'+esc(x.symbol)+'">查看</button></td></tr>').join('')+'</tbody></table>';
    }
    target.querySelectorAll('[data-stock]').forEach(b=>b.onclick=()=>{
      const x=matching.find(row=>row.symbol===b.dataset.stock);if(!x)return;
      drawer.querySelector('#v6-drawer-detail').innerHTML='<strong>'+esc(x.name)+' ('+esc(x.symbol)+')</strong><p>命中：'+
        esc(x.matchedIds.filter(id=>selected==='__all__'||id===selected).map(id=>catalog.find(s=>s.id===id)?.label||id).join('、'))+
        '</p><p>观察日期：'+esc(x.asOf||'未提供')+'　· 数据状态：'+esc(x.dataStatus)+'</p>'+
        '<a href="/reference-dashboard.html?code='+encodeURIComponent(x.symbol)+'">查看该股K线与风险分析</a>';
    });
  }
})();