import {h,button,section,note,dateTime,format} from './ui.js';
const arr=v=>Array.isArray(v)?v:[];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const val=v=>v===null||v===undefined||v===''?'未知':String(v);
const stamp=v=>Number.isSafeInteger(v)&&v>0?dateTime(v):'未知';
const dayOK=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const colors=['#e568b6','#9b87f5','#45b8a0','#e7a74f','#77a9f4','#cf8fe3','#b6b6c8'];
const facts=rows=>h('dl',{class:'fy-facts'},...rows.map(([k,v])=>h('div',{},h('dt',{},k),h('dd',{},val(v)))));
const details=(label,...children)=>h('details',{class:'fy-details'},h('summary',{},label),...children);
function opt(value,label){return h('option',{value},label);}
function replayChart(data,windowSize,chosen,select){
 const dates=data.days.slice(-windowSize),tracks=arr(data.series);
 const figure=h('div',{class:'fy-stack','data-replay-chart':true});
 if(!dates.length)return note('没有可绘制日期。');
 const values=tracks.flatMap(track=>arr(track.points).filter(p=>dates.includes(p.date)&&finite(p.value)).map(p=>p.value));
 const lo=Math.min(0,...values),hi=Math.max(0,...values),span=hi-lo||1;
 const x=i=>40+i*520/Math.max(1,dates.length-1),y=v=>28+(hi-v)*145/span;
 const node=svg('svg',{viewBox:'0 0 600 210',width:'100%',role:'img','aria-label':'历史个股、板块与指数同交易日涨跌幅，缺数断线'});
 node.append(svg('line',{x1:40,y1:y(0),x2:560,y2:y(0),stroke:'currentColor','stroke-opacity':'.4','stroke-dasharray':'4 4'}));
 const label=(x,y,t)=>{const a=svg('text',{x,y,fill:'currentColor','font-size':'11'});a.textContent=t;node.append(a);};
 label(4,24,format(hi,1)+'%');label(4,175,format(lo,1)+'%');label(40,205,dates[0].slice(5));label(525,205,dates.at(-1).slice(5));
 tracks.forEach((track,i)=>{
  const by=new Map(arr(track.points).map(p=>[p.date,p]));let last=null;
  dates.forEach((date,j)=>{
   const p=by.get(date);if(!finite(p?.value)){last=null;return;}
   const point=[x(j),y(p.value)];
   if(last)node.append(svg('line',{x1:last[0],y1:last[1],x2:point[0],y2:point[1],stroke:colors[i%colors.length],'stroke-width':2.4}));
   node.append(svg('circle',{cx:point[0],cy:point[1],r:2.5,fill:colors[i%colors.length]}));last=point;
  });
 });
 const markerDays=new Set(arr(data.markers).map(m=>m.date));
 for(const [i,date]of dates.entries()){
  if(markerDays.has(date))node.append(svg('circle',{cx:x(i),cy:185,r:4,fill:'#e568b6'}));
  if(chosen===date)node.append(svg('line',{x1:x(i),y1:14,x2:x(i),y2:193,stroke:'currentColor','stroke-opacity':'.65','stroke-dasharray':'3 3'}));
 }
 figure.append(node);
 figure.append(h('div',{class:'fy-inline'},...tracks.map((track,i)=>h('span',{},h('span',{style:'color:'+colors[i%colors.length]},'● '),track.label,' · ',track.source||'来源未知'))));
 figure.append(h('div',{class:'fy-toolbar'},...dates.filter((_,i)=>dates.length<=10||i===0||i===dates.length-1||markerDays.has(dates[i])).map(date=>button(date.slice(5),()=>select(date),date===chosen?'primary':'quiet'))));
 return figure;
}
export function renderReplayPanel(ctx,view){
 const r=view?.selectedRun,root=section('决策证据回放','只读取同股、同日期、实际已封存的历史证据，禁止用于当前下单。');
 if(!r){root.append(note('请先选择封存研究版本。'));return root;}
 const output=h('div',{class:'fy-stack','aria-live':'polite'}),status=h('p',{class:'fy-muted'}),memory=ctx.viewMemory||{};
 const cutoff=h('input',{type:'datetime-local','aria-label':'历史截点（北京时间）'});
 const preciseDefault=Math.min(view.asOf,r.recordedAt);
 cutoff.value=new Date(preciseDefault+28800000).toISOString().slice(0,16);
 let edited=false,turn=0,data=null,chosen='',windowSize=20;
 cutoff.addEventListener('input',()=>{edited=true;turn++;data=null;output.replaceChildren();status.textContent='截点已修改，重新读取。';});
 function draw(){
  output.replaceChildren();if(!data)return;
  const days=arr(data.days),dates=days.slice(-windowSize);if(!dates.includes(chosen))chosen=dates.at(-1)||'';
  const zoom=h('select',{'aria-label':'回放区间'},opt('10','最近10日'),opt('20','最近20日'),opt('40','最近40日'));zoom.value=String(windowSize);
  zoom.addEventListener('change',()=>{windowSize=Number(zoom.value);memory.replayWindow=windowSize;draw();});
  const date=h('select',{'aria-label':'回放日期'},...dates.map(d=>opt(d,d)));date.value=chosen;
  const choose=d=>{chosen=d;memory.replayDay=d;draw();};date.addEventListener('change',()=>choose(date.value));
  output.append(note(data.scope||data.reason||'历史证据尚未就绪'),facts([['证券',data.symbol],['封存版本',data.runId],['历史截点',stamp(data.asOf)],['交易日',data.tradeDate]]));
  if(!days.length){output.append(note(arr(data.missing).join('；')||'缺少封存行情'));return;}
  output.append(h('div',{class:'fy-toolbar'},h('label',{class:'fy-field'},'缩放',zoom),h('label',{class:'fy-field'},'查看日期',date)));
  output.append(replayChart(data,windowSize,chosen,choose));
  for(const s of arr(data.series)){
   const point=arr(s.points).find(p=>p.date===chosen);
   output.append(details(s.label+' · '+(finite(point?.value)?format(point.value,2)+'%':'缺数'),facts([['日期',chosen],['来源',point?.source],['可知时点',stamp(point?.knownAt)],['封存引用',point?.ref]])));
  }
  const markers=arr(data.markers).filter(x=>x.date===chosen);
  const markerDetails=markers.map(x=>details(x.label,facts([['类型',x.kind],['原始时点',stamp(x.at)],['最迟可知时点',stamp(x.knownAt)],['证据引用',x.ref],...Object.entries(x.details||{}).map(([k,v])=>[k,v])])));
  output.append(details('当日证据标记 · '+markers.length,...markerDetails));
  output.append(note(arr(data.missing).join('；')||'只代表返回的封存窗口，非全市场或实时行情。'));
 }
 const load=button('读取历史回放',async()=>{
  const asOf=edited?Date.parse(cutoff.value+':00+08:00'):preciseDefault,request=++turn;
  output.replaceChildren();status.textContent='正在读取原始封存证据…';load.disabled=true;
  try{
   if(!Number.isSafeInteger(asOf)||asOf>view.asOf||asOf<r.recordedAt)throw Error('请选择该研究版本已封存且不晚于当前档案截点的时间。');
   const q=new URLSearchParams({panel:'replay',symbol:r.symbol,runId:r.id,asOf:String(asOf)});
   const reply=await ctx.api('/api/research/workspace?'+q,{signal:ctx.signal,timeoutMs:55000});
   if(ctx.signal?.aborted||request!==turn||root.isConnected===false)return;
   const x=reply.result;if(x?.symbol!==r.symbol||x.runId!==r.id||x.asOf!==asOf||x.canTrade!==false||!Array.isArray(x.days)||x.days.some(d=>!dayOK(d)))throw Error('回放身份或日期不一致');
   data=x;windowSize=[10,20,40].includes(memory.replayWindow)?memory.replayWindow:20;chosen=memory.replayDay||'';draw();status.textContent='原时点回放已读取（只读）';
  }catch(error){if(!ctx.signal?.aborted&&request===turn)status.textContent=error.message||'历史回放未就绪';}
  finally{if(!ctx.signal?.aborted)load.disabled=false;}
 },'primary');
 root.append(h('label',{class:'fy-field'},'北京时间截点（默认封存时刻）',cutoff),load,status,output);return root;
}
export function renderDisciplinePanel(ctx,defaultDay){
 const root=section('个人纪律与改进追踪','仅核对原计划、原模拟账本及人工记录，不用涨跌倒推违规。');
 const date=h('input',{type:'date',value:defaultDay||'','aria-label':'执行复盘日期'}),output=h('div',{class:'fy-stack','aria-live':'polite'}),status=h('p',{class:'fy-muted'});let turn=0;
 date.addEventListener('input',()=>{turn++;output.replaceChildren();status.textContent='日期已切换，请重新读取。';});
 const fact=f=>details(f.rule+' · '+f.status,note(f.evidence),facts([['证据引用',arr(f.refs).join('、')||'未知']]));
 const load=button('核对原纪律记录及后续落实',async()=>{
  const requested=date.value,request=++turn;load.disabled=true;output.replaceChildren();status.textContent='正在读取原始记录…';
  try{
   if(!dayOK(requested))throw Error('请选择复盘日期。');
   const reply=await ctx.api('/api/research/workspace?'+new URLSearchParams({panel:'discipline',date:requested}),{signal:ctx.signal,timeoutMs:55000});
   if(ctx.signal?.aborted||request!==turn||root.isConnected===false||ctx.role!=='edit')return;
   const d=reply.result;if(d?.day!==requested||d.canTrade!==false)throw Error('日报日期或权限不一致');
   output.append(note(d.reason));
   for(const x of arr(d.paper))output.append(details(x.code+' · '+x.rule+' · '+x.status,
    facts([['原计划',x.planId],['日报版本',x.reportVersion],['日报指纹',x.reportHash],['原事实',x.evidence],['改进事项',x.nextCheck],['后续落实',x.followupEvidence?.statusLabel||x.followupEvidence?.reason],['下一计划',x.followupEvidence?.planId],['下一日报',x.followupEvidence?.reportHash],['下一日期',x.followupEvidence?.day]])));
   for(const x of arr(d.manual))output.append(details('人工记录（当前已知） '+x.symbol,facts([['原计划',x.planId],['原复盘',x.reviewId],['对账引用',x.reconciliationId],['来源',x.source]]),...arr(x.facts).map(fact)));
   for(const x of arr(d.settlements))output.append(details('原模拟结算 '+x.symbol,facts([['冻结计划',x.planId],['结算指纹',x.sourceFingerprint],['买入引用',arr(x.entryEventIds).join('、')],['卖出引用',x.exitEventId]]),...arr(x.facts).map(fact)));
   output.append(note(arr(d.missing).join('；')||'未出现记录不等于执行无问题。'));
   status.textContent=d.status==='observed'?'已读取原记录；区分可核对与未知':'该日可核对资料不足';
  }catch(error){if(!ctx.signal?.aborted&&request===turn)status.textContent=error.message||'未就绪';}
  finally{if(!ctx.signal?.aborted)load.disabled=false;}
 },'primary');
 root.append(h('label',{class:'fy-field'},'日报日期',date),load,status,output);return root;
}
