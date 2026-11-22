// V6 unified financial terminal: presentation only.
// All figures come from the existing authenticated state and retain their original evidence.
// No synthetic quotes, trade actions or new backend contracts are introduced here.
import {h,button,empty,section,format,money,percent,direction,dayLabel,dateTime,table,icon} from './ui.js';
import {ticker,quoteLabel,rowsFrom,summarizeReview,reviewCoverage,reviewDate,projectDecisionBrief,systemPicks,replaceKeepingStockFocus,recoveryDisclosure,observedMarketValues,coveragePanel,closeSessionDay,closingWatch,closingWatchPanel,distributionPanel,marketOverviewCards,publishedReasons} from './market.js';
import {newsRows,stockReasons,limitReasonEvidence,reviewSupplier,recoveredMetric} from './market-evidence.js';
import {renderCloseReview} from './close-review.js';

const valid = value => typeof value==='number' && Number.isFinite(value);
const number = value => valid(value)?format(value,0):'—';
const asDay = value => reviewDate(value)||'交易日待核验';
const nameOf = row => row?.name||row?.code||'名称待核验';

function stat(label,value,detail,kind='') {
 return h('article',{class:'fy-terminal-stat '+kind},
  h('span',{},label),h('strong',{},value),h('small',{},detail));
}
function updateStats(host,values) {
 const cards=values.map(([label,value,detail,kind])=>stat(label,value,detail,kind));
 // Keep unchanged KPI cards in place across background reads and disclosures.
 if(host.children.length===cards.length&&cards.every((card,i)=>card.isEqualNode(host.children[i])))return;
 host.replaceChildren(...cards);
}
function decisionStat(label,value,detail) {
 return h('article',{class:'fy-kpi'},h('span',{},label),h('strong',{},value),h('small',{},detail));
}
function moduleButton(label,view,sub,ctx) {
 return button(label,()=>ctx.navigate(view,sub),'secondary');
}
function panelTitle(label,key) {
 return [h('span',{class:'fy-reference-panel-icon'},icon(key)),label];
}
function quotePreview(row,ctx) {
 const score=valid(row.score)?format(row.score,1):'—';
 const pct=percent(row.pct);
 const reasons=stockReasons(row).join('；');
 const card=h('button',{type:'button',class:'fy-stock-card fy-reference-candidate','data-code':row.code,
  'aria-label':'研究 '+nameOf(row),onClick:()=>ctx.selectStock(row.code,row,card)},
  h('span',{class:'fy-reference-candidate-name'},h('strong',{},nameOf(row)),h('small',{},row.code)),
  h('span',{class:'fy-reference-candidate-sector',title:reasons||null},row.sector||row.industry||'板块待核验'),
  h('span',{class:'fy-reference-candidate-score'},score),
  h('span',{class:'fy-reference-candidate-price '+direction(row.pct)},format(row.price),h('small',{},pct)),
  h('span',{class:'fy-reference-candidate-link'},'查看 ›'),
  h('small',{class:'fy-reference-candidate-source',title:quoteLabel(row)},row.poolDay?'结果 '+dayLabel(row.poolDay)+' · ':'',quoteLabel(row)));
 return card;
}
function referenceLinks(items,ctx,className) {
 return h('nav',{class:className,'aria-label':'常用研究入口'},items.map(([label,view,sub,symbol])=>
  button(h('span',{},icon(symbol),h('span',{},label)),()=>ctx.navigate(view,sub),'secondary')));
}
function renderPanels(state,summary,reviewDay,ctx) {
 const marketDay=reviewDate(state.snapshotFieldDays?.dashboard||state.dashboard?.snapshotDay||state.snapshotDay);
 const mainline=section(panelTitle('市场主线排行','pulse'),'仅按当前复盘明细的题材归组',
  summary.groups.length?
   h('div',{class:'fy-terminal-lines'},
    h('div',{class:'fy-reference-rank-head','aria-hidden':'true'},['排名','题材','涨停样本','最高板'].map(label=>h('small',{},label))),
    summary.groups.slice(0,5).map((g,i)=>
    h('div',{class:'fy-terminal-line fy-reference-ranked'},h('b',{class:'fy-reference-rank'},i+1),
     h('strong',{},g.name),h('span',{},g.count+' 只'),h('small',{},g.highest?g.highest+' 板':'高度未知')))):
   empty('缺少复盘板块证据','保留未知，不根据股票名称猜测所属题材。'),
  moduleButton('查看完整主线','pulse','review-details',ctx));
 const roles=Array.isArray(state.ztBySector)?state.ztBySector:[];
 const roleDay=reviewDate(state.snapshotFieldDays?.ztBySector||state.ztDay);
 const roleRows=reviewDay&&roleDay===reviewDay?roles.slice(0,5):[];
 const roleItems=roleRows.map(group=>{
  const members=(Array.isArray(group.stocks)?group.stocks:[]).slice(0,4).map(row=>{
   const role=({leader:'龙头',deputy:'龙二',mid:'中军',follow:'跟风'})[row.role]||null;
   return h('span',{class:'fy-terminal-chip','data-role':role?row.role:null},row.name||row.code||'名称未知',
    role?h('small',{},' · '+role):null);
  });
  return h('div',{class:'fy-terminal-sector'},
   h('div',{class:'fy-terminal-line'},
    h('strong',{},group.sector||'板块待核验'),
    h('span',{},valid(group.count)?number(group.count)+' 只':'数量未知')),
   h('div',{class:'fy-terminal-chips'},members));
 });
 const board=section(panelTitle('涨停板 · 板块分类','spark'),
  '按源端题材与角色分类',
  roleItems.length?h('div',{class:'fy-terminal-lines'},
   h('div',{class:'fy-reference-role-legend','aria-label':'题材角色'},[['leader','龙头'],['deputy','龙二'],['mid','中军'],['follow','跟风']].map(([role,label])=>
    h('span',{class:'fy-terminal-chip','data-role':role},label))),roleItems):
   empty('没有可核验的同日板块分类','本次复盘 '+(reviewDay||'日期未知')+
    '，板块分类 '+(roleDay||'日期未知')+'；日期不一致时不混用。'),
  moduleButton('查看全部板块','pulse','sectors',ctx));
 const sectors=Array.isArray(state.sectors)?state.sectors:Array.isArray(state.sectors?.items)?state.sectors.items:[];
 // The retained client may preserve sectors from an earlier trading day while
 // the dashboard and review advance. Only the field's own original day can
 // authorize this preview; a fresh receivedAt or page refresh cannot.
 const sectorDay=reviewDate(state.snapshotFieldDays?.sectors||state.sectorsDay);
 const aligned=Boolean(sectorDay&&marketDay&&sectorDay===marketDay&&(!reviewDay||sectorDay===reviewDay));
 // Only explicitly Yuan-valued fields are converted to 亿/万. Never turn
 // missing units into money or show yesterday's funds as today's ranking.
 const capital=aligned?sectors.filter(row=>row&&typeof(row.name||row.sector)==='string'&&
   (valid(row.mainInflowYuan)||valid(row.netInflowYuan))).map(row=>({
    name:row.name||row.sector,value:valid(row.mainInflowYuan)?row.mainInflowYuan:row.netInflowYuan
   })).sort((a,b)=>b.value-a.value).slice(0,5):[];
 const max=Math.max(1,...capital.map(row=>Math.abs(row.value)));
 const dateIssue=!sectorDay?'板块资金原始交易日缺失':
  !marketDay?'大盘快照日期缺失，无法比较资金日期':
  sectorDay!==marketDay?'板块资金 '+sectorDay+' 与大盘 '+marketDay+' 不同日':
  reviewDay&&sectorDay!==reviewDay?'板块资金 '+sectorDay+' 与复盘 '+reviewDay+' 不同日':'';
 const flows=section(panelTitle('板块资金排行','assets'),
  '资金来源交易日 '+(sectorDay||'待核验'),
  !aligned?empty('资金来源交易日待核验',dateIssue+'；暂不展示排名，请进入原资金模块核对。'):
   capital.length?h('div',{class:'fy-terminal-flows'},capital.map(row=>
    h('div',{class:'fy-terminal-flow'},
     h('span',{},row.name),
     h('span',{class:'fy-terminal-bar'},h('i',{style:'width:'+Math.max(3,100*Math.abs(row.value)/max).toFixed(1)+'%'})),
     h('strong',{class:direction(row.value)},money(row.value))))):
    empty('尚无单位明确的板块资金数据','原资金模块可能有其他单位或缺失项，请核验数据来源与字段。'),
  moduleButton('查看资金证据','pulse','sectors',ctx));
 return h('div',{class:'fy-terminal-panels'},mainline,board,flows);
}
function renderReviewRows(summary,ctx,tradeDate) {
 const data=summary.rows.slice(0,200);
 const select=row=>ctx.selectStock(row.code,{...row,poolDay:row.poolDay||tradeDate});
 const open=row=>button(nameOf(row)+' '+row.code,()=>select(row),'quiet');
 const reasonView=row=>{
  const source=limitReasonEvidence(row,row.reasonRaw,tradeDate);
  const inference=typeof row.reason==='string'?row.reason.trim():'';
  return h('span',{class:'fy-reference-review-basis'},source?.reason||'源端原因待核验',
   source?h('small',{},reviewSupplier(source.reasonSource)+' · '+source.reasonDay):null,
   inference&&inference!==source?.reason?h('small',{},'复盘推断 · '+inference):null);
 };
 const columns=[
  {label:'股票 / 代码',value:open},
  {label:'板次',value:row=>h('span',{class:'fy-terminal-mobile-board'},Number.isInteger(row.limitUpCount)&&row.limitUpCount>0?row.limitUpCount+' 板':'未知')},
  {label:'封单金额',value:row=>money(row.sealAmount)},
  {label:'开板次数',value:row=>number(row.breakCount)},
  {label:'换手率',value:row=>valid(row.turnover)?format(row.turnover,1)+'%':'—'},
  {label:'主力净额',value:row=>h('span',{class:direction(row.mainInflow)},money(row.mainInflow))},
  {label:'5 日线',value:row=>typeof row.aboveMa5==='boolean'?h('span',{class:'fy-reference-ma', 'data-above':String(row.aboveMa5)},row.aboveMa5?'线上':'线下'):'—'},
  {label:'题材',value:row=>row.sector||'待核验'},
  {label:'涨停原因',value:reasonView},
  {label:'操作',value:row=>button('K 线',()=>select(row),'quiet')}
 ];
 if(!data.length)return empty('暂无可核验的涨停明细','没有数据不代表没有涨停；请检查源端池、返回上限和复盘任务。');
 const mobile=data.map(row=>{
  const level=Number.isInteger(row.limitUpCount)&&row.limitUpCount>0?row.limitUpCount+' 板':'板次待核验';
  const items=[
   ['封单金额',money(row.sealAmount)],
   ['开板',number(row.breakCount)+' 次'],
   ['换手率',valid(row.turnover)?format(row.turnover,1)+'%':'—'],
   ['主力净额',money(row.mainInflow)]
  ];
  return h('article',{class:'fy-terminal-mobile-stock','data-code':row.code},
   h('div',{class:'fy-terminal-mobile-stock-head'},
    open(row),h('span',{class:'fy-terminal-mobile-board'},level)),
   h('p',{class:'fy-terminal-mobile-sector'},row.sector||'题材待核验'),
   h('dl',{class:'fy-terminal-mobile-metrics'},items.map(([label,value])=>
    h('div',{},h('dt',{},label),h('dd',{},value)))),
   h('div',{class:'fy-terminal-mobile-basis'},h('strong',{},'涨停原因'),reasonView(row)),
   h('small',{class:'fy-terminal-mobile-source'},quoteLabel(row)));
 });
 const mobileGrid=h('div',{class:'fy-terminal-mobile-cards','aria-label':'iPhone 17 Pro 纵向复盘卡片'},mobile.slice(0,12));
 mobileGrid.id='fy-terminal-mobile-review-list';
 const remaining=data.length-12;
 let expanded=false;
 const expand=remaining>0?button('展开其余 '+remaining+' 条复盘明细',()=>{
  expanded=!expanded;
  mobileGrid.replaceChildren(...(expanded?mobile:mobile.slice(0,12)));
  expand.setAttribute('aria-expanded',String(expanded));
  expand.textContent=expanded?'收起到前 12 条':'展开其余 '+remaining+' 条复盘明细';
 },'secondary'):null;
 if(expand){
  expand.className+=' fy-terminal-review-expand';
  expand.setAttribute('aria-controls','fy-terminal-mobile-review-list');
  expand.setAttribute('aria-expanded','false');
 }
 return h('div',{class:'fy-terminal-review-layout'},
  h('div',{class:'fy-terminal-desktop-table'},table(columns,data)),
  mobileGrid,
  expand?h('div',{class:'fy-terminal-review-more'},expand):null,
  summary.rows.length>data.length?h('p',{class:'fy-terminal-hint'},'当前页面最多展示200条原复盘明细；其余请打开详细复盘。'):null);
}

