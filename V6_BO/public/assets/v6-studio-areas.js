/* V6 Studio independent research, verification and paper views — read-only. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const set=(id,value)=>{const n=$(id);if(n)n.textContent=value==null?'—':String(value);};
  const safe=x=>String(x==null?'':x).slice(0,350);
  const n=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
  const number=(x,d=2)=>n(x)==null?'未提供':x.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d});
  const token=()=>{try{return localStorage.getItem('qd_device')||localStorage.getItem('qd_token')||'';}catch{return '';}};
  let generation=0;
  async function read(path){
    const u=new URL(path,window.location.origin);
    if(u.origin!==window.location.origin||!u.pathname.startsWith('/api/'))throw Error('无效接口');
    const t=token();
    const r=await fetch(u.pathname+u.search,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(t?{Authorization:'Bearer '+t}:{})}});
    if(t!==token())throw Error('授权已变化，请重新读取');
    if(!r.ok)throw Error('HTTP '+r.status);
    const d=await r.json();
    if(d?.locked)throw Error('需要重新验证授权，禁止展示旧私密数据');
    if(d?.ok===false)throw Error(safe(d.error||d.note||'接口未就绪'));
    if(d?.isMock===true||d?.simulated===true)throw Error('接口返回演示数据，不能作为研究结论');
    return d;
  }
  function message(id,txt,failed=false){const n0=$(id);if(!n0)return;n0.textContent=txt;n0.className=failed?'alert error':'alert';}
  function clearResearch(){
    for(const key of ['rule14','bazi','gpt','python']){set('count-'+key,'—');set('status-'+key,'等待服务端证据');}
    set('research-asof','未提供');
  }
  function clearVerify(){for(const id of ['verify-stocks','verify-signals','verify-basis','verify-source'])set(id,'未读取');}
  function invalidate(){
    generation++;clearPrivate();clearResearch();clearVerify();
    for(const id of ['paper-status','research-status','verify-status'])message(id,'授权或连接已变化，旧结果已清除，请重新读取。',true);
    const btn=$('paper-read');if(btn)btn.disabled=false;
  }
  async function research(){
    const seq=++generation;clearResearch();
    try{
      const d=await read('/api/reference-strategy-stats');
      if(seq!==generation)return;
      const rows=d?.items||{};
      const keys=['rule14','bazi','gpt','python'];
      for(const key of keys){
        const x=rows[key],attributed=x&&x.status==='attributed'&&n(x.count)!=null;
        set('count-'+key,attributed?number(x.count,0)+' 只':'待独立归因');
        set('status-'+key,attributed?'已收到独立归因的数据':'暂无可核验的策略归因');
      }
      set('research-asof',d.asOf?new Date(d.asOf).toLocaleString('zh-CN'):'未提供');
      message('research-status','已读取策略归因摘要。这里只显示服务端明确标注的策略命中数量；没有来源时不推测。');
    }catch(e){if(seq!==generation)return;clearResearch();message('research-status','策略研究数据未就绪：'+safe(e.message),true);}
  }
  async function verify(){
    const seq=++generation;clearVerify();
    try{
      const d=await read('/api/v6/matches?limit=1');
      if(seq!==generation)return;
      if(d.scope!=='quant-picks-six-rules'||d.completeForScope!==true)throw Error('来源完整性未认证');
      set('verify-stocks',number(d.totalStocks,0));
      set('verify-signals',number(d.totalSignals,0));
      set('verify-basis',d.asOf?new Date(d.asOf).toLocaleString('zh-CN'):'未提供');
      set('verify-source','量化六条件扫描快照 · 范围已确认');
      message('verify-status','已找到完整的六条件候选快照。它不是未来收益认证，也不证明四套策略已经统一。');
    }catch(e){if(seq!==generation)return;clearVerify();message('verify-status','尚无可用的完整扫描快照：'+safe(e.message),true);}
  }
  function clearPrivate(){
    ['paper-pool-name','paper-pool-equity','paper-pool-pnl','paper-pool-cash','paper-pool-positions',
     'paper-pre-name','paper-pre-equity','paper-pre-pnl','paper-pre-cash','paper-pre-positions'].forEach(id=>set(id,'未读取'));
    for(const id of ['paper-pool-audit','paper-pre-audit'])set(id,'待验证');
  }
  function projectPaper(prefix,d){
    set(prefix+'-name',safe(d.name||'模拟账户'));
    set(prefix+'-equity',number(d.equity));
    set(prefix+'-pnl',n(d.totalPct)==null?'待核验':number(d.totalPct)+'%');
    set(prefix+'-cash',number(d.cash));
    set(prefix+'-positions',Array.isArray(d.positions)?number(d.positions.length,0)+' 只':'未返回');
    const a=d.audit;
    set(prefix+'-audit',a?.replica===true?'副本实例 · 以线上账户为准':a?.ok===true?'服务端对账未报错':a?.ok===false?'存在对账异常，请勿按本页数值下单':'未返回对账状态');
  }
  async function paper(){
    const seq=++generation;
    const btn=$('paper-read');if(btn)btn.disabled=true;
    clearPrivate();
    message('paper-status','正在验证开发者权限并读取模拟账户的只读快照…');
    try{
      const d=await read('/api/paper');
      if(seq!==generation)return;
      if(!d.paper?.pool||!d.paper?.pre)throw Error('账户结构未返回');
      projectPaper('paper-pool',d.paper.pool);
      projectPaper('paper-pre',d.paper.pre);
      message('paper-status','仅显示既有模拟账户快照。资产估值可能引用上个交易日数据；不发送订单或修改持仓。');
    }catch(e){if(seq!==generation)return;clearPrivate();message('paper-status','未获得安全的模拟账户快照：'+safe(e.message),true);}
    finally{if(seq===generation&&btn)btn.disabled=false;}
  }
  function init(){
    window.addEventListener('offline',invalidate);window.addEventListener('pagehide',invalidate);
    window.addEventListener('storage',e=>{if(['qd_device','qd_token'].includes(e.key)||e.key===null)invalidate();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();});
    const page=document.body.dataset.page;
    if(page==='research')research();
    if(page==='validation')verify();
    if(page==='paper'){clearPrivate();const btn=$('paper-read');if(btn)btn.addEventListener('click',paper);}
    const refresh=$('area-refresh');
    if(refresh)refresh.addEventListener('click',()=>{if(page==='research')research();if(page==='validation')verify();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
