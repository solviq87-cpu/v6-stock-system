import {h,button,updateReadout,dateTime,percent} from './ui.js';
import {POOLS,closeSessionDay,marketOverviewParts,poolStateResult,reviewDate,selectResearchPicks} from './market.js';

export function homeEmpty(label,summary,...content){
 return h('details',{class:'fy-home-empty'},
  h('summary',{},h('strong',{},label),h('span',{},summary)),...content);
}

// Keep both the actual panel and an expanded disclosure alive through ordinary ticks.
export function adaptivePanel(label,panel){
 const host=h('div',{class:'fy-home-panel-slot'}),message=h('span');
 const folded=h('details',{class:'fy-home-empty'},h('summary',{},h('strong',{},label),message));
 let previous;
 function update(ready,status){
  message.textContent=status;
  if(ready===previous)return;
  if(ready)host.replaceChildren(panel);
  else{folded.open=false;folded.append(panel);host.replaceChildren(folded);}
  previous=ready;
 }
 return {host,update};
}

// The session only chooses which existing observation to show first.
function sessionOf(state){
 const clock=state.marketClock,closed=closeSessionDay(state);
 const stamp=Number.isFinite(state.now)?state.now:Date.now();
 const china=new Date(stamp+28800000),minute=china.getUTCHours()*60+china.getUTCMinutes();
 const today=china.toISOString().slice(0,10);
 const trading=clock?.trading??state.trading;
 const day=closed||reviewDate(clock?.day)||(trading===true?today:null);
 if(!closed&&day===today&&trading===true){
  return minute<570?{day,mode:'auction',label:'集合竞价'}:{day,mode:'market',label:'盘中'};
 }
 const next=Number.isFinite(clock?.nextOpenAt)?new Date(clock.nextOpenAt+28800000):null;
 if(clock?.trading===false&&minute>=690&&minute<780&&next?.toISOString().slice(0,10)===today){
  return {day,mode:'pause',label:'午间休市'};
 }
 return {day,mode:'close',label:closed?'收盘快照':'盘面观察'};
}

const channels=[
 ['ranked','精选','查看系统精选'],['auction','竞价引力','查看竞价引力'],
 ['movement','盘中异动','查看盘中异动'],['relay-first','一进二','查看一进二']
];

function opportunityLists(state,picks,session,editor){
 const day=session.day,now=Date.now(),tape=state.auctionObservations,moves=state.fastStockMoves;
 const select=p=>p.day===day&&day?p.items.map(row=>({row,why:row.selectionWhy,source:[p.label,p.day].join(' · ')})):[];
 const before=tape?.phase==='before-match';
 const auction=tape?.day===day&&day?(before?tape.indicative:tape.items)||[]:[];
 const opening=auction.filter(r=>r?.day===day&&/^\d{6}$/.test(r.code)&&(r.source||r.sealSource)&&
  (r.sealSource&&!before||Number.isFinite(r.openPct))&&Number.isSafeInteger(r.knownAt)&&Number.isSafeInteger(r.quoteAt)&&
  r.quoteAt>0&&r.quoteAt<=r.knownAt&&r.knownAt<=now&&new Date(r.quoteAt+28800000).toISOString().slice(0,10)===day)
  .map(row=>({row,why:before?'竞价指示涨幅 '+percent(row.openPct):row.sealSource?'09:25 封板':'竞价高开 '+percent(row.openPct),
   source:[row.sealSource||row.source,dateTime(row.quoteAt)].filter(Boolean).join(' · ')}));
 const movement=moves?.tradeDate===day&&day&&Number.isSafeInteger(moves.checkedAt)&&moves.checkedAt<=now?(moves.items||[]).filter(r=>
  r&&/^\d{6}$/.test(r.code)&&Number.isFinite(r.risePct)&&Number.isFinite(r.spanMs)&&r.spanMs>0&&Number.isSafeInteger(r.quoteAt)&&r.quoteAt>0&&
  r.quoteAt<=moves.checkedAt&&new Date(r.quoteAt+28800000).toISOString().slice(0,10)===day&&(r.quoteSource||r.source))
  .map(row=>({row,why:Math.round(row.spanMs/1000)+' 秒涨幅 '+percent(row.risePct),source:[row.quoteSource||row.source,dateTime(row.quoteAt)].join(' · ')})):[];
 const relay=editor?select(selectResearchPicks(state,{level:1,native:poolStateResult(POOLS.find(p=>p[0]==='relay-first'),state)})):[];
 return {ranked:select(picks),auction:opening,movement,'relay-first':relay};
}