function referenceReviewStats(review,summary,source) {
 const knownHigh=summary.rows.filter(row=>typeof row.breakHigh==='boolean');
 const knownMA=summary.rows.filter(row=>typeof row.aboveMa5==='boolean');
 const proofCount=summary.rows.filter(row=>limitReasonEvidence(row,row.reasonRaw,review?.date)).length;
 return [
  [source?'来源池涨停总数':'复盘涨停样本',source?number(source.reportedCount):review?number(summary.rows.length):'—',source?'源端 '+number(source.returnedCount)+' 条 · 明细 '+number(summary.rows.length)+' 只':review?.displayScope||'本次复盘明细','accent'],
  ['首板',review?number(summary.first):'—','本次复盘样本'],
  ['连板',review?number(summary.continued):'—','本次复盘样本'],
  ['题材数',review?number(summary.groups.length):'—','按已返回明细归组'],
  ['开板记录',summary.rows.some(r=>Number.isInteger(r.breakCount))?number(summary.opened.length):'—','不是全市场炸板率','calm'],
  knownMA.length?['5日线上',number(knownMA.filter(r=>r.aboveMa5).length),'已核 '+knownMA.length+' 只']:['已核涨停原因',number(proofCount),'同日来源标注'],
  knownHigh.length?['破前高',number(knownHigh.filter(r=>r.breakHigh).length),'已核 '+knownHigh.length+' 只']:['最高连板',summary.highest?number(summary.highest)+' 板':'—','已知梯队']
 ];
}

