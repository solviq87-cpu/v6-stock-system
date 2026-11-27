import {h,button,section,field,note,empty,table,dateTime,format,safeLink} from './ui.js';
const arr=value=>Array.isArray(value)?value:[];
const titles={67:'事件影响',68:'预期差',69:'产业与公司关系',70:'盘口与竞价',71:'交易时段',72:'主题拥挤',73:'组合目标权重',74:'换仓成本门槛',75:'决策稳健性',76:'事前对照复盘'};
const statuses={unknown:'证据不足',pending:'等待成熟证据','no-adjust':'暂不调整','not-evaluated':'暂不能评估',
 'observed-research':'已有研究记录','candidate':'研究候选','prospective':'事前冻结','post-hoc-exploration':'事后探索',
 'development-modified':'开发副本有改动','development-source-only':'源码副本，尚非安装验收','verified-local-manifest':'本地安装文件校验一致',
 'pending-real-observation':'等待真实运行积累','evidence-or-remediation-required':'需补齐证据或修复问题','ready-for-independent-review':'达到观察窗口，等待独立复核',
 'integrated-candidate-inventory':'统一候选版本代码盘点，非交付验收',
 'implemented':'代码已实现','connected':'接口已接通','waiting':'待验证','not-deployed':'尚未部署','partial':'部分具备','available':'已有数据','passed':'验证通过','failed':'验证失败',
 'missing':'缺少实现或证据','blocked':'存在阻塞','observing':'观察积累中','verified':'已有核验登记','deployed':'已有部署登记'};
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
const value=x=>x==null?'未知':typeof x==='boolean'?(x?'是':'否'):typeof x==='number'?format(x,Number.isInteger(x)?0:6):typeof x==='string'&&Object.hasOwn(statuses,x)?statuses[x]:String(x);
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
 const calendar=observation?.calendar||{};
 const confirmed=observation?.elapsedTradingDaysComplete===true&&calendar.runtimeEligible===true&&
  ['omittedAttemptDays','versionMismatchDays','unverifiedVersionDays'].every(key=>Array.isArray(calendar[key])&&calendar[key].length===0);
 const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
 const rawDays=arr(observation?.days),byDay=new Map(),duplicates=new Set();let invalidDays=0;
 for(const d of rawDays){
  if(!validDay(d?.day)){invalidDays++;continue;}
  if(byDay.has(d.day))duplicates.add(d.day);else byDay.set(d.day,d);
 }
 const coverageRows=[...byDay.keys()].sort().slice(-60).map(day=>{
  const d=byDay.get(day);
  if(duplicates.has(day))return {day,held:null,account:null,duplicate:true};
  let held=observationCounts(d.heldMonitorCoverage,['attemptedMinutes','observedMinutes','missingMinutes','observedExpectedSymbolMinutes','observedFreshSymbolMinutes']);
  if(held&&(d.heldMonitorCoverage.scope!=='original-monitor-held-symbols-v1'||d.heldMonitorCoverage.fullMarketCertified!==false||held.observedMinutes+held.missingMinutes!==held.attemptedMinutes||held.observedFreshSymbolMinutes>held.observedExpectedSymbolMinutes||!held.observedMinutes&&held.observedExpectedSymbolMinutes!==0))held=null;
  let account=observationCounts(d.accountReconciliation,['attempted','verifiedLocal','unsuccessful','unknown']);
  if(account&&(d.accountReconciliation.scope!=='original-paper-local-joint-reconciliation-v1'||d.accountReconciliation.verifiedExternal!==false||account.verifiedLocal+account.unsuccessful+account.unknown!==account.attempted))account=null;
  if(Object.hasOwn(d,'attemptSamples')){
   const attempts=countValue(d.attemptSamples);
   if(held&&(attempts===null||held.attemptedMinutes!==attempts))held=null;
   if(account&&(attempts===null||account.attempted!==attempts))account=null;
  }else if(held&&account&&held.attemptedMinutes!==account.attempted){held=null;account=null;}
  return {day,held,account};
 });
 const receiptLabel=r=>r.duplicate?'重复交易日，待核':r.held&&r.held.attemptedMinutes?`${format(r.held.observedMinutes,0)} / ${format(r.held.attemptedMinutes,0)}（缺 ${format(r.held.missingMinutes,0)}）`:'未知';
 const coverageLabel=r=>r.held&&r.held.observedMinutes&&r.held.observedExpectedSymbolMinutes>0?`${format(r.held.observedFreshSymbolMinutes,0)} / ${format(r.held.observedExpectedSymbolMinutes,0)} · ${format(100*r.held.observedFreshSymbolMinutes/r.held.observedExpectedSymbolMinutes)}%`:'未知';
 const accountLabel=r=>r.account&&r.account.attempted?`本地一致 ${format(r.account.verifiedLocal,0)} · 未成功 ${format(r.account.unsuccessful,0)} · 未知 ${format(r.account.unknown,0)}`:'未知';
 return section('运行观察与持仓覆盖','只展示原持仓巡检和原双账户的已取得回执；不代表全市场覆盖或外部券商对账。',
  facts([['交易日窗口',confirmed?'范围已核对':'完整范围待核'],['已知结束交易日',countValue(observation?.elapsedTradingDays)],
   ['历史观察日被当前日历漏列',Array.isArray(calendar.omittedAttemptDays)?calendar.omittedAttemptDays.length:null],
   ['日历版本变化日',Array.isArray(calendar.versionMismatchDays)?calendar.versionMismatchDays.length:null],
   ['日历版本证据待核日',Array.isArray(calendar.unverifiedVersionDays)?calendar.unverifiedVersionDays.length:null],['重复观察日待核',duplicates.size],['无效观察日记录',invalidDays]]),
  coverageRows.length?table([{label:'交易日',value:r=>r.day||'未知'},{label:'持仓回执分钟（取得 / 已尝试）',value:receiptLabel},
   {label:'已取得股票×分钟有效覆盖',value:coverageLabel},{label:'原双账户本地检查',value:accountLabel}],coverageRows):empty('尚无真实观察回执','等待已验证安装和真实交易日采样。'),
  byDay.size>60?note('仅显示最近60个已知交易日，完整记录可导出。'):null,
  duplicates.size||invalidDays?note('重复或无效交易日不计入本表的有效回执；原报告保留。'):null,
  note('此处的已尝试分钟不是完整交易时段；未尝试和缺失分钟不进入已取得覆盖率的分母，但完整窗口评价仍需保留这些缺口。没有原回执时保持未知。'));
}

