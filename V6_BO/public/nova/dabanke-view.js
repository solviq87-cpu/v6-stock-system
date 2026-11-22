import {h,button,format,money,percent,dateTime,safeLink} from './ui.js';
import {sectorRoles,roleBadge} from './stock-roles.js';

const num=n=>Number.isFinite(n)?format(n,2):'';
const priceChange=n=>Number.isFinite(n)?percent(n):'';
const funds=n=>Number.isFinite(n)?(n<0?'−':'')+money(Math.abs(n)):'';
const panel=(title,...nodes)=>h('article',{class:'fy-dbk-panel'},h('h3',{},title),...nodes);
const grid=items=>h('div',{class:'fy-dbk-grid'},items);
const fact=(key,value,detail)=>h('div',{class:'fy-dbk-fact'},h('small',{},key),h('strong',{},value),detail?h('small',{},detail):null);
const fold=(key,label,...nodes)=>h('details',{class:'fy-details','data-review-detail':'dbk:'+key},h('summary',{},label),...nodes);
const source=(r,caption)=>r?h('small',{class:'fy-dbk-source'},[r.day,caption||r.source,'取得 '+dateTime(r.knownAt)].join(' · '),' ',safeLink(r.url,'原始页面')):null;
const listing=rows=>h('ul',{class:'fy-dbk-list'},rows);
export function dabankePanels(report,ctx){
 const out={mood:[],themes:[],ladder:[],seats:[],risks:[],watch:[]};
 if(!report?.day||report.knownAt>Date.now())return out;
 const {day}=report,index=report.index,pocket=report.pocket,lhb=report.disclosures;
 const roles=sectorRoles(ctx.state,day),stock=r=>button(h('span',{},r.name||r.label||r.code,' ',roleBadge(roles.get(r.code))),()=>ctx.selectStock(r.code,{...r,poolDay:day}),'quiet');
 const line=(r,suffix,extra)=>h('li',{},r.code?stock(r):h('b',{},r.label),suffix?h('span',{},suffix):null,extra?h('small',{},extra):null);
 if(index?.day===day){
  const market=index.market;
  if(market)out.mood.push(panel('五大指数与沪深北成交',grid(market.indices.map(r=>fact(r.name,priceChange(r.change)))),
    market.amount!==null?fact(market.amountLabel,market.amountText,market.comparisons.map(([key,n])=>key+' '+priceChange(n)).join(' · ')):null,
    market.summary?h('p',{},market.summary):null,source(index)));
  if(index.ecology?.length)out.mood.push(panel('封板与晋级 · 短线池不含 ST',grid(index.ecology.map(r=>fact(r.label,r.display,r.note))),source(index)));
  if(index.tiers?.length)out.ladder.push(panel('晋级、炸板与断板明细',...index.tiers.map(t=>fold('tier:'+t.name,
    t.name+' · '+(t.name==='首板'?'封住 ':'晋级 ')+t.success+' / '+t.total+' 只',
    listing(t.members.map(r=>line(r,[r.status,r.performance,priceChange(r.change),r.firstSeal&&'首封 '+r.firstSeal,r.history,r.newHigh&&'60日新高'].filter(Boolean).join(' · '),
      r.reason?r.reason+' · 资料 '+r.reasonDay:null))))),source(index)));
  if(index.themes?.length)out.themes.push(panel('活跃题材与成分表现',...index.themes.map(t=>fold('concept:'+t.name,
    t.name+' · 活跃 '+t.active+' / '+t.total+' 只 · 封板 '+t.sealed+' 只',
    h('p',{},'活跃占比 '+num(t.activePct)+'% · 中位涨幅 '+priceChange(t.median)+(t.height?' · 最高 '+t.height+' 板':'')),
    t.alignment?h('small',{},t.alignment):null,listing(t.members.map(r=>line(r,priceChange(r.change)))))),source(index)));
  if(index.signals){
   const s=index.signals;
   for(const [key,negative] of [['ladder',false],['risks',true]]){
    const groups=s.groups.filter(g=>g.negative===negative);
    out[key].push(panel(negative?'负向形态':'正向形态',h('p',{},'当日十二类形态合计 '+s.stocks+' 只股票，出现 '+s.appearances+' 次，同一股票可命中多类。'),
      ...groups.map(g=>g.members.length?fold('pattern:'+g.name,g.name+' · '+g.members.length+' 只',listing(g.members.map(r=>line(r,priceChange(r.change),r.theme)))):
       h('span',{class:'fy-tag'},g.name+' 0 只')),source(index)));
   }
  }
 }
 if(pocket?.day===day){
  if(pocket.activity)out.mood.push(fold('activity','成交活跃 · 成交额前十',
   h('p',{},'活跃 '+pocket.activity.active+' 只 · 有效样本 '+pocket.activity.total+' 只'),listing(pocket.activity.rows.map(r=>line(r,'第 '+r.rank+' 名 · '+funds(r.amount),priceChange(r.change)))),source(pocket)));
  if(pocket.popularity){
   const p=pocket.popularity;
   out.watch.push(fold('popularity','人气前十 · 观察日 '+p.observedDay,
    h('p',{},'排名观察 '+dateTime(p.observedAt)+' · 行情日 '+day),listing(p.rows.map(r=>line(r,'第 '+r.rank+' 名 · 行情日 '+priceChange(r.change),
      ['近10日 '+priceChange(r.change10),r.theme].filter(Boolean).join(' · ')))),source(pocket)));
  }
  const dest={financing:'mood',extremes:'mood',continuity:'mood',structure:'ladder',times:'ladder',industries:'themes',hotwords:'themes',rotation:'themes','limit-activity':'watch',breaks:'risks',interval:'watch'};
  for(const b of pocket.briefs||[]){
   if(!dest[b.key])continue;
   out[dest[b.key]].push(fold('brief:'+b.key,b.title+' · '+b.day,
    listing(b.entries.map(e=>line(e,e.value))),b.meta?.length?h('small',{},b.meta.join(' · ')):null,source(pocket)));
  }
  const top=pocket.dragon;
  if(top)out.seats.push(panel('龙虎榜 · 买入金额前十',h('p',{},'上榜 '+top.stocks+' 只 · 按披露买入额排序，单日榜优先。'),
    h('div',{class:'fy-dbk-dragon'},top.rows.map(r=>h('article',{},h('div',{class:'fy-inline'},h('b',{},'#'+r.rank),stock(r),h('strong',{},priceChange(r.change))),
     h('small',{},[r.theme,r.span.multi?'多日榜 '+r.span.start+' 至 '+r.span.end:'单日榜 '+r.span.end].filter(Boolean).join(' · ')),
     h('p',{},'披露买入 '+funds(r.buy)+' · 净买 '+funds(r.net)),
     r.seats.length?fold('seats:'+r.code,'核心营业部 · '+r.seats.length+' 个',listing(r.seats.map(s=>line({label:s.name},'买 '+funds(s.buy)+' / 卖 '+funds(s.sell),s.fullName)))):null))),source(pocket)));
 }
 if(lhb?.day===day)out.seats.push(fold('disclosures','交易所全部披露 · '+lhb.rows.length+' 条 / '+lhb.stocks+' 只',
   h('p',{},'发布时间 '+dateTime(lhb.publishedAt)+' · 单日 '+lhb.single+' 条 · 多日 '+lhb.multi+' 条'),
   listing(lhb.rows.map(r=>line(r,'买 '+funds(r.buy)+' · 卖 '+funds(r.sell)+' · 净额 '+funds(r.net),
     (r.span.multi?r.span.start+' 至 '+r.span.end:'单日 '+r.span.end)+' · '+r.reason))),source(lhb)));
 return out;
}
