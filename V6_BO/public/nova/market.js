import {aggregateCandles,movingAverages,projectForwardTracking} from './market-evidence.js';
import {h,button,empty,section,field,format,money,percent,direction,dateTime,dayLabel,note,icon,safeLink,table} from './ui.js';

export const POOLS=[
 ['quant','量化发现','四策略与实际命中条件','/api/quant-picks'],
 ['auction','竞价引力','开盘前共振线索','/api/auction-resonance'],
 ['intraday','盘中动量','量价异动观察','/api/intraday-strong'],
 ['ranked','多因子榜','综合评分与服务端现有排行','state:pool'],
 ['relay-first','首板接力','首板次日的实际候选','state:yierList','edit'],
 ['relay-next','连板接力','连板梯队与板块依据','state:lianbanList','edit'],
 ['movement','异动轨迹','涨幅异动与状态变化','state:abMove'],
 ['conditions','十四条件','逐条命中、未命中与缺数状态','state:myrules'],
 ['focused','重点跟踪','服务端已有重点关注','state:focused'],
 ['matches','全部命中','完整扫描与分页快照','/api/v6/matches'],
 ['trend','趋势轨道','趋势票池','state:trendPool'],
 ['ztpre','形态前沿','涨停前形态','state:ztPre'],
 ['scan','全市场扫描','趋势扫描实际结果','state:trendScan'],
 ['steady','稳态上行','连续温和上涨','state:steadyUp'],
 ['smallyang','小阳线','连续小阳线观察','state:smallyang'],
 ['pre','蓄势池','启动前埋伏','state:pre'],
 ['buzhang','补涨链','补涨龙头观察','state:buzhang'],
 ['limits','涨停图谱','实际涨停池','state:ztPool'],
 ['wash','洗盘观察','洗盘趋势观察','/api/wash-trend','edit'],
 ['preseal','封板前哨','封板前预警','/api/preseal','edit'],
 ['shortline','短线信号','短线速览','/api/shortline','edit']
];
export function rowsFrom(value,depth=0) {
 if(depth>4||!value)return [];
 if(Array.isArray(value))return value.flatMap(row=>row&&typeof row==='object'&&/^\d{6}$/.test(String(row.code||row.symbol||''))?[{...row,code:String(row.code||row.symbol)}]:rowsFrom(row,depth+1));
 if(typeof value!=='object')return [];
 for(const key of ['items','rows','stocks','pool','hits','list','top','picks','candidates','strong'])if(Array.isArray(value[key]))return rowsFrom(value[key],depth+1);
 return [];
}
const unique=rows=>[...new Map(rows.filter(r=>r?.code).map(row=>[row.code,row])).values()];
const quoteAt=row=>row?.vendorQuoteAt??row?.quoteAt??row?.quoteTimestamp;
const quoteSource=row=>row?.quoteSource||row?.source||row?.quoteProvider||'来源待核验';
export function quoteLabel(row) {const at=quoteAt(row);return Number.isFinite(at)&&at>0?dateTime(at)+' · '+quoteSource(row)+(at>Date.now()?' · 时点异常':Date.now()-at>15000?' · 历史报价':' · 原始报价'):'报价时点待核验 · '+quoteSource(row);}
const symbolName=row=>row?.name||row?.code||'未选择';
const reasons=row=>{const primary=Array.isArray(row?.hit)?row.hit.map(x=>typeof x==='string'?x:x.text||x.label||x.id).filter(Boolean):Array.isArray(row?.signals)?row.signals:Array.isArray(row?.explanation)?row.explanation:[];return primary.length?primary:[row?.reason,row?.why,row?.note,row?.washNote,row?.via].filter(x=>typeof x==='string'&&x);};
export function stockCard(row,ctx) {
 const card=h('button',{type:'button',class:'fy-stock-card','data-code':row.code,'aria-label':'研究 '+symbolName(row),onClick:()=>ctx.selectStock(row.code,row)},
  h('div',{class:'fy-stock-head'},h('div',{},h('strong',{},symbolName(row)),h('span',{class:'fy-muted'},row.code)),h('span',{class:'fy-score-ring'},typeof row.score==='number'?format(row.score,1):typeof row.prob==='number'?format(row.prob,1):row.result||'待评估',h('small',{},typeof row.score==='number'?'评分':typeof row.prob==='number'?'原概率':row.result?'原状态':''))),
  h('div',{class:'fy-stock-meta'},h('strong',{class:direction(row.pct)},format(row.price)),h('span',{class:direction(row.pct)},percent(row.pct)),h('span',{class:'fy-muted'},row.sector||row.industry||'板块待核验')),
  h('div',{class:'fy-reason-tags'},reasons(row).slice(0,3).map(reason=>h('span',{class:'fy-tag'},reason))),
  row.auctionPct!=null&&h('small',{class:'fy-muted'},'竞价涨幅 '+percent(row.auctionPct)),
  row.at&&h('small',{class:'fy-muted'},'原信号 '+dateTime(row.at)),
  h('small',{class:'fy-quote-time'},quoteLabel(row)),
  h('span',{class:'fy-stock-open'},'打开研究面板 ',icon('arrow')));
 return card;
}
function ticker(state) {
 const labels={'1.000001':'上证指数','0.399001':'深证成指','0.399006':'创业板指','1.000688':'科创 50'};
 const data=state?.dashboard?.indices||[];
 return h('section',{class:'fy-market-ticker','aria-label':'指数快照'},Object.entries(labels).map(([code,name])=>{const row=data.find(x=>x.code===code)||{};return h('div',{},h('span',{},name),h('strong',{class:direction(row.pct)},format(row.price)),h('small',{class:direction(row.pct)},percent(row.pct)));}));
}
function orbital() {
 const node=h('div',{class:'fy-orbit','aria-hidden':'true'});
 node.innerHTML='<svg viewBox="0 0 440 340" fill="none"><defs><radialGradient id="fy-core"><stop stop-color="#ffb6e5"/><stop offset=".4" stop-color="#b46bff"/><stop offset="1" stop-color="#5b1b89" stop-opacity="0"/></radialGradient><linearGradient id="fy-ring"><stop stop-color="#fa94d0"/><stop offset="1" stop-color="#9861ff"/></linearGradient></defs><circle cx="220" cy="170" r="100" fill="url(#fy-core)"/><g stroke="url(#fy-ring)"><ellipse cx="220" cy="170" rx="185" ry="73" transform="rotate(-30 220 170)"/><ellipse cx="220" cy="170" rx="155" ry="63" transform="rotate(48 220 170)" opacity=".7"/><ellipse cx="220" cy="170" rx="125" ry="118" transform="rotate(-28 220 170)" opacity=".35"/></g><circle cx="371" cy="83" r="7" fill="#f5a5dd"/><circle cx="145" cy="54" r="4" fill="#d0a1ff"/><path d="M205 211v-82h54m-54 32h43" stroke="#f9e3ff" stroke-width="9" stroke-linecap="round"/></svg>';
 return node;
}
export function renderPulse(route,ctx) {
 const state=ctx.state||{},d=state.dashboard||{},rows=unique(rowsFrom(d.rows)),mood=d.mood||{},counts=d.counts||{};
 const view=h('div',{class:'fy-pulse fy-stack'},
  h('section',{class:'fy-pulse-hero'},h('div',{class:'fy-hero-copy'},h('span',{class:'fy-eyebrow'},'FAYO / MARKET PULSE'),h('h1',{},'市场的脉冲，',h('br'),h('em',{},'你的研究坐标。')),h('p',{},mood.note||'把市场、机会与证据，放进同一条研究路径。'),h('div',{class:'fy-inline'},button('发现机会 '+ '↗',()=>ctx.navigate('opportunities','quant'),'primary'),button('进入实验室',()=>ctx.navigate('lab','desk')))),orbital()),
  ticker(state),
  h('section',{class:'fy-workflow','aria-label':'研究路径'},[['机会发现',counts.candidates,'opportunities','quant'],['重点跟踪',counts.focused,'opportunities','focused'],['策略证据',counts.signals,'lab','records'],['风险边界',counts.risk,'assets','risk']].map(([label,count,view,sub],index)=>button(h('span',{},h('i',{},'0'+(index+1)),h('strong',{},label),h('b',{},format(count,0))),()=>ctx.navigate(view,sub),'quiet'))),
  h('div',{class:'fy-briefing-grid'},section('此刻值得研究','实际候选，不把历史报价当作实时信号',rows.length?h('div',{class:'fy-grid two'},rows.slice(0,4).map(r=>stockCard(r,ctx))):empty('等待第一份有效市场快照','周末会保留服务端最近交易日数据；没有历史来源时不生成虚构股票。')),h('div',{class:'fy-stack'},section('市场气候',mood.label||'暂未形成有效研判',h('div',{class:'fy-climate'},h('strong',{},typeof mood.upRatio==='number'?format(mood.upRatio,1)+'%':'—'),h('span',{},'上涨家数占比')),h('p',{class:'fy-muted'},mood.note||'缺少有效市场证据时保持未知。')),section('你的工作空间','快速续接',h('div',{class:'fy-list'},[['策略与规则','lab','strategies'],['持仓与风险','assets','holdings'],['行情与板块','pulse','sectors'],['资讯与推送','inbox','all']].map(([label,view,sub])=>button(h('span',{class:'fy-inline'},label,icon('arrow')),()=>ctx.navigate(view,sub),'quiet'))))))
 );
 if(route.sub&&route.sub!=='overview')return renderMarket(route,ctx);
 return view;
}
export function renderMarket(route,ctx) {
 const state=ctx.state||{};
 const sub=route.sub||'sectors';
 const top=h('div',{class:'fy-subnav'},[['sectors','板块地图'],['global','全球与资金'],['auction-review','竞价复盘'],['plans','交易计划'],['review','复盘与学习']].map(([key,label])=>button(label,()=>ctx.navigate('pulse',key),key===sub?'primary':'quiet')));
 const view=h('div',{class:'fy-stack'},top);
 const labels=[['sectors','板块地图'],['global','全球与资金'],['plans','交易计划'],['review','复盘与学习']];
 if(sub==='auction-review') {
  const code=h('input',{name:'code',inputmode:'numeric',pattern:'[0-9]{6}',placeholder:'六位股票代码',value:ctx.stock||'',required:true});
  const date=h('input',{name:'date',type:'date'}),output=h('div',{},empty('选择股票与日期','仅查询已有竞价记录，不触发重算或推送。'));
  view.append(section('开盘前发生了什么','竞价原始记录与逐股复盘',h('form',{class:'fy-form',onSubmit:async e=>{e.preventDefault();try{const q=new URLSearchParams({code:code.value,date:date.value});const r=await ctx.api('/api/auction-review?'+q,{signal:ctx.signal});output.replaceChildren(renderEvidence(r));}catch(error){ctx.notify(error.message,'error');}}},h('div',{class:'fy-grid two'},field('股票代码',code),field('交易日',date)),h('button',{type:'submit',class:'fy-button primary'},'读取竞价复盘')),button('读取最近竞价流水',async()=>{try{const r=await ctx.api('/api/auction-log?n=80',{signal:ctx.signal});output.replaceChildren(renderEvidence(r));}catch(error){ctx.notify(error.message,'error');}}),output));
  return view;
 }
 const datasets=sub==='sectors'?[['板块强度',state.sectors],['涨停题材',state.ztBySector],['市场主线',state.mainline],['板块联动',state.extLink]]:sub==='global'?[['全球市场',state.global],['外部资金与商品',state.external],['外围预选',state.preselect],['资金异动',state.bigMoney]]:sub==='plans'?[['下一交易日计划',state.nextplan],['十四条判定',state.myrules],['启动前埋伏',state.pre],['补涨线索',state.buzhang]]:[['复盘',state.review],['历史学习',state.learn],['学习记录',state.learnHistory],['宽度与纪律',state.breadth]];
 view.append(h('header',{class:'fy-view-heading'},h('span',{class:'fy-eyebrow'},'FAYO / CONTEXT'),h('h1',{},labels.find(x=>x[0]===sub)?.[1]||'市场上下文')),h('div',{class:'fy-grid two'},datasets.map(([title,data])=>section(title,'同一份服务端市场状态',renderEvidence(data,ctx)))));
 if(sub==='sectors'){
  const radar=h('div',{},empty('指数与大盘证据','主动读取当前服务已保存的指数雷达。'));
  view.append(section('指数雷达','价格、时间、来源与覆盖范围分别核验',button('读取指数证据',async()=>{try{const result=await ctx.api('/api/reference-indexes',{signal:ctx.signal});if(!ctx.signal.aborted)radar.replaceChildren(renderEvidence(result));}catch(error){if(!ctx.signal.aborted)ctx.notify(error.message,'error');}},'primary'),radar));
 }
 if(ctx.role==='edit')view.append(section('刷新专项数据','主动重算与普通读取分别操作',h('div',{class:'fy-inline'},[['sectors','板块'],['global','全球'],['auction','竞价'],['pool','候选'],['ext','外围联动'],['yier','一进二'],['lianban','连板']].map(([module,label])=>button(label+'重算',async()=>{try{await ctx.api('/api/refresh',{method:'POST',body:{module}});await ctx.refresh();ctx.notify('专项刷新已提交');}catch(error){ctx.notify(error.message,'error');}})))));
 return view;
}
export function renderEvidence(data,ctx,depth=0) {
 if(data==null||Array.isArray(data)&&!data.length)return empty('尚无该项历史记录','保留真实缺数状态，数据就绪后在这里显示。');
 if(depth>6)return h('span',{class:'fy-muted'},'展开上层证据查看详情');
 if(typeof data!=='object')return h('p',{},String(data));
 const labels={name:'名称',code:'代码',pct:'涨跌幅',price:'快照价',score:'评分',mainInflow:'主力净额',time:'时间',source:'来源',note:'说明',reason:'依据',day:'交易日',date:'日期',prob:'概率',count:'数量',items:'明细',rows:'记录',picked:'候选',plan:'计划',strong:'强势观察',status:'状态',total:'合计'};
 if(Array.isArray(data)) {
  const stocks=ctx?rowsFrom(data):[],records=stocks.length?stocks:data,size=stocks.length?12:40;
  const list=h('div',{class:stocks.length?'fy-stock-grid':'fy-list'}),more=button('显示更多记录',()=>appendMore(),'quiet');let shown=0;
  function appendMore(){const next=records.slice(shown,shown+size);list.append(...next.map(item=>stocks.length?stockCard(item,ctx):h('div',{class:'fy-item'},renderEvidence(item,ctx,depth+1))));shown+=next.length;more.hidden=shown>=records.length;more.textContent='再显示 '+Math.min(size,records.length-shown)+' 条 / 共 '+records.length+' 条';}
  appendMore();return h('div',{class:'fy-stack'},list,more);
 }
 const entries=Object.entries(data).filter(([key])=>!/(?:token|password|secret|credential|webhook|authCode|machineKey)/i.test(key));
 return h('dl',{class:'fy-facts'},entries.map(([key,value])=>h('div',{},h('dt',{},labels[key]||key),h('dd',{},typeof value==='object'&&value? h('details',{class:'fy-details'},h('summary',{},Array.isArray(value)?value.length+' 条记录':'查看详情'),renderEvidence(value,ctx,depth+1)):typeof value==='number'?format(value,key==='count'||key==='total'?0:2):value==null?'未知':String(value)))));
}
export function renderOpportunities(route,ctx) {
 let active=POOLS.find(x=>x[0]===route.sub)||POOLS[0],current=[],query='',board='all',sort='score',cursor='',max=50,loadGeneration=0,snapshotIdentity='';
 const view=h('div',{class:'fy-stack'}),body=h('div'),summaryView=h('div',{class:'fy-pool-summary'}),status=h('p',{class:'fy-note',role:'status'}),selector=h('select',{'aria-label':'选择股票池'},POOLS.map(([key,label])=>h('option',{value:key,selected:key===active[0]},label)));
 selector.value=active[0];selector.addEventListener('change',()=>ctx.navigate('opportunities',selector.value));
 const search=h('input',{type:'search',placeholder:'搜索名称、代码或板块','aria-label':'筛选股票池'});
 search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();paint();});
 const boardSelect=h('select',{'aria-label':'市场范围'},[['all','全部市场'],['main','主板'],['gem','创业板']].map(([value,label])=>h('option',{value},label)));
 boardSelect.addEventListener('change',()=>{board=boardSelect.value;load();});
 const sortSelect=h('select',{'aria-label':'股票池排序'},[['score','评分'],['pct','涨跌幅'],['original','原始顺序']].map(([value,label])=>h('option',{value},label)));
 sortSelect.addEventListener('change',()=>{sort=sortSelect.value;paint();});
 const loadMore=button('加载下一页',()=>load(true));loadMore.hidden=true;
 view.append(h('header',{class:'fy-view-heading'},h('span',{class:'fy-eyebrow'},'FAYO / OPPORTUNITY FIELD'),h('h1',{},'让机会，各就其位。'),h('p',{},'发现、研究、跟踪，在一个工作流里衔接。')),h('div',{class:'fy-opportunity-toolbar'},field('观察池',selector),search,field('范围',boardSelect),field('排序',sortSelect),button('读取最新结果',()=>load(),'primary')),status,summaryView,body,loadMore);
 function paint() {
  let rows=current.filter(r=>(!query||[r.name,r.code,r.sector].some(x=>String(x||'').toLowerCase().includes(query)))&&(board==='all'||(board==='gem'?/^30/:/^(00|60)/).test(r.code)));
  if(sort!=='original')rows=[...rows].sort((a,b)=>(Number.isFinite(b[sort])?b[sort]:-Infinity)-(Number.isFinite(a[sort])?a[sort]:-Infinity));
  const signal=r=>Array.isArray(r.signals)&&r.signals.length||['triggered','sent','pending'].includes(r.stage);
  const groups=[['正在探索',rows.filter(r=>!signal(r)&&!r.focused),'研究候选'],['重点跟踪',rows.filter(r=>!signal(r)&&r.focused),'重点关注'],['已有信号',rows.filter(signal),'已返回的策略信号']];
  const populatedGroups=groups.filter(([,list])=>list.length);
  const stageStrip=h('div',{class:'fy-stage-strip','aria-label':'观察阶段数量'},groups.map(([label,list])=>h('span',{class:'fy-stage-chip'},label,h('b',{},list.length))));
  body.replaceChildren(stageStrip,populatedGroups.length?h('div',{class:'fy-pool-board fy-lanes-'+populatedGroups.length},populatedGroups.map(([label,list,description])=>h('section',{class:'fy-pool-column'},h('header',{},h('h2',{},label),h('span',{class:'fy-tag'},list.length)),h('p',{class:'fy-muted'},description),h('div',{class:'fy-stock-grid'},list.map(r=>stockCard(r,ctx)))))):empty('当前筛选没有匹配','可切换观察池或筛选范围；已有历史结果不会被伪造为实时。'));
 }
 async function load(append=false) {
  const state=ctx.state||{},turn=++loadGeneration,requestedBoard=board;
  loadMore.disabled=true;
  if(active[4]==='edit'&&ctx.role!=='edit'){body.replaceChildren(empty('该观察池需要开发者权限','行情与公开选股池仍可正常浏览。'));return;}
  status.textContent='正在读取 '+active[1]+'…';
  try {
   let data;
   if(active[3].startsWith('state:')) {
    const key=active[3].slice(6);
    current=unique(rowsFrom(key==='focused'?(state.dashboard?.rows||[]).filter(x=>x.focused):state[key]));
    const ownDay=key==='yierList'?state.yierAsOf:key==='lianbanList'?state.lianbanAsOf:null;
    const normalizedDay=typeof ownDay==='string'?ownDay.replaceAll('/','-').slice(0,10):null;
    data={items:current,snapshotDay:normalizedDay||state.snapshotFieldDays?.[key]||state.snapshotDay||state.dashboard?.snapshotDay,isSnapshot:state.isSnapshot||state.dashboard?.isSnapshot};
   } else {
    const params=active[0]==='matches'?new URLSearchParams({limit:String(max),...(append&&cursor?{cursor}:{})}):new URLSearchParams({board:requestedBoard,max:String(max)});
    data=await ctx.readPool(active[0]+':'+requestedBoard,()=>ctx.api(active[3]+'?'+params,{signal:ctx.signal,timeoutMs:60000}));
    if(ctx.signal.aborted||turn!==loadGeneration)return;
    if(append&&snapshotIdentity&&data.snapshotId&&data.snapshotId!==snapshotIdentity){cursor='';ctx.notify('扫描快照已更新，将读取新的第一页');load(false);return;}
    snapshotIdentity=data.snapshotId||snapshotIdentity;
    const incoming=unique(rowsFrom(data.items||data)).map(row=>data.forwardTracking&&!row.forwardTracking?{...row,forwardTracking:data.forwardTracking}:row);current=append?unique([...current,...incoming]):incoming;
    cursor=data.nextCursor||'';loadMore.hidden=!data.hasMore;
   }
   if(ctx.signal.aborted||turn!==loadGeneration)return;
   summaryView.replaceChildren(...['cycle','timing','feedback','sectorView'].filter(key=>data[key]).map(key=>h('details',{class:'fy-details'},h('summary',{},({cycle:'短线周期',timing:'时机反馈',feedback:'历史反馈',sectorView:'板块结构'})[key]),renderEvidence(data[key]))));
   const day=data.snapshotDay||state.snapshotDay||state.dashboard?.snapshotDay;
   status.textContent=active[1]+' · '+current.length+' 只'+(day?' · 原始交易日 '+dayLabel(day):'')+(data.isSnapshot||data.snapshotRetained?' · 保留快照':'');
   paint();
  }catch(error){if(ctx.signal.aborted||turn!==loadGeneration)return;if(error.body?.status==='snapshot-changed'){cursor='';load(false);return;}status.textContent=error.message;status.className='fy-note error';if(!current.length)body.replaceChildren(empty('此次读取未完成',error.message));ctx.notify(error.message,'error');}
  finally{if(turn===loadGeneration)loadMore.disabled=false;}
 }
 ctx.onState?.(()=>load());
 load();
 return view;
}
const aggregate=aggregateCandles;