export function renderBackgroundArchive(overview){
 const names={'szse-fund':'深交所ETF证券成交月报',ecb:'ECB参考汇率','sec-edgar':'SEC财报事实',worldbank:'世界银行宏观指标'};
 const valid=overview?.mode==='official-background-archive-overview'&&overview.canTrade===false&&overview.pointInTimeBacktestReady===false;
 const state=valid?overview.status:'unavailable';
 const labels={unconfigured:'尚未配置原背景档案','missing-archive':'尚未取得原档案',empty:'该截点尚无背景记录',unavailable:'档案不可用，保留未知',partial:'部分范围待校验',available:'已核对显示范围的最新回执'};
 const rows=valid?arr(overview.rows).slice(0,12):[];
 const scopeLabel=r=>r.provider==='szse-fund'?r.scope.month:r.provider==='ecb'?`${r.scope.currency} / EUR · ${r.scope.start} 至 ${r.scope.end}`:
  r.provider==='sec-edgar'?`CIK ${r.scope.cik} · ${r.scope.tag} · 截至 ${r.scope.asOf}`:
   `${r.scope.country} · ${r.scope.indicator} · ${r.scope.startYear} 至 ${r.scope.endYear}`;
 return section('官方背景档案','列出本地已取得的历史资料、报告期和原文回执。',
  facts([['状态',labels[state]||labels.unavailable],['本地信息截止',valid?dateTime(overview.asOf):null],['可见数据范围',valid?overview.totalScopes:null],
   ['已复核最新回执',valid&&overview.totalScopes!=null?overview.checkedLatestReceipts:null],['待核范围',valid?overview.unverifiedScopes:null]]),
  rows.length?rows.map(r=>{
   const ok=r.status==='verified-latest-receipt'&&Object.hasOwn(names,r.provider)&&r.scope&&Array.isArray(r.records)&&r.sourcePublishedAt===null&&r.sourceRevisedAt===null;
   return h('details',{class:'fy-details'},h('summary',{},`${names[r.provider]||'背景来源'} · ${ok?scopeLabel(r):'回执待核'}`),
    facts([['本地接收',dateTime(r.observedAt)],['实际入档',dateTime(r.availableAt)],['该版本首次本地获知',dateTime(r.firstKnownAt)],
     ['原始发布时间','未知'],['原始修订时间','未知'],['档案版本',r.version],['回执SHA-256',r.archiveHash],
     ['原响应SHA-256',r.dataVersion],['本次复核',ok?'原响应与投影哈希一致':r.status==='not-checked-budget'?'超过本次读取预算，未核验':'回执不可用']]),
    ok?facts([['记录数',r.recordCount],['明确缺值数',r.missingValues],['原始字节依据',r.byteBasis==='response-body'?'响应字节':'解码后的正文']]):null,
    ok&&r.provider==='szse-fund'?h('div',{class:'fy-etf-monthly'},
     note('报告期 '+r.scope.month+'。二级市场成交额以万元人民币计。净申购未知，交易主体未知。'),
     r.records.length?table([{label:'观察基金（深市）',value:x=>x.symbol+' '+x.name},
      {label:'目标指数',value:x=>x.trackingIndex??'未知'},{label:'当月成交额（万元）',value:x=>x.monthlyTurnoverWanCny==null?'未知':String(x.monthlyTurnoverWanCny)}],r.records):empty('本期未列入所选观察基金'),
     /^W\d{21}\.html$/.test(r.scope.documentId)?h('a',{href:'https://docs.static.szse.cn/www/market/periodical/month/'+r.scope.documentId,target:'_blank',rel:'noopener noreferrer'},'深交所月报原表'):null):
    ok&&r.records.length?table([{label:'观察或报告期间',value:x=>x.period},{label:'数值',value:x=>x.value==null?'未知':value(x.value)},
     {label:'单位',value:x=>x.unit??'未知'},{label:'申报日期',value:x=>x.filedDate??'不适用'}],r.records.slice(0,5)):empty(ok?'暂无该范围的可见数值':'尚无已复核数值'));
  }):empty(labels[state]||labels.unavailable,'只读页面不会发起采集或创建档案。'),
  note('最多显示最近12个数据范围、每个最新回执的5条记录。较早版本原档案保留；本页不认证全部历史原文或真实外部发布时间。'));
}

