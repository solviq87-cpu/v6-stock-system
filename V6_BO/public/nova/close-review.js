import {h,button,empty,section,format,money,percent,direction,safeLink} from './ui.js';
import {reviewDate,reviewCoverage,summarizeReview,stockCard} from './market.js';
import {dailyReviewEvidence} from './market-evidence.js';
import {renderSourceReviewPool} from './review-pool.js';
import {archive} from './data/close-review-20261120.js';

const headings=[
 ['mood','市场情绪总览','市场情绪'],['themes','题材主线划分','题材主线'],
 ['ladder','完整连板梯队','连板梯队'],['seats','龙虎榜梳理','龙虎榜'],
 ['risks','市场矛盾与风险','风险'],['watch','下一交易日观察清单','观察清单']
];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const count=(value,suffix=' 只')=>Number.isSafeInteger(value)&&value>=0?value+suffix:'—';
const levelName=level=>level===1?'首板':Number.isSafeInteger(level)?level+' 板':'板次待核验';
const arr=value=>Array.isArray(value)?value:[];
const ths=value=>/^(?:ths|10jqka|同花顺(?:涨停聚焦|F10)?)$/i.test(value||'');
const signedMoney=value=>value>0?'+'+money(value):money(value);
const providerLink=['东方财富涨停板行情','https://quote.eastmoney.com/ztb/'];
const seatLink=['东方财富龙虎榜','https://data.eastmoney.com/stock/tradedetail.html'];
const marketLink=['腾讯沪深指数报价','https://qt.gtimg.cn/q=sh000001,sz399001'];
const northLink=['东方财富沪深股通','https://data.eastmoney.com/hsgt/index.html'];
const thsLink=['同花顺涨停聚焦','https://data.10jqka.com.cn/limit_up/'];
const archiveNames={'002916':'深南电路'};
const retainedLabels={sealed:'涨停池',broken:'炸板池',previousPool:'上一交易日涨停池',down:'跌停数',
 marketTurnover:'沪深成交',northTurnover:'北向成交',seats:'龙虎榜',reasons:'涨停原因'};

function timeLabel(value){
 const digits=typeof value==='string'?value.replaceAll(':',''):'';
 return /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(digits)&&digits!=='000000'
  ?digits.replace(/(..)(..)(..)/,'$1:$2:$3'):null;
}
const rate=(numerator,denominator)=>denominator?format(numerator/denominator*100,1)+'%':'—';

function archivedReport(){
 return {...archive,
  seats:archive.seats.map(([code,name,dept,net])=>({
   code,name,dept,net,category:dept.startsWith('营业部')?'营业部':dept==='深股通专用'?'互联互通':dept
  }))};
}

