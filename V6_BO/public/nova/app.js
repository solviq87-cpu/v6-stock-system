import {h,button,field,formButton,icon,note,empty,dateTime,dayLabel} from './ui.js';
import {createClient,getSession,saveSession,deviceId,retainMarket} from './client.js';
import {renderPulse,renderOpportunities,createStockDrawer,rowsFrom,POOLS} from './market.js';

const root=document.getElementById('fayo-root');
const MAIN=[['pulse','脉冲','pulse'],['opportunities','机会','spark'],['lab','实验室','lab'],['assets','资产','assets'],['settings','中枢','settings']];
const ALIASES={
 '/picks.html':['opportunities','quant'],'/auction-picks.html':['opportunities','auction'],
 '/research.html':['lab','desk'],'/model-library.html':['lab','models'],
 '/v6-studio.html':['pulse','overview'],'/v6-matches.html':['opportunities','matches'],
 '/v6-research.html':['lab','strategies'],'/v6-validation.html':['lab','backtest'],
 '/v6-paper.html':['assets','paper'],'/v6-market-radar.html':['pulse','sectors'],
 '/reference-dashboard.html':['pulse','sectors']
};
const LEGACY_ANCHORS={holdSec1:['assets','holdings'],holdSec2:['assets','holdings'],'v6-paper':['assets','paper'],'v6-market':['pulse','sectors'],'v6-stock':['opportunities','quant'],'v6-news':['inbox','all'],'v6-plan':['pulse','plans'],'v6-review':['pulse','review'],'v6-strategy':['lab','strategies'],'v6-release':['settings','release'],'workspace-settings':['settings','preferences'],researchWorkspace:['lab','records'],decisionWorkspace:['lab','desk'],newsEvidence:['lab','evidence'],stockCapture:['lab','sources'],linkedIntelligence:['lab','memory'],completeHeading:['lab','backtest'],learningWorkbench:['lab','learning']};
let authInfo=null,state=null,role=null,route={view:'pulse',sub:'overview'},selectedStock=(/^\d{6}$/.test(new URLSearchParams(location.search).get('symbol')||'')?new URLSearchParams(location.search).get('symbol'):''),frame=null,main=null,connection=null,snapshot=null,toast=null,drawer=null,routeController=null,sessionController=null,refreshBusy=false,refreshWanted=false,online=true,lastRead=0,poll=null,searchController=null,gateGeneration=0;
const poolCache=new Map(),listeners=new Set();
const client=createClient({onUnauthorized:()=>logout('本次授权已失效，请重新登录。')});
const api=(path,options)=>client.api(path,options);
function notify(message,tone='') {
 if(!toast){toast=h('div',{class:'fy-toast',role:'status','aria-live':'polite'});document.body.append(toast);}
 toast.className='fy-toast '+tone;toast.textContent=String(message||'');toast.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>{if(toast)toast.hidden=true;},6000);
}
function parseRoute() {
 const hash=location.hash.slice(1);
 if(hash.startsWith('/')){const[view='pulse',sub='']=hash.slice(1).split('/');if([...MAIN.map(x=>x[0]),'inbox'].includes(view))return {view,sub};}
 if(LEGACY_ANCHORS[hash])return {view:LEGACY_ANCHORS[hash][0],sub:LEGACY_ANCHORS[hash][1]};
 const alias=ALIASES[location.pathname]||['pulse','overview'];return {view:alias[0],sub:alias[1]};
}
function navigate(view,sub='') {
 const target='#/'+view+(sub?'/'+sub:'');
 if(location.hash===target){if(role)renderRoute();return;}
 location.hash=target;
}
function findStock(code) {
 const candidates=[...rowsFrom(state?.dashboard?.rows),...rowsFrom(state?.pool),...rowsFrom(state?.trendPool),...[...poolCache.values()].flatMap(value=>rowsFrom(value.items||value))];
 return candidates.find(row=>row.code===code)||null;
}
function selectStock(code,row){if(!role)return;selectedStock=code;drawer.open(code,row);}
async function readPool(key,loader) {
 const result=await loader();
 const items=rowsFrom(result?.items||result);
 const previous=poolCache.get(key),closed=state?.trading===false||state?.isSnapshot===true||state?.dashboard?.isSnapshot===true||result?.isSnapshot===true;
 if(!items.length&&closed&&rowsFrom(previous?.items||previous).length)return {...previous,isSnapshot:true,snapshotRetained:true,note:'保留上次有效的最近交易日结果'};
 if(items.length)poolCache.set(key,result);
 return result;
}
function context(signal) {
 return {
  get state(){return state;},get auth(){return authInfo;},get role(){return role;},get canEdit(){return role==='edit';},get stock(){return selectedStock;},
  signal,api,refresh:()=>refresh(true),navigate,selectStock,findStock,notify,logout,passwordCreated:()=>{authInfo={...authInfo,hasPassword:true};},
  readPool,onState(fn){listeners.add(fn);signal?.addEventListener('abort',()=>listeners.delete(fn),{once:true});return ()=>listeners.delete(fn);}
 };
}
function snapshotStatus() {
 if(!connection||!snapshot)return;
 connection.textContent=!online?'连接中断 · 保留上次内容':lastRead?'最近读取 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(lastRead):'正在读取云端';
 connection.dataset.offline=String(!online);
 const historical=state?.trading===false||state?.isSnapshot===true||state?.dashboard?.isSnapshot===true;
 snapshot.hidden=!state||(!historical&&online);
 if(!online)snapshot.textContent='连接暂时中断 · 当前保留上次成功读取的快照，恢复网络后自动核对。';
 else if(historical)snapshot.textContent='保留快照 / '+dayLabel(state.dashboard?.snapshotDay||state.snapshotFieldDays?.dashboard||state.snapshotDay)+'　行情与股票池保留最近交易日，新闻与公告继续更新。';
}
function createFrame() {
 const brand=h('a',{class:'fy-brand',href:'#/pulse/overview','aria-label':'绯曜 FAYO 首页'},h('img',{src:'/nova/mark.svg',width:'40',height:'40',alt:''}),h('span',{},h('strong',{},'绯曜'),h('small',{},'FAYO')));
 const nav=h('nav',{class:'fy-nav','aria-label':'主要工作空间'}),dock=h('nav',{class:'fy-dock','aria-label':'手机主要工作空间'});
 for(const[view,label,key]of MAIN){
  nav.append(h('button',{type:'button','data-fy-route':view,onClick:()=>navigate(view)},icon(key),h('span',{},label)));
  dock.append(h('button',{type:'button','data-fy-route':view,onClick:()=>navigate(view)},icon(key),h('span',{},label)));
 }
 connection=h('span',{class:'fy-status','aria-live':'polite'});
 const search=button(icon('search'),openSearch,'quiet');search.setAttribute('aria-label','搜索股票与功能');search.setAttribute('aria-keyshortcuts','Control+K Meta+K');
 const refreshButton=button(icon('refresh'),()=>refresh(true),'quiet');refreshButton.setAttribute('aria-label','刷新云端数据');
 const inbox=button(icon('bell'),()=>navigate('inbox','all'),'quiet');inbox.setAttribute('aria-label','资讯与通知');
 const identity=button(role==='edit'?'管理者':'观察者',openIdentity,'quiet');identity.setAttribute('aria-label','账户与授权');
 const actions=h('div',{class:'fy-actions'},search,refreshButton,inbox,identity);
 const header=h('header',{class:'fy-header'},brand,nav,actions);
 main=h('main',{class:'fy-main',id:'fayo-content',tabindex:'-1'});
 snapshot=h('div',{class:'fy-snapshot',role:'status',hidden:true});
 const meta=h('div',{class:'fy-connection-bar'},h('span',{},'你的投资研究空间'),connection);
 frame=h('div',{class:'fayo-app'},h('a',{class:'fy-skip',href:'#fayo-content'},'跳转到主要内容'),header,meta,snapshot,main,dock);
 root.replaceChildren(frame);
 drawer=createStockDrawer(context(null));root.append(drawer.element);
 snapshotStatus();
}
async function renderRoute() {
 if(!role||!main)return;
 route=parseRoute();if(route.view==='lab'&&!['desk','records','strategies','backtest','learning','models','sources','memory','evidence'].includes(route.sub))route.sub='desk';routeController?.abort();listeners.clear();routeController=new AbortController();
 const controller=routeController,ctx=context(controller.signal);
 frame.querySelectorAll('[data-fy-route]').forEach(node=>{const active=node.dataset.fyRoute===route.view;node.dataset.current=String(active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
 document.title='绯曜 FAYO · '+(MAIN.find(x=>x[0]===route.view)?.[1]||'资讯');
 try {
  if(route.view==='pulse')main.replaceChildren(renderPulse(route,ctx));
  else if(route.view==='opportunities')main.replaceChildren(renderOpportunities(route,ctx));
  else {
   main.replaceChildren(h('div',{class:'fy-loading',role:'status'},'正在打开工作空间…'));
   const module=route.view==='lab'?await import('./research.js'):await import('./operations.js');
   if(controller.signal.aborted)return;
   const view=route.view==='lab'?await module.renderResearch(route,ctx):await module.renderOperations(route,ctx);
   if(controller.signal.aborted)return;
   main.replaceChildren(view);
   if(route.view==='lab'){const extra=await import('./research-extensions.js');if(!controller.signal.aborted)extra.appendResearchExtensions(view,route,ctx);}
  }
 }catch(error){if(controller.signal.aborted)return;main.replaceChildren(empty('该工作空间暂时未能打开',error.message),button('重新打开',renderRoute));notify(error.message,'error');}
 window.scrollTo({top:0,behavior:'instant'});
}
async function refresh(manual=false) {
 if(!role)return;
 if(refreshBusy){if(manual)refreshWanted=true;return;}
 refreshBusy=true;
 const controller=sessionController;
 try {
  const incoming=await api('/api/state',{signal:controller?.signal});
  if(!role||controller?.signal.aborted)return;
  state=retainMarket(state,incoming);lastRead=Date.now();online=true;snapshotStatus();
  if(!main?.firstElementChild||main.firstElementChild.classList.contains('fy-loading'))await renderRoute();
  else if(route.view==='pulse'&&route.sub==='market-overview'&&!main.contains(document.activeElement))main.replaceChildren(renderPulse(route,context(routeController.signal)));
  for(const listener of [...listeners])try{listener(state);}catch(error){console.error('FAYO view update failed',error.name);}
  drawer?.update?.();
  if(manual)notify('已读取同一份云端状态');
 }catch(error){if(!role||controller?.signal.aborted)return;online=false;snapshotStatus();if(manual)notify(error.message,'error');}
 finally{refreshBusy=false;if(refreshWanted){refreshWanted=false;if(role)refresh(false);}}
}
function logout(message='') {
 gateGeneration++;role=null;state=null;lastRead=0;poolCache.clear();listeners.clear();routeController?.abort();sessionController?.abort();client.invalidate();clearInterval(poll);drawer?.clear();drawer=null;searchController?.abort();document.querySelector('.fy-command-layer')?.remove();saveSession('','');selectedStock='';showGate(message);
}
async function enter(nextRole) {
 gateGeneration++;role=nextRole==='edit'?'edit':'view';sessionController?.abort();sessionController=new AbortController();createFrame();main.replaceChildren(h('div',{class:'fy-loading',role:'status'},'正在读取你的云端状态…'));await refresh(false);if(!role)return;await renderRoute();subscribeChanges(sessionController);clearInterval(poll);poll=setInterval(()=>{if(document.visibilityState==='visible')refresh(false);},15000);
}
async function subscribeChanges(controller) {
 // Fetch-based SSE keeps the credential in a header and retains periodic reads
 // as a fallback. An event invalidates the view; it is never used as a price.
 while(role&&!controller.signal.aborted) {
  try {
   const token=getSession(),query=new URLSearchParams({dev:deviceId(),dname:'绯曜设备'});
   const response=await fetch('/api/stream?'+query,{headers:{Accept:'text/event-stream',...(token?{Authorization:'Bearer '+token}:{})},cache:'no-store',signal:controller.signal});
   if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream'))return;
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(role&&!controller.signal.aborted){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>131072)buffer=buffer.slice(-65536);let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.includes('data:')&&Date.now()-lastRead>1000)refresh(false);}}
  }catch(error){if(controller.signal.aborted)return;}
  if(controller.signal.aborted||!role)return;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}

function showGate(message='') {
 const turn=++gateGeneration;clearInterval(poll);role=null;
 const password=h('input',{type:'password',name:'password',autocomplete:'current-password',placeholder:'输入现有访问口令',required:true,maxlength:128}),name=h('input',{name:'device-name',autocomplete:'off',placeholder:'例如：我的手机',maxlength:80,value:'绯曜研究设备'}),mode=h('select',{'aria-label':'登录身份'},h('option',{value:'auto'},'自动识别身份'),h('option',{value:'edit'},'开发者'),h('option',{value:'view'},'只读观察者'));
 const status=note(message||'账户与历史继续使用原有服务，访问授权由服务端确认。');
 const submit=h('button',{type:'submit',class:'fy-button primary'},authInfo?.hasPassword===false?'创建口令并进入绯曜':'进入绯曜');
 const form=h('form',{class:'fy-gate-form',onSubmit:async event=>{
  event.preventDefault();submit.disabled=true;status.textContent='正在验证…';
  try {
   const settingUp=authInfo?.hasPassword===false;
   const result=await api(settingUp?'/api/lock/setup':'/api/lock/unlock',{method:'POST',body:settingUp?{password:password.value,role:'edit'}:{password:password.value,role:mode.value,fp:deviceId(),name:name.value||'绯曜设备'}});
   if(turn!==gateGeneration)return;
   password.value='';
   if(result.pending&&result.req){status.textContent='申请已提交，等待开发者批准此设备。';waitApproval(result.req,turn,status);return;}
   const token=result.deviceToken||result.token;
   if(!token)throw Error('服务端没有签发可用授权');saveSession(token,result.role||'view');const auth=await api('/api/lock/status');if(!auth.role)throw Error('身份尚未确认');authInfo=auth;await enter(auth.role);
  }catch(error){if(turn===gateGeneration){status.textContent=error.message;status.className='fy-note error';}}
  finally{submit.disabled=false;}
 }},h('img',{src:'/nova/mark.svg',width:56,height:56,alt:''}),h('span',{class:'fy-eyebrow'},'FAYO / YOUR RESEARCH SPACE'),h('h1',{},'欢迎来到绯曜。'),h('p',{class:'fy-muted'},'从市场脉冲，到有据可循的判断。'),field('访问口令',password),field('这台设备的名称',name),field('身份',mode),submit,status);
 const code=h('input',{placeholder:'输入设备授权码',autocomplete:'one-time-code',maxlength:80});
 const codePanel=h('details',{class:'fy-details'},h('summary',{},'使用设备授权码'),field('授权码',code),button('兑换并登录',async()=>{try{const r=await api('/api/auth/redeem',{method:'POST',body:{code:code.value,name:name.value,fp:deviceId()}});code.value='';if(!r.token)throw Error('授权码尚未兑换成功');saveSession(r.token,r.role);const auth=await api('/api/lock/status');authInfo=auth;await enter(auth.role);}catch(error){status.textContent=error.message;status.className='fy-note error';}}));
 const phone=h('input',{type:'tel',placeholder:'已绑定手机号'}),otp=h('input',{autocomplete:'one-time-code',placeholder:'收到的验证码'}),newPassword=h('input',{type:'password',autocomplete:'new-password',placeholder:'新的开发者口令',minlength:8,maxlength:128});let ticket='',resetToken='';
 const recovery=h('details',{class:'fy-details'},h('summary',{},'找回访问口令'),field('已绑定手机号',phone),button('请求验证码',async()=>{try{const r=await api('/api/lock/forgot',{method:'POST',body:{phone:phone.value}});ticket=r.ticket||'';status.textContent=r.note||r.message||'请查看已配置的私密验证码通道';}catch(error){status.textContent=error.message;}}),field('验证码',otp),button('验证身份',async()=>{try{const r=await api('/api/lock/verify-code',{method:'POST',body:{ticket,code:otp.value}});resetToken=r.resetToken||'';status.textContent=resetToken?'身份已核验，可以设置新口令':'等待服务端核验';otp.value='';}catch(error){status.textContent=error.message;}}),field('新口令',newPassword),button('重设口令',async()=>{try{if(!resetToken)throw Error('请先完成验证码核验');const r=await api('/api/lock/reset-pwd',{method:'POST',body:{resetToken,newPassword:newPassword.value,fp:deviceId(),name:name.value}});newPassword.value='';resetToken='';status.textContent='口令已重设，请重新登录';if(r.token){saveSession(r.token,r.role||'edit');await enter('edit');}}catch(error){status.textContent=error.message;}}));
 form.append(codePanel,recovery);
 root.replaceChildren(h('main',{class:'fy-gate'},h('div',{class:'fy-gate-art'},h('img',{src:'/nova/mark.svg',width:88,height:88,alt:''}),h('strong',{},'绯曜'),h('span',{},'FAYO'),h('p',{},'市场 · 机会 · 证据 · 资产')),form));
}
async function waitApproval(request,turn,status) {
 const until=Date.now()+5*60000;
 while(turn===gateGeneration&&Date.now()<until){
  await new Promise(resolve=>setTimeout(resolve,3000));if(turn!==gateGeneration)return;
  try{const r=await api('/api/lock/pending-status?req='+encodeURIComponent(request));if(r.token){saveSession(r.token,r.role||'view');await enter(r.role||'view');return;}if(r.denied||r.rejected){status.textContent='设备申请未获批准';return;}}catch(error){if(turn!==gateGeneration)return;status.textContent=error.message;}
 }
 if(turn===gateGeneration)status.textContent='等待已结束，可重新提交设备申请。';
}
function openIdentity(){
 document.querySelector('.fy-command-layer')?.remove();searchController?.abort();
 const previous=document.activeElement;
 const close=()=>{layer.remove();previous?.focus?.();};
 const dialog=h('section',{class:'fy-command',role:'dialog','aria-modal':'true','aria-label':'身份与访问'},h('header',{class:'fy-inline'},h('h2',{},'身份与访问'),button('关闭',close,'quiet')),note(role==='edit'?'当前身份：管理者':'当前身份：只读观察者'),h('div',{class:'fy-stack'},button('访问安全与设备',()=>{close();navigate('settings','security');}),button('切换登录身份',()=>{close();logout('请输入要切换的访问口令。');},'primary'),button('退出当前会话',()=>{close();logout('已退出此浏览器会话。');},'quiet')));
 const layer=h('div',{class:'fy-command-layer'},dialog);layer.addEventListener('click',event=>{if(event.target===layer)close();});
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('button')].filter(n=>!n.disabled),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
 document.body.append(layer);dialog.querySelector('button').focus();
}

