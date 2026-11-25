import {readAutomatic,automaticSummary} from './automatic-research.js';
import { tacticsCenter } from './tactics-view.js';
import {renderAdvancedAccountRisk} from './advanced-risk-view.js';
/* Additional native research paths. Every action is explicit and uses the
   existing service contract; no legacy page/controller is loaded. */
import {h,button,section,field,note,empty,table,format,dateTime,safeLink} from './ui.js';
import {renderWorkbookImport} from './workbook-view.js';
const arr=value=>Array.isArray(value)?value:[];
const val=value=>value==null||value===''?'未知':String(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const editor=ctx=>ctx.role==='edit'||ctx.canEdit===true;
const facts=rows=>h('dl',{class:'fy-facts'},rows.map(([label,value])=>h('div',{class:'fy-fact'},h('dt',{},label),h('dd',{},val(value)))));
const metric=rows=>h('div',{class:'fy-grid'},rows.map(([label,value])=>h('article',{class:'fy-metric'},h('small',{},label),h('strong',{},val(value)))));
function exportResult(result,name='fayo-research.json'){const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=h('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function evidence(title,value){
 const root=h('details',{class:'fy-details'},h('summary',{},title));
 if(value==null){root.append(h('p',{},'尚无证据。'));return root;}
 if(Array.isArray(value)){for(const row of value){if(row&&typeof row==='object')root.append(facts(Object.entries(row).filter(([,v])=>v==null||typeof v!=='object')));else root.append(h('p',{},val(row)));}}
 else if(typeof value==='object')for(const [key,item]of Object.entries(value)){if(/token|password|secret|credential|cookie/i.test(key))continue;root.append(item&&typeof item==='object'?evidence(key,item):h('p',{},key+'：'+val(item)));}
 else root.append(h('p',{},val(value)));return root;
}
function pane(ctx,title,description){
 const status=note('尚未读取；不会自动启动任务。'),output=h('div',{class:'fy-stack'}),actions=h('div',{class:'fy-toolbar'}),root=section(title,description,actions,status,output);let revision=0;
 const alive=id=>id===revision&&!ctx.signal?.aborted;
 function invalidate(message='研究输入已变化，请重新读取。'){revision++;output.replaceChildren();status.textContent=message;}
 for(const event of ['input','change'])root.addEventListener(event,event=>{if(event.target.matches('input,select,textarea'))invalidate();});
 ctx.signal?.addEventListener('abort',()=>{revision++;output.replaceChildren();},{once:true});
 function action(label,run,render,{needEdit=false,kind='secondary'}={}){
  const control=button(label,async()=>{const turn=++revision;control.disabled=true;status.textContent='正在读取…';output.replaceChildren();try{const data=await run({current:()=>alive(turn)});if(!alive(turn))return;output.replaceChildren(render(data));status.textContent='已读取服务端证据，请核对来源与原始时点。';}catch(error){if(alive(turn))status.textContent=error.message||'请求未完成。';}finally{if(!ctx.signal?.aborted)control.disabled=needEdit&&!editor(ctx);}},kind);
  if(needEdit&&!editor(ctx)){control.disabled=true;control.title='需要编辑身份才能读取私有研究或运行任务';}actions.append(control);return control;
 }
 return {root,status,output,actions,action,invalidate};
}
function referenceStats(ctx){
 const p=pane(ctx,'四套策略的独立归属','只统计明确标注的来源。未归属不等于零命中；数量不是绩效或收益。');
 p.action('读取独立归属',()=>ctx.api('/api/reference-strategy-stats',{signal:ctx.signal}),data=>h('div',{class:'fy-stack'},metric([['十四条',data.items?.rule14?.status==='attributed'?data.items.rule14.count:'待独立归属'],['八字口诀',data.items?.bazi?.status==='attributed'?data.items.bazi.count:'待独立归属'],['GPT 五策略',data.items?.gpt?.status==='attributed'?data.items.gpt.count:'待独立归属'],['Python 三轮',data.items?.python?.status==='attributed'?data.items.python.count:'待独立归属']]),facts([['统计读取',dateTime(data.asOf)],['候选池规模',data.candidatePoolSize],['来源',data.source]]),h('p',{class:'fy-muted'},data.note||'来源缺失的策略不推测数量。')));
 return p.root;
}
function strategyDashboard(ctx){
 const p=pane(ctx,'策略引擎分解','查看现有评分引擎的市场状态、逐票贡献与命中原因。原始分数和硬过滤分别保留。');
 p.action('读取策略引擎',()=>ctx.api('/api/strategy/dashboard',{signal:ctx.signal}),data=>{
  const details=h('div',{class:'fy-stack'}),items=arr(data.items),choose=row=>{
   details.replaceChildren(section(row.name+' / '+row.code,'各分量来自本次服务端评分。',metric(['trend','momentum','breakout','quality','reversal'].map((key,index)=>[['趋势','动量','突破','质量','反转'][index],finite(row.contributions?.[key])?format(row.contributions[key],2):'未知'])),facts([['硬过滤',row.blocked===true?'已触发':row.blocked===false?'未触发':'未知'],['策略状态',row.regime],['命中原因',arr(row.reasons).join('；')||'尚无已提供原因']]),evidence('风险条件',row.risk)));
  };
  const deck=table([{label:'股票',value:row=>button(row.name+' '+row.code,()=>choose(row),'quiet')},{label:'服务端总分',value:row=>format(row.finalScore,2)},{label:'条件',value:row=>row.pass===true?'通过':row.pass===false?'观察':'未知'},{label:'硬过滤',value:row=>row.blocked===true?'已触发':row.blocked===false?'未触发':'未知'}],items);
  if(items.length)choose(items[0]);
  return h('div',{class:'fy-stack'},facts([['读取时点',dateTime(data.updatedAt)],['市场状态',data.regime],['评分口径', '现有策略引擎；原始时点和默认字段需单独核对']]),deck,details);
 });return p.root;
}
function riskCenter(ctx){
 const p=pane(ctx,'交叉风险观察','市场来源、手工持仓、新闻修订与研究状态共同核对。缺失项保持未知。');
 p.action('读取交叉风险证据',()=>ctx.api('/api/research/risk-center?advanced=1',{signal:ctx.signal,timeoutMs:15000}),data=>{
  const r=data.result;if(r?.mode!=='research-risk-center-readonly'||r.canTrade!==false||r.canNotify!==false||!Array.isArray(r.supports)||!Array.isArray(r.contra)||!Array.isArray(r.missing))throw Error('风险证据格式无效，不能判断当前风险。');
  const q=r.market?.quotes,summary=metric([['近期原始报价',q?q.recent+' / '+q.total:'未知'],['过期报价',q?.stale??'未知'],['未来时点',q?.future??'未知'],['缺失时点',q?.unknown??'未知']]);
  const holdings=r.manualHoldings||{},news=r.news||{};
  const items=h('div',{class:'fy-grid'},...[[r.supports,'已有观察'],[r.contra,'冲突与限制'],[r.missing,'缺失证据']].map(([rows,title])=>section(title,'',rows.length?h('ul',{},rows.map(row=>h('li',{},row.message||'证据说明未知'))):empty('尚无充分证据'))));
  return h('div',{class:'fy-stack'},summary,items,renderAdvancedAccountRisk(ctx,r.advancedAccounts,{onChanged:message=>p.invalidate(message)}),section('手工持仓观察','成本和权重来自手工申报，不表示已读取真实账户。',table([{label:'代码',value:x=>x.symbol},{label:'成本涨跌',value:x=>finite(x.drawdownFromCostPct)?format(x.drawdownFromCostPct)+'%':'未知'},{label:'申报仓位',value:x=>finite(x.weightPct)?format(x.weightPct)+'%':'未知'}],arr(holdings.positions))),section('新闻证据修订','撤稿和已替代版本不能继续作为支持依据。',facts([['当前事件',news.summary?.currentEvents],['已撤稿',news.summary?.retractedEvents],['未知事件',news.summary?.unknownEvents]]),...arr(news.rows).map(row=>h('article',{class:'fy-item'},h('strong',{},row.title||'标题未知'),h('p',{},val(row.source)+' · '+(row.current?'当前版本':'已被后续替代')+' · '+dateTime(row.publishedAt)),row.url&&safeLink(row.url,'原始来源')))),facts([['研究代理',r.researchAgent?.status],['代理资料日',r.researchAgent?.sourceDay],['策略衰减',r.strategyDecay?.reason||'证据不足，保持未知'],['生成',dateTime(r.generatedAt)]]));
 },{needEdit:true});return p.root;
}
function legacyBacktest(ctx){
 const root=section('全市场历史评分检验','沿用已有日K与评分后端，明确区分保存结果和本次任务。只读身份可以读取已存结果。'),status=note('尚未读取结果。'),output=h('div',{class:'fy-stack'});let generation=0,controller=null,running=false;
 function stop(message){generation++;controller?.abort();controller=null;running=false;start.disabled=!editor(ctx);cancel.disabled=true;if(message)status.textContent=message;}
 ctx.signal?.addEventListener('abort',()=>{stop();output.replaceChildren();},{once:true});
 function display(r,label){
  output.replaceChildren(section(label,'统计下一根日K收盘涨停或涨幅≥5%的历史频率，不是可成交收益。',metric([['当前股票',r.股票数??'未知'],['观测交易日',r.交易日数??'未知'],['有效样本',r.总样本??'未知'],['高分样本',r.高分样本数??'未知']]),table([{label:'评分段',value:x=>x.band},{label:'样本数',value:x=>x.样本数},{label:'历史事件频率',value:x=>x.历史事件频率??x.次日涨停或涨5pct概率??'未知'}],Object.entries(r.分数段命中率||{}).map(([band,row])=>({band,...row}))),facts([['高分段历史频率',r.高分事件频率||r.高分胜率||'未知'],['任务身份', '接口未返回独立运行ID，保存结果不单凭页面刷新认证为新任务']]),button('导出此结果',()=>exportResult(r,'fayo-score-backtest.json'))));
 }
 const wait=(ms,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(new DOMException('Aborted','AbortError'));const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',abort,{once:true});});
 const read=button('读取已保存结果',async()=>{stop();const turn=generation;read.disabled=true;try{const result=await ctx.api('/api/backtest/result',{signal:ctx.signal});if(turn!==generation||ctx.signal?.aborted)return;if(result.error)throw Error(result.error);if(result.empty||result.pending){status.textContent=result.pending?'服务端任务尚在运行。':'服务端尚无已保存结果。';return;}display(result,'服务端已保存的评分研究');status.textContent='已读取已保存结果；不宣称属于本次任务。';}catch(error){if(turn===generation&&!ctx.signal?.aborted)status.textContent=error.message;}finally{if(!ctx.signal?.aborted)read.disabled=false;}},'quiet');
 const start=button('启动历史评分检验',async()=>{
  if(!editor(ctx)||running)return;stop();running=true;start.disabled=true;cancel.disabled=false;const turn=generation,local=new AbortController();controller=local;let before=null;
  try{
   try{const existing=await ctx.api('/api/backtest/result',{signal:local.signal});if(!existing.empty&&!existing.error&&!existing.pending){before=JSON.stringify(existing);display(existing,'启动前已保存的研究结果');}}catch(error){if(local.signal.aborted)throw error;}
   if(turn!==generation||ctx.signal?.aborted)return;await ctx.api('/api/backtest',{method:'POST',body:{},signal:local.signal});
   for(let attempt=1;attempt<=30;attempt++){
    if(turn!==generation||ctx.signal?.aborted)return;status.textContent='任务已提交，等待新的可辨别结果 · '+attempt+' / 30';await wait(3000,local.signal);
    const result=await ctx.api('/api/backtest/result',{signal:local.signal});if(turn!==generation||ctx.signal?.aborted)return;if(result.error)throw Error(result.error);
    if(!result.empty&&!result.pending&&(!before||JSON.stringify(result)!==before)){display(result,'本次等待期间取得的研究结果');status.textContent='已取得与启动前不同的结果；接口没有独立运行ID，仍需核对来源。';return;}
   }
   status.textContent='等待已结束，未取得可辨别的新结果；可重新读取保存结果。不会无限轮询。';
  }catch(error){if(turn===generation&&!ctx.signal?.aborted)status.textContent=error.name==='AbortError'?'已停止等待，服务端任务可能仍在运行。':error.message;}
  finally{if(turn===generation&&!ctx.signal?.aborted)stop();}
 },'primary');
 start.disabled=!editor(ctx);const cancel=button('停止等待结果',()=>stop('已停止本页等待；不会取消服务端正在运行的任务。'),'quiet');cancel.disabled=true;
 root.append(h('div',{class:'fy-toolbar'},read,start,cancel),status,output);return root;
}
function nativeReplay(ctx){
 const history=h('input',{type:'file',accept:'.json,application/json','aria-label':'原生逐日历史证据'}),snapshots=h('input',{type:'file',accept:'.json,application/json','aria-label':'同日因子与竞价快照'}),python=h('input',{type:'file',accept:'.json,application/json','aria-label':'Python原生执行证据'}),split=h('input',{type:'number',min:1,step:1,placeholder:'使用服务端默认划分','aria-label':'样本内外分割日序号'});
 const p=pane(ctx,'原生策略逐日回放','按股票与交易日自动读取 V6 历史，检查四套规则在当时可知的证据。');
 p.root.insertBefore(h('details',{class:'fy-details'},h('summary',{},'补充自己的历史回放资料（可选）'),field('历史数据 JSON',history),field('同日快照 JSON（可选）',snapshots),field('Python 证据 JSON（可选）',python),field('分割日序号（可选）',split)),p.actions);
 const parse=async(file,required=false)=>{if(!file){if(required)throw Error('请选择真实历史证据文件。');return undefined;}if(file.size>8*1024*1024)throw Error('单个证据文件不能超过8MiB。');const data=JSON.parse(await file.text());if(!data||typeof data!=='object'||Array.isArray(data))throw Error('历史与同日证据必须为JSON对象。');return data;};
 p.action('逐日运行四套原生策略',async turn=>{const plan={history:history.files?.[0],snapshots:snapshots.files?.[0],python:python.files?.[0],split:split.value};let source=await parse(plan.history);if(!source){const x=await readAutomatic(ctx);if(!x.history)return {automatic:automaticSummary(x)};source={history:x.history};}const data={history:source.history||source,...(source.snapshots?{snapshots:source.snapshots}:{}),...(source.pythonEvidence?{pythonEvidence:source.pythonEvidence}:{}),...(source.splitDay!==undefined?{splitDay:source.splitDay}:{})};const optionalSnapshots=await parse(plan.snapshots),optionalPython=await parse(plan.python);if(optionalSnapshots)data.snapshots=optionalSnapshots;if(optionalPython)data.pythonEvidence=optionalPython;if(plan.split!==''){const value=Number(plan.split);if(!Number.isSafeInteger(value)||value<1)throw Error('分割日序号须为正整数。');data.splitDay=value;}if(new Blob([JSON.stringify(data)]).size>8*1024*1024)throw Error('组合后的研究证据不能超过8MiB。');if(!turn.current())throw new DOMException('研究输入已变化','AbortError');return ctx.api('/api/reference-strategy-research',{method:'POST',body:data,signal:ctx.signal,timeoutMs:60000});},data=>{
  if(data.automatic){const x=data.automatic;return section(x.name+' '+x.symbol,x.tradeDate+' · '+x.note,metric(x.observations.map(o=>[o.name,o.value+' '+o.unit])),note('正在积累具备当日接收凭据的历史序列。'));}
  const result=data.research;if(result?.mode!=='native-daily-research'||result.canTrade!==false)throw Error('原生逐日研究返回格式无效。');
  const coverage=result.coverage||{},names={fourteen:'十四条',bazi:'八字口诀',gpt:'GPT 五策略',python:'Python 三轮'};
  return h('div',{class:'fy-stack'},metric(Object.entries(names).map(([key,label])=>[label+' · 已评价 / 未知',val(coverage[key]?.evaluated)+' / '+val(coverage[key]?.unknown)])),table([{label:'代码',value:x=>x.symbol},{label:'交易日',value:x=>x.date},{label:'体系',value:x=>names[x.system]||x.system},{label:'结果',value:x=>x.verdict},{label:'原始归属',value:x=>x.provenance}],arr(result.signals).slice(0,500)),evidence('历史评测账本',result.replay),h('ul',{},arr(result.limitations).map(x=>h('li',{},x))),button('导出全部逐日证据',()=>exportResult(result,'fayo-native-daily-research.json')));
 },{needEdit:true,kind:'primary'});return p.root;
}
function sectorRelations(ctx){
 const category=h('select',{},h('option',{value:'industry'},'行业'),h('option',{value:'concept'},'概念')),code=h('input',{placeholder:'BK代码或已冻结目录ID',maxlength:30,'aria-label':'冻结板块代码'}),selection=h('div',{class:'fy-toolbar'});let ids=[];
 const p=pane(ctx,'冻结板块关系实验','只分析明确选择的冻结板块成员和行情。当前成员归属不回填历史，重叠与同日相关分别核对。');
 function render(){selection.replaceChildren(...ids.map(id=>button('移除 '+id,()=>{ids=ids.filter(x=>x!==id);render();p.invalidate('所选冻结板块已变化，请重新分析。');},'quiet')));}
 const add=button('加入关系实验',()=>{const id=category.value+'|'+code.value.trim();if(!/^(?:industry|concept)\|[A-Za-z0-9_-]{2,30}$/.test(id)){p.status.textContent='请选择类别并输入2至30位目录代码。';return;}if(ids.includes(id))return;if(ids.length>=30){p.status.textContent='最多选择30个冻结板块。';return;}ids.push(id);code.value='';render();p.invalidate('所选冻结板块已变化，请重新分析。');},'quiet');
 p.root.insertBefore(h('div',{class:'fy-toolbar'},field('类别',category),field('冻结目录代码',code),add),p.actions);p.root.insertBefore(selection,p.actions);
 p.action('分析所选冻结板块',()=>{if(!ids.length)throw Error('请先明确选择至少一个冻结板块。');return ctx.api('/api/research/sector-capture-relations',{method:'POST',body:{sectorIds:[...ids]},signal:ctx.signal,timeoutMs:60000});},data=>{
  const r=data.result||{},report=r.report||{};
  return h('div',{class:'fy-stack'},facts([['研究状态',r.status],['说明',r.reason||arr(r.limitations).join('；')||'只分析已冻结来源']]),evidence('同日关系与成员重叠',report),evidence('数据来源与覆盖',r.provenance),button('导出板块关系证据',()=>exportResult(r,'fayo-sector-relations.json')));
 },{needEdit:true,kind:'primary'});return p.root;
}

export function appendResearchExtensions(root,route,ctx){
 if(!root||ctx.signal?.aborted)return root;
 if(route.sub==='strategies')root.append(tacticsCenter(ctx),referenceStats(ctx),strategyDashboard(ctx));
 if(route.sub==='backtest')root.append(legacyBacktest(ctx),nativeReplay(ctx));
 if(route.sub==='sources')root.append(renderWorkbookImport(ctx),sectorRelations(ctx));
 if(route.sub==='desk')root.append(riskCenter(ctx));
 return root;
}
