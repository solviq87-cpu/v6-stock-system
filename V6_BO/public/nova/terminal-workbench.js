// V6 unified financial terminal: presentation only.
// All figures come from the existing authenticated state and retain their original evidence.
// No synthetic quotes, trade actions or new backend contracts are introduced here.
import {h,button,empty,section,format,money,percent,direction,dayLabel,table} from './ui.js';
import {ticker,quoteLabel,stockCard,summarizeReview,reviewCoverage,reviewDate} from './market.js';

const valid = value => typeof value==='number' && Number.isFinite(value);
const number = value => valid(value)?format(value,0):'—';
const asDay = value => reviewDate(value)||'交易日待核验';
const nameOf = row => row?.name||row?.code||'名称待核验';

function stat(label,value,detail,kind='') {
 return h('article',{class:'fy-terminal-stat '+kind},
  h('span',{},label),h('strong',{},value),h('small',{},detail));
}
function moduleButton(label,view,sub,ctx) {
 return button(label,()=>ctx.navigate(view,sub),'secondary');
}
function line(label,value,detail='',variant='') {
 return h('div',{class:'fy-terminal-line '+variant},
  h('strong',{},label),h('span',{},value),detail&&h('small',{},detail));
}
function renderPanels(state,summary,reviewDay,ctx) {
 const marketDay=reviewDate(state.snapshotFieldDays?.dashboard||state.dashboard?.snapshotDay||state.snapshotDay);
 const mainline=section('市场主线排行','仅按当前复盘明细的题材归组，不能充当全市场排行',
  summary.groups.length?
   h('div',{class:'fy-terminal-lines'},summary.groups.slice(0,5).map((g,i)=>
    line((i+1)+'  '+g.name,g.count+' 只',g.highest?('最高 '+g.highest+' 板'):'高度未知'))):
   empty('缺少复盘板块证据','保留未知，不根据股票名称猜测所属题材。'),
  moduleButton('查看完整主线','pulse','review',ctx));
 const roles=Array.isArray(state.ztBySector)?state.ztBySector:[];
 const roleDay=reviewDate(state.snapshotFieldDays?.ztBySector||state.ztDay);
 const roleRows=reviewDay&&roleDay===reviewDay?roles.slice(0,5):[];
 const roleItems=roleRows.map(group=>{
  const members=(Array.isArray(group.stocks)?group.stocks:[]).slice(0,4).map(row=>{
   const role=({leader:'龙头',deputy:'龙二',mid:'中军',follow:'跟风'})[row.role]||null;
   return h('span',{class:'fy-terminal-chip'},row.name||row.code||'名称未知',
    role?h('small',{},' · '+role):null);
  });
  return h('div',{class:'fy-terminal-sector'},
   h('div',{class:'fy-terminal-line'},
    h('strong',{},group.sector||'板块待核验'),
    h('span',{},valid(group.count)?number(group.count)+' 只':'数量未知')),
   h('div',{class:'fy-terminal-chips'},members));
 });
 const board=section('涨停板 · 板块分类',
  '龙头 / 龙二 / 中军按服务端原始角色；未涨停的题材股也可能入围',
  roleItems.length?h('div',{class:'fy-terminal-lines'},roleItems):
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
 const flows=section('板块资金排行',
  '资金来源交易日 '+(sectorDay||'待核验')+' · 仅展示明确以元计的净流入，旧日与未知不补 0',
  !aligned?empty('资金来源交易日待核验',dateIssue+'；暂不展示排名，请进入原资金模块核对。'):
   capital.length?h('div',{class:'fy-terminal-flows'},capital.map(row=>
    h('div',{class:'fy-terminal-flow'},
     h('span',{},row.name),
     h('span',{class:'fy-terminal-bar'},h('i',{style:'width:'+Math.max(3,100*Math.abs(row.value)/max).toFixed(1)+'%'})),
     h('strong',{class:direction(row.value)},money(row.value))))):
    empty('尚无单位明确的板块资金数据','原资金模块可能有其他单位或缺失项，请核验数据来源与字段。'),
  moduleButton('查看资金证据','pulse','global',ctx));
 return h('div',{class:'fy-terminal-panels'},mainline,board,flows);
}
function renderReviewRows(summary,ctx) {
 const data=summary.rows.slice(0,200);
 const open=row=>button(nameOf(row)+' '+row.code,()=>ctx.selectStock(row.code,row),'quiet');
 const columns=[
  {label:'股票 / 代码',value:open},
  {label:'板次',value:row=>Number.isInteger(row.limitUpCount)&&row.limitUpCount>0?row.limitUpCount+' 板':'未知'},
  {label:'封单金额',value:row=>money(row.sealAmount)},
  {label:'开板次数',value:row=>number(row.breakCount)},
  {label:'换手率',value:row=>valid(row.turnover)?format(row.turnover,1)+'%':'—'},
  {label:'主力净额',value:row=>money(row.mainInflow)},
  {label:'题材 / 依据',value:row=>row.sector||'题材待核验'}
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
  const basis=[row.reason,row.why,row.note].find(text=>typeof text==='string'&&text.trim())||'尚无可核验的原始涨停依据';
  return h('article',{class:'fy-terminal-mobile-stock','data-code':row.code},
   h('div',{class:'fy-terminal-mobile-stock-head'},
    open(row),h('span',{class:'fy-terminal-mobile-board'},level)),
   h('p',{class:'fy-terminal-mobile-sector'},row.sector||'题材待核验'),
   h('dl',{class:'fy-terminal-mobile-metrics'},items.map(([label,value])=>
    h('div',{},h('dt',{},label),h('dd',{},value)))),
   h('div',{class:'fy-terminal-mobile-basis'},'涨停线索（未独立确认因果）：'+basis),
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

export function renderTerminalOverview(ctx) {
 const view=h('div',{class:'fy-terminal fy-stack','data-v6-workbench':'true'});
 const title=h('header',{class:'fy-terminal-title'},
  h('div',{},h('span',{class:'fy-terminal-eyebrow'},'FAYO / V6'),
   h('h1',{},'盘面总览'),
   h('p',{},'市场、机会、风险与下一步，先看重点。')),
  h('div',{class:'fy-terminal-actions'},
   moduleButton('详细复盘','pulse','review',ctx),
   moduleButton('智能选股','opportunities','all',ctx),
   button('刷新云端数据',()=>ctx.refresh(),'primary')));
 const status=h('div',{class:'fy-terminal-provenance',role:'status','aria-live':'polite'});
 const indexHost=h('div',{class:'fy-terminal-index'});
 const statsHost=h('div',{class:'fy-terminal-stats'});
 const prioritiesHost=h('section',{class:'fy-terminal-priorities','aria-label':'市场、机会、风险和下一步'});
 const panelsHost=h('div',{class:'fy-terminal-context'});
 const reviewHost=h('section',{class:'fy-section fy-panel fy-terminal-review'});
 reviewHost.append(h('header',{class:'fy-terminal-review-head'},
  h('div',{},h('h2',{},'每日复盘 · 涨停形态与归因'),h('p',{},'展示服务端实际返回的逐股明细（最多200条）；手机可展开全部已返回记录，未独立核实的题材不是涨停因果证明。')),
  moduleButton('全部复盘与归因','pulse','review',ctx)));
 const list=h('div',{class:'fy-terminal-review-list'});reviewHost.append(list);
 const quick=h('details',{class:'fy-terminal-quick'},
  h('summary',{},'更多业务功能 · 12 个入口'),
  h('nav',{class:'fy-terminal-shortcuts','aria-label':'业务功能快捷入口'},[
   ['选股核心','opportunities','all'],['涨停预选','opportunities','ztpre'],
   ['板次日接力','opportunities','relay-first'],['趋势票池','opportunities','trend'],
   ['盘中异动','opportunities','movement'],['风控系统','assets','risk'],
   ['模拟盘','assets','paper'],['我的持仓','assets','holdings'],
   ['十四条选股','opportunities','conditions'],['策略中心','lab','strategies'],
   ['明日计划','pulse','plans'],['消息面','inbox','all']
  ].map(([label,module,sub])=>moduleButton(label,module,sub,ctx))));
 const candidatePreview=h('div',{class:'fy-terminal-preview-cards'});
 const candidates=h('section',{class:'fy-terminal-candidates fy-terminal-preview'},
  h('header',{class:'fy-terminal-preview-head'},
   h('div',{},h('h2',{},'重点候选'),h('p',{class:'fy-terminal-hint'},'仅预览当前云端已返回的原始候选；历史报价不等于可交易信号。')),
   moduleButton('查看全部候选','opportunities','all',ctx)),
  candidatePreview);
 view.append(title,status,prioritiesHost,indexHost,statsHost,panelsHost,reviewHost,quick,candidates);
 function paint() {
  if(ctx.signal?.aborted)return;
  // Focused elements are not replaced while a keyboard user is interacting with them.
  if(reviewHost.contains(document.activeElement))return;
  const state=ctx.state||{},review=state.review,summary=summarizeReview(review),coverage=reviewCoverage(review);
  const day=reviewDate(review?.date),source=coverage.source,reported=valid(review?.ztN)?review.ztN:null;
  const marketDay=reviewDate(state.snapshotFieldDays?.dashboard||state.dashboard?.snapshotDay||state.snapshotDay);
  status.replaceChildren(
   h('strong',{},'原始复盘日期：'+(day||'待核验')),
   h('span',{},'大盘快照：'+(marketDay||'待核验')),
   h('span',{},source?'源端 '+number(source.reportedCount)+' 只 · 实收 '+number(source.returnedCount)+' 条 · 明细 '+number(coverage.analyzed)+' 只':reported!==null?'报告自述总数 '+number(reported)+' 只（未完成源端核验） · 明细 '+number(coverage.analyzed)+' 只':'源端涨停总数尚未核验 · 明细 '+number(coverage.analyzed)+' 只'),
   h('span',{class:'fy-terminal-evidence-tag'},state.trading===false?'最近交易日快照 · 非实时交易信号':'每项仍需核对原始时点'));
  indexHost.replaceChildren(ticker(state));
  statsHost.replaceChildren(...[
   ['源端涨停',source?number(source.reportedCount):'—','东财源端记录 · 未核验不填数','accent'],
   ['复盘明细',review?number(summary.rows.length):'—','实际接收分析条目'],
   ['首板',review?number(summary.first):'—','报告明细内'],
   ['连板',review?number(summary.continued):'—','报告明细内'],
   ['最高板',summary.highest===null?'—':number(summary.highest),'连板梯队'],
   ['涨停题材',review?number(summary.groups.length):'—','按明细归组'],
   ['有开板记录',review?number(summary.opened.length):'—','不等于全市场炸板数'],
   ['5日线上',review?number(summary.rows.filter(row=>row.aboveMa5===true).length):'—','仅统计明确为真的条目']
  ].map(([label,value,detail,kind])=>stat(label,value,detail,kind)));
  const mismatch=source&&source.reportedCount!==summary.rows.length;
  const incomplete=coverage.sourceIncomplete===true;
  const reportGap=reported!==null&&reported!==summary.rows.length;
  const needsReview=incomplete||Boolean(mismatch)||reportGap;
  const marketMode=state.trading===false||state.isSnapshot===true||state.dashboard?.isSnapshot===true?'最近交易日快照':
   state.trading===true?'交易时段 · 报价待核验':'交易状态待核验';
  const riskHeadline=incomplete?'源端覆盖不完整':mismatch?'明细覆盖有缺口':reportGap?'报告数量不一致':
   !source?'源端总量待核验':'原始报价须逐股核验';
  const riskDetail=incomplete?'源端 '+number(source.reportedCount)+' 只 / 有效代码 '+number(source.uniqueCount)+' 只':
   mismatch?'源端 '+number(source.reportedCount)+' 只 / 复盘 '+number(summary.rows.length)+' 只':
   reportGap?'报告 '+number(reported)+' 只 / 明细 '+number(summary.rows.length)+' 只':
   !source?'不能将已回传明细数当成全市场涨停数':'统计一致不等于行情实时或交易条件成立';
  prioritiesHost.replaceChildren(
   h('div',{class:'fy-terminal-priority','data-focus':'market'},
    h('span',{},'市场'),h('strong',{},marketMode),h('small',{},'原始快照交易日 '+(marketDay||'待核验'))),
   h('div',{class:'fy-terminal-priority','data-focus':'opportunities'},
    h('span',{},'机会'),h('strong',{},review?'复盘明细 '+number(summary.rows.length)+' 条':'复盘数据待就绪'),
    h('small',{},'仅为已回传样本，不代表全市场推荐')),
   h('div',{class:'fy-terminal-priority fy-terminal-priority-risk','data-focus':'risk'},
    h('span',{},'风险'),h('strong',{},riskHeadline),h('small',{},riskDetail)),
   h('div',{class:'fy-terminal-priority fy-terminal-priority-next','data-focus':'next'},
    h('span',{},'下一步'),
    moduleButton(needsReview?'核对复盘缺口':'查看机会证据',
     needsReview?'pulse':'opportunities',needsReview?'review':'all',ctx),
    h('small',{},'只进入研究页面，不触发下单')));

  if(mismatch)status.append(h('strong',{class:'fy-terminal-warning'},'源端 '+source.reportedCount+' 只 / 本次明细 '+summary.rows.length+' 只；差额必须核查，不能混称全市场涨停。'));
  else if(reported!==null&&reported!==summary.rows.length)
   status.append(h('strong',{class:'fy-terminal-warning'},'报告自述 '+reported+' 只 / 实际明细 '+summary.rows.length+' 只；原始池覆盖仍需核验。'));
  panelsHost.replaceChildren(renderPanels(state,summary,day,ctx));
  list.replaceChildren(renderReviewRows(summary,ctx));
  // Landing-page preview is deliberately bounded and read-only. Full pool
  // fetching, filters, strategy evidence and paging remain in opportunities/all.
  // This avoids automatic remote pool requests just from opening the homepage.
  const previewRows=new Map();
  // Field dates are separate: never borrow a newer index/dashboard date for
  // a retained pool row whose original pool date is unknown or older.
  const previewGroups=[
   [rowsFrom(state.dashboard?.rows),reviewDate(state.snapshotFieldDays?.dashboard||state.dashboard?.snapshotDay)],
   [rowsFrom(state.pool),reviewDate(state.snapshotFieldDays?.pool||state.poolDay)]
  ];
  for(const [items,sourceDay] of previewGroups){
   for(const row of items){
    if(!row?.code||previewRows.has(row.code))continue;
    previewRows.set(row.code,{...row,poolDay:row.poolDay||sourceDay||undefined});
   }
  }
  const preview=[...previewRows.values()].slice(0,3);
  candidatePreview.replaceChildren(preview.length?
   h('div',{class:'fy-stock-grid'},preview.map(row=>stockCard(row,ctx))):
   empty('当前没有可核验的候选','查看完整机会工作区中的来源状态和原始依据；未返回不代表全市场没有机会。'));
 }
 ctx.onState?.(paint);paint();
 return view;
}