// The original task ledger has a fixed denominator. Each positive state is
// specific to its own axis, and even a positive declaration is not certification.
const TASK_AXES=[['code','代码','implemented'],['interface','接线','connected'],['realData','真实数据','available'],['validation','验证','passed'],['deployed','部署','deployed'],['observation','观察','verified']];
const TASK_COMMON=new Set(['unknown','missing','partial','failed','blocked']);
// Presentation rechecks the same reference shapes as the original server.
// This is not a network verification or independent acceptance grant.
const safeRef = value => typeof value==='string'&&value.length<=300&&(
    /^https:\/\/github\.com\/solviq87-cpu\/v6-stock-system\/(?:pull\/[1-9]\d*|commit\/[a-f0-9]{40}|actions\/runs\/[1-9]\d*(?:\/attempts\/[1-9]\d*)?)(?:#[A-Za-z0-9_-]+)?$/.test(value)||
    /^(?:V6_BO|docs|tests)\//.test(value)&&!/[\\?:#%\x00-\x20\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'));
const receiptRef = ref => /^(?:V6_BO\/)?docs\/validation\/.+\.(?:json|md|txt|log|tap)$/i.test(ref);
  const runRef = ref => /^https:\/\/github\.com\/solviq87-cpu\/v6-stock-system\/actions\/runs\//.test(ref);
  const completionRef = (axis,ref,sha) => {
    if(axis==='code')return /^V6_BO\/(?:src\/|scripts\/|public\/|strategies\/|config\/|deploy\/)/.test(ref)&&
      !/\/(?:tests|fixtures|docs)\//.test(ref)&&/\.(?:js|cjs|mjs|json|py|ts|tsx|css|html|sh|ps1|ya?ml)$/i.test(ref)||
      ref==='https://github.com/solviq87-cpu/v6-stock-system/commit/'+sha;
    if(axis==='interface'||axis==='validation')return runRef(ref)||receiptRef(ref);
    return receiptRef(ref);
  };
function taskStatus(row,key,positive){
 const axis=row?.[key],status=axis?.status;
 if(!Array.isArray(axis?.evidence)||!axis.evidence.some(safeRef))return 'unknown';
 if(status===positive){
  if(typeof row.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(row.sourceSha)||axis.reason!=null||
    axis.evidence.length>12||!axis.evidence.every(safeRef)||!axis.evidence.some(ref=>completionRef(key,ref,row.sourceSha)))return 'unknown';
  return status;
 }
 return TASK_COMMON.has(status)||key==='deployed'&&status==='not-deployed'||key==='observation'&&['waiting','observing'].includes(status)?status:'unknown';
}
export function summarizeTaskDelivery(entries){
 const byId=new Map(),duplicates=new Set();let invalidRows=0;
 for(const row of arr(entries)){
  if(!Number.isInteger(row?.id)||row.id<1||row.id>78){invalidRows++;continue;}
  if(byId.has(row.id)||arr(row.issues).includes('duplicate-task-id'))duplicates.add(row.id);
  if(!byId.has(row.id))byId.set(row.id,row);
 }
 const rows=Array.from({length:78},(_,i)=>{
  const id=i+1,recordState=duplicates.has(id)?'duplicate':byId.has(id)?'received':'missing';
  const record=recordState==='received'?byId.get(id):null;
  const statuses=Object.fromEntries(TASK_AXES.map(([key,,positive])=>[key,taskStatus(record,key,positive)]));
  return {id,recordState,record,statuses,allPositive:TASK_AXES.every(([key,,positive])=>statuses[key]===positive),
   blocked:Object.values(statuses).some(status=>status==='failed'||status==='blocked')};
 });
 const axes=TASK_AXES.map(([key,label,expected])=>{
  const positive=rows.filter(r=>r.statuses[key]===expected).length,partial=rows.filter(r=>r.statuses[key]==='partial').length,
   failed=rows.filter(r=>['failed','blocked'].includes(r.statuses[key])).length;
  return {key,label,positive,partial,failed,pending:78-positive-partial-failed};
 });
 return {total:78,received:rows.filter(r=>r.recordState==='received').length,
  duplicateIds:rows.filter(r=>r.recordState==='duplicate').map(r=>r.id),missingIds:rows.filter(r=>r.recordState==='missing').map(r=>r.id),
  invalidRows,allPositive:rows.filter(r=>r.allPositive).length,axes,rows};
}
export function renderTaskDeliveryStatus(entries){
 const summary=summarizeTaskDelivery(entries),list=h('div',{class:'fy-stack'}),visible=note('');
 const choices=[['all','全部78项'],['remaining','六阶段登记未齐备'],['blocked','明确失败或阻塞'],['missing','缺失或重复编号']];
 const filter=h('select',{'aria-label':'筛选任务交付状态',onChange:()=>draw()},choices.map(([key,label])=>h('option',{value:key},label)));
 filter.value='all';
 function draw(){
  const rows=summary.rows.filter(row=>filter.value==='remaining'?!row.allPositive:filter.value==='blocked'?row.blocked:filter.value==='missing'?row.recordState!=='received':true);
  visible.textContent=`当前显示 ${rows.length} / 78 项`;
  list.replaceChildren(rows.length?table([{label:'编号',value:r=>String(r.id).padStart(2,'0')},{label:'任务与依据',value:r=>r.recordState==='received'?
   h('details',{class:'fy-details'},h('summary',{},r.record.title||'沿用原任务，等待对应组证据'),evidence(r.record)):
   r.recordState==='duplicate'?'编号重复，回执待核对':'缺少该编号回执'},
   ...TASK_AXES.map(([key,label])=>({label,value:r=>value(r.statuses[key])}))],rows):empty('该筛选条件下没有记录','其余任务的未知状态仍然保留。'));
 }
 draw();
 return section('逐项交付状态（78项）','六个阶段各自统计原台账登记；不是整体完成率，也不是正式部署或独立验收证明。',
  facts([['收到唯一任务编号',summary.received],['缺少任务编号',summary.missingIds.length],['重复待核编号',summary.duplicateIds.length],
   ['无效编号记录',summary.invalidRows],['六阶段均有正向登记（非验收）',summary.allPositive]]),
  table([{label:'交付阶段',value:r=>r.label},{label:'正向登记 / 78',value:r=>r.positive},{label:'部分具备',value:r=>r.partial},
   {label:'失败或阻塞',value:r=>r.failed},{label:'待核或未完成',value:r=>r.pending}],summary.axes),
  h('details',{class:'fy-details'},h('summary',{},'查看78项任务明细'),h('div',{class:'fy-toolbar'},field('显示范围',filter)),visible,list),
  note('缺失或重复编号保留在78项分母中；不明状态或没有证据的正向声明保持待核。正向登记必须匹配源码版本和相应阶段的证据类型；原始证据可随完整报告导出。'));
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
    ['实际有采样交易日',observation.observedTradingDays],['完整观察交易日',observation.completeObservationDays],['长期验收',observation.longTermAccepted===true?'已通过':observation.longTermAccepted===false?'尚未通过':'待核验']]),
    table([{label:'观察窗口',value:r=>r.tradingDays+'个交易日'},{label:observation.elapsedTradingDaysComplete===true?'已到交易日':'已知交易日（范围待核）',value:r=>r.elapsedTradingDays},{label:'完整观察日',value:r=>r.completeObservationDays},
     {label:'状态',value:r=>value(r.status)},{label:'待核对',value:r=>arr(r.blockers).join('；')}],arr(observation.stages)),
    renderRuntimeObservationCoverage(observation),
    renderTaskDeliveryStatus(acceptance.tasks??observation.tasks),
    h('details',{class:'fy-details'},h('summary',{},'逐日缺口与版本分段'),evidence({days:observation.days,versionSegments:observation.versionSegments,criteria:observation.criteria})),
    button('导出版本与运行证据',()=>exportReport(acceptance,'fayo-runtime-acceptance.json'),'secondary'));
   return;
  }
  if(!report)return output.append(empty('等待服务器研究证据'));
  if(choose.value==='events')output.append(renderBackgroundArchive(report.background),...modules([67,68]));
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
