import {createQuoteTrail} from './stock-timeline.js';
import {readContext} from './shortline/context.mjs';
import {h,button,field,formButton,icon,note,empty,dateTime,dayLabel} from './ui.js';
import {createClient,getSession,saveSession,deviceId,retainMarket,createSnapshotPoller} from './client.js';
import {renderPulse,renderOpportunities,createStockDrawer,rowsFrom,POOLS,renderDailyReview,reviewDate,projectClosingWorkspace} from './market.js';
import {renderTerminalOverview,renderReferenceReview} from './terminal-workbench.js';

const root=document.getElementById('fayo-root');
const quoteTrail=createQuoteTrail();
const MAIN=[['pulse','脉冲','pulse'],['opportunities','机会','spark'],['lab','实验室','lab'],['assets','资产','assets'],['settings','中枢','settings']];
/* Two user-supplied reference screens. Labels are navigation only, never trading commands. */
const REFERENCE_TOP=[
 ['大盘','pulse','overview','pulse'],['机会','opportunities','ranked','spark'],
 ['我的票','assets','holdings','user'],['提醒','inbox','all','bell'],['复盘','pulse','review','lab']
];
const REFERENCE_MOBILE=REFERENCE_TOP;
// User-approved original V6 business navigation. Every entry points to an existing route;
// the internal five-space model, authentication and all legacy recovery URLs remain intact.
const BUSINESS_NAV=[
 ['首页总览','pulse','overview'],['实时行情','pulse','market-overview'],
 ['AI选股','opportunities','ranked'],['策略中心','lab','strategies'],
 ['板块资金','pulse','sectors'],['新闻因子','inbox','all'],
 ['涨停复盘','pulse','review'],['龙头榜','opportunities','relay-first'],
 ['市场情绪','pulse','market-overview'],['K线图谱','pulse','market-overview'],
 ['回测研究','lab','backtest'],['模拟交易','assets','paper'],
 ['风控系统','assets','risk'],['资产账户','assets','holdings'],
 ['系统设置','settings','preferences'],['外部市场 · 选股核心','pulse','global'],
 ['明日计划','pulse','plans'],['我的十四条','opportunities','conditions'],
 ['研究工作台','lab','desk'],['发布看板','settings','release'],
 ['我的持仓 · 盯盘与加减仓触发','assets','holdings'],['消息面 · 数据联动','inbox','all'],
 ['复盘 · 学习','pulse','review'],['工具','settings','diagnostics']
];
// Each route keeps its original renderer and permissions. This catalog owns
// the public tab grouping, secondary navigation and feature search.
const [systemPicksRoute,...otherPoolRoutes]=POOLS.map(([sub,label,,,access])=>[label,'opportunities',sub,access]);
const WORKSPACE_ROUTES={
 首页:[],
 行情:[['市场概览','pulse','market-overview'],['全球行情','pulse','global'],['行情数据与来源','lab','sources']],
 选股:[systemPicksRoute,['全部候选','opportunities','all'],...otherPoolRoutes],
 策略:[['策略与因子','lab','strategies'],['研究决策','lab','desk'],['研究档案','lab','records'],['模型资料','lab','models'],['市场记忆','lab','memory'],['明日计划','pulse','plans'],['短线研究总览','lab','shortline-overview','edit'],['短线自动校验','lab','shortline-new','edit'],['校验记录','lab','shortline-checks','edit'],['95项战法因子','lab','shortline-library','edit'],['参数验证与审批','lab','shortline-versions','edit'],['参数与黑名单','lab','shortline-settings','edit'],['因子代号词典','lab','shortline-dictionary','edit'],['题材梯队','lab','shortline-structure','edit'],['公告压力与筹码','lab','shortline-pressure','edit']],
 回测:[['回测验证','lab','backtest'],['研究进化工作台','lab','evolution','edit'],['K线样本回测','lab','shortline-backtest','edit'],['数据导入','lab','shortline-import','edit']],
 复盘:[['盘后总览','pulse','review'],['完整来源池','pulse','review-details'],['竞价复盘','pulse','auction-review'],['历史学习','lab','learning'],['人工执行记录','assets','closure','edit'],['交易样本学习','lab','shortline-trades','edit'],['结构化复盘','lab','shortline-review','edit'],['纪律与错题','lab','shortline-mistakes','edit'],['日志与打包','lab','shortline-journal','edit'],['开始使用','lab','shortline-setup','edit']],
 资讯:[['新闻与公告','inbox','all'],['利空线索','inbox','alerts'],['策略信号','inbox','signals'],['新闻证据','lab','evidence'],['投递追踪','inbox','push','edit'],['写通知','inbox','compose','edit']],
 资金流:[['板块强度与资金','pulse','sectors']],
 风控:[['持仓风控','assets','risk','edit'],['主账户风控','assets','authority','edit']],
 模拟盘:[['模拟跟踪','assets','paper','edit'],['模拟账务','assets','ledger','edit']],
 我的:[['我的持仓','assets','holdings','edit'],['资产总览','assets','overview','edit'],['资产变更与恢复','assets','history','edit'],['系统偏好','settings','preferences','edit'],['运行状态','settings','diagnostics','edit'],['通知路由','settings','channels','edit'],['设备授权','settings','devices','edit'],['访问安全','settings','security','edit'],['受控源文件','settings','source','edit'],['发布收件箱','settings','release','edit']]
};
const workspaceIndex=new Map(Object.entries(WORKSPACE_ROUTES).flatMap(([category,destinations])=>
 destinations.map(([,view,sub])=>[view+'/'+sub,category])));
