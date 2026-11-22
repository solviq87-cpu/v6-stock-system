import {icon} from './icons.mjs';
import {emotion,marketAsOf,knowledgeCutoff} from './market.mjs';
import {mistakeSummary} from './review.mjs';
import {recoveredMetric,marketPhaseName,observedCoverage,coverageValues,coverageCount,turnoverLabel,closeDistribution} from '../market-evidence.js';
import {archive} from '../data/close-review-20261120.js';
const phase=['冰点','发酵','高潮','分歧','退潮'];
const round=n=>Math.round(n*100)/100;
const val=x=>x!=null?Number(x).toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const safeNumber=x=>typeof x==='number'&&Number.isFinite(x);
function pathLine(points){
 if(!points.length)return '';
 let d='M'+points[0].join(' ');
 for(let i=1;i<points.length;i++){const [x,y]=points[i],p=points[i-1],a=points[Math.max(0,i-2)],b=points[Math.min(points.length-1,i+1)];d+=' C'+[p[0]+(x-a[0])/7,p[1]+(y-a[1])/7,x-(b[0]-p[0])/7,y-(b[1]-p[1])/7,x,y].join(' ')}
 return d
}
function spark(data,color,id){
 if(data.length<2)return '';const min=Math.min(...data),range=Math.max(...data)-min||1;
 const pts=data.map((v,i)=>[round(i*98/(data.length-1)+1),round(25-(v-min)/range*22)]);
 const d=pathLine(pts);return '<svg aria-hidden="true" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><defs><linearGradient id="sp'+id+'" x2="0" y2="1"><stop stop-color="'+color+'" stop-opacity=".22"/><stop offset="1" stop-color="'+color+'" stop-opacity=".01"/></linearGradient></defs><path d="'+d+' L99 30H1Z" fill="url(#sp'+id+')"/><path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.8"/></svg>'
}
function displayTime(ms){return new Date(ms+8*36e5).toISOString().slice(0,16).replace('T',' ');}
const otherMetrics={adv:['上涨家数','家'],dec:['下跌家数','家'],downLimit:['专题池跌停家数','家'],leader:['高标反馈','%'],diffusion:['题材扩散度','%'],premium:['昨日涨停溢价','%'],trend:['全A趋势',''],sh:['上证趋势',''],cy:['创业板趋势',''],theme:['主线题材','']};
const observedMetricKeys=['upLimit','breakRate','height','amount',...Object.keys(otherMetrics)];
export function overviewEvidence(s,requestedDay,now=Date.now()){
 const last=s.market?.at(-1)?.date,recovery=s.marketRecovery,latest=s.v6Observation;
 const currentDay=recovery?.referenceDay||latest?.latestClosedDay||last;
 const date=requestedDay||currentDay||new Date(now+8*36e5).toISOString().slice(0,10);
 const latestView=date===currentDay,cut=latestView?now:Math.min(now,knowledgeCutoff(date));
 const rows=marketAsOf(s,date,cut),metrics={};
 for(const key of observedMetricKeys){
  const publicRow=recoveredMetric(recovery,key,date,cut);
  const archived=rows.flatMap(r=>{
   if(!r.source||r[key]==null||r.knownAt==null&&!r.availableAt)return [];
   const origin=r.fieldSources?.[key];
   const ms=knowledgeCutoff(origin?.knownAt??r.knownAt??r.availableAt);
   const obs=recoveredMetric({metrics:{[key]:{value:r[key],date:r.date,source:origin?.source||r.source,scope:origin?.scope,knownAt:ms}}},key,date,cut);
   return obs?[obs]:[];
  });
  const sorted=[...archived,...(publicRow?[publicRow]:[])].sort((a,b)=>b.date.localeCompare(a.date)||b.knownAt-a.knownAt);
  const current=sorted[0];if(!current)continue;
  const series=archived.filter(r=>r.source===current.source&&r.date<current.date);
  metrics[key]={...current,previous:series.at(-1)||null,series:[...series,current]};
 }
 const provedRows=rows.filter(r=>r.source&&(r.knownAt!=null||r.availableAt));
 const rule=emotion(provedRows,date,cut),publicEmotion=recoveredMetric(recovery,'emotion',date,cut);
 const stage=marketPhaseName(rule.stage)?{value:rule.stage,date,confidence:rule.confidence,source:'多日收盘规则',knownAt:Math.max(...provedRows.slice(-3).map(r=>knowledgeCutoff(r.knownAt??r.availableAt)))}:publicEmotion;
 return {date,cut,rows:provedRows,metrics,stage,rule,coverage:observedCoverage(recovery,date,cut)};
}
function metric(obs,{key,label,unit,color,tone,symbol},esc){
 if(!obs)return '';
 const delta=obs.previous?round(obs.value-obs.previous.value):null,display=key==='amount'?val(round(obs.value/10000)):val(obs.value);
 const compare=delta===null?'':'较 '+esc(obs.previous.date)+' <b>'+(delta>0?'+':'')+val(delta)+(key==='breakRate'?' pp':unit)+'</b>';
 return '<article class="metric"><div class="stat-title"><span class="tile-icon '+tone+'">'+icon(symbol,18)+'</span>'+(key==='amount'?turnoverLabel(obs):label)+'</div><div class="metric-val">'+display+'<span class="unit">'+(key==='amount'?'万亿元':unit)+'</span></div><small>'+(obs.historical?'上次有效 · ':'')+esc(obs.date)+' · '+esc(obs.source)+'</small><small style="display:block">取得 '+esc(displayTime(obs.knownAt))+'</small><div class="stat-bottom"><span class="change">'+compare+'</span>'+spark(obs.series.map(r=>r.value),color,key)+'</div></article>';
}
function chart(ui,windowSize,sourceRows){
 const root=ui.root.querySelector('.plotbox'),rows=sourceRows.slice(-windowSize);
 if(!root)return;
 if(!rows.length){root.innerHTML='<div class="empty">录入多日盘面后展示走势</div>';return}
 const w=680,h=191,left=31,right=13,top=13,bottom=25,base=h-bottom;
 const max=Math.max(40,Math.ceil(Math.max(...rows.map(r=>Math.max(r.upLimit||0,r.downLimit||0)))/4/5)*20);
 const x=i=>round(left+(w-left-right)*i/(rows.length-1||1)),y=v=>round(base-v/max*(base-top));
 let svg='<defs><linearGradient id="linefill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#a294f5" stop-opacity=".38"/><stop offset="1" stop-color="#b7aaf9" stop-opacity=".025"/></linearGradient><linearGradient id="mintfill" x2="0" y2="1"><stop stop-color="#91d6c3" stop-opacity=".22"/><stop offset="1" stop-color="#b7ebda" stop-opacity=".02"/></linearGradient></defs>';
 for(let i=0;i<5;i++){const v=max*i/4;svg+='<path d="M'+left+' '+y(v)+'H'+(w-right)+'" stroke="#e7e9f0" stroke-dasharray="4 5"/><text x="'+(left-10)+'" y="'+(y(v)+4)+'" text-anchor="end" fill="#8c93a4" font-size="12">'+v+'</text>'}
 for(const [key,color,id] of [['upLimit','#7864db','linefill'],['downLimit','#58b99f','mintfill']]){
 const fragments=[];let pts=[];for(let i=0;i<rows.length;i++){const v=rows[i][key];if(safeNumber(v))pts.push([x(i),y(v)]);else if(pts.length){fragments.push(pts);pts=[]}}if(pts.length)fragments.push(pts);
 for(const p of fragments){const d=pathLine(p);svg+='<path d="'+d+' L'+p.at(-1)[0]+' '+base+'H'+p[0][0]+'Z" fill="url(#'+id+')"/><path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2.8" vector-effect="non-scaling-stroke"/>';const last=p.at(-1);svg+='<circle cx="'+last[0]+'" cy="'+last[1]+'" r="3.2" fill="'+color+'" stroke="white" stroke-width="1.5"/>'}}
 const ticks=Math.min(7,rows.length);for(let j=0;j<ticks;j++){const i=Math.round(j*(rows.length-1)/(ticks-1||1));svg+='<text x="'+x(i)+'" y="'+(h-3)+'" text-anchor="'+(j===ticks-1?'end':j===0?'start':'middle')+'" fill="#8b93a7" font-size="12">'+ui.esc(rows[i].date.slice(5).replace('-','/'))+'</text>'}
 root.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="最近'+rows.length+'个交易日的涨停和跌停家数">'+svg+'<line class="crosshair" visibility="hidden" y1="'+top+'" y2="'+base+'" stroke="#b2a6da" stroke-dasharray="3 3"/></svg><div hidden class="plot-tip"></div>';
 root.onpointermove=e=>{const r=root.getBoundingClientRect(),i=Math.min(rows.length-1,Math.max(0,Math.round(((e.clientX-r.left)/r.width*w-left)/(w-left-right)*(rows.length-1))));const p=rows[i],line=root.querySelector('.crosshair'),t=root.lastChild;line.setAttribute('visibility','visible');line.setAttribute('x1',x(i));line.setAttribute('x2',x(i));t.hidden=false;t.style.left=Math.max(0,Math.min(r.width-145,x(i)*r.width/w+9))+'px';t.style.top='6px';t.textContent=p.date+'\n涨停 '+val(p.upLimit)+' 家 · 跌停 '+val(p.downLimit)+' 家'};
 root.onpointerleave=()=>{root.lastChild.hidden=true;root.querySelector('.crosshair')?.setAttribute('visibility','hidden')};
}
function gauge(em,label){const p=em.confidence/100;let ticks='';for(let i=0;i<23;i++){const a=Math.PI*(1-i/22),rad=i%2?74:71;ticks+='<line x1="'+(112+79*Math.cos(a))+'" y1="'+(105-79*Math.sin(a))+'" x2="'+(112+rad*Math.cos(a))+'" y2="'+(105-rad*Math.sin(a))+'" stroke="#d0cbeb" stroke-width="1.3"/>'}
 return '<div class="gauge"><svg viewBox="0 0 224 116"><defs><linearGradient id="arc"><stop stop-color="#d8d1ff"/><stop offset=".45" stop-color="#a49aef"/><stop offset="1" stop-color="#6756cb"/></linearGradient></defs><path d="M18 105 A94 94 0 0 1 206 105" pathLength="100" fill="none" stroke="#edeaf7" stroke-width="11" stroke-linecap="round"/><path d="M18 105 A94 94 0 0 1 206 105" pathLength="100" stroke-dasharray="'+(p*100)+' 101" fill="none" stroke="url(#arc)" stroke-width="11" stroke-linecap="round"/>'+ticks+'</svg><div class="gauge-val"><b>'+em.stage+'</b><small>'+label+'</small></div></div>'}
