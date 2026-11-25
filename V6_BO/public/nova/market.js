import {minutePoint,archivePoints,priceLine} from './stock-timeline.js';
import {eligiblePick,pickReasons,topSystemPicks,systemPickDay} from './system-picks.mjs';
import {sectorRoles,roleBadge,observedBadge} from './stock-roles.js';
import {renderSourceReviewPool} from './review-pool.js';
import { stockTactics } from './tactics-view.js';
import {aggregateCandles,movingAverages,projectForwardTracking,projectDecisionBrief,stockReasons,requirePoolReady,sectorLeadershipEvidence,dailyReviewEvidence,newsRows,reviewSupplier,recoveredMetric,marketPhaseName,observedCoverage,coverageValues,coverageCount,turnoverLabel,closeDistribution,limitReasonEvidence} from './market-evidence.js';
export {projectDecisionBrief};
import {h,updateReadout,button,empty,section,field,format,money,percent,direction,dateTime,dayLabel,note,icon,safeLink,table} from './ui.js';

export const POOLS=[
 ['ranked','系统精选','按当日证据精选最多 3 只，查看入选理由和观察条件','state:pool'],
 ['quant','量化发现','四策略与实际命中条件','/api/quant-picks'],
 ['auction','竞价引力','开盘前共振线索','/api/auction-resonance'],
 ['intraday','盘中动量','量价异动观察','/api/intraday-strong'],
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
const sectorLeadershipLabel=status=>({
 'early-spread':'较强线索 · 先封后扩散','early-limited':'同业封板扩散有限',following:'已有同业先封',tied:'同刻封板',pending:'待核验'
})[status];
const stockCardObservations=new WeakMap();
export function stockCard(row,ctx) {
 const originalAt=quoteAt(row);
 const day=reviewDate(row.poolDay||row.sourceTradeDate||row.tradeDate)||(Number.isSafeInteger(originalAt)&&originalAt>0&&originalAt<=Date.now()?new Date(originalAt+28800000).toISOString().slice(0,10):null);
 const linked=day&&day===reviewDate(ctx.state?.review?.date)?ctx.state.review.items?.find(r=>r.code===row.code):null;
 const study=ctx.state?.dabanke,detail=day&&study?.day===day&&study.knownAt<=Date.now()?study.facts?.[row.code]:null;
 const cause=limitReasonEvidence(row,row.reasonRaw||row.reason,day)||limitReasonEvidence(linked,linked?.reasonRaw,day)||
  (detail?.logic?{reason:detail.logic,reasonSource:'打板客同日梯队'}:null);
 const badge=observedBadge(row,detail),roleInfo=sectorRoles(ctx.state,day).get(row.code);
 const card=h('button',{type:'button',class:'fy-stock-card','data-code':row.code,'aria-label':'研究 '+symbolName(row),onClick:e=>ctx.selectStock(row.code,stockCardObservations.get(card),e.currentTarget)},
  h('div',{class:'fy-stock-head'},h('div',{},h('strong',{},symbolName(row)),h('span',{class:'fy-muted'},row.code),roleBadge(roleInfo)),badge?h('span',{class:'fy-score-ring'},badge.value,h('small',{},badge.caption)):null),
  h('div',{class:'fy-stock-meta'},Number.isFinite(row.price)?h('strong',{class:direction(row.pct)},format(row.price)):null,Number.isFinite(row.pct)?h('span',{class:direction(row.pct)},percent(row.pct)):null,h('span',{class:'fy-muted'},row.sector||row.industry||'')),
  row.poolLabels?.length&&h('div',{class:'fy-reason-tags'},row.poolLabels.map(label=>h('span',{class:'fy-tag'},label))),
  row.poolDay&&h('small',{class:'fy-muted'},'结果日期 '+dayLabel(row.poolDay)),
  cause&&h('p',{class:'fy-watch-reason'},'涨停原因 · '+cause.reason+' · '+reviewSupplier(cause.reasonSource)),
  row.sectorLeadership&&row.sectorLeadership!=='pending'&&h('small',{class:'fy-muted','data-sector-leadership':row.sectorLeadership},
   '带动性 · '+sectorLeadershipLabel(row.sectorLeadership)),
  h('div',{class:'fy-reason-tags'},reasons(row).slice(0,3).map(reason=>h('span',{class:'fy-tag'},reason))),
  row.auctionPct!=null&&h('small',{class:'fy-muted'},'竞价涨幅 '+percent(row.auctionPct)),
  row.at&&h('small',{class:'fy-muted'},'原信号 '+dateTime(row.at)),
  h('small',{class:'fy-quote-time'},row.pickSource==='收盘观察精选'?[row.poolDay,reviewSupplier(row.detailSource||row.pickSource)].join(' · '):quoteLabel(row)),
  row.selectionWhy&&h('p',{class:'fy-pick-why'},h('strong',{},'为什么选它 · '),row.selectionWhy),
  row.selectionWhy&&detail&&(detail.performance||detail.history||detail.patterns?.length||detail.risks?.length||detail.dragon)&&h('p',{class:'fy-muted'},[detail.performance,detail.history,...(detail.patterns||[]),...(detail.risks||[]),...(detail.dragon?['龙虎榜披露买入第 '+detail.dragon.rank+' 名']:[])].filter(Boolean).join(' · ')),
  row.selectionRisk&&h('p',{class:'fy-muted'},h('strong',{},'风险与观察 · '),row.selectionRisk),
  h('span',{class:'fy-stock-open'},'打开研究面板 ',icon('arrow')));
 stockCardObservations.set(card,row);
 return card;
}
export function replaceKeepingStockFocus(host,...children) {
 const focused=document.activeElement;
 const code=focused?.classList?.contains('fy-stock-card')&&host.contains(focused)?focused.dataset.code:'';
 host.replaceChildren(...children);
 if(/^\d{6}$/.test(code))host.querySelector('button.fy-stock-card[data-code="'+code+'"]')?.focus({preventScroll:true});
}
// A background poll can finish between Escape and the next keyboard action.
// Keep the focused button connected while replacing the board, and update the
// observation its click handler opens even if only the underlying evidence changed.
function refreshPoolList(host,_background,children){
 updateReadout(host,...children);
}
const roleLabel=row=>({leader:'龙头',deputy:'龙二',mid:'中军',follow:'跟风'})[row?.role]||'';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function detailedStockCard(row,ctx) {
 const strength=row.sectorStrength||{};
 const metrics=[['快照价',format(row.price)],['封单 / 成交额',finite(row.sealRatio)?format(row.sealRatio*100,0)+'%':'未知'],['开板次数',finite(row.breakCount)?format(row.breakCount,0):'未知'],['换手率',finite(row.turnover)?format(row.turnover,1)+'%':'未知'],['封单额',money(row.sealAmount)],['流通市值',money(row.floatCap)],['主力净额',row.mainInflow==null?'未知':money(row.mainInflow)],['封单 / 流通市值',finite(row.sealStrength)?format(row.sealStrength,2)+'%':'未知']];
 return h('article',{class:'fy-panel fy-section'},
  h('div',{class:'fy-inline'},button(symbolName(row)+' '+row.code,()=>ctx.selectStock(row.code,row),'quiet'),roleBadge(sectorRoles(ctx.state,reviewDate(row.poolDay||row.tradeDate)).get(row.code))||(roleLabel(row)?h('strong',{},roleLabel(row)):null),row.level&&h('span',{class:'fy-tag'},row.level+'进'+(row.targetLevel||row.level+1)),row.mainline&&h('span',{class:'fy-tag'},'主流板块'),h('span',{class:'fy-tag'},row.sector||'板块待核验')),
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
 return groups.length?h('div',{class:'fy-grid two'},groups.map(group=>h('article',{class:'fy-item'},h('h3',{},group.sector),h('p',{},'涨停 '+format(group.count,0)+' 只'),
  h('div',{class:'fy-reason-tags'},(group.stocks||[]).map(row=>{
   const badge=sectorRoles(state,day,group.sector).get(row.code)||(roleLabel(row)?{key:row.role,label:roleLabel(row),evidence:group.sector+' · 同日板块分类记录'}:null);
   const label=h('span',{},roleBadge(badge),' ',row.name||row.code,row.lb>0?' · '+row.lb+'板':'',row.strong?' · 题材强势':'');
   return row.code?button(label,()=>ctx.selectStock(row.code,{...row,poolDay:day,sector:group.sector}),'quiet'):label;
  }))))):empty('本期无板块分类记录');
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
const indexProvider=source=>({'tencent-index':'腾讯指数','tencent-qt':'腾讯行情','sina-index':'新浪指数'})[source]||source;
export function recoveryDisclosure(state){
 const r=state?.marketRecovery;
 const phase=({scheduled:'等待调度',searching:'正在采集',partial:'已取得部分观测',ready:'本轮已完成'})[r?.phase];
 const info=[r?.referenceDay?'目标交易日 '+r.referenceDay:'',phase||'等待服务端采集回执',
   Number.isFinite(r?.lastAttemptAt)&&r.lastAttemptAt>0?'最近尝试 '+dateTime(r.lastAttemptAt):'',
   Number.isFinite(r?.lastSuccessAt)&&r.lastSuccessAt>0?'最近成功 '+dateTime(r.lastSuccessAt):'',
   Number.isFinite(r?.nextRetryAt)&&r.nextRetryAt>0?'下次重试 '+dateTime(r.nextRetryAt):''];
 const sources=(Array.isArray(r?.sources)?r.sources:[]).filter(x=>x?.name);
 return h('details',{class:'fy-details fy-recovery-status'},h('summary',{},'行情来源与补采状态'),
  state.indexChannels?.length?h('section',{'aria-label':'盘中渠道回执'},h('h3',{},'盘中渠道回执'),
   h('ul',{},state.indexChannels.map(x=>h('li',{},indexProvider(x.source)+' · '+(x.quoteAt?x.count+' 个指数 · 源端 '+dateTime(x.quoteAt):
    x.status==='reading'?'正在读取':x.status==='unavailable'?'本次请求未成功':'本次未返回当日有效报价')+(x.checkedAt?' · 检查 '+dateTime(x.checkedAt):'')))),
   state.marketDistribution?.quoteAt?h('p',{},state.marketDistribution.source+' · '+dateTime(state.marketDistribution.quoteAt)):
   state.breadthChannel?h('p',{},'打板客盘中分布 · '+(state.breadthChannel.reason||'本轮口径未通过核对')+' · '+dateTime(state.breadthChannel.checkedAt)):null,
   state.auctionObservations?.items?.length?h('p',{},'竞价回执 '+state.auctionObservations.day+' · '+state.auctionObservations.items.length+' 只 · '+[...new Set(state.auctionObservations.items.flatMap(r=>[r.sealSource,r.source]).filter(Boolean))].join(' / ')):null):null,
  h('p',{class:'fy-muted'},info.filter(Boolean).join(' · ')),
  sources.length?h('ul',{},sources.map(x=>h('li',{},x.name+' · '+(x.status==='available'?'已取得观测':'等待重试')))):null);
}
export function observedMarketValues(recovery,fields){
 return fields.flatMap(([key,label,unit])=>{
  const row=recoveredMetric(recovery,key);
  const scoped=['upLimit','downLimit','breakRate'].includes(key)?'专题池'+label:key==='amount'?turnoverLabel(row):label;
  const value=typeof row?.value==='number'?row.value.toLocaleString('zh-CN',{maximumFractionDigits:2}):row?.value;
  return row?[h('div',{class:'fy-kpi fy-observed-value'},h('span',{},scoped),h('strong',{},value+(unit||'')),
   h('small',{},(row.historical?'上次有效 · ':'')+row.date+' · '+row.source),
   h('small',{},'取得 '+dateTime(row.knownAt)))]:[];
 });
}
export function coveragePanel(recovery){
 const rows=observedCoverage(recovery);
 if(!rows.length)return null;
 return h('details',{class:'fy-details fy-coverage'},h('summary',{},'分市场和样本明细 · '+rows.length+' 组'),rows.map(r=>h('article',{},
  h('strong',{},r.scope+' · '+(r.complete?'已核对该范围':'已覆盖部分')),h('span',{},coverageValues(r)),
  h('small',{},coverageCount(r)+' · '+r.day+' · '+r.source),
  h('small',{},'取得 '+dateTime(r.knownAt)))));
}
function sessionDistribution(state,day,live=true){
 const r=state.marketDistribution,now=Date.now(),today=state.marketClock?.day||new Date(now+28800000).toISOString().slice(0,10);
 if(live&&!state.closeSession){
  if(r?.kind==='market-distribution-intraday'&&r.day===today&&r.quoteAt<=r.knownAt&&r.knownAt<=now)return r;
  if(state.marketClock?.day||state.marketClock?.trading===true)return null;
 }
 return closeDistribution(state.marketRecovery,day,now);
}
export function distributionPanel(state,requestedDay){
 const day=requestedDay||closeSessionDay(state)||state.marketRecovery?.referenceDay;
 const r=sessionDistribution(state,day,requestedDay===undefined);
 if(!r){
  const mood=state.dashboard?.mood,at=mood?.scope?.snapAt,count=mood?.scope?.sample;
  if(requestedDay===undefined&&!state.closeSession&&state.marketClock?.day&&Number.isSafeInteger(at)&&at>0&&at<=Date.now()&&
    new Date(at+28800000).toISOString().slice(0,10)===state.marketClock.day&&count>0&&[mood.upN,mood.downN].every(n=>Number.isSafeInteger(n)&&n>=0)&&mood.upN+mood.downN<=count)
   return h('section',{class:'fy-distribution','aria-label':'盘中行情样本'},h('h3',{},'盘中行情样本'),h('p',{},dateTime(at)+' · V6 已采集 '+format(count,0)+' 只'),
    h('div',{class:'fy-count-strip'},[['上涨',mood.upN],['下跌',mood.downN]].map(([label,n])=>h('div',{},h('span',{},label),h('strong',{},format(n,0))))));
  return null;
 }
 const intraday=r.kind==='market-distribution-intraday';

 return h('section',{class:'fy-distribution','aria-label':intraday?'全市场盘中分布':'全市场收盘分布'},h('h3',{},r.scope+(intraday?' · 盘中':' · 收盘')),
  h('p',{class:'fy-muted'},(intraday?dateTime(r.quoteAt):r.day)+' · 取得有效行情 '+format(r.observed,0)+' / '+format(r.total,0)+' 只'),
  h('div',{class:'fy-count-strip'},[['上涨',r.adv],['下跌',r.dec],['平盘',r.flat],['涨停',r.upLimit],['跌停',r.downLimit]].map(([label,n])=>
   h('div',{},h('span',{},label),h('strong',{},format(n,0))))),
  r.buckets?h('details',{class:'fy-details'},h('summary',{},'查看 11 档涨跌分布'),h('div',{class:'fy-dbk-grid'},
   Object.entries({limit_up:'涨停',over_7:'涨幅超过7%',up_5_7:'涨5%至7%',up_3_5:'涨3%至5%',up_0_3:'涨0%至3%',flat:'平盘',down_0_3:'跌0%至3%',down_3_5:'跌3%至5%',down_5_7:'跌5%至7%',below_7:'跌幅超过7%',limit_down:'跌停'})
    .filter(([key])=>Number.isSafeInteger(r.buckets[key])).map(([key,label])=>h('div',{class:'fy-dbk-fact'},h('small',{},label),h('strong',{},r.buckets[key]+' 只'))))):null,
  h('details',{class:'fy-details'},h('summary',{},'统计来源与口径'),
   h('p',{},r.source+' · '+dateTime(r.quoteAt)+' · '+(r.total-r.observed)+' 只未计入涨跌分布。涨停计入上涨，跌停计入下跌。'),
   safeLink('https://www.dabanke.com/index-'+r.day.replaceAll('-','')+'.html',intraday?'逐项核对盘中分布':'逐项核对收盘分布')));
}
export function marketOverviewParts(state,{homeDay}={}){
 const target=closeSessionDay(state),recovery=state.marketRecovery,day=target||recovery?.referenceDay;
 const wide=sessionDistribution(state,day);
 const histories=(recovery?.indexSeries||[]).filter(v=>v.day===day&&v.knownAt<=Date.now());
 const summary=summarizeReview(state.review),mood=recoveredMetric(recovery,'emotion',day),trend=recoveredMetric(recovery,'trend',day);
 const indexAvailability=[];
 const indices=[['1.000001','上证指数'],['0.399001','深证成指'],['0.399006','创业板指']].map(([code,name])=>{
  const series=histories.find(v=>v.code===code),bars=series?.bars||[],quote=state.dashboard?.indices?.find(v=>v.code===code);
  const at=quoteAt(quote),stamp=Number.isSafeInteger(at)&&at>0&&at<=Date.now()?new Date(at+28800000).toISOString().slice(0,10):null;
  const hasClosingBar=!!target&&bars.at(-1)?.[0]===target&&Number.isFinite(bars.at(-1)?.[1]);
  const useQuote=stamp&&(!hasClosingBar||at>=Date.parse(target+'T15:00:00+08:00'))&&Number.isFinite(quote.price)&&quote.price>0&&(quote.source||quote.quoteSource||quote.quoteProvider)&&(target?stamp===target:stamp===(state.marketClock?.day||new Date(Date.now()+28800000).toISOString().slice(0,10)));
  const price=useQuote?quote.price:bars.at(-1)?.[1],change=useQuote?quote.pct:series?.change;
  let chart=null;
  if(bars.length>1){
   const values=bars.map(b=>b[1]),lo=Math.min(...values),hi=Math.max(...values);
   chart=document.createElementNS('http://www.w3.org/2000/svg','svg');
   chart.setAttribute('viewBox','0 0 160 26');chart.setAttribute('preserveAspectRatio','none');chart.setAttribute('aria-label',bars[0][0]+' 至 '+series.day+' 收盘走势');chart.setAttribute('role','img');
   const line=document.createElementNS(chart.namespaceURI,'polyline');
   line.setAttribute('points',values.map((v,i)=>[i*160/(values.length-1),hi===lo?13:24-(v-lo)/(hi-lo)*22].join(',')).join(' '));
   line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');chart.append(line);
  }
  const today=new Date(Date.now()+28800000).toISOString().slice(0,10);
  const actual=useQuote?stamp:series?.day;
  const lastSession=reviewDate(state.marketClock?.previousDay||state.marketClock?.lastTradingDay||state.marketRecovery?.referenceDay||state.closeSession?.day);
  const intradayQuote=useQuote&&at<Date.parse(stamp+'T15:00:00+08:00');
  const quoteKind=useQuote&&(!target||intradayQuote)?(actual===today?'今日盘中':'历史盘中报价'):actual===today?'今日收盘':actual&&actual===lastSession?'上一交易日收盘':'最近有效收盘';
  const provider=useQuote?indexProvider(quoteSource(quote)):series?.source;
  indexAvailability.push({name,ready:Number.isFinite(price)});
  const compactTime=useQuote&&homeDay&&stamp===homeDay;
  const quoteTime=useQuote?dateTime(at):series?.day;
  return h('article',{class:'fy-overview-index '+direction(change),'data-index':code},h('h3',{},name),
   h('div',{},h('strong',{},Number.isFinite(price)?format(price):'暂无报价'),Number.isFinite(change)?h('b',{},percent(change)):null),chart,
   useQuote||series?h('small',{class:'fy-index-meta','data-index-quote-at':useQuote?String(at):null},
    h('time',{datetime:useQuote?new Date(at).toISOString():series.day,title:compactTime?quoteTime:null},
     compactTime?quoteTime.split(' ').at(-1):quoteTime),
    [quoteKind,provider].filter(Boolean).join(' · ')):null,
   chart?h('small',{},(useQuote&&stamp!==series.day?'截至 '+series.day+' · ':'')+'近 '+bars.length+' 日收盘 · 不含今日分时'):null);
 });
 const native=state.dashboard?.mood,at=native?.scope?.snapAt;
 const nativeDay=Number.isSafeInteger(at)&&at>0&&at<=Date.now()?new Date(at+28800000).toISOString().slice(0,10):null;
 const currentDay=state.marketClock?.day||new Date(Date.now()+28800000).toISOString().slice(0,10);
 const external=state.dabanke?.day===(target||currentDay)&&state.dabanke.knownAt<=Date.now()?state.dabanke:null;
 const sealing=external?.ecology?.find(r=>r.label==='当日封板');
 const current=!target&&state.marketClock?.trading===true&&nativeDay===currentDay&&native?.scope?.sample>0;
 const fromLive=wide?.kind!=='market-distribution-intraday'&&current&&Number.isFinite(native.upRatio)&&native.upRatio>=0&&native.upRatio<=100;
 const breadth=fromLive?native.upRatio:wide?.observed>0?100*wide.adv/wide.observed:null;
 const env=wide?.kind==='market-distribution-intraday'?null:trend&&trend.date===day?trend.value:histories.find(r=>r.code==='1.000985')?.trend;
 const breadthEnvironment=fromLive?(breadth>=70?'普涨':native.downN/native.scope.sample>=.7?'普跌':'涨跌分化'):wide&&(wide.dec/wide.observed>=.7?'普跌':wide.adv/wide.observed>=.7?'普涨':'涨跌分化');
 const riskCount=state.dashboard?.counts?.risk,shSeries=histories.find(r=>r.code==='1.000001');
 const closes=(shSeries?.bars||[]).map(b=>b[1]).filter(v=>Number.isFinite(v)&&v>0);
 let peak=0,drawdown=0;
 for(const close of closes){peak=Math.max(peak,close);drawdown=Math.max(drawdown,(1-close/peak)*100);}
 const breadthLabel=fromLive?'盘中行情样本上涨占比':breadth!==null?'沪深京上涨占比':'';
 const glossary=(name,meaning)=>h('abbr',{class:'fy-term',title:meaning,tabindex:'0','aria-label':name+'，'+meaning,'data-help':meaning},'?');
 const emotion=mood&&mood.date===(target||currentDay)?mood:null;
 const needed=[['upLimit','涨停家数'],['downLimit','跌停家数'],['breakRate','炸板率'],['height','连板高度'],['leader','高标反馈'],['diffusion','题材扩散度']];
 const missing=needed.filter(([key])=>{const value=recoveredMetric(recovery,key,target||currentDay);return !value||value.date!==(target||currentDay);}).map(x=>x[1]);
 const emotionText=emotion?'当前处于'+emotion.value+'阶段，置信度 '+format(emotion.confidence,0)+'%。':
  '数据不足，暂不判断。'+(missing.length?'还需核对 '+missing.join('、')+' 的多日记录。':'现有多日记录尚未形成一致的周期证据。');
 const sentiment=h('article',{},h('h3',{},'市场情绪 ',glossary('情绪周期','用多个交易日的涨跌停、炸板、高标和题材扩散判断短线情绪。')),
   h('p',{},emotionText),breadth!==null?h('div',{class:'fy-breadth-gauge',style:'--breadth:'+Math.round(breadth*1.8)+'deg'},h('strong',{},format(breadth,1)+'%')):null,
   h('small',{class:'fy-home-breadth-basis'},[breadthLabel,emotion?.date].filter(Boolean).join(' · ')),
   sealing?h('small',{},'短线池封板 '+sealing.display+' · 打板客'):null);
 const judgment=(fromLive&&breadthEnvironment)||env||breadthEnvironment;
 const up=fromLive?native.upN:wide?.adv,down=fromLive?native.downN:wide?.dec;
 const breadthSentence=Number.isInteger(up)&&Number.isInteger(down)?'上涨 '+up+' 家 / 下跌 '+down+' 家，'+(up>down?'上涨家数占优，赚钱效应偏强。':down>up?'下跌家数占优，赚钱效应偏弱。':'涨跌家数持平。'):'本期没有同一范围的涨跌家数。';
 const environment=h('article',{},h('h3',{},'市场环境判断'),h('strong',{},judgment||'市场宽度观察'),h('p',{},breadthSentence),
   external?.market?.amount!=null?h('small',{},external.market.amountLabel+' '+external.market.amountText+' · 打板客'):null,
   h('small',{},fromLive?'同批行情 '+native.scope.sample+' 只':env?day+' 收盘 · 中证全指 5 / 10 / 20 日均线':wide?wide.day:''));
 const hasBreaks=summary.rows.some(r=>Number.isInteger(r.breakCount));
 const hasRisk=Number.isInteger(riskCount)||!!wide||Array.isArray(state.abMove?.items)||closes.length>1||hasBreaks;
 const risk=h('article',{class:'fy-overview-risk'},h('h3',{},'风险提示'),
   Number.isInteger(riskCount)?h('p',{},'先核对高风险候选 ',h('b',{},riskCount+' 只')):null,
   Array.isArray(state.abMove?.items)?h('p',{},'复查异动预警 ',h('b',{},new Set(state.abMove.items.filter(r=>r.code).map(r=>r.code)).size+' 只')):null,
   wide?h('p',{},'全市场跌停 ',h('b',{},wide.downLimit+' 家'),!target?h('small',{},wide.kind==='market-distribution-intraday'?dateTime(wide.quoteAt):wide.day):null):null,
   closes.length>1?h('p',{title:shSeries.day+' · '+shSeries.source},'上证近 '+closes.length+' 日最大回撤 ',h('b',{},format(drawdown,1)+'%')):null,
   hasBreaks?h('p',{},'样本开板回封 ',h('b',{},summary.opened.length+' 只')):null,
   !hasRisk?h('small',{},'本期尚无可核实的市场风险记录。'):null);
 return {indices,indexAvailability,sentiment,environment,risk,hasSentiment:breadth!==null||!!sealing||!!emotion,
  hasEnvironment:!!judgment,hasRisk};
}
export function marketOverviewCards(state){
 const {indices,sentiment,environment,risk}=marketOverviewParts(state);
 return h('div',{class:'fy-overview-six','aria-label':'市场总览六卡'},indices,sentiment,environment,risk);
}
export function ticker(state,{verifiedOnly=false}={}) {
 const labels={'1.000001':'上证指数','0.399001':'深证成指','0.399006':'创业板指','1.000688':'科创 50'};
 const data=state?.dashboard?.indices||[];
 return h('section',{class:'fy-market-ticker fy-index-evidence','aria-label':'指数快照'},Object.entries(labels).filter(([code])=>{if(!verifiedOnly)return true;const r=data.find(x=>x.code===code);return Number.isFinite(r?.price)&&r.price>0&&Number.isFinite(quoteAt(r))&&quoteAt(r)>0&&quoteAt(r)<=Date.now()&&!!(r.quoteSource||r.source||r.quoteProvider);}).map(([code,name])=>{const row=data.find(x=>x.code===code)||{};return h('div',{},h('span',{},name),h('strong',{class:direction(row.pct)},format(row.price)),h('small',{class:direction(row.pct)},percent(row.pct)),h('small',{class:'fy-quote-time'},quoteLabel(row)),h('small',{class:'fy-muted'},'单源观测 · 尚未交叉核验'));}));
}
export function renderPulse(route,ctx) {
 if(!route.sub||route.sub==='overview')return renderAllOpportunities(ctx);
 if(route.sub!=='market-overview')return renderMarket(route,ctx);
 const view=h('div',{class:'fy-market-workspace fy-stack'});
 function paint(){
 const state=ctx.state||{},dashboard=state.dashboard||{},rows=unique(rowsFrom(dashboard.rows)),mood=dashboard.mood||{};
 const counters=[['候选',dashboard.counts?.candidates,'opportunities','all'],['重点跟踪',dashboard.counts?.focused,'opportunities','focused'],
  ['策略信号',dashboard.counts?.signals,'inbox','signals'],['风险线索',dashboard.counts?.risk,'assets','risk']];
 const recovery=state.marketRecovery,phase=recoveredMetric(recovery,'emotion');
 const metrics=observedMarketValues(recovery,[['upLimit','涨停',' 家'],['downLimit','跌停',' 家'],['adv','上涨',' 家'],['dec','下跌',' 家'],['breakRate','炸板率','%'],['amount','成交额',' 亿元'],['height','连板高度',' 板'],['leader','高标反馈','%'],['diffusion','题材扩散度','%'],['premium','昨日涨停溢价','%'],['trend','全A趋势',''],['sh','上证趋势',''],['cy','创业板趋势',''],['theme','主线题材','']]);
 const marketDay=reviewDate(state.snapshotFieldDays?.dashboard||dashboard.snapshotDay||state.snapshotDay);
 const moodSource=dashboard.source||mood.source;
 const validBreadth=marketDay&&moodSource&&Number.isFinite(mood.upRatio)&&mood.upRatio>=0&&mood.upRatio<=100;
 updateReadout(view,
  h('header',{class:'fy-view-heading'},h('h1',{},'实时行情'),marketDay?h('p',{},'原始快照 '+marketDay):null),
  recoveryDisclosure(state),ticker(state,{verifiedOnly:true}),
  h('div',{class:'fy-grid four'},counters.filter(([,n])=>Number.isFinite(n)).map(([label,count,view,sub])=>
   button(h('span',{class:'fy-market-count'},h('small',{},label),h('strong',{},format(count,0))),()=>ctx.navigate(view,sub)))),
  distributionPanel(state),metrics.length?section('收盘观测','',h('div',{class:'fy-grid four'},metrics)):null,coveragePanel(recovery),
  h('div',{class:'fy-briefing-grid'},
   rows.length?section('行情候选','',h('div',{class:'fy-grid two'},rows.slice(0,4).map(row=>stockCard(row,ctx)))):null,
   phase||validBreadth?section('市场情绪','',phase?h('p',{},(phase.historical?'最近已判定周期 · ':'')+phase.value+' · '+phase.date+' · '+phase.source+' · 取得 '+dateTime(phase.knownAt)):null,
    validBreadth?h('div',{class:'fy-climate'},h('strong',{},percent(mood.upRatio)),h('span',{},'上涨家数占比 · '+marketDay+' · '+moodSource)):null):null));

 }
 ctx.onState?.(paint);paint();return view;
}
function externalQuoteLink(link){
 return link?h('a',{class:'fy-button quiet',href:link.url,target:'_blank',rel:'noopener noreferrer',referrerpolicy:'no-referrer'},link.label+' ↗'):null;
}
function boardPicker(state,boardLink,pick){
 const data=state.sectors,rows=Array.isArray(data)?data:data?.items||[];
 const industry=new Set((state.sectorsInd||[]).map(b=>b.code));
 const entries=rows.map(r=>{
  const name=r?.name||r?.sector||'';
  const kind=industry.has(r?.code)||['industry','行业'].includes(r?.category||r?.kind)?'industry':
    ['concept','概念'].includes(r?.category||r?.kind)?'theme':'unknown';
  const link=boardLink({name,kind});
  return link?{key:JSON.stringify([r.code||'',name]),name,rawCode:r.code,link}:null;
 }).filter(Boolean);
 if(!entries.length)return null;
 const items=[...new Map(entries.map(r=>[r.key,r])).values()];
 const select=h('select',{'aria-label':'选择核对板块'},items.map(r=>h('option',{value:r.key},r.name+(r.rawCode?' · '+r.rawCode:''))));
 const dest=h('span',{});const set=r=>{pick.key=r.key;select.value=r.key;dest.replaceChildren(externalQuoteLink(r.link));};
 set(items.find(r=>r.key===pick.key)||items[0]);
 select.addEventListener('change',()=>{const item=items.find(r=>r.key===select.value);if(item)set(item);});
 return h('div',{class:'fy-inline'},h('label',{},'板块行情 ',select),dest);
}
export function renderMarket(route,ctx) {
 const sub=route.sub||'sectors';
 if(sub==='review')return renderDailyReview(ctx);
 const top=h('div',{class:'fy-subnav'},[['sectors','板块地图'],['global','全球与资金'],['auction-review','竞价复盘'],['plans','交易计划'],['review','复盘与学习']].map(([key,label])=>button(label,()=>ctx.navigate('pulse',key),key===sub?'primary':'quiet')));
 const view=h('div',{class:'fy-stack'},ctx.workspaceNavigation?null:top);
 const labels=[['sectors','板块地图'],['global','全球与资金'],['plans','交易计划'],['review','复盘与学习']];
 if(sub==='auction-review') {
  const code=h('input',{name:'code',inputmode:'numeric',pattern:'[0-9]{6}',placeholder:'六位股票代码',value:ctx.stock||'',required:true});
  const date=h('input',{name:'date',type:'date',value:closeSessionDay(ctx.state||{})||reviewDate(ctx.state?.auction?.date)||''}),output=h('div'),archive=h('div');
  const logButton=button('读取最近竞价流水',async()=>{
   if(logButton.disabled)return;
   logButton.disabled=true;logButton.textContent='正在读取竞价流水…';
   try{const result=await ctx.api('/api/auction-log?n=80',{signal:ctx.signal});if(!ctx.signal.aborted)output.replaceChildren(renderEvidence(result));}
   catch(error){if(!ctx.signal.aborted)ctx.notify(error.message,'error');}
   finally{logButton.disabled=false;logButton.textContent='读取最近竞价流水';}
  });
  const paintAuction=()=>{
   const state=ctx.state||{},card=state.closeSession?.cards?.auction,items=rowsFrom(card?.items);
   const live=state.auction;
   const target=closeSessionDay(state)||state.marketClock?.day,day=items.length?reviewDate(card.snapshotDay):reviewDate(live?.date);
   const rows=target===day?(items.length?items:[1,2,3].includes(live?.phase)?rowsFrom(live?.strong):[]):[];
   const opening=state.auctionObservations?.day===target?auctionOpeningPanel(state.auctionObservations,ctx):null;
   updateReadout(archive,...(opening?[opening]:[]),...(rows.length?[section('竞价策略归档',day,renderEvidence(rows,ctx))]:
    opening?[]:[h('p',{class:'fy-muted'},'正在读取当日竞价流水。')]));
  };
  paintAuction();ctx.onState?.(paintAuction);
  view.append(section('开盘前发生了什么','竞价原始记录与逐股复盘',archive,h('form',{class:'fy-form',onSubmit:async e=>{e.preventDefault();try{const q=new URLSearchParams({code:code.value,date:date.value});const r=await ctx.api('/api/auction-review?'+q,{signal:ctx.signal});output.replaceChildren(renderEvidence(r));}catch(error){ctx.notify(error.message,'error');}}},h('div',{class:'fy-grid two'},field('股票代码',code),field('交易日',date)),h('button',{type:'submit',class:'fy-button primary'},'读取竞价复盘')),logButton,output));
  return view;
 }
 const datasetKeys=sub==='sectors'?[['板块强度','sectors'],['涨停题材','ztBySector'],['市场主线','mainline'],['板块联动','extLink']]:sub==='global'?[['全球市场','global'],['外部资金与商品','external'],['外围预选','preselect'],['资金异动','bigMoney']]:sub==='plans'?[['下一交易日计划','nextplan'],['十四条判定','myrules'],['启动前埋伏','pre'],['补涨线索','buzhang']]:[['复盘','review'],['历史学习','learn'],['学习记录','learnHistory'],['宽度与纪律','breadth']];
 const datasets=h('div',{class:'fy-grid two'});
 let pendingPaint=false;
 const boardPick={key:''};let boardLink=null;
 const paintDatasets=()=>{if(ctx.signal?.aborted)return;if(datasets.contains(document.activeElement)){pendingPaint=true;return;}pendingPaint=false;datasets.replaceChildren(...datasetKeys.map(([title,key])=>section(title,'同一份服务端市场状态',key==='sectors'&&boardLink?boardPicker(ctx.state||{},boardLink,boardPick):null,renderEvidence(ctx.state?.[key],ctx))));};
 if(sub==='sectors')import('./shortline/quote-links.mjs').then(m=>{boardLink=m.thsBoardLink;paintDatasets();}).catch(()=>{});
 datasets.addEventListener('focusout',()=>queueMicrotask(()=>{if(pendingPaint)paintDatasets();}));
 paintDatasets();ctx.onState?.(paintDatasets);
 view.append(h('header',{class:'fy-view-heading'},h('span',{class:'fy-eyebrow'},'FAYO / CONTEXT'),h('h1',{},labels.find(x=>x[0]===sub)?.[1]||'市场上下文')),datasets);
 if(sub==='sectors'){
  const radar=h('div',{},marketOverviewCards(ctx.state||{}));
  ctx.onState?.(()=>updateReadout(radar,marketOverviewCards(ctx.state||{})));
  const status=h('small',{class:'fy-muted',role:'status'}),receipt=h('div');
  const details=h('details',{class:'fy-details'},h('summary',{},'查看四大指数原始回执'),status,receipt);
  let reading=false,lastReceiptAt=-Infinity;
  details.addEventListener('toggle',async()=>{
   if(!details.open||reading||performance.now()-lastReceiptAt<5000)return;
   reading=true;status.textContent='正在读取指数回执…';
   try{
    const result=await ctx.api('/api/reference-indexes',{signal:ctx.signal});
    if(ctx.signal.aborted)return;
    const quotes=Object.values(result.items||{}).filter(row=>row?.name&&row.price>0&&Number.isFinite(row.price)&&
     Number.isSafeInteger(quoteAt(row))&&quoteAt(row)>0&&quoteAt(row)<=Date.now()&&row.quoteStatus!=='future');
    const cards=quotes.map(row=>h('article',{class:'fy-index-receipt-row'},h('strong',{},row.name),
     h('b',{class:direction(row.changePct)},format(row.price),Number.isFinite(row.changePct)?'　'+percent(row.changePct):''),
     Number.isFinite(row.previousClose)?h('small',{},'昨收 '+format(row.previousClose)):null,
     h('small',{},'源端 '+dateTime(quoteAt(row)))));
    receipt.replaceChildren(...cards,h('details',{class:'fy-details'},h('summary',{},'查看原始字段'),renderEvidence(result)));
    if(quotes.length)lastReceiptAt=performance.now();
    status.textContent=[indexProvider(result.source),quotes.length+' 个指数有原始报价',result.asOf?'取回于 '+dateTime(result.asOf):''].filter(Boolean).join(' · ');
   }catch(error){if(!ctx.signal.aborted)status.textContent=error.message;}
   finally{reading=false;}
  });
  view.append(section('指数雷达','',radar,details));
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
const seconds=ms=>Number.isFinite(ms)?format(ms/1000,1)+' 秒':'待核验';
const fastPhase=phase=>({'auction-revocable':'竞价初段','auction-fixed':'竞价后段',morning:'上午',afternoon:'下午'})[phase]||phase;
function fastMovesPanel(state,ctx,auctionOnly,expanded){
 const data=state.fastStockMoves;
 const auction=data?.phase?.startsWith('auction-');
 if(!data?.phase||auctionOnly&&!auction)return empty('当前没有可比较的重点股时点');
 const cached=state.trading===false||state.isSnapshot===true||Date.now()-data.checkedAt>15000;
 const status=(cached?'历史观察 · ':'')+dayLabel(data.tradeDate)+' · '+dateTime(data.checkedAt);
 const caption=state.readAt?'最近读取 '+dateTime(state.readAt):null;
 const stockRows=(items,retained=false)=>h('div',{class:'fy-stack'},items.map(row=>{
  const oldest=state.servedAt-row.quoteAt+state.readMs;
  return h('div',{class:'fy-item'},h('div',{class:'fy-inline'},
   button(row.name&&row.name!==row.code?row.name+' '+row.code:row.code,()=>ctx.selectStock(row.code,{...row,poolDay:data.tradeDate}),'quiet'),
   h('strong',{class:'fy-positive'},'+'+format(row.risePct,2)+'% / '+Math.round(row.spanMs/1000)+' 秒')),
   h('small',{class:'fy-muted'},format(row.basePrice)+' → '+format(row.price)+' · '+quoteLabel(row)),
   retained?h('small',{class:'fy-muted'},'捕捉于 '+dateTime(row.detectedAt)):
    !cached&&oldest>=0&&h('small',{class:'fy-muted'},'到页面约不超过 '+seconds(oldest)));
 }));
 const sources=(data.sources||[]).map(row=>h('li',{},reviewSupplier(row.source)+' · '+row.observed+' 只 · 原始报价到服务端中位 '+seconds(row.medianAgeMs)+' · 95 分位 '+seconds(row.p95AgeMs)));
 const totals=(data.sessionTotals||[]).map(row=>h('li',{},fastPhase(row.phase)+' · '+row.rounds+' 轮 · 有效 '+row.observed+' / '+row.requested+' 次 · 可比较 '+row.comparable+' 次 · 采集失败 '+row.failedRounds+' 轮'));
 const limits=(state.providerLimits||[]).map(row=>h('li',{},reviewSupplier(row.provider)+' · HTTP 403 '+row.responses403+' 次 · HTTP 429 '+row.responses429+' 次'+
   (row.stateUnavailable?' · 限流状态不可读':row.cooldownLeftMs>0?' · 退避剩余 '+seconds(row.cooldownLeftMs):'')));
 return h('div',{class:'fy-stack'},h('p',{class:'fy-muted'},(auction?'集合竞价虚拟匹配价 · ':'盘中报价 · ')+status),
  h('p',{class:'fy-muted'},'有效报价 '+data.observed+' / '+data.requested+' 只 · 可比较 '+data.comparable+' 只 · 达到 '+data.thresholdPct+'% '+data.count+' 只'),
  caption&&h('small',{class:'fy-muted','data-fast-read-time':''},caption),
  data.watchTotal>0&&h('small',{class:'fy-muted'},'自选本轮纳入 '+data.watchRequested+' / '+data.watchTotal+' 只'),
  data.items?.length?stockRows(data.items):empty(data.failed?'这轮采集失败':data.comparable?'这轮未见达到门槛的重点股':'待取得两个同源时点'),
  data.recentItems?.length&&h('details',{class:'fy-details','data-fast-section':'recent',open:expanded.has('recent')},
   h('summary',{},(cached?'该快照前的近期异动':'最近三分钟异动')+' · '+data.recentItems.length+' 只'),stockRows(data.recentItems,true)),
  (sources.length+totals.length+limits.length>0)&&h('details',{class:'fy-details','data-fast-section':'quality',open:expanded.has('quality')},
   h('summary',{},'采集质量与限流'),h('p',{class:'fy-muted'},'本轮采集 '+seconds(data.fetchMs)),
   sources.length>0&&h('ul',{class:'fy-evidence-list'},sources),totals.length>0&&h('ul',{class:'fy-evidence-list'},totals),
   limits.length>0&&h('p',{class:'fy-muted'},'各源 HTTP 计数 · 本次服务启动以来'),limits.length>0&&h('ul',{class:'fy-evidence-list'},limits)));
}

function fastWatchPanel(ctx){
 const status=h('p',{role:'status',class:'fy-muted'}),items=h('div',{class:'fy-inline'});
 const input=h('input',{type:'text',inputmode:'numeric',maxlength:'6',placeholder:'六位股票代码','aria-label':'自选股票代码'});
 const panel=h('details',{class:'fy-details'},h('summary',{},'自选监控'),
  h('p',{class:'fy-muted'},'自选使用同一轮报价的剩余名额，持仓和策略优先。'),
  h('div',{class:'fy-inline'},input,button('加入自选',()=>save(input.value.trim(),true),'quiet')),status,items);
 let busy=false;
 async function save(code,enabled){
  if(busy)return;
  if(code!==undefined&&!/^\d{6}$/.test(code)){status.textContent='请输入六位股票代码';return;}
  busy=true;
  try{
   const options=code===undefined?{signal:ctx.signal}:{method:'POST',body:{code,enabled},signal:ctx.signal};
   const result=await ctx.api('/api/fast-stock-moves/watch',options);
   if(ctx.signal.aborted)return;
   if(!Number.isInteger(result.limit)||!Array.isArray(result.items))throw Error('当前服务尚未提供自选监控');
   status.textContent=result.items.length+' / '+result.limit+' 只';
   items.replaceChildren(...result.items.map(stock=>button('移除 '+(stock.name&&stock.name!==stock.code?stock.name+' ':'')+stock.code,()=>save(stock.code,false),'quiet')));
   if(enabled)input.value='';
  }catch(error){if(!ctx.signal.aborted)status.textContent=error.message;}
  finally{busy=false;}
 }
 panel.addEventListener('toggle',()=>{if(panel.open)save();});
 return panel;
}

function auctionOpeningPanel(tape,ctx,{board='all',query=''}={}){
 if(!tape?.day)return null;
 const indicative=tape.phase==='before-match';
 const rows=((indicative?tape.indicative:tape.items)||[]).filter(r=>r.day===tape.day&&r.quoteAt<=r.knownAt&&r.knownAt<=Date.now()&&
  (board==='all'||(board==='gem'?/^30/:/^(00|60)/).test(r.code))&&(!query||(r.name+' '+r.code).toLowerCase().includes(query)));
 const shown=rows.slice(0,5);
 const last=tape.channels?.print;
 const failed=last?.failed>0;
 return h('section',{class:'fy-panel fy-stack','aria-label':'开盘集合竞价观察'},h('h2',{},indicative?'集合竞价指示价':'09:25 集合竞价观察'),
  h('p',{class:'fy-muted'},tape.day+' · '+tape.scope+(shown.length?' · 展示 '+shown.length+' / '+rows.length+' 只':'')),
  shown.length?h('div',{class:'fy-stock-grid'},shown.map(r=>h('article',{class:'fy-stock-card','data-auction-code':r.code},
   h('div',{class:'fy-stock-head'},h('button',{type:'button',class:'fy-button quiet',onClick:e=>ctx.selectStock(r.code,r,e.currentTarget)},r.name+' '+r.code),
    h('span',{class:'fy-tag'},indicative?'指示涨幅 '+percent(r.openPct):r.sealSource?'09:25 封板':'昨日梯队 · 竞价高开 '+percent(r.openPct))),
   indicative?h('p',{},'指示价 '+format(r.price)+' 元'):r.source?h('p',{},'成交 '+format(r.price)+' 元 · '+percent(r.openPct)+' · '+money(r.amountYuan)+'元'):null,
   h('div',{class:'fy-muted'},[r.sealSource,r.source].filter(Boolean).join(' / ')),
   h('small',{class:'fy-muted'},(indicative?'指示报价 ':r.source?'撮合成交 ':'封板 ')+dateTime(r.quoteAt)+' · 回执 '+dateTime(r.knownAt))))):
   indicative?h('p',{class:'fy-muted'},'09:25 撮合后自动显示开盘结果。'):
    query||board!=='all'?h('p',{class:'fy-muted'},'已取得的记录中，此范围暂无匹配。'):
    tape.printCount?h('p',{class:'fy-muted'},'已核对 '+tape.printCount+' 只开盘成交，本范围暂未出现封板或高开 2% 的记录。'):
    failed?null:h('p',{class:'fy-muted'},'正在核对同日逐笔成交与竞价封板回执。'),
  !indicative&&failed?h('p',{class:'fy-muted'},'开盘价量核对 · 本轮 '+last.failed+' / '+last.requested+' 个标的取数失败',
   last.httpStatuses?.length?'（HTTP '+last.httpStatuses.join('、')+'）':'',' · '+dateTime(last.checkedAt)):null);
}
export function renderOpportunities(route,ctx) {
 if(route.sub==='all')return renderAllOpportunities(ctx);
 if(!route.sub)route={...route,sub:'ranked'};
 if(['relay-first','relay-second'].includes(route.sub))return renderRelayCard(ctx,route.sub);
 let active=POOLS.find(x=>x[0]===route.sub)||POOLS.find(x=>x[0]==='quant'),current=[],query='',board='all',sort='score',cursor='',max=50,loadGeneration=0,snapshotIdentity='',closeWatch=null,unarchived=false;
 const curated=active[0]==='ranked';
 const auctionHost=active[0]==='auction'?h('div',{'data-auction-observations':''}):null;
 let endpointAuction=null,readingBoard=null,strategyIssue='';
 const fastMoves=['movement','auction'].includes(active[0])?h('div',{'data-fast-stock-moves':''}):null;
 const fastMovesCard=fastMoves?h('details',{class:'fy-details fy-panel',open:true},h('summary',{},'重点股 · 近一分钟涨速'),
  fastMoves,ctx.canEdit&&fastWatchPanel(ctx)):null;
 const view=h('div',{class:curated?'fy-stack fy-system-picks':'fy-stack'}),body=h('div'),summaryView=h('div',{class:'fy-pool-summary'}),status=h('p',{class:'fy-note',role:'status'}),selector=h('select',{'aria-label':'选择股票池'},POOLS.map(([key,label])=>h('option',{value:key,selected:key===active[0]},label)));
 selector.value=active[0];selector.addEventListener('change',()=>ctx.navigate('opportunities',selector.value));
 const search=h('input',{type:'search',placeholder:'搜索名称、代码或板块','aria-label':'筛选股票池'});
 search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();paint();});
 const boardSelect=h('select',{'aria-label':'市场范围'},[['all','全部市场'],['main','主板'],['gem','创业板']].map(([value,label])=>h('option',{value},label)));
 boardSelect.addEventListener('change',()=>{board=boardSelect.value;load();});
 const sortSelect=h('select',{'aria-label':'股票池排序'},[['score','评分'],['pct','涨跌幅'],['original','原始顺序']].map(([value,label])=>h('option',{value},label)));
 sortSelect.addEventListener('change',()=>{sort=sortSelect.value;paint();});
 const loadMore=button('加载下一页',()=>load(true));loadMore.hidden=true;
 const readTime=curated?h('time',{class:'fy-muted','data-system-picks-read-time':'true'}):null;
 const refreshResults=button(curated?'刷新结果':'读取最新结果',()=>curated||ctx.state?.closeSession?ctx.refresh({showSuccess:false}):load(),'primary');
 if(curated)view.append(
  h('header',{class:'fy-view-heading'},h('div',{},h('h1',{},active[1]),h('p',{},active[2])),refreshResults),
  h('div',{class:'fy-system-picks-meta'},status,readTime),
  h('div',{class:'fy-system-picks-tools'},search,field('范围',boardSelect),button('全部候选',()=>ctx.navigate('opportunities','all'),'quiet')));
 else {
  view.append(h('header',{class:'fy-view-heading'},h('h1',{},active[1])));
  if(auctionHost)view.append(auctionHost);
  if(fastMovesCard)view.append(fastMovesCard);
  view.append(simpleNavigation(ctx,active[0]),
   h('div',{class:'fy-opportunity-toolbar'},field('观察池',selector),search,field('范围',boardSelect),field('排序',sortSelect),refreshResults),status);
 }
 view.append(summaryView,body,loadMore);
 function paintOpening(){
  if(!auctionHost)return;
  const state=ctx.state||{},day=closeSessionDay(state)||state.marketClock?.day;
  const tape=[state.auctionObservations,endpointAuction].filter(t=>t&&t.day===day).sort((a,b)=>b.items.length-a.items.length||b.printCount-a.printCount)[0];
  const panel=auctionOpeningPanel(tape,ctx,{board,query});
  updateReadout(auctionHost,...(panel?[panel]:[]));
 }
 function paint(background=false) {
  paintOpening();
  const replaceList=(...children)=>refreshPoolList(body,background,children);
  let rows=current.filter(r=>(!query||[r.name,r.code,r.sector].some(x=>String(x||'').toLowerCase().includes(query)))&&(board==='all'||(board==='gem'?/^30/:/^(00|60)/).test(r.code)));
  if(sort!=='original')rows=[...rows].sort((a,b)=>(Number.isFinite(b[sort])?b[sort]:-Infinity)-(Number.isFinite(a[sort])?a[sort]:-Infinity));
  if(curated){
   const picks=selectResearchPicks(ctx.state,{board,query});
   status.textContent='系统精选 · '+picks.items.length+' 只'+(picks.day?' · 原始交易日 '+picks.day:'')+' · '+picks.label;
   replaceList(picks.items.length?h('div',{class:'fy-stock-grid','aria-label':'系统精选股票'},picks.items.map(row=>stockCard(row,ctx))):
    empty(query||board!=='all'?'没有符合筛选条件的精选':'本期没有符合条件的标的','行情刷新后会自动重新核对入选依据。'));
   return;
  }
  const observation=closingWatchPanel(closeWatch,ctx,{board,query});
  if(!current.length&&unarchived){
   replaceList(observation||h('p',{class:'fy-note'},'收盘记录会在同步完成后自动显示。'));
   return;
  }
  const signal=r=>Array.isArray(r.signals)&&r.signals.length||['triggered','sent','pending'].includes(r.stage);
  const groups=[['正在探索',rows.filter(r=>!signal(r)&&!r.focused),'研究候选'],['重点跟踪',rows.filter(r=>!signal(r)&&r.focused),'重点关注'],['已有信号',rows.filter(signal),'已返回的策略信号']];
  const populatedGroups=groups.filter(([,list])=>list.length);
  const stageStrip=h('div',{class:'fy-stage-strip','aria-label':'观察阶段数量'},groups.map(([label,list])=>h('span',{class:'fy-stage-chip'},label,h('b',{},list.length))));
  replaceList(stageStrip,populatedGroups.length?h('div',{class:'fy-pool-board fy-lanes-'+populatedGroups.length},populatedGroups.map(([label,list,description])=>h('section',{class:'fy-pool-column'},h('header',{},h('h2',{},label),h('span',{class:'fy-tag'},list.length)),h('p',{class:'fy-muted'},description),h('div',{class:'fy-stock-grid'},list.map(r=>stockCard(r,ctx)))))):auctionHost?h('p',{class:'fy-muted'},strategyIssue||'本轮没有通过板块共振条件的策略信号。'):empty('当前筛选没有匹配'),...(observation?[observation]:[]));
 }
 function paintFastMoves() {
  if(!fastMoves||fastMoves.contains(document.activeElement)&&document.activeElement.tagName!=='SUMMARY')return;
  const expanded=new Set([...fastMoves.querySelectorAll('details[open][data-fast-section]')].map(node=>node.dataset.fastSection));
  const focused=fastMoves.contains(document.activeElement)?document.activeElement.parentElement.dataset.fastSection:null;
  const frame=ctx.fastFrame,shared=ctx.state||{};
  const source=frame&&frame.servedAt>=(shared.now||0)?frame:shared;
  fastMoves.replaceChildren(fastMovesPanel(source,ctx,active[0]==='auction',expanded));
  if(focused)fastMoves.querySelector('[data-fast-section="'+focused+'"] summary')?.focus({preventScroll:true});
 }
 async function load(append=false,background=false) {
  paintOpening();
  if(auctionHost&&background&&readingBoard===board)return;
  const state=ctx.state||{},turn=++loadGeneration,requestedBoard=board;
  readingBoard=board;
  paintFastMoves();
  loadMore.disabled=true;
  if(active[4]==='edit'&&ctx.role!=='edit'){body.replaceChildren(empty('该观察池需要开发者权限','行情与公开选股池仍可正常浏览。'));return;}
  if(!background)status.textContent='正在读取 '+active[1]+'…';
  try {
   let data;
   if(active[3].startsWith('state:')) {
    data=curated?{items:[],snapshotDay:closeSessionDay(state)}:poolStateResult(active,state);
    current=unique(data.items);
   } else {
    const params=active[0]==='matches'?new URLSearchParams({limit:String(max),...(append&&cursor?{cursor}:{})}):new URLSearchParams({board:requestedBoard,max:String(max)});
    data=await ctx.readPool(active[0]+':'+requestedBoard,()=>ctx.api(active[3]+'?'+params,{signal:ctx.signal,timeoutMs:60000}),{append});
    if(ctx.signal.aborted||turn!==loadGeneration)return;
    if(auctionHost&&data?.auctionObservations){endpointAuction=data.auctionObservations;paintOpening();}
    if(!(state.closeSession&&data.status==='pending')&&!(state.closeSession&&data.status==='unknown'))requirePoolReady(data);
    if(append&&snapshotIdentity&&data.snapshotId&&data.snapshotId!==snapshotIdentity){cursor='';ctx.notify('扫描快照已更新，将读取新的第一页');load(false);return;}
    snapshotIdentity=data.snapshotId||snapshotIdentity;
    const incoming=unique(rowsFrom(data.items||data)).map(row=>data.forwardTracking&&!row.forwardTracking?{...row,forwardTracking:data.forwardTracking}:row);current=append?unique([...current,...incoming]):incoming;
    cursor=data.nextCursor||'';loadMore.hidden=!data.hasMore;
   }
   if(ctx.signal.aborted||turn!==loadGeneration)return;
   strategyIssue='';
   summaryView.replaceChildren(...['cycle','timing','feedback','sectorView'].filter(key=>data[key]).map(key=>h('details',{class:'fy-details'},h('summary',{},({cycle:'短线周期',timing:'时机反馈',feedback:'历史反馈',sectorView:'板块结构'})[key]),renderEvidence(data[key]))));
   const target=closeSessionDay(state),day=reviewDate(data.snapshotDay);
   const completeEmpty=data.completeForScope===true||data.snapshotRetained===true&&!data.freezeUnavailable&&!data.boardFallback&&day===target;
   unarchived=!!target&&!current.length&&!completeEmpty;
   closeWatch=target&&(unarchived||day&&day!==target)?closingWatch(state):null;
   status.textContent=unarchived?target+' · '+active[1]+'尚无该日策略归档':
    [active[1],current.length+' 只',day?'原始交易日 '+day:'',data.isSnapshot||data.snapshotRetained?'保留快照':''].filter(Boolean).join(' · ');
   if(readTime){
    const at=ctx.lastRead;
    readTime.textContent='最近读取 '+(at?dateTime(at):'待读取');
    if(at)readTime.setAttribute('datetime',new Date(at).toISOString());
   }
   if(data.note&&!unarchived)status.textContent+=' · '+data.note;
   paint(background);
  }catch(error){if(ctx.signal.aborted||turn!==loadGeneration)return;if(error.body?.status==='snapshot-changed'){cursor='';load(false);return;}
   if(closeSessionDay(state)){closeWatch=closingWatch(state);unarchived=!current.length;status.textContent=closeSessionDay(state)+' · '+active[1]+'归档自动重试中';paint(background);}
   else if(auctionHost){strategyIssue=error.message.includes('行情未就绪')?'共振筛选正在等本交易日的个股与板块行情。':error.message;status.textContent='竞价共振策略';paint(background);}
   else{status.textContent=error.message;status.className='fy-note error';if(!current.length)body.replaceChildren(empty('此次读取未完成',error.message));ctx.notify(error.message,'error');}}
  finally{if(turn===loadGeneration){loadMore.disabled=false;readingBoard=null;}}
 }
 ctx.onState?.((_,options)=>load(false,options?.manual===false));
 if(fastMoves)ctx.onFastMoves?.(paintFastMoves);
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
 const field=key==='pool'?'candidatePool':key==='focused'?'dashboard':key;
 const dates=[...new Set(items.map(row=>{
  const at=quoteAt(row);
  return Number.isSafeInteger(at)&&at>0&&at<=Date.now()?new Date(at+28800000).toISOString().slice(0,10):null;
 }))];
 const quotedDay=dates.length===1?dates[0]:null;
 const day=key==='yierList'?(state.yierAsOf||quotedDay):key==='lianbanList'?(state.lianbanAsOf||quotedDay):
  key==='ztPool'?state.ztDay:dates.length>1?null:dates[0]||state.snapshotFieldDays?.[field];
 return {items,snapshotDay:reviewDate(day)||null,isSnapshot:state.isSnapshot||state.dashboard?.isSnapshot};
}
export function systemPicks(state={}) {
 const dashboardRows=rowsFrom(state.dashboard?.rows),useDashboard=dashboardRows.length>0;
 const dates=state.snapshotFieldDays||{};
 const declared=reviewDate(useDashboard?
  (Object.hasOwn(dates,'dashboard')?dates.dashboard:Object.hasOwn(dates,'candidatePool')?dates.candidatePool:state.dashboard?.snapshotDay):
  (Object.hasOwn(dates,'pool')?dates.pool:Object.hasOwn(dates,'candidatePool')?dates.candidatePool:state.poolDay));
 const base=useDashboard?dashboardRows:rowsFrom(state.pool);
 const originals=new Set(base.map(r=>{
  const at=quoteAt(r);return Number.isSafeInteger(at)&&at>0&&at<=Date.now()?new Date(at+28800000).toISOString().slice(0,10):null;
 }));
 const day=originals.size===1&&[...originals][0]||declared;
 const leadership=sectorLeadershipEvidence(state);
 const items=unique(base).map(row=>{
  const poolDay=row.poolDay||systemPickDay(row,day)||undefined;
  return {...row,poolDay,sectorLeadership:leadership({...row,poolDay}).status,
   signals:row.signals||row.paths,explanation:row.explanation||(typeof row.pathWhy==='string'?[row.pathWhy]:row.pathWhy)};
 })
  .sort((a,b)=>(Number.isFinite(b.score)?b.score:-Infinity)-(Number.isFinite(a.score)?a.score:-Infinity));
 return {items,snapshotDay:day,isSnapshot:state.isSnapshot||state.dashboard?.isSnapshot};
}
// A short observation list. The production score and frozen research pools stay intact.
export function selectResearchPicks(state={}, {level,board='all',query='',native,now=Date.now()}={}){
 const target=closeSessionDay(state)||(state.trading===true?new Date(now+28800000).toISOString().slice(0,10):null);
 const pool=native||(level?{items:[]}:systemPicks(state)),day=reviewDate(pool.snapshotDay),watch=closingWatch(state,now);
 const byCode=new Map((watch?.items||[]).map(row=>[row.code,row]));
 const permitted=eligiblePick;
 const matches=row=>watchBoard(row.code,board)&&(!query||[row.code,row.name,row.sector].some(x=>String(x||'').toLowerCase().includes(query)));
 const datedFact=row=>{const s=state.dabanke;return s?.day===(row.poolDay||target||watch?.day)&&s.knownAt<=now?s.facts?.[row.code]:null;};
 const risks=row=>{
  const fact=datedFact(row),list=(fact?.risks||[]).map(name=>'打板客同日形态「'+name+'」');
  if(fact?.dragon?.net<0)list.push('龙虎榜披露净卖 '+money(-fact.dragon.net)+'（'+(fact.dragon.span.multi?'多日榜':'单日榜')+'）');
  if(Number.isInteger(row.breakCount)&&row.breakCount>0)list.push('当日开板 '+row.breakCount+' 次，关注再次开板后的承接');
  if(row.aboveMa5===false)list.push('收盘位于五日线下方');
  if(row.level>=3)list.push(row.level+' 连板后，关注次日分歧和高位回撤');
  return list.length?list.join('；'):row.breakCount===0&&row.firstSeal?'当日 '+row.firstSeal+' 首封后未开板；下一交易日若再开板，核对能否回封。':'观察下一交易日是否继续封板及同题材助攻数。';
 };
 const qualified=[];
 for(const row of pool.items||[]){
  const own=systemPickDay(row,day,now);
  if(!permitted(row)||!own||target&&own!==target||row.tradeDate&&reviewDate(row.tradeDate)!==own)continue;
  const observed=own===watch?.day?byCode.get(row.code):null;
  const why=pickReasons(row);
  if(!why.length&&native&&level)why.push('已列入 '+own+' 的'+(level===1?'一进二':'二进三')+'策略归档');
  if(!why.length)continue;
  const combined={...observed,...row,poolDay:own};
  qualified.push({...combined,selectionWhy:why.slice(0,3).join('；'),selectionRisk:risks(combined),pickSource:'V6 策略命中'});
 }
 if(qualified.length)return {day:target||qualified[0].poolDay,label:'策略精选',items:topSystemPicks(qualified.filter(matches))};
 const sealed=[];
 for(const row of byCode.values()){
  if(!permitted(row)||level&&row.level!==level||!(Number.isInteger(row.level)&&row.level>0)||!Number.isInteger(row.breakCount)||row.breakCount<0||!/^\d{2}:\d{2}:\d{2}$/.test(row.firstSeal||''))continue;
  const proof=limitReasonEvidence(row,row.reasonRaw||row.reason,watch.day)||datedFact(row)?.logic;
  if(!proof)continue;
  // Select on actual seal stability and timing. A one-board afternoon or repeatedly broken seal alone is insufficient.
  if(row.level===1&&(row.breakCount!==0||row.firstSeal>'10:30:00'))continue;
  sealed.push({...row,poolDay:watch.day,pickSource:'收盘观察精选',selectionWhy:row.level+' 板，'+row.firstSeal+' 首封，'+(row.breakCount?'盘中开板 '+row.breakCount+' 次':'盘中未开板'),selectionRisk:risks(row)});
 }
 sealed.sort((a,b)=>b.level-a.level||a.breakCount-b.breakCount||a.firstSeal.localeCompare(b.firstSeal)||a.code.localeCompare(b.code));
 return {day:watch?.day||target,label:'收盘观察精选',items:sealed.filter(matches).slice(0,3)};
}
export function researchPickPanel(picks,ctx){
 return section(picks.label+' · '+picks.items.length+' 只',picks.day||'',picks.items.length?
  h('div',{class:'fy-stock-grid'},picks.items.map(row=>stockCard(row,ctx))):empty('本期无符合条件的标的'));
}
export function combinePoolResults(entries,now=Date.now()) {
 const byCode=new Map();
 // Keep each source's evidence intact. Never graft one pool's quote time onto another price.
 for(const entry of entries)for(const raw of rowsFrom(entry.data)) {
  const proof={pool:entry.label,day:entry.data?.snapshotDay||null,row:raw};
  let item=byCode.get(raw.code);
  const at=quoteAt(raw),validAt=Number.isFinite(raw.price)&&raw.price>0&&Number.isSafeInteger(at)&&at>0&&at<=now?at:0;
  if(!item){item={row:raw,at:validAt,day:proof.day,proofs:[]};byCode.set(raw.code,item);}
  else if(validAt>item.at){item.row=raw;item.at=validAt;item.day=proof.day;}
  item.proofs.push(proof);
 }
 return [...byCode.values()].map(item=>({...item.row,poolDay:item.day,
  poolLabels:[...new Set(item.proofs.map(proof=>proof.pool))],poolEvidence:item.proofs}));
}
function simpleNavigation(ctx,active='all') {
 return h('nav',{class:'fy-grid two fy-pick-shortcuts','aria-label':'常用卡片'},
  [['all','全部选股','opportunities'],['review','今日复盘','pulse'],['relay-first','一进二','opportunities'],['relay-second','二进三','opportunities']]
   .map(([key,label,view])=>button(label,()=>ctx.navigate(view,key),active===key?'primary':'secondary')));
}
function advancedPools(ctx) {
 const selector=h('select',{'aria-label':'选择股票池'},h('option',{value:'all'},'全部候选'),POOLS.map(([key,label])=>h('option',{value:key},label)));
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
  ...allowed().filter(pool=>pool[3].startsWith('state:')&&pool[0]!=='relay-second'&&!(pool[0]==='limits'&&state.ztPoolFromCloseWatch)).map(pool=>({label:pool[0]==='ranked'?'候选池快照':pool[1],data:poolStateResult(pool,state)})),
  {label:'首页候选',data:{items:state.dashboard?.rows||[],snapshotDay:state.dashboard?.snapshotDay||state.snapshotFieldDays?.dashboard||state.snapshotDay}},
  ...remote.filter(entry=>!entry.private||ctx.role==='edit')];}
 function paint(){
  if(ctx.signal?.aborted)return;
  indexes.replaceChildren(ticker(ctx.state));
  const all=combinePoolResults(entries()),rows=all.filter(row=>!query||[row.name,row.code,row.sector].some(value=>String(value||'').toLowerCase().includes(query)));
  // Scores from different strategies are not calibrated against one another.
  const target=closeSessionDay(ctx.state||{}),watch=!all.length&&target?closingWatch(ctx.state):null;
  status.textContent=watch?target+' · 收盘观察名单':('已汇总 '+all.length+' 只候选 · 各股票池自动合并去重'+(busy?' · 正在读取更多结果…':''));
  replaceKeepingStockFocus(output,rows.length?h('div',{class:'fy-stock-grid'},rows.slice(0,shown).map(row=>stockCard(row,ctx))):watch?closingWatchPanel(watch,ctx,{query}):empty(query?'没有匹配这次搜索的股票':'暂未取得候选结果'));
  more.hidden=shown>=rows.length;more.textContent='显示更多股票（剩余 '+Math.max(0,rows.length-shown)+' 只）';
  diagnostics.replaceChildren(...remote.map(entry=>h('p',{class:'fy-muted'},entry.label+'：'+(entry.error||entry.data?.note||rowsFrom(entry.data).length+' 只')+(entry.data?.hasMore?' · 还有分页结果，请在“全部命中”中继续查看':'')+(entry.data?.snapshotDay?' · '+dayLabel(entry.data.snapshotDay):''))),
   h('p',{class:'fy-muted'},'汇总当前服务已返回的候选，不代表全市场全部股票；单接口有返回上限。各池日期和依据分别保留，收盘后不补造盘中结果。'));
 }
 async function loadRemote(force=false){
  if(busy||ctx.signal?.aborted||!ctx.state?.closeSession&&!force&&lastAttempt&&Date.now()-lastAttempt<60000)return;
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
 const view=h('div',{class:'fy-stack'},h('header',{class:'fy-view-heading'},h('h1',{},'选好的票，直接看'),h('p',{},'按代码合并各个股票池，保留每只候选的来源。')),indexes,simpleNavigation(ctx),h('div',{class:'fy-inline'},search,refreshButton),status,output,more,advancedPools(ctx),h('details',{class:'fy-details'},h('summary',{},'数据状态与覆盖范围'),diagnostics));
 ctx.onState?.(()=>{paint();loadRemote();});paint();loadRemote();return view;
}
export function renderRelayCard(ctx,key) {
 const pool=POOLS.find(pool=>pool[0]===key),output=h('div'),message=h('p',{class:'fy-note',role:'status'});
 function paint(){
  if(ctx.signal?.aborted)return;
  if(ctx.role!=='edit'){output.replaceChildren(empty('此卡片需要管理者身份','账户授权保持原有权限。'));return;}
  const data=poolStateResult(pool,ctx.state||{}),day=reviewDate(data.snapshotDay);
  const target=closeSessionDay(ctx.state||{}),watch=target&&(!data.items.length||target!==day)?closingWatch(ctx.state):null;
  message.textContent=data.items.length?[pool[1],data.items.length+' 只',day?'原始交易日 '+day:''].filter(Boolean).join(' · '):
   target?target+' · '+pool[1]+'尚无该日策略归档':pool[1]+'候选正在同步';
  updateReadout(output,...(data.items.length&&!watch?[h('div',{class:'fy-stack'},selectResearchPicks(ctx.state,{native:{items:data.items,snapshotDay:day},level:key==='relay-first'?1:2}).items.map(row=>detailedStockCard(row,ctx)))]:[]),
   ...(watch?[researchPickPanel(selectResearchPicks(ctx.state,{level:key==='relay-first'?1:2}),ctx)]:!data.items.length?[empty('等待'+pool[1]+'策略归档')]:[]));
 }
 const refreshButton=button('刷新'+pool[1],async()=>{
  refreshButton.disabled=true;
  try{
   if(ctx.role==='edit'&&!closeSessionDay(ctx.state||{})&&ctx.state?.trading!==false){
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
export function closeSessionDay(state={}) {
 if(Object.hasOwn(state,'closeSession'))return reviewDate(state.closeSession?.day);
 if(state.trading!==false&&!state.isSnapshot&&!state.dashboard?.isSnapshot)return null;
 return reviewDate(state.marketRecovery?.referenceDay||state.snapshotDay||state.dashboard?.snapshotDay);
}
// This watchlist is a public close observation. It never enters strategy scores,
// signal counts, the candidate union, or the execution state.
export function closingWatch(state={},now=Date.now()) {
 const day=closeSessionDay(state);
 if(!day||!(Date.parse(day+'T15:00:00+08:00')<=now))return null;
 const watch=state.marketRecovery?.closeWatch;
 if(watch?.day===day&&Number.isSafeInteger(watch.knownAt)&&watch.knownAt<=now&&watch.source&&watch.complete&&Array.isArray(watch.items))return watch;
 const meta=state.ztReviewPoolMeta;
 if(reviewDate(meta?.tradeDate)===day){
  const items=rowsFrom(state.ztReviewPool).filter(r=>!r.heldRecord&&r.currentSourceConfirmed!==false&&
   [r.tradeDate,r.sourceTradeDate].filter(Boolean).length&&[r.tradeDate,r.sourceTradeDate].every(d=>!d||reviewDate(d)===day))
   .map(r=>({...r,reasonRaw:r.reasonRaw||r.reason,level:r.limitUpCount??r.lb??r.level}));
  if(items.length)return {day,source:'V6 来源涨停池',scope:'同日逐股记录',items:unique(items)};
 }
 if(reviewDate(state.review?.date)===day){
  const items=rowsFrom(state.review).filter(r=>[r.tradeDate,r.sourceTradeDate].every(d=>!d||reviewDate(d)===day))
   .map(r=>({...r,level:r.limitUpCount}));
  if(items.length)return {day,source:'V6 收盘复盘',scope:'已分析明细',items:unique(items)};
 }
 return null;
}
// A read-only projection used by all native market views. Server state, account
// records, and strategy inputs stay separate from display-only closing evidence.
const closedViews=new WeakMap();
export function projectClosingWorkspace(state,now=Date.now()){
 if(!state||!closeSessionDay(state))return state;
 if(closedViews.has(state))return closedViews.get(state);
 const watch=closingWatch(state,now);
 if(!watch)return state;
 const day=watch.day,raw=reviewDate(state.review?.date)===day?state.review:null;
 const official=rowsFrom(raw).filter(r=>[r.tradeDate,r.sourceTradeDate].every(d=>!d||reviewDate(d)===day));
 const rawByCode=new Map(official.map(r=>[r.code,r]));
 const records=watch.items.map(r=>{
  const existing=rawByCode.get(r.code)||{};
  const prior=limitReasonEvidence(existing,existing.reasonRaw,day),fresh=limitReasonEvidence(r,r.reasonRaw||r.reason,day);
  const reason=prior&&/^同花顺|^ths$/.test(prior.reasonSource)?prior:fresh||prior;
  const metrics=Object.fromEntries(['price','sealAmount','turnover','mainInflow','amount','floatCap','breakCount'].filter(k=>Number.isFinite(r[k])).map(k=>[k,r[k]]));
  return {...r,...existing,...metrics,sector:existing.sector||r.sector,tradeDate:day,sourceTradeDate:day,
   aboveMa5:typeof r.aboveMa5==='boolean'?r.aboveMa5:existing.aboveMa5,
   breakHigh:typeof r.breakHigh==='boolean'?r.breakHigh:(existing.breakHigh??existing.brokeHighHold),
   limitUpCount:existing.limitUpCount??r.level,breakCount:existing.breakCount??r.breakCount,
   ...(reason?{reasonRaw:reason.reason,reason:reason.reason,reasonSource:reason.reasonSource,reasonDateStatus:'matched',reasonTradeDate:day}:{})};
 });
 const recordMap=new Map(records.map(r=>[r.code,r]));
 // A real report keeps its own population; the complete watch population is
 // used only when there is no same-day report with analysed rows.
 const items=official.length?official.map(r=>recordMap.get(r.code)||r):records;
 const review={...raw,date:day,items,displayOnly:!official.length,displaySource:watch.source,displayScope:watch.scope};
 const result={...state,review,closeWatch:watch,snapshotFieldDays:{...state.snapshotFieldDays}};
 const groups=summarizeReview(review).groups;
 if(!state.ztBySector?.length||reviewDate(state.snapshotFieldDays?.ztBySector||state.ztDay)!==day){
  result.ztBySector=groups.map(g=>({sector:g.name,count:g.count,stocks:g.items.map(r=>({code:r.code,name:r.name,lb:r.limitUpCount,firstSeal:r.firstSeal,amount:r.amount,floatCap:r.floatCap}))}));
  result.snapshotFieldDays.ztBySector=day;
 }
 if(!state.ztPool?.length||reviewDate(state.ztDay)!==day){
  result.ztPool=records.map(r=>({...r,lb:r.limitUpCount}));result.ztPoolFromCloseWatch=true;result.ztDay=day;result.snapshotFieldDays.ztPool=day;
 }
 if(!state.ztReviewPool?.length||reviewDate(state.ztReviewPoolMeta?.tradeDate)!==day){
  result.ztReviewPool=records.map(r=>({...r,source:watch.source,reason:r.reasonRaw,lb:r.limitUpCount}));
  result.ztReviewPoolMeta={tradeDate:day,status:'close-observation',scope:watch.scope,displaySource:watch.source};
 }
 closedViews.set(state,result);return result;
}
function watchBoard(code,board){return board==='all'||(board==='gem'?/^30/:/^(00|60)/).test(code);}
export function closingWatchPanel(watch,ctx,{level,board='all',query='',limit=12}={}) {
 if(!watch)return null;
 const list=watch.items.filter(r=>(!level||r.level===level)&&watchBoard(r.code,board)&&
  (!query||[r.code,r.name,r.sector].some(v=>String(v||'').toLowerCase().includes(query))));
 const title=level===1?'首板收盘观察':level===2?'二板收盘观察':'涨停收盘观察';
 const row=r=>{
  const proof=limitReasonEvidence(r,r.reasonRaw||r.reason,watch.day);
  return h('button',{type:'button',class:'fy-watch-row','data-code':r.code,onClick:e=>ctx.selectStock(r.code,{...r,poolDay:watch.day},e.currentTarget)},
   h('span',{},h('strong',{},r.name||r.code),h('small',{},r.code)),h('span',{},r.sector||''),h('b',{},Number.isInteger(r.level)&&r.level>0?r.level+' 板':'收盘涨停'),
   proof?h('small',{class:'fy-watch-reason'},'涨停原因 · '+proof.reason+' · '+reviewSupplier(proof.reasonSource)):null);
 };
 return h('section',{class:'fy-close-watch','aria-label':title},h('h3',{},title+' · '+list.length+' 只'),
  h('p',{class:'fy-muted'},[watch.day,watch.source,watch.scope].filter(Boolean).join(' · ')),
  list.slice(0,limit).map(row),list.length>limit?h('details',{class:'fy-details'},h('summary',{},'其余 '+(list.length-limit)+' 只'),list.slice(limit).map(row)):null);
}
export function publishedReasons(state,ctx,report){
 const day=reviewDate(report?.day||closeSessionDay(state)||state.review?.date||state.ztReviewPoolMeta?.tradeDate||state.ztDay);
 if(!day)return null;
 const reasons=new Map();
 const add=(code,name,reason,source)=>{
  if(!reason||!source||!/^\d{6}$/.test(code))return;
  const prior=reasons.get(code);
  if(!prior||/^同花顺|^ths$/.test(source))reasons.set(code,{code,name,reason,source:reviewSupplier(source)});
 };
 for(const row of dailyReviewEvidence(state).rows)if(row.reasonDay===day)add(row.code,row.name,row.reason,row.reasonSource);
 if(reviewDate(state.review?.date)===day)for(const row of rowsFrom(state.review)){
  const reason=limitReasonEvidence(row,row.reasonRaw,day);
  if(reason)add(row.code,row.name,reason.reason,reason.reasonSource);
 }
 const watch=closingWatch(state);
 if(watch?.day===day)for(const r of watch.items){
  const proof=limitReasonEvidence(r,r.reasonRaw||r.reason,day);
  if(proof)add(r.code,r.name,proof.reason,proof.reasonSource);
 }
 if(report?.day===day)for(const r of report.rows||[])add(r.code,r.name,r.reason,r.reasonSource);
 const brief=[report?.thsBrief,state.marketRecovery?.thsBrief].find(x=>x?.day===day&&x.knownAt<=Date.now());
 if(!reasons.size&&!brief)return null;
 const row=r=>h('div',{class:'fy-published-reason'},button((r.name||r.code)+' '+r.code,()=>ctx.selectStock(r.code,{...r,poolDay:day}),'quiet'),h('span',{},r.reason),h('small',{},r.source+' · '+day));
 const list=[...reasons.values()].sort((a,b)=>Number(b.source.startsWith('同花顺'))-Number(a.source.startsWith('同花顺'))||a.code.localeCompare(b.code));
 return h('section',{class:'fy-close-watch','aria-label':'逐股涨停原因'},h('h3',{},list.length?'涨停原因 · '+list.length+' 只':'同花顺每日复盘'),
  brief?h('article',{class:'fy-ths-daily'},h('strong',{},'同花顺每日复盘 · '+day),h('p',{},brief.summary),
   brief.themes?.length?h('p',{},'主流看点 · '+brief.themes.join('、')):null,safeLink(brief.url,'查看同花顺每日复盘')):null,
  list.slice(0,3).map(row),list.length>3?h('details',{class:'fy-details'},h('summary',{},'查看其余 '+(list.length-3)+' 只涨停原因'),list.slice(3).map(row)):null,
  list.some(r=>r.source.startsWith('同花顺'))?safeLink('https://data.10jqka.com.cn/limit_up/','同花顺涨停聚焦'):null,
  brief?.url?safeLink(brief.url,'同花顺收盘复盘原文'):null);
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
 const view=h('div',{class:'fy-stack'},h('header',{class:'fy-view-heading'},h('h1',{},'今日复盘')),simpleNavigation(ctx,'review'),refreshButton,output,
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
const quoteCheckStatuses={'sources-agree-unverified':'可比来源一致','partial-source-agreement-unverified':'部分来源一致，有来源分歧',
 'source-price-or-time-conflict':'来源价格或时点有冲突','ambiguous-price-groups':'来源结果存在多组分歧',
 'insufficient-comparable-sources':'可比来源不足','duplicate-upstream-evidence':'来源上游重复',
 'session-closed':'非连续竞价时段，未联网核对','rate-limited':'核对请求较密，请稍后再试',unavailable:'暂时无法核对'};
const providerNames={tencent:'腾讯行情',eastmoney:'东方财富',sina:'新浪财经'};
export function quoteCrossCheckPanel(ctx,readCode,signal=ctx.signal) {
 const output=h('div',{class:'fy-stack','aria-live':'polite'});
 const run=button('核对报价',async()=>{
  const code=readCode();
  if(!/^(?:60|68|00|30)\d{4}$/.test(code||'')){output.replaceChildren(note('请输入支持核对的沪深 A 股六位代码'));return;}
  run.disabled=true;output.replaceChildren(note('正在读取 '+code+' 的公开来源…'));
  try{
   const result=await ctx.api('/api/quote-cross-check?'+new URLSearchParams({code}),{method:'POST',signal});
   if(signal?.aborted||!output.isConnected)return;
   if(readCode()!==code){output.replaceChildren();return;}
   if(result.code!==code)throw Error('返回股票与所选代码不一致');
   const sources=Array.isArray(result.sourceStatuses)?result.sourceStatuses:[];
   output.replaceChildren(note(code+' · '+(quoteCheckStatuses[result.status]||'结果待核验')+' · '+dateTime(result.checkedAt)),
    ...sources.map(source=>h('div',{class:'fy-item'},h('strong',{},providerNames[source.provider]||source.provider),
     h('p',{},format(source.observedPrice)+' 元 · 前收 '+format(source.observedPreviousClose)+' 元'),
     h('small',{class:'fy-muted'},dateTime(source.quoteAt)+' · '+(source.inConsensus?'参与一致结论':source.status==='dated-snapshot'?'历史、停牌或时点不可比':source.status==='eligible-for-comparison'?'未形成一致结论':'来源不可用或校验未通过')))));
  }catch(error){if(!signal?.aborted&&output.isConnected)output.replaceChildren(note(error.message));}
  finally{run.disabled=false;}
 },'primary');
 return section('多源报价核对','对照同股、同交易日、相近时点的最新价和前收盘价。',ctx.role==='edit'?run:note('需要开发者发起核对'),output);
}

export function createStockDrawer(ctx) {
 let historySource='',controller=null,code='',row=null,boundEvidence=false,displayedQuoteAt=null,marketQuoteAtOpen=null,period='day',tab='chart',daily=[],generation=0,previousFocus=null,historyLoading=false,loadQueued=false;
 let leadershipKey='',historyPending=false,minutesPending=false,minutesError='',offlineTheme='',archived=new Map(),livePoints=new Map(),themes=[],chartDay='';
 const minuteSlot=h('div',{class:'fy-minute-slot'});
 const overview=h('section',{class:'fy-drawer-summary','aria-label':'个股概况'});
 function paintSummary(){
  const state=ctx.state||{},now=Date.now(),historical=row?.historicalClose;
  const fact=state.dabanke?.day===chartDay&&state.dabanke.knownAt<=now?state.dabanke.facts?.[code]:null;
  const tags=[...new Set([...(historical?[]:[offlineTheme]),...(Array.isArray(row?.themes)?row.themes:[]),...themes,...(fact?.themes||[])].filter(x=>typeof x==='string'&&x.trim()))];
  const cutoff=historical?Math.min(now,Date.parse(chartDay+'T23:59:59+08:00')):now;
  const issuer=row?.issuerEvidence?.events||[];
  const events=[...issuer,...newsRows(state).filter(e=>e.codes?.includes(code)&&/公告|巨潮/.test(e.source||''))]
   .filter(e=>{const t=typeof e.publishedAt==='number'?e.publishedAt:Date.parse(e.publishedAt);return t>0&&t<=cutoff&&e.title&&e.url;})
   .sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  const uniqueEvents=[...new Map(events.map(e=>[e.url,e])).values()].slice(0,3);
  const why=[row?.selectionWhy,...pickReasons(row||{}),row?.reasonRaw,row?.reason,fact?.logic].find(x=>typeof x==='string'&&x.trim());
  updateReadout(overview,h('strong',{},why||'当前没有可核实的入选依据。'),
   h('p',{class:'fy-muted'},tags.length?'所属题材 · '+tags.join(' / '):row?.sector?'所属行业或板块 · '+row.sector:'本股暂无已记录题材'),
   h('details',{class:'fy-details',id:'fy-stock-notices-'+code},h('summary',{},'近期公告 · '+uniqueEvents.length+' 条'),
    uniqueEvents.length?uniqueEvents.map(e=>h('p',{},safeLink(e.url,e.title),' · '+dateTime(e.publishedAt))):h('p',{},'本次公告源中没有该股的匹配记录。')));
 }
 function intraday(){
  const groups=[...livePoints.values(),archived].filter(x=>x.size).sort((a,b)=>b.size-a.size);
  const points=groups.length?[...groups[0].values()].sort((a,b)=>a.at-b.at):[];
  return section('分时走势',chartDay||'',points.length?priceLine(points,'原始分时价格',{timeLabel:p=>p.minute}):h('p',{class:'fy-muted'},minutesPending?'分时记录加载中…':minutesError||'该交易日尚无可核实的分时记录。'),
   points.length?h('small',{class:'fy-muted'},points[0].source+' · '+points.length+' 个实际观测分钟'):null);
 }
 const overlay=h('div',{class:'fy-drawer-backdrop',hidden:true}),drawer=h('aside',{class:'fy-stock-drawer',role:'dialog','aria-modal':'true','aria-label':'股票研究面板',hidden:true,tabindex:'-1'}),title=h('h2',{class:'fy-drawer-title'}),quote=h('div',{class:'fy-drawer-quote'}),body=h('div',{class:'fy-drawer-body'}),meta=h('p',{class:'fy-quote-time'});
 const shortline=h('section',{class:'fy-drawer-shortline',hidden:true,'aria-live':'polite','aria-label':'短线校验'});
 const sectorChip=h('div',{class:'fy-stock-role-summary',hidden:true});
 const close=()=>{
  shortline.replaceChildren();shortline.hidden=true;
  generation++;controller?.abort();drawer.hidden=true;overlay.hidden=true;document.body.classList.remove('fy-drawer-open');
  // A shared-state refresh may replace the originating opportunity while the
  // drawer is open. Restore the same stock in the current DOM in that case.
  const origin=previousFocus?.isConnected&&previousFocus.getClientRects().length?previousFocus:
   [...document.querySelectorAll('.fy-stock-card[data-code="'+code+'"]')].find(node=>!node.disabled&&node.getClientRects().length);
  origin?.focus?.({preventScroll:true});
 };
 const closeButton=button(icon('close'),close,'quiet');closeButton.setAttribute('aria-label','关闭股票研究面板');
 const tabNav=h('div',{class:'fy-tabs'});
 for(const[key,label]of [['chart','走势'],['evidence','依据'],['leadership','带动性'],['company','公告'],['sources','核对'],['tracking','跟踪'],['analysis','诊断'],['marks','当日标记']])tabNav.append(h('button',{type:'button','data-detail-tab':key,onClick:()=>{tab=key;paint();}},label));
 drawer.append(h('header',{class:'fy-drawer-header'},h('div',{},h('span',{class:'fy-eyebrow'},'FAYO / STOCK LENS'),title,sectorChip),closeButton),quote,meta,overview,tabNav,body,shortline,h('footer',{class:'fy-drawer-footer'},button('在实验室继续研究',()=>{close();ctx.navigate('lab','records');}),'历史研究 · 原始时点独立核验'));
 overlay.addEventListener('click',close);
 drawer.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){const nodes=[...drawer.querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]')].filter(n=>n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 });
 function paintLeadership(){
  const proof=sectorLeadershipEvidence(ctx.state)(row),key=JSON.stringify(proof);
  if(key===leadershipKey&&body.firstElementChild?.hasAttribute('data-leadership-panel'))return;
  const expanded=body.querySelector('[data-following-peers]')?.open;
  const counts=proof.firstSeal?'早于本股 '+proof.earlierCount+' 只 · 同刻 '+proof.tiedCount+' 只 · 晚于本股 '+proof.later.length+' 只':null;
  const panel=section('同业带动性',proof.industry?proof.industry+' · '+dayLabel(proof.tradeDate):dayLabel(proof.tradeDate),
   h('p',{class:'fy-note','data-sector-leadership':proof.status},sectorLeadershipLabel(proof.status)),
   proof.reason&&h('p',{},proof.reason),
   proof.industry&&h('div',{class:'fy-stack'},
    h('p',{},'本股首封 '+(proof.firstSeal||'待核验')+(counts?' · '+counts:'')),
    h('p',{class:'fy-muted'},'同业首封时点有效 '+proof.timedCount+' / '+proof.peerCount+' 只（已剔除本股）'),
    h('p',{class:'fy-muted'},'东方财富 · 已标行业的涨停记录 · 批次接收 '+dateTime(proof.sourceAt)),
    h('p',{class:'fy-muted'},proof.crossListed===null?'财联社同日收录待核对':
     '财联社同日收录 · 本股'+(proof.crossListed?'已收录':'该批次未收录')+' · 同业 '+proof.crossListedPeers+' / '+proof.peerCount+' 只'),
    proof.later.length>0&&h('details',{class:'fy-details','data-following-peers':'',open:expanded},h('summary',{},'查看随后封板的同业'),
     h('ul',{class:'fy-evidence-list'},proof.later.map(peer=>h('li',{},peer.name+' '+peer.code+' · '+peer.firstSeal)))),
    h('small',{class:'fy-muted'},'较强线索要求来源批次完整、本股在样本中独自先封、至少 4 只同业随后封板。首封顺序只反映涨停样本，因果关系仍待验证。')));
  panel.setAttribute('data-leadership-panel','');
  leadershipKey=key;body.replaceChildren(panel);
 }
 function paint() {
  const day=reviewDate(row?.poolDay||row?.tradeDate)||(Number.isSafeInteger(quoteAt(row))?new Date(quoteAt(row)+28800000).toISOString().slice(0,10):'');
  const roleInfo=row?.historicalClose?row.closeRole:sectorRoles(ctx.state,day,row?.sector||row?.industry).get(code);
  const roleKey=JSON.stringify([code,day,roleInfo]);
  if(sectorChip.dataset.key!==roleKey){
   sectorChip.dataset.key=roleKey;sectorChip.hidden=!roleInfo;
   sectorChip.replaceChildren(...(roleInfo?[roleBadge(roleInfo),h('small',{},[roleInfo.evidence,roleInfo.also?.evidence].filter(Boolean).join(' · '))]:[]));
  }
  tabNav.querySelectorAll('button').forEach(b=>{
   b.hidden=Boolean(row?.historicalClose&&!['chart','evidence'].includes(b.dataset.detailTab));
   b.setAttribute('aria-pressed',String(b.dataset.detailTab===tab));
  });
  if(tab==='chart'){
   const controls=h('div',{class:'fy-tabs'},[['day','日 K'],['month','月 K'],['year','年 K']].map(([key,label])=>h('button',{type:'button','data-period':key,'aria-pressed':String(period===key),onClick:()=>{period=key;paint();if(key!=='day')loadHistory(true);}},label)));
   const bars=aggregate(daily,period);updateReadout(minuteSlot,intraday());body.replaceChildren(minuteSlot,controls,h('div',{class:'fy-chart'},chart(bars.slice(-90))),h('p',{class:'fy-muted'},daily.length?'实际日线 '+daily.length+' 条 · '+(period==='day'?'原始日线':'仅聚合已有日线；当前周期可能尚未结束'):historyPending?'日 K 加载中…':'该股没有已返回的日 K 记录。'),button('加载更早的历史',()=>loadHistory(true),'quiet'));
  }else if(tab==='evidence'){
   const review=row?.historicalClose?row:dailyReviewEvidence(ctx.state||{}).rows.find(item=>item.code===code&&item.reasonDay===day);
   const source=ctx.state?.dabanke;
   const dbk=row?.historicalClose?row.closeFact:source?.day===day&&source.knownAt<=Date.now()?source.facts?.[code]:null;
   const watchCode=code,signal=controller.signal;
   const watch=ctx.canEdit&&!row?.historicalClose&&button('加入自选监控',async()=>{
    watch.disabled=true;
    try{
     const result=await ctx.api('/api/fast-stock-moves/watch',{method:'POST',body:{code:watchCode,enabled:true},signal});
     if(!signal.aborted){if(!Array.isArray(result.items)||!result.items.some(item=>item.code===watchCode))throw Error('当前服务尚未提供自选监控');ctx.notify('已加入自选监控');}
    }catch(error){if(!signal.aborted)ctx.notify(error.message,'error');}
    finally{watch.disabled=false;}
   },'quiet');
   body.replaceChildren(
    dbk?section('打板客逐股复盘',day,[dbk.tier,dbk.status,dbk.performance,dbk.firstSeal&&'首封 '+dbk.firstSeal,dbk.history,
     ...(dbk.patterns||[]),...(dbk.risks||[]),...(dbk.themes||[]),dbk.logic,
     dbk.dragon&&'龙虎榜第 '+dbk.dragon.rank+' 名 · '+dbk.dragon.span.start+' 至 '+dbk.dragon.span.end+' · 披露买入 '+money(dbk.dragon.buy)+' · 净额 '+money(dbk.dragon.net)].filter(Boolean).join(' · ')):document.createDocumentFragment(),
    Number.isFinite(row?.risePct)?section('近一分钟异动',day,h('p',{},'+'+format(row.risePct,2)+'% / '+Math.round(row.spanMs/1000)+' 秒 · '+quoteLabel(row))):document.createDocumentFragment(),
    section('涨停原因',day,review?.reason?h('p',{},review.reason+' · '+reviewSupplier(review.reasonSource)):note('当前没有该股同日的原始涨停原因')),
    ...(watch?[watch]:[]),stockTactics(daily,day,Date.now(),historySource),section('实际命中与风险','只展示当前返回的条件',reasons(row).length?h('ol',{class:'fy-evidence-list'},reasons(row).map(r=>h('li',{},r))):empty('尚未返回逐条命中依据','可以在实验室读取同股研究档案。')),renderEvidence(row?.conditions||row?.conditionEvidence||row?.conditionInputs||row?.items||null),h('details',{class:'fy-details'},h('summary',{},'完整研究记录'),renderEvidence(row)));
  }else if(tab==='leadership'){
   paintLeadership();
  }else if(tab==='company'){
   const issuer=row?.issuerEvidence;body.replaceChildren(section('公司原始公告','公告时间与价格时点分别核验',issuer?.events?.length?h('div',{class:'fy-stack'},issuer.events.map(item=>h('article',{class:'fy-item'},safeLink(item.url,item.title),h('p',{class:'fy-muted'},dateTime(item.publishedAt)+' · '+(item.reason||'标题线索'))))):empty('没有匹配的公告证据','没有记录不代表该公司没有风险。')));
  }else if(tab==='sources'){
   const requested=code,signal=controller.signal,output=h('div',{class:'fy-stack','aria-live':'polite'});
   const good=new Set(ctx.state?.goodNews?.items||[]),bad=new Set(ctx.state?.badNews?.items||[]);
   const linked=newsRows(ctx.state||{}).flatMap(item=>{
    const direct=Array.isArray(item.codes)&&item.codes.includes(requested);
    const sector=Array.isArray(item.related?.indirect)&&item.related.indirect.find(stock=>stock.code===requested)?.via;
    return direct||sector?[{item,association:direct?'直接关联':'板块关联 '+sector}]:[];
   }).slice(0,6);
   const relatedNews=h('details',{class:'fy-details'},h('summary',{},'关联资讯 · '+linked.length+' 条'),
    ...linked.map(({item,association})=>h('div',{class:'fy-item'},safeLink(item.url,item.title||'查看原文'),
     h('small',{class:'fy-muted'},association+' · '+(good.has(item)?'利好线索':bad.has(item)?'利空线索':'公告')+' · '+dateTime(item.publishedAt??item.t)+' · '+(item.source||'来源未知')))));
   const news=button('读取推送避险状态',async()=>{
    news.disabled=true;
    try{
     const result=await ctx.api('/api/stock-news-risk?'+new URLSearchParams({code:requested}),{signal});
     if(signal.aborted||!output.isConnected)return;
     if(result.code!==requested)throw Error('返回股票与所选代码不一致');
     const labels={blocked:'当前利空命中，股票推荐避险暂停',available:'配置的快讯源内未发现当前利空命中',unknown:'快讯覆盖或证据不足，股票推荐暂停'};
     output.replaceChildren(note(labels[result.status]||labels.unknown),
      ...((Array.isArray(result.matches)?result.matches:[]).map(match=>h('p',{class:'fy-muted'},
       (match.association==='direct-security'?'直接关联':'板块关联 '+(match.sectors||[]).join('、'))+' · '+dateTime(match.publishedAt)+' · '+(match.source||'来源未知')))));
    }catch(error){if(!signal.aborted&&output.isConnected)output.replaceChildren(note(error.message));}
    finally{news.disabled=false;}
   });
   body.replaceChildren(quoteCrossCheckPanel(ctx,()=>requested,signal),section('新闻与推送避险','使用推送前的新闻规则检查该股票。',relatedNews,news,output));
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
 async function loadMinutes(){
  const day=chartDay,turn=generation,request=controller;
  if(!day||Date.parse(day+'T15:00:00+08:00')>Date.now())return;
  minutesPending=true;
  try{
   const query=new URLSearchParams({code,period:'minute',day});
   const result=await ctx.api('/api/kline?'+query,{signal:request.signal,timeoutMs:25000});
   if(request.signal.aborted||turn!==generation||day!==chartDay)return;
   if(result.code===code&&result.day===day){
    const points=archivePoints(result.minuteBars,code,day);
    if(points.size>archived.size)archived=points;
    if(result.offlineTheme){offlineTheme=result.offlineTheme;paintSummary();}
    if(['busy','unavailable'].includes(result.status))minutesError='本次分时读取未完成，已保留现有观测。';
   }
  }catch(error){if(turn===generation&&!request.signal.aborted&&day===chartDay)minutesError='分时来源本次未响应。';}
  finally{if(turn===generation&&!request.signal.aborted&&day===chartDay){minutesPending=false;if(tab==='chart')updateReadout(minuteSlot,intraday());}}
 }
 async function loadHistory(older=false) {
  const turn=generation,currentController=controller;if(!code)return;
  if(historyLoading){if(older)loadQueued=true;return;}historyLoading=true;
  try {
   const cutoff=row?.historicalClose?row.poolDay:null;
   let end=older&&daily.length?daily[0].date:cutoff?new Date(Date.parse(cutoff+'T00:00:00Z')+86400000).toISOString().slice(0,10):'';
   let pages=0;
   do{
    const params=new URLSearchParams({code,n:'240',...(end?{end}:{})});
    const result=await ctx.api('/api/kline?'+params,{signal:currentController.signal,timeoutMs:60000});
    if(turn!==generation||currentController.signal.aborted)return;
    if(result.code&&String(result.code)!==params.get('code'))throw Error('返回K线与所选股票代码不一致');
    const rows=Array.isArray(result.rows)?result.rows:Array.isArray(result.data)?result.data:[];
    if(typeof result.offlineTheme==='string'){offlineTheme=result.offlineTheme;paintSummary();}
    if(!rows.length)break;
    const previous=daily.length;
    const observed=aggregate(rows,'day').filter(b=>!cutoff||b.date<=cutoff);
    if(!observed.length)break;
    historySource=result.dataQuality?.source||result.source||historySource;
    daily=aggregate([...daily,...observed],'day');
    if(cutoff&&daily.at(-1)?.date===cutoff){
     quote.hidden=false;meta.hidden=false;quote.textContent=format(daily.at(-1).close);
     meta.textContent=[cutoff,'收盘价',historySource].filter(Boolean).join(' · ');
    }
    const received=result.dataQuality?.receivedAt;
    if(!cutoff&&quote.hidden&&historySource&&!result.dataQuality?.missingReason&&(!received||received<=Date.now())){
     const asOf=Number.isSafeInteger(received)?received:Date.now();
     const closed=daily.filter(b=>b.date<new Date(asOf+28800000).toISOString().slice(0,10)||
      received&&Date.parse(b.date+'T15:10:00+08:00')<=asOf);
     const last=closed.at(-1),prev=closed.at(-2);
     if(last?.close>0){
      const pct=prev?.close>0?(last.close/prev.close-1)*100:null;
      quote.hidden=false;meta.hidden=false;quote.replaceChildren(h('strong',{},format(last.close)),Number.isFinite(pct)?h('span',{class:direction(pct)},percent(pct)):h('small',{},'缺同口径前收'));
      meta.textContent=last.date+' · 最近收盘 · '+historySource+(prev?.date?' · 较 '+prev.date+' 收盘':'');
     }
    }
    if(daily.length===previous)break;
    end=daily[0]?.date||'';pages++;
    if(!older||period==='day'||rows.length<240)break;
   }while(pages<8&&daily.length<1920);
   historyPending=false;if(tab==='chart'||tab==='evidence')paint();
  }catch(error){if(turn!==generation||error.name==='AbortError')return;if(tab==='chart')body.replaceChildren(empty('历史数据暂时未能读取',error.message),button('重新读取',()=>loadHistory(false)));}
  finally{if(turn===generation){historyLoading=false;if(loadQueued){loadQueued=false;loadHistory(true);}}}
 }
 function displayQuote(observation) {
  const stamp=quoteAt(observation);
  if(!Number.isFinite(observation?.price)||observation.price<=0||!Number.isFinite(stamp)||stamp<=0||stamp>Date.now()||!(observation.quoteSource||observation.source||observation.quoteProvider))return;
  const point=minutePoint(observation,chartDay);
  if(point&&!row?.historicalClose){
   if(!livePoints.has(point.source))livePoints.set(point.source,new Map());
   const points=livePoints.get(point.source),previous=points.get(point.minute);
   if(!previous||point.at>=previous.at)points.set(point.minute,point);
   if(!drawer.hidden&&tab==='chart')updateReadout(minuteSlot,intraday());
  }
  displayedQuoteAt=stamp;
  quote.hidden=false;meta.hidden=false;
  quote.replaceChildren(h('strong',{class:direction(observation.pct)},format(observation.price)),...(Number.isFinite(observation.pct)?[h('span',{class:direction(observation.pct)},percent(observation.pct))]:[]));
  meta.textContent=quoteLabel(observation);
 }
 function update({manual=false}={}) {
  if(drawer.hidden||!code||row?.historicalClose)return;
  const next=ctx.findStock(code);
  if(next?.code===code&&!boundEvidence){row=next;title.textContent=symbolName(next)+' / '+code;}
  if(tab==='leadership')paintLeadership();
  if(next?.code!==code)return;
  if(boundEvidence){
   const at=quoteAt(next);
   // Re-reading an unchanged dashboard is not a new quote. Retain the selected
   // pool's original observation until the feed advances or the user refreshes.
   if(!manual&&Number.isFinite(marketQuoteAtOpen)&&at<=marketQuoteAtOpen)return;
   if(!Number.isFinite(next.price)||next.price<=0||!Number.isFinite(at)||at<=0||at>Date.now()||
      (Number.isFinite(displayedQuoteAt)&&displayedQuoteAt<=Date.now()&&at<=displayedQuoteAt))return;
  }
  const newDay=reviewDate(ctx.state?.marketClock?.day),stamp=quoteAt(next);
  if(newDay&&newDay!==chartDay&&ctx.state?.marketClock?.trading===true&&Number.isSafeInteger(stamp)&&stamp>0&&stamp<=Date.now()&&
    new Date(stamp+28800000).toISOString().slice(0,10)===newDay){
   chartDay=newDay;livePoints=ctx.quoteTrail?.read(code,newDay)||new Map();archived=new Map();themes=[];minutesPending=false;minutesError='';
  }
  displayQuote(next);
 }
 async function checkShortline(symbol,sourceRow,signal,turn){
  shortline.replaceChildren();shortline.hidden=false;
  const marketContext=(recovery,date)=>{
   const info=recoveredMetric(recovery,'emotion',date||recovery?.referenceDay);
   return info?h('p',{class:'fy-muted'},(info.historical?'上次市场周期 · ':'市场周期 · ')+info.value+' · '+info.date+' · '+info.source+' · 取得 '+dateTime(info.knownAt)):null;
  };
  const live=()=>!signal.aborted&&turn===generation&&code===symbol&&!drawer.hidden;
  const current=()=>live()&&ctx.canEdit;
  const sourceDay=reviewDate(sourceRow?.poolDay||sourceRow?.tradeDate||sourceRow?.quoteDate);
  let links=null;
  try{
   const {thsStockLink,thsBoardLink}=await import('./shortline/quote-links.mjs');
   if(!live())return;
   const name=sourceRow?.sector||sourceRow?.industry;
   links=h('div',{class:'fy-inline','aria-label':'外部行情核对'},externalQuoteLink(thsStockLink(symbol)),
     name?externalQuoteLink(thsBoardLink({name,kind:sourceRow?.industry===name?'industry':'unknown'})):null);
  }catch{/* The native chart and evidence remain usable without external navigation. */}
  if(!live())return;
  if(!ctx.canEdit){
   const context=marketContext(ctx.state?.marketRecovery,sourceDay);
   if(links)shortline.append(links);if(context)shortline.append(context);shortline.append(recoveryDisclosure(ctx.state));return;
  }
  if(links)shortline.append(links);shortline.append(note('正在读取该股同期校验…'));
  try{
   const [{stockCheckAt},{linkedPage,sampleFor},{activeBook}]=await Promise.all([import('./shortline-host.mjs'),import('./shortline/context.mjs'),import('./shortline/book-session.mjs')]);
   const book=activeBook();if(!current())return;
   const snapshot=await stockCheckAt(ctx,symbol,sourceRow,signal);
   if(!current())return;
   if(activeBook()!==book||!snapshot||snapshot.code!==symbol){shortline.replaceChildren(note('本股没有当前研究账户的同期校验记录。'));return;}
   function openResearch(page,strategy){
    if(!current()||activeBook()!==book)return;
    const sub=linkedPage(page,{code:symbol,date:snapshot.date||sourceDay,sample:sampleFor(book),strategy});
    close();ctx.navigate('lab',sub);
   }
   if(snapshot.demo){
    shortline.replaceChildren(h('strong',{},'行情来自正式盘面；当前为演示研究账户'),
      h('div',{class:'fy-inline'},button('查看演示研究账户',()=>openResearch('overview'),'quiet'),
        button('查看演示同题材梯队',()=>openResearch('structure'),'quiet')),...(links?[links]:[]));
    return;
   }
   if(snapshot.date===chartDay){
    const points=archivePoints(snapshot.minuteBars,code,chartDay);if(points.size>archived.size)archived=points;themes=Array.isArray(snapshot.themes)?snapshot.themes:[];
    paintSummary();if(tab==='chart')paint();
   }
   const r=snapshot.record;
   if(quote.hidden&&snapshot.quote){
    const q=snapshot.quote;
    quote.replaceChildren(h('strong',{},format(q.value)));quote.hidden=false;meta.hidden=false;
    meta.textContent='归档日K收盘 · '+q.date+' · '+q.source+' · 取得 '+dateTime(q.knownAt);
   }
   const details=button('查看完整校验',()=>openResearch('new'),'quiet');
   const phase=marketPhaseName(r?.emotion?.stage),strategy=r?.strategy&&!['未匹配','未判定'].includes(r.strategy)?r.strategy:'';
   const proof=[strategy,phase,r?.status].filter(Boolean).join(' · ');
   const recovery=snapshot.recovery||ctx.state?.marketRecovery;
   const publicPhase=!phase&&marketContext(recovery,snapshot.date);
   const prev=snapshot.previousRecord;
   shortline.replaceChildren(h('div',{class:'fy-inline'},h('strong',{},'短线校验'),h('small',{},snapshot.date||''),details,
     button('同题材梯队',()=>openResearch('structure'),'quiet'),
     button('历史回测',()=>openResearch('backtest',strategy),'quiet')),...(links?[links]:[]),
    ...(proof?[h('p',{},proof)]:[]),
    ...(publicPhase?[publicPhase]:[]),
    ...(prev?[h('p',{class:'fy-muted'},'历史校验记录 · '+prev.date+' · '+(prev.method||'V6 校验存档')+' · '+prev.status+' · 归档 '+dateTime(prev.createdAt))]:[]),
    ...(r?.risks?.length?[h('details',{class:'fy-details'},h('summary',{},'校验依据与风险'),h('p',{},r.risks.join('；')))]:[]),
    recoveryDisclosure({marketRecovery:recovery}));
  }catch(error){if(current())shortline.replaceChildren(...(links?[links]:[]),recoveryDisclosure(ctx.state),h('details',{class:'fy-details'},h('summary',{},'同期校验读取记录'),note(error.message)));}
 }
 async function open(nextCode,nextRow,trigger) {
  if(!/^\d{6}$/.test(nextCode))return;previousFocus=trigger||document.activeElement;generation++;controller?.abort();controller=new AbortController();code=nextCode;boundEvidence=nextRow?.code===nextCode;row=(boundEvidence?nextRow:ctx.findStock(nextCode))||{code:nextCode};daily=[];historySource='';historyLoading=false;loadQueued=false;period='day';tab='chart';
  const baseline=ctx.findStock(nextCode),baselineAt=quoteAt(baseline);
  const state=ctx.state||{},quoteDay=quoteAt(row)||baselineAt;
  chartDay=reviewDate(row.poolDay||row.tradeDate||row.quoteDate)||closeSessionDay(state)||
   (Number.isSafeInteger(quoteDay)&&quoteDay>0&&quoteDay<=Date.now()?new Date(quoteDay+28800000).toISOString().slice(0,10):reviewDate(state.marketClock?.day))||'';
  historyPending=true;minutesPending=false;minutesError='';offlineTheme='';themes=[];archived=new Map();livePoints=ctx.quoteTrail?.read(nextCode,chartDay)||new Map();paintSummary();
  marketQuoteAtOpen=Number.isFinite(baseline?.price)&&baseline.price>0&&Number.isFinite(baselineAt)&&baselineAt>0&&baselineAt<=Date.now()?baselineAt:null;
  title.textContent=symbolName(row)+' / '+nextCode;displayedQuoteAt=null;quote.replaceChildren();meta.textContent='';quote.hidden=true;meta.hidden=true;displayQuote(row);
  const valuation=row.valuationQuote;
  if(!row.historicalClose&&quote.hidden&&valuation?.valuationKind==='observed-price'){
   displayQuote({...valuation,price:row.lastPrice,code:nextCode});
  }
  if(!row.historicalClose&&quote.hidden&&baseline?.code===nextCode){
   displayQuote(baseline);
   if(!quote.hidden)meta.textContent='同标的独立报价 · '+meta.textContent;
  }
  overlay.hidden=false;drawer.hidden=false;document.body.classList.add('fy-drawer-open');paint();drawer.focus();loadHistory();void loadMinutes();
  if(row.historicalClose){shortline.replaceChildren();shortline.hidden=true;}
  else void checkShortline(nextCode,row,controller.signal,generation);
 }
 return {element:h('div',{class:'fy-drawer-layer'},overlay,drawer),open,close,update,isOpen:()=>!drawer.hidden,clear:()=>{close();code='';row=null;daily=[];title.textContent='';quote.replaceChildren();meta.textContent='';body.replaceChildren();}};
}