function workspaceFor(view,sub){
 if(view==='pulse'&&(!sub||sub==='overview'))return '首页';
 if(view==='assets'&&sub==='daily-review')return '复盘';
 return workspaceIndex.get(view+'/'+sub)||({pulse:'行情',opportunities:'选股',lab:'策略',assets:'我的',inbox:'资讯',settings:'我的'})[view];
}
const mobileLabels={};
const primaryOf={首页:'大盘',行情:'大盘',资金流:'大盘',选股:'机会',我的:'我的票',模拟盘:'我的票',风控:'我的票',资讯:'提醒',策略:'复盘',回测:'复盘',复盘:'复盘'};
function secondary(leaf,view,sub){
 const r=WORKSPACE_ROUTES,lab=['实验室','lab','strategies'];
 if(['策略','回测'].includes(leaf)||view==='opportunities'&&sub==='scan')return [lab,...r.策略.filter(x=>x[2]!=='strategies'),...r.回测,['全市场评分','opportunities','scan'],['返回复盘','pulse','review']];
 switch(primaryOf[leaf]){
  case '大盘':return [['首页总览','pulse','overview'],...r.行情,...r.资金流];
  case '机会':return [...r.选股.filter(x=>x[2]!=='scan'),lab];
  case '我的票':return [...r.我的,...r.模拟盘,...r.风控];
  case '提醒':return [...r.资讯,['飞书通知','settings','channels','edit']];
  default:return [r.复盘[0],lab,...r.复盘.slice(1)];
 }
}
const ALIASES={
 '/picks.html':['opportunities','quant'],'/auction-picks.html':['opportunities','auction'],
 '/research.html':['lab','desk'],'/model-library.html':['lab','models'],
 '/v6-studio.html':['pulse','overview'],'/v6-matches.html':['opportunities','matches'],
 '/v6-research.html':['lab','strategies'],'/v6-validation.html':['lab','backtest'],
 '/v6-paper.html':['assets','paper'],'/v6-market-radar.html':['pulse','sectors'],
 '/reference-dashboard.html':['pulse','sectors']
};
const LEGACY_ANCHORS={holdSec1:['assets','holdings'],holdSec2:['assets','holdings'],'v6-paper':['assets','paper'],'v6-market':['pulse','sectors'],'v6-stock':['opportunities','quant'],'v6-news':['inbox','all'],'v6-plan':['pulse','plans'],'v6-review':['pulse','review'],'v6-strategy':['lab','strategies'],'v6-release':['settings','release'],'workspace-settings':['settings','preferences'],researchWorkspace:['lab','records'],decisionWorkspace:['lab','desk'],newsEvidence:['lab','evidence'],stockCapture:['lab','sources'],linkedIntelligence:['lab','memory'],completeHeading:['lab','backtest'],learningWorkbench:['lab','learning']};
let authInfo=null,state=null,role=null,route={view:'pulse',sub:'overview'},selectedStock=(/^\d{6}$/.test(new URLSearchParams(location.search).get('symbol')||'')?new URLSearchParams(location.search).get('symbol'):''),frame=null,main=null,workspaceNav=null,connection=null,snapshot=null,toast=null,drawer=null,routeController=null,sessionController=null,refreshBusy=false,refreshWanted=false,online=true,lastRead=0,poll=null,searchController=null,gateGeneration=0;
const poolCache=new Map(),listeners=new Set();
const decisionPools={},decisionListeners=new Set(),viewMemories=new Map();
let decisionSelection=null,decisionOrigin='pulse/overview',activeViewKey='';
const decisionDataListeners=new Set();
let decisionPayload=null,decisionPending=null,decisionReadAt=0;
const fastMoveListeners=new Set();
let fastFrame=null,fastBusy=false,fastReadAt=0;
const client=createClient({onUnauthorized:()=>logout('本次授权已失效，请重新登录。')});
const api=(path,options)=>client.api(path,options);
function notify(message,tone='') {
 if(!toast){toast=h('div',{class:'fy-toast',role:'status','aria-live':'polite'});document.body.append(toast);}
 toast.className='fy-toast '+tone;toast.textContent=String(message||'');toast.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>{if(toast)toast.hidden=true;},6000);
}
function parseRoute() {
 const hash=location.hash.slice(1);
 if(hash.startsWith('/')){const [pathname,query='']=hash.slice(1).split('?'),[view='pulse',sub='',code='',date='']=pathname.split('/');
  if(view==='lab'&&sub.startsWith('shortline-'))return {view,sub,...(/^\d{6}$/.test(code)?{code,date}:{}),...readContext(query)};
  if([...MAIN.map(x=>x[0]),'inbox'].includes(view))return {view,sub};}
 if(LEGACY_ANCHORS[hash])return {view:LEGACY_ANCHORS[hash][0],sub:LEGACY_ANCHORS[hash][1]};
 const alias=ALIASES[location.pathname]||['pulse','overview'];return {view:alias[0],sub:alias[1]};
}
function navigate(view,sub='') {
 const target='#/'+view+(sub?'/'+sub:'');
 if(location.hash===target)return;
 location.hash=target;
}
function findStock(code) {
 const candidates=[...rowsFrom(state?.dashboard?.rows),...rowsFrom(state?.pool),...rowsFrom(state?.trendPool),...rowsFrom(state?.ztPool),...rowsFrom(state?.ztReviewPool),...[...poolCache.values()].flatMap(value=>rowsFrom(value.items||value))];
 return candidates.find(row=>row.code===code)||null;
}
function selectStock(code,row,trigger){if(!role)return;selectedStock=code;drawer.open(code,row,trigger);}
function rememberView(){
 if(!main||!activeViewKey)return;
 const memory=viewMemories.get(activeViewKey)||{};
 memory.scrollY=window.scrollY;
 const cards=main.querySelector('.fy-decision-cards');
 if(cards)memory.decisionScrollLeft=cards.scrollLeft;
 memory.open=[...main.querySelectorAll('details[open]')].map(node=>node.id||node.querySelector('summary')?.textContent).filter(Boolean);
 viewMemories.set(activeViewKey,memory);
}
function restoreView(controller,key){
 const memory=viewMemories.get(key);if(!memory)return;
 requestAnimationFrame(()=>{
  if(controller.signal.aborted||activeViewKey!==key)return;
  for(const node of main.querySelectorAll('details'))if(memory.open?.includes(node.id||node.querySelector('summary')?.textContent))node.open=true;
  requestAnimationFrame(()=>{if(!controller.signal.aborted&&activeViewKey===key)window.scrollTo({top:memory.scrollY||0,behavior:'instant'});});
 });
}
function setDecision(value){
 if(!role||!/^\d{6}$/.test(value?.code||'')||!/^\d{4}-\d{2}-\d{2}$/.test(value?.day||''))return null;
 const source=value.row||value,plan={...value.plan};
 const row={...source,poolDay:value.day,decisionDay:value.day,decisionPlan:plan};
 if(activeViewKey==='pulse/overview'){rememberView();decisionOrigin=activeViewKey;}
 decisionSelection={code:value.code,day:value.day,row,plan,authority:value.authority||plan.authority,
  decisionId:value.decisionId||plan.decisionId};selectedStock=value.code;
 for(const fn of [...decisionListeners])try{fn(decisionSelection);}catch(error){console.error('FAYO selection update failed',error.name);}
 return decisionSelection;
}
function chooseDecision(card,trigger){const selection=setDecision(card);if(selection)drawer?.open(selection.code,selection.row,trigger);}
function prefillPaper(card){if(!role||role!=='edit')return;const selection=setDecision(card);if(!selection)return;drawer?.close();navigate('assets','paper');}
function returnToDecision(){drawer?.close();const [view,sub]=decisionOrigin.split('/');navigate(view||'pulse',sub||'overview');}
async function loadDecisionCenter(){
 if(!role)return null;
 if(decisionPending)return decisionPending;
 if(decisionPayload&&Date.now()-decisionReadAt<2500)return decisionPayload;
 const controller=sessionController,session=gateGeneration;
 const pending=(async()=>{
  const value=await api('/api/decision-center',{signal:controller?.signal,timeoutMs:4500});
  if(!role||controller?.signal.aborted||session!==gateGeneration)return null;
  decisionPayload=value;decisionReadAt=Date.now();
  for(const fn of [...decisionDataListeners])try{fn(value);}catch(error){console.error('FAYO decision readout failed',error.name);}
  drawer?.update?.();return value;
 })();
 decisionPending=pending;
 try{return await pending;}finally{if(decisionPending===pending)decisionPending=null;}
}
async function readPool(key,loader,{append=false}={}) {
 const [kind,board]=key.split(':');
 const archived=board==='all'&&!append&&state?.closeSession?.cards?.[kind];
 const result=archived||await loader();
 const items=rowsFrom(result?.items||result);
 const previous=poolCache.get(key),closed=state?.trading===false||state?.isSnapshot===true||state?.dashboard?.isSnapshot===true||result?.isSnapshot===true;
 const verifiedEmpty=result?.completeForScope===true||Boolean(archived&&!archived.freezeUnavailable&&archived.snapshotRetained&&reviewDate(archived.snapshotDay)===state.closeSession.day&&archived.count===0);
 if(!append&&!items.length&&closed&&state?.marketClock?.trading!==true&&!verifiedEmpty&&rowsFrom(previous?.items||previous).length)return {...previous,isSnapshot:true,snapshotRetained:true,note:'上次有效结果'};
 if(!append&&(items.length||result?.snapshotRetained||result?.completeForScope))poolCache.set(key,result);
 return result;
}
function context(signal) {
 return {
  get state(){return ['pulse','opportunities'].includes(route.view)?projectClosingWorkspace(state):state;},get auth(){return authInfo;},get role(){return role;},get canEdit(){return role==='edit';},get stock(){return selectedStock;},
  get lastRead(){return lastRead;},get fastFrame(){return fastFrame;},
  get decisionSelection(){return decisionSelection;},get decisionPools(){return decisionPools;},
  get decisionPayload(){return decisionPayload;},get decisionResonance(){return decisionPayload?.resonanceByCode||null;},loadDecisionCenter,
  get viewMemory(){if(!viewMemories.has(activeViewKey))viewMemories.set(activeViewKey,{});return viewMemories.get(activeViewKey);},
  signal,api,workspaceNavigation:true,refresh:options=>refresh(true,options),navigate,selectStock,findStock,notify,logout,passwordCreated:()=>{authInfo={...authInfo,hasPassword:true};},
  chooseDecision,prefillPaper,returnToDecision,closeStock:()=>drawer?.close(),setDecisionPool(key,value){decisionPools[key]=value;},
  onDecisionSelection(fn){decisionListeners.add(fn);signal?.addEventListener('abort',()=>decisionListeners.delete(fn),{once:true});return ()=>decisionListeners.delete(fn);},
  onDecisionCenter(fn){decisionDataListeners.add(fn);signal?.addEventListener('abort',()=>decisionDataListeners.delete(fn),{once:true});return ()=>decisionDataListeners.delete(fn);},
  quoteTrail,readPool,onState(fn){listeners.add(fn);signal?.addEventListener('abort',()=>listeners.delete(fn),{once:true});return ()=>listeners.delete(fn);},
  onFastMoves(fn){fastMoveListeners.add(fn);signal?.addEventListener('abort',()=>fastMoveListeners.delete(fn),{once:true});}
 };
}
function snapshotStatus() {
 if(!connection||!snapshot)return;
 connection.textContent=!online?'连接中断 · 保留上次内容':lastRead?'最近读取 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(lastRead):'正在读取云端';
 connection.dataset.offline=String(!online);
 connection.title='最近完整状态读取时间。异动卡另有轻量读取时间，报价仍按原始时点判断。';
 const historical=state?.trading===false||state?.isSnapshot===true||state?.dashboard?.isSnapshot===true;
 const tradeDay=reviewDate(historical?(state?.closeSession?.day||state?.dashboard?.snapshotDay||state?.snapshotFieldDays?.dashboard||state?.snapshotDay||state?.marketRecovery?.referenceDay):
   (state?.marketClock?.day||state?.dashboard?.snapshotDay||state?.snapshotDay));
 snapshot.hidden=false;
 snapshot.textContent='数据基准日 · '+(tradeDay||(!lastRead?'加载中…':'源端未提供交易日'))+
  (!online?' · 连接中断，保留上次快照':historical?' · 最近交易日快照':state?.trading===true?' · 今日盘中':'');

}
function revealCurrentTab(nav) {
 if(!nav.clientWidth||nav.scrollWidth<=nav.clientWidth)return;
 const tab=nav.querySelector('[aria-current]');
 if(!tab)return;
 const bounds=nav.getBoundingClientRect(),item=tab.getBoundingClientRect();
 const left=bounds.left+nav.clientLeft,right=left+nav.clientWidth;
 // Move this strip only. A tab reached from the dock or a link must not scroll the document.
 if(item.left<left)nav.scrollLeft+=item.left-left-4;
 else if(item.right>right)nav.scrollLeft+=item.right-right+4;
}
function createFrame() {
 quoteTrail.clear();
 const brand=h('a',{class:'fy-brand',href:'#/pulse/overview','aria-label':'绯曜 FAYO 首页'},h('img',{src:'/nova/mark.svg',width:'40',height:'40',alt:''}),h('span',{},h('strong',{},'绯曜 FAYO'),h('small',{},'投资研究空间')));
 const nav=h('nav',{class:'fy-nav','aria-label':'主要工作空间'}),dock=h('nav',{class:'fy-dock','aria-label':'手机主要工作空间'});
 for(const[view,label,key]of MAIN){
  nav.append(h('button',{type:'button','data-fy-route':view,onClick:()=>navigate(view)},icon(key),h('span',{},label)));
  // Original internal five-space navigation remains available on wide views and via URLs.
 }
 for(const [label,view,sub,key] of REFERENCE_MOBILE){
  dock.append(h('button',{type:'button','data-fy-route':view,'data-fy-sub':sub,'data-workspace-tab':label,onClick:()=>navigate(view,sub)},icon(key),h('span',{},label)));
 }
 const referenceTop=h('nav',{class:'fy-reference-topnav','aria-label':'主要导航'},
  REFERENCE_TOP.map(([label,view,sub,key])=>h('button',{type:'button','data-reference-view':view,'data-reference-sub':sub,'data-workspace-tab':label,onClick:()=>navigate(view,sub)},icon(key),
   h('span',{class:'fy-desktop-tab-label'},label),h('span',{class:'fy-mobile-tab-label'},mobileLabels[label]||label))));
 connection=h('span',{class:'fy-status','aria-live':'polite'});
 const search=button(icon('search'),openSearch,'quiet');search.setAttribute('aria-label','搜索股票与功能');search.setAttribute('aria-keyshortcuts','Control+K Meta+K');
 const refreshButton=button(icon('refresh'),()=>refresh(true),'quiet');refreshButton.setAttribute('aria-label','刷新云端数据');
 const inbox=button(icon('bell'),()=>navigate('inbox','all'),'quiet');inbox.setAttribute('aria-label','资讯与通知');
 const identity=button(icon('user'),openIdentity,'quiet');identity.setAttribute('aria-label','账户与授权');identity.setAttribute('title',role==='edit'?'管理者':'观察者');
 const actions=h('div',{class:'fy-actions'},search,refreshButton,inbox,identity);
 const header=h('header',{class:'fy-header'},brand,referenceTop,nav,actions);
 const businessNav=h('nav',{class:'fy-business-nav','aria-label':'V6 原业务功能导航'},BUSINESS_NAV.map(([label,view,sub])=>
  h('button',{type:'button','data-business-view':view,'data-business-sub':sub,onClick:()=>navigate(view,sub)},
   icon(({pulse:'pulse',opportunities:'spark',lab:'lab',inbox:'bell',assets:'assets',settings:'settings'})[view]),h('span',{},label))));
 main=h('main',{class:'fy-main',id:'fayo-content',tabindex:'-1'});
 workspaceNav=h('nav',{class:'fy-workspace-nav','aria-label':'当前标签功能',hidden:true});
 snapshot=h('div',{class:'fy-snapshot',role:'status',hidden:true});
 const deploymentGuide=role==='edit'?h('a',{class:'fy-deployment-guide fy-button secondary',
  href:'https://github.com/solviq87-cpu/v6-stock-system/blob/dev/DEPLOYMENT.md',target:'_blank',rel:'noopener noreferrer'},'部署交接文档'):null;
 const meta=h('div',{class:deploymentGuide?'fy-connection-bar fy-has-deployment-guide':'fy-connection-bar'},
  h('span',{class:'fy-connection-caption'},'你的投资研究空间'),deploymentGuide,connection);
 frame=h('div',{class:'fayo-app fy-reference-shell'},h('a',{class:'fy-skip',href:'#fayo-content'},'跳转到主要内容'),header,businessNav,meta,snapshot,workspaceNav,main,dock);
 root.replaceChildren(frame);
 let previousWidth=window.innerWidth;
 window.addEventListener('resize',()=>{
  if(window.innerWidth===previousWidth)return;
  previousWidth=window.innerWidth;
  revealCurrentTab(referenceTop);revealCurrentTab(workspaceNav);
 },{signal:sessionController.signal});
 drawer=createStockDrawer(context(null));root.append(drawer.element);
 snapshotStatus();
}
async function renderRoute() {
 if(!role||!main)return;
 rememberView();
 route=parseRoute();if(route.view==='lab'&&!workspaceIndex.has('lab/'+route.sub))route.sub='desk';routeController?.abort();listeners.clear();fastMoveListeners.clear();fastFrame=null;fastReadAt=0;routeController=new AbortController();
 activeViewKey=route.view+'/'+(route.sub||'overview');
 const controller=routeController,ctx=context(controller.signal);
 frame.dataset.terminalView=route.view==='pulse'&&route.sub==='review'?'review':
  route.view==='pulse'&&(!route.sub||route.sub==='overview')?'home':'';
 const sub=route.sub||({opportunities:'ranked',assets:'overview',inbox:'all',settings:'preferences'}[route.view]||'');
 const workspace=workspaceFor(route.view,sub);
 frame.dataset.workspace=workspace;
 frame.querySelectorAll('.fy-nav [data-fy-route]').forEach(node=>{const active=node.dataset.fyRoute===route.view&&(!node.dataset.fySub||node.dataset.fySub===route.sub);node.dataset.current=String(active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
 frame.querySelectorAll('[data-business-view]').forEach(node=>{
  const active=route.view===node.dataset.businessView&&route.sub===node.dataset.businessSub;
  node.dataset.current=String(active);
  if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
 });
 frame.querySelectorAll('[data-workspace-tab]').forEach(node=>{
  const active=node.dataset.workspaceTab===(route.view==='opportunities'&&sub==='scan'?'复盘':primaryOf[workspace]);
  node.dataset.current=String(active);
  if(active)node.setAttribute('aria-current','true');
  else node.removeAttribute('aria-current');
 });
 const destinations=secondary(workspace,route.view,sub).filter(([, , ,access])=>access!=='edit'||role==='edit');
 workspaceNav.hidden=destinations.length<2;
 const navKey=destinations.map(x=>x[1]+'/'+x[2]).join('|');
 if(workspaceNav.dataset.workspace!==navKey){
  workspaceNav.dataset.workspace=navKey;
  workspaceNav.replaceChildren(...destinations.map(([label,view,target])=>h('button',{type:'button',
   'data-workspace-route':view+'/'+target,onClick:()=>navigate(view,target)},label)));
 }
 for(const tab of workspaceNav.children){
  if(tab.dataset.workspaceRoute===route.view+'/'+sub)tab.setAttribute('aria-current','page');
  else tab.removeAttribute('aria-current');
 }
 revealCurrentTab(frame.querySelector('.fy-reference-topnav'));
 revealCurrentTab(workspaceNav);
 document.title='绯曜 FAYO · 投资研究空间';
 window.scrollTo({top:0,behavior:'instant'});
 try {
  if(route.view==='pulse'&&(!route.sub||route.sub==='overview'))main.replaceChildren(renderTerminalOverview(ctx));
  else if(route.view==='pulse'&&route.sub==='review')main.replaceChildren(renderReferenceReview(ctx));
  else if(route.view==='pulse'&&route.sub==='review-details')main.replaceChildren(renderDailyReview(ctx));
  else if(route.view==='pulse')main.replaceChildren(renderPulse(route,ctx));
  else if(route.view==='opportunities')main.replaceChildren(renderOpportunities(route,ctx));
  else {
   main.replaceChildren(h('div',{class:'fy-loading',role:'status','data-pending-route':route.view+'/'+sub},'正在打开工作空间…'));
   const module=route.view==='lab'?await import('./research.js'):await import('./operations.js');
   if(controller.signal.aborted)return;
   const view=route.view==='lab'?await module.renderResearch(route,ctx):await module.renderOperations(route,ctx);
   if(controller.signal.aborted)return;
   main.replaceChildren(view);
   if(route.view==='lab'){const extra=await import('./research-extensions.js');if(!controller.signal.aborted)extra.appendResearchExtensions(view,route,ctx);}
  }
 }catch(error){if(controller.signal.aborted)return;main.replaceChildren(empty('该工作空间暂时未能打开',error.message),button('重新打开',renderRoute));notify(error.message,'error');}
 restoreView(controller,activeViewKey);
}
async function refresh(manual=false,{showSuccess=true}={}) {
 if(!role||(!manual&&document.visibilityState!=='visible'))return;
 if(refreshBusy){if(manual)refreshWanted={showSuccess:showSuccess||!!refreshWanted?.showSuccess};return;}
 refreshBusy=true;
 const controller=sessionController;
 try {
  const incoming=await api('/api/state',{signal:controller?.signal});
  if(!role||controller?.signal.aborted)return;
  state=retainMarket(state,incoming);
  for(const row of [...rowsFrom(incoming.dashboard?.rows),...rowsFrom(incoming.pool),...rowsFrom(incoming.ztPool)])quoteTrail.add(row);
  lastRead=Date.now();online=true;snapshotStatus();
  if(!main?.firstElementChild||main.firstElementChild.matches('.fy-loading:not([data-pending-route])'))await renderRoute();
  for(const listener of [...listeners])try{listener(state,{manual});}catch(error){console.error('FAYO view update failed',error.name);}
  drawer?.update?.({manual});
  if(manual&&showSuccess)notify('已读取云端状态，报价原始时点见页面');
 }catch(error){if(!role||controller?.signal.aborted)return;online=false;snapshotStatus();if(manual)notify(error.message,'error');}
 finally{refreshBusy=false;if(refreshWanted){const queued=refreshWanted;refreshWanted=false;if(role)refresh(true,queued);}}
}
async function refreshAutomatically() {
 if(!role||document.visibilityState!=='visible')return;
 const isFastRoute=route.view==='opportunities'&&['auction','movement'].includes(route.sub);
 if(state?.marketClock?.trading===false||!isFastRoute||drawer?.isOpen()||!lastRead||Date.now()-lastRead>=10000)return refresh(false);
 if(fastBusy||Date.now()-fastReadAt<4000)return;
 fastBusy=true;
 const controller=routeController,started=performance.now();
 try {
  const frame=await api('/api/fast-stock-moves',{signal:controller.signal,timeoutMs:4000});
  if(controller.signal.aborted||!role)return;
  if(frame.schemaVersion!==1||!Number.isFinite(frame.servedAt))return refresh(false);
  fastReadAt=Date.now();
  fastFrame={...frame,readAt:fastReadAt,readMs:performance.now()-started};
  for(const listener of [...fastMoveListeners])listener();
 }catch {
  if(role&&!controller.signal.aborted)await refresh(false);
 }finally{fastBusy=false;}
}
function logout(message='') {
 decisionSelection=null;decisionPayload=null;decisionPending=null;decisionReadAt=0;decisionDataListeners.clear();decisionListeners.clear();viewMemories.clear();activeViewKey='';for(const key of Object.keys(decisionPools))delete decisionPools[key];
 gateGeneration++;role=null;state=null;refreshWanted=false;lastRead=0;fastFrame=null;fastReadAt=0;quoteTrail.clear();poolCache.clear();listeners.clear();fastMoveListeners.clear();routeController?.abort();sessionController?.abort();client.invalidate();poll?.();poll=null;drawer?.clear();drawer=null;searchController?.abort();document.querySelector('.fy-command-layer')?.remove();saveSession('','');selectedStock='';showGate(message);
}
async function enter(nextRole) {
 gateGeneration++;role=nextRole==='edit'?'edit':'view';sessionController?.abort();poll?.();poll=null;sessionController=new AbortController();const controller=sessionController;createFrame();main.replaceChildren(h('div',{class:'fy-loading',role:'status'},'正在读取你的云端状态…'));await refresh(false);if(!role||controller.signal.aborted)return;if(!state)await renderRoute();if(!role||controller.signal.aborted)return;subscribeChanges(controller);
 let followups=0;
 const pending=()=>state?.closeSession&&['scheduled','searching','partial'].includes(state.marketRecovery?.phase)&&state.marketRecovery?.closeWatch?.day!==state.closeSession.day;
 poll=createSnapshotPoller({signal:controller.signal,
  read:async()=>{if(pending())followups++;await refreshAutomatically();},
  delay:()=>state?.marketClock?.trading===false&&state.marketClock.nextOpenAt?
   Math.max(1000,Math.min(state.marketClock.nextOpenAt-Date.now(),pending()&&followups<2?20000:Infinity)):5000});
 if(role==='edit')void import('./shortline/web-notices.mjs').then(m=>{
  if(!controller.signal.aborted&&role==='edit')m.startNoticePolling(context(controller.signal));
 }).catch(()=>{});
}
async function subscribeChanges(controller) {
 // Fetch-based SSE keeps the credential in a header and retains periodic reads
 // as a fallback. An event invalidates the view; it is never used as a price.
 while(role&&!controller.signal.aborted) {
  try {
   const token=getSession(),query=new URLSearchParams({dev:deviceId(),dname:'绯曜设备'});
   const response=await fetch('/api/stream?'+query,{headers:{Accept:'text/event-stream',...(token?{Authorization:'Bearer '+token,'X-QD-Token':token}:{})},cache:'no-store',signal:controller.signal});
   if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream'))return;
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(role&&!controller.signal.aborted){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>131072)buffer=buffer.slice(-65536);let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!event.includes('data:'))continue;const type=/^event:\s*([^\s]+)/m.exec(event)?.[1];if(type==='close-snapshot'&&state?.closeSession)void refresh(false);else if(Date.now()-lastRead>1000&&(state?.marketClock?.trading!==false||['news','announcement'].includes(type)))void refreshAutomatically();}}
  }catch(error){if(controller.signal.aborted)return;}
  if(controller.signal.aborted||!role)return;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}

function showGate(message='') {
 const turn=++gateGeneration;poll?.();poll=null;role=null;
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
 const destinations=[['首页总览','pulse','overview'],...Object.values(WORKSPACE_ROUTES).flat()]
  .filter(([, , ,access])=>access!=='edit'||role==='edit').map(([label,view,sub])=>({label,view,sub}));
 function showDestinations(query=''){results.replaceChildren(h('div',{class:'fy-list'},destinations.filter(item=>!query||item.label.includes(query)).map(item=>button(item.label,()=>{close();navigate(item.view,item.sub);},'quiet'))));}
 let timer,epoch=0;
 input.addEventListener('input',()=>{const query=input.value.trim();clearTimeout(timer);const turn=++epoch;showDestinations(query);if(query.length<2)return;timer=setTimeout(async()=>{try{status.textContent='搜索中…';const r=await api('/api/search?q='+encodeURIComponent(query),{signal:controller.signal});if(turn!==epoch||controller.signal.aborted)return;const rows=rowsFrom(r.items||r.results||r);status.textContent='找到 '+rows.length+' 只股票';if(rows.length)results.prepend(h('div',{class:'fy-list'},rows.slice(0,15).map(row=>button(row.name+' / '+row.code,()=>{close();selectStock(row.code,row);},'quiet'))));}catch(error){if(!controller.signal.aborted)status.textContent=error.message;}},250);});
 showDestinations();document.body.append(layer);input.focus();
}
addEventListener('hashchange',()=>{if(role)renderRoute();});
addEventListener('offline',()=>{online=false;snapshotStatus();});
addEventListener('online',()=>{if(!role&&getSession())void restoreSession();});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&role){event.preventDefault();openSearch();}});
async function restoreSession(){
 try {
  const status=await api('/api/lock/status');authInfo=status;
  if(status.role||status.local)await enter(status.role||'edit');else showGate();
 }catch(error){showGate(error.message);}
}
void restoreSession();
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
