// Shared native research UI for / and /m. No account/strategy mutations.
import {h,button,field,note,section,dateTime,format} from './ui.js';
const arr=v=>Array.isArray(v)?v:[];
const text=v=>v==null?'未知':typeof v==='string'?v:String(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const code=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const endpoint='/api/research/evidence-workbench';
const stamp=v=>Number.isSafeInteger(v)&&v>0?v:null;
const beijing=v=>new Date(v+28800000).toISOString().slice(0,23);
const day=v=>beijing(v).slice(0,10);
export function replayTime(v,now=Date.now()){
 if(!v)return now;
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(v))return NaN;
 const value=v.length===16?v+':00':v,at=Date.parse(value+'+08:00');
 return stamp(at)&&at<=now&&beijing(at).slice(0,19)===value.slice(0,19)?at:NaN;
}
const toTime=replayTime;
const kindLabels={news:'新闻/公告',signal:'策略信号',research:'研究判断',plan:'冻结计划',risk:'风控事实',fill:'模拟成交','manual-plan':'本人建议','manual-fill':'本人实录','manual-review':'本人复盘/纠错'};
const seriesLabels={stock:'个股',sector:'板块',index:'指数'};
const colors={stock:'#ff78ae',sector:'#b59aff',index:'#68d4df'};
const safe=(v)=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
function facts(items){return h('dl',{class:'fy-facts'},items.map(([k,v])=>h('div',{},h('dt',{},k),h('dd',{},text(v)))));}
function details(label,...children){return h('details',{class:'fy-details'},h('summary',{},label),children);}
function select(options,selected,aria){
 const node=h('select',{'aria-label':aria},options.map(([v,l])=>h('option',{value:String(v)},l)));
 node.value=String(selected??options[0]?.[0]??'');return node;
}
function noWrite(value){return value?.researchOnly===true&&value.canTrade===false&&value.canNotify===false&&value.accountMutated===false&&value.productionWeightsChanged===false;}
async function get(ctx,query,signal=ctx.signal){const response=await ctx.api(endpoint+'?'+new URLSearchParams(query),{signal,timeoutMs:55000});
 if(!response.ok||!noWrite(response.result))throw Error('研究证据响应未通过只读合同');return response.result;}
function refs(values){return arr(values).join('、')||'未提供具体引用';}
function scalarDetails(value,depth=0){
 if(value==null)return '未知';if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return text(value);
 if(depth>=3)return '详细记录见原档案';if(Array.isArray(value))return value.length?value.slice(0,30).map(v=>scalarDetails(v,depth+1)).join('；'):'未提供';
 return Object.entries(value).filter(([k])=>!/token|secret|password|credential|cookie|url/i.test(k)).slice(0,30).map(([k,v])=>k+'：'+scalarDetails(v,depth+1)).join('；');
}
const labels={title:'标题',status:'证据状态',type:'类型',sourceEventId:'源事件编号',sourceRevisionId:'源版本',originalPublishedAt:'原发布时间',receivedAt:'接收时间',revisedAt:'修订时间',bodyScope:'正文范围',associated:'当前版本关联',securities:'证券',subject:'主体证券',industry:'行业归属',effectiveAt:'生效时点',note:'说明',day:'交易日',tradeDate:'交易日',decisionId:'原决策编号',entryMin:'冻结买入下界',entryMax:'冻结买入上界',stop:'冻结止损',target:'冻结目标',maxPosition:'冻结仓位上限',planId:'计划引用',side:'方向',price:'原成交价',quantity:'数量',account:'原模拟账户',reportHash:'日报指纹',reason:'原依据',availability:'原可成交状态',observedAt:'观察时点',version:'策略版本',archiveHash:'归档指纹',missing:'证据缺失',systems:'原策略判断',runId:'研究版本'};
Object.assign(labels,{current:'截点当前版本',supportStatus:'研究支持状态',supersedes:'被替代版本引用',eligibleForResearchSupport:'可交原研究流程核验'});
const supportLabels={superseded:'已被后续版本替代','security-removed':'证券关联已移除',retracted:'已撤稿',unknown:'证据不足','source-declared-unverified':'来源声明，尚未独立核实'};
const eventValue=(key,value)=>key==='supportStatus'?(supportLabels[value]||'未知'):['current','associated','eligibleForResearchSupport'].includes(key)?(value===true?'是':value===false?'否':'未知'):
 (/At$/.test(key)&&stamp(value))?dateTime(value):scalarDetails(value);