function cloudReport(state,supplement){
 const day=reviewDate(state.review?.date);
 const raw=day?state.review:null;
 const coverage=reviewCoverage(raw);
 const summary=summarizeReview(raw);
 const evidence=dailyReviewEvidence(state);
 const sourceRows=day&&evidence.day===day?new Map(evidence.rows.filter(row=>row.dateMatched).map(row=>[row.code,row])):new Map();
 const providerRows=day===reviewDate(state.ztReviewPoolMeta?.tradeDate)
  ?new Map(arr(state.ztReviewPool).filter(row=>reviewDate(row.sourceTradeDate||row.tradeDate)===day&&
    (!row.sourceTradeDate||!row.tradeDate||reviewDate(row.sourceTradeDate)===reviewDate(row.tradeDate))&&
    !row.heldRecord&&row.currentSourceConfirmed!==false).map(row=>[row.code,row])):new Map();
 const extra=supplement?.day===day?supplement:null;
 const sealed=extra?.sealed?.complete?extra.sealed:null;
 const acquiredReasons=new Map(arr(extra?.reasons).map(row=>[row.code,row]));
 const observations=new Map(summary.rows.filter(row=>[row.tradeDate,row.sourceTradeDate].every(value=>!value||reviewDate(value)===day)).map(row=>[row.code,row]));
 const fallbackRows=[...observations.values()];
 const pool=sealed?sealed.records.map(row=>({
  code:row.symbol,name:row.name,level:row.consecutiveLimits,firstSeal:row.firstSealTime,
  lastSeal:row.lastSealTime,breakCount:row.breakCount,amount:row.amountCny,sector:row.industry,
  turnover:row.turnoverPct,floatCap:row.floatCapCny
 })):fallbackRows.map(row=>({
  code:row.code,name:row.name,level:row.limitUpCount,amount:row.amount,sector:row.sector
 }));
 const rows=pool.map(row=>{
  const original=observations.get(row.code),source=sourceRows.get(row.code),provider=providerRows.get(row.code);
  const acquired=acquiredReasons.get(row.code);
  const existing=ths(original?.reasonSource)&&original.reasonDateStatus==='matched'&&reviewDate(original.reasonTradeDate)===day
   ?original.reasonRaw:ths(source?.reasonSource)&&source.reasonDay===day?source.reason:null;
  const useAcquired=!!acquired&&(acquired.source!=='同花顺 F10'||!existing);
  const official=useAcquired?acquired.text:existing;
  const turnover=finite(row.turnover)&&row.turnover>=0?row.turnover:finite(provider?.turnover)&&provider.turnover>0?provider.turnover:null;
  const floatCap=finite(row.floatCap)&&row.floatCap>0?row.floatCap:
   finite(provider?.floatCap)&&provider.floatCap>0?provider.floatCap:null;
  return {...row,name:row.name||original?.name||row.code,
   level:Number.isSafeInteger(row.level)&&row.level>0?row.level:null,
   tags:[...new Set([original?.sector||row.sector,...arr(source?.sectorTags)].filter(Boolean))],
   amount:finite(row.amount)&&row.amount>0?row.amount:null,
   firstSeal:timeLabel(row.firstSeal??provider?.firstSeal),
   lastSeal:timeLabel(row.lastSeal??provider?.lastSeal),
   breakCount:row.breakCount??provider?.breakCount,turnover,floatCap,
   reason:typeof official==='string'?official.trim():null,reasonSource:useAcquired?acquired.source||'同花顺':'同花顺',reasonUrl:useAcquired?acquired.url:null};
 });
 const groups=new Map();
 for(const row of rows){
  const name=row.tags[0];
  if(!name)continue;
  if(!groups.has(name))groups.set(name,[]);
  groups.get(name).push(row);
 }
 const themes=[...groups].map(([name,items])=>{
  const roles={};
  const max=Math.max(0,...items.map(row=>row.level||0));
  const leaders=items.filter(row=>row.level===max);
  const first=leaders.length===1?leaders[0]:null;
  if(first&&max>1&&first.firstSeal&&items.every(row=>row===first||row.level&&row.firstSeal&&first.firstSeal<row.firstSeal)){
   roles[first.code]='龙头候选';
  }
  const mid=[...items].filter(row=>row!==first&&row.amount&&row.floatCap&&
   extra?.seats?.some(seat=>seat.code===row.code&&seat.category==='机构专用'&&seat.net>0))
   .sort((a,b)=>b.amount-a.amount)[0];
  if(mid&&items.every(row=>row===mid||row.amount&&row.floatCap&&mid.amount>=row.amount&&mid.floatCap>=row.floatCap))roles[mid.code]='中军候选';
  if(first&&roles[first.code]&&first.reason)for(const row of items){
   if(!roles[row.code]&&row.level===1&&row.reason&&row.firstSeal>first.firstSeal&&
     row.reason.split(/[+＋、]/).some(tag=>tag.trim()&&first.reason.split(/[+＋、]/).includes(tag)))roles[row.code]='补涨候选';
  }
  return {name,codes:items.map(row=>row.code),roles,classification:items.length===1?'独立样本':'强度待核验'};
 });
 const promotion=extra?.promotion?.stages;
 const prior=arr(promotion).filter(stage=>stage.level>=2);
 const promoted=prior.reduce((sum,stage)=>sum+stage.promoted,0);
 const eligible=prior.reduce((sum,stage)=>sum+stage.total,0);
 const broken=extra?.broken?.complete?extra.broken.records.map(row=>[row.symbol,row.name,row.changePct]):null;
 const failed=extra?.promotion?.failed.map(row=>[row.code,row.name,null,row.level])??null;
 const upCount=sealed?.totalCount??coverage.source?.reportedCount;
 const highest=rows.reduce((height,row)=>Math.max(height,row.level||0),0);
 const riskRows=rows.filter(row=>row.breakCount>0).sort((a,b)=>b.breakCount-a.breakCount);
 const top=rows.filter(row=>row.level===highest&&highest>=2).slice(0,4).map(row=>row.code);
 const named=match=>themes.flatMap(group=>Object.entries(group.roles||{}).filter(([,role])=>role===match).map(([code])=>code)).slice(0,4);
 return {day,rows,groups:themes,broken,failed,promotion,retained:arr(extra?.retained).map(key=>retainedLabels[key]).filter(Boolean),seats:arr(extra?.seats),seatsStatus:extra?.seatsStatus,
  sources:{market:providerLink,stocks:providerLink,seats:seatLink,themes:thsLink,north:northLink,turnover:marketLink},
  coverage:sealed?'梯队按东方财富同日涨停池。涨停及炸板统计采用同一供应商口径。':
   raw?'梯队按原始复盘返回的股票。源端总数与分析明细分别保留。':'等待带有原始交易日期的服务端报告。',
  reasonStatus:extra?.reasonChannels?.primaryCount===0?
   '同花顺涨停聚焦未返回可核实的同日原标注。F10 复核 '+extra.reasonChannels.f10Count+' / '+extra.reasonChannels.f10Attempted+' 只前排样本。':
   rows.some(row=>row.reason)?'涨停原因仅使用已匹配本交易日的同花顺原标注。':
   '尚未取得与本交易日匹配的同花顺逐股原标注。可展开来源涨停池核对渠道。',
  phase:null,phaseNote:'当前缺少足够的同口径跨日证据，情绪阶段待判断。',
  stats:[
   ['涨停 / 跌停',count(upCount,'')+' / '+count(extra?.down,''),'东方财富供应商口径'],
   ['收盘炸板',broken?count(broken.length):'—','盘中触板，收盘未封住'],
   ['封板率',finite(extra?.sealRate)?format(extra.sealRate*100,1)+'%':'—','同源涨停数 / 触板总数'],
   ['最高连板',highest?levelName(highest):'—','已返回名单高度'],
   ['昨日连板晋级',rate(promoted,eligible),eligible?promoted+' / '+eligible+' · 昨日至少二板':'等待两日同口径名单'],
   ['沪深成交',money(extra?.marketTurnover),finite(extra?.marketTurnover)?'腾讯沪深收盘报价合计':'尚无已核实的两市收盘总成交'],
   ['北向成交',money(extra?.northTurnover),finite(extra?.northTurnover)?'沪股通及深股通成交合计':'尚无已核实的北向成交额']
  ],
  risks:[
   ['盘中开板后回封',riskRows.length?'已返回名单中 '+riskRows.length+' 只收盘封住，但盘中有开板记录。':'暂无可核实的回封样本。',riskRows.slice(0,5).map(row=>row.code)],
   ['昨日高位断板',failed?failed.length+' 只昨日至少二板的股票未完成连续晋级。':'等待上一交易日完整池以核对。',failed?.slice(0,4).map(row=>row[0])||[]]
  ],
  watch:[
   ['龙头承接','比较高位股开盘后的涨跌、成交与首次分歧时的板块宽度。',top],
   ['中军支撑','检验高成交标的相对板块涨跌及量能变化。',named('中军候选')],
   ['新题材卡位','验证是否出现同源归因的多个涨停股及连续晋级。',[]],
   ['断板修复','检查断板股回撤是否收敛、再触板后能否维持。',failed?.slice(0,4).map(row=>row[0])||[]]
  ]
 };
}