export function renderOverview(ui){
 const {state:s,root,esc}=ui,{date,cut,rows,metrics:observations,stage,rule:em,coverage}=overviewEvidence(s,ui.date);
 const metrics=[{key:'upLimit',label:'专题池涨停家数',unit:'家',color:'#8c79df',tone:'purple',symbol:'trend'},{key:'breakRate',label:'专题池炸板率',unit:'%',color:'#57b69c',tone:'teal',symbol:'pulse'},{key:'height',label:'最高连板',unit:'板',color:'#e7ad66',tone:'orange',symbol:'stack'},{key:'amount',label:'成交额',unit:'亿',color:'#6899df',tone:'blue',symbol:'wallet'}];
 const broad=closeDistribution(s.marketRecovery,date,cut,archive.distribution);
 const eligibleChecks=s.checks.filter(r=>r.date<=date);
 const records=[...eligibleChecks].sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,5);
 const columns=['校验标的','匹配战法','市场周期','仓位上限','校验结果','校验日期',''];
 const mistakes=mistakeSummary(s,date),chartRows=rows.filter(r=>r.source);
 const chartSources=[...new Set(chartRows.filter(r=>safeNumber(r.upLimit)||safeNumber(r.downLimit)).map(r=>r.source))];
 const extra=Object.entries(otherMetrics).flatMap(([k,[label,unit]])=>{
  const r=observations[k];return r?['<p><b>'+esc(label)+' '+esc(r.value)+esc(unit)+'</b><br><small>'+(r.historical?'上次有效 · ':'')+esc(r.date)+' · '+esc(r.source)+' · 取得 '+esc(displayTime(r.knownAt))+'</small></p>']:[];
 });
 const plot=chartSources.length?'<section class="panel chart-panel"><div class="panel-title"><h2 class="card-title">'+icon('chart')+'市场情绪走势</h2><div class="segments"><button data-days="10">近10日</button><button data-days="20" class="active">近20日</button></div></div><div class="legend">专题池涨停家数 / 跌停家数</div><div class="plotbox"></div><div class="chart-foot">'+esc(chartSources.join('、'))+' · 交易日收盘统计</div></section>':'';
 const phaseCard=stage?'<section class="panel cycle-panel"><div class="panel-title"><h2 class="card-title">'+icon('compass')+(stage.date===date?'情绪周期识别':'最近已判定周期')+'</h2><button data-info aria-label="判定依据">'+icon('info')+'</button></div><div class="cycle-body">'+gauge({stage:stage.value,confidence:stage.confidence},stage.date===date?'当日情绪周期':'归档情绪周期')+'<p>'+esc(stage.date)+' · '+esc(stage.source)+'</p><small>依据截至 '+esc(displayTime(stage.knownAt))+'</small></div></section>':'';
 const table=records.map((r,i)=>'<tr class="record-row" data-record="'+i+'"><td><div class="cellstock"><span class="monogram m'+i%4+'">'+esc(r.name?.slice(0,1))+'</span><div>'+esc(r.name)+'<small>'+esc(r.code)+'</small></div></div></td><td>'+esc(r.strategy==='未判定'?'':r.strategy)+'</td><td>'+esc(marketPhaseName(r.emotion?.stage))+'</td><td>'+val(r.position)+'%</td><td>'+esc(r.status)+'</td><td>'+esc(r.date)+'</td><td><button aria-label="校验详情">'+icon('chev',14)+'</button></td></tr>').join('');
 root.innerHTML='<div class="metrics">'+metrics.map(c=>metric(observations[c.key],c,esc)).join('')+'</div>'+
  (broad?'<section class="panel"><h2>'+esc(broad.scope)+' · 收盘分布</h2><p>上涨 '+val(broad.adv)+' 家 · 下跌 '+val(broad.dec)+' 家 · 平盘 '+val(broad.flat)+' 家</p><p>涨停 '+val(broad.upLimit)+' 家 · 跌停 '+val(broad.downLimit)+' 家</p><small>'+esc(broad.day)+' · 有效 '+val(broad.observed)+' / '+val(broad.total)+' 只 · '+esc(broad.source)+'</small></section>':'')+
  (extra.length?'<section class="panel"><h2>盘面观测</h2>'+extra.join('')+'</section>':'')+
  (coverage.length?'<section class="panel"><h2>分范围收盘观测</h2>'+coverage.map(r=>'<p><b>'+esc(r.scope)+'</b> · '+esc(coverageValues(r))+'<br><small>'+esc(coverageCount(r))+' · '+esc(r.day)+' · '+esc(r.source)+' · 取得 '+esc(displayTime(r.knownAt))+'</small></p>').join('')+'</section>':'')+
  (plot||phaseCard?'<div class="visuals">'+plot+phaseCard+'</div>':'')+
  '<section class="panel record-panel"><div class="record-head"><h2 class="card-title">'+icon('check')+'近期校验记录 <small>'+eligibleChecks.length+' 条</small></h2><button class="linkbtn" data-all>查看全部</button></div>'+
  (records.length?'<div class="table-wrap"><table><thead><tr>'+columns.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+table+'</tbody></table></div>':'')+'</section>'+
  (mistakes.length?'<section class="panel"><div class="panel-title"><h2 class="card-title">近期高频坑点</h2><button data-pit>查看错题本</button></div>'+mistakes.slice(0,5).map(x=>'<span class="tag amber">'+esc(x.label)+' · '+x.count+' 次</span>').join('')+'</section>':'');
 chart(ui,20,chartRows);root.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{root.querySelectorAll('[data-days]').forEach(v=>v.classList.toggle('active',v===b));chart(ui,+b.dataset.days,chartRows)});
 root.querySelector('[data-all]').onclick=()=>ui.open('checks');const info=root.querySelector('[data-info]');if(info)info.onclick=()=>ui.modal('情绪判定依据',('<p>'+esc(stage?.date)+' · '+esc(stage?.source)+'</p>')+(stage?.source==='多日收盘规则'?em.evidence:[]).map(x=>'<p style="margin:8px 0">'+esc(x)+'</p>').join('')+(stage?.source==='多日收盘规则'?'<hr><p>缺失数据：'+esc(em.missing.join('、')||'无')+'</p>':'<p>归档规则置信度 '+esc(stage.confidence)+'%</p>'));
 root.querySelectorAll('[data-record]').forEach(tr=>tr.onclick=()=>{const r=records[+tr.dataset.record];ui.modal(esc(r.name)+' · 校验详情',[['日期',r.date],['股票代码',r.code],['战法',r.strategy],['题材',r.theme],['开仓提示',r.status],['仓位上限',r.position+'%'],['冻结因子',r.factors?.join('、')],['风险提示',r.risks?.join('；')]].map(([k,v])=>'<div class="data-line"><span>'+k+'</span><strong>'+esc(v||'—')+'</strong></div>').join(''))});
 if(mistakes.length)root.querySelector('[data-pit]').onclick=()=>ui.open('mistakes');
}
