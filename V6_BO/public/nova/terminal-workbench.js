// V6 unified financial terminal: presentation only.
// All figures come from the existing authenticated state and retain their original evidence.
// No synthetic quotes, trade actions or new backend contracts are introduced here.
import {h,button,empty,section,format,money,percent,direction,dayLabel,table} from './ui.js';
import {ticker,renderAllOpportunities,summarizeReview,reviewCoverage,reviewDate} from './market.js';

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
 const marketDay=reviewDate(state.dashboard?.snapshotDay||state.snapshotFieldDays?.dashboard||state.snapshotDay);
 const mainline=section('市场主线排行','仅按当前复盘明细的题材归组，不能充当全市场排行',
  summary.groups.length?
   h('div',{class:'fy-terminal-lines'},summary.groups.slice(0,5).map((g,i)=>
    line((i+1)+'  '+g.name,g.count+' 只',g.highest?('最高 '+g.highest+' 板'):'高度未知'))):
   empty('缺少复盘板块证据','保留未知，不根据股票名称猜测所属题材。'),
  moduleButton('查看完整主线','pulse','review',ctx));
 const roles=Array.isArray(state.ztBySector)?state.ztBySector:[];
 const roleDay=reviewDate(state.snapshotFieldDays?.ztBySector||state.ztDay);
 const roleRows=reviewDay&&roleDay===reviewDay?roles.slice(0,5):[];
 const board=section('涨停板 · 板块分类','龙头 / 龙二 / 中军按服务端原始角色；未涨停的题材股也可能入围',
  roleRows.length?h('div',{class:'fy-terminal-lines'},roleRows.map(g=>
    h('div',{class:'fy-terminal-sector'},
     h('div',{class:'fy-terminal-line'},h('strong',{},g.sector||'板块待核验'),h('span',{},valid(g.count)?number(g.count)+' 只':'数量未知')),
     h('div',{class:'fy-terminal-chips'},(Array.isArray(g.stocks)?g.stocks:[]).slice(0,4).map(r=>
      h('span',{class:'fy-terminal-chip'},r.name||r.code||'名称未知',r.role&&h('small',{},' · '+({leader:'龙头',deputy:'龙二',mid:'中军',follow:'跟风'}[r.role]||'角色待核验'))))))):
   empty('没有可核验的同日板块分类','本次复盘 '+(reviewDay||'日期未知')+'，板块分类 '+(roleDay||'日期未知')+'；日期不一致时不混用。'),
  moduleButton('查看全部板块','pulse','sectors',ctx));
 const sectors=Array.isArray(state.sectors)?state.sectors:Array.isArray(state.sectors?.items)?state.sectors.items:[];
 // Only known Yuan-valued fields are converted to 亿/万; fields without verified units are not converted.
 const capital=sectors.filter(row=>row&&typeof(row.name||row.sector)==='string'&&
   (valid(row.mainInflowYuan)||valid(row.netInflowYuan))).map(row=>({
    name:row.name||row.sector,value:valid(row.mainInflowYuan)?row.mainInflowYuan:row.netInflowYuan
   })).sort((a,b)=>b.value-a.value).slice(0,5);
 const max=Math.max(1,...capital.map(row=>Math.abs(row.value)));
 const flows=section('板块资金排行','仅展示明确以元计的净流入字段；未知数据不补成 0',
  capital.length?h('div',{class:'fy-terminal-flows'},capital.map(row=>
   h('div',{class:'fy-terminal-flow'},
    h('span',{},row.name),
    h('span',{class:'fy-terminal-bar'},h('i',{style:'width:'+Math.max(3,100*Math.abs(row.value)/max).toFixed(1)+'%'})),
    h('strong',{class:direction(row.value)},money(row.value))))):
   empty('尚无单位明确的板块资金数据','可前往现有板块资金页面核验数据来源、时间与单位。'),
  moduleButton('查看资金证据','pulse','global',ctx));
 // Market-day mismatch is explicit: do not present other-day bars as the review day's.
 if(reviewDay&&marketDay&&marketDay!==reviewDay)
  flows.append(h('p',{class:'fy-terminal-hint'},'市场快照 '+marketDay+' 与复盘 '+reviewDay+' 日期不同；资金不作为当日复盘结论。'));
 return h('div',{class:'fy-terminal-panels'},mainline,board,flows);
}
function renderReviewRows(summary,ctx) {
 const data=summary.rows;
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
 return data.length?table(columns,data.slice(0,12)):
  empty('暂无可核验的涨停明细','没有数据不代表没有涨停；请检查源端池、返回上限和复盘任务。');
}
export function renderTerminalOverview(ctx) {
 const view=h('div',{class:'fy-terminal fy-stack','data-v6-workbench':'true'});
 const title=h('header',{class:'fy-terminal-title'},
  h('div',{},h('span',{class:'fy-terminal-eyebrow'},'V6 / SAME DATA · TWO SCREENS'),
   h('h1',{},'盘面总览 · 涨停复盘工作台'),
   h('p',{},'同一套策略、账户和复盘证据，电脑与手机同步读取；历史报价不当作实时行情。')),
  h('div',{class:'fy-terminal-actions'},
   moduleButton('详细复盘','pulse','review',ctx),
   moduleButton('智能选股','opportunities','all',ctx),
   button('刷新云端数据',()=>ctx.refresh(),'primary')));
 const status=h('div',{class:'fy-terminal-provenance',role:'status','aria-live':'polite'});
 const indexHost=h('div',{class:'fy-terminal-index'});
 const statsHost=h('div',{class:'fy-terminal-stats'});
 const panelsHost=h('div',{class:'fy-terminal-context'});
 const reviewHost=h('section',{class:'fy-section fy-panel fy-terminal-review'});
 reviewHost.append(h('header',{class:'fy-terminal-review-head'},
  h('div',{},h('h2',{},'每日复盘 · 涨停形态与归因'),h('p',{},'明细最多展示前 12 只；全部证据、缺失项和封板记录在详细复盘中查看。')),
  moduleButton('全部复盘与归因','pulse','review',ctx)));
 const list=h('div',{class:'fy-terminal-review-list'});reviewHost.append(list);
 const quick=h('section',{class:'fy-terminal-quick'},
  h('h2',{},'业务模块快捷入口'),
  h('div',{class:'fy-terminal-shortcuts'},[
   ['选股核心','opportunities','all'],['涨停预选','opportunities','ztpre'],
   ['板次日接力','opportunities','relay-first'],['趋势票池','opportunities','trend'],
   ['盘中异动','opportunities','movement'],['风控系统','assets','risk'],
   ['模拟盘','assets','paper'],['我的持仓','assets','holdings'],
   ['十四条选股','opportunities','conditions'],['策略中心','lab','strategies'],
   ['明日计划','pulse','plans'],['消息面','inbox','all']
  ].map(([label,module,sub])=>moduleButton(label,module,sub,ctx))));
 const candidates=h('section',{class:'fy-terminal-candidates'},h('h2',{},'选股核心 · 全部候选'),
  h('p',{class:'fy-terminal-hint'},'原有全部候选聚合继续使用现有接口，股票按代码去重；不是全市场全部股票。'),renderAllOpportunities(ctx));
 view.append(title,status,indexHost,statsHost,panelsHost,reviewHost,quick,candidates);
 function paint() {
  if(ctx.signal?.aborted)return;
  // Focused elements are not replaced while a keyboard user is interacting with them.
  if(view.contains(document.activeElement))return;
  const state=ctx.state||{},review=state.review,summary=summarizeReview(review),coverage=reviewCoverage(review);
  const day=reviewDate(review?.date),source=coverage.source,reported=valid(review?.ztN)?review.ztN:null;
  const marketDay=reviewDate(state.dashboard?.snapshotDay||state.snapshotFieldDays?.dashboard||state.snapshotDay);
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
  if(mismatch)status.append(h('strong',{class:'fy-terminal-warning'},'源端 '+source.reportedCount+' 只 / 本次明细 '+summary.rows.length+' 只；差额必须核查，不能混称全市场涨停。'));
  else if(reported!==null&&reported!==summary.rows.length)
   status.append(h('strong',{class:'fy-terminal-warning'},'报告自述 '+reported+' 只 / 实际明细 '+summary.rows.length+' 只；原始池覆盖仍需核验。'));
  panelsHost.replaceChildren(renderPanels(state,summary,day,ctx));
  list.replaceChildren(renderReviewRows(summary,ctx));
 }
 ctx.onState?.(paint);paint();
 return view;
}