function sourceLinks(report,keys){
 const refs=keys.map(key=>report.sources[key]).filter(Boolean);
 return refs.length?h('div',{class:'fy-close-links'},[...new Set(refs)].map(([label,url])=>safeLink(url,label))):null;
}

export function renderCloseReview(ctx,additional){
 const view=h('div',{class:'fy-reference-review fy-close-review','data-close-review':true});
 const status=h('p',{class:'fy-close-status',role:'status'});
 const dateSelect=h('select',{'aria-label':'复盘交易日'});
 const refresh=button('刷新复盘',async()=>{
  refresh.disabled=true;
  try{await ctx.refresh();await loadSupplement(true);}finally{refresh.disabled=false;}
 },'primary');
 const header=h('header',{class:'fy-close-hero'},
  h('div',{},h('h1',{},'A 股收盘复盘'),status),
  h('div',{class:'fy-close-actions'},dateSelect,
   button('原始报告',()=>ctx.navigate('pulse','review-details')),refresh));
 const cards=h('div',{class:'fy-close-grid'});
 const nav=h('nav',{class:'fy-close-nav','aria-label':'复盘章节'},headings.map(([key,,label])=>
  button(label,()=>cards.querySelector('[data-review-section="'+key+'"]')?.scrollIntoView({block:'start'}),'quiet')));
 let updatePool;
 const pool=renderSourceReviewPool({
  get state(){return ctx.state;},signal:ctx.signal,selectStock:(...args)=>ctx.selectStock(...args),onState:fn=>{updatePool=fn;}
 },stockCard);
 view.append(header,nav,cards,pool,additional);
 let selected='',activeKey='',activeDay='',supplement=null,requesting=false,failure='',fingerprint='',renderedScope='';
 let selectedStock='',seatFilter='全部';
 let recovery={key:'',attempts:0,retryAt:0};

 function project(){
  const serverDay=reviewDate(ctx.state?.review?.date);
  const defaultKey=serverDay&&serverDay>archive.day?'cloud':'archive';
  const key=selected||defaultKey;
  const options=[['archive',archive.day+' · 收盘归档'],['cloud',(serverDay||'日期待核验')+' · 服务端复盘']];
  const optionKey=JSON.stringify(options);
  if(dateSelect.dataset.options!==optionKey){
   dateSelect.replaceChildren(...options.map(([value,label])=>h('option',{value},label)));
   dateSelect.dataset.options=optionKey;
  }
  dateSelect.value=key;
  const day=key==='archive'?archive.day:serverDay;
  if(activeKey!==key||activeDay!==day){selectedStock='';seatFilter='全部';activeKey=key;activeDay=day;}
  const report=key==='archive'?archivedReport():cloudReport(ctx.state||{},supplement);
  return {key,report};
 }

 function paint(force=false){
  if(ctx.signal?.aborted)return;
  const {key,report}=project();
  const scope=key+':'+report.day;
  const current=JSON.stringify([scope,report,selectedStock,seatFilter]);
  const sameScope=scope===renderedScope;
  const focused=cards.contains(document.activeElement)?document.activeElement:null;
  const focusKey=focused?.dataset.reviewControl;
  const incomplete=supplement?.day===report.day&&supplement?.retryAfterMs>0;
  const caption=requesting?'正在读取免费补充行情':failure||(incomplete?'服务端复盘 · 部分数据待补':'服务端复盘');
  status.textContent=(report.day||'交易日待核验')+' · '+(key==='archive'?'收盘归档':caption);
  if(!force&&(current===fingerprint||sameScope&&focused&&!focusKey))return;
  fingerprint=current;
  renderedScope=scope;
  for(const item of cards.querySelectorAll('[data-review-detail]')){
   expanded.set(item.dataset.reportKey+':'+item.dataset.reviewDetail,item.open);
  }
  const source=dailyReviewEvidence(ctx.state||{});
  pool.hidden=key==='archive'||source.day!==report.day;
  if(!pool.hidden)updatePool?.();
  const names=new Map([...report.rows.map(row=>[row.code,row.name]),...arr(report.failed),...arr(report.broken),...report.seats.map(row=>[row.code,row.name])]);
  const stock=code=>button(h('span',{},names.get(code)||archiveNames[code]||code),()=>ctx.selectStock(code,{code,name:names.get(code)||archiveNames[code]}),'quiet');
  const list=items=>h('div',{class:'fy-close-stocks'},items.map(stock));
  const card=(index,description,...children)=>{
   const [id,title]=headings[index];
   const node=section(title,description,...children);
   node.dataset.reviewSection=id;
   return node;
  };
  const rowByCode=new Map(report.rows.map(row=>[row.code,row]));
  const turnoverTotal=group=>group.codes.reduce((sum,code)=>sum+(rowByCode.get(code)?.amount||0),0);
  const completeTurnover=group=>group.codes.every(code=>finite(rowByCode.get(code)?.amount));
  const groups=[...report.groups].sort((a,b)=>b.codes.length-a.codes.length||
   (completeTurnover(a)&&completeTurnover(b)?turnoverTotal(b)-turnoverTotal(a):Number(completeTurnover(b))-Number(completeTurnover(a)))||
   a.name.localeCompare(b.name,'zh-CN'));
  const themeMax=groups[0]?.codes.length||1;
  const openReason=code=>{
   selectedStock=code;
   paint(true);
   cards.querySelector('[data-reason-selected]')?.focus();
  };
  const levelMap=new Map();
  for(const row of report.rows){
   const level=row.level??0;
   if(!levelMap.has(level))levelMap.set(level,[]);
   levelMap.get(level).push(row);
  }
  const chosen=rowByCode.get(selectedStock)||report.rows.find(row=>row.reason)||report.rows[0];
  const ladder=[];
  const levels=[...levelMap].sort(([left],[right])=>right-left);
  for(let index=0;index<levels.length;index++){
   const [level,rows]=levels[index];
   ladder.push(h('div',{class:'fy-close-level'},
    h('div',{class:'fy-close-level-title'},h('strong',{},level?levelName(level):'板次待核验'),h('small',{},count(rows.length))),
    h('div',{class:'fy-close-stocks'},rows.map(row=>{
     const pick=button(row.name,()=>openReason(row.code),chosen?.code===row.code?'active':'quiet');
     pick.dataset.reviewControl='stock:'+row.code;
     pick.setAttribute('aria-pressed',String(chosen?.code===row.code));
     return pick;
    }))));
   const next=levels[index+1]?.[0]??1;
   if(level-next>1)ladder.push(h('div',{class:'fy-close-level fy-close-gap'},h('span',{},level-1===next+1?levelName(next+1):levelName(next+1)+'至 '+levelName(level-1)),h('span',{},'当前名单空缺')));
  }
  const reasons=chosen?h('article',{class:'fy-close-reason',tabindex:'-1','data-reason-selected':true,'data-review-control':'reason'},
   h('div',{class:'fy-close-reason-heading'},h('div',{},h('h3',{},chosen.name,' ',h('small',{},chosen.code)),h('span',{class:'fy-muted'},chosen.tags.join(' / ')||'题材待核验')),
    button('个股详情',()=>ctx.selectStock(chosen.code,{code:chosen.code,name:chosen.name}))),
   h('p',{},h('strong',{},'同花顺涨停原因'),h('br'),h('span',{'data-reason-text':true},chosen.reason||'未取得该股同日的同花顺原标注。')),
   h('dl',{class:'fy-close-facts'},[
    ['连板高度',levelName(chosen.level)],['首次封板',chosen.firstSeal||'—'],['最后封板',chosen.lastSeal||'—'],
    ['开板次数',count(chosen.breakCount,' 次')],['换手率',finite(chosen.turnover)?format(chosen.turnover,2)+'%':'—'],
    ['成交额',money(chosen.amount)]
   ].map(([label,value])=>h('div',{},h('dt',{},label),h('dd',{},value)))),
   chosen.streak&&h('p',{class:'fy-muted'},'区间累计 '+chosen.streak),
   chosen.reasonUrl?safeLink(chosen.reasonUrl,chosen.reasonSource):chosen.reason?h('small',{class:'fy-muted'},chosen.reasonSource+' · '+report.day):
    safeLink('https://basic.10jqka.com.cn/'+chosen.code+'/event.html','核对同花顺 F10')):null;
  const incidents=(title,items,withLevel)=>h('div',{class:'fy-close-incident'},
   h('h3',{},title),
   items===null?h('p',{class:'fy-muted'},'名单未取得。'):!items.length?h('p',{class:'fy-muted'},'同口径没有记录。'):
    h('div',{class:'fy-close-stocks'},items.map(([code,name,pct,level])=>
     button(h('span',{},name||code,withLevel&&level?' · 昨 '+levelName(level):'',finite(pct)?h('b',{class:direction(pct)},' '+percent(pct)):null),
      ()=>ctx.selectStock(code,{code,name}),'quiet'))));
  const categories=[...new Set(report.seats.map(row=>row.category))];
  const visibleSeats=report.seats.filter(row=>seatFilter==='全部'||row.category===seatFilter);
  const seatRows=visibleSeats.map(row=>h('li',{},h('div',{},stock(row.code),h('small',{},row.dept,row.reason?' · '+row.reason:'')),
   h('strong',{class:direction(row.net)},signedMoney(row.net))));
  const renderItems=items=>h('div',{class:'fy-close-items'},items.map(([label,description,codes])=>
   h('article',{},h('h3',{},label),h('p',{},description),codes.length?list(codes):null)));
  cards.replaceChildren(
   card(0,null,
    h('div',{class:'fy-close-phase'},h('strong',{},report.phase||'阶段待判断'),h('p',{},report.phaseNote)),
    h('div',{class:'fy-close-kpis'},report.stats.map(([label,value,meta])=>
     h('article',{class:'fy-close-kpi'},h('span',{},label),h('strong',{},value),h('small',{},meta)))),
    h('p',{class:'fy-muted'},report.coverage),
    report.retained?.length?h('p',{class:'fy-muted','data-retained-review':true},'使用已核实记录 · '+report.retained.join('、')):null,
    report.promotion?.length?h('p',{class:'fy-muted'},report.promotion.map(stage=>stage.level+' 进 '+(stage.level+1)+' '+stage.promoted+'/'+stage.total).join(' · ')):null,
    sourceLinks(report,['market','pools','ladder','turnover','north'])),
   card(1,'按涨停家数排序，同家数比较已核实的样本成交额。',
    groups.length?h('div',{class:'fy-close-themes'},groups.map(group=>
     h('details',{class:'fy-close-theme','data-review-detail':'theme:'+group.name,open:groups.indexOf(group)<1},
      h('summary',{},h('div',{},h('strong',{},group.name),h('small',{},group.classification)),
       h('div',{},h('strong',{},count(group.codes.length)),h('small',{},completeTurnover(group)?money(turnoverTotal(group)):'成交额未齐'))),
      h('div',{class:'fy-close-track','aria-hidden':'true'},h('span',{style:'width:'+100*group.codes.length/themeMax+'%'})),
      group.note&&h('p',{},group.note),
      h('div',{class:'fy-close-stocks'},group.codes.map(code=>
       button(h('span',{},names.get(code)||code,group.roles?.[code]?h('b',{},' · '+group.roles[code]):null),
        ()=>openReason(code),'quiet')))))):empty('暂无同日题材样本'),
    sourceLinks(report,['themes','sectors'])),
   card(2,report.reasonStatus,ladder.length?ladder:empty('暂无同日连板明细'),reasons,
    incidents('收盘炸板',report.broken),incidents('昨日高位断板',report.failed,true),sourceLinks(report,['stocks','ladder'])),
   card(3,key==='archive'?'当日榜、机构专用、互联互通和营业部分开查看。':'东方财富公开买方明细中的已观察席位。按上榜记录展示。',
    categories.length?h('div',{class:'fy-close-stocks','aria-label':'席位分类'},['全部',...categories].map(category=>{
     const filter=button(category,()=>{seatFilter=category;paint(true);[...cards.querySelectorAll('[data-seat-filter]')].find(node=>node.dataset.seatFilter===category)?.focus();},seatFilter===category?'active':'quiet');
     filter.dataset.seatFilter=category;filter.dataset.reviewControl='seat:'+category;filter.setAttribute('aria-pressed',String(seatFilter===category));return filter;
    })):null,seatRows.length?h('ul',{class:'fy-close-seats'},seatRows):
     empty(report.seatsStatus==='pending'?'龙虎榜待当日公布':'暂无可核实的同日席位','可从公开榜单核对上榜日期。'),
    report.seatsStatus==='partial'?h('p',{class:'fy-muted'},'龙虎榜有部分明细尚未获取。'):null,
    sourceLinks(report,['seats','aliases'])),
   card(4,null,renderItems(report.risks),sourceLinks(report,['pools','ladder'])),
   card(5,'逐项记录下一交易日的验证条件。',renderItems(report.watch))
  );
  for(const item of cards.querySelectorAll('[data-review-detail]')){
   item.dataset.reportKey=key+':'+report.day;
   const detailKey=item.dataset.reportKey+':'+item.dataset.reviewDetail;
   if(expanded.has(detailKey))item.open=expanded.get(detailKey);
   item.querySelector('summary').dataset.reviewControl=detailKey;
   item.addEventListener('toggle',()=>{if(item.isConnected)expanded.set(detailKey,item.open);});
  }
  if(focused){
   const replacement=sameScope&&focusKey?[...cards.querySelectorAll('[data-review-control]')].find(node=>node.dataset.reviewControl===focusKey):null;
   (replacement||dateSelect).focus({preventScroll:true});
  }
 }
 const expanded=new Map();
 cards.addEventListener('focusout',()=>queueMicrotask(()=>paint()));
 dateSelect.addEventListener('change',()=>{selected=dateSelect.value;paint(true);void loadSupplement();});

 async function loadSupplement(force=false){
  const day=reviewDate(ctx.state?.review?.date);
  const current=activeKey==='cloud'&&day;
  if(!current||ctx.signal?.aborted||!ctx.api||requesting)return;
  const latestTime=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}).format(new Date());
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  if(day===today&&latestTime<'15:00')return;
  const requestKey=day+':'+(day!==today||latestTime>='18:00'?'published':'pre-publish');
  if(recovery.key!==requestKey)recovery={key:requestKey,attempts:0,retryAt:0};
  if(!force&&recovery.attempts&&(recovery.attempts>=3||!recovery.retryAt||Date.now()<recovery.retryAt))return;
  recovery.attempts++;
  recovery.retryAt=0;
  requesting=true;failure='';paint();
  try{
   const response=await ctx.api('/api/close-review-evidence?date='+day,{signal:ctx.signal,timeoutMs:42000});
   if(response?.result?.day===day){
    supplement=response.result;
    const delay=supplement.retryAfterMs;
    if(Number.isFinite(delay)&&delay>0)recovery.retryAt=Date.now()+Math.max(120000,delay);
   }else{
    failure='补充渠道未返回同日数据';
    recovery.retryAt=Date.now()+120000;
   }
  }catch(error){
   if(error.name!=='AbortError'){
    failure='补充渠道暂不可用';
    recovery.retryAt=Date.now()+120000;
   }
  }
  finally{
   requesting=false;paint();
   if(day!==reviewDate(ctx.state?.review?.date))void loadSupplement();
  }
 }
 ctx.onState?.(()=>{paint();void loadSupplement();});
 paint();void loadSupplement();
 return view;
}