export function renderTerminalOverview(ctx) {
 const view=h('div',{class:'fy-terminal fy-stack','data-v6-workbench':'true'});
 const title=h('header',{class:'fy-terminal-title'},
  h('div',{},h('span',{class:'fy-terminal-eyebrow'},'FAYO / V6'),h('h1',{},'盘面总览')),
  h('div',{class:'fy-terminal-actions'},
   moduleButton('详细复盘','pulse','review',ctx),
   moduleButton('智能选股','opportunities','all',ctx),
   button('刷新云端数据',()=>ctx.refresh(),'primary')));
 const status=h('div',{class:'fy-terminal-provenance',role:'status','aria-live':'polite'});
 const indexHost=h('div',{class:'fy-terminal-index'});
 const statsHost=h('div',{class:'fy-terminal-stats'});
 const prioritiesHost=h('section',{class:'fy-terminal-priorities','aria-label':'市场、机会、风险和下一步'});
 const decisionsHost=h('section',{class:'fy-section fy-panel fy-terminal-decisions','data-v6-decision-brief':'true','aria-label':'逐股决策仪表盘'});
 const panelsHost=h('div',{class:'fy-terminal-context'});
 const reviewHost=h('section',{class:'fy-section fy-panel fy-terminal-review'});
 reviewHost.append(h('header',{class:'fy-terminal-review-head'},
  h('div',{},h('h2',{},'每日复盘 · 涨停形态与归因'),h('p',{},'按原报告明细展示。未独立核实的题材不是涨停因果证明。')),
  moduleButton('全部复盘与归因','pulse','review',ctx)));
 const reviewSnapshot=h('div',{class:'fy-reference-review-snapshot'});
 const list=h('div',{class:'fy-terminal-review-list'});
 const homeDetails=h('details',{class:'fy-reference-home-details'},h('summary',{},'查看逐股明细'),list);
 reviewHost.append(reviewSnapshot,homeDetails);
 let reviewFilter='all';
 const filters=h('div',{class:'fy-reference-review-filters','aria-label':'复盘明细筛选'});
 function paintReview(summary) {
  const groups=[['all','全部',summary.rows],['first','首板',summary.rows.filter(r=>r.limitUpCount===1)],
   ['continued','连板',summary.rows.filter(r=>Number.isInteger(r.limitUpCount)&&r.limitUpCount>1)],
   ['opened','有开板记录',summary.opened],['new-high','破前高',summary.rows.filter(r=>r.breakHigh===true)]];
  if(!filters.children.length){
   for(const [key,label] of groups){
    filters.append(button(label,()=>{reviewFilter=key;paintReview(summarizeReview(ctx.state?.review));},'quiet'));
   }
  }
  for(const [index,[key,label,rows]] of groups.entries()){
   const control=filters.children[index];
   control.textContent=label+' '+rows.length;
   control.setAttribute('aria-pressed',String(key===reviewFilter));
  }
  const rows=groups.find(([key])=>key===reviewFilter)[2];
  list.replaceChildren(rows.length||reviewFilter==='all'?renderReviewRows({...summary,rows},ctx,ctx.state?.review?.date):
   empty('该筛选下暂无复盘记录'));
 }
 reviewHost.children[0].append(filters);
 const quick=h('details',{class:'fy-terminal-quick'},
  h('summary',{},'更多业务功能'),
  h('nav',{class:'fy-terminal-shortcuts','aria-label':'业务功能快捷入口'},[
   ['选股核心','opportunities','all'],['涨停预选','opportunities','ztpre'],
   ['板次日接力','opportunities','relay-first'],['趋势票池','opportunities','trend'],
   ['盘中异动','opportunities','movement'],['风控系统','assets','risk'],
   ['模拟盘','assets','paper'],['我的持仓','assets','holdings'],
   ['十四条选股','opportunities','conditions'],['策略中心','lab','strategies'],
   ['明日计划','pulse','plans'],['消息面','inbox','all']
  ].map(([label,module,sub])=>moduleButton(label,module,sub,ctx))));
 const candidatePreview=h('div',{class:'fy-terminal-preview-cards'});
 const candidateHead=h('div',{class:'fy-reference-candidate-head','aria-hidden':'true'},['股票 / 代码','题材','评分','价格 / 涨幅','研判'].map(label=>h('span',{},label)));
 const candidates=h('section',{class:'fy-terminal-candidates fy-terminal-preview'},
  h('header',{class:'fy-terminal-preview-head'},
   h('div',{},h('h2',{},panelTitle('今日精选','spark')),h('p',{class:'fy-terminal-hint'},'云端候选 · 按原始报价展示')),
   moduleButton('查看系统精选','opportunities','ranked',ctx)),
  candidateHead,
  candidatePreview);
 // New sections project the same authenticated state; they never fetch, mutate or simulate trading.
 const signalContent=h('div',{class:'fy-reference-signal-body'});
 const fundsContent=h('div',{class:'fy-reference-funds-body'});
 const newsContent=h('div',{class:'fy-reference-news-body'});
 const accountContent=h('div',{class:'fy-reference-account-body'});
 const chartContent=h('div',{class:'fy-reference-chart-body'});
 const ladderContent=h('div',{class:'fy-reference-ladder-body'});
 const syncContent=h('div',{class:'fy-reference-sync-body'});
 let recoveryDetails,signalSignature='';
 const signalPanel=section(panelTitle('今日策略信号','pulse'),'',
  signalContent,h('div',{class:'fy-reference-actions'},
   moduleButton('查看风控','assets','risk',ctx),moduleButton('研究机会','opportunities','all',ctx)));
 signalPanel.classList.add('fy-reference-signal');
 let flowMode='in';
 const flowButtons=['in','out'].map((mode,i)=>button(i===0?'资金流入榜':'资金流出榜',()=>{
  flowMode=mode;paintFunds(ctx.state||{},reviewDate(ctx.state?.review?.date));
 },'secondary'));
 const fundsPanel=section(panelTitle('板块资金流向','assets'),'',h('div',{class:'fy-reference-flow-switch','aria-label':'资金排名方向'},flowButtons),fundsContent,
  moduleButton('查看全部资金','pulse','sectors',ctx));
 fundsPanel.classList.add('fy-reference-funds');
 const ladderPanel=section('龙头梯队','按复盘板次排列',ladderContent,moduleButton('查看接力候选','opportunities','relay-first',ctx));
 const newsPanel=section('新闻因子','',newsContent,
  moduleButton('全部资讯','inbox','all',ctx));
 const accountPanel=section('我的账户','',accountContent,
  h('div',{class:'fy-reference-actions'},
   moduleButton('查看持仓','assets','holdings',ctx),moduleButton('模拟盘','assets','paper',ctx)));
 const chartPanel=section('大盘 K 线','',chartContent,
  moduleButton('查看指数与行情','pulse','sectors',ctx));
 const strategiesPanel=section('36种选股策略','',referenceLinks([
   ['多因子评分','lab','strategies','spark'],['十四条选股','opportunities','conditions','settings'],
   ['技术形态','opportunities','trend','pulse'],['策略实验室','lab','desk','lab'],
   ['回测研究','lab','backtest','pulse'],['更多策略（36）','lab','models','lab']
  ],ctx,'fy-reference-strategy-links'));
 const riskPanel=section('风险控制','旧报价、缺失来源或未认证数据不会升格为交易信号',
  h('div',{class:'fy-reference-risk-list'},
   h('span',{},'行情新鲜度：逐股核验'),h('span',{},'仓位与止损：查看原规则'),
   h('span',{},'订单许可：仅由独立交易门禁决定')),
  moduleButton('查看风控系统','assets','risk',ctx));
 const syncPanel=section('多端同步','',syncContent,moduleButton('查看连接诊断','settings','diagnostics',ctx));
 view.classList.add('fy-reference-home');
 const mobileLinks=referenceLinks([
  ['涨停复盘','pulse','review','pulse'],['资金流向','pulse','sectors','pulse'],
  ['新闻因子','inbox','all','bell'],['板块排行','pulse','sectors','spark'],
  ['龙头榜','opportunities','relay-first','spark'],['K线图谱','pulse','market-overview','pulse'],
  ['回测','lab','backtest','lab'],['模拟盘','assets','paper','assets']
 ],ctx,'fy-reference-mobile-links');
 view.append(title,status,indexHost,statsHost,prioritiesHost,
  h('div',{class:'fy-reference-topgrid'},signalPanel,mobileLinks,candidates,fundsPanel),
  h('div',{class:'fy-reference-midgrid'},reviewHost,ladderPanel,newsPanel,accountPanel),
  h('div',{class:'fy-reference-lowergrid'},chartPanel,strategiesPanel,riskPanel,syncPanel),
  decisionsHost,panelsHost,quick);
 if(ctx.canEdit===true){
  const body=h('div',{'aria-live':'polite'}),research=section('分环境战法绩效','多头、震荡和空头下的成熟样本',body);
  // Preserve the original desktop and mobile panel order and first paint.
  research.setAttribute('style','order:11');research.setAttribute('data-home-research','performance');view.append(research);
  let observer=null;
  const authorized=()=>ctx.canEdit===true&&!ctx.signal?.aborted;
  const hide=()=>{observer?.disconnect();research.hidden=true;body.replaceChildren();};
  const mount=()=>{observer?.disconnect();if(!authorized()){hide();return;}
    import('./shortline/home-performance.mjs').then(m=>{if(authorized())return m.mountHomePerformance(body,ctx);})
      .catch(()=>{if(authorized())body.replaceChildren(h('p',{class:'fy-muted'},'绩效视图尚未加载。'));});
  };
  ctx.signal?.addEventListener('abort',hide,{once:true});
  ctx.onState?.(()=>{if(!authorized())hide();});
  if(typeof IntersectionObserver==='function'){
   observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))mount();},{rootMargin:'200px'});
   observer.observe(research);
  }else queueMicrotask(mount);
 }
 function paintFunds(state,day) {
  const sectorDay=reviewDate(state.snapshotFieldDays?.sectors||state.sectorsDay);
  // The reference card uses the same original-day gate as the existing
  // ranking: a newer review must never inherit older market/funds evidence.
  const marketDay=reviewDate(state.snapshotFieldDays?.dashboard||state.dashboard?.snapshotDay||state.snapshotDay);
  const aligned=Boolean(sectorDay&&marketDay&&sectorDay===marketDay&&(!day||sectorDay===day));
  const sectorRows=Array.isArray(state.sectors)?state.sectors:Array.isArray(state.sectors?.items)?state.sectors.items:[];
  const flows=aligned?sectorRows.filter(r=>r&&typeof(r.name||r.sector)==='string'&&(valid(r.mainInflowYuan)||valid(r.netInflowYuan)))
   .map(r=>({name:r.name||r.sector,value:valid(r.mainInflowYuan)?r.mainInflowYuan:r.netInflowYuan}))
   .filter(r=>flowMode==='in'?r.value>0:r.value<0)
   .sort((a,b)=>flowMode==='in'?b.value-a.value:a.value-b.value).slice(0,5):[];
  const flowMax=Math.max(1,...flows.map(r=>Math.abs(r.value)));
  flowButtons.forEach((control,i)=>control.setAttribute('aria-pressed',String(flowMode===(i===0?'in':'out'))));
  fundsPanel.hidden=!sectorDay&&!marketDay;
  fundsContent.replaceChildren(
   h('p',{class:'fy-terminal-hint'},[sectorDay?'板块交易日 '+sectorDay:'',marketDay?'大盘交易日 '+marketDay:''].filter(Boolean).join(' · ')),
   ...(!aligned?[empty('资金日期尚未匹配','不能用旧日资金冒充今日排行。')]:
    flows.length?flows.map(r=>h('div',{class:'fy-reference-flow'},
      h('span',{},r.name),h('i',{class:'fy-reference-flow-track'},h('b',{style:'width:'+Math.max(3,Math.abs(r.value)/flowMax*100).toFixed(1)+'%'})),
      h('strong',{class:direction(r.value)},money(r.value)))):[empty(flowMode==='in'?'暂无可展示的净流入':'暂无可展示的净流出','仅接受同日、单位明确的资金净额。')]));
 }
 function paint() {
  if(ctx.signal?.aborted)return;
  // Focused elements are not replaced while a keyboard user is interacting with them.
  if(list.contains(document.activeElement))return;
  const state=ctx.state||{},review=state.review,summary=summarizeReview(review),coverage=reviewCoverage(review);
  const day=reviewDate(review?.date),source=coverage.source,reported=valid(review?.ztN)?review.ztN:null;
  const marketDay=reviewDate(state.snapshotFieldDays?.dashboard||state.dashboard?.snapshotDay||state.snapshotDay);
  const previousOpen=!!recoveryDetails?.open;
  recoveryDetails=recoveryDisclosure(state);
  recoveryDetails.open=previousOpen;
  syncContent.replaceChildren(recoveryDetails,h('dl',{class:'fy-reference-sync-values'},
   ...(marketDay?[h('div',{},h('dt',{},'行情快照'),h('dd',{},marketDay))]:[]),
   h('div',{},h('dt',{},'当前会话'),h('dd',{},ctx.role==='edit'?'编辑':'只读'))));
  status.replaceChildren(
   ...(day?[h('strong',{},'原始复盘日期：'+day)]:[]),
   ...(marketDay?[h('span',{},'大盘快照：'+marketDay)]:[]),
   h('span',{},source?'源端 '+number(source.reportedCount)+' 只 · 实收 '+number(source.returnedCount)+' 条 · 明细 '+number(coverage.analyzed)+' 只':reported!==null?'报告自述总数 '+number(reported)+' 只（未完成源端核验） · 明细 '+number(coverage.analyzed)+' 只':review?'复盘明细 '+number(coverage.analyzed)+' 只':''),
   h('span',{class:'fy-terminal-evidence-tag'},state.trading===false?'最近交易日快照 · 非实时交易信号':'每项仍需核对原始时点'));
  const indexEvidence=ticker(state,{verifiedOnly:true});
  indexHost.replaceChildren(marketOverviewCards(state),...(indexEvidence.childElementCount?[h('details',{class:'fy-details'},h('summary',{},'全部指数与报价来源'),indexEvidence)]:[]));
  const recovery=state.marketRecovery,upObs=recoveredMetric(recovery,'upLimit'),heightObs=recoveredMetric(recovery,'height');
  const useUp=upObs&&(!source||!day||upObs.date>day),useHeight=heightObs&&(summary.highest==null||!day||heightObs.date>day);
  const sourceText=r=>(r.historical?'上次有效 · ':'')+r.date+' · '+r.source+' · 取得 '+dateTime(r.knownAt);
  updateStats(statsHost,view.classList.contains('fy-reference-review')?referenceReviewStats(review,summary,source):[
   ['源端涨停',useUp?number(upObs.value):source?number(source.reportedCount):'—',useUp?sourceText(upObs):source?'东财源端记录 · '+day:'','accent'],
   ['复盘明细',review?number(summary.rows.length):'—','实际接收分析条目'],
   ['首板',review?number(summary.first):'—','报告明细内'],
   ['连板',review?number(summary.continued):'—','报告明细内'],
   ['最高板',useHeight?number(heightObs.value):summary.highest!==null?number(summary.highest):'—',useHeight?sourceText(heightObs):summary.highest!==null?'连板梯队 · '+day:''],
   ['涨停题材',review?number(summary.groups.length):'—','按明细归组'],
   ['有开板记录',review?number(summary.opened.length):'—','不等于全市场炸板数'],
   ['5日线上',review?number(summary.rows.filter(row=>row.aboveMa5===true).length):'—','仅统计明确为真的条目']
  ].filter(([,value])=>value!=='—'));
  const mismatch=source&&source.reportedCount!==summary.rows.length;
  const incomplete=coverage.sourceIncomplete===true;
  const reportGap=reported!==null&&reported!==summary.rows.length;
  const needsReview=incomplete||Boolean(mismatch)||reportGap;
  const marketMode=state.trading===false||state.isSnapshot===true||state.dashboard?.isSnapshot===true?'最近交易日快照':
   state.trading===true?'交易时段':'收盘观测';
  const riskHeadline=incomplete?'源端覆盖不完整':mismatch?'明细覆盖有缺口':reportGap?'报告数量不一致':
   !source?'复盘明细覆盖范围':'原始报价须逐股核验';
  const riskDetail=incomplete?'源端 '+number(source.reportedCount)+' 只 / 有效代码 '+number(source.uniqueCount)+' 只':
   mismatch?'源端 '+number(source.reportedCount)+' 只 / 复盘 '+number(summary.rows.length)+' 只':
   reportGap?'报告 '+number(reported)+' 只 / 明细 '+number(summary.rows.length)+' 只':
   !source?'当前仅有已回传的个股记录':'统计一致不等于行情实时或交易条件成立';
  reviewSnapshot.replaceChildren(...(source?[h('strong',{},number(source.reportedCount)+' 只 · 源端涨停')]:[]),
   ...(day?[h('span',{},day)]:[]),...(review?[h('div',{},h('span',{},'首板 '+number(summary.first)),h('span',{},'连板 '+number(summary.continued)),summary.highest===null?null:h('span',{},'最高 '+number(summary.highest)+' 板'))]:[]));
  prioritiesHost.replaceChildren(
   h('div',{class:'fy-terminal-priority','data-focus':'market'},
    h('span',{},'市场'),h('strong',{},marketMode),marketDay?h('small',{},'原始快照交易日 '+marketDay):null),
   ...(review?[h('div',{class:'fy-terminal-priority','data-focus':'opportunities'},
    h('span',{},'机会'),h('strong',{},review?'复盘明细 '+number(summary.rows.length)+' 条':'复盘数据待就绪'),
    h('small',{},'仅为已回传样本，不代表全市场推荐'))]:[]),
   ...(source||review?[h('div',{class:'fy-terminal-priority fy-terminal-priority-risk','data-focus':'risk'},
    h('span',{},'风险'),h('strong',{},riskHeadline),h('small',{},riskDetail))]:[]),
   h('div',{class:'fy-terminal-priority fy-terminal-priority-next','data-focus':'next'},
    h('span',{},'下一步'),
    moduleButton(needsReview?'核对复盘缺口':'查看机会证据',
     needsReview?'pulse':'opportunities',needsReview?'review':'all',ctx),
    h('small',{},'只进入研究页面，不触发下单')));

  // Price-sensitive visuals only use explicitly dated, source-valued records.
  const mood=state.dashboard?.mood||{};
 const classified=recoveredMetric(recovery,'emotion');
 const upRatio=marketDay&&(mood.source||state.dashboard?.source)&&valid(mood.upRatio)&&mood.upRatio>=0&&mood.upRatio<=100?mood.upRatio:null;
 const observations=observedMarketValues(recovery,[['breakRate','炸板率','%'],['downLimit','跌停',' 家'],['adv','上涨',' 家'],['dec','下跌',' 家'],['amount','成交额',' 亿元'],['trend','全A趋势',''],['sh','上证趋势',''],['cy','创业板趋势',''],['leader','高标反馈','%'],['diffusion','题材扩散度','%'],['premium','昨日涨停溢价','%'],['theme','题材','']]);
 const scopes=coveragePanel(recovery);
 const target=closeSessionDay(state),distribution=distributionPanel(state),reasonList=publishedReasons(state,ctx);
 const marketNotes=[classified?h('strong',{class:'fy-reference-signal-mood'},(classified.historical?'最近已判定 · ':'')+classified.value+' · '+classified.date+' · '+classified.source+' · 取得 '+dateTime(classified.knownAt)):null,
   upRatio!==null?h('p',{},'市场宽度 · '+marketDay+' · '+(mood.source||state.dashboard.source)):null,
   h('div',{class:'fy-reference-signal-facts'},state.trading===false?h('span',{},'休市快照'):null,source?h('span',{},'涨停源端 '+number(source.reportedCount)+' 只'):null)];
 const signature=JSON.stringify([target,marketDay,state.trading,upRatio,source?.reportedCount,classified,recovery?.metrics,recovery?.coverage,!!distribution]);
 if(signalSignature!==signature){
  signalSignature=signature;
  const showFacts=upRatio!==null||classified||source||(!distribution&&state.trading===false);
  const expanded=new Set([...signalContent.querySelectorAll('details[open]')].map(d=>d.firstElementChild?.textContent));
  signalContent.replaceChildren(...(showFacts?[h('div',{class:'fy-signal-summary'},
   upRatio!==null?h('div',{class:'fy-reference-signal-ring','data-valued':'true',style:'--fy-up-arc:'+upRatio+'%','aria-label':'上涨占比 '+upRatio+'%'},h('strong',{},format(upRatio,0)+'%'),h('small',{},'上涨占比')):null,
   h('div',{class:'fy-reference-signal-notes'},marketNotes))]:[]),...(distribution?[distribution]:[]),
   ...(!distribution&&observations.length?[h('div',{class:'fy-signal-metrics'},observations.slice(0,2))]:[]),
   ...((distribution?observations.length:observations.length>2)?[h('details',{class:'fy-details'},h('summary',{},'更多收盘观测'),h('div',{class:'fy-signal-metrics'},observations.slice(distribution?0:2)))]:[]),
   ...(scopes?[scopes]:[]),...(reasonList?[h('details',{class:'fy-details'},h('summary',{},'逐股涨停原因与同花顺复盘'),reasonList)]:[]));
  for(const d of signalContent.querySelectorAll('details'))if(expanded.has(d.firstElementChild?.textContent))d.open=true;
 }
 signalPanel.hidden=!reasonList&&!distribution&&upRatio===null&&!classified&&!source&&!observations.length&&!scopes;
  paintFunds(state,day);
  const good=new Set(Array.isArray(state.goodNews?.items)?state.goodNews.items:[]);
  const bad=new Set(Array.isArray(state.badNews?.items)?state.badNews.items:[]);
  const primaryNews=newsRows(state,'news');
  const rawNews=Array.isArray(state.news)?state.news:Array.isArray(state.news?.items)?state.news.items:[];
  const news=(primaryNews.length?primaryNews:rawNews).filter(item=>item&&
   typeof(item.title||item.headline)==='string'&&(item.title||item.headline).trim()).slice(0,4);
  const headlines=news.map(item=>h('article',{class:'fy-reference-news-item'},
   h('span',{class:'fy-reference-news-tag '+(bad.has(item)?'negative':good.has(item)?'positive':'')},
    bad.has(item)?'利空':good.has(item)?'利好':primaryNews.length?'公告':'资讯'),
   h('div',{},h('strong',{},item.title||item.headline),h('small',{},(item.source||item.src||'来源待核验')+' · '+dateTime(item.publishedAt??item.pubDate??item.t??item.time)))));
  newsPanel.hidden=!headlines.length;
  newsContent.replaceChildren(...(headlines.length?headlines:[empty('暂无新闻记录')]));
  ladderPanel.hidden=!summary.ladder.length;
  ladderContent.replaceChildren(...(summary.ladder.length?summary.ladder.flatMap(([level,rows])=>
   rows.map(row=>({level,row}))).slice(0,4).map(({level,row},index)=>
    h('div',{class:'fy-terminal-line fy-reference-ranked'},h('b',{class:'fy-reference-rank'},index+1),
     h('strong',{},button(nameOf(row),()=>ctx.selectStock(row.code,row),'quiet')),
     h('span',{class:'fy-terminal-mobile-board'},level+' 板'))):[empty('暂无连板梯队')]));
  const paper=ctx.role==='edit'&&state.paper?.hidden!==true?state.paper?.pool:null;
  const accountValues=[['总权益',paper?.equity],['可用资金',paper?.cash],['持仓市值',paper?.marketValue],['累计盈亏',paper?.totalPnl]];
  accountContent.replaceChildren(...(accountValues.some(([,value])=>valid(value))?[
   h('small',{class:'fy-muted'},'模拟盘 · 策略跟踪'),
   h('dl',{class:'fy-reference-account-values'},accountValues.map(([label,value])=>
    h('div',{},h('dt',{},label),h('dd',{class:label==='累计盈亏'?direction(value):null},format(value)))))
  ]:[h('div',{class:'fy-reference-account-status'},ctx.role==='edit'?'暂无模拟盘估值':'观察者 · 资产已隐藏')]));
  const rawBars=Array.isArray(state.indexKline)?state.indexKline:Array.isArray(state.indexKline?.items)?state.indexKline.items:[];
  const bars=rawBars.filter(r=>r&&[r.open,r.close,r.high,r.low].every(valid)&&r.low<=Math.min(r.open,r.close)&&r.high>=Math.max(r.open,r.close)).slice(-42);
  if(bars.length>=6){
   const hi=Math.max(...bars.map(r=>r.high)),lo=Math.min(...bars.map(r=>r.low)),spread=hi-lo||1;
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
   const chartWidth=bars.length*9+64;
   svg.setAttribute('viewBox','0 0 '+chartWidth+' 174');
   svg.setAttribute('role','img');svg.setAttribute('aria-label','服务端实际指数OHLC价格图');
   for(let i=0;i<=4;i++){
    const y=12+138*i/4;
    const guide=document.createElementNS(svg.namespaceURI,'line');
    for(const [k,v] of Object.entries({x1:47,x2:chartWidth,y1:y,y2:y,stroke:'#2d4770'}))guide.setAttribute(k,String(v));
    const label=document.createElementNS(svg.namespaceURI,'text');
    for(const [k,v] of Object.entries({x:0,y:y+3,fill:'#b4c9e7','font-size':9}))label.setAttribute(k,String(v));
    label.textContent=format(hi-(hi-lo)*i/4,1);
    svg.append(guide,label);
   }
   for(const [i,r] of bars.entries()){
    const x=54+i*9,top=12+138*(hi-r.high)/spread,bottom=12+138*(hi-r.low)/spread;
    const a=12+138*(hi-r.open)/spread,b=12+138*(hi-r.close)/spread;
    const shade=r.close>=r.open?'#ff7381':'#3de5b0';
    const line=document.createElementNS(svg.namespaceURI,'line');
    for(const [k,v] of Object.entries({x1:x,x2:x,y1:top,y2:bottom,stroke:shade}))line.setAttribute(k,String(v));
    const rect=document.createElementNS(svg.namespaceURI,'rect');
    for(const [k,v] of Object.entries({x:x-2.7,y:Math.min(a,b),width:5.4,height:Math.max(1,Math.abs(a-b)),fill:shade}))rect.setAttribute(k,String(v));
    svg.append(line,rect);
   }
   chartContent.replaceChildren(svg);
  }else chartContent.replaceChildren();
  chartPanel.hidden=bars.length<6;
  if(mismatch)status.append(h('strong',{class:'fy-terminal-warning'},'源端 '+source.reportedCount+' 只 / 本次明细 '+summary.rows.length+' 只；差额必须核查，不能混称全市场涨停。'));
  else if(reported!==null&&reported!==summary.rows.length)
   status.append(h('strong',{class:'fy-terminal-warning'},'报告自述 '+reported+' 只 / 实际明细 '+summary.rows.length+' 只；原始池覆盖仍需核验。'));

  // Existing authenticated dashboard only: no scanner, push, or order on page load.
  const digest=projectDecisionBrief(state);
  decisionsHost.hidden=!digest.total;
  decisionsHost.replaceChildren(
   h('header',{class:'fy-section-head'},h('div',{},
    h('h2',{},'逐股决策仪表盘'),
    h('p',{},'买卖观望、利好利空、策略依据，全部按原始证据显示'))),
   h('p',{class:'fy-muted'},'原始行情日 '+(digest.marketDay||'待核验')+
    ' · 样本 '+(digest.total||'尚无')+' 只（仅首页候选，不是全市场）'+
    (digest.truncated?' · 仅统计服务端前200条':'') ),
   h('div',{class:'fy-grid four'},
    decisionStat('买入研究标签',digest.total?number(digest.counts.buy):'—','需同源原时点及真实服务端核验'),
    decisionStat('观望 / 待核验',digest.total?number(digest.counts.watch):'—','旧报价和普通评分不能升级'),
    decisionStat('卖出研究标签',digest.total?number(digest.counts.sell):'—','服务端声明不等于交易认证')),
   digest.items.length?h('div',{class:'fy-stack'},
    digest.items.map(item=>h('article',{class:'fy-item','data-code':item.code},
     h('div',{class:'fy-inline'},
      button(item.name+' '+item.code,()=>ctx.selectStock(item.code,rowsFrom(state.dashboard?.rows).find(row=>row.code===item.code)),'quiet'),
      h('span',{class:'fy-tag'},item.label),
      item.score!==null?h('small',{class:'fy-muted'},'服务端原评分 '+format(item.score,1)):null),
     h('p',{class:'fy-muted'},'日期 '+(item.day||'未知')+' · '+item.quoteSource+
      ' · '+item.quoteStatus+' · '+(item.quoteAt?new Date(item.quoteAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'报价时间未知')),
     h('p',{},'利好线索：'+(item.positives.join('；')||'未取得可核验利好证据')),
     h('p',{},'利空 / 风险：'+item.risks.join('；')),
     h('p',{class:'fy-muted'},'策略依据：'+(item.signals.join('；')||'尚未返回逐条命中条件'))))):
    empty('暂无逐股决策证据','缺失数据不意味着无风险，也不能据此买入或卖出。'),
   h('p',{class:'fy-terminal-hint'},digest.note),
   moduleButton('查看完整策略研究','lab','desk',ctx));
  panelsHost.replaceChildren(renderPanels(state,summary,day,ctx));
  paintReview(summary);
  const preview=systemPicks(state).items.slice(0,3),watch=!preview.length?closingWatch(state):null;
  candidateHead.hidden=!preview.length;
  replaceKeepingStockFocus(candidatePreview,preview.length?
   h('div',{class:'fy-stock-grid'},preview.map(row=>quotePreview(row,ctx))):
   watch?closingWatchPanel(watch,ctx,{limit:3}):empty('等待精选归档','云端返回结果后自动显示。'));
 }
 ctx.onState?.(paint);paint();
 return view;
}

