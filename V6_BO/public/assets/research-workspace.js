(function(root){
 'use strict';
 const doc=root.document;if(!doc?.getElementById('researchWorkspace'))return;
 const $=id=>doc.getElementById(id),host=$('workspaceContent'),status=$('workspaceStatus');
 let view=null,tab='evidence',offset=0,generation=0,request=null,undo=null,nativeEvidence=null,modelPrediction=null,selectedRunId=null;
 const tabs={evidence:'结论与证据',timeline:'判断变化',systems:'四体系分歧',screening:'筛选与落选',market:'市场与题材',scorecard:'策略成绩',defense:'持仓防守',diagnostics:'分析诊断'};
 const names={pass:'满足',fail:'未满足',unknown:'未知',selected:'已入选',rejected:'未入选','coverage-only':'证据覆盖',
  'first-observation':'首次观察',added:'新增条件',removed:'不再提供','observed-change':'观察变化','data-revision':'同日数据修订','rule-version-changed':'规则改版',
  warming:'升温观察',cooling:'降温观察',mixed:'分化', 'relative-front':'板块相对前排','relative-middle':'板块相对中段','relative-back':'板块相对后排',
  'not-evaluated-in-this-run':'本轮未评估这只股票','no-screen-run':'尚无筛选档案','insufficient-independent-samples':'独立样本不足',
  'index-up':'上证上涨日','index-down':'上证下跌日','index-flat':'上证平盘日',fourteen:'十四条',bazi:'八字口诀',gpt:'GPT五策略',python:'Python三轮',
  completed:'已完成',failed:'未完成',saved:'已封存',watch:'观望','filtered-out':'已评估，当前过滤条件隐藏了结果','entry-evidence-missing':'原入选依据未封存','quote-unusable':'报价不可用','review-invalidation':'原条件失效待复查',
  'observed-unverified':'已有观察，未认证',quality:'来源与质量',risk:'风险过滤',strategy:'策略条件',eligibility:'候选资格','paper-estimate':'含成本纸面估计'};
 Object.assign(names,{available:'已有本轮记录',partial:'部分完成',started:'正在进行',pending:'待到期','descriptive-only':'仅描述统计','not-evaluated':'尚未评估','unverified-execution':'成交证据不足',
  'user-uploaded-unverified':'用户上传，未验证','server-memory-cache-unverified':'内存历史缓存，未验证','persisted-unverified-cache':'磁盘历史缓存，未验证'});
 Object.assign(names,{'missing-outcome':'已到期，缺后续行情','unusable-outcome':'结果证据不可用','repeated-origin':'同日同配置重复，未增加样本','input-unavailable':'原输入不可核对',point:'点值',mean:'均值预测',median:'中位数预测'});
 const val=x=>x===null||x===undefined?'未知':typeof x==='object'?JSON.stringify(x):String(x),label=x=>names[x]||val(x);
 const arr=x=>Array.isArray(x)?x:[];
 const clock=x=>Number.isSafeInteger(x)&&x>0?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
 function node(tag,text,parent){const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.append(n);return n;}
 function line(p,k,v){node('p',k+'：'+val(v),p);}
 function detail(p,title){const n=node('details',undefined,p);node('summary',title,n);return n;}
 function card(title){const n=node('article',undefined,host);n.className='card';node('h3',title,n);return n;}
 function button(p,text,fn){const b=node('button',text,p);b.type='button';b.addEventListener('click',fn);return b;}
 async function inspectStock(symbol){
  if(!/^\d{6}$/.test(symbol||''))return;
  // Selecting a stock is distinct from collecting evidence or writing a run.
  if(typeof root.CustomEvent==='function')root.dispatchEvent(new root.CustomEvent('v6:research-context',{detail:{symbol,source:'workspace'}}));
  if($('workspaceSymbol').value.trim()!==symbol){$('workspaceSymbol').value=symbol;$('workspaceSymbol').dispatchEvent(new root.Event('input',{bubbles:true}));}
  tab='evidence';offset=0;if(!await call())return;
  host.focus({preventScroll:true});host.scrollIntoView({block:'start',behavior:'auto'});
 }
 function stockAction(parent,symbol){
  const valid=/^\d{6}$/.test(symbol||''),b=button(parent,'查看该股研究',()=>inspectStock(symbol));
  b.dataset.workspaceSymbol=valid?symbol:'';b.disabled=!valid;b.className='workspace-drilldown';
  b.setAttribute('aria-label',valid?'查看 '+symbol+' 的研究':'缺少股票代码，无法查看研究');
 }
 function key(){return 'web_'+(root.crypto?.randomUUID?.().replace(/-/g,'')||Date.now().toString(36)+Math.random().toString(36).slice(2));}
 function syncControls(){
  const busy=!!request;$('workspaceExport').disabled=busy||!view;$('workspaceLatest').disabled=busy||!selectedRunId;
  $('workspaceForecastInput').disabled=busy||!view?.forecastEvaluation?.input;
  $('workspaceForecastFreeze').disabled=busy||historical()||!view?.forecastEvaluation?.freezeAllowed||!modelPrediction;
 }
 function clearSummary(){const summary=$('workspaceSummary');if(summary){summary.replaceChildren();summary.hidden=true;}}
 function renderSummary(){
  const summary=$('workspaceSummary');if(!summary)return;clearSummary();if(!view)return;
  const r=view.selectedRun,screen=view.screening,defense=view.defense;
  node('h3','本次研究概览',summary);const context=node('p',(r?val(r.name)+' '+r.symbol+' · 数据日 '+val(r.tradeDate)+' · '+val(r.provider)+' · 记录 '+r.id.slice(0,10):'尚未选择股票研究')+'；查看时点 '+clock(view.asOf)+(historical()?' · 历史回放，只读':' · 已封存资料'),summary);context.id='workspaceSummaryContext';
  const grid=node('div',undefined,summary);grid.className='workspace-summary-grid';
  function overview(id,title,value,lines,target){const c=node('article',undefined,grid);c.className='workspace-summary-card';c.dataset.summaryCard=id;node('h4',title,c);const n=node('p',value,c);n.className='workspace-summary-value';for(const text of lines)node('p',text,c);
   const b=button(c,'查看'+tabs[target],async()=>{if(!view)return;tab=target;const paged=offset!==0,runId=view.selectedRun?.id;offset=0;
    if(paged){if(!await call(null,runId?{runId}:{}))return;}else render();
    host.focus({preventScroll:true});host.scrollIntoView({block:'start',behavior:'auto'});
   });b.dataset.summaryTab=target;
  }
  const conditions=Array.isArray(r?.conditions)?r.conditions:null,known=conditions?.filter(c=>c.status==='pass'||c.status==='fail').length,missing=conditions?.filter(c=>c.status==='unknown').length;
  overview('evidence','证据与缺口',conditions?known+' / '+conditions.length+' 项已知':'尚无条件记录',conditions?['缺失 '+missing+' 项条件 · 去重字段缺口 '+arr(view.quality?.gaps).length+' 个','所选研究版本；条件数量不是多空票数']:['先读取或选择一条已封存股票研究。'],'evidence');
  overview('screening','筛选批次',screen?.runId?val(screen.inputTotal)+' 只原始输入':'尚无筛选封存',screen?.runId?['整批末步保留 '+val(screen.funnel?.remaining)+' 只','当前筛选匹配 '+val(screen.total)+' 只 · 本页 '+arr(screen.rows).length+' 只',label(screen.lookupStatus)]:['封存扫描后可复查入选与落选原因。'],'screening');
  const positions=Array.isArray(defense?.rows)&&!defense.reason?defense.rows:null;
  const attention=positions?.filter(p=>p.status!=='observed-unverified'||p.concentrationWarning||arr(p.avoidedBoards).length||p.excludedByResearchPreference||arr(p.missing).length).length;
  overview('defense','持仓待复核',positions?attention+' 项待复核':'持仓资料不可用',positions?['全部可读原账户持仓 '+positions.length+' 项；跨账户同股分别计数',positions.length?'含报价、原入选依据、条件失效及集中度等待核项':'当前未读到持仓项，不代表真实券商账户为空']:[defense?.reason||'没有可核对的持仓视图。'],'defense');
  const diagnostic=arr(view.diagnostics).at(-1),stage=diagnostic?arr(diagnostic.stages).at(-1):arr(r?.diagnostics).at(-1),unresolved=Array.isArray(view.preferences?.value?.unresolved)?view.preferences.value.unresolved.length:null;
  overview('diagnostics','分析任务状态',diagnostic?label(diagnostic.status):stage?label(stage.status):'尚未记录',[
   diagnostic?'最近任务 '+val(diagnostic.symbol||r?.symbol)+' · '+clock(diagnostic.asOf):stage?'所选版本保存的阶段记录':'尚无任务状态，不能据此判断分析成功。',
   ...(stage?[val(stage.stage)+(stage.durationMs!==undefined?' · '+val(stage.durationMs)+' 毫秒':'')]:[]),
   '未完成事项 '+val(unresolved)+' 项'],'diagnostics');summary.hidden=false;
 }
 function clear(message='输入或权限已变化，请重新读取',privacy=false,preserveSelection=false){
  if(privacy||!preserveSelection){selectedRunId=null;$('workspaceCompareRun').value='';}
  generation++;request?.abort();request=null;view=null;host.replaceChildren();clearSummary();status.textContent=message;
  modelPrediction=null;$('workspaceForecastFile').value='';$('workspaceForecastFreeze').disabled=true;$('workspaceForecastInput').disabled=true;$('workspaceForecastStatus').textContent='所选预测已清除；读取研究版本后可继续';
  nativeEvidence=null;$('workspaceNativeFile').value='';$('workspaceNativeStatus').textContent='缺少的原生结果保留未知。';
  if(privacy){nativeEvidence=null;$('workspaceNativeFile').value='';$('workspaceNativeStatus').textContent='缺少的原生结果保留未知。';for(const id of ['workspaceObjective','workspaceAvoid','workspaceExcluded','workspaceUnresolved','workspacePresetName'])$(id).value='';
   $('workspaceHorizon').value='5';$('workspaceMaxWeight').value='30';
   for(const id of ['workspacePreferenceVersion','workspacePreset','workspacePresetVersion','workspaceScreenRun','workspaceCompareRun'])$(id).replaceChildren();undo=null;$('workspaceUndoPreset').disabled=true;}
  syncControls();
 }
 const historical=()=>$('workspaceAsOf').value!=='';
 function allowWrite(){if(historical()){status.textContent='历史回放只读；清空历史时点后可保存';return false;}return true;}
 async function call(body,extra={}){
  if(!body&&extra.export!=='1'&&Object.hasOwn(extra,'runId'))selectedRunId=extra.runId||null;
  request?.abort();const controller=new AbortController();request=controller;
  const id=++generation,token=$('token')?.value.trim()||'';
  const query=new URLSearchParams(),symbol=$('workspaceSymbol').value.trim();
  if(symbol)query.set('symbol',symbol);query.set('offset',String(offset));query.set('limit','20');query.set('status',$('workspaceFilterStatus').value);
  query.set('minScore',$('workspaceMinScore').value||'0');
  if($('workspaceScreenRun').value)query.set('screenId',$('workspaceScreenRun').value);
  if($('workspaceCompareRun').value)query.set('compareId',$('workspaceCompareRun').value);
  if(selectedRunId)query.set('runId',selectedRunId);
  if($('workspaceAsOf').value){const local=$('workspaceAsOf').value;query.set('asOf',String(Date.parse(local+(local.length===16?':00':'')+'+08:00')));}
  for(const [k,v]of Object.entries(extra))query.set(k,String(v));
  const timer=setTimeout(()=>controller.abort(),60000);
  if(extra.export!=='1'){clearSummary();if(!body){view=null;host.replaceChildren();}}syncControls();
  let permissionDenied=false;status.textContent=body?'正在保存或比较已有研究…':'正在读取已封存研究…';
  try{
   const response=await root.fetch('/api/research/workspace'+(body?'':'?'+query),{method:body?'POST':'GET',cache:'no-store',signal:controller.signal,
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   permissionDenied=response.status===401||response.status===403;
   const result=await response.json();permissionDenied=permissionDenied||result?.locked===true||result?.needPassword===true;
   if(id!==generation||token!==($('token')?.value.trim()||'')||doc.hidden)return null;
   if(permissionDenied||!response.ok||!result.ok)throw Error(result.error||'研究记录不可用');
   if(body){status.textContent=result.reused?'原请求已完成，复用封存结果':'操作已完成';return result;}
   if(extra.export==='1'){status.textContent='本次证据已准备导出';return result.result;}
   view=result.result;selectedRunId=view.selectedRun?.id||null;render();settings();status.textContent='已读取 '+clock(view.asOf)+' 的封存记录；未重新采集行情';return view;
  }catch(e){if(id===generation&&token===($('token')?.value.trim()||'')&&!doc.hidden){if(permissionDenied)clear('未完成：读取权限已失效，私有研究与偏好已清空，请重新认证',true);else{view=null;host.replaceChildren();clearSummary();status.textContent=e.name==='AbortError'?'读取已停止；可重新读取原档案':'未完成：'+e.message;}}return null;}
  finally{clearTimeout(timer);if(id===generation){request=null;syncControls();}}
 }
 function pagination(total){const n=node('div',undefined,host);n.className='linked-actions';line(n,'记录',Math.min(offset+1,total)+'—'+Math.min(offset+20,total)+' / '+total);
  const prev=button(n,'上一页',()=>{offset=Math.max(0,offset-20);call();});prev.disabled=offset===0;
  const next=button(n,'下一页',()=>{offset+=20;call();});next.disabled=offset+20>=total;
 }
 function render(){
  host.replaceChildren();renderSummary();for(const b of $('workspaceTabs').children)b.setAttribute('aria-selected',String(b.dataset.tab===tab));if(!view)return;
  const r=view.selectedRun;
  if(tab==='evidence'){
   const list=card('研究版本');for(const run of arr(view.runs.rows)){const row=node('div',undefined,list);row.className='workspace-row';
    const choice=button(row,run.symbol+' · '+run.tradeDate+' · '+clock(run.recordedAt)+' · '+run.id.slice(0,10),()=>call(null,{runId:run.id}));choice.dataset.workspaceRun=run.id;choice.setAttribute('aria-pressed',String(run.id===selectedRunId));}
   if(!view.runs.total)line(list,'记录','尚未封存；先采集股票或比较已存股票');else pagination(view.runs.total);
   if(r){const c=card(r.name+' '+r.symbol+' · 结论与证据');line(c,'数据截止日',r.tradeDate);line(c,'来源',r.provider);line(c,'封存时间',clock(r.recordedAt));
    const evidence=new Map(arr(r.evidence).map(e=>[e.id,e]));
    for(const condition of arr(r.conditions)){const d=detail(c,condition.name+' · '+label(condition.status));
     line(d,'条件',val(condition.field)+' '+val(condition.op)+' '+val(condition.threshold));line(d,'观察值',condition.value);line(d,condition.status==='pass'?'支持理由':condition.status==='fail'?'反对理由':'缺失信息',condition.reason||'见实际值、原始门槛与下方字段来源');line(d,'失效条件',condition.invalidation);
     for(const id of arr(condition.evidenceIds)){const e=evidence.get(id);if(!e)continue;line(d,'来源',e.source);line(d,'来源原始时间',clock(e.sourceTimestamp));line(d,'数据覆盖期终点',clock(e.periodEnd));line(d,'首次可用 / 接收',clock(e.availableAt)+' / '+clock(e.receivedAt));line(d,'缺失信息',e.missingReason);line(d,'封存引用',e.evidenceRef);}
    }
    const refs=detail(c,'原始来源与版本');for(const e of arr(r.sourceRefs)){line(refs,'来源 / 内容指纹',val(e.source)+' / '+val(e.hash));if(e.url&&/^https:\/\//.test(e.url)){const a=node('a','查看来源',refs);a.href=e.url;a.target='_blank';a.rel='noopener noreferrer';}}
    if(view.pairedComparison?.status!=='not-selected')line(c,'固定输入版本对照',view.pairedComparison?.status==='matched-frozen-input'?JSON.stringify(view.pairedComparison.systems):view.pairedComparison?.reason);
   }
  }else if(tab==='timeline'){
   const c=card('判断变化');for(const row of arr(view.timeline)){const d=detail(c,row.tradeDate+' · '+clock(row.asOf));
    line(d,'来源 / 目标日',row.provider+' / '+val(row.targetDate));line(d,'比较状态',label(row.changes?.status));
    for(const change of arr(row.changes?.systemChanges))line(d,label(change.system),label(change.before)+' → '+label(change.after));
    for(const change of arr(row.changes?.changes)){line(d,change.name||change.condition,label(change.kind)+'：'+val(change.before)+' → '+val(change.after));}
    if(!arr(row.changes?.changes).length)line(d,'条件变化','首次观察或原条件未变');
   }pagination(view.timelineTotal||view.timeline?.length||0);
  }else if(tab==='systems'){
   const c=card('同一股票快照 · 四体系独立判断');if(!r){line(c,'状态','先选择一条股票研究记录');return;}
   for(const s of arr(r.systems)){const d=detail(c,s.label+' · '+label(s.verdict));line(d,'已知 / 全部条件',s.known+' / '+s.total);
    if(s.coverageOnly)line(d,'语义','维度pass仅表示有评分证据；体系结论取原生评估器，不合并买卖票数');
    for(const [k,name]of [['support','支持条件'],['opposition','反对条件'],['missing','缺失条件']])for(const x of arr(s[k]))line(d,name,x.name+' · '+val(x.value)+' · '+val(x.reason));
   }
  }else if(tab==='screening'){
   const c=card('本轮筛选与逐股落选');line(c,'查询结果',label(view.screening.lookupStatus));line(c,'原输入范围',view.screening.inputTotal);line(c,'资料性质',label(view.screening.provenance));
   for(const step of arr(view.screening.funnel?.steps))line(c,step.label,step.before+' → '+step.after+'；移出 '+step.removed+'；未知 '+step.unknown);
   for(const row of arr(view.screening.rows)){const d=detail(c,row.symbol+' '+row.name+' · '+label(row.status));stockAction(d,row.symbol);line(d,'首次淘汰',label(row.firstReason));
    for(const x of arr(row.reasons))line(d,label(x.stage),label(x.status)+' · '+x.reason);}
   pagination(view.screening.total);
  }else if(tab==='market'){
   const c=card('市场—题材—个股位置');line(c,'市场分组',label(r?.regime));line(c,'说明',r?.regimeMeaning);
   for(const b of arr(view.marketPosition?.boards)){const d=detail(c,b.name+' · '+label(b.phase)+' · '+label(b.role));line(d,'数据日 / 成员覆盖',b.tradeDate+' / '+b.observedMembers+' / '+b.memberCount);line(d,'同日相对位置',b.rank);line(d,'阶段依据',b.phaseBasis);line(d,'角色依据',b.roleBasis);for(const h of arr(b.history))line(d,h.date,h.changePct+'%');}
   line(c,'范围与缺口',view.marketPosition?.reason);
  }else if(tab==='scorecard'){
   const c=card('策略 × 行情环境 × 观察周期');for(const g of arr(view.scorecard?.groups)){const d=detail(c,label(g.system)+' · '+label(g.regime)+' · '+g.horizon+'日 · '+label(g.status));
    line(d,'来源 / 策略版本',g.provider+' / '+g.version);
    line(d,'全部 / 满足 / 未满足 / 未知',[g.total,g.passed,g.rejected,g.unknown].join(' / '));line(d,'待到期 / 缺后续证据 / 成交证据不足',[g.pending,g.missing,g.blocked].join(' / '));
    line(d,'可观察价格样本 / 成本化样本',g.observedPriceCount+' / '+g.modeledCount);line(d,'独立股票 / 信号日',g.distinctSymbols+' / '+g.independentSignalDays);
    line(d,'非重叠持有窗口',g.nonOverlappingWindows);
    line(d,'平均价格变化 / 成本后估计',val(g.averagePriceReturnPct)+'% / '+val(g.averageNetReturnPct)+'%');line(d,'同口径基准超额',g.excessReturnPct===null?'缺少匹配基准':g.excessReturnPct+'%');}
   if(!view.scorecard?.groups?.length)line(c,'样本','尚未积累冻结判断和后续结果，不生成示例成绩');
   for(const text of arr(view.scorecard?.limitations))node('p',text,c);
   for(const scenario of arr(view.scorecard?.stress)){const d=detail(c,'费用压力：佣金 '+scenario.assumptions.feeBps+'bp / 滑点 '+scenario.assumptions.slippageBps+'bp');for(const g of scenario.groups)line(d,label(g.system)+' / '+g.horizon+'日',g.averageNetReturnPct===null?'缺少可成交样本':g.averageNetReturnPct+'%（纸面估计）');}
   renderForecasts(view.forecastEvaluation);
  }else if(tab==='defense'){
   const c=card('持仓防守 · 原账户只读');for(const p of arr(view.defense?.rows)){const d=detail(c,p.name+' '+p.symbol+' · '+label(p.status));stockAction(d,p.symbol);line(d,'账户',p.accountId);line(d,'原始报价年龄',p.quoteAgeMs===null?'未知':p.quoteAgeMs+'毫秒');line(d,'判断数据日 / 封存时间',val(p.currentTradeDate)+' / '+clock(p.currentEvidenceAt));line(d,'成本变化 / 估值集中度',val(p.costChangePct)+'% / '+val(p.weightPct)+'%');line(d,'集中度关注',p.concentrationWarning?'已达到研究关注线':'未达到或证据不足');line(d,'锁仓 / 静默',val(p.locked)+' / '+val(p.muted));line(d,'原入选依据',p.entryRunId||'尚未封存，不能借用今天判断补写');for(const x of arr(p.invalidated))line(d,'原条件失效',x.name);line(d,'待补证据',arr(p.missing).join('；'));if(arr(p.avoidedBoards).length)line(d,'命中回避板块',p.avoidedBoards.join('；'));if(p.excludedByResearchPreference)line(d,'研究排除名单','已列入');}
   for(const e of arr(view.defense?.exposures))line(c,e.name+'共同暴露',e.symbols.join('、')+' · '+val(e.weightPct)+'%');
   line(c,'说明',view.defense?.reason||view.defense?.meaning||'当前没有可读取的持仓；不代表实际券商账户为空');
  }else if(tab==='diagnostics'){
   const c=card('数据缺口与一次分析状态');for(const s of arr(view.quality?.sources))line(c,s.source,'已知 '+s.known+' / '+s.total+'；缺失 '+s.missing);
   for(const g of arr(view.quality?.gaps))line(c,'待补 '+g.field,'影响 '+g.affectedStrategies+' 个体系；'+val(g.reason));
   for(const run of arr(view.diagnostics).slice().reverse()){const d=detail(c,clock(run.asOf)+' · '+label(run.status));for(const stage of arr(run.stages))line(d,stage.stage,label(stage.status)+(stage.durationMs!==undefined?' · '+stage.durationMs+'毫秒':''));line(d,'继续条件',run.retry);}
   for(const stage of arr(r?.diagnostics))line(c,stage.stage,label(stage.status));
   const audit=detail(c,'指标预热与历史可得性');for(const w of arr(view.inputAudit?.warmup))line(audit,w.length+'根K线',w.value||w.status);line(audit,'预热判断',view.inputAudit?.warmupStatus);line(audit,'历史可得性',view.inputAudit?.pointInTime?.meaning);
   for(const drift of arr(view.drift?.reports)){const d=detail(c,'输入变化 '+drift.before+' → '+drift.after);line(d,'同股 / 新增 / 移出',[drift.matched,drift.added,drift.removed].join(' / '));line(d,'未知条件比例',val(drift.beforeUnknownRate)+' → '+val(drift.afterUnknownRate));line(d,'解释',drift.attribution);}
   const models=detail(c,'公开模型对照与借鉴');const library=node('a','查看全部模型、界面与运行方式对照（当前公开资料）',models);library.href='/model-library.html';const uiLibrary=node('a','查看界面与模块联动对照',models);uiLibrary.href='/model-library.html?category=interface&ids=U03,U08,U09#compareHeading';for(const m of arr(view.publicModelComparison?.models)){const d=detail(models,m.name+' · '+m.kind);line(d,'可借鉴',m.borrow.join('；'));line(d,'本系统状态',m.status);line(d,'适用限制',m.limit);line(d,'许可',m.license);line(d,'本系统实测收益/速度','尚未执行模型，无法比较');const source=m.reads?.[0]?.url;if(source&&/^https:\/\/github\.com\//.test(source)){const a=node('a','查看固定版本来源',d);a.href=source;a.target='_blank';a.rel='noopener noreferrer';}}
  }
 }
 function modelConfiguration(parent,model){
  line(parent,'配置指纹',model.modelKey||'未知');
  line(parent,'随机种子 / 温度 / top-p / 采样数',['seed','temperature','topP','sampleCount'].map(k=>val(model[k])).join(' / '));
  line(parent,'权重 / tokenizer / 训练截止期',['weightsHash','tokenizerRevision','trainingCutoff'].map(k=>val(model[k])).join(' / '));
 }
 function renderForecasts(f){
  const c=card('模型预测前向评测');if(!f||f.status==='unavailable'){line(c,'状态',f?.reason||'暂无预测档案');return;}
  line(c,'范围',f.scope?.runId?'所选研究版本':f.scope?.symbol?'所选股票':'全部已保存预测');line(c,'比较口径','预测误差，不是可成交收益或上涨概率');
  line(c,'对照范围',f.inputComparison);
  line(c,'配置统计 / 预测记录',val(f.groupTotal)+' / '+val(f.total)+'；按页读取');
  if(!arr(f.groups).length)line(c,'记录','尚无封存预测；可展开“模型预测与前向评测”导入结果');
  for(const g of arr(f.groups)){const d=detail(c,g.model.id+' · '+g.model.revision+' · '+g.horizon+'日 · '+label(g.status));
   line(d,'来源 / 点值类型',g.provider+' / '+label(g.pointKind));line(d,'全部 / 已到期有价 / 待到期 / 缺价 / 不可用 / 重复',[g.total,g.matured,g.pending,g.missing,g.invalid,g.repeated].join(' / '));
   line(d,'平均绝对误差 / 前值基线 / 趋势基线',[g.mae,g.naiveMae,g.driftMae].map(val).join(' / ')+' 元');line(d,'相对前值基线',g.relativeMae===null?'无可计算比值（基线误差为零或无样本）':g.relativeMae+' 倍');
   line(d,'分位数平均损失',g.pinballLoss);line(d,'区间覆盖 / 区间目标覆盖',val(g.intervalCoveragePct)+'% / '+val(g.nominalCoveragePct)+'%（'+g.intervalSamples+'样本）');
   line(d,'平均区间宽度',val(g.meanIntervalWidth)+' 元；更宽的区间不能只凭覆盖率认定更好');
   line(d,'不同股票 / 信号日 / 非重叠窗口',[g.symbols,g.signalDays,g.nonOverlappingWindows].join(' / '));line(d,'后续行情修订',g.revisedOutcomes);line(d,'训练截止期',g.model.trainingCutoff||'未知');line(d,'模型执行与耗时','来自明确导入，尚未由本系统核验');
  }
  for(const pair of arr(f.pairs?.rows)){const d=detail(c,'同输入配对 '+pair.modelA.id+' / '+pair.modelB.id+' · '+pair.horizon+'日');
   for(const [side,m]of [['A',pair.modelA],['B',pair.modelB]]){const config=detail(d,side+' · '+m.id+' / '+m.revision+' · '+label(m.pointKind)+' · '+(m.modelKey?.slice(0,12)||'未知配置'));modelConfiguration(config,m);}
   line(d,'完全匹配样本',pair.samples);line(d,'平均绝对误差 A / B',pair.maeA+' / '+pair.maeB+' 元');line(d,'误差差值 A−B',pair.deltaMaeAminusB+' 元；负值表示A误差较小');line(d,'统计范围','仅描述配对交集；独立性和获利均未认证');}
  for(const r of arr(f.rows)){const d=detail(c,r.symbol+' · '+r.modelId+' · '+r.targetDate+' · '+label(r.status));line(d,'原观察日 / 周期',r.originDate+' / '+r.horizon+'日');line(d,'预测 / 首次收到的收盘价',val(r.point)+' / '+val(r.actual));line(d,'绝对误差 / 前值误差',val(r.absoluteError)+' / '+val(r.naiveError));line(d,'输入指纹',r.inputFingerprint);if(r.revisedOutcome)line(d,'后续版本收盘价',r.latestObservedClose+'；首次评价不被改写');}
  if(f.total)pagination(f.total);for(const text of arr(f.limitations))node('p',text,c);if(f.pairs?.limitedGroups)line(c,'配对上限','部分组合超过16个配置或256组，已保留原记录');
 }
 function settings(){
  const p=view.preferences;$('workspaceObjective').value=p.value.objective;$('workspaceHorizon').value=String(p.value.horizonDays);$('workspaceMaxWeight').value=p.value.maxPositionPct??30;
  const forecast=view.forecastEvaluation;if(modelPrediction&&modelPrediction.inputFingerprint!==forecast?.input?.inputFingerprint){modelPrediction=null;$('workspaceForecastFile').value='';$('workspaceForecastStatus').textContent='研究输入已变化，请为当前版本重新选择预测结果';}
  $('workspaceForecastInput').disabled=!forecast?.input;$('workspaceForecastFreeze').disabled=historical()||!forecast?.freezeAllowed||!modelPrediction;
  $('workspaceAvoid').value=p.value.avoidSectors.join('，');$('workspaceExcluded').value=p.value.excludedSymbols.join('，');$('workspaceUnresolved').value=p.value.unresolved.join('\n');
  $('workspacePreferenceVersion').replaceChildren();for(const h of p.history){const o=node('option','版本 '+h.revision+' · '+clock(h.recordedAt),$('workspacePreferenceVersion'));o.value=String(h.revision);}
  const preset=$('workspacePreset').value;$('workspacePreset').replaceChildren();for(const p of view.presets){const o=node('option',p.name,$('workspacePreset'));o.value=p.name;}if(view.presets.some(x=>x.name===preset))$('workspacePreset').value=preset;presetVersions();
  for(const [id,items,empty,text]of [['workspaceScreenRun',view.screenRuns,'最新批次',x=>clock(x.asOf)+' · '+x.total+'只'],['workspaceCompareRun',view.runs.rows,'不对照',x=>x.symbol+' · '+clock(x.recordedAt)+' · '+x.id.slice(0,10)]]){
   const chosen=$(id).value,previous=[...$(id).options].find(o=>o.value===chosen)?.textContent;$(id).replaceChildren();const first=node('option',empty,$(id));first.value='';for(const x of arr(items)){const o=node('option',text(x),$(id));o.value=x.id;}
   if(chosen&&!arr(items).some(x=>x.id===chosen)&&previous){const o=node('option',previous.endsWith('（保留所选记录）')?previous:previous+'（保留所选记录）',$(id));o.value=chosen;}
   $(id).value=chosen;
  }
  for(const id of ['workspaceReview','workspaceSavePreferences','workspaceRestorePreferences','workspaceSavePreset','workspaceRestorePreset'])$(id).disabled=historical();
 }
 function presetVersions(){const p=view?.presets.find(x=>x.name===$('workspacePreset').value);$('workspacePresetVersion').replaceChildren();for(const h of arr(p?.history)){const o=node('option','版本 '+h.revision+' · '+clock(h.recordedAt),$('workspacePresetVersion'));o.value=String(h.revision);}}
 for(const [id,title]of Object.entries(tabs)){const b=button($('workspaceTabs'),title,()=>{tab=id;const paged=offset!==0;offset=0;if(view&&paged)call();else render();});b.dataset.tab=id;b.setAttribute('role','tab');}
 $('workspaceRead').addEventListener('click',()=>{offset=0;call();});
 $('workspaceLatest').addEventListener('click',()=>{if(request)return;selectedRunId=null;offset=0;call();});
 $('workspaceReview').addEventListener('click',async()=>{if(!allowWrite())return;const symbol=$('workspaceSymbol').value.trim();if(!/^\d{6}$/.test(symbol)){status.textContent='比较已存股票需要六位代码';return;}const r=await call({action:'review',symbol,provider:$('workspaceProvider').value,requestId:key(),...(nativeEvidence?{nativeEvidence}:{})});if(r)call(null,{runId:r.runId});});
 $('workspaceNativeFile').addEventListener('change',async()=>{const file=$('workspaceNativeFile').files?.[0],id=generation;nativeEvidence=null;if(!file)return;if(file.size>60000){$('workspaceNativeStatus').textContent='文件超过60KB，未读取';return;}try{const value=JSON.parse(await file.text());if(id!==generation||doc.hidden)return;if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['pythonEvidence','gptEvidence','fourteenEvidence','benchmarkEvidence'].includes(k)))throw Error();nativeEvidence=value;$('workspaceNativeStatus').textContent=Object.entries(value).map(([k,v])=>(names[k.replace('Evidence','')]||k)+' '+val(v.symbol)+' / '+val(v.date||'日价序列')).join('；')+'；比较时仍需校验身份与时间';}catch{$('workspaceNativeStatus').textContent='评估文件格式无效；缺失保持未知';}});
 $('workspaceNativeClear').addEventListener('click',()=>{nativeEvidence=null;$('workspaceNativeFile').value='';$('workspaceNativeStatus').textContent='补充证据已清除';});
 function downloadJson(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
 $('workspaceForecastInput').addEventListener('click',()=>{const input=view?.forecastEvaluation?.input;if(!input)return;downloadJson('tian-shu-forecast-input.json',{input,outputTemplate:view.forecastEvaluation.outputTemplate});$('workspaceForecastStatus').textContent='输入与空模板已导出；预测值、版本与生成时点需由实际运行填写';});
 $('workspaceForecastFile').addEventListener('change',async()=>{modelPrediction=null;$('workspaceForecastFreeze').disabled=true;const file=$('workspaceForecastFile').files?.[0],input=view?.forecastEvaluation?.input,id=generation;if(!file)return;if(!input){$('workspaceForecastStatus').textContent='请先读取研究版本';return;}if(file.size>60000){$('workspaceForecastStatus').textContent='文件超过60KB，未读取';return;}
  try{const p=JSON.parse(await file.text());if(id!==generation||doc.hidden)return;if(!p||p.inputFingerprint!==input.inputFingerprint||!Array.isArray(p.forecasts))throw Error();modelPrediction=p;$('workspaceForecastStatus').textContent='已选择 '+val(p.model?.id)+' / '+val(p.model?.revision)+' · '+p.forecasts.length+'个周期；封存时校验日期、版本和分位数';$('workspaceForecastFreeze').disabled=historical()||!view?.forecastEvaluation?.freezeAllowed;}catch{$('workspaceForecastStatus').textContent='结果格式或输入指纹不匹配；请使用当前版本导出的输入';}
 });
 $('workspaceForecastClear').addEventListener('click',()=>{modelPrediction=null;$('workspaceForecastFile').value='';$('workspaceForecastFreeze').disabled=true;$('workspaceForecastStatus').textContent='所选预测已清除，已封存档案保留';});
 $('workspaceForecastFreeze').addEventListener('click',async()=>{if(!allowWrite()||!view?.forecastEvaluation?.freezeAllowed||!modelPrediction)return;const runId=view.selectedRun.id;const saved=await call({action:'freeze-forecast',runId,requestId:key(),prediction:modelPrediction});if(saved){modelPrediction=null;$('workspaceForecastFile').value='';$('workspaceForecastStatus').textContent='预测已封存；等待后续真实行情评价';tab='scorecard';offset=0;call(null,{runId});}});
 $('workspaceSavePreferences').addEventListener('click',async()=>{if(!view){status.textContent='请先读取研究记录';return;}
  if(!allowWrite())return;const result=await call({action:'preferences',requestId:key(),expectedRevision:view.preferences.revision,value:{objective:$('workspaceObjective').value,horizonDays:Number($('workspaceHorizon').value),maxPositionPct:Number($('workspaceMaxWeight').value),avoidSectors:$('workspaceAvoid').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),excludedSymbols:$('workspaceExcluded').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),unresolved:$('workspaceUnresolved').value.split('\n').map(x=>x.trim()).filter(Boolean)}});if(result)call();});
 $('workspaceRestorePreferences').addEventListener('click',async()=>{if(!view||!allowWrite())return;const r=await call({action:'restore-preferences',requestId:key(),expectedRevision:view.preferences.revision,revision:Number($('workspacePreferenceVersion').value)});if(r)call();});
 $('workspaceSavePreset').addEventListener('click',async()=>{if(!view||!allowWrite())return;const name=$('workspacePresetName').value,prior=view.presets.find(p=>p.name===name),symbol=$('workspaceSymbol').value.trim();const r=await call({action:'preset',requestId:key(),expectedRevision:prior?.revision||0,value:{name,...(symbol?{symbol}:{}),status:$('workspaceFilterStatus').value,minScore:Number($('workspaceMinScore').value),horizon:Number($('workspaceHorizon').value)}});if(r)call();});
 $('workspacePreset').addEventListener('change',presetVersions);
 $('workspaceRestorePreset').addEventListener('click',async()=>{if(!view||!allowWrite())return;const p=view.presets.find(x=>x.name===$('workspacePreset').value);if(!p)return;const r=await call({action:'restore-preset',name:p.name,revision:Number($('workspacePresetVersion').value),expectedRevision:p.revision,requestId:key()});if(r)call();});
 const filterIds=['workspaceSymbol','workspaceFilterStatus','workspaceHorizon','workspaceMinScore'];
 $('workspaceApplyPreset').addEventListener('click',()=>{const p=view?.presets.find(x=>x.name===$('workspacePreset').value);if(!p)return;undo=filterIds.map(id=>$(id).value);[p.symbol||'',p.status,String(p.horizon),String(p.minScore)].forEach((v,i)=>$(filterIds[i]).value=v);$('workspaceUndoPreset').disabled=false;clear('模板已应用；点击读取查看，不会改变正式策略');});
 $('workspaceUndoPreset').addEventListener('click',()=>{if(!undo)return;undo.forEach((v,i)=>$(filterIds[i]).value=v);undo=null;$('workspaceUndoPreset').disabled=true;clear('已撤销模板应用；点击读取查看');});
 $('workspaceExport').addEventListener('click',async()=>{if(!view||request)return;const snapshot=view,extra={export:'1',asOf:String(snapshot.asOf)};
  if(snapshot.selectedRun?.id)extra.runId=snapshot.selectedRun.id;if(snapshot.screening?.runId)extra.screenId=snapshot.screening.runId;
  const r=await call(null,extra);if(!r)return;const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='tian-shu-research.json';a.click();URL.revokeObjectURL(url);
 });
 for(const id of ['workspaceSymbol','workspaceProvider','workspaceAsOf','workspaceFilterStatus','workspaceMinScore','token'])for(const event of ['input','change'])$(id)?.addEventListener(event,()=>{offset=0;const keep=id==='workspaceFilterStatus'||id==='workspaceMinScore';clear(undefined,id==='token',keep);if(id==='workspaceAsOf')$('workspaceScreenRun').value='';for(const key of ['workspaceReview','workspaceSavePreferences','workspaceRestorePreferences','workspaceSavePreset','workspaceRestorePreset'])$(key).disabled=historical();});
 for(const id of ['workspaceScreenRun','workspaceCompareRun'])$(id).addEventListener('change',()=>{offset=0;clear(undefined,false,true);call();});
 root.addEventListener?.('offline',()=>clear('网络离线，私有研究视图已清空',true));root.addEventListener?.('pagehide',()=>clear('页面已离开，私有研究视图已清空',true));
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear('页面隐藏，私有研究视图已清空',true);});
 root.addEventListener?.('v6:stock-research',event=>{const d=event.detail||{};if(!/^\d{6}$/.test(d.symbol||''))return;$('workspaceSymbol').value=d.symbol;if(['eastmoney','tencent'].includes(d.provider))$('workspaceProvider').value=d.provider;offset=0;clear(d.workspace?.status==='failed'?'本次工作区封存未完成；原始研究仍保留':'股票观察已完成，可读取同一份封存研究');});
 root.V6ResearchWorkspace={render:result=>{view=result;selectedRunId=view?.selectedRun?.id||null;render();syncControls();},clear};
 syncControls();
})(typeof window==='object'?window:globalThis);
