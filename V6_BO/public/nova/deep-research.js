import {h,button,section,field,note,empty,table,dateTime,format,safeLink} from './ui.js';
const arr=value=>Array.isArray(value)?value:[];
const titles={67:'事件影响',68:'预期差',69:'产业与公司关系',70:'盘口与竞价',71:'交易时段',72:'主题拥挤',73:'组合目标权重',74:'换仓成本门槛',75:'决策稳健性',76:'事前对照复盘'};
const statuses={unknown:'证据不足',pending:'等待成熟证据','no-adjust':'暂不调整','not-evaluated':'暂不能评估',
 'observed-research':'已有研究记录','candidate':'研究候选','prospective':'事前冻结','post-hoc-exploration':'事后探索',
 'development-modified':'开发副本有改动','development-source-only':'源码副本，尚非安装验收','verified-local-manifest':'本地安装文件校验一致',
 'pending-real-observation':'等待真实运行积累','evidence-or-remediation-required':'需补齐证据或修复问题','ready-for-independent-review':'达到观察窗口，等待独立复核',
 'implemented':'代码已实现','connected':'接口已接通','waiting':'待验证','not-deployed':'尚未部署','partial':'部分具备','available':'已有数据','passed':'验证通过','failed':'验证失败'};
const labels={status:'状态',reason:'原因',missing:'缺失依据',rejected:'未纳入记录',source:'来源',sourceUrl:'原始来源',
 symbol:'股票',eventType:'事件类型',title:'事件',revision:'修订',publishedAt:'公开时点',firstKnownAt:'首次获知',recordedAt:'保存时点',
 horizonSessions:'观察交易日',horizonDays:'持有交易日',stockReturnPct:'价格变化 %',benchmarkReturnPct:'同期市场变化 %',excessReturnPct:'市场调整差额 %',
 samples:'样本数',independentEvents:'独立事件数',independentDates:'独立日期数',averageExcessReturnPct:'平均市场调整差额 %',failureCases:'失败与反向案例',
 events:'事件档案',groups:'分组比较',durationProfile:'不同观察窗口',rows:'可核对记录',limitations:'适用边界',evidence:'证据',
 expectation:'事前预期',actual:'披露结果',surprise:'预期差',classification:'分类',assessment:'判断',value:'值',metric:'指标',period:'所属期间',
 from:'关系起点',to:'关系终点',relation:'关系类型',relationClass:'业务关系类别',strength:'证据强度',validFrom:'生效时点',validUntil:'失效时点',edges:'关系',paths:'潜在传导路径',
 granularity:'数据粒度',capabilities:'能够支持的分析',spreadBps:'买卖价差（基点）',imbalance:'可见深度失衡',quoteAt:'原始报价时点',receivedAt:'取得时点',
 session:'交易时段',strategy:'策略',system:'策略体系',regime:'市场状态',netReturnPct:'成本后变化 %',grossReturnPct:'成本前变化 %',unassigned:'未能归属四套策略的样本',
 name:'名称',concentration:'成交集中程度',hhi:'成交集中指数',coverage:'覆盖',account:'原账户敞口',theme:'主题',members:'已知成员',
 action:'研究选择',candidate:'候选方案',current:'原方案',equalWeight:'等权参照',weights:'研究权重',weight:'目标权重',currentWeight:'当前权重',
 expectedReturn:'同周期收益估计',conservativeReturn:'保守收益估计',volatility:'同周期波动估计',estimatedCosts:'预估总成本',constraintsSatisfied:'是否满足研究约束',violations:'不满足的约束',changes:'假设调整',
 baseline:'原始结论',scenarios:'扰动情景',label:'情景',sensitivity:'敏感性',maximumWeightChange:'最大权重变化',rankingChanged:'排名变化',
 inputOrigin:'证据取得方式',independentlyVerified:'是否独立认证',knownAt:'可知时点',sourceSha:'源码提交',checkedFiles:'已核验文件',
 constraints:'约束依据',costs:'成本依据',reviews:'后续对照',records:'已冻结方案',classification:'时点性质',selectedId:'当时选择',
 task:'任务编号',replayLimit:'本次显示上限',replayMeaning:'复盘口径',replay:'复盘对照',historyEvidence:'历史证据覆盖',
 informationCutoff:'当时信息截止',snapshotAt:'账户取样时点',accountRevision:'原账户版本',capital:'同条件资金',
 sourceSnapshot:'原始封存依据',freezeTime:'冻结时间与执行边界',selected:'是否当时选择',differenceFromSelected:'与当时选择的差额',
 pendingOrders:'未终结订单数',availableCash:'可用现金',pendingBuyOrders:'未终结买单数',pendingSellOrders:'未终结卖单数',
 code:'代码状态',interface:'接口状态',realData:'真实数据状态',validation:'验证状态',deployed:'部署状态',observation:'观察状态'};