export function createTradingHome(ctx,accountPanel){
 const indexHost=h('div',{class:'fy-home-indices fy-terminal-index'}),climate=h('div',{class:'fy-home-climate'});
 const stamp=h('small',{class:'fy-home-stamp'});
 const market=h('section',{class:'fy-home-section fy-home-market','aria-label':'大盘一眼看'},
  h('header',{},h('h2',{},'大盘一眼看'),stamp),indexHost,climate);
 const detail=h('div',{class:'fy-home-opportunity-detail'}),tabList=h('div',{class:'fy-home-tabs',role:'group','aria-label':'机会类型'});
 let chosen=ctx.viewMemory?.homeChannel||null,lastLists=null,lastSession=null;
 const controls=new Map(channels.map(([key,label])=>[key,h('button',{type:'button',disabled:key==='relay-first'&&ctx.role!=='edit',
  title:({auction:'开盘前集合竞价的同批观测',movement:'盘中短时间价格变动', 'relay-first':'前一交易日首板，观察能否接续第二板'})[key],onClick:()=>{chosen=key;if(ctx.viewMemory)ctx.viewMemory.homeChannel=key;paintSelection();}},label)]));
 tabList.append(...controls.values());
 const go=button('查看全部推荐 →',()=>ctx.navigate('opportunities','ranked'),'primary');
 const featured=h('div',{class:'fy-home-featured','aria-label':'系统精选'});
 let active='ranked';
 const opportunity=h('section',{class:'fy-home-section fy-home-opportunity','aria-label':'今日机会'},
  h('header',{},h('h2',{},'今日机会'),go),featured,tabList,detail);
 const riskFacts=h('div',{class:'fy-home-risk-facts'}),portfolio=h('div',{class:'fy-home-portfolio'});
 const positionCount=h('small',{class:'fy-home-position-count'});
 const risk=h('section',{class:'fy-home-section fy-home-risk','aria-label':'风险与持仓'},
  h('header',{},h('h2',{},'风险与持仓'),positionCount,ctx.role==='edit'?button('查看风控',()=>ctx.navigate('assets','risk'),'quiet'):null),riskFacts,portfolio);
 let accountReady;
 function paintSelection(){
  const mode=lastSession.mode,lists=lastLists;
  const preferred=mode==='auction'?['auction','ranked','movement','relay-first']:mode==='market'?['movement','ranked','auction','relay-first']:
   ['ranked','relay-first','auction','movement'];
  active=chosen||preferred.find(k=>lists[k].length)||preferred[0];
  for(const [key,tab] of controls)tab.setAttribute('aria-pressed',String(active===key));
  const [,label]=channels.find(([key])=>key===active);
  if(active==='ranked' && lists.ranked.length && lists.ranked[0].row.pickSource!=='收盘观察精选'){
   updateReadout(detail);return;
  }
  const rows=lists[active];
  if(!rows.length){
   const notice={ranked:'本期无符合条件的标的',auction:'本期暂无已核实记录',movement:'本期暂无同日异动记录','relay-first':'本期暂无符合条件的首板标的'}[active];
   const fold=homeEmpty(label,notice,h('p',{},[lastSession.day,'打开'+label+'可查看当期来源和筛选范围。'].filter(Boolean).join(' · ')));
   fold.id='fy-home-empty-'+active;
   updateReadout(detail,fold);
   return;
  }
  const channel=active;
  const stock=({row,why,source},i)=>h('button',{type:'button',class:'fy-stock-card fy-home-stock','data-code':row.code,
   onClick:event=>{chosen=channel;ctx.selectStock(row.code,row,event.currentTarget);}},
   h('strong',{},row.name||row.code),h('small',{},row.code),i===0?h('span',{class:'fy-home-pick-source'},source):null,
   h('span',{class:'fy-home-pick-why'},why));
  const others=rows.slice(1,3);
  const more=others.length?h('details',{class:'fy-home-other',id:'fy-home-other-'+channel,
   onToggle:event=>{if(event.currentTarget.open)chosen=channel;}},
   h('summary',{},'更多同类观察 · '+others.length+' 只'),others.map((r,i)=>stock(r,i+1))):null;
  updateReadout(detail,stock(rows[0],0),more);
 }
 function paint(state,picks,hasAccount,positions){
  const session=sessionOf(state),parts=marketOverviewParts(state,{homeDay:session.day});
  stamp.textContent=[session.label,session.day].filter(Boolean).join(' · ');
  const quotes=parts.indexAvailability;
  if(quotes.some(q=>q.ready))updateReadout(indexHost,...parts.indices.map((node,i)=>quotes[i].ready?node:homeEmpty(quotes[i].name,'暂未收到报价',node)));
  else updateReadout(indexHost,homeEmpty('三大指数','暂未收到当期报价',...parts.indices));
  positionCount.hidden=positions==null;
  positionCount.textContent=positions==null?'':'模拟持仓 '+positions+' 只';
  updateReadout(climate,parts.hasSentiment?parts.sentiment:homeEmpty('市场情绪','数据不足，暂不判断',parts.sentiment),
   parts.hasEnvironment?parts.environment:homeEmpty('市场环境','尚无同日判断',parts.environment));
  updateReadout(riskFacts,parts.hasRisk?parts.risk:homeEmpty('市场风险','本期暂无可核对指标',parts.risk));
  if(accountReady!==hasAccount){
   portfolio.replaceChildren(hasAccount?accountPanel:homeEmpty('我的账户 · 模拟盘',ctx.role==='edit'?'本期暂无账户估值':'仅研究账户可查看',accountPanel));
   accountReady=hasAccount;
  }
  lastSession=session;lastLists=opportunityLists(state,picks,session,ctx.role==='edit');
  const selected=lastLists.ranked.filter(item=>item.row.pickSource==='V6 策略命中');
  updateReadout(featured,h('h3',{},'系统精选 · '+selected.length+' 只 ',
    h('abbr',{class:'fy-term',tabindex:'0',title:'评分用于比较候选排序，最高展示三只。','aria-label':'什么是精选评分','data-help':'评分用于比较候选排序，最高展示三只。'},'?')),
   ...(selected.length?selected.map(({row,why})=>h('button',{type:'button',class:'fy-stock-card fy-home-stock','data-code':row.code,
    onClick:event=>ctx.selectStock(row.code,row,event.currentTarget)},h('strong',{},row.name||row.code),h('small',{},row.code),
    h('b',{class:'fy-home-pick-score'},Number.isFinite(row.score)?row.score+' 分':'源端未提供评分'),
    h('span',{class:'fy-home-pick-why'},why))):[h('p',{class:'fy-muted'},'本期没有通过精选条件的标的。')]));
  paintSelection();
 }
 return {market,opportunity,risk,paint};
}
