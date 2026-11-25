import {h,button,field,section,empty,table,format,dateTime,downloadJSON} from './ui.js';

// Native, editor-only read model. All text is inserted as textContent by h().
const arr=x=>Array.isArray(x)?x:[];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pct=x=>finite(x)?format(x)+'%':'待证据';
const label={all:'全部',selected:'入选',observe:'观察',upgraded:'升级',downgraded:'降级',rejected:'淘汰',reentered:'重新入选',invalidated:'失效',unknown:'未知',pass:'通过',fail:'未通过',partial:'部分可用',observed:'已观察',closed:'已闭合',current:'当前阶段',upcoming:'尚未开始',elapsed:'时段已过',missing:'缺少证据',available:'可用','not-evaluated':'尚不可评估','not-validated':'尚未验证','insufficient-data':'证据不足','insufficient-sample':'样本不足','observed-research-only':'研究观察','calendar-unknown':'日历未知','open-day':'交易日','closed-day':'休市','price-path-only':'价格路径观察',aligned:'方向一致',conflict:'存在分歧',up:'向上',down:'向下',flat:'横向',expired:'已过期',valid:'原条件有效',invalid:'失效','requires-review':'待核查',day:'日线',week:'周线',month:'月线',minute:'分时',evaluated:'已评估'};
const sections={workflow:'交易日研究流程',market:'市场、财务与信号',lifecycle:'候选与反向证据',research:'检验、竞争与融合',trades:'成交深度复盘',ai:'AI 质量与安全'};
const columns={code:'代码',name:'名称',status:'状态',relativeStrength:'相对强度',risk:'风险原因',score:'原评分',date:'观察日期',strategy:'策略',source:'来源',knownAt:'取得时间'};
const priorityNames={risk:'风险与失效条件',workflow:'当前研究阶段',candidates:'候选跟踪',market:'市场相对强度',research:'验证进度',trades:'成交复盘'};
const text=x=>x==null||x===''?'待证据':typeof x==='boolean'?(x?'是':'否'):label[x]||String(x);
const defaults=()=>({groups:[],templates:[],columns:['code','name','status','relativeStrength','risk'],search:'',status:'all',activeGroup:'all',selectedCode:'',sectionOrder:Object.keys(sections),homepagePriority:['risk','workflow','candidates'],expanded:[],scrollTop:0,density:'comfortable'});
const select=(entries,value)=>h('select',{value},entries.map(([id,name])=>h('option',{value:id,selected:id===value},name)));
const facts=items=>h('dl',{class:'fy-facts'},items.map(([key,value])=>[h('dt',{},key),h('dd',{},text(value))]));
const list=items=>arr(items).length?h('ul',{},items.map(value=>h('li',{},typeof value==='object'?value.reason||value.text||value.label||value.id||'待证据':value))):h('p',{class:'fy-muted'},'暂无对应记录；缺失不等于条件通过。');
const details=(title,...children)=>h('details',{class:'fy-details'},h('summary',{},title),...children);
const rowTable=(defs,rows)=>table(defs.map(([name,get])=>({label:name,value:get})),arr(rows));
function evidence(value,depth=0){
 if(value==null)return h('p',{class:'fy-muted'},'尚无归档证据。');
 if(typeof value!=='object')return h('p',{},text(value));
 if(depth>5)return h('p',{class:'fy-muted'},'完整层级可从私有导出查阅。');
 if(Array.isArray(value))return h('div',{class:'fy-stack'},value.length?value.slice(0,80).map((row,i)=>typeof row==='object'?details(text(row?.label||row?.name||row?.code||row?.id||('记录 '+(i+1))),evidence(row,depth+1)):h('p',{},text(row))):h('p',{class:'fy-muted'},'无记录。'),value.length>80?h('p',{},'页面展示前 80 项；完整记录保留在导出中。'):null);
 const scalars=[],nested=[];
 for(const [key,v]of Object.entries(value)){
  if(/token|password|secret|credential|cookie|bearer/i.test(key))continue;
  if(v&&typeof v==='object')nested.push(details(label[key]||key,evidence(v,depth+1)));
  else scalars.push([label[key]||key,typeof v==='number'&&/At$|asOf/.test(key)?dateTime(v):v]);
 }
 return h('div',{class:'fy-stack'},facts(scalars),nested);
}
function reportSummary(report){
 if(!report)return '尚无结果。';
 return [text(report.status),report.reason,arr(report.missing).filter(x=>typeof x==='string').join('；')].filter(Boolean).join(' · ');
}
function riskSummary(r){
 const counter=r.workflow?.counterEvidence,validity=r.market?.signalValidity;
 return [...arr(counter?.opposition).map(x=>x.reason||x.text),...arr(validity?.reasons)].filter(Boolean).join('；')||'缺少可核对的风险结论，请检查来源与失效条件。';
}
function priorityCard(id,r){
 const w=r.workflow||{},s=r.statistics||{};
 const messages={risk:riskSummary(r),workflow:arr(w.workflow?.stages).find(x=>x.status==='current')?.label||text(w.workflow?.calendarStatus),candidates:'已记录 '+(w.lifecycle?.total||0)+' 次变化 · 当前 '+arr(w.lifecycle?.current).length+' 只',market:reportSummary(r.market?.relativeStrength),research:reportSummary(s.competition),trades:'可核对结算 '+arr(w.trades?.rows).length+' 笔 · 未核验 '+arr(w.trades?.unverified).length+' 笔'};
 return h('article',{class:'fy-metric','data-priority':id},h('small',{},priorityNames[id]),h('p',{},messages[id]||'待证据'));
}

