import {icon} from './icons.mjs';
import {emotion} from './market.mjs';
import {mistakeSummary} from './review.mjs';
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
function metric(m,prev,rows,{key,label,unit,color,tone,symbol}){
 const delta=m[key]!=null&&prev[key]!=null?round(m[key]-prev[key]):null;
 const diff=delta!=null?(delta>0?'+':'')+val(delta)+(key==='breakRate'?' pp':unit):'—';
 const number=key==='amount'&&m[key]!=null?val(round(m[key]/10000)):val(m[key]);
 return '<article class="metric"><div class="stat-title"><span class="tile-icon '+tone+'">'+icon(symbol,18)+'</span>'+label+'</div><div class="metric-val">'+number+'<span class="unit">'+(key==='amount'?'万亿元':unit)+'</span></div><div class="stat-bottom"><span class="change">较前日 <b>'+diff+'</b></span>'+spark(rows.map(r=>r[key]).filter(safeNumber),color,key)+'</div></article>'
}
function chart(ui,windowSize){
 const root=ui.root.querySelector('.plotbox'),rows=ui.state.market.slice(-windowSize);
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
function gauge(em){const p=em.confidence/100;let ticks='';for(let i=0;i<23;i++){const a=Math.PI*(1-i/22),rad=i%2?74:71;ticks+='<line x1="'+(112+79*Math.cos(a))+'" y1="'+(105-79*Math.sin(a))+'" x2="'+(112+rad*Math.cos(a))+'" y2="'+(105-rad*Math.sin(a))+'" stroke="#d0cbeb" stroke-width="1.3"/>'}
 return '<div class="gauge"><svg viewBox="0 0 224 116"><defs><linearGradient id="arc"><stop stop-color="#d8d1ff"/><stop offset=".45" stop-color="#a49aef"/><stop offset="1" stop-color="#6756cb"/></linearGradient></defs><path d="M18 105 A94 94 0 0 1 206 105" pathLength="100" fill="none" stroke="#edeaf7" stroke-width="11" stroke-linecap="round"/><path d="M18 105 A94 94 0 0 1 206 105" pathLength="100" stroke-dasharray="'+(p*100)+' 101" fill="none" stroke="url(#arc)" stroke-width="11" stroke-linecap="round"/>'+ticks+'</svg><div class="gauge-val"><b>'+em.stage+'</b><small>当前情绪周期</small></div></div>'}
export function renderOverview(ui){
 const {state:s,root,esc}=ui,rows=s.market,m=rows.at(-1)||{},prev=rows.at(-2)||{},date=m.date||new Date().toISOString().slice(0,10),em=emotion(rows,date,s.v6Observation?.latestClosed&&s.v6Observation.day===date?s.v6Observation.observedAt:undefined);
 const metrics=[{key:'upLimit',label:'涨停家数',unit:'家',color:'#8c79df',tone:'purple',symbol:'trend'},{key:'breakRate',label:'市场炸板率',unit:'%',color:'#57b69c',tone:'teal',symbol:'pulse'},{key:'height',label:'最高连板',unit:'板',color:'#e7ad66',tone:'orange',symbol:'stack'},{key:'amount',label:'两市成交额',unit:'亿',color:'#6899df',tone:'blue',symbol:'wallet'}];
 const records=[...s.checks].sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,5);
 const columns=['校验标的','匹配战法','市场周期','仓位上限','校验结果','校验日期',''];
 const mistakes=mistakeSummary(s,date);
 root.innerHTML='<div class="metrics">'+metrics.map(c=>metric(m,prev,rows,c)).join('')+'</div><div class="visuals"><section class="panel chart-panel"><div class="panel-title"><h2 class="card-title">'+icon('chart')+'市场情绪走势</h2><div class="segments"><button data-days="10">近10日</button><button data-days="20" class="active">近20日</button></div></div><div class="legend"><span><i class="swatch" style="background:#806cdb"></i>涨停家数</span><span><i class="swatch" style="background:#62bba4"></i>跌停家数</span></div><div class="plotbox"></div><div class="chart-foot">'+icon('clock',13)+'交易日收盘统计 · 单位：家</div></section><section class="panel cycle-panel"><div class="panel-title"><h2 class="card-title">'+icon('compass')+'情绪周期识别</h2><button title="查看判定依据" aria-label="查看判定依据" class="no-btn" data-info>'+icon('info',16)+'</button></div><div class="cycle-body">'+gauge(em)+'<div class="phase-steps">'+phase.map(v=>'<span class="'+(v===em.stage?'active':'')+'">'+v+'</span>').join('')+'</div><div class="evidence"><p>规则一致率 <b class="num">'+em.confidence+'%</b> · 近 3 个交易日</p><p>'+esc(em.missing.length?'待补充 '+em.missing.length+' 项数据':em.evidence.at(-1)?.split('（')[0])+'</p></div></div></section></div><section class="panel record-panel"><div class="record-head"><h2 class="card-title">'+icon('check')+'近期校验记录 <small>'+s.checks.length+' 条</small></h2><button class="linkbtn" data-all>查看全部 '+icon('chev',14)+'</button></div><div class="table-wrap"><table><thead><tr>'+columns.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+records.map((r,i)=>'<tr class="record-row" data-record="'+i+'"><td><div class="cellstock"><span class="monogram m'+i%4+'">'+esc(r.name?.slice(0,1))+'</span><div>'+esc(r.name)+'<small>'+esc(r.code)+'</small></div></div></td><td>'+esc(r.strategy)+'</td><td><span class="tag violet">'+esc(r.emotion?.stage||'未判定')+'</span></td><td class="num">'+val(r.position)+'%</td><td><span class="tag '+(r.position>10?'green':r.position>0?'amber':'red')+'">'+esc(r.status)+'</span></td><td class="num" style="color:#7b8294">'+esc(r.date)+'</td><td><button aria-label="查看校验详情" class="row-more">'+icon('chev',14)+'</button></td></tr>').join('')+(records.length?'':'<tr><td colspan="7" class="empty">暂无校验记录</td></tr>')+'</tbody></table></div></section>'+(mistakes.length?'<section class="panel" style="margin-top:16px"><div class="panel-title"><h2 class="card-title">'+icon('shield')+'近期高频坑点</h2><button class="linkbtn" data-pit>查看错题本</button></div><div class="toolbar">'+mistakes.slice(0,5).map(x=>'<span class="tag amber">'+esc(x.label)+' · '+x.count+' 次</span>').join('')+'</div></section>':'');
 chart(ui,20);root.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{root.querySelectorAll('[data-days]').forEach(v=>v.classList.toggle('active',v===b));chart(ui,+b.dataset.days)});
 root.querySelector('[data-all]').onclick=()=>ui.open('checks');root.querySelector('[data-info]').onclick=()=>ui.modal('情绪判定依据',em.evidence.map(x=>'<p style="margin:8px 0">'+esc(x)+'</p>').join('')+'<hr><p>缺失数据：'+esc(em.missing.join('、')||'无')+'</p>');
 root.querySelectorAll('[data-record]').forEach(tr=>tr.onclick=()=>{const r=records[+tr.dataset.record];ui.modal(esc(r.name)+' · 校验详情',[['日期',r.date],['股票代码',r.code],['战法',r.strategy],['题材',r.theme],['开仓提示',r.status],['仓位上限',r.position+'%'],['冻结因子',r.factors?.join('、')],['风险提示',r.risks?.join('；')]].map(([k,v])=>'<div class="data-line"><span>'+k+'</span><strong>'+esc(v||'—')+'</strong></div>').join(''))});
 if(mistakes.length)root.querySelector('[data-pit]').onclick=()=>ui.open('mistakes');
}
