import {renderSourceReviewPool} from './review-pool.js';
import { phaseLabel, stockTactics } from './tactics-view.js';
import {aggregateCandles,movingAverages,projectForwardTracking,projectDecisionBrief,stockReasons,requirePoolReady} from './market-evidence.js';
export {projectDecisionBrief};
import {h,button,empty,section,field,format,money,percent,direction,dateTime,dayLabel,note,icon,safeLink,table} from './ui.js';

export const POOLS=[
 ['quant','量化发现','四策略与实际命中条件','/api/quant-picks'],
 ['auction','竞价引力','开盘前共振线索','/api/auction-resonance'],
 ['intraday','盘中动量','量价异动观察','/api/intraday-strong'],
 ['ranked','多因子榜','综合评分与服务端现有排行','state:pool'],
 ['relay-first','一进二','首板次日的实际候选','state:yierList','edit'],
 ['relay-second','二进三','二板晋级三板的实际候选','state:lianbanList','edit'],
 ['relay-next','连板接力（含高板）','连板梯队与板块依据','state:lianbanList','edit'],
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
const reasons=stockReasons;
export function stockCard(row,ctx) {
 const card=h('button',{type:'button',class:'fy-stock-card','data-code':row.code,'aria-label':'研究 '+symbolName(row),onClick:()=>ctx.selectStock(row.code,row)},
  h('div',{class:'fy-stock-head'},h('div',{},h('strong',{},symbolName(row)),h('span',{class:'fy-muted'},row.code)),h('span',{class:'fy-score-ring'},typeof row.score==='number'?format(row.score,1):typeof row.prob==='number'?format(row.prob,1):row.result||'待评估',h('small',{},typeof row.score==='number'?'评分':typeof row.prob==='number'?'原概率':row.result?'原状态':''))),
  h('div',{class:'fy-stock-meta'},h('strong',{class:direction(row.pct)},format(row.price)),h('span',{class:direction(row.pct)},percent(row.pct)),h('span',{class:'fy-muted'},row.sector||row.industry||'板块待核验')),
  row.poolLabels?.length&&h('div',{class:'fy-reason-tags'},row.poolLabels.map(label=>h('span',{class:'fy-tag'},label))),
  row.poolDay&&h('small',{class:'fy-muted'},'结果日期 '+dayLabel(row.poolDay)),
  h('div',{class:'fy-reason-tags'},reasons(row).slice(0,3).map(reason=>h('span',{class:'fy-tag'},reason))),
  row.auctionPct!=null&&h('small',{class:'fy-muted'},'竞价涨幅 '+percent(row.auctionPct)),
  row.at&&h('small',{class:'fy-muted'},'原信号 '+dateTime(row.at)),
  h('small',{class:'fy-quote-time'},quoteLabel(row)),
  h('span',{class:'fy-stock-open'},'打开研究面板 ',icon('arrow')));
 return card;
}
const roleLabel=row=>({leader:'龙头',deputy:'龙二',mid:'中军',follow:'跟风'})[row?.role]||'角色待核验';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function detailedStockCard(row,ctx) {
 const strength=row.sectorStrength||{};
 const metrics=[['快照价',format(row.price)],['封单 / 成交额',finite(row.sealRatio)?format(row.sealRatio*100,0)+'%':'未知'],['开板次数',finite(row.breakCount)?format(row.breakCount,0):'未知'],['换手率',finite(row.turnover)?format(row.turnover,1)+'%':'未知'],['封单额',money(row.sealAmount)],['流通市值',money(row.floatCap)],['主力净额',row.mainInflow==null?'未知':money(row.mainInflow)],['封单 / 流通市值',finite(row.sealStrength)?format(row.sealStrength,2)+'%':'未知']];
 return h('article',{class:'fy-panel fy-section'},
  h('div',{class:'fy-inline'},button(symbolName(row)+' '+row.code,()=>ctx.selectStock(row.code,row),'quiet'),h('strong',{},roleLabel(row)),row.level&&h('span',{class:'fy-tag'},row.level+'进'+(row.targetLevel||row.level+1)),row.mainline&&h('span',{class:'fy-tag'},'主流板块'),h('span',{class:'fy-tag'},row.sector||'板块待核验')),
  h('p',{},finite(row.fused)?'排序值 '+format(row.fused,1)+' · 原模型估计 '+format(row.prob,1):finite(row.prob)?'原模型估计 '+format(row.prob,1):finite(row.score)?'评分 '+format(row.score,1):'评分待核验'),
  (finite(row.fused)||finite(row.prob))&&h('small',{class:'fy-muted'},'模型估计和排序值不等于经验证的胜率。'),
  h('div',{class:'fy-grid four'},metrics.map(([label,value])=>h('div',{class:'fy-item','data-field':label==='快照价'?'price':null},h('small',{},label),h('br'),h('strong',{},value)))),
  strength.theme&&h('p',{},'板块联动：'+strength.theme+' · '+format(strength.score,0)+' 分 · '+(strength.grade||'强弱待核验')+' · 同主线涨停 '+format(strength.sectorZT,0)+' 只 · 最高 '+format(strength.maxLb,0)+' 板'),
  h('h3',{},'入选依据'),h('p',{},reasons(row).join('；')||'接口未返回依据。'),
  row.mainlineBasis&&h('p',{class:'fy-muted'},'主线依据：'+row.mainlineBasis),
  h('p',{class:'fy-muted'},'结果日期 '+dayLabel(row.poolDay)+' · '+quoteLabel(row)),
  h('small',{class:'fy-muted'},'以上为原接口记录。旧字段可能使用默认值，0 不自动视为已确认的真实观测。'),
  h('details',{class:'fy-details'},h('summary',{},'完整条件与原始记录'),renderEvidence(row)));
}
export function sectorRoleCards(state,day,ctx) {
 const sourceDay=reviewDate(state.snapshotFieldDays?.ztBySector||state.ztDay);
 if(!day||sourceDay!==day)return note('板块角色数据日期 '+(sourceDay||'未知')+'，未与本次复盘一致，暂不混入。');
 const groups=Array.isArray(state.ztBySector)?state.ztBySector:[];
 return groups.length?h('div',{class:'fy-grid two'},groups.map(group=>h('article',{class:'fy-item'},h('h3',{},group.sector||'板块待核验'),h('p',{},'涨停 '+format(group.count,0)+' 只'),h('div',{class:'fy-reason-tags'},(group.stocks||[]).map(row=>h('span',{class:'fy-tag'},roleLabel(row)+' · '+(row.name||'名称缺失')+(row.lb>0?' · '+row.lb+' 板':'')+(row.strong?' · 题材强势':''))))))):empty('尚无板块角色分类');
}
export function nextPlanCards(state,day,ctx) {
 const plan=state.nextplan,sourceDay=reviewDate(plan?.date);
 if(!day||sourceDay!==day)return note('次日计划生成日 '+(sourceDay||'未知')+'，未与本次复盘一致，暂不混入。');
 const rows=[...(Array.isArray(plan?.plan?.picked)?plan.plan.picked:[]),...(Array.isArray(plan?.relay)?plan.relay:[])];
 return h('div',{class:'fy-stack'},h('p',{},'生成日 '+sourceDay+' · 适用 '+(reviewDate(plan.applyDate)||'下一交易日（日期待核验）')),
  rows.length?rows.map(row=>h('article',{class:'fy-item'},button(symbolName(row)+' '+row.code,()=>ctx.selectStock(row.code,row),'quiet'),h('p',{},'参考区间 '+(Array.isArray(row.entry)&&row.entry.length===2?row.entry.map(x=>format(x)).join(' ～ '):'未知')+' · 失效参考 '+format(row.stop)+' · 目标参考 '+format(row.target)),
   h('p',{},'依据：'+(Array.isArray(row.reasons)?row.reasons.join('；'):row.reason||'未返回')),
   h('p',{},'风险：'+(Array.isArray(row.risks)?row.risks.join('；'):row.risk||'未返回风险，不代表无风险')),
   h('p',{},'确认条件：'+(Array.isArray(row.confirm)?row.confirm.join('；'):'未返回')),
   Array.isArray(row.invalid)&&h('p',{},'失效条件：'+row.invalid.join('；')))):empty('同日计划没有候选'),
  note('展示现有模型计划，价位为生成时参考；需结合下一交易日新行情确认，未确认时不执行。'));
}
export function ticker(state) {
 const labels={'1.000001':'上证指数','0.399001':'深证成指','0.399006':'创业板指','1.000688':'科创 50'};
 const data=state?.dashboard?.indices||[];
 return h('section',{class:'fy-market-ticker fy-index-evidence','aria-label':'指数快照'},Object.entries(labels).map(([code,name])=>{const row=data.find(x=>x.code===code)||{};return h('div',{},h('span',{},name),h('strong',{class:direction(row.pct)},format(row.price)),h('small',{class:direction(row.pct)},percent(row.pct)),h('small',{class:'fy-quote-time'},quoteLabel(row)),h('small',{class:'fy-muted'},'单源观测 · 尚未交叉核验'));}));
}
function orbital() {
 const node=h('div',{class:'fy-orbit','aria-hidden':'true'});
 node.innerHTML='<svg viewBox="0 0 440 340" fill="none"><defs><radialGradient id="fy-core"><stop stop-color="#ffb6e5"/><stop offset=".4" stop-color="#b46bff"/><stop offset="1" stop-color="#5b1b89" stop-opacity="0"/></radialGradient><linearGradient id="fy-ring"><stop stop-color="#fa94d0"/><stop offset="1" stop-color="#9861ff"/></linearGradient></defs><circle cx="220" cy="170" r="100" fill="url(#fy-core)"/><g stroke="url(#fy-ring)"><ellipse cx="220" cy="170" rx="185" ry="73" transform="rotate(-30 220 170)"/><ellipse cx="220" cy="170" rx="155" ry="63" transform="rotate(48 220 170)" opacity=".7"/><ellipse cx="220" cy="170" rx="125" ry="118" transform="rotate(-28 220 170)" opacity=".35"/></g><circle cx="371" cy="83" r="7" fill="#f5a5dd"/><circle cx="145" cy="54" r="4" fill="#d0a1ff"/><path d="M205 211v-82h54m-54 32h43" stroke="#f9e3ff" stroke-width="9" stroke-linecap="round"/></svg>';
 return node;
}
export function renderPulse(route,ctx) {
 if(!route.sub||route.sub==='overview')return renderAllOpportunities(ctx);
 if(route.sub!=='market-overview')return renderMarket(route,ctx);
 const state=ctx.state||{},d=state.dashboard||{},rows=unique(rowsFrom(d.rows)),mood=d.mood||{},counts=d.counts||{};
 const view=h('div',{class:'fy-pulse fy-stack'},
  h('section',{class:'fy-pulse-hero'},h('div',{class:'fy-hero-copy'},h('span',{class:'fy-eyebrow'},'FAYO / MARKET PULSE'),h('h1',{},'市场的脉冲，',h('br'),h('em',{},'你的研究坐标。')),h('p',{},mood.note||'把市场、机会与证据，放进同一条研究路径。'),h('div',{class:'fy-inline'},button('发现机会 '+ '↗',()=>ctx.navigate('opportunities','quant'),'primary'),button('进入实验室',()=>ctx.navigate('lab','desk')))),orbital()),
  ticker(state),
  h('section',{class:'fy-workflow','aria-label':'研究路径'},[['机会发现',counts.candidates,'opportunities','quant'],['重点跟踪',counts.focused,'opportunities','focused'],['策略证据',counts.signals,'lab','records'],['风险边界',counts.risk,'assets','risk']].map(([label,count,view,sub],index)=>button(h('span',{},h('i',{},'0'+(index+1)),h('strong',{},label),h('b',{},format(count,0))),()=>ctx.navigate(view,sub),'quiet'))),
  h('div',{class:'fy-briefing-grid'},section('此刻值得研究','实际候选，不把历史报价当作实时信号',rows.length?h('div',{class:'fy-grid two'},rows.slice(0,4).map(r=>stockCard(r,ctx))):empty('等待第一份有效市场快照','周末会保留服务端最近交易日数据；没有历史来源时不生成虚构股票。')),h('div',{class:'fy-stack'},section('市场气候',mood.label||'暂未形成有效研判',h('div',{class:'fy-climate'},h('strong',{},typeof mood.upRatio==='number'?format(mood.upRatio,1)+'%':'—'),h('span',{},'上涨家数占比')),h('p',{class:'fy-muted'},mood.note||'缺少有效市场证据时保持未知。')),section('你的工作空间','快速续接',h('div',{class:'fy-list'},[['策略与规则','lab','strategies'],['持仓与风险','assets','holdings'],['行情与板块','pulse','sectors'],['资讯与推送','inbox','all']].map(([label,view,sub])=>button(h('span',{class:'fy-inline'},label,icon('arrow')),()=>ctx.navigate(view,sub),'quiet'))))))
 );

 return view;
}
export function renderMarket(route,ctx) {
 const sub=route.sub||'sectors';
 if(sub==='review')return renderDailyReview(ctx);
 const top=h('div',{class:'fy-subnav'},[['sectors','板块地图'],['global','全球与资金'],['auction-review','竞价复盘'],['plans','交易计划'],['review','复盘与学习']].map(([key,label])=>button(label,()=>ctx.navigate('pulse',key),key===sub?'primary':'quiet')));
 const view=h('div',{class:'fy-stack'},top);
 const labels=[['sectors','板块地图'],['global','全球与资金'],['plans','交易计划'],['review','复盘与学习']];
 if(sub==='auction-review') {
  const code=h('input',{name:'code',inputmode:'numeric',pattern:'[0-9]{6}',placeholder:'六位股票代码',value:ctx.stock||'',required:true});
  const date=h('input',{name:'date',type:'date'}),output=h('div',{},empty('选择股票与日期','仅查询已有竞价记录，不触发重算或推送。'));
  view.append(section('开盘前发生了什么','竞价原始记录与逐股复盘',h('form',{class:'fy-form',onSubmit:async e=>{e.preventDefault();try{const q=new URLSearchParams({code:code.value,date:date.value});const r=await ctx.api('/api/auction-review?'+q,{signal:ctx.signal});output.replaceChildren(renderEvidence(r));}catch(error){ctx.notify(error.message,'error');}}},h('div',{class:'fy-grid two'},field('股票代码',code),field('交易日',date)),h('button',{type:'submit',class:'fy-button primary'},'读取竞价复盘')),button('读取最近竞价流水',async()=>{try{const r=await ctx.api('/api/auction-log?n=80',{signal:ctx.signal});output.replaceChildren(renderEvidence(r));}catch(error){ctx.notify(error.message,'error');}}),output));
  return view;
 }
 const datasetKeys=sub==='sectors'?[['板块强度','sectors'],['涨停题材','ztBySector'],['市场主线','mainline'],['板块联动','extLink']]:sub==='global'?[['全球市场','global'],['外部资金与商品','external'],['外围预选','preselect'],['资金异动','bigMoney']]:sub==='plans'?[['下一交易日计划','nextplan'],['十四条判定','myrules'],['启动前埋伏','pre'],['补涨线索','buzhang']]:[['复盘','review'],['历史学习','learn'],['学习记录','learnHistory'],['宽度与纪律','breadth']];
 const datasets=h('div',{class:'fy-grid two'});
 let pendingPaint=false;
 const paintDatasets=()=>{if(ctx.signal?.aborted)return;if(datasets.contains(document.activeElement)){pendingPaint=true;return;}pendingPaint=false;datasets.replaceChildren(...datasetKeys.map(([title,key])=>section(title,'同一份服务端市场状态',renderEvidence(ctx.state?.[key],ctx))));};
 datasets.addEventListener('focusout',()=>queueMicrotask(()=>{if(pendingPaint)paintDatasets();}));
 paintDatasets();ctx.onState?.(paintDatasets);
 view.append(h('header',{class:'fy-view-heading'},h('span',{class:'fy-eyebrow'},'FAYO / CONTEXT'),h('h1',{},labels.find(x=>x[0]===sub)?.[1]||'市场上下文')),datasets);
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
 if(!route.sub||route.sub==='all')return renderAllOpportunities(ctx);
 if(['relay-first','relay-second'].includes(route.sub))return renderRelayCard(ctx,route.sub);
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
 view.append(simpleNavigation(ctx,active[0]),h('header',{class:'fy-view-heading'},h('span',{class:'fy-eyebrow'},'FAYO / OPPORTUNITY FIELD'),h('h1',{},'让机会，各就其位。'),h('p',{},'发现、研究、跟踪，在一个工作流里衔接。')),h('div',{class:'fy-opportunity-toolbar'},field('观察池',selector),search,field('范围',boardSelect),field('排序',sortSelect),button('读取最新结果',()=>load(),'primary')),status,summaryView,body,loadMore);
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
    if(active[0]==='relay-second')current=current.filter(isSecondBoard);
    const ownDay=key==='yierList'?state.yierAsOf:key==='lianbanList'?state.lianbanAsOf:null;
    const normalizedDay=typeof ownDay==='string'?ownDay.replaceAll('/','-').slice(0,10):null;
    const fieldDay=Object.hasOwn(state.snapshotFieldDays||{},key)?state.snapshotFieldDays[key]:state.snapshotDay||state.dashboard?.snapshotDay;
    data={items:current,snapshotDay:normalizedDay||fieldDay,isSnapshot:state.isSnapshot||state.dashboard?.isSnapshot};
   } else {
    const params=active[0]==='matches'?new URLSearchParams({limit:String(max),...(append&&cursor?{cursor}:{})}):new URLSearchParams({board:requestedBoard,max:String(max)});
    data=await ctx.readPool(active[0]+':'+requestedBoard,()=>ctx.api(active[3]+'?'+params,{signal:ctx.signal,timeoutMs:60000}));
    if(ctx.signal.aborted||turn!==loadGeneration)return;
    requirePoolReady(data);
    if(append&&snapshotIdentity&&data.snapshotId&&data.snapshotId!==snapshotIdentity){cursor='';ctx.notify('扫描快照已更新，将读取新的第一页');load(false);return;}
    snapshotIdentity=data.snapshotId||snapshotIdentity;
    const incoming=unique(rowsFrom(data.items||data)).map(row=>data.forwardTracking&&!row.forwardTracking?{...row,forwardTracking:data.forwardTracking}:row);current=append?unique([...current,...incoming]):incoming;
    cursor=data.nextCursor||'';loadMore.hidden=!data.hasMore;
   }
   if(ctx.signal.aborted||turn!==loadGeneration)return;
   summaryView.replaceChildren(...['cycle','timing','feedback','sectorView'].filter(key=>data[key]).map(key=>h('details',{class:'fy-details'},h('summary',{},({cycle:'短线周期',timing:'时机反馈',feedback:'历史反馈',sectorView:'板块结构'})[key]),renderEvidence(data[key]))));
   const day=Object.hasOwn(data,'snapshotDay')?data.snapshotDay:state.snapshotDay||state.dashboard?.snapshotDay;
   status.textContent=active[1]+' · '+current.length+' 只'+(day?' · 原始交易日 '+dayLabel(day):' · 原始交易日待核验')+(data.isSnapshot||data.snapshotRetained?' · 保留快照':'');
   if(data.freezeUnavailable||data.note)status.textContent+=' · '+(data.note||'没有已保存的盘中结果');
   paint();
  }catch(error){if(ctx.signal.aborted||turn!==loadGeneration)return;if(error.body?.status==='snapshot-changed'){cursor='';load(false);return;}status.textContent=error.message;status.className='fy-note error';if(!current.length)body.replaceChildren(empty('此次读取未完成',error.message));ctx.notify(error.message,'error');}
  finally{if(turn===loadGeneration)loadMore.disabled=false;}
 }
 ctx.onState?.(()=>load());
 load();
 return view;
}

