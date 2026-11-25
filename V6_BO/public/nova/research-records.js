import {questions,explainSealedResearch} from './research-review.mjs';
import {onResearchRead} from './automatic-research.js';
/* Native research archive: all writes keep the server's version and identity gates. */
const list = value => Array.isArray(value) ? value : [];
const names = {pass:'满足',fail:'未满足',unknown:'未知',selected:'已入选',rejected:'未入选',watch:'观望',completed:'已完成',failed:'未完成',pending:'待到期',partial:'部分完成',saved:'已封存',fourteen:'十四条',bazi:'八字口诀',gpt:'GPT 五策略',python:'Python 三轮','missing-outcome':'缺少后续行情','quote-unusable':'报价不可用','entry-evidence-missing':'入选依据未封存','first-observation':'首次观察','observed-change':'判断变化','data-revision':'数据修订','not-evaluated':'尚未评估','filtered-out':'被当前过滤条件隐藏','descriptive-only':'描述统计','insufficient-independent-samples':'独立样本不足'};
const value = x => x == null ? '未知' : typeof x === 'object' ? Array.isArray(x) ? x.map(value).join('、') : Object.entries(x).slice(0,12).map(([k,v])=>`${k}：${value(v)}`).join('；') : names[x] || String(x);
const clock = x => Number.isFinite(x) && x > 0 ? new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '未知';
const classMap={panel:'fy-panel',toolbar:'fy-toolbar',fields:'fy-grid',field:'fy-field',button:'fy-button','empty-state':'fy-empty',status:'fy-note',muted:'fy-muted','evidence-detail':'fy-details',facts:'fy-facts',fact:'fy-fact','record-layout':'fy-record-layout','record-deck':'fy-record-deck','record-detail':'fy-record-detail','record-choice':'fy-record-choice','record-tools':'fy-record-tools','detail-grid':'fy-grid',subnav:'fy-tabs','research-records':'fy-stack'};
const n = (tag, text, cls) => { const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls.split(' ').map(c=>classMap[c]||c).join(' ');return el; };
const append = (parent,...children) => { parent.append(...children.filter(Boolean));return parent; };
function row(label,val){return append(n('div',null,'fact'),n('dt',label),n('dd',value(val)));}
function facts(object){return append(n('dl',null,'facts'),...Object.entries(object).map(([k,v])=>row(k,v)));}
function button(label,fn,kind='secondary'){const el=n('button',label,`button ${kind}`);el.type='button';el.addEventListener('click',fn);return el;}
function input(type='text',defaultValue='',placeholder=''){const el=n('input');el.type=type;el.value=defaultValue;el.placeholder=placeholder;return el;}
function select(options){const el=n('select');for(const [v,label]of options){const option=n('option',label);option.value=v;el.append(option);}return el;}
function field(label,control){return append(n('label',null,'field'),n('span',label),control);}
function card(title,...children){return append(n('article',null,'panel'),n('h3',title),...children);}
function detail(title,...children){return append(n('details',null,'evidence-detail'),n('summary',title),...children);}
function empty(title,description){return append(n('div',null,'empty-state'),n('strong',title),n('p',description));}
function grid(rows){return append(n('div',null,'detail-grid'),...rows);}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=n('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
function link(url,label){try{const parsed=new URL(url);if(parsed.protocol!=='https:')return n('span','来源地址无效');const a=n('a',label);a.href=parsed.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return n('span','来源地址未知');}}
function jsonFile(control,max=60000){const f=control.files?.[0];if(!f)throw Error('请先选择 JSON 文件');if(f.size>max)throw Error(`文件超过 ${Math.floor(max/1000)}KB`);return f.text().then(text=>JSON.parse(text));}
const requestId=()=>globalThis.crypto?.randomUUID?.()||`fayo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function renderRecords(ctx){
 const root=n('div',null,'research-records');
 const status=n('p','选择股票或直接读取已有研究档案。读取不会采集行情。','status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const symbol=input('search',typeof ctx.stock==='string'?ctx.stock:ctx.stock?.code||'','六位代码，可留空');symbol.maxLength=6;
 const provider=select([['eastmoney','东方财富'],['tencent','腾讯']]);
 const at=input('datetime-local');const state=select([['all','全部状态'],['selected','已入选'],['rejected','未入选'],['unknown','证据不足']]);
 const minScore=input('number','0');minScore.min='0';minScore.max='100';
 const batch=select([['','最新筛选批次']]),comparison=select([['','不对照其他版本']]);
 const filters=append(n('div',null,'fields'),field('股票',symbol),field('比较来源',provider),field('历史时点 · 北京时间',at),field('条件状态',state),field('最低评分',minScore),field('筛选批次',batch),field('版本对照',comparison));
 const deck=n('div',null,'record-deck'),body=n('div',null,'record-detail');
 const detailTabs=n('div',null,'subnav');detailTabs.setAttribute('role','tablist');detailTabs.setAttribute('aria-label','研究记录内容');
 const privateTools=n('div',null,'record-tools');
 const main=n('div',null,'record-layout');main.append(deck,body);
 let view=null,offset=0,selectedId='',activeTab='evidence',generation=0,busy=false,nativeEvidence=null,prediction=null,undo=null;
 let preferenceRevision=null,preferenceDirty=false,preferenceConflict=false;
 const canEdit=ctx.role==='edit';
 const tabs=[['evidence','封存证据'],['timeline','判断轨迹'],['systems','体系分歧'],['screening','筛选去向'],['market','市场位置'],['scorecard','前向评测'],['defense','持仓防守'],['diagnostics','数据诊断']];
 const tabButtons=[];
 const historical=()=>Boolean(at.value);
 const alive=id=>id===generation&&!ctx.signal?.aborted;
 const notice=(message,tone='info')=>{status.textContent=message;status.dataset.tone=tone;};
 function clear(message,privacy=false){generation++;busy=false;view=null;selectedId='';deck.replaceChildren();body.replaceChildren();if(privacy){nativeEvidence=null;prediction=null;nativeFile.value='';forecastFile.value='';preferenceRevision=null;preferenceDirty=false;preferenceConflict=false;for(const item of Object.values(pref))item.value='';}notice(message);sync();}
 function query(extra={}){
  if(symbol.value&&!/^\d{6}$/.test(symbol.value))throw Error('股票代码须为六位数字');
  const q=new URLSearchParams({offset:String(offset),limit:'20',status:state.value,minScore:minScore.value||'0'});
  if(symbol.value)q.set('symbol',symbol.value);if(selectedId)q.set('runId',selectedId);if(batch.value)q.set('screenId',batch.value);if(comparison.value)q.set('compareId',comparison.value);
  if(at.value){const stamp=Date.parse(at.value+(at.value.length===16?':00':'')+'+08:00');if(!Number.isFinite(stamp))throw Error('历史时点无效');q.set('asOf',String(stamp));}
  for(const[k,v]of Object.entries(extra))q.set(k,String(v));return q;
 }
 async function read(extra={}){
  const id=++generation;busy=true;sync();notice('正在读取封存记录…');
  try{const result=await ctx.api('/api/research/workspace?'+query(extra),{signal:ctx.signal});if(!alive(id))return;
   if(!result.ok||!result.result)throw Error(result.error||'档案不可用');view=result.result;selectedId=view.selectedRun?.id||selectedId;render();settings();notice(`已读取 ${clock(view.asOf)} 的封存记录。`);
  }catch(error){if(alive(id)){if([401,403].includes(error.status)||error.body?.locked||error.body?.needAuth){clear('研究授权已失效，私有记录和偏好已清空。',true);}else{view=null;deck.replaceChildren();body.replaceChildren();notice(error.message||'研究记录读取失败','error');}}}
  finally{if(alive(id)){busy=false;sync();}}
 }
 async function write(payload,after){
  if(historical()){notice('历史回放只读；清空历史时点后可保存。','error');return null;}
  if(!canEdit){notice('当前身份没有研究编辑权限。','error');return null;}
  const id=++generation;busy=true;sync();notice('正在保存研究操作…');
  try{const result=await ctx.api('/api/research/workspace',{method:'POST',body:{...payload,requestId:requestId()},signal:ctx.signal});if(!alive(id))return null;
   if(!result.ok)throw Error(result.error||'保存未完成');notice(result.reused?'已复用原封存记录。':'研究操作已保存。');if(after)after(result);return result;
  }catch(error){if(alive(id)){notice((error.message||'保存未完成')+'；输入草稿已保留，请重新读取核对版本。','error');if(payload.action==='preferences')preferenceConflict=true;}return null;}
  finally{if(alive(id)){busy=false;sync();}}
 }
 const toolbar=n('div',null,'toolbar');
 const readButton=button('读取研究档案',()=>{offset=0;read();},'primary');
 const latest=button('返回最新版本',()=>{selectedId='';offset=0;read();});
 const review=button('比较已存股票',async()=>{if(!/^\d{6}$/.test(symbol.value)){notice('比较已存股票需要六位代码。','error');return;}const result=await write({action:'review',symbol:symbol.value,provider:provider.value,...(nativeEvidence?{nativeEvidence}:{})});if(result){selectedId=result.runId||'';offset=0;read();}});
 const exportButton=button('导出当前证据',async()=>{if(!view)return;const id=++generation;try{const q=query({export:'1',asOf:view.asOf,...(view.selectedRun?.id?{runId:view.selectedRun.id}:{})});const result=await ctx.api('/api/research/workspace?'+q,{signal:ctx.signal});if(alive(id))download('fayo-research-evidence.json',result.result);}catch(error){if(alive(id))notice(error.message,'error');}});
 toolbar.append(readButton,latest,review,exportButton);
 for(const[key,label]of tabs){const tab=button(label,()=>{const paged=offset!==0;activeTab=key;offset=0;if(paged)read();else render();});tab.setAttribute('role','tab');tab.dataset.recordTab=key;tabButtons.push(tab);detailTabs.append(tab);}
 detailTabs.addEventListener('keydown',event=>{const i=tabButtons.indexOf(event.target);if(i<0)return;const j=event.key==='Home'?0:event.key==='End'?tabButtons.length-1:event.key==='ArrowRight'?(i+1)%tabButtons.length:event.key==='ArrowLeft'?(i+tabButtons.length-1)%tabButtons.length:null;if(j==null)return;event.preventDefault();tabButtons[j].focus();});
 const prev=button('上一页',()=>{offset=Math.max(0,offset-20);read();}),next=button('下一页',()=>{offset+=20;read();}),pageNote=n('span');
 const pagination=append(n('div',null,'toolbar'),prev,pageNote,next);
 function sync(){readButton.disabled=busy||!canEdit;latest.disabled=busy||!canEdit;review.disabled=busy||historical()||!canEdit;exportButton.disabled=busy||!view;prev.disabled=busy||offset===0;const total=activeTab==='screening'?view?.screening?.total:activeTab==='timeline'?view?.timelineTotal:activeTab==='scorecard'?view?.forecastEvaluation?.total:view?.runs?.total;next.disabled=busy||offset+20>=(total||0);pageNote.textContent=total?`${offset+1}—${Math.min(offset+20,total)} / ${total}`:'暂无已读取分页';savePreferences.disabled=busy||historical()||!view||preferenceConflict||!canEdit;restorePreference.disabled=busy||historical()||!view||!canEdit;freeze.disabled=busy||historical()||!view?.forecastEvaluation?.freezeAllowed||!prediction||!canEdit;forecastInput.disabled=!view?.forecastEvaluation?.input||busy;savePreset.disabled=busy||historical()||!view||!canEdit;restorePreset.disabled=busy||historical()||!view||!canEdit;}
 function render(){
  tabButtons.forEach((el,i)=>{const selected=tabs[i][0]===activeTab;el.setAttribute('aria-selected',String(selected));el.tabIndex=selected?0:-1;});
  deck.replaceChildren();body.replaceChildren();if(!view){body.append(empty('尚未读取档案','筛选条件只决定读取范围，不会重新扫描行情或改变生产规则。'));sync();return;}
  const versions=list(view.runs?.rows);
  deck.append(n('h3','版本书签'));
  if(!versions.length)deck.append(empty('暂无封存研究','可先在数据工作台采集真实股票，再比较已存资料。'));
  for(const run of versions){const item=button(`${run.name||run.symbol} · ${run.tradeDate||'日期未知'}`,()=>{selectedId=run.id;offset=0;read();});item.className='fy-button fy-record-choice';item.setAttribute('aria-pressed',String(run.id===selectedId));item.append(n('small',`${clock(run.recordedAt)} · ${run.id?.slice(0,10)||'未知版本'}`));deck.append(item);}
  const r=view.selectedRun;
  if(activeTab==='evidence'){
   if(!r){body.append(empty('选择一条研究记录','每次判断保留原始来源、条件和失效依据。'));sync();return;}
   body.append(card(`${r.name||''} ${r.symbol}`,facts({'数据截止日':r.tradeDate,'来源':r.provider,'封存时间':clock(r.recordedAt),'研究版本':r.id})));
   const evidence=new Map(list(r.evidence).map(e=>[e.id,e]));
   const checks=list(r.conditions).map(c=>{const d=detail(`${c.name||c.field} · ${value(c.status)}`,facts({'条件':`${value(c.field)} ${value(c.op)} ${value(c.threshold)}`,'观察值':c.value,'判断理由':c.reason,'失效条件':c.invalidation}));
    for(const id of list(c.evidenceIds)){const e=evidence.get(id);if(e)d.append(facts({'证据来源':e.source,'来源原始时点':clock(e.sourceTimestamp),'覆盖期终点':clock(e.periodEnd),'首次可用':clock(e.availableAt),'接收时点':clock(e.receivedAt),'缺失原因':e.missingReason,'封存引用':e.evidenceRef}));}return d;});body.append(card('判断依据',...checks));
   const answers=n('div',null,'detail-grid');answers.setAttribute('aria-live','polite');
   const ask=append(n('div',null,'toolbar'),...questions.map(([key,label])=>button(label,()=>{
     const a=explainSealedResearch(view,key);answers.replaceChildren(n('p',a.reason,'muted'));
     for(const row of a.rows)answers.append(detail(row.name+' · '+value(row.status),facts({'原策略版本':row.version,'原条件状态':row.archivedStatus,'原判断理由':row.reason,'原失效条件':row.invalidation,'证据缺口':row.missing}),...row.evidence.map(e=>facts({'证据引用':e.evidenceRef,'来源':e.source,'原始时点':clock(e.sourceTimestamp),'首次可用':clock(e.availableAt),'实际接收':clock(e.receivedAt)}))));
   })));
   body.append(card('研究证据五问',n('p','规则解释 · 本次未调用外部模型，模型配置及可用性未核验。只读原封存档案，不改变策略或交易。','muted'),ask,answers));
   const refs=detail('原始来源与版本');for(const ref of list(r.sourceRefs))refs.append(facts({'来源':ref.source,'内容指纹':ref.hash}),ref.url?link(ref.url,'打开原始来源'):n('span','来源地址未知'));body.append(refs);
  }else if(activeTab==='timeline'){
   body.append(card('判断轨迹',...list(view.timeline).map(item=>detail(`${item.tradeDate||'日期未知'} · ${clock(item.asOf)}`,facts({'来源':item.provider,'目标日':item.targetDate,'比较状态':item.changes?.status}),...list(item.changes?.systemChanges).map(c=>row(value(c.system),`${value(c.before)} → ${value(c.after)}`)),...list(item.changes?.changes).map(c=>row(c.name||c.condition,`${value(c.kind)} · ${value(c.before)} → ${value(c.after)}`))))));
  }else if(activeTab==='systems'){
   body.append(card('四套体系独立判断',...list(r?.systems).map(s=>detail(`${s.label} · ${value(s.verdict)}`,facts({'已知 / 全部条件':`${value(s.known)} / ${value(s.total)}`,'证据覆盖':s.coverageOnly?'仅表示可读取评分证据，体系结论仍由原生评估器给出':'原体系判断'}),...['support','opposition','missing'].map(key=>detail(({support:'支持',opposition:'反对',missing:'缺失'})[key],...list(s[key]).map(x=>row(x.name||x.field,`${value(x.value)} · ${value(x.reason)}`))))))));
  }else if(activeTab==='screening'){
   const screen=view.screening||{};body.append(card('筛选流向',facts({'查询状态':screen.lookupStatus,'原始输入股票数':screen.inputTotal,'资料性质':screen.provenance}),...list(screen.funnel?.steps).map(s=>row(s.label,`${s.before} → ${s.after} · 移出 ${s.removed} · 未知 ${s.unknown}`)),...list(screen.rows).map(item=>detail(`${item.symbol} ${item.name||''} · ${value(item.status)}`,button('查看该股票',()=>{symbol.value=item.symbol;selectedId='';offset=0;read();}),facts({'首次淘汰原因':item.firstReason}),...list(item.reasons).map(x=>row(value(x.stage),`${value(x.status)} · ${value(x.reason)}`))))));
  }else if(activeTab==='market'){
   body.append(card('市场与题材位置',facts({'市场环境':r?.regime,'环境含义':r?.regimeMeaning,'范围与缺口':view.marketPosition?.reason}),...list(view.marketPosition?.boards).map(b=>detail(`${b.name} · ${value(b.phase)}`,facts({'角色':b.role,'数据日':b.tradeDate,'成员覆盖':`${value(b.observedMembers)} / ${value(b.memberCount)}`,'同日位置':b.rank,'阶段依据':b.phaseBasis,'角色依据':b.roleBasis}),...list(b.history).map(x=>row(x.date,`${value(x.changePct)}%`))))));
   const market=view.marketLinkage;if(market)body.append(card('大盘—板块—个股证据',facts({'状态':market.status,'交易日':market.tradeDate,'相同市场日':market.sameMarketTradeDate,'限制':market.limitation||market.reason}),...list(market.boards||market.industryBoards).map(x=>detail(x.name||x.code,facts({'板块类型':x.category,'相对收益':x.return,'证据时点':clock(x.knownAt)})))));
  }else if(activeTab==='scorecard'){
   body.append(card('策略前向成绩',...list(view.scorecard?.groups).map(g=>detail(`${value(g.system)} · ${value(g.regime)} · ${g.horizon}日`,facts({'状态':g.status,'策略版本':g.version,'原始 / 通过 / 拒绝 / 未知':`${g.total} / ${g.passed} / ${g.rejected} / ${g.unknown}`,'待到期':g.pending,'缺少后续证据':g.missing,'可观察价格样本':g.observedPriceCount,'成本化样本':g.modeledCount,'独立股票数':g.distinctSymbols,'独立信号日':g.independentSignalDays,'非重叠窗口':g.nonOverlappingWindows,'平均价格变化 %':g.averagePriceReturnPct,'成本后估计 %':g.averageNetReturnPct,'同口径超额 %':g.excessReturnPct}))),...list(view.scorecard?.limitations).map(text=>n('p',text,'muted'))));
   const f=view.forecastEvaluation||{};body.append(card('模型前向评测',facts({'状态':f.status,'输入比较口径':f.inputComparison,'配置组数':f.groupTotal,'记录总数':f.total}),...list(f.groups).map(g=>detail(`${g.model?.id||'未知模型'} / ${g.model?.revision||'未知版本'} · ${g.horizon}日`,facts({'状态':g.status,'已到期 / 待到期 / 缺价':`${g.matured} / ${g.pending} / ${g.missing}`,'绝对误差 MAE':g.mae,'前值基线误差':g.naiveMae,'趋势基线误差':g.driftMae,'相对基线误差':g.relativeMae,'分位数损失':g.pinballLoss,'区间覆盖 %':g.intervalCoveragePct,'目标覆盖 %':g.nominalCoveragePct,'区间宽度':g.meanIntervalWidth,'独立信号日':g.signalDays,'后续修订':g.revisedOutcomes}))),...list(f.pairs?.rows).map(p=>detail(`${p.modelA?.id} ↔ ${p.modelB?.id} · ${p.horizon}日`,facts({'同输入配对样本':p.samples,'MAE A':p.maeA,'MAE B':p.maeB,'误差差值 A−B':p.deltaMaeAminusB}))),...list(f.rows).map(x=>row(`${x.symbol} ${x.targetDate}`,`${value(x.status)} · 预测 ${value(x.point)} / 实际 ${value(x.actual)} · 误差 ${value(x.absoluteError)}`)),...list(f.limitations).map(text=>n('p',text,'muted'))));
  }else if(activeTab==='defense'){
   body.append(card('持仓研究防守',...list(view.defense?.rows).map(p=>detail(`${p.name||p.symbol} · ${value(p.status)}`,facts({'账户':p.accountId,'原报价年龄 ms':p.quoteAgeMs,'判断数据日':p.currentTradeDate,'封存时间':clock(p.currentEvidenceAt),'成本变化 %':p.costChangePct,'集中度 %':p.weightPct,'锁仓':p.locked,'静默':p.muted,'原入选依据':p.entryRunId,'缺失证据':p.missing,'回避板块':p.avoidedBoards}),...list(p.invalidated).map(x=>row('原条件失效',x.name)))),facts({'说明':view.defense?.reason||view.defense?.meaning||'没有可读取的原账户资料，不能据此判断券商账户为空。'})));
  }else if(activeTab==='diagnostics'){
   body.append(card('分析诊断',...list(view.quality?.sources).map(x=>row(x.source,`已知 ${x.known}/${x.total} · 缺失 ${x.missing}`)),...list(view.quality?.gaps).map(x=>row(x.field,`${x.affectedStrategies} 个体系 · ${value(x.reason)}`)),...list(view.diagnostics).map(d=>detail(`${clock(d.asOf)} · ${value(d.status)}`,...list(d.stages).map(x=>row(x.stage,`${value(x.status)}${x.durationMs!=null?' · '+x.durationMs+'ms':''}`)),row('继续条件',d.retry))),facts({'指标预热':view.inputAudit?.warmupStatus,'历史可得性':view.inputAudit?.pointInTime?.meaning}),...list(view.drift?.reports).map(d=>detail(`${d.before} → ${d.after}`,facts({'同股':d.matched,'新增':d.added,'移出':d.removed,'未知比例变化':`${value(d.beforeUnknownRate)} → ${value(d.afterUnknownRate)}`,'归因':d.attribution})))));
  }
  if(!body.childElementCount)body.append(empty('该分类尚无证据','当前已存档案没有此类结果，未生成替代数据。'));sync();
 }
 function fillOptions(el,options,emptyLabel){const chosen=el.value,prior=el.selectedOptions?.[0]?.textContent;el.replaceChildren();const first=n('option',emptyLabel);first.value='';el.append(first);for(const item of options){const opt=n('option',item.label);opt.value=item.value;el.append(opt);}if(chosen&&!options.some(x=>x.value===chosen)&&prior){const retained=n('option',prior.endsWith('（保留所选）')?prior:prior+'（保留所选）');retained.value=chosen;el.append(retained);}if(chosen)el.value=chosen;}
 const pref={objective:input('text','','研究目标'),horizonDays:select([['1','1 日'],['5','5 日'],['20','20 日'],['60','60 日']]),maxPositionPct:input('number','30'),avoidSectors:input('text','','逗号分隔'),excludedSymbols:input('text','','六位代码，逗号分隔'),unresolved:n('textarea')};pref.horizonDays.value='5';pref.maxPositionPct.min='1';pref.maxPositionPct.max='100';
 for(const control of Object.values(pref))control.addEventListener('input',()=>{preferenceDirty=true;});
 const preferenceNotice=n('p','读取档案后可编辑研究偏好，不改变生产交易配置。','muted');
 const preferenceHistory=select([]),presets=select([]),presetHistory=select([]),presetName=input('text','','筛选模板名称');
 function settings(){
  const p=view?.preferences;if(p){if(preferenceDirty&&preferenceRevision!==null&&preferenceRevision!==p.revision){preferenceConflict=true;preferenceNotice.textContent='服务端偏好已有新版本；本地草稿已保留。请选择保留草稿并重基，或载入服务端版本。';}else if(!preferenceDirty)loadPreference(p.value);preferenceRevision=p.revision;fillOptions(preferenceHistory,list(p.history).map(x=>({value:String(x.revision),label:`版本 ${x.revision} · ${clock(x.recordedAt)}`})),'选择历史偏好');}
  fillOptions(batch,list(view?.screenRuns).map(x=>({value:x.id,label:`${clock(x.asOf)} · ${x.total}只`})),'最新筛选批次');fillOptions(comparison,list(view?.runs?.rows).map(x=>({value:x.id,label:`${x.symbol} · ${clock(x.recordedAt)} · ${x.id.slice(0,8)}`})),'不对照其他版本');fillOptions(presets,list(view?.presets).map(x=>({value:x.name,label:`${x.name} · 版本${x.revision}`})),'选择筛选模板');presetVersions();
  if(prediction&&prediction.inputFingerprint!==view?.forecastEvaluation?.input?.inputFingerprint){prediction=null;forecastFile.value='';forecastNote.textContent='研究输入发生变化，已清除未封存预测。';}sync();
 }
 function loadPreference(p={}){pref.objective.value=p.objective||'';pref.horizonDays.value=String(p.horizonDays??5);pref.maxPositionPct.value=p.maxPositionPct==null?'':String(p.maxPositionPct);pref.avoidSectors.value=list(p.avoidSectors).join('、');pref.excludedSymbols.value=list(p.excludedSymbols).join('、');pref.unresolved.value=list(p.unresolved).join('\n');preferenceDirty=false;preferenceConflict=false;preferenceNotice.textContent='偏好只作用于研究视图，版本冲突时不会覆盖其他设备的修改。';}
 function preferenceValue(){return {objective:pref.objective.value,horizonDays:Number(pref.horizonDays.value),maxPositionPct:pref.maxPositionPct.value===''?null:Number(pref.maxPositionPct.value),avoidSectors:pref.avoidSectors.value.split(/[,，、]/).map(x=>x.trim()).filter(Boolean),excludedSymbols:pref.excludedSymbols.value.split(/[,，、]/).map(x=>x.trim()).filter(Boolean),unresolved:pref.unresolved.value.split('\n').map(x=>x.trim()).filter(Boolean)};}
 const savePreferences=button('保存偏好',async()=>{if(preferenceConflict||preferenceRevision===null)return;const r=await write({action:'preferences',expectedRevision:preferenceRevision,value:preferenceValue()});if(r){preferenceDirty=false;preferenceConflict=false;read();}},'primary');
 const restorePreference=button('恢复所选历史版本',async()=>{if(!preferenceHistory.value)return;const r=await write({action:'restore-preferences',expectedRevision:view.preferences.revision,revision:Number(preferenceHistory.value)});if(r){preferenceDirty=false;read();}});
 const keepDraft=button('保留草稿并重基',()=>{if(!view)return;preferenceRevision=view.preferences.revision;preferenceConflict=false;preferenceNotice.textContent='已保留当前草稿，下一次保存将基于刚读取的服务端版本。';sync();});
 const discardDraft=button('载入服务端偏好',()=>{if(view?.preferences)loadPreference(view.preferences.value);sync();});
 const preferencePanel=detail('研究偏好与版本',append(n('div',null,'fields'),...Object.entries(pref).map(([key,el])=>field(({objective:'研究目标',horizonDays:'观察周期 / 日',maxPositionPct:'集中度关注线 %',avoidSectors:'回避板块',excludedSymbols:'排除股票',unresolved:'未完成事项'})[key],el))),preferenceNotice,append(n('div',null,'toolbar'),savePreferences,keepDraft,discardDraft),field('偏好历史',preferenceHistory),restorePreference);
 function presetVersions(){const p=list(view?.presets).find(x=>x.name===presets.value);fillOptions(presetHistory,list(p?.history).map(x=>({value:String(x.revision),label:`版本 ${x.revision} · ${clock(x.recordedAt)}`})),'选择模板历史');}
 presets.addEventListener('change',presetVersions);
 const savePreset=button('保存当前筛选为模板',async()=>{if(!presetName.value.trim())return notice('请输入模板名称。','error');const prior=list(view?.presets).find(x=>x.name===presetName.value);const r=await write({action:'preset',expectedRevision:prior?.revision||0,value:{name:presetName.value,...(symbol.value?{symbol:symbol.value}:{}),status:state.value,minScore:Number(minScore.value),horizon:Number(pref.horizonDays.value)}});if(r)read();});
 const restorePreset=button('恢复模板历史',async()=>{const p=list(view?.presets).find(x=>x.name===presets.value);if(!p||!presetHistory.value)return;const r=await write({action:'restore-preset',name:p.name,revision:Number(presetHistory.value),expectedRevision:p.revision});if(r)read();});
 const applyPreset=button('应用模板到筛选',()=>{const p=list(view?.presets).find(x=>x.name===presets.value);if(!p)return;undo=[symbol.value,state.value,minScore.value,pref.horizonDays.value];symbol.value=p.symbol||'';state.value=p.status;minScore.value=String(p.minScore);pref.horizonDays.value=String(p.horizon);clear('已应用筛选模板；点击读取查看结果。');});
 const undoPreset=button('撤销模板应用',()=>{if(!undo)return;[symbol.value,state.value,minScore.value,pref.horizonDays.value]=undo;undo=null;clear('已恢复应用模板之前的筛选。');});
 const presetPanel=detail('筛选模板',append(n('div',null,'fields'),field('模板名称',presetName),field('已有模板',presets),field('历史版本',presetHistory)),append(n('div',null,'toolbar'),savePreset,applyPreset,undoPreset,restorePreset));
 const nativeFile=input('file');nativeFile.accept='.json,application/json';const nativeNote=n('p','可补充 Python、GPT、十四条、基准或市场联动的真实评估证据。','muted');
 nativeFile.addEventListener('change',async()=>{nativeEvidence=null;busy=false;sync();const id=++generation;try{const x=await jsonFile(nativeFile);if(!alive(id))return;if(!x||Array.isArray(x)||Object.keys(x).some(k=>!['pythonEvidence','gptEvidence','fourteenEvidence','benchmarkEvidence','marketLinkageEvidence'].includes(k)))throw Error('补充证据格式无效');nativeEvidence=x;nativeNote.textContent='已载入 '+Object.keys(x).join('、')+'，比较时由服务端核验身份与时点。';}catch(error){if(alive(id))nativeNote.textContent=error.message;}});
 const nativePanel=detail('补充外部策略报告（可选）',field('证据 JSON · 最多60KB',nativeFile),nativeNote,button('清除补充证据',()=>{nativeEvidence=null;nativeFile.value='';nativeNote.textContent='未选择补充证据。';}),button('导出市场联动空模板',()=>{const r=view?.selectedRun;download('fayo-linkage-evidence-template.json',{marketLinkageEvidence:{provider:r?.provider||provider.value,symbol:r?.symbol||symbol.value,tradeDate:r?.tradeDate||'',knownAt:null,window:{start:null,end:null},returnBasis:'price',benchmark:{provider:r?.provider||provider.value,code:'',name:'',methodologyVersion:'',return:null,startValue:null,knownAt:null},classification:{provider:'',version:'',knownAt:null,effectiveAt:null},methodology:{weightsKnownAt:null,weightsEffectiveAt:null,noCorporateActions:null,completeConstituents:null},boards:[],stocks:[{symbol:r?.symbol||symbol.value,return:null,weight:null,indexMember:null,primaryIndustry:null,turnover:null,knownAt:null}]}});}));
 const forecastFile=input('file');forecastFile.accept='.json,application/json';const forecastNote=n('p','选择研究版本后导出输入，再导入实际运行生成的预测结果。','muted');
 const forecastInput=button('导出固定输入与空模板',()=>{const f=view?.forecastEvaluation;if(f?.input)download('fayo-forecast-input.json',{input:f.input,outputTemplate:f.outputTemplate});});
 forecastFile.addEventListener('change',async()=>{prediction=null;busy=false;sync();const id=++generation,fingerprint=view?.forecastEvaluation?.input?.inputFingerprint;try{if(!fingerprint)throw Error('请先读取研究版本');const p=await jsonFile(forecastFile);if(!alive(id))return;if(p?.inputFingerprint!==fingerprint||!Array.isArray(p.forecasts))throw Error('输入指纹不匹配或预测结果无效');prediction=p;forecastNote.textContent=`已载入 ${p.model?.id||'未知模型'} / ${p.model?.revision||'未知版本'} · ${p.forecasts.length}个周期；封存时核验。`;}catch(error){if(alive(id))forecastNote.textContent=error.message;}finally{if(alive(id))sync();}});
 const freeze=button('封存这份预测',async()=>{if(!prediction||!view?.selectedRun)return;const runId=view.selectedRun.id;const r=await write({action:'freeze-forecast',runId,prediction});if(r){prediction=null;forecastFile.value='';selectedId=runId;activeTab='scorecard';read();}},'primary');
 const forecastPanel=detail('封存自己的模型报告（可选）',forecastInput,field('实际模型输出 · 最多60KB',forecastFile),forecastNote,append(n('div',null,'toolbar'),freeze,button('清除未封存预测',()=>{prediction=null;forecastFile.value='';forecastNote.textContent='未封存预测已清除，历史档案保留。';sync();})));
 privateTools.append(preferencePanel,presetPanel,nativePanel,forecastPanel);
 let filterTimer;
 for(const control of [symbol,provider,at,state,minScore])control.addEventListener('input',()=>{
  clearTimeout(filterTimer);offset=0;prediction=null;forecastFile.value='';clear('正在按新条件查询档案…');
  if(canEdit&&(!symbol.value||/^\d{6}$/.test(symbol.value)))filterTimer=setTimeout(()=>{if(!ctx.signal?.aborted)void read();},350);
 });
 ctx.signal?.addEventListener('abort',()=>clearTimeout(filterTimer),{once:true});
 for(const control of [batch,comparison])control.addEventListener('change',()=>{offset=0;selectedId='';read();});
 const offline=()=>clear('连接已断开，私有研究视图已清空。',true);
 if(ctx.signal){globalThis.addEventListener('offline',offline,{signal:ctx.signal});ctx.signal.addEventListener('abort',()=>clear('工作区已关闭，私有资料已清空。',true),{once:true});}
 root.append(card('研究档案柜',n('p','从一次判断出发，追溯原始证据、版本差异与后续表现。','muted'),filters,toolbar,status),detailTabs,main,pagination,privateTools);
 render();if(canEdit)onResearchRead(ctx,()=>{if(!busy&&!historical()&&!preferenceDirty&&!prediction&&!nativeEvidence&&!root.matches(':focus-within'))void read();});if(!canEdit)notice('当前身份可浏览公开市场，私有研究档案需要编辑权限。');return root;
}
