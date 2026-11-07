/* V6 UI diagnostic: read-only, no simulated orders, no credentials in output. */
(function(){
  'use strict';
  const box=document.getElementById('v6UiHealth');
  const btn=document.getElementById('v6UiHealthRun');
  if(!box||!btn)return;
  let pending=false;
  const set=(msg,kind)=>{box.textContent=msg;box.dataset.status=kind;box.setAttribute('role','status');};
  async function run(){
    if(pending)return;
    pending=true;btn.disabled=true;set('正在检查页面结构与服务连接…','checking');
    try{
      const mobile=!!document.getElementById('tabBar');
      const ids=mobile?['app','tabBar','tab-overview','tab-market','tab-plan']:['mkt','v6-market','v6-paper','v6-release'];
      const missing=ids.filter(id=>!document.getElementById(id));
      if(missing.length){set('页面组件异常：缺少 '+missing.join('、')+'。请刷新或清除旧页面缓存。','error');return;}
      const token=(()=>{try{return localStorage.getItem('qd_device')||localStorage.getItem('qd_token')||'';}catch{return '';}})();
      // Same-origin only. Existing desktop fetch wrapper may attach an in-memory token.
      const url='/api/state'+(mobile&&token?'?token='+encodeURIComponent(token):'');
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(response.status===401||response.status===403){set('页面结构正常；当前会话无权读取行情，请重新登录。','warning');return;}
      if(!response.ok){set('页面结构正常；服务返回 HTTP '+response.status+'，行情未验证。','warning');return;}
      const data=await response.json();
      if(!data||typeof data!=='object'){set('服务返回的数据格式异常，请检查接口。','error');return;}
      set('页面结构正常 · 服务已响应 · 检查时间 '+new Date().toLocaleTimeString('zh-CN',{hour12:false})+'。此检查不代表行情新鲜或策略已验收。','ok');
    }catch(e){set('服务检查失败：'+(e&&e.name==='TimeoutError'?'请求超时':'网络或数据错误')+'；请检查连接与登录状态。','error');}
    finally{pending=false;btn.disabled=false;}
  }
  btn.addEventListener('click',run);
})();