const value=x=>x==null?'未知':typeof x==='boolean'?(x?'是':'否'):typeof x==='number'?format(x,Number.isInteger(x)?0:6):statuses[x]||String(x);
function facts(rows){return h('dl',{class:'fy-facts'},rows.map(([k,v])=>h('div',{class:'fy-fact'},h('dt',{},k),h('dd',{},value(v)))));}
function evidence(data,depth=0){
 if(data==null)return empty('尚无该项证据');
 if(typeof data!=='object')return h('p',{},value(data));
 if(depth>5)return h('p',{class:'fy-muted'},'更多逐项依据可导出本次报告查看。');
 if(Array.isArray(data))return h('div',{class:'fy-stack'},...data.slice(0,50).map((row,index)=>typeof row==='object'&&row?
  h('details',{class:'fy-details'},h('summary',{},row.title||row.label||row.name||row.symbol||row.id||'记录 '+(index+1)),evidence(row,depth+1)):
  typeof row==='string'&&/^https?:\/\//.test(row)?safeLink(row,'查看交付依据'):h('p',{},value(row))),
  data.length>50?h('p',{class:'fy-muted'},'显示前50条；导出包含完整服务端结果。'):null);
 const simple=[],details=[];
 for(const [key,item] of Object.entries(data)){
  if(/password|secret|credential|cookie|bearer|token/i.test(key)||['canTrade','canNotify','researchOnly','productionWeightsChanged','writesAccount','schemaVersion'].includes(key))continue;
  if(item&&typeof item==='object')details.push(h('details',{class:'fy-details'},h('summary',{},labels[key]||key),evidence(item,depth+1)));
  else if((key==='sourceUrl'||key==='url')&&item)details.push(safeLink(item,'查看原始来源'));
  else simple.push([labels[key]||key,/At$/.test(key)?dateTime(item):item]);
 }
 return h('div',{class:'fy-stack'},facts(simple),...details);
}
function exportReport(report,name){const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
 const link=h('a',{href:url,download:name});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function renderDeepRiskObservations(result){
 const observations=arr(result?.observations||result?.riskObservations);
 return section('渐进风险观察','预警、送达与成交分别核对。研究观察本身不提交订单。',
  observations.length?table([{label:'程度',value:r=>r.level},{label:'风险与对象',value:r=>(r.risk||'研究观察')+' · '+arr(r.affected).join('、')},
   {label:'依据与限制',value:r=>h('details',{class:'fy-details'},h('summary',{},r.stale?'证据已过时，请重新核对':'查看条件'),
    facts([['原始时点',dateTime(r.dataAt)],['触发',r.triggerCondition],['升级',r.escalationCondition],['解除',r.releaseCondition],['限制',arr(r.restrictions).join('；')]]),evidence(r.evidence))}],observations):empty('尚无新增风险证据，不能据此认定没有风险'));
}

// Runtime summaries are observation evidence, not full-market coverage. Keep
// missing receipts and unknown calendar population visible on both clients.
const countValue=n=>Number.isSafeInteger(n)&&n>=0?n:null;
function observationCounts(data,names){
 if(!data||typeof data!=='object')return null;
 const result=Object.fromEntries(names.map(name=>[name,countValue(data[name])]));
 return Object.values(result).some(n=>n===null)?null:result;
}
export function renderRuntimeObservationCoverage(observation){
 const confirmed=observation?.elapsedTradingDaysComplete===true;
 const calendar=observation?.calendar||{};
 const coverageRows=arr(observation?.days).slice(-60).map(d=>{
  let held=observationCounts(d.heldMonitorCoverage,['attemptedMinutes','observedMinutes','missingMinutes','observedExpectedSymbolMinutes','observedFreshSymbolMinutes']);
  if(held&&(d.heldMonitorCoverage.scope!=='original-monitor-held-symbols-v1'||held.observedMinutes+held.missingMinutes!==held.attemptedMinutes||held.observedFreshSymbolMinutes>held.observedExpectedSymbolMinutes||!held.observedMinutes&&held.observedExpectedSymbolMinutes!==0))held=null;
  let account=observationCounts(d.accountReconciliation,['attempted','verifiedLocal','unsuccessful','unknown']);
  if(account&&(d.accountReconciliation.scope!=='original-paper-local-joint-reconciliation-v1'||account.verifiedLocal+account.unsuccessful+account.unknown!==account.attempted))account=null;
  return {day:d.day,held,account};
 });
 const receiptLabel=r=>r.held&&r.held.attemptedMinutes?`${format(r.held.observedMinutes,0)} / ${format(r.held.attemptedMinutes,0)}（缺 ${format(r.held.missingMinutes,0)}）`:'未知';
 const coverageLabel=r=>r.held&&r.held.observedMinutes&&r.held.observedExpectedSymbolMinutes>0?`${format(r.held.observedFreshSymbolMinutes,0)} / ${format(r.held.observedExpectedSymbolMinutes,0)} · ${format(100*r.held.observedFreshSymbolMinutes/r.held.observedExpectedSymbolMinutes)}%`:'未知';
 const accountLabel=r=>r.account&&r.account.attempted?`本地一致 ${format(r.account.verifiedLocal,0)} · 未成功 ${format(r.account.unsuccessful,0)} · 未知 ${format(r.account.unknown,0)}`:'未知';
 return section('运行观察与持仓覆盖','只展示原持仓巡检和原双账户的已取得回执；不代表全市场覆盖或外部券商对账。',
  facts([['交易日窗口',confirmed?'范围已核对':'完整范围待核'],['已知结束交易日',countValue(observation?.elapsedTradingDays)],
   ['历史观察日被当前日历漏列',Array.isArray(calendar.omittedAttemptDays)?calendar.omittedAttemptDays.length:null],
   ['日历版本变化日',Array.isArray(calendar.versionMismatchDays)?calendar.versionMismatchDays.length:null]]),
  coverageRows.length?table([{label:'交易日',value:r=>r.day||'未知'},{label:'持仓回执分钟（取得 / 已尝试）',value:receiptLabel},
   {label:'已取得股票×分钟有效覆盖',value:coverageLabel},{label:'原双账户本地检查',value:accountLabel}],coverageRows):empty('尚无真实观察回执','等待已验证安装和真实交易日采样。'),
  arr(observation?.days).length>60?note('仅显示最近60个已知交易日，完整记录可导出。'):null,
  note('此处的已尝试分钟不是完整交易时段；未尝试和缺失分钟不进入已取得覆盖率的分母，但完整窗口评价仍需保留这些缺口。没有原回执时保持未知。'));
}

export function renderDeepResearch(ctx){
 const status=note('读取现有事件、研究档案与原账户证据。'),output=h('div',{class:'fy-stack'});
 const choices=[['events','事件与预期'],['relations','关系与拥挤'],['sessions','盘口与时段'],['portfolio','组合与稳健性'],['review','对照复盘'],['acceptance','版本与运行']];
 const choose=h('select',{'aria-label':'深度研究主题'},choices.map(([key,label])=>h('option',{value:key},label)));
 let report=null,acceptance=null,turn=0,imported=null,pendingFreeze=null,pendingImport=null,fileTurn=0;
 const active=id=>id===turn&&!ctx.signal?.aborted;
 const editable=()=>!ctx.signal?.aborted&&(ctx.role===undefined?ctx.canEdit===true:ctx.role==='edit');
 const root=section('深度研究与决策核对','事件、组合、对照与真实运行证据共享原后台。缺少依据时保留未知。',
  h('div',{class:'fy-toolbar'},field('研究主题',choose)),status,output);
 root.dataset.deepResearch='true';
 function modules(ids){return ids.map(id=>section(titles[id], '',evidence(report?.research?.modules?.[id])));}
 function draw(){
  output.replaceChildren();
  if(choose.value==='acceptance'){
   if(!acceptance)return output.append(empty('点击“读取当前证据”核对版本与真实运行'));
   const release=acceptance.release||{},observation=acceptance.observation||{};
   output.append(facts([['安装核验',release.status],['精确提交',release.sourceSha],['双端与接口版本',release.versions?.compatible],['依赖清单',release.sbom?.status],
    ['实际有采样交易日',observation.observedTradingDays],['完整观察交易日',observation.completeObservationDays],['长期验收',observation.longTermAccepted?'已通过':'尚未通过']]),
    table([{label:'观察窗口',value:r=>r.tradingDays+'个交易日'},{label:observation.elapsedTradingDaysComplete===true?'已到交易日':'已知交易日（范围待核）',value:r=>r.elapsedTradingDays},{label:'完整观察日',value:r=>r.completeObservationDays},
     {label:'状态',value:r=>value(r.status)},{label:'待核对',value:r=>arr(r.blockers).join('；')}],arr(observation.stages)),
    renderRuntimeObservationCoverage(observation),
    h('details',{class:'fy-details'},h('summary',{},'逐项交付状态（78项）'),table([{label:'编号',value:r=>r.id},{label:'任务与依据',value:r=>h('details',{class:'fy-details'},
     h('summary',{},r.title||'沿用原任务，等待对应组证据'),evidence(r))},
     ...[['code','代码'],['interface','接线'],['realData','真实数据'],['validation','验证'],['deployed','部署'],['observation','观察']].map(([key,label])=>({label,value:r=>value(r[key]?.status)}))],arr(acceptance.tasks||observation.tasks))),
    h('details',{class:'fy-details'},h('summary',{},'逐日缺口与版本分段'),evidence({days:observation.days,versionSegments:observation.versionSegments,criteria:observation.criteria})),
    button('导出版本与运行证据',()=>exportReport(acceptance,'fayo-runtime-acceptance.json'),'secondary'));
   return;
  }
  if(!report)return output.append(empty('等待服务器研究证据'));
  if(choose.value==='events')output.append(...modules([67,68]));
  if(choose.value==='relations')output.append(...modules([69,72]),renderDeepRiskObservations(report));
  if(choose.value==='sessions')output.append(...modules([70,71]));
  if(choose.value==='portfolio')output.append(...['portfolio','rebalance','robustness'].map((key,index)=>section(titles[index+73],'研究候选须经原风控与批准流程。',evidence(report.decisions?.[key]))),
   h('details',{class:'fy-details'},h('summary',{},'原历史证据与描述性参照'),evidence(report.decisions?.archiveEvidence)));
  if(choose.value==='review'){
   const horizon=h('select',{'aria-label':'对照持有周期'},[1,5,20,60].map(n=>h('option',{value:n},n+'个交易日')));
   const selected=h('select',{'aria-label':'当前研究选择'},h('option',{value:'hold'},'继续持有'),h('option',{value:'cash'},'保持现金'));
   if(pendingFreeze){horizon.value=String(pendingFreeze.horizonDays);selected.value=pendingFreeze.selectedId;horizon.disabled=true;selected.disabled=true;}
   const freeze=button('封存当前对照方案',async()=>{
    if(!report||!editable())return;freeze.disabled=true;
    const payload=pendingFreeze||{revision:report.revision,requestId:crypto.randomUUID(),horizonDays:Number(horizon.value),selectedId:selected.value,
     alternatives:[{id:'hold',action:'hold',label:'继续持有',weights:[]},{id:'cash',action:'cash',label:'保持现金',weights:[]}]};
    pendingFreeze=payload;const id=++turn;
    try{const saved=await ctx.api('/api/research/deep/alternatives',{method:'POST',body:payload,signal:ctx.signal,timeoutMs:60000});
     if(!active(id))return;pendingFreeze=null;status.textContent='对照已由后台保存；这不是订单或成交。';await load();
    }catch(error){if(active(id))status.textContent=error.message||'未取得保存回执，请重新读取后核对，勿重复修改同一对照。';}
    finally{if(!ctx.signal?.aborted)freeze.disabled=false;}
   },'secondary');
   output.append(section('冻结少量备选',pendingFreeze?'上一请求尚未取得回执，再次点击会核对原方案。':'后台保存同一账户版本、信息截止时间及成本约束。后续缺少成熟数据时继续等待。',
    h('div',{class:'fy-toolbar'},field('持有周期',horizon),field('当时选择',selected),freeze)),evidence(report.alternatives));
  }
  output.append(h('details',{class:'fy-details'},h('summary',{},'来源覆盖与缺口'),evidence({sources:report.sources,missing:report.missing})),
   button('导出本次研究证据',()=>exportReport(report,'fayo-deep-research.json'),'secondary'));
 }
 async function load(){
  if(!editable()){status.textContent='需要原编辑者身份才能读取私有研究。';return;}
  const id=++turn;status.textContent='正在读取原后台证据…';
  try{
   const kind=choose.value;const response=await ctx.api('/api/research/deep'+(kind==='acceptance'?'/acceptance':''),{signal:ctx.signal,timeoutMs:60000});
   if(!active(id))return;
   if(kind==='acceptance')acceptance=response.result;
   else{if(response.result?.mode!=='fayo-deep-research'||response.result.canTrade!==false)throw Error('研究证据格式未通过核对');report=response.result;}
   draw();status.textContent='已读取服务端证据。真实数据、验证和部署状态分别展示。';
  }catch(error){if(active(id)){output.replaceChildren();status.textContent=error.message||'读取暂未完成';}}
 }
 const refresh=button('读取当前证据',load,'primary');root.insertBefore(h('div',{class:'fy-toolbar'},refresh),status);
 choose.addEventListener('change',()=>{turn++;draw();if(choose.value==='acceptance'&&!acceptance)void load();});
 const file=h('input',{type:'file',accept:'.json,application/json','aria-label':'选择结构化研究证据'});
 const importStatus=note('仅接收有来源的结构化证据；首次获知时间由后台登记。');
 file.addEventListener('change',async()=>{imported=null;pendingImport=null;const ticket=++fileTurn,selected=file.files?.[0];if(!selected||!editable())return;
  if(selected.size>500000){importStatus.textContent='文件超过500KB，请按来源分批导入。';return;}
  try{const parsed=JSON.parse(await selected.text());if(!parsed||!Array.isArray(parsed.records)||!parsed.type)throw Error();if(ctx.signal?.aborted||ticket!==fileTurn)return;imported=parsed;importStatus.textContent='已读取 '+parsed.records.length+' 条，点击保存后才会进入研究档案。';}
  catch{if(!ctx.signal?.aborted&&ticket===fileTurn)importStatus.textContent='文件需包含type和records；请核对来源导出格式。';}});
 const save=button('保存研究证据',async()=>{
  if(!editable())return;
  if(!imported||!report){importStatus.textContent='请先读取当前证据并选择文件。';return;}
  const id=++turn;save.disabled=true;
  pendingImport??={type:imported.type,records:imported.records,revision:report.revision,requestId:crypto.randomUUID()};
  try{await ctx.api('/api/research/deep/evidence',{method:'POST',body:pendingImport,signal:ctx.signal,timeoutMs:60000});
   if(!active(id))return;imported=null;pendingImport=null;file.value='';importStatus.textContent='已保存带服务器接收时点的证据版本。';await load();
  }catch(error){if(active(id))importStatus.textContent=error.message||'证据未保存，请核对当前版本';}
  finally{if(!ctx.signal?.aborted)save.disabled=false;}
 },'secondary');
 root.append(h('details',{class:'fy-details'},h('summary',{},'导入自有或已授权研究证据'),file,importStatus,save));
 if(!editable()){refresh.disabled=true;save.disabled=true;file.disabled=true;status.textContent='需要原编辑者身份才能读取私有研究。';}
 ctx.signal?.addEventListener('abort',()=>{turn++;fileTurn++;report=null;acceptance=null;imported=null;pendingFreeze=null;pendingImport=null;file.value='';output.replaceChildren();},{once:true});
 return root;
}