export function isSecondBoard(row) {
 return Number(row?.level??row?.limitUpCount)===2&&
  (row?.targetLevel==null||Number(row.targetLevel)===3);
}
export function poolStateResult(pool,state) {
 const key=pool[3].slice(6);
 let items=rowsFrom(key==='focused'?(state.dashboard?.rows||[]).filter(row=>row.focused):state[key]);
 if(pool[0]==='relay-second')items=items.filter(isSecondBoard);
 const day=key==='yierList'?state.yierAsOf:key==='lianbanList'?state.lianbanAsOf:
  state.snapshotFieldDays?.[key]||state.snapshotDay||state.dashboard?.snapshotDay;
 return {items,snapshotDay:day||null};
}
export function combinePoolResults(entries,now=Date.now()) {
 const byCode=new Map();
 // Keep each source's evidence intact. Never graft one pool's quote time onto another price.
 for(const entry of entries)for(const raw of rowsFrom(entry.data)) {
  const proof={pool:entry.label,day:entry.data?.snapshotDay||null,row:raw};
  let item=byCode.get(raw.code);
  const at=quoteAt(raw),validAt=Number.isFinite(at)&&at>0&&at<=now?at:0;
  if(!item){item={row:raw,at:validAt,day:proof.day,proofs:[]};byCode.set(raw.code,item);}
  else if(validAt>item.at){item.row=raw;item.at=validAt;item.day=proof.day;}
  item.proofs.push(proof);
 }
 return [...byCode.values()].map(item=>({...item.row,poolDay:item.day,
  poolLabels:[...new Set(item.proofs.map(proof=>proof.pool))],poolEvidence:item.proofs}));
}
function simpleNavigation(ctx,active='all') {
 return h('nav',{class:'fy-grid two','aria-label':'常用卡片'},
  [['all','全部选股','opportunities'],['review','今日复盘','pulse'],['relay-first','一进二','opportunities'],['relay-second','二进三','opportunities']]
   .map(([key,label,view])=>button(label,()=>ctx.navigate(view,key),active===key?'primary':'secondary')));
}
function advancedPools(ctx) {
 const selector=h('select',{'aria-label':'选择股票池'},h('option',{value:'all'},'全部选股（默认）'),POOLS.map(([key,label])=>h('option',{value:key},label)));
 selector.addEventListener('change',()=>ctx.navigate('opportunities',selector.value));
 return h('details',{class:'fy-details'},h('summary',{},'更多筛选与工具'),field('单独查看股票池',selector),
  h('div',{class:'fy-inline'},button('市场总览',()=>ctx.navigate('pulse','market-overview')),button('板块行情',()=>ctx.navigate('pulse','sectors')),button('策略研究',()=>ctx.navigate('lab','strategies'))));
}
export function renderAllOpportunities(ctx) {
 const output=h('div'),status=h('p',{class:'fy-note',role:'status'}),diagnostics=h('div'),indexes=h('div');
 const search=h('input',{type:'search',placeholder:'搜索股票名称或代码','aria-label':'筛选全部候选'});
 let query='',shown=24,remote=[],busy=false,lastAttempt=0,generation=0;
 const more=button('显示更多股票',()=>{shown+=24;paint();});more.hidden=true;
 const refreshButton=button('刷新结果',async()=>{await ctx.refresh();await loadRemote(true);},'primary');
 const allowed=()=>POOLS.filter(pool=>pool[4]!=='edit'||ctx.role==='edit');
 function entries(){const state=ctx.state||{};return [
  ...allowed().filter(pool=>pool[3].startsWith('state:')&&pool[0]!=='relay-second').map(pool=>({label:pool[1],data:poolStateResult(pool,state)})),
  {label:'首页候选',data:{items:state.dashboard?.rows||[],snapshotDay:state.dashboard?.snapshotDay||state.snapshotFieldDays?.dashboard||state.snapshotDay}},
  ...remote.filter(entry=>!entry.private||ctx.role==='edit')];}
 function paint(){
  if(ctx.signal?.aborted)return;
  indexes.replaceChildren(ticker(ctx.state));
  const all=combinePoolResults(entries()),rows=all.filter(row=>!query||[row.name,row.code,row.sector].some(value=>String(value||'').toLowerCase().includes(query)));
  // Scores from different strategies are not calibrated against one another.
  status.textContent='已汇总 '+all.length+' 只候选 · 各股票池自动合并去重'+(busy?' · 正在读取更多结果…':'');
  output.replaceChildren(rows.length?h('div',{class:'fy-stock-grid'},rows.slice(0,shown).map(row=>stockCard(row,ctx))):empty(query?'没有匹配这次搜索的股票':'暂未取得候选结果',query?'清空搜索即可查看全部已返回结果。':'下方显示各数据源状态；未取到数据不等于没有符合条件的股票。'));
  more.hidden=shown>=rows.length;more.textContent='显示更多股票（剩余 '+Math.max(0,rows.length-shown)+' 只）';
  diagnostics.replaceChildren(...remote.map(entry=>h('p',{class:'fy-muted'},entry.label+'：'+(entry.error||entry.data?.note||rowsFrom(entry.data).length+' 只')+(entry.data?.hasMore?' · 还有分页结果，请在“全部命中”中继续查看':'')+(entry.data?.snapshotDay?' · '+dayLabel(entry.data.snapshotDay):''))),
   h('p',{class:'fy-muted'},'汇总当前服务已返回的候选，不代表全市场全部股票；单接口有返回上限。各池日期和依据分别保留，收盘后不补造盘中结果。'));
 }
 async function loadRemote(force=false){
  if(busy||ctx.signal?.aborted||!force&&lastAttempt&&Date.now()-lastAttempt<60000)return;
  busy=true;lastAttempt=Date.now();const turn=++generation;refreshButton.disabled=true;paint();
  const pools=allowed().filter(pool=>pool[3].startsWith('/api/'));
  const results=await Promise.allSettled(pools.map(async pool=>{
   // The legacy wash scanner can notify on a cache miss. Only auto-read it when the server's close gate prevents scanning.
   if(pool[0]==='wash'&&ctx.state?.trading!==false)return {label:pool[1],private:true,data:{items:[],note:'盘中自动汇总暂不读取此池；可在更多筛选中单独查看'}};
   const params=pool[0]==='matches'?'limit=50':'board=all&max=50';
   const data=await ctx.readPool(pool[0]+':all',()=>ctx.api(pool[3]+'?'+params,{signal:ctx.signal,timeoutMs:60000}));
   requirePoolReady(data);
   return {label:pool[1],private:pool[4]==='edit',data};
  }));
  if(ctx.signal?.aborted||turn!==generation)return;
  remote=results.map((result,i)=>result.status==='fulfilled'?result.value:{label:pools[i][1],private:pools[i][4]==='edit',data:remote.find(entry=>entry.label===pools[i][1])?.data,error:(result.reason?.message||'读取失败')+'；若已有结果则保留原日期'});
  busy=false;refreshButton.disabled=false;paint();
 }
 search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();shown=24;paint();});
 const view=h('div',{class:'fy-stack'},h('header',{class:'fy-view-heading'},h('h1',{},'选好的票，直接看'),h('p',{},'默认汇总全部股票池，你只需挑选想研究的股票。')),indexes,simpleNavigation(ctx),h('div',{class:'fy-inline'},search,refreshButton),status,output,more,advancedPools(ctx),h('details',{class:'fy-details'},h('summary',{},'数据状态与覆盖范围'),diagnostics));
 ctx.onState?.(()=>{paint();loadRemote();});paint();loadRemote();return view;
}
export function renderRelayCard(ctx,key) {
 const pool=POOLS.find(pool=>pool[0]===key),output=h('div'),message=h('p',{class:'fy-note',role:'status'});
 function paint(){
  if(ctx.signal?.aborted)return;
  if(ctx.role!=='edit'){output.replaceChildren(empty('此卡片需要管理者身份','账户授权保持原有权限。'));return;}
  const data=poolStateResult(pool,ctx.state||{}),day=reviewDate(data.snapshotDay);
  message.textContent=pool[1]+' · '+data.items.length+' 只 · '+(day?'原始交易日 '+day:'结果日期待核验');
  output.replaceChildren(data.items.length?h('div',{class:'fy-stack'},data.items.map(row=>detailedStockCard({...row,poolDay:day},ctx))):empty('暂未取得'+pool[1]+'候选','可能尚未满足策略条件或数据未就绪；不会放宽条件凑票。'));
 }
 const refreshButton=button('刷新'+pool[1],async()=>{
  refreshButton.disabled=true;
  try{
   if(ctx.role==='edit'){
    const result=await ctx.api('/api/refresh',{method:'POST',body:{module:key==='relay-first'?'yier':'lianban'},signal:ctx.signal});
    if(result.errors?.length)throw Error(result.errors.join('；'));
    if(result.note)ctx.notify(result.note);
   }
   await ctx.refresh();paint();
  }catch(error){if(!ctx.signal?.aborted)ctx.notify(error.message,'error');}
  finally{refreshButton.disabled=false;}
 },'primary');
 const view=h('div',{class:'fy-stack'},h('header',{class:'fy-view-heading'},h('h1',{},pool[1])),simpleNavigation(ctx,key),refreshButton,message,output,advancedPools(ctx));
 ctx.onState?.(paint);paint();return view;
}
export function reviewDate(value) {
 const day=String(value||'').replace(/[-/]/g,'').slice(0,8);
 return /^\d{8}$/.test(day)?day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6):null;
}
export function summarizeReview(review) {
 const rows=unique(rowsFrom(review)),sectors=new Map(),ladder=new Map();
 let unknownLevel=0;
 for(const row of rows){
  const level=row.limitUpCount;
  if(Number.isInteger(level)&&level>0){if(!ladder.has(level))ladder.set(level,[]);ladder.get(level).push(row);}else unknownLevel++;
  const name=typeof row.sector==='string'&&row.sector.trim()?row.sector.trim():null;
  if(name){if(!sectors.has(name))sectors.set(name,[]);sectors.get(name).push(row);}
 }
 const groups=[...sectors].map(([name,items])=>({name,items,count:items.length,highest:Math.max(0,...items.map(row=>Number.isInteger(row.limitUpCount)?row.limitUpCount:0))})).sort((a,b)=>b.count-a.count||b.highest-a.highest||a.name.localeCompare(b.name,'zh-CN'));
 const opened=rows.filter(row=>typeof row.breakCount==='number'&&Number.isFinite(row.breakCount)&&row.breakCount>0);
 const belowMa=rows.filter(row=>row.aboveMa5===false),missingHistory=rows.filter(row=>typeof row.aboveMa5!=='boolean');
 const seals=rows.filter(row=>typeof row.sealAmount==='number'&&Number.isFinite(row.sealAmount)&&row.sealAmount>0).sort((a,b)=>b.sealAmount-a.sealAmount);
 return {rows,groups,ladder:[...ladder].sort((a,b)=>b[0]-a[0]),unknownLevel,opened,belowMa,missingHistory,seals,
  first:ladder.get(1)?.length||0,continued:rows.length-(ladder.get(1)?.length||0)-unknownLevel,
  highest:ladder.size?Math.max(...ladder.keys()):null,reported:typeof review?.ztN==='number'&&Number.isFinite(review.ztN)?review.ztN:null};
}
export function reviewCoverage(review) {
 const rows=unique(rowsFrom(review)),members=Array.isArray(review?.poolMembers)?unique(review.poolMembers):null;
 const codes=new Set(rows.map(row=>row.code)),day=reviewDate(review?.date);
 const batches=(Array.isArray(review?.poolEvidence)?review.poolEvidence:[]).filter(e=>e&&e.source==='em'&&reviewDate(e.tradeDate)===day&&day&&Number.isSafeInteger(e.reportedCount)&&e.reportedCount>=0&&Number.isSafeInteger(e.returnedCount)&&e.returnedCount>=0&&Number.isSafeInteger(e.uniqueCount)&&e.uniqueCount>=0);
 const source=batches.length===1?batches[0]:null;
 return {source,analyzed:rows.length,missing:members?members.filter(row=>!codes.has(row.code)):null,
  supplements:members?members.filter(row=>row.src==='derive'):[],
  sourceIncomplete:source?source.reportedCount!==source.uniqueCount||source.returnedCount!==source.uniqueCount:null};
}
export function renderDailyReview(ctx) {
 let updateSource;
 const sourceContext={get state(){return ctx.state;},signal:ctx.signal,selectStock:(...args)=>ctx.selectStock(...args),onState:fn=>{updateSource=fn;}};
 const output=h('div',{class:'fy-stack'}),sourcePool=renderSourceReviewPool(sourceContext,stockCard);
 const openRow=row=>button((row.name||row.code)+' '+row.code,()=>ctx.selectStock(row.code,row),'quiet');
 const metric=(label,value)=>h('div',{class:'fy-kpi'},h('span',{},label),h('strong',{},value));
 function paint(){
  if(ctx.signal?.aborted||output.contains(document.activeElement))return;
  const state=ctx.state||{},review=state.review,day=reviewDate(review?.date),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  const summary=summarizeReview(review),coverage=reviewCoverage(review),current=day===today,marketDay=reviewDate(state.dashboard?.snapshotDay||state.snapshotFieldDays?.dashboard||state.snapshotDay);
  if(!review){output.replaceChildren(empty('今日复盘尚未生成','等待服务端收盘行情与复盘任务，刷新只读取实际结果。'),sourcePool);return;}
  const dateNote=current?'原始交易日 '+day+' · 生成于 '+(review.time||'时间待核验'):day?'今天的报告尚未返回，下面保留 '+day+' 的原报告。':'报告缺少原始日期，不能标记为今日复盘。';
  const summaryPanel=section(current?'今日复盘':day?'最近复盘 · '+day:'日期待核验的复盘',dateNote,
   h('div',{class:'fy-grid two'},metric('复盘股票',summary.rows.length+' 只'),metric('首板',summary.first+' 只'),metric('连板',summary.continued+' 只'),metric('最高连板',summary.highest==null?'未知':summary.highest+' 板')),
   h('p',{},summary.groups.length?'本次涨停样本最集中的板块是'+summary.groups[0].name+'，共 '+summary.groups[0].count+' 只；'+(summary.highest?'最高高度为 '+summary.highest+' 板。':'连板高度待核验。'):'板块证据不足，暂不判断主线。'),
   h('p',{class:'fy-muted'},'统计范围仅为这份复盘返回的股票，不代表全市场。'+(summary.reported!=null&&summary.reported!==summary.rows.length?'报告记录的输入数量 '+summary.reported+' 与明细 '+summary.rows.length+' 不一致，覆盖范围待核验。':'')+(summary.unknownLevel?'其中 '+summary.unknownLevel+' 只缺少有效连板高度。':'')),
   review.head&&h('details',{class:'fy-details'},h('summary',{},'原始收盘摘要'),h('p',{},review.head)));
  const coveragePanel=section('涨停数量核对','数据源总数、接收明细和分析数量分别保留',
   h('p',{},coverage.source?'东财池统计 '+coverage.source.reportedCount+' 只 · 实收 '+coverage.source.returnedCount+' 条 · 有效代码 '+coverage.source.uniqueCount+' 只 · 本报告 '+coverage.analyzed+' 只':'本报告 '+coverage.analyzed+' 只；未保存可核验的源端总数，不能认定已覆盖全部涨停。'),
   coverage.sourceIncomplete&&note('源端总数与实收明细不一致，覆盖范围待核验；不按现有明细数量代替总数。'),
   coverage.missing===null?note('原报告未保存输入股票名单，暂不能定位未分析股票。'):coverage.missing.length?h('div',{},note('同批涨停池中有 '+coverage.missing.length+' 只未进入本报告：'),h('div',{class:'fy-inline'},coverage.missing.map(openRow))):h('p',{class:'fy-muted'},'本报告已覆盖保存的输入股票名单；不代表源端全市场覆盖已验证。'),
   coverage.supplements.length>0&&h('div',{},h('p',{},'另有快照推导补充 '+coverage.supplements.length+' 只，与东财原始池分开核对：'),h('div',{class:'fy-inline'},coverage.supplements.map(openRow))));
  const market=section('市场概况','市场快照与复盘日期分别核对',marketDay===day&&day?ticker(state):note('市场快照日期 '+(marketDay||'未知')+'，与本次复盘未确认一致，暂不合并为今日市场结论。'),
   marketDay===day&&day&&h('p',{},state.dashboard?.mood?.note||'尚无可用的市场情绪摘要。'));
  const sectors=section('强势主线','按复盘股票的主板块分组；集中度不等于次日表现',summary.groups.length?h('div',{class:'fy-grid two'},summary.groups.slice(0,6).map(group=>h('article',{class:'fy-item'},h('h3',{},group.name),h('p',{},group.count+' 只 · 最高 '+(group.highest||'未知')+' 板'),h('div',{class:'fy-inline'},group.items.slice(0,3).map(openRow)),h('p',{class:'fy-muted'},'来源：'+(review.themeSrc||'来源待核验'))))):empty('缺少板块归属','不能从股票名称推测题材。'));
  const ladder=section('连板梯队','直接查看各高度股票',summary.ladder.length?h('div',{class:'fy-grid two'},summary.ladder.map(([level,rows])=>h('article',{class:'fy-item'},h('h3',{},level===1?'首板':level+' 板'),h('p',{},rows.length+' 只'),h('div',{class:'fy-inline'},rows.slice(0,8).map(openRow)),rows.length>8&&h('small',{},'其余股票见下方完整清单')))):empty('连板数据不足'));
  const seals=section('封单与开板情况','仅分析本次涨停样本，不把涨停股中的开板记录当作全市场炸板率',
   h('p',{},'接口记录有盘中开板的涨停股：'+summary.opened.length+' 只。未提供完整炸板池，无法计算全市场封板率、炸板率和晋级成功率。'),
   summary.seals.length?table([{label:'股票',value:openRow},{label:'封单额',value:row=>money(row.sealAmount)},{label:'接口记录开板次数',value:row=>typeof row.breakCount==='number'?format(row.breakCount,0):'未知'}],summary.seals.slice(0,5)):empty('没有可核验的封单金额'));
  const risks=section('风险线索','逐条对应现有记录，不把缺失当作零风险',
   h('p',{},'有开板记录 '+summary.opened.length+' 只；接口标记未站上 MA5 '+summary.belowMa.length+' 只；MA5 状态缺失 '+summary.missingHistory.length+' 只。'),
   h('div',{class:'fy-inline'},unique([...summary.opened,...summary.belowMa]).slice(0,6).map(openRow)),
   note('现有复盘未提供完整资金原始时间、逐条新闻因果证据及失败样本；暂不据此推断资金持续流入或次日上涨概率。'));
  const plans=section('下一交易日观察重点','只采用与本次复盘同日的接力候选；候选不等于买入指令',
   h('div',{class:'fy-grid two'},['relay-first','relay-second'].map(key=>{
    const pool=POOLS.find(item=>item[0]===key),data=poolStateResult(pool,state),sameDay=day&&reviewDate(data.snapshotDay)===day;
    return h('article',{class:'fy-item'},h('h3',{},pool[1]),ctx.role!=='edit'?note('此候选池需要管理者身份'):sameDay&&data.items.length?h('div',{class:'fy-stack'},data.items.slice(0,3).map(row=>h('div',{},openRow(row),h('p',{},reasons(row).join('；')||'未返回选择依据，暂不作判断。')))):note('暂无与本次复盘同日的候选'+(data.snapshotDay?'；最近结果日期 '+dayLabel(data.snapshotDay):'')),button('查看'+pool[1],()=>ctx.navigate('opportunities',key)));
   })),h('p',{class:'fy-muted'},'竞价、成交量和板块延续需在下一交易日由新数据确认；条件未确认前保持观察。'));
  const records=section('完整复盘清单','点击股票查看原始依据与走势',summary.rows.length?renderEvidence(summary.rows.map(row=>({...row,poolDay:day})),ctx):empty('尚无复盘股票明细',review.note||'源数据未就绪或尚未生成明细，不能认定为今日无涨停。'));
  output.replaceChildren(summaryPanel,coveragePanel,sourcePool,market,sectors,section('涨停板 · 板块分类','龙头 / 龙二 / 中军 / 跟风沿用服务端分类；题材强势可包含未涨停股。每板最多返回 10 只，涨停总数与展示数口径不同。',sectorRoleCards(state,day,ctx)),ladder,seals,risks,plans,section('次日计划 · 条件与风险','保留原计划的依据、确认条件与失效条件',nextPlanCards(state,day,ctx)),records,h('details',{class:'fy-details'},h('summary',{},'原始报告与覆盖证据'),renderEvidence(review,ctx)));
 }
 const refreshButton=button('刷新复盘',async()=>{refreshButton.disabled=true;try{await ctx.refresh();paint();}finally{refreshButton.disabled=false;}},'primary');
 const view=h('div',{class:'fy-stack'},h('header',{class:'fy-view-heading'},h('h1',{},'今日复盘')),simpleNavigation(ctx,'review'),phaseLabel(),refreshButton,output,
  h('details',{class:'fy-details'},h('summary',{},'更多记录'),button('人工交易执行记录',()=>ctx.navigate('assets','closure')),button('历史学习',()=>ctx.navigate('lab','learning'))));
 ctx.onState?.(()=>{updateSource?.();paint();});paint();return view;
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
 const close=()=>{
  generation++;controller?.abort();drawer.hidden=true;overlay.hidden=true;document.body.classList.remove('fy-drawer-open');
  // A shared-state refresh may replace the originating opportunity while the
  // drawer is open. Restore the same stock in the current DOM in that case.
  const origin=previousFocus?.isConnected?previousFocus:
   [...document.querySelectorAll('.fy-stock-card[data-code="'+code+'"]')].find(node=>!node.disabled&&node.getClientRects().length);
  origin?.focus?.();
 };
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
   body.replaceChildren(stockTactics(code),section('实际命中与风险','只展示当前返回的条件',reasons(row).length?h('ol',{class:'fy-evidence-list'},reasons(row).map(r=>h('li',{},r))):empty('尚未返回逐条命中依据','可以在实验室读取同股研究档案。')),renderEvidence(row?.conditions||row?.conditionEvidence||row?.conditionInputs||row?.items||null),h('details',{class:'fy-details'},h('summary',{},'完整研究记录'),renderEvidence(row)));
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
   const date=h('input',{type:'date','aria-label':'标记交易日'}),output=h('div');let markRequest=0;
   date.addEventListener('input',()=>{markRequest++;output.replaceChildren();});
   body.replaceChildren(section('当日信号标记','与原K线标记接口相同的服务端记录',field('交易日',date),ctx.role==='edit'?button('读取原始标记',async()=>{const requestedCode=code,requestedDate=date.value,turn=generation,requestController=controller,request=++markRequest;try{const q=new URLSearchParams({code:requestedCode,date:requestedDate});const result=await ctx.api('/api/kline-marks?'+q,{signal:requestController.signal});if(turn===generation&&code===requestedCode&&date.value===requestedDate&&request===markRequest&&tab==='marks'&&!requestController.signal.aborted)output.replaceChildren(renderEvidence(result));}catch(error){if(turn===generation&&request===markRequest&&tab==='marks'&&error.name!=='AbortError')ctx.notify(error.message,'error');}}):note('逐股私密标记需要开发者权限'),output));
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