function chart(rows) {
 if(!rows.length)return empty('没有可绘制的真实 K 线','历史不足时不补画示意走势。');
 const viewport=Math.max(240,Math.min(640,(document.querySelector('.fy-stock-drawer')?.clientWidth||innerWidth)-64));
 rows=rows.slice(-(viewport<400?55:90));
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 '+viewport+' 290');svg.setAttribute('role','img');svg.setAttribute('aria-label','实际历史K线与成交量');
 const high=Math.max(...rows.map(r=>r.high)),low=Math.min(...rows.map(r=>r.low)),spread=high-low||1,width=(viewport-70)/rows.length;
 const y=value=>230-(value-low)/spread*195,maxVolume=Math.max(1,...rows.map(r=>Number.isFinite(r.volume)?r.volume:0));
 function add(tag,attrs,text){const node=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));if(text)node.textContent=text;svg.append(node);}
 for(let i=0;i<5;i++){const price=low+spread*i/4,yy=y(price);add('line',{x1:16,x2:viewport-50,y1:yy,y2:yy,stroke:'#402449','stroke-dasharray':'3 6'});add('text',{x:viewport-44,y:yy+4,fill:'#ad88bb','font-size':10},format(price));}
 rows.forEach((r,i)=>{const x=18+(i+.5)*width,color=r.close>=r.open?'#fb8cbd':'#7edabf';add('line',{x1:x,x2:x,y1:y(r.high),y2:y(r.low),stroke:color});add('rect',{x:x-width*.28,y:Math.min(y(r.open),y(r.close)),width:Math.max(1,width*.56),height:Math.max(1,Math.abs(y(r.close)-y(r.open))),fill:color,rx:1});if(Number.isFinite(r.volume))add('rect',{x:x-width*.28,y:275-r.volume/maxVolume*27,width:Math.max(1,width*.56),height:r.volume/maxVolume*27,fill:color,opacity:.4});});
 for(const [j,window]of [5,10,20].entries()){const average=movingAverages(rows,window);const points=average.map((item,i)=>item.value==null?null:(18+(i+.5)*width)+','+y(item.value)).filter(Boolean);if(points.length>1)add('polyline',{points:points.join(' '),fill:'none',stroke:['#f5b4d9','#b6a1ff','#88d0d8'][j],'stroke-width':1.4});}
 for(const i of [0,Math.floor(rows.length/2),rows.length-1])add('text',{x:Math.min(viewport-90,18+i*width),y:289,fill:'#ad88bb','font-size':10},rows[i].date);
 return svg;
}
export function createStockDrawer(ctx) {
 let controller=null,code='',row=null,period='day',tab='chart',daily=[],generation=0,previousFocus=null,historyLoading=false,loadQueued=false;
 const overlay=h('div',{class:'fy-drawer-backdrop',hidden:true}),drawer=h('aside',{class:'fy-stock-drawer',role:'dialog','aria-modal':'true','aria-label':'股票研究面板',hidden:true,tabindex:'-1'}),title=h('h2',{class:'fy-drawer-title'}),quote=h('div',{class:'fy-drawer-quote'}),body=h('div',{class:'fy-drawer-body'}),meta=h('p',{class:'fy-quote-time'});
 const close=()=>{generation++;controller?.abort();drawer.hidden=true;overlay.hidden=true;document.body.classList.remove('fy-drawer-open');previousFocus?.focus?.();};
 const closeButton=button(icon('close'),close,'quiet');closeButton.setAttribute('aria-label','关闭股票研究面板');
 const tabNav=h('div',{class:'fy-tabs'});
 for(const[key,label]of [['chart','走势'],['evidence','依据'],['company','公告'],['tracking','跟踪'],['analysis','诊断'],['marks','当日标记']])tabNav.append(h('button',{type:'button','data-detail-tab':key,onClick:()=>{tab=key;paint();}},label));
 drawer.append(h('header',{class:'fy-drawer-header'},h('div',{},h('span',{class:'fy-eyebrow'},'FAYO / STOCK LENS'),title),closeButton),quote,meta,tabNav,body,h('footer',{class:'fy-drawer-footer'},button('在实验室继续研究',()=>{close();ctx.navigate('lab','records');}),'历史研究 · 原始时点独立核验'));
 overlay.addEventListener('click',close);
 drawer.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){const nodes=[...drawer.querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]')].filter(n=>n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 });
 function paint() {
  tabNav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.detailTab===tab)));
  if(tab==='chart'){
   const controls=h('div',{class:'fy-tabs'},[['day','日 K'],['month','月 K'],['year','年 K']].map(([key,label])=>h('button',{type:'button','data-period':key,'aria-pressed':String(period===key),onClick:()=>{period=key;paint();if(key!=='day')loadHistory(true);}},label)));
   const bars=aggregate(daily,period);body.replaceChildren(controls,h('div',{class:'fy-chart'},chart(bars.slice(-90))),h('p',{class:'fy-muted'},daily.length?'实际日线 '+daily.length+' 条 · '+(period==='day'?'原始日线':'仅聚合已有日线；当前周期可能尚未结束'):'正在读取已有历史…'),button('加载更早的历史',()=>loadHistory(true),'quiet'));
  }else if(tab==='evidence'){
   body.replaceChildren(section('实际命中与风险','只展示当前返回的条件',reasons(row).length?h('ol',{class:'fy-evidence-list'},reasons(row).map(r=>h('li',{},r))):empty('尚未返回逐条命中依据','可以在实验室读取同股研究档案。')),renderEvidence(row?.conditions||row?.conditionEvidence||row?.conditionInputs||row?.items||null),h('details',{class:'fy-details'},h('summary',{},'完整研究记录'),renderEvidence(row)));
  }else if(tab==='company'){
   const issuer=row?.issuerEvidence;body.replaceChildren(section('公司原始公告','公告时间与价格时点分别核验',issuer?.events?.length?h('div',{class:'fy-stack'},issuer.events.map(item=>h('article',{class:'fy-item'},safeLink(item.url,item.title),h('p',{class:'fy-muted'},dateTime(item.publishedAt)+' · '+(item.reason||'标题线索'))))):empty('没有匹配的公告证据','没有记录不代表该公司没有风险。')));
  }else if(tab==='tracking'){
   const tracking=projectForwardTracking(row?.forwardTracking,code);
   const tracked = tracking.entries.map(entry => {
    const windows = entry.windows.map(window => h('div',{class:'fy-kpi'},h('span',{},window.days+' 交易日'),h('strong',{class:direction(window.pct)},window.pct==null?window.label:percent(window.pct)),h('small',{},window.date||'未到期')));
    return h('article',{class:'fy-item'},h('strong',{},entry.date+' · '+entry.system),h('div',{class:'fy-grid four'},windows));
   });
   body.replaceChildren(section('信号后的真实观察','1 / 5 / 20 / 60 交易日与今日涨跌分开',note(tracking.note),tracked.length?h('div',{class:'fy-stack'},tracked):empty('尚无与该股匹配的有效跟踪证据','不会显示其他股票或未经协议验证的收益。')));
  }else if(tab==='marks'){
   const date=h('input',{type:'date','aria-label':'标记交易日'}),output=h('div');body.replaceChildren(section('当日信号标记','与原K线标记接口相同的服务端记录',field('交易日',date),ctx.role==='edit'?button('读取原始标记',async()=>{try{const q=new URLSearchParams({code,date:date.value});const result=await ctx.api('/api/kline-marks?'+q,{signal:controller.signal});output.replaceChildren(renderEvidence(result));}catch(error){ctx.notify(error.message,'error');}}):note('逐股私密标记需要开发者权限'),output));
  }else{
   body.replaceChildren(section('个股诊断','主动读取现有分析，不产生交易',empty('尚未读取诊断结果','点击读取后显示已有分析和风险。'),button('读取分析',async()=>{try{const requestedCode=code,turn=generation,requestController=controller;const r=await ctx.api('/api/analyze?code='+encodeURIComponent(requestedCode),{signal:requestController.signal,timeoutMs:60000});if(turn===generation&&code===requestedCode&&tab==='analysis'&&!requestController.signal.aborted)body.replaceChildren(section('个股诊断','服务端已有计算',renderEvidence(r)));}catch(error){if(error.name!=='AbortError')ctx.notify(error.message,'error');}},'primary')));
  }
 }
 async function loadHistory(older=false) {
  const turn=generation,currentController=controller;if(!code)return;
  if(historyLoading){if(older)loadQueued=true;return;}historyLoading=true;
  try {
   let end=older&&daily.length?daily[0].date:'';let pages=0;
   do{
    const params=new URLSearchParams({code,n:'240',...(end?{end}:{})});
    const result=await ctx.api('/api/kline?'+params,{signal:currentController.signal,timeoutMs:60000});
    if(turn!==generation||currentController.signal.aborted)return;
    const rows=Array.isArray(result.rows)?result.rows:Array.isArray(result.data)?result.data:[];
    if(!rows.length)break;
    const previous=daily.length;daily=aggregate([...daily,...rows],'day');
    if(daily.length===previous)break;
    end=daily[0]?.date||'';pages++;
    if(!older||period==='day'||rows.length<240)break;
   }while(pages<8&&daily.length<1920);
   if(tab==='chart')paint();
  }catch(error){if(turn!==generation||error.name==='AbortError')return;if(tab==='chart')body.replaceChildren(empty('历史数据暂时未能读取',error.message),button('重新读取',()=>loadHistory(false)));}
  finally{if(turn===generation){historyLoading=false;if(loadQueued){loadQueued=false;loadHistory(true);}}}
 }
 async function open(nextCode,nextRow) {
  if(!/^\d{6}$/.test(nextCode))return;previousFocus=document.activeElement;generation++;controller?.abort();controller=new AbortController();code=nextCode;row=nextRow||ctx.findStock(nextCode)||{code:nextCode};daily=[];historyLoading=false;loadQueued=false;period='day';tab='chart';
  title.textContent=symbolName(row)+' / '+nextCode;quote.replaceChildren(h('strong',{class:direction(row.pct)},format(row.price)),h('span',{class:direction(row.pct)},percent(row.pct)));meta.textContent=quoteLabel(row);
  overlay.hidden=false;drawer.hidden=false;document.body.classList.add('fy-drawer-open');paint();drawer.focus();loadHistory();
 }
 return {element:h('div',{class:'fy-drawer-layer'},overlay,drawer),open,close,update:()=>{if(drawer.hidden||!code)return;const next=ctx.findStock(code);if(next){row=next;quote.replaceChildren(h('strong',{class:direction(row.pct)},format(row.price)),h('span',{class:direction(row.pct)},percent(row.pct)));meta.textContent=quoteLabel(row);}},clear:()=>{close();code='';row=null;daily=[];title.textContent='';quote.replaceChildren();meta.textContent='';body.replaceChildren();}};
}