function openSearch() {
 document.querySelector('.fy-command-layer')?.remove();searchController?.abort();
 const controller=new AbortController();searchController=controller;
 const previous=document.activeElement,results=h('div',{class:'fy-command-results'}),input=h('input',{type:'search',placeholder:'搜索股票、观察池或工作空间','aria-label':'搜索股票与工作空间'}),status=note('输入名称或六位代码；也可以直接打开一个工作空间。');
 const close=()=>{controller.abort();layer.remove();previous?.focus?.();};
 const closeButton=button(icon('close'),close,'quiet');closeButton.setAttribute('aria-label','关闭搜索');
 const dialog=h('section',{class:'fy-command',role:'dialog','aria-modal':'true','aria-label':'全局搜索'},h('header',{class:'fy-inline'},icon('search'),input,closeButton),status,results);
 const layer=h('div',{class:'fy-command-layer'},dialog);layer.addEventListener('click',event=>{if(event.target===layer)close();});dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('button,input,a[href],select')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
 const destinations=[...MAIN.map(([view,label])=>({label,view,sub:''})),...POOLS.map(([sub,label])=>({label,view:'opportunities',sub})),{label:'资讯与通知',view:'inbox',sub:'all'},{label:'设备授权',view:'settings',sub:'devices'},{label:'历史研究记录',view:'lab',sub:'records'},{label:'回测实验',view:'lab',sub:'backtest'}];
 function showDestinations(query=''){results.replaceChildren(h('div',{class:'fy-list'},destinations.filter(item=>!query||item.label.includes(query)).map(item=>button(item.label,()=>{close();navigate(item.view,item.sub);},'quiet'))));}
 let timer,epoch=0;
 input.addEventListener('input',()=>{const query=input.value.trim();clearTimeout(timer);const turn=++epoch;showDestinations(query);if(query.length<2)return;timer=setTimeout(async()=>{try{status.textContent='搜索中…';const r=await api('/api/search?q='+encodeURIComponent(query),{signal:controller.signal});if(turn!==epoch||controller.signal.aborted)return;const rows=rowsFrom(r.items||r.results||r);status.textContent='找到 '+rows.length+' 只股票';if(rows.length)results.prepend(h('div',{class:'fy-list'},rows.slice(0,15).map(row=>button(row.name+' / '+row.code,()=>{close();selectStock(row.code,row);},'quiet'))));}catch(error){if(!controller.signal.aborted)status.textContent=error.message;}},250);});
 showDestinations();document.body.append(layer);input.focus();
}
addEventListener('hashchange',()=>{if(role)renderRoute();});
addEventListener('offline',()=>{online=false;snapshotStatus();});
addEventListener('online',()=>{if(role)refresh(false);});
addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&role&&Date.now()-lastRead>15000)refresh(false);});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&role){event.preventDefault();openSearch();}});
(async()=>{
 try {
  const status=await api('/api/lock/status');authInfo=status;
  if(status.role||status.local)await enter(status.role||'edit');else showGate();
 }catch(error){showGate(error.message);}
 if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();