export function renderEvolution(ctx){
 if(!ctx.canEdit)return empty('需要研究编辑权限','请使用已获批的编辑设备登录。');
 const memory=ctx.viewMemory||{};
 const root=h('div',{class:'fy-stack fy-evolution','data-testid':'evolution-workbench'});
 const status=h('output',{class:'fy-note',role:'status','aria-live':'polite'},'正在读取原研究档案…');
 const summary=h('div',{class:'fy-grid fy-evolution-priorities'}),panels=h('div',{class:'fy-stack'}),settings=h('div',{class:'fy-stack'});
 const symbol=h('input',{value:/^\d{6}$/.test(ctx.stock||'')?ctx.stock:'',inputmode:'numeric',maxlength:6,pattern:'[0-9]{6}',placeholder:'六位证券代码','aria-label':'研究证券代码'});
 const at=h('input',{type:'datetime-local','aria-label':'历史时点（北京时间）'}),horizon=select([['1','1 个交易日'],['5','5 个交易日'],['20','20 个交易日'],['60','60 个交易日']],'5');
 const search=h('input',{type:'search',maxlength:120,placeholder:'代码、名称或风险原因','aria-label':'候选搜索'}),state=select(Object.entries(label).filter(([k])=>['all','selected','observe','upgraded','downgraded','rejected','reentered','invalidated','unknown'].includes(k)),'all'),group=select([['all','全部分组']],'all');
 state.setAttribute('aria-label','生命周期状态');group.setAttribute('aria-label','自选分组');horizon.setAttribute('aria-label','观察窗口');
 let data=null,draft=defaults(),revision=0,epoch=0,dirty=false,loaded=false,saving=false,pending=null,diagnostics=null;
 if(memory.evolution){draft={...defaults(),...memory.evolution.draft};revision=memory.evolution.revision||0;dirty=memory.evolution.dirty===true;symbol.value=memory.evolution.symbol||symbol.value;at.value=memory.evolution.at||'';horizon.value=memory.evolution.horizon||'5';}
 const current=turn=>turn===epoch&&!ctx.signal?.aborted&&ctx.canEdit;
 function changed(){dirty=true;pending=null;status.textContent='布局已修改，点击“保存双端布局”同步。';}
 function query(){
  const q=new URLSearchParams(),code=symbol.value.trim();if(code&&!/^\d{6}$/.test(code))throw Error('请输入六位证券代码。');if(code)q.set('symbol',code);
  if(at.value){const value=Date.parse(at.value+':00+08:00');if(!Number.isSafeInteger(value)||value>Date.now())throw Error('历史时点必须是已经发生的北京时间。');q.set('asOf',String(value));}
  q.set('horizon',horizon.value);return q;
 }
 function capture(){
  draft.search=search.value;draft.status=state.value;draft.activeGroup=group.value;draft.selectedCode=symbol.value.trim();
  draft.expanded=[...panels.querySelectorAll('details[data-section][open]')].map(el=>el.dataset.section);
  draft.scrollTop=Math.min(10000000,Math.max(0,Math.round(document.scrollingElement?.scrollTop||0)));
  return structuredClone(draft);
 }
 function applyControls(){
  search.value=draft.search;state.value=draft.status;
  group.replaceChildren(...[['all','全部分组'],...draft.groups.map(g=>[g.id,g.name])].map(([id,name])=>h('option',{value:id},name)));group.value=draft.activeGroup;
  root.dataset.density=draft.density;
 }
 async function load({saved=false}={}){
  const turn=++epoch;status.textContent='读取截至所选时点的研究证据…';reload.disabled=true;
  try{
   const r=await ctx.api('/api/research/evolution?'+query(),{signal:ctx.signal});if(!current(turn))return;
   if(!r.ok||r.result?.mode!=='fayo-intelligence-evolution')throw Error(r.error||'研究报告不可用。');
   data=r.result;diagnostics=null;
   if((!loaded&&!memory.evolution)||saved){draft={...defaults(),...data.workflow.preferences.value};revision=data.workflow.preferences.revision;if(!revision)draft.expanded=['workflow','market','lifecycle'];dirty=false;pending=null;}
   applyControls();if(!symbol.value)symbol.value=data.code||draft.selectedCode;
   loaded=true;renderSettings();render();
   status.textContent=(dirty?'证据已刷新，未保存的布局仍保留。':'已读取 · 布局版本 '+revision)+' · 证据时点 '+dateTime(data.asOf);
   exportButton.disabled=save.disabled=diagnosticButton.disabled=false;
   if(saved||!memory.evolution)requestAnimationFrame(()=>{if(current(turn))window.scrollTo({top:draft.scrollTop,behavior:'instant'});});
  }catch(error){if(current(turn)){status.textContent=error.message||'读取失败，已有输入保留。';if(!data)panels.replaceChildren(empty('研究档案暂不可用','可稍后重新读取；当前输入仍保留。'));}}
  finally{if(current(turn))reload.disabled=false;}
 }
 async function saveLayout(){
  if(saving||!loaded)return;saving=true;save.disabled=true;
  try{
   const value=capture(),key=JSON.stringify({value,expectedRevision:revision});if(!pending||pending.key!==key)pending={key,requestId:'evolution_'+crypto.randomUUID().replaceAll('-','')};
   const r=await ctx.api('/api/research/evolution',{method:'POST',body:{action:'preferences',requestId:pending.requestId,expectedRevision:revision,value},signal:ctx.signal});
   if(ctx.signal?.aborted)return;if(!r.ok)throw Error(r.error||'保存未完成。');
   revision=r.result.revision;draft=r.result.value;dirty=false;pending=null;applyControls();renderSettings();render();status.textContent='双端布局已保存 · 版本 '+revision+' · 刷新或从其他设备登录后可恢复。';
  }catch(error){if(!ctx.signal?.aborted)status.textContent=(error.message||'保存未完成。')+' 当前输入仍保留；版本冲突时可点击“恢复已保存布局”。';}
  finally{saving=false;if(!ctx.signal?.aborted)save.disabled=!loaded;}
 }
 const reload=button('刷新证据',()=>load(),'primary'),save=button('保存双端布局',saveLayout),restore=button('恢复已保存布局',()=>load({saved:true}));save.disabled=true;
 const exportButton=button('导出私有报告',async()=>{
  exportButton.disabled=true;
  try{const q=query();q.set('export','1');const r=await ctx.api('/api/research/evolution?'+q,{signal:ctx.signal});if(ctx.signal?.aborted)return;if(!r.ok)throw Error(r.error||'导出失败');downloadJSON('fayo-evolution-'+(r.result.code||'workspace')+'.json',r.result);status.textContent='已导出本次经授权重新读取的私有报告。';}
  catch(error){if(!ctx.signal?.aborted)status.textContent=error.message;}finally{if(!ctx.signal?.aborted)exportButton.disabled=!loaded;}
 });exportButton.disabled=true;
 const diagnosticButton=button('运行因果与稳定性检查',async()=>{
  diagnosticButton.disabled=true;const turn=epoch;status.textContent='正在检查原策略因果性与指标稳定性…';
  try{const q=Object.fromEntries(query()),r=await ctx.api('/api/research/evolution',{method:'POST',body:{action:'diagnostics',requestId:'diagnostic_'+crypto.randomUUID().replaceAll('-',''),...q},signal:ctx.signal,timeoutMs:60000});if(!current(turn))return;if(!r.ok)throw Error(r.error||'诊断未完成');diagnostics=r.result;render();status.textContent='检查已结束并保存；缺少真实输入的项目会注明尚不可评估。';}
  catch(error){if(current(turn))status.textContent=error.message;}finally{if(current(turn))diagnosticButton.disabled=false;}
 });diagnosticButton.disabled=true;
 const controls=section('研究进化工作台','原档案、原结算与原交易日历共同组成证据；每一项结论均保留其观察时点。',
  h('div',{class:'fy-toolbar'},field('研究证券',symbol),field('历史时点 · 北京时间',at),field('观察窗口',horizon)),
  h('div',{class:'fy-toolbar'},reload,save,restore,exportButton),status,
  h('div',{class:'fy-toolbar'},button('个股 K 线与原证据',()=>{const code=symbol.value.trim();if(/^\d{6}$/.test(code))ctx.selectStock?.(code);else status.textContent='请选择六位证券代码。';},'quiet'),
   button('在原回测继续',()=>{const code=symbol.value.trim();ctx.navigate('lab','shortline-backtest'+(/^\d{6}$/.test(code)?'/'+code:''));},'quiet'),
   button('查看原结构化复盘',()=>{const code=symbol.value.trim();ctx.navigate('lab','shortline-review'+(/^\d{6}$/.test(code)?'/'+code:''));},'quiet')));
 root.append(controls,summary,details('我的布局与筛选模板',settings),panels);
 for(const el of [symbol,at,horizon])el.addEventListener('change',()=>{epoch++;reload.disabled=false;diagnosticButton.disabled=!loaded;changed();});
 for(const el of [search,state,group])el.addEventListener(el===search?'input':'change',event=>{draft.search=search.value;draft.status=state.value;draft.activeGroup=group.value;changed();if(!event.isComposing)render();});
 search.addEventListener('compositionend',()=>{draft.search=search.value;changed();render();});
 ctx.signal?.addEventListener('abort',()=>{memory.evolution={draft:capture(),revision,dirty,symbol:symbol.value,at:at.value,horizon:horizon.value};epoch++;data=null;diagnostics=null;panels.replaceChildren();summary.replaceChildren();settings.replaceChildren();},{once:true});
 function renderSettings(){
  settings.replaceChildren();const density=select([['comfortable','舒适'],['compact','紧凑']],draft.density);density.setAttribute('aria-label','显示密度');density.addEventListener('change',()=>{draft.density=density.value;applyControls();changed();});
  const groupName=h('input',{maxlength:40,placeholder:'例如：核心观察','aria-label':'新分组名称'}),symbols=h('input',{placeholder:'600000,000001','aria-label':'分组证券代码'});
  const groups=h('div',{class:'fy-stack'},draft.groups.map(g=>h('div',{class:'fy-toolbar'},h('span',{},g.name+' · '+g.symbols.join('、')),button('删除 '+g.name,()=>{draft.groups=draft.groups.filter(x=>x.id!==g.id);draft.templates=draft.templates.filter(x=>x.groupId!==g.id);if(draft.activeGroup===g.id)draft.activeGroup='all';applyControls();renderSettings();render();changed();},'quiet'))));
  const addGroup=button('添加自选分组',()=>{const name=groupName.value.trim(),codes=[...new Set(symbols.value.split(/[\s,，、]+/).filter(Boolean))];if(!name||codes.some(x=>!/^\d{6}$/.test(x))||codes.length>200||draft.groups.length>=20){status.textContent='请填写分组名及六位证券代码；每组最多 200 只，最多 20 组。';return;}draft.groups.push({id:'g_'+crypto.randomUUID().slice(0,8),name,symbols:codes});applyControls();renderSettings();changed();});
  const templateName=h('input',{maxlength:40,placeholder:'模板名称','aria-label':'筛选模板名称'}),templates=select([['','选择筛选模板'],...draft.templates.map(t=>[t.id,t.name])],'');
  templates.setAttribute('aria-label','已保存模板');
  templates.addEventListener('change',()=>{const t=draft.templates.find(t=>t.id===templates.value);if(!t)return;Object.assign(draft,{search:t.search,status:t.status,activeGroup:t.groupId,columns:[...t.columns]});applyControls();renderSettings();render();changed();});
  const saveTemplate=button('保存当前筛选为模板',()=>{const name=templateName.value.trim();if(!name||draft.templates.length>=20){status.textContent='请输入模板名称，最多保存 20 个。';return;}draft.templates.push({id:'t_'+crypto.randomUUID().slice(0,8),name,search:search.value,status:state.value,groupId:group.value,columns:[...draft.columns]});renderSettings();changed();});
  const checks=h('div',{class:'fy-toolbar'},Object.entries(columns).map(([id,name])=>{const control=h('input',{type:'checkbox',checked:draft.columns.includes(id)});control.addEventListener('change',()=>{if(control.checked)draft.columns.push(id);else if(draft.columns.length>1)draft.columns=draft.columns.filter(c=>c!==id);else control.checked=true;changed();render();});return field(name,control);}));
  const order=h('div',{class:'fy-evolution-order'},draft.sectionOrder.map((id,i)=>h('div',{class:'fy-toolbar'},h('span',{},(i+1)+' · '+sections[id]),button('上移 '+sections[id],()=>{if(i===0)return;[draft.sectionOrder[i-1],draft.sectionOrder[i]]=[id,draft.sectionOrder[i-1]];captureExpanded();renderSettings();render();changed();},'quiet'))));
  const priorities=h('div',{class:'fy-toolbar'},Object.entries(priorityNames).map(([id,name])=>{const c=h('input',{type:'checkbox',checked:draft.homepagePriority.includes(id),disabled:id==='risk'});c.addEventListener('change',()=>{draft.homepagePriority=c.checked?[...draft.homepagePriority,id]:draft.homepagePriority.filter(x=>x!==id);changed();render();});return field(name,c);}));
  settings.append(h('div',{class:'fy-toolbar'},field('显示密度',density),field('已保存模板',templates)),checks,
   h('div',{class:'fy-toolbar'},field('分组名称',groupName),field('分组证券',symbols),addGroup),groups,
   h('div',{class:'fy-toolbar'},field('筛选模板',templateName),saveTemplate),
   ...draft.templates.map(t=>button('删除模板 '+t.name,()=>{draft.templates=draft.templates.filter(x=>x.id!==t.id);renderSettings();changed();},'quiet')),
   details('区块顺序',order),details('首页优先信息',priorities),h('p',{class:'fy-muted'},'保存会同步自选分组、筛选模板、栏目、区块顺序、首页优先信息、展开状态和当前页面位置。'));
 }
 function captureExpanded(){draft.expanded=[...panels.querySelectorAll('details[data-section][open]')].map(x=>x.dataset.section);}
 function panel(id,description,...children){
  const node=h('details',{class:'fy-panel fy-evolution-panel','data-section':id,open:draft.expanded.includes(id)},h('summary',{},h('span',{},sections[id]),h('small',{},description)),h('div',{class:'fy-stack'},...children));
  node.addEventListener('toggle',()=>{if(ctx.signal?.aborted||!node.isConnected)return;captureExpanded();});return node;
 }
 function render(){
  if(!data)return;const focused=document.activeElement,selection=focused===search?[search.selectionStart,search.selectionEnd]:null;
  const m=data.market||{},w=data.workflow||{},s=data.statistics||{},similar=data.similar||{};
  summary.replaceChildren(...draft.homepagePriority.map(id=>priorityCard(id,data)));
  const stages=arr(w.workflow?.stages);
  const workflow=panel('workflow',text(w.workflow?.calendarStatus)+' · '+text(w.workflow?.day),
   h('div',{class:'fy-evolution-stages'},stages.map(row=>h('article',{class:'fy-evolution-stage '+(row.status==='current'?'is-current':'')},h('h3',{},row.label||row.name||row.id),h('p',{},text(row.status)+' · '+(row.evidenceCount||0)+' 项证据'),h('p',{class:'fy-muted'},row.reason),button('打开相关记录',()=>ctx.navigate('lab',row.id==='post-market'?'shortline-review':'records'),'quiet')))),details('阶段来源与时点',evidence(w.workflow)));
  const rs=m.relativeStrength||{},mt=m.multiTimeframe||{},fin=m.financialHealth||{},valid=m.signalValidity||{};
  const market=panel('market',text(rs.status)+' · '+text(valid.status),
   section('相对强弱',reportSummary(rs),rowTable([['基准',x=>x.label+' '+x.id],['窗口',x=>x.window+' 日'],['个股',x=>pct(x.stockReturnPct)],['基准收益',x=>pct(x.benchmarkReturnPct)],['超额百分点',x=>finite(x.excessPct)?format(x.excessPct):'待证据'],['识别 / 缺失',x=>arr(x.tags).join('、')||arr(x.missing).join('；')||text(x.status)]],rs.comparisons),details('因子与独立增量验证',evidence(rs.independentGain))),
   section('多周期确认与冲突',reportSummary(mt),rowTable([['周期',x=>text(x.period)],['状态',x=>text(x.status)],['方向',x=>text(x.direction)],['变化',x=>pct(x.returnPct)],['最后闭合',x=>x.latest?.cycleEnd||'待证据'],['未闭合 / 缺失',x=>arr(x.incompleteCycles).join('、')||'—']],mt.frames),list(mt.conflicts),details('多周期独立增量验证',evidence(mt.independentGain))),
   section('财务健康',`${fin.coverage?.observed||0} / ${fin.coverage?.total||0} 项有原始证据`,rowTable([['指标',x=>x.label],['数值',x=>finite(x.value)?format(x.value)+' '+(x.unit||''):'未知'],['风险',x=>text(x.risk)],['报告 / 可得时间',x=>x.evidence?x.evidence.reportDate+' · '+dateTime(x.evidence.availableAt):'缺少原始回执']],fin.metrics),details('财报修订及原有九轴证据',evidence(fin))),
   section('信号时效',text(valid.status),facts([['原判断时间',dateTime(valid.decisionAt)],['失效时间',dateTime(valid.expiresAt)]]),list(valid.reasons),details('条件变化与重新核验',evidence(valid))));
  const lc=w.lifecycle||{},counter=w.counterEvidence||{},selectedGroup=draft.groups.find(g=>g.id===group.value),q=search.value.trim().toLowerCase();
  const candidates=arr(lc.current).filter(row=>(state.value==='all'||row.state===state.value)&&(!selectedGroup||selectedGroup.symbols.includes(row.code))&&(!q||[row.code,row.name,row.reason].join(' ').toLowerCase().includes(q)));
  const getters={code:x=>button(x.code,()=>{symbol.value=x.code;draft.selectedCode=x.code;changed();void load();},'quiet'),name:x=>x.name||'—',status:x=>text(x.state),relativeStrength:x=>x.code===data.code&&rs.comparisons?.find(x=>x.window===5)?.excessPct!=null?format(rs.comparisons.find(x=>x.window===5).excessPct)+' 点':'选择个股后核对',risk:x=>x.reason||'待证据',score:x=>x.score??'未知',date:x=>x.day||'未知',strategy:x=>x.version||'未知',source:x=>x.provenance||'未知',knownAt:x=>dateTime(x.recordedAt)};
  const lifecycle=panel('lifecycle',lc.total+' 次变化 · '+candidates.length+' 只当前候选',
   h('div',{class:'fy-toolbar'},field('搜索',search),field('生命周期状态',state),field('自选分组',group)),rowTable(draft.columns.map(id=>[columns[id],getters[id]]),candidates),
   section('支持、反对与失效条件',riskSummary(data),h('div',{class:'fy-grid'},section('支持证据','',list(counter.support)),section('反对证据','',list(counter.opposition))),list(counter.invalidations),details('四策略分歧与缺失',evidence({disagreement:counter.disagreement,missing:counter.missing,maximumRisk:counter.maximumRisk}))),
   details('完整生命周期',rowTable([['代码',x=>x.code],['变化',x=>text(x.previousState)+' → '+text(x.state)],['依据',x=>x.reason],['原观察时间',x=>dateTime(x.at)],['版本',x=>x.version||'未知']],lc.rows)),details('入选与落选后续路径',evidence(lc.followup)));
  const research=panel('research',reportSummary(s.competition),
   section('历史相似案例','相似度用于检索；收益分布只来自已成熟且合格的标签。',facts([['可比样本',similar.coverage?.comparable],['相似样本',similar.coverage?.matched],['已成熟',similar.coverage?.mature],['尚未成熟 / 不合格',similar.coverage?.unavailable]]),rowTable([['代码 / 日期',x=>x.code+' · '+x.date],['相似度',x=>pct(x.similarity*100)],['五日收盘',x=>x.available?pct(x.outcome?.close):'尚不可结算'],['区间最高 / 最低',x=>x.available?pct(x.outcome?.high)+' / '+pct(x.outcome?.low):'待证据']],arr(similar.neighbours).slice(0,20)),details('分布、失败样本与维度',evidence({distributions:similar.distributions,failures:similar.failure,excursions:similar.excursions,missing:similar.missing,optionalMissing:similar.optionalMissing,dimensions:similar.dimensions}))),
   ...[['competition','四策略竞争'],['benchmarks','同窗基准'],['robustness','稳健性与敏感性'],['overfitting','多重试验与过拟合'],['fusion','研究融合与消融'],['expectation','净交易期望']].map(([id,title])=>section(title,reportSummary(s[id]),evidence(s[id]))),
   section('未来泄漏审计与指标预热','使用原策略函数检查截断、未来扰动、增量更新及重启恢复。',diagnosticButton,evidence(diagnostics||s.diagnostics)));
  const tr=w.trades||{};
  const trades=panel('trades',arr(tr.rows).length+' 笔可核对结算',
   h('p',{class:'fy-muted'},tr.note),rowTable([['成交',x=>x.code+' · '+x.id],['来源',x=>x.settlementSource],['净盈亏',x=>format(x.netPnl)],['费用',x=>format(x.fees)],['净回报',x=>pct(x.netReturnPct)],['持有小时',x=>format(x.holdingHours)],['证据',x=>details('成交路径与计划偏差',evidence(x))]],tr.rows),
   details('未核验成交',evidence(tr.unverified)),details('未执行原因',evidence(tr.notExecuted)),button('进入原人工执行记录',()=>ctx.navigate('assets','closure')));
  const ai=panel('ai',text(w.aiEvaluation?.status),h('p',{class:'fy-muted'},'检查现有规则回答的证据、时间、概率语言、拒答、提示注入和越权条件；模型调用状态单独披露。'),
   facts([['外部模型是否实际调用',w.aiEvaluation?.modelInvoked],['回答类型',w.aiEvaluation?.answerKind]]),rowTable([['检查',x=>x.label||x.id],['结果',x=>text(x.status)],['依据',x=>x.reason||x.message||'见原证据']],w.aiEvaluation?.checks),details('完整检查证据',evidence(w.aiEvaluation)));
  const nodes={workflow,market,lifecycle,research,trades,ai};panels.replaceChildren(...draft.sectionOrder.map(id=>nodes[id]));root.dataset.density=draft.density;
  if([search,state,group].includes(focused)&&focused.isConnected){focused.focus({preventScroll:true});if(selection)search.setSelectionRange(...selection);}
 }
 queueMicrotask(()=>load());return root;
}

export function renderEvolutionPriority(ctx){
 if(!ctx.canEdit)return null;
 const content=h('div',{class:'fy-grid fy-evolution-priorities'}),root=section('我的优先信息','',content,button('打开研究进化工作台',()=>ctx.navigate('lab','evolution'),'quiet'));
 ctx.api('/api/research/evolution',{signal:ctx.signal}).then(r=>{if(ctx.signal?.aborted||!ctx.canEdit)return;if(r.ok&&r.result?.mode==='fayo-intelligence-evolution')content.replaceChildren(...arr(r.result.workflow?.preferences?.value?.homepagePriority).map(id=>priorityCard(id,r.result)));}).catch(()=>{if(!ctx.signal?.aborted)content.replaceChildren(h('p',{class:'fy-muted'},'优先信息暂不可用，可在研究工作台重新读取。'));});
 ctx.signal?.addEventListener('abort',()=>content.replaceChildren(),{once:true});return root;
}
