(function(root,factory){
 'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.V6LearningWorkbench=api;api.mount(root);}
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const count=x=>Number.isSafeInteger(x)&&x>=0?String(x):'未知';
 const time=x=>Number.isSafeInteger(x)&&x>0&&x<=8640000000000000?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
 const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const lookup=(map,x)=>typeof x==='string'&&Object.hasOwn(map,x)?map[x]:'未知';
 const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x?x:'未知';
 const modelName=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(x)?x:'未知';
 const modelDigest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)?x:'未知';
 const actions={
  'configure-private-research-agent':'配置私有研究任务','check-private-configuration':'检查私有研究配置','check-local-model-configuration':'检查本地模型配置','probe-local-model':'点击检查本地模型',
  'check-local-model':'点击检查本地模型','configure-local-model':'配置本地模型','fix-local-model-config':'修复本地模型配置','start-local-model':'启动本地模型服务','verify-local-model-digest':'核对本地模型摘要','verify-agent-memory-directory':'核对研究记忆目录','match-agent-memory-directory':'匹配研究记忆目录',
  'run-capture-research-cycle':'可运行冻结采集研究','run-observe-research-cycle':'可运行观察研究','provide-current-day-authorized-source':'补充当日授权来源','provide-causal-current-day-picks-and-factor-evidence':'补充当日有时点依据的候选与因子证据','await-next-source-or-research-lineage':'等待新来源或研究版本','audit-private-research-artifacts-before-retry':'重试前核查私有研究记录','provide-sealed-prior-research-or-explicit-preregistration':'补充封存的前期研究或预注册','await-signals-frozen-after-preregistration':'等待预注册后冻结信号','await-independent-matured-h5-days':'等待独立成熟 H5 交易日','await-preregistered-prefix-h5-maturity':'等待预注册样本 H5 成熟','await-global-trial-budget':'等待全局试验预算'
 };
 const currentStates={'unconfigured':'尚未配置','not-checked':'尚未检查','blocked':'条件受阻','needs-data':'需要补充数据','preview-ready':'研究预检就绪','unchanged':'条件暂无变化'};
 const word=x=>typeof x==='string'&&x.length?x.slice(0,160):'未知';
 function mount(root){
  const doc=root.document,$=id=>doc?.getElementById(id),section=$('learningWorkbench');if(!section||section.dataset.learningMounted)return null;section.dataset.learningMounted='true';
  const read=$('learningRead'),force=$('learningForce'),limit=$('learningLimit'),status=$('learningStatus'),summary=$('learningSummary'),details=$('learningDetails'),token=$('token');
  const runtimeRead=$('learningRuntimeRead'),runtimeProbe=$('learningModelProbe'),runtimeStatus=$('learningRuntimeStatus'),runtimeSummary=$('learningRuntimeSummary');
  let generation=0,pending=null,serverRunning=false,backendMayContinue=false,identity=token?.value.trim()||'';
  function sync(){force.disabled=serverRunning||backendMayContinue||pending?.force===true;read.disabled=false;section.setAttribute('aria-busy',String(!!pending));}
  function emptyRuntime(){runtimeSummary?.replaceChildren();if(runtimeSummary)runtimeSummary.hidden=true;}
  function empty(){summary.replaceChildren();details.replaceChildren();summary.hidden=true;details.hidden=true;}
  function clear(message='身份或页面状态已变化，请重新读取学习状态'){
   generation++;identity=token?.value.trim()||'';const old=pending;pending=null;old?.controller.abort();empty();emptyRuntime();if(runtimeStatus)runtimeStatus.textContent=message;serverRunning=false;backendMayContinue=false;limit.value='30';status.textContent=message;sync();
  }
  function active(id,auth){
   if(id!==generation)return false;
   if(auth!==(token?.value.trim()||'')){clear('身份已变化，学习状态已清空；请重新读取');return false;}
   if(doc.hidden||root.navigator?.onLine===false){clear('页面隐藏或网络离线，学习状态已清空；恢复后请重新读取');return false;}
   return true;
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
  function renderRuntime(value){
   if(!object(value)||value.schemaVersion!==1||value.mode!=='v6-learning-runtime-preflight'||value.readOnly!==true||value.researchOnly!==true||value.canTrade!==false||value.productionWeightsChanged!==false||!object(value.current)||!object(value.model)||!object(value.configuration))throw Error('运行预检格式无效，请重新检查');
   emptyRuntime();
   const overall={'unconfigured':'尚未配置研究任务','blocked':'运行条件受阻','needs-data':'需要补充研究数据','ready-for-research':'具备研究预检条件','awaiting-model-probe':'等待本地模型检查'};
   const models={'disabled':'未启用','invalid-config':'配置无效','not-probed':'尚未检查','verified':'模型摘要已核对','unavailable':'本地模型服务不可用','digest-mismatch':'模型摘要不匹配'};
   const configs={'unconfigured':'尚未配置','configured':'已配置','invalid':'配置无效','memory-mismatch':'记忆目录不匹配'};
   line(runtimeSummary,'运行预检',lookup(overall,value.overall));line(runtimeSummary,'检查时间',time(value.checkedAt));
   line(runtimeSummary,'下一步',lookup(actions,value.nextAction));line(runtimeSummary,'研究配置',lookup(configs,value.configuration.status));
   const conditions=node('div',undefined,runtimeSummary,'learning-runtime-conditions');
   const current=node('div',undefined,conditions,'learning-runtime-group');node('h4','当前运行条件',current);
   line(current,'条件',lookup(currentStates,value.current.status));line(current,'下一步',lookup(actions,value.current.nextAction));
   line(current,'来源日期',date(value.current.sourceDay));line(current,'现有冻结天数',count(value.current.captureDays));
   const model=node('div',undefined,conditions,'learning-runtime-group');node('h4','本地模型',model);
   line(model,'检查结果',lookup(models,value.model.status));line(model,'模型名称',modelName(value.model.modelName));line(model,'模型摘要',modelDigest(value.model.modelDigest));line(model,'模型检查时间',time(value.model.checkedAt));
   node('p','摘要核对不代表推理或训练成功；本次不执行推理、训练或交易，不改生产权重。',model,'learning-muted');
   const last=node('details',undefined,runtimeSummary);node('summary','上次记录',last);
   if(value.lastRun===null)line(last,'记录','暂无');
   else if(object(value.lastRun)){
    const states={...currentStates,'research-cycle-completed-not-certified':'研究周期已记录，尚未认证','failed-stop-and-audit-before-retry':'已停止，重试前需核查','blocked-invalid-agent-journal':'研究记录无效'};
    line(last,'记录状态',lookup(states,value.lastRun.status));line(last,'记录时间',time(value.lastRun.checkTime));line(last,'来源日期',date(value.lastRun.sourceDay));line(last,'记录冻结天数',count(value.lastRun.captureDays));line(last,'下一步',lookup(actions,value.lastRun.nextAction));
   }else line(last,'记录','未知');
   node('p','上次记录不代表当前条件，也不能证明后台任务仍在运行。',last,'learning-muted');
   runtimeSummary.hidden=false;runtimeStatus.textContent='已检查运行条件；只读预检不改变学习状态。';
  }
  async function request(run=false,channel='learning'){
   const runtime=channel==='runtime',targetStatus=runtime?runtimeStatus:status;
   if(runtime&&!runtimeSummary)return null;
   if(identity!==(token?.value.trim()||''))clear('身份已变化，学习状态已清空；请重新读取');
   if(doc.hidden||root.navigator?.onLine===false){clear('页面隐藏或网络离线，学习状态已清空；恢复后请重新读取');return null;}
   if(!runtime&&run&&(serverRunning||backendMayContinue||pending?.force)){status.textContent='补验任务可能仍在运行，请读取状态确认进度';return null;}
   const size=Number(limit.value);if(!runtime&&run&&(!Number.isSafeInteger(size)||size<1||size>60)){status.textContent='每批数量须为1至60的整数';return null;}
   const previous=pending;if(previous?.force)backendMayContinue=true;
   if(previous&&previous.channel!==channel){if(previous.channel==='runtime')runtimeStatus.textContent='检查已中止，请手动重新检查。';else status.textContent=backendMayContinue?'服务端补验可能仍在继续，请读取状态确认进度。':'读取已中止，请手动重新读取。';}
   const id=++generation;previous?.controller.abort();const controller=new AbortController(),auth=token?.value.trim()||'';
   pending={controller,force:!runtime&&run,channel};if(!runtime&&run)backendMayContinue=true;if(runtime)emptyRuntime();else empty();sync();
   targetStatus.textContent=runtime?(run?'正在检查本地模型摘要…':'正在检查运行条件…'):run?'正在补验一批；关闭或中止页面不会取消服务端任务。':'正在读取学习状态…';
   const timeout=root.setTimeout||setTimeout,cancelTimeout=root.clearTimeout||clearTimeout;let timedOut=false,timer;
   try{
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>{const e=Error('aborted');e.name='AbortError';reject(e);},{once:true}));
    timer=timeout(()=>{timedOut=true;controller.abort();},!runtime&&run?60000:15000);
    const fetchResult=async()=>{const response=await root.fetch(runtime?'/api/research/learning-runtime':'/api/learn-status',{method:run?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(run?{'Content-Type':'application/json'}:{})},...(run?{body:JSON.stringify(runtime?{probeModel:true}:{force:true,limit:size})}:{})});if(response.status===401||response.status===403){const e=Error('auth');e.authDenied=true;throw e;}return {response,result:await response.json()};};
    const {response,result}=await Promise.race([fetchResult(),aborted]);
    const denied=result?.locked===true||result?.needPassword===true;
    if(!active(id,auth))return null;
    if(denied){clear('读取权限已失效，学习状态已清空；请重新认证');return null;}
    if(!response.ok||!result?.ok){if(!runtime&&result?.error==='学习任务正在运行'){serverRunning=true;status.textContent='服务端学习任务正在运行，请读取状态确认进度';return null;}throw Error(runtime?'运行预检未完成，请稍后重试':'学习状态未完成，请稍后重新读取');}
    if(runtime){renderRuntime(result.result);return result.result;}render(result.status);return result.status;
   }catch(e){
    if(active(id,auth)){if(e.authDenied){clear('读取权限已失效，学习状态已清空；请重新认证');return null;}if(runtime){emptyRuntime();targetStatus.textContent=timedOut?'等待超时；服务端仅执行只读预检，不改变学习状态，请手动重试。':e.message==='运行预检格式无效，请重新检查'?e.message:'运行预检未完成；本次只读预检不改变学习状态，请手动重试。';return null;}empty();status.textContent=timedOut?'等待超时；服务端补验可能仍在继续，请重新读取状态。':backendMayContinue?'请求未完成；服务端补验可能仍在继续，请重新读取状态。':e.message==='学习状态格式无效，请重新读取'?e.message:'读取未完成，请稍后重试';}
    return null;
   }finally{cancelTimeout(timer);if(id===generation){pending=null;sync();}}
  }
  read.addEventListener('click',()=>request());force.addEventListener('click',()=>request(true));
  runtimeRead?.addEventListener('click',()=>request(false,'runtime'));runtimeProbe?.addEventListener('click',()=>request(true,'runtime'));
  for(const event of ['input','change'])token?.addEventListener(event,()=>clear('身份已变化，学习状态已清空；请重新读取'));
  root.addEventListener?.('offline',()=>clear('网络离线，学习状态已清空；恢复后请重新读取'));
  root.addEventListener?.('pagehide',()=>clear('页面已离开，学习状态已清空；服务端任务可能继续运行'));
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear('页面隐藏，学习状态已清空；服务端任务可能继续运行');});
  sync();return {request,requestRuntime:probe=>request(probe===true,'runtime'),clear};
 }
 return {mount,count};
});
