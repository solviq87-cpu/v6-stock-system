(function(root,factory){
 'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.V6LearningWorkbench=api;api.mount(root);}
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const count=x=>Number.isSafeInteger(x)&&x>=0?String(x):'未知';
 const time=x=>Number.isSafeInteger(x)&&x>0?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
 const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const word=x=>typeof x==='string'&&x.length?x.slice(0,160):'未知';
 function mount(root){
  const doc=root.document,$=id=>doc?.getElementById(id),section=$('learningWorkbench');if(!section||section.dataset.learningMounted)return null;section.dataset.learningMounted='true';
  const read=$('learningRead'),force=$('learningForce'),limit=$('learningLimit'),status=$('learningStatus'),summary=$('learningSummary'),details=$('learningDetails'),token=$('token');
  let generation=0,pending=null,serverRunning=false,backendMayContinue=false;
  function sync(){force.disabled=serverRunning||backendMayContinue||pending?.force===true;read.disabled=false;section.setAttribute('aria-busy',String(!!pending));}
  function empty(){summary.replaceChildren();details.replaceChildren();summary.hidden=true;details.hidden=true;}
  function clear(message='身份或页面状态已变化，请重新读取学习状态'){
   generation++;const old=pending;pending=null;old?.controller.abort();empty();serverRunning=false;backendMayContinue=false;limit.value='30';status.textContent=message;sync();
  }
  function node(tag,value,parent,cls){const n=doc.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;if(parent)parent.append(n);return n;}
  function line(parent,title,value){node('p',title+'：'+value,parent);}
  function render(value){
   if(!object(value)||!object(value.counts))throw Error('学习状态格式无效，请重新读取');
   const c=value.counts,op=object(value.operation)?value.operation:{},states={idle:'尚无任务',running:'正在运行',success:'已完成',failed:'未完成'},kinds={force:'手动补验',seed:'历史补充',auto:'自动回验'};empty();serverRunning=op.state==='running';
   const grid=node('div',undefined,summary,'learning-counts');
   for(const [key,title]of [['matured','实盘有效已验'],['pending','实盘待回验'],['invalid','实盘结果无效'],['live','实盘登记总数']]){const card=node('article',undefined,grid);node('span',title,card);node('strong',count(c[key]),card);}
   node('p','实盘样本与历史回测、事后样本分别统计；未知不按零处理。',summary,'learning-muted');
   line(summary,'最近任务',(states[op.state]||'未知')+'；新增有效结果 '+count(op.newOutcomes));
   const breakdown=node('details',undefined,details);node('summary','样本范围与类型',breakdown);
   line(breakdown,'全部登记 / 作废',count(c.total)+' / '+count(c.void));line(breakdown,'历史回测 / 事后样本',count(c.backtest)+' / '+count(c.posthoc));
   if(object(value.byType)&&Object.keys(value.byType).length){for(const [type,row]of Object.entries(value.byType)){const p=node('div',undefined,breakdown,'learning-type');node('strong',word(type),p);for(const [key,title]of [['total','实盘总数'],['matured','有效已验'],['pending','待验'],['invalid','无效']])line(p,title,count(object(row)?row[key]:null));}}
   else line(breakdown,'类型明细',object(value.byType)?'暂无实盘类型样本':'未知，服务端未提供类型统计');
   node('p','竞价涨停类核对当日封板事件；其他类型核对次日最高涨幅是否达到3%。事件命中不等于可交易收益。',breakdown,'learning-muted');
   const receipt=node('details',undefined,details);node('summary','最近任务回执与版本',receipt);
   line(receipt,'任务', (states[op.state]||'未知')+' / '+(kinds[op.kind]||'未知'));
   line(receipt,'开始 / 完成',time(op.startedAt)+' / '+time(op.finishedAt));line(receipt,'有效已验前 / 后',count(op.beforeMatured)+' / '+count(op.afterMatured));
   line(receipt,'新增有效结果',count(op.newOutcomes));line(receipt,'尝试 / 获取',count(op.attempted)+' / '+count(op.fetched));
   if(op.state==='failed'||typeof op.error==='string'&&op.error)line(receipt,'任务错误','学习任务未完成，请稍后重新读取状态');
   line(receipt,'模型 / 规则 / 结果口径版本',word(value.modelVersion)+' / '+word(value.ruleVersion)+' / '+word(value.outcomeVersion));
   summary.hidden=false;details.hidden=false;backendMayContinue=serverRunning;
   status.textContent=serverRunning?'服务端学习任务正在运行；可再次读取状态，完成前不能重复补验。':op.state==='failed'?'最近学习任务未完成，请稍后重新读取或补验；详见任务回执。':'已读取学习状态；仅点击“补验一批”才运行补验。';
  }
  async function request(run=false){
   if(doc.hidden||root.navigator?.onLine===false){clear('页面隐藏或网络离线，学习状态已清空；恢复后请重新读取');return null;}
   if(run&&(serverRunning||backendMayContinue||pending?.force)){status.textContent='补验任务可能仍在运行，请读取状态确认进度';return null;}
   const size=Number(limit.value);if(run&&(!Number.isSafeInteger(size)||size<1||size>60)){status.textContent='每批数量须为1至60的整数';return null;}
   const previous=pending;if(previous?.force)backendMayContinue=true;
   const id=++generation;previous?.controller.abort();const controller=new AbortController(),auth=token?.value.trim()||'';
   pending={controller,force:run};if(run)backendMayContinue=true;empty();sync();
   status.textContent=run?'正在补验一批；关闭或中止页面不会取消服务端任务。':'正在读取学习状态…';
   const timeout=root.setTimeout||setTimeout,cancelTimeout=root.clearTimeout||clearTimeout;let timedOut=false,timer;
   try{
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>{const e=Error('aborted');e.name='AbortError';reject(e);},{once:true}));
    timer=timeout(()=>{timedOut=true;controller.abort();},run?60000:15000);
    const fetchResult=async()=>{const response=await root.fetch('/api/learn-status',{method:run?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(run?{'Content-Type':'application/json'}:{})},...(run?{body:JSON.stringify({force:true,limit:size})}:{})});if(response.status===401||response.status===403){const e=Error('auth');e.authDenied=true;throw e;}return {response,result:await response.json()};};
    const {response,result}=await Promise.race([fetchResult(),aborted]);
    const denied=result?.locked===true||result?.needPassword===true;
    if(id!==generation||auth!==(token?.value.trim()||'')||doc.hidden||root.navigator?.onLine===false)return null;
    if(denied){clear('读取权限已失效，学习状态已清空；请重新认证');return null;}
    if(!response.ok||!result?.ok){if(result?.error==='学习任务正在运行'){serverRunning=true;status.textContent='服务端学习任务正在运行，请读取状态确认进度';return null;}throw Error('学习状态未完成，请稍后重新读取');}
    render(result.status);return result.status;
   }catch(e){
    if(id===generation&&auth===(token?.value.trim()||'')&&!doc.hidden){if(e.authDenied){clear('读取权限已失效，学习状态已清空；请重新认证');return null;}empty();status.textContent=timedOut?'等待超时；服务端补验可能仍在继续，请重新读取状态。':backendMayContinue?'请求未完成；服务端补验可能仍在继续，请重新读取状态。':e.message==='学习状态格式无效，请重新读取'?e.message:'读取未完成，请稍后重试';}
    return null;
   }finally{cancelTimeout(timer);if(id===generation){pending=null;sync();}}
  }
  read.addEventListener('click',()=>request());force.addEventListener('click',()=>request(true));
  for(const event of ['input','change'])token?.addEventListener(event,()=>clear('身份已变化，学习状态已清空；请重新读取'));
  root.addEventListener?.('offline',()=>clear('网络离线，学习状态已清空；恢复后请重新读取'));
  root.addEventListener?.('pagehide',()=>clear('页面已离开，学习状态已清空；服务端任务可能继续运行'));
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear('页面隐藏，学习状态已清空；服务端任务可能继续运行');});
  sync();return {request,clear};
 }
 return {mount,count};
});