function showEvent(m,selectedDay){const d=m.detail||{},url=safe(d.url);
 return h('article',{class:'fy-item'},h('strong',{},(kindLabels[m.kind]||m.kind)+' · '+(d.title||d.type||d.side||d.day||'')),
 facts([[d.timeBasis==='archive-receipt'?'归档定位时点（原发生时点未知）':'发生时点（北京时间）',dateTime(m.at)],['首次可知/归档时点',dateTime(m.knownAt)],['原始来源',m.source],['证据引用',m.ref],
  ...(d.timeBasis?[['时点依据',d.timeBasis==='source-declared'?'来源声明原时点':'原发生时点未知，仅按归档定位']]:[]),
  ...Object.entries(d).filter(([k])=>!['url','bodyExcerpt','title','timeBasis'].includes(k)).map(([k,v])=>[labels[k]||k,eventValue(k,v)])]),
 selectedDay&&day(m.at)!==selectedDay?h('p',{class:'fy-muted'},'原发生日在可见回放窗口之外，本标记按归档日定位。'):null,
 d.bodyExcerpt?h('p',{},'原文节选：'+d.bodyExcerpt):null,url?h('a',{href:url,target:'_blank',rel:'noopener noreferrer'},'查看原始来源'):null);
}
const markerDay=(m,dates)=>dates.has(day(m.at))?day(m.at):day(m.knownAt);
function svgEl(name,attrs={},label){const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(label!==undefined)n.textContent=label;return n;}
// Keep gaps visible: only connect adjacent returned calendar slots with
// points from a single series. Do not interpolate, rebase or fill unknowns.
export function plotReplay(rows,markers,enabled,onSelect,availableWidth=720){
 const width=Math.max(160,Math.min(720,finite(availableWidth)?availableWidth:720));
 const chart=svgEl('svg',{viewBox:'0 0 '+width+' 220',role:'img','aria-label':'个股板块指数同期价格变动与事件时间轴',width:'100%',height:'220'});
 const dates=new Set(rows.map(r=>r.date));
 const series=Object.keys(seriesLabels).filter(k=>enabled.has(k));
 const points=rows.flatMap(r=>series.map(k=>r[k]?.value).filter(finite));
 const max=Math.max(1,...points.map(Math.abs)),lo=-max,hi=max;
 const left=48,right=width-16,top=20,bottom=155,x=i=>left+i*(right-left)/Math.max(1,rows.length-1),y=v=>bottom-(v-lo)*(bottom-top)/(hi-lo);
 for(const v of [-max,0,max]){chart.append(svgEl('line',{x1:left,y1:y(v),x2:right,y2:y(v),stroke:'currentColor','stroke-opacity':v===0?.45:.16}),
  svgEl('text',{x:left-5,y:y(v)+4,'font-size':11,'text-anchor':'end',fill:'currentColor'},format(v,1)+'%'));}
 for(const k of series){
  let prev=null;
  for(const [i,r]of rows.entries()){
   const p=r[k];if(!finite(p?.value)){prev=null;continue;}
   const cx=x(i),cy=y(p.value);
   if(prev&&prev.i===i-1&&prev.p.source===p.source&&prev.p.kind===p.kind&&validHash(p.seriesIdentity)&&prev.p.seriesIdentity===p.seriesIdentity)chart.append(svgEl('line',{x1:prev.x,y1:prev.y,x2:cx,y2:cy,stroke:colors[k],'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
   const dot=svgEl('circle',{cx,cy,r:3.4,fill:colors[k]});
   dot.append(svgEl('title',{},r.date+' '+seriesLabels[k]+' '+format(p.value,2)+'% · '+p.source+' · '+(p.identity?.code||'身份未提供')+' · '+dateTime(p.knownAt)));chart.append(dot);
   prev={i,x:cx,y:cy,p};
  }
 }
 let lastLabel=-Infinity;
 for(const [i,r]of rows.entries()){
  if(i===0||i===rows.length-1||x(i)-lastLabel>=60&&right-x(i)>=60){chart.append(svgEl('text',{x:x(i),y:214,'text-anchor':i===0?'start':i===rows.length-1?'end':'middle','font-size':11,fill:'currentColor'},r.date.slice(5)));lastLabel=x(i);}
  const events=markers.filter(m=>markerDay(m,dates)===r.date);
  if(!events.length)continue;
  const dot=svgEl('circle',{cx:x(i),cy:181,r:events.length>1?7:5,fill:'#ffd284',stroke:'#251a31','stroke-width':1,tabindex:'0',role:'button','aria-label':r.date+' · '+events.length+' 个证据标记'});
  dot.addEventListener('click',()=>onSelect(r.date));dot.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(r.date);}});
  dot.append(svgEl('title',{},r.date+' · '+events.length+' 个证据标记'));chart.append(dot);
 }
 return chart;
}
function replayResultValid(r,symbol,cutoff){
 return noWrite(r)&&r.protocol==='fayo-evidence-replay-v1'&&r.symbol===symbol&&r.asOf===cutoff&&
  ['historical-readonly'].includes(r.scope)&&Array.isArray(r.rows)&&r.rows.length<=30&&r.rows.every((x,i)=>/^\d{4}-\d\d-\d\d$/.test(x.date)&&(!i||x.date>r.rows[i-1].date)&&x.date<=day(cutoff)&&
    ['stock','sector','index','close'].every(k=>!x[k]||finite(x[k].value)&&stamp(x[k].knownAt)&&x[k].knownAt<=cutoff&&typeof x[k].source==='string'&&validHash(x[k].ref)))&&
  Array.isArray(r.markers)&&r.markers.length<=500&&r.markers.every(m=>stamp(m.at)&&stamp(m.knownAt)&&m.at<=m.knownAt&&m.knownAt<=cutoff&&typeof m.ref==='string'&&noWrite(m));
}
export function createResearchReplay(ctx,{symbol='',runId=null,asOf=null,signal=ctx.signal,memory=null}={}){
 const candidate=memory?.replayContext,saved=!code(symbol)||candidate?.symbol===symbol?candidate:null;
 const initial=code(symbol)?symbol:saved?.symbol||'';
 const stock=h('input',{type:'text',inputmode:'numeric',maxlength:'6','aria-label':'回放证券代码',value:initial,disabled:!!symbol});
 const at=h('input',{type:'datetime-local',step:'0.001','aria-label':'回放截点 北京时间',value:asOf?beijing(asOf):saved?.cutoff||''});
 // Preserve millisecond cutoff when the selected archive is opened without editing.
 let pinned=stamp(asOf),boardValue=saved?.symbol===initial?saved.board||'':'',data=null,turn=0,request=null,selectedDay=null;
 const window=select([[7,'7 日'],[14,'14 日'],[30,'30 日']],saved?.window||14,'回放窗口');
 const board=select([['','默认已归档板块']],boardValue,'回放板块');
 const display=h('div',{class:'fy-stack','aria-live':'polite'}),status=h('p',{class:'fy-note',role:'status'},'尚未读取历史档案。不会重新采集行情或使用回放价格下单。');
 const enabled=new Set(['stock','sector','index']),toggleBar=h('div',{class:'fy-inline'}),toggleButtons=new Map();
 const zoom=h('input',{type:'range',min:2,max:14,step:1,value:14,'aria-label':'缩放可见日期范围'});
 const zoomText=h('small',{class:'fy-muted'});
 const loadButton=button('读取联动回放',()=>load(),'primary');
 const selected=h('div',{class:'fy-stack','aria-live':'polite'});
 const host=section('证据联动与决策回放','按北京时间、原始来源和实际归档截点读取；所有价格均为历史研究，禁止用于当前执行。',
   h('div',{class:'fy-grid'},field('证券代码',stock),field('回放截点',at),field('日期窗口',window),field('同期板块',board)),
   h('div',{class:'fy-inline'},loadButton,button('返回当前时点',()=>{pinned=null;at.value='';invalidate();},'quiet')),status,toggleBar,
   field('缩放可见窗口',zoom),zoomText,display,selected);
 host.dataset.evidenceReplay='true';
 if(ctx.role!=='edit'){loadButton.disabled=true;status.textContent='私有历史证据需要已授权编辑身份。';return host;}
 function invalidated(){return signal?.aborted||ctx.role!=='edit';}
 function invalidate(){
  turn++;request?.abort();data=null;display.replaceChildren();selected.replaceChildren();selectedDay=null;loadButton.disabled=false;
  status.textContent='条件已改变，请重新读取；旧股票和旧日期的响应不会覆盖当前视图。';
 }
 // Keep navigation preferences, never private evidence or execution prices.
 // A return visit must reread and match the original archive before restoring.
 function remember(){
  if(memory&&data)memory.replayContext={symbol:data.symbol,cutoff:beijing(data.asOf),window:Number(window.value),board:boardValue,
   runId:data.runId,zoom:Number(zoom.value),selectedDay,enabled:[...enabled]};
 }
 function paintEvents(date){
  selectedDay=date;const dates=new Set(visibleRows().map(r=>r.date)),found=arr(data?.markers).filter(m=>markerDay(m,dates)===date);
  selected.replaceChildren(h('h3',{},date+' · '+found.length+' 条原档案标记'),...found.slice(0,100).map(m=>showEvent(m,date)));
  remember();
 }
 function visibleRows(){return data.rows.slice(-Math.max(2,Math.min(data.rows.length,Number(zoom.value)||data.rows.length)));}
 function paint(){
  if(!data||invalidated())return;
  const visible=visibleRows(),dates=new Set(visible.map(r=>r.date));
  zoomText.textContent=visible.length?'可见 '+visible[0].date+' 至 '+visible.at(-1).date:'无日期记录';
  const days=visible.filter(r=>arr(data.markers).some(m=>markerDay(m,dates)===r.date));
  display.replaceChildren(plotReplay(visible,data.markers,enabled,paintEvents,display.clientWidth||720),
   h('p',{class:'fy-muted'},'粉色：个股 · 紫色：板块 · 青色：指数 · 黄色：事件。证券、分类或计算口径变化处断开；各自来源的涨幅不自动等于超额收益。'),
   ...arr(data.missing).map(s=>h('small',{class:'fy-muted'},s)),
   h('div',{class:'fy-inline'},days.map(r=>button(r.date+' 证据',()=>paintEvents(r.date),'quiet'))),
   details('逐日数值、数据源与原始时点',...visible.map(r=>details(r.date+' · '+(r.comparison==='same-window'?'同窗口':'非完整同口径'),
     ...['stock','sector','index','close'].map(k=>facts([[seriesLabels[k]||'未复权收盘价',r[k]?format(r[k].value,2)+(k==='close'?' 元':'%'):'未知'],['来源',r[k]?.source],['证券与口径',scalarDetails(r[k]?.identity)],['已知时点',r[k]?dateTime(r[k].knownAt):'未知'],['原研究引用',r[k]?.ref]]))))));
  if(selectedDay&&visible.some(r=>r.date===selectedDay))paintEvents(selectedDay);
  else{selectedDay=null;selected.replaceChildren();}
  remember();
 }
 for(const [key,label]of Object.entries(seriesLabels)){
  const b=button(label,()=>{if(enabled.has(key)&&enabled.size>1)enabled.delete(key);else enabled.add(key);b.setAttribute('aria-pressed',String(enabled.has(key)));paint();},'quiet');
  b.setAttribute('aria-pressed','true');toggleButtons.set(key,b);toggleBar.append(b);
 }
 zoom.addEventListener('input',paint);
 at.addEventListener('input',()=>{pinned=null;invalidate();});stock.addEventListener('input',()=>{boardValue='';pinned=null;invalidate();});
 window.addEventListener('change',()=>{if(data)load();else invalidate();});board.addEventListener('change',()=>{boardValue=board.value;load();});
 signal?.addEventListener('abort',()=>{invalidate();status.textContent='研究视图已关闭';},{once:true});
 if(signal){globalThis.addEventListener('offline',()=>{invalidate();status.textContent='连接已离线，私有回放已清空，请重新读取。';},{signal});globalThis.addEventListener('resize',paint,{signal});}
 async function load(){
  const requested=stock.value.trim(),cutoff=pinned??toTime(at.value),w=Number(window.value),id=++turn;
  const prior=memory?.replayContext;
  request?.abort();request=new AbortController();const controller=request;
  if(invalidated()||!code(requested)||!stamp(cutoff)||cutoff>Date.now()){status.textContent='需要有效证券代码及不晚于现在的北京时间截点';return;}
  if(signal?.aborted)return;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  loadButton.disabled=true;display.replaceChildren();selected.replaceChildren();data=null;status.textContent='核对既有封存行情与证据…';
  try{
   const query={mode:'replay',symbol:requested,asOf:String(cutoff),window:String(w),...(validHash(runId)&&pinned&&pinned===asOf?{runId}:{}),...(boardValue?{board:boardValue}:{})};
   const r=await get(ctx,query,controller.signal);
   if(id!==turn||controller.signal.aborted||invalidated())return;
   if(!replayResultValid(r,requested,cutoff)||query.runId&&r.runId!==query.runId||query.board&&r.selectedBoard?.code!==query.board)
    throw Error('回放结果身份、封存版本、板块或首次可知时点不一致');
   data=r;board.replaceChildren(h('option',{value:''},'默认已归档板块'),...arr(r.boards).map(b=>h('option',{value:b.code},b.name||b.code)));
   boardValue=r.selectedBoard?.code||'';board.value=boardValue;zoom.max=String(Math.max(2,r.rows.length));
   const restore=prior?.symbol===requested&&toTime(prior.cutoff)===cutoff&&prior.window===w&&prior.board===boardValue&&prior.runId===r.runId;
   zoom.value=String(restore&&Number.isInteger(prior.zoom)?Math.max(2,Math.min(Number(zoom.max),prior.zoom)):Number(zoom.max));
   selectedDay=restore&&typeof prior.selectedDay==='string'?prior.selectedDay:null;
   if(restore&&Array.isArray(prior.enabled)&&prior.enabled.some(k=>Object.hasOwn(seriesLabels,k))){
    enabled.clear();for(const k of prior.enabled)if(Object.hasOwn(seriesLabels,k))enabled.add(k);
    for(const [k,b]of toggleButtons)b.setAttribute('aria-pressed',String(enabled.has(k)));
   }
   status.textContent='历史只读 · 截点 '+dateTime(cutoff)+' · '+requested+' · '+(r.runId||'尚无研究版本');
   paint();
  }catch(error){if(id===turn&&!controller.signal.aborted&&!invalidated())status.textContent='回放未就绪：'+error.message;}
  finally{signal?.removeEventListener('abort',abort);if(id===turn&&!invalidated())loadButton.disabled=false;}
 }
 return host;
}
export function createModelTools(ctx,{run,asOf,question,alive=()=>true}={}){
 const output=h('div',{class:'fy-stack','aria-live':'polite'}),status=h('p',{class:'fy-muted'},'规则解释不依赖模型；外部模型状态未读取。');
 const valid=()=>alive()&&!ctx.signal?.aborted&&ctx.role==='edit';
 let turn=0,requested=null,request=null;
 function begin(){request?.abort();request=new AbortController();modeButton.disabled=true;modelButton.disabled=true;return {id:++turn,controller:request};}
 function finish(id){if(id===turn){modeButton.disabled=!valid();modelButton.disabled=!valid();}}
 const modeButton=button('检查模型配置',async()=>{
  if(!valid()||modeButton.disabled)return;
  const {id,controller}=begin();output.replaceChildren();
  try{const r=await get(ctx,{mode:'model-status'},controller.signal);if(!valid()||id!==turn||controller.signal.aborted)return;status.textContent=r.configured?'已配置 '+r.model+'；尚未调用，真实可用性待核验':r.reason||'模型未配置';}
  catch(error){if(valid()&&id===turn&&!controller.signal.aborted)status.textContent=error.message;}
  finally{finish(id);}
 },'quiet');
 const modelButton=button('明确调用已授权模型',async()=>{
  const q=question?.();if(!valid()||modelButton.disabled||!q||!validHash(run?.id)||!stamp(asOf)){status.textContent='请先选择一个问题与封存版本，并核对编辑权限';return;}
  const {id,controller}=begin();requested=q;output.replaceChildren();status.textContent='正在请求已明确配置的研究模型，原规则解释继续保留…';
  try{
   const response=await ctx.api(endpoint,{method:'POST',body:{action:'explain',symbol:run.symbol,runId:run.id,asOf,question:q},signal:controller.signal,timeoutMs:25000}),r=response.result;
   if(!valid()||id!==turn||controller.signal.aborted||requested!==question?.())return;
   if(!response.ok||!noWrite(r)||r.symbol!==run.symbol||r.runId!==run.id||r.asOf!==asOf||r.question!==q)throw Error('模型回执身份或时点不一致');
   if(r.status==='completed'&&(r.modelCalled!==true||typeof r.model!=='string'||!r.model.trim()||typeof r.answer!=='string'||!r.answer.trim()||!Array.isArray(r.citations)||!r.citations.length))
    throw Error('模型回执缺少实际调用、模型标识、回答或条件引用');
   status.textContent=r.status==='completed'?'实际模型 '+r.model+' · 模型生成内容（未独立核实）':(r.reason||'模型未就绪')+(r.model?' · '+r.model:'');
   if(r.status==='completed'&&r.modelCalled===true&&typeof r.answer==='string')output.replaceChildren(h('p',{},r.answer),
    ...arr(r.citations).map(c=>details(c.id+' · '+c.rule,facts([['原策略版本',c.version],...(c.ruleId?[['原条件引用',c.ruleId]]:[])]),
     ['missing','incomplete'].includes(c.evidenceStatus)||!arr(c.refs).length?note(c.missingReason||'此条件缺少可核对原始证据；引用的是原条件，不能当作已核实事实。'):null,
     ...arr(c.refs).map(e=>facts([['原证据引用',e.ref],['来源',e.source],['已知时点',dateTime(e.knownAt)]])))));
  }catch(error){if(valid()&&id===turn&&!controller.signal.aborted)status.textContent='模型调用失败；保留原规则解释。'+error.message;}
  finally{finish(id);}
 },'quiet');
 modeButton.disabled=ctx.role!=='edit';modelButton.disabled=ctx.role!=='edit';
 ctx.signal?.addEventListener('abort',()=>{turn++;request?.abort();output.replaceChildren();finish(turn);status.textContent='研究视图已关闭';},{once:true});
 return {node:h('div',{class:'fy-stack'},h('div',{class:'fy-inline'},modeButton,modelButton),status,output),
  reset(){turn++;requested=null;request?.abort();output.replaceChildren();finish(turn);status.textContent='已切换问题，旧模型响应不会替换当前规则解释。';}};
}
export async function similarEvidence(ctx,{run,asOf,signal=ctx.signal}={}){
 if(ctx.role!=='edit'||signal?.aborted)throw Error('研究编辑权限已失效');
 if(!validHash(run?.id)||!code(run?.symbol)||!stamp(asOf))throw Error('原研究身份不足');
 const r=await get(ctx,{mode:'similar',symbol:run.symbol,runId:run.id,asOf:String(asOf)},signal);
 if(r.runId!==run.id||r.symbol!==run.symbol||r.asOf!==asOf)throw Error('历史样本身份不一致');
 return h('div',{class:'fy-stack'},note(r.reason),r.similarCases?.reason?note(r.similarCases.reason):null,...arr(r.groups).map(g=>details(g.system+' / '+g.horizon+' 日 · '+g.status,
  facts([['策略版本',g.version],['相同条件签名',g.conditionSignature],['市场分组',g.regime],['来源',g.provider],['匹配研究数',g.matchedRuns],['成熟结果',g.matured],['具备成本估计',g.modeled],['独立信号日',g.independentDays],['独立股票数',g.distinctSymbols],['非重叠窗口',g.nonOverlappingWindows],['成本后平均变化',g.averageNetReturnPct==null?'未知':format(g.averageNetReturnPct,2)+'%'],['正收益样本比例（非个股概率）',g.positiveFractionPct==null?'未知':format(g.positiveFractionPct,2)+'%']]),
  ...arr(g.samples).map(x=>details(x.symbol+' · '+x.signalDate+' · '+x.status,facts([['原信号版本',x.runId],['信号归档',dateTime(x.signalRecordedAt)],['后续入场日',x.entryDate],['后续离场日',x.exitDate],['入场档案',x.entryOutcomeRunId],['离场档案',x.exitOutcomeRunId],['入场可知时点',dateTime(x.entryOutcomeRecordedAt)],['离场可知时点',dateTime(x.exitOutcomeRecordedAt)],['成本后估计',x.netReturnPct]]))))));
}
const nextPlanScope='read-archive-window-same-account-source-symbol';
const nextPlanNote='仅在已读取原档案范围核对后续计划，不认证完整交易覆盖；保留原日事实，不证明用户看过建议或习惯改善。';
function nextPlanDetails(original,asOf){
 const next=original.nextPlanCheck,nonempty=v=>typeof v==='string'&&!!v.trim();
 const panel=(status,label,...content)=>{const node=details('后续计划核对 · '+label,...content,note(nextPlanNote));node.dataset.nextPlanCheck=status;return node;};
 const unavailable=reason=>panel('not-ready','未就绪',note(reason||'尚未取得可核对的后续计划原记录。'));
 if(!next||next.status==='not-ready')return unavailable(next?.reason);
 // A valid archive lookup may have no next plan yet. Preserve that bounded
 // coverage result without treating null candidate fields as corrupt identity.
 const noSelectedPlan=['planId','planVersion','planFrozenAt','knownAt','date','ref'].every(k=>next[k]===null)&&
  Array.isArray(next.refs)&&next.refs.length===0&&next.evidence===null;
 const originalBound=next.scope===nextPlanScope&&['pool','pre'].includes(original.accountId)&&next.accountId===original.accountId&&
  code(original.code)&&next.code===original.code&&nonempty(original.source)&&next.source===original.source&&
  nonempty(original.planId)&&validHash(original.planVersion)&&nonempty(original.ref)&&nonempty(original.rule)&&next.rule===original.rule&&
  nonempty(original.ruleVersion)&&next.ruleVersion===original.ruleVersion&&stamp(asOf)&&stamp(original.planFrozenAt)&&stamp(original.knownAt)&&
  original.planFrozenAt<=original.knownAt&&original.knownAt<=asOf;
 if(next.status==='unknown'&&noSelectedPlan&&originalBound&&nonempty(next.reason))return panel('unknown','证据不足',note(next.reason));
 // Validate only the identity and chronology of the backend's original fact.
 // A different plan never rewrites the original incident or same-plan followup.
 const bound=next.scope===nextPlanScope&&['pool','pre'].includes(original.accountId)&&next.accountId===original.accountId&&
  code(original.code)&&next.code===original.code&&nonempty(original.source)&&next.source===original.source&&
  nonempty(original.planId)&&nonempty(next.planId)&&next.planId!==original.planId&&validHash(original.planVersion)&&validHash(next.planVersion)&&
  nonempty(original.rule)&&next.rule===original.rule&&nonempty(original.ruleVersion)&&nonempty(next.ruleVersion)&&
  stamp(asOf)&&stamp(original.knownAt)&&stamp(original.planFrozenAt)&&original.planFrozenAt<=original.knownAt&&
  stamp(next.planFrozenAt)&&stamp(next.knownAt)&&original.knownAt<next.planFrozenAt&&next.planFrozenAt<=next.knownAt&&next.knownAt<=asOf;
 if(!bound)return unavailable('后续计划的账户、证券、来源、版本或可知时点未通过核对；原记录继续保留。');
 const identity=[['同一原账户',next.accountId],['证券',next.code],['来源',next.source],['后续计划',next.planId],['后续计划版本',next.planVersion],
  ['冻结时点',dateTime(next.planFrozenAt)],['规则',next.rule],['后续规则版本',next.ruleVersion],['核验日期',next.date],['首次可知时点',dateTime(next.knownAt)]];
 if(next.status==='unknown')return panel('unknown','证据不足',facts(identity),note(next.reason||'后续计划证据或规则版本不足，不能判定是否符合原规则。'));
 if(next.status!=='observed'||next.ruleVersion!==original.ruleVersion||!['后续计划原核验符合','后续计划原核验再次触发'].includes(next.label)||
  !nonempty(next.ref)||!Array.isArray(next.refs)||!next.refs.length||next.refs.some(v=>!nonempty(v))||!nonempty(next.evidence))
  return unavailable('后续计划的规则版本、原核验结论或证据引用未通过核对；原记录继续保留。');
 return panel('observed',next.label,facts([...identity,['后续原记录',next.ref],['原证据引用',refs(next.refs)],['原核验依据',next.evidence]]));
}
export function createDisciplineWorkbench(ctx,{symbol='',memory=null}={}){
 const stock=h('input',{type:'text',inputmode:'numeric',maxlength:'6',value:code(symbol)?symbol:'','aria-label':'纪律复盘证券代码'});
 const status=h('p',{class:'fy-note',role:'status'},'主动读取既有结算、手工日志及执行日报，不写账本。');
 const result=h('div',{class:'fy-stack','aria-live':'polite'});let turn=0;
 const buttonRead=button('读取个人纪律与后续落实',async()=>{
  if(ctx.role!=='edit'||ctx.signal?.aborted)return;
  const id=++turn,requested=stock.value.trim(),cutoff=Date.now();buttonRead.disabled=true;result.replaceChildren();
  try{
   if(requested&&!code(requested))throw Error('请输入六位代码或留空查看全部');
   const r=await get(ctx,{mode:'discipline',asOf:String(cutoff),...(requested?{symbol:requested}:{})});
   if(id!==turn||ctx.signal?.aborted||ctx.role!=='edit')return;
   if(r.asOf!==cutoff||r.symbol!==(requested||null)||arr(r.rows).some(x=>requested&&x.code!==requested))throw Error('纪律证据与所选证券/时点不一致');
   status.textContent='原档案 '+arr(r.rows).length+(Number.isSafeInteger(r.rowTotal)&&r.rowTotal>arr(r.rows).length?' / '+r.rowTotal:'')+' 项核验 · '+dateTime(cutoff);
   result.replaceChildren(note(r.scope),...arr(r.missing).map(x=>h('small',{class:'fy-muted'},x)),
    h('h3',{},'下一次可核对的改进事项'),...arr(r.followups).map(f=>details(f.code+' · '+f.date+' · '+f.rule+' · '+(f.followup?.status||'待后续证据'),facts([['原记录',f.ref],['原计划',f.planId],['计划版本',f.planVersion],['规则版本',f.ruleVersion],['原结论',f.status],['原依据',f.evidence],['原证据引用',refs(f.refs)],['下次核对',f.nextCheck],['后续日期',f.followup?.date],['后续计划',f.followup?.planId],['后续计划版本',f.followup?.planVersion],['后续引用',f.followup?.ref],['后续证据',f.followup?.evidence],['后续含义',f.followup?.note]]),nextPlanDetails(f,r.asOf))),
    details('全部纪律事实（原记录）',...arr(r.rows).map(f=>details(f.code+' · '+f.date+' · '+f.rule+' · '+f.status,facts([['来源',f.source],['原计划',f.planId],['计划版本',f.planVersion],['规则版本',f.ruleVersion],['原记录',f.ref],['原依据',f.evidence],['归因',f.attribution],['证据引用',refs(f.refs)]])))));
  }catch(error){if(id===turn&&!ctx.signal?.aborted)status.textContent='纪律复盘未就绪：'+error.message;}
  finally{if(id===turn&&!ctx.signal?.aborted)buttonRead.disabled=false;}
 },'primary');
 buttonRead.disabled=ctx.role!=='edit';
 stock.addEventListener('input',()=>{turn++;result.replaceChildren();buttonRead.disabled=ctx.role!=='edit';status.textContent='条件已变化，重新读取。';});
 ctx.signal?.addEventListener('abort',()=>{turn++;result.replaceChildren();},{once:true});
 return details('个人纪律与改进跟踪',field('证券（留空查看全部）',stock),buttonRead,status,result);
}
