(function(root){
 'use strict';
 const doc=root.document;if(!doc?.getElementById('researchWorkspace'))return;
 const $=id=>doc.getElementById(id),host=$('workspaceContent'),status=$('workspaceStatus');
 let view=null,tab='evidence',offset=0,generation=0,request=null,undo=null,nativeEvidence=null;
 const tabs={evidence:'结论与证据',timeline:'判断变化',systems:'四体系分歧',screening:'筛选与落选',market:'市场与题材',scorecard:'策略成绩',defense:'持仓防守',diagnostics:'分析诊断'};
 const names={pass:'满足',fail:'未满足',unknown:'未知',selected:'已入选',rejected:'未入选','coverage-only':'证据覆盖',
  'first-observation':'首次观察',added:'新增条件',removed:'不再提供','observed-change':'观察变化','data-revision':'同日数据修订','rule-version-changed':'规则改版',
  warming:'升温观察',cooling:'降温观察',mixed:'分化', 'relative-front':'板块相对前排','relative-middle':'板块相对中段','relative-back':'板块相对后排',
  'not-evaluated-in-this-run':'本轮未评估这只股票','no-screen-run':'尚无筛选档案','insufficient-independent-samples':'独立样本不足',
  'index-up':'上证上涨日','index-down':'上证下跌日','index-flat':'上证平盘日',fourteen:'十四条',bazi:'八字口诀',gpt:'GPT五策略',python:'Python三轮',
  completed:'已完成',failed:'未完成',saved:'已封存',watch:'观望','filtered-out':'已评估，当前过滤条件隐藏了结果','entry-evidence-missing':'原入选依据未封存','quote-unusable':'报价不可用','review-invalidation':'原条件失效待复查',
  'observed-unverified':'已有观察，未认证',quality:'来源与质量',risk:'风险过滤',strategy:'策略条件',eligibility:'候选资格','paper-estimate':'含成本纸面估计'};
 const val=x=>x===null||x===undefined?'未知':typeof x==='object'?JSON.stringify(x):String(x),label=x=>names[x]||val(x);
 const arr=x=>Array.isArray(x)?x:[];
 const clock=x=>Number.isSafeInteger(x)&&x>0?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
 function node(tag,text,parent){const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.append(n);return n;}
 function line(p,k,v){node('p',k+'：'+val(v),p);}
 function detail(p,title){const n=node('details',undefined,p);node('summary',title,n);return n;}
 function card(title){const n=node('article',undefined,host);n.className='card';node('h3',title,n);return n;}
 function button(p,text,fn){const b=node('button',text,p);b.type='button';b.addEventListener('click',fn);return b;}
 function key(){return 'web_'+(root.crypto?.randomUUID?.().replace(/-/g,'')||Date.now().toString(36)+Math.random().toString(36).slice(2));}
 function clear(message='输入或权限已变化，请重新读取',privacy=false){
  generation++;request?.abort();request=null;view=null;host.replaceChildren();status.textContent=message;
  nativeEvidence=null;$('workspaceNativeFile').value='';$('workspaceNativeStatus').textContent='缺少的原生结果保留未知。';
  if(privacy){nativeEvidence=null;$('workspaceNativeFile').value='';$('workspaceNativeStatus').textContent='缺少的原生结果保留未知。';for(const id of ['workspaceObjective','workspaceAvoid','workspaceExcluded','workspaceUnresolved','workspacePresetName'])$(id).value='';
   for(const id of ['workspacePreferenceVersion','workspacePreset','workspacePresetVersion','workspaceScreenRun','workspaceCompareRun'])$(id).replaceChildren();undo=null;$('workspaceUndoPreset').disabled=true;}
 }
 const historical=()=>$('workspaceAsOf').value!=='';
 function allowWrite(){if(historical()){status.textContent='历史回放只读；清空历史时点后可保存';return false;}return true;}
 async function call(body,extra={}){
  request?.abort();const controller=new AbortController();request=controller;
  const id=++generation,token=$('token')?.value.trim()||'';
  const query=new URLSearchParams(),symbol=$('workspaceSymbol').value.trim();
  if(symbol)query.set('symbol',symbol);query.set('offset',String(offset));query.set('limit','20');query.set('status',$('workspaceFilterStatus').value);
  query.set('minScore',$('workspaceMinScore').value||'0');
  if($('workspaceScreenRun').value)query.set('screenId',$('workspaceScreenRun').value);
  if($('workspaceCompareRun').value)query.set('compareId',$('workspaceCompareRun').value);
  if($('workspaceAsOf').value){const local=$('workspaceAsOf').value;query.set('asOf',String(Date.parse(local+(local.length===16?':00':'')+'+08:00')));}
  for(const [k,v]of Object.entries(extra))query.set(k,String(v));
  const timer=setTimeout(()=>controller.abort(),60000);
  status.textContent=body?'正在保存或比较已有研究…':'正在读取已封存研究…';
  try{
   const response=await root.fetch('/api/research/workspace'+(body?'':'?'+query),{method:body?'POST':'GET',cache:'no-store',signal:controller.signal,
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const result=await response.json();
   if(id!==generation||token!==($('token')?.value.trim()||'')||doc.hidden)return null;
   if(!response.ok||!result.ok)throw Error(result.error||'研究记录不可用');
   if(body){status.textContent=result.reused?'原请求已完成，复用封存结果':'操作已完成';return result;}
   if(extra.export==='1')return result.result;
   view=result.result;render();settings();status.textContent='已读取 '+clock(view.asOf)+' 的封存记录；未重新采集行情';return view;
  }catch(e){if(id===generation){view=null;host.replaceChildren();status.textContent=e.name==='AbortError'?'读取已停止；可重新读取原档案':'未完成：'+e.message;}return null;}
  finally{clearTimeout(timer);if(id===generation)request=null;}
 }
 function pagination(total){const n=node('div',undefined,host);n.className='linked-actions';line(n,'记录',Math.min(offset+1,total)+'—'+Math.min(offset+20,total)+' / '+total);
  const prev=button(n,'上一页',()=>{offset=Math.max(0,offset-20);call();});prev.disabled=offset===0;
  const next=button(n,'下一页',()=>{offset+=20;call();});next.disabled=offset+20>=total;
 }
 function render(){
  host.replaceChildren();for(const b of $('workspaceTabs').children)b.setAttribute('aria-selected',String(b.dataset.tab===tab));if(!view)return;
  const r=view.selectedRun;
  if(tab==='evidence'){
   const list=card('研究版本');for(const run of arr(view.runs.rows)){const row=node('div',undefined,list);row.className='workspace-row';
    button(row,run.symbol+' · '+run.tradeDate+' · '+clock(run.recordedAt),()=>call(null,{runId:run.id}));}
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
   const c=card('本轮筛选与逐股落选');line(c,'查询结果',label(view.screening.lookupStatus));line(c,'原输入范围',view.screening.inputTotal);line(c,'资料性质',view.screening.provenance);
   for(const step of arr(view.screening.funnel?.steps))line(c,step.label,step.before+' → '+step.after+'；移出 '+step.removed+'；未知 '+step.unknown);
   for(const row of arr(view.screening.rows)){const d=detail(c,row.symbol+' '+row.name+' · '+label(row.status));line(d,'首次淘汰',label(row.firstReason));
    for(const x of arr(row.reasons))line(d,label(x.stage),label(x.status)+' · '+x.reason);}
   pagination(view.screening.total);
  }else if(tab==='market'){
   const c=card('市场—题材—个股位置');line(c,'市场分组',label(r?.regime));line(c,'说明',r?.regimeMeaning);
   for(const b of arr(view.marketPosition?.boards)){const d=detail(c,b.name+' · '+label(b.phase)+' · '+label(b.role));line(d,'数据日 / 成员覆盖',b.tradeDate+' / '+b.observedMembers+' / '+b.memberCount);line(d,'同日相对位置',b.rank);line(d,'阶段依据',b.phaseBasis);line(d,'角色依据',b.roleBasis);for(const h of arr(b.history))line(d,h.date,h.changePct+'%');}
   line(c,'范围与缺口',view.marketPosition?.reason);
  }else if(tab==='scorecard'){
   const c=card('策略 × 行情环境 × 观察周期');for(const g of arr(view.scorecard?.groups)){const d=detail(c,label(g.system)+' · '+label(g.regime)+' · '+g.horizon+'日 · '+label(g.status));
    line(d,'全部 / 满足 / 未满足 / 未知',[g.total,g.passed,g.rejected,g.unknown].join(' / '));line(d,'待到期 / 缺价 / 成交证据不足',[g.pending,g.missing,g.blocked].join(' / '));
    line(d,'可观察价格样本 / 成本化样本',g.observedPriceCount+' / '+g.modeledCount);line(d,'独立股票 / 信号日',g.distinctSymbols+' / '+g.independentSignalDays);
    line(d,'平均价格变化 / 成本后估计',val(g.averagePriceReturnPct)+'% / '+val(g.averageNetReturnPct)+'%');line(d,'同口径基准超额',g.excessReturnPct===null?'缺少匹配基准':g.excessReturnPct+'%');}
   if(!view.scorecard?.groups?.length)line(c,'样本','尚未积累冻结判断和后续结果，不生成示例成绩');
   for(const text of arr(view.scorecard?.limitations))node('p',text,c);
   for(const scenario of arr(view.scorecard?.stress)){const d=detail(c,'费用压力：佣金 '+scenario.assumptions.feeBps+'bp / 滑点 '+scenario.assumptions.slippageBps+'bp');for(const g of scenario.groups)line(d,label(g.system)+' / '+g.horizon+'日',g.averageNetReturnPct===null?'缺少可成交样本':g.averageNetReturnPct+'%（纸面估计）');}
  }else if(tab==='defense'){
   const c=card('持仓防守 · 原账户只读');for(const p of arr(view.defense?.rows)){const d=detail(c,p.name+' '+p.symbol+' · '+label(p.status));line(d,'账户',p.accountId);line(d,'原始报价年龄',p.quoteAgeMs===null?'未知':p.quoteAgeMs+'毫秒');line(d,'成本变化 / 估值集中度',val(p.costChangePct)+'% / '+val(p.weightPct)+'%');line(d,'集中度关注',p.concentrationWarning?'已达到研究关注线':'未达到或证据不足');line(d,'锁仓 / 静默',val(p.locked)+' / '+val(p.muted));line(d,'原入选依据',p.entryRunId||'尚未封存，不能借用今天判断补写');for(const x of arr(p.invalidated))line(d,'原条件失效',x.name);line(d,'待补证据',arr(p.missing).join('；'));}
   for(const e of arr(view.defense?.exposures))line(c,e.name+'共同暴露',e.symbols.join('、')+' · '+val(e.weightPct)+'%');
   line(c,'说明',view.defense?.reason||view.defense?.meaning||'当前没有可读取的持仓；不代表实际券商账户为空');
  }else if(tab==='diagnostics'){
   const c=card('数据缺口与一次分析状态');for(const s of arr(view.quality?.sources))line(c,s.source,'已知 '+s.known+' / '+s.total+'；缺失 '+s.missing);
   for(const g of arr(view.quality?.gaps))line(c,'待补 '+g.field,'影响 '+g.affectedStrategies+' 个体系；'+val(g.reason));
   for(const run of arr(view.diagnostics).slice().reverse()){const d=detail(c,clock(run.asOf)+' · '+label(run.status));for(const stage of arr(run.stages))line(d,stage.stage,label(stage.status)+(stage.durationMs!==undefined?' · '+stage.durationMs+'毫秒':''));line(d,'继续条件',run.retry);}
   for(const stage of arr(r?.diagnostics))line(c,stage.stage,label(stage.status));
   const audit=detail(c,'指标预热与历史可得性');for(const w of arr(view.inputAudit?.warmup))line(audit,w.length+'根K线',w.value||w.status);line(audit,'预热判断',view.inputAudit?.warmupStatus);line(audit,'历史可得性',view.inputAudit?.pointInTime?.meaning);
   for(const drift of arr(view.drift?.reports)){const d=detail(c,'输入变化 '+drift.before+' → '+drift.after);line(d,'同股 / 新增 / 移出',[drift.matched,drift.added,drift.removed].join(' / '));line(d,'未知条件比例',val(drift.beforeUnknownRate)+' → '+val(drift.afterUnknownRate));line(d,'解释',drift.attribution);}
  }
 }
 function settings(){
  const p=view.preferences;$('workspaceObjective').value=p.value.objective;$('workspaceHorizon').value=String(p.value.horizonDays);$('workspaceMaxWeight').value=p.value.maxPositionPct??30;
  $('workspaceAvoid').value=p.value.avoidSectors.join('，');$('workspaceExcluded').value=p.value.excludedSymbols.join('，');$('workspaceUnresolved').value=p.value.unresolved.join('\n');
  $('workspacePreferenceVersion').replaceChildren();for(const h of p.history){const o=node('option','版本 '+h.revision+' · '+clock(h.recordedAt),$('workspacePreferenceVersion'));o.value=String(h.revision);}
  const preset=$('workspacePreset').value;$('workspacePreset').replaceChildren();for(const p of view.presets){const o=node('option',p.name,$('workspacePreset'));o.value=p.name;}if(view.presets.some(x=>x.name===preset))$('workspacePreset').value=preset;presetVersions();
  for(const [id,items,empty,text]of [['workspaceScreenRun',view.screenRuns,'最新批次',x=>clock(x.asOf)+' · '+x.total+'只'],['workspaceCompareRun',view.runs.rows,'不对照',x=>x.symbol+' · '+clock(x.recordedAt)]]){
   const chosen=$(id).value;$(id).replaceChildren();const first=node('option',empty,$(id));first.value='';for(const x of arr(items)){const o=node('option',text(x),$(id));o.value=x.id;}$(id).value=chosen;
  }
  for(const id of ['workspaceReview','workspaceSavePreferences','workspaceRestorePreferences','workspaceSavePreset','workspaceRestorePreset'])$(id).disabled=historical();
 }
 function presetVersions(){const p=view?.presets.find(x=>x.name===$('workspacePreset').value);$('workspacePresetVersion').replaceChildren();for(const h of arr(p?.history)){const o=node('option','版本 '+h.revision+' · '+clock(h.recordedAt),$('workspacePresetVersion'));o.value=String(h.revision);}}
 for(const [id,title]of Object.entries(tabs)){const b=button($('workspaceTabs'),title,()=>{tab=id;const paged=offset!==0;offset=0;if(view&&paged)call();else render();});b.dataset.tab=id;b.setAttribute('role','tab');}
 $('workspaceRead').addEventListener('click',()=>{offset=0;call();});
 $('workspaceReview').addEventListener('click',async()=>{if(!allowWrite())return;const symbol=$('workspaceSymbol').value.trim();if(!/^\d{6}$/.test(symbol)){status.textContent='比较已存股票需要六位代码';return;}const r=await call({action:'review',symbol,provider:$('workspaceProvider').value,requestId:key(),...(nativeEvidence?{nativeEvidence}:{})});if(r)call(null,{runId:r.runId});});
 $('workspaceNativeFile').addEventListener('change',async()=>{const file=$('workspaceNativeFile').files?.[0],id=generation;nativeEvidence=null;if(!file)return;if(file.size>60000){$('workspaceNativeStatus').textContent='文件超过64KB，未读取';return;}try{const value=JSON.parse(await file.text());if(id!==generation||doc.hidden)return;if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['pythonEvidence','gptEvidence','fourteenEvidence','benchmarkEvidence'].includes(k)))throw Error();nativeEvidence=value;$('workspaceNativeStatus').textContent=Object.entries(value).map(([k,v])=>(names[k.replace('Evidence','')]||k)+' '+val(v.symbol)+' / '+val(v.date||'日价序列')).join('；')+'；比较时仍需校验身份与时间';}catch{$('workspaceNativeStatus').textContent='评估文件格式无效；缺失保持未知';}});
 $('workspaceNativeClear').addEventListener('click',()=>{nativeEvidence=null;$('workspaceNativeFile').value='';$('workspaceNativeStatus').textContent='补充证据已清除';});
 $('workspaceSavePreferences').addEventListener('click',async()=>{if(!view){status.textContent='请先读取研究记录';return;}
  if(!allowWrite())return;const result=await call({action:'preferences',requestId:key(),expectedRevision:view.preferences.revision,value:{objective:$('workspaceObjective').value,horizonDays:Number($('workspaceHorizon').value),maxPositionPct:Number($('workspaceMaxWeight').value),avoidSectors:$('workspaceAvoid').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),excludedSymbols:$('workspaceExcluded').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),unresolved:$('workspaceUnresolved').value.split('\n').map(x=>x.trim()).filter(Boolean)}});if(result)call();});
 $('workspaceRestorePreferences').addEventListener('click',async()=>{if(!view||!allowWrite())return;const r=await call({action:'restore-preferences',requestId:key(),expectedRevision:view.preferences.revision,revision:Number($('workspacePreferenceVersion').value)});if(r)call();});
 $('workspaceSavePreset').addEventListener('click',async()=>{if(!view||!allowWrite())return;const name=$('workspacePresetName').value,prior=view.presets.find(p=>p.name===name),symbol=$('workspaceSymbol').value.trim();const r=await call({action:'preset',requestId:key(),expectedRevision:prior?.revision||0,value:{name,...(symbol?{symbol}:{}),status:$('workspaceFilterStatus').value,minScore:Number($('workspaceMinScore').value),horizon:Number($('workspaceHorizon').value)}});if(r)call();});
 $('workspacePreset').addEventListener('change',presetVersions);
 $('workspaceRestorePreset').addEventListener('click',async()=>{if(!view||!allowWrite())return;const p=view.presets.find(x=>x.name===$('workspacePreset').value);if(!p)return;const r=await call({action:'restore-preset',name:p.name,revision:Number($('workspacePresetVersion').value),expectedRevision:p.revision,requestId:key()});if(r)call();});
 const filterIds=['workspaceSymbol','workspaceFilterStatus','workspaceHorizon','workspaceMinScore'];
 $('workspaceApplyPreset').addEventListener('click',()=>{const p=view?.presets.find(x=>x.name===$('workspacePreset').value);if(!p)return;undo=filterIds.map(id=>$(id).value);[p.symbol||'',p.status,String(p.horizon),String(p.minScore)].forEach((v,i)=>$(filterIds[i]).value=v);$('workspaceUndoPreset').disabled=false;clear('模板已应用；点击读取查看，不会改变正式策略');});
 $('workspaceUndoPreset').addEventListener('click',()=>{if(!undo)return;undo.forEach((v,i)=>$(filterIds[i]).value=v);undo=null;$('workspaceUndoPreset').disabled=true;clear('已撤销模板应用；点击读取查看');});
 $('workspaceExport').addEventListener('click',async()=>{const r=await call(null,{export:'1'});if(!r)return;const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='tian-shu-research.json';a.click();URL.revokeObjectURL(url);});
 for(const id of ['workspaceSymbol','workspaceProvider','workspaceAsOf','workspaceFilterStatus','workspaceMinScore','token'])for(const event of ['input','change'])$(id)?.addEventListener(event,()=>{offset=0;clear(undefined,id==='token');for(const key of ['workspaceReview','workspaceSavePreferences','workspaceRestorePreferences','workspaceSavePreset','workspaceRestorePreset'])$(key).disabled=historical();});
 for(const id of ['workspaceScreenRun','workspaceCompareRun'])$(id).addEventListener('change',()=>{offset=0;clear();call();});
 root.addEventListener?.('offline',()=>clear('网络离线，私有研究视图已清空',true));root.addEventListener?.('pagehide',()=>clear('页面已离开，私有研究视图已清空',true));
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear('页面隐藏，私有研究视图已清空',true);});
 root.addEventListener?.('v6:stock-research',event=>{const d=event.detail||{};if(!/^\d{6}$/.test(d.symbol||''))return;$('workspaceSymbol').value=d.symbol;if(['eastmoney','tencent'].includes(d.provider))$('workspaceProvider').value=d.provider;offset=0;clear(d.workspace?.status==='failed'?'本次工作区封存未完成；原始研究仍保留':'股票观察已完成，可读取同一份封存研究');});
 root.V6ResearchWorkspace={render:result=>{view=result;render();},clear};
})(typeof window==='object'?window:globalThis);