/** The first reference image is a dedicated review screen, not a second application. */
function renderReviewWorkspace(ctx) {
 const view=renderTerminalOverview(ctx);
 view.classList.remove('fy-reference-home');
 view.classList.add('fy-reference-review');
 const title=view.querySelector('.fy-terminal-title'),status=view.querySelector('.fy-terminal-provenance');
 const stats=view.querySelector('.fy-terminal-stats'),panels=view.querySelector('.fy-terminal-context');
 const details=view.querySelector('.fy-terminal-review'),quick=view.querySelector('.fy-terminal-quick');
 const preview=details.querySelector('.fy-reference-home-details');
 preview.replaceWith(preview.querySelector('.fy-terminal-review-list'));
 title.querySelector('.fy-terminal-eyebrow').textContent='天枢智策 V6 / DAILY REVIEW';
 title.querySelector('h1').textContent='复盘资料与研究入口';
 title.querySelector('.fy-terminal-actions').replaceChildren(
  moduleButton('查看完整原始报告','pulse','review-details',ctx),
  moduleButton('AI策略研究','lab','strategies',ctx),
  button('刷新复盘',()=>ctx.refresh(),'primary'));
 details.querySelector('h2').textContent='每日复盘 · 涨停形态与归因';
 const reviewAction=details.querySelector('.fy-terminal-review-head .fy-button');
 if(reviewAction)reviewAction.replaceWith(moduleButton('查看完整原始复盘','pulse','review-details',ctx));
 const summary=summarizeReview(ctx.state?.review),coverage=reviewCoverage(ctx.state?.review);
 updateStats(stats,referenceReviewStats(ctx.state?.review,summary,coverage.source));
 const footer=h('div',{class:'fy-reference-review-footer'},[
  ['选股核心','opportunities','all','spark','候选与命中条件'],['涨停预选','opportunities','ztpre','pulse','涨停前形态'],
  ['板次日接力','opportunities','relay-first','spark','首板与连板机会'],['趋势票池','opportunities','trend','pulse','趋势跟踪'],
  ['盘中异动','opportunities','movement','pulse','量价变化与来源'],['风险控制','assets','risk','settings','账户风险边界']
 ].map(([label,v,sub,key,detail])=>h('button',{class:'fy-reference-mini-module',type:'button',onClick:()=>ctx.navigate(v,sub)},
  h('span',{class:'fy-reference-panel-icon'},icon(key)),h('span',{},h('strong',{},label),h('small',{},detail)),h('span',{'aria-hidden':'true'},'›'))));
 view.replaceChildren(title,status,stats,panels,details,footer,quick);
 return view;
}

export function renderReferenceReview(ctx) {
 const more=h('details',{class:'fy-details fy-close-more'},h('summary',{},'更多复盘资料与研究入口'));
 more.addEventListener('toggle',()=>{
  if(more.open&&more.childElementCount===1&&!ctx.signal?.aborted)more.append(renderReviewWorkspace(ctx));
 });
 return renderCloseReview(ctx,more);
}
