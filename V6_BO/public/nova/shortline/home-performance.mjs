import {h,button,table} from '../ui.js';
import {activeBook,bookHeaders} from './book-session.mjs';
import {sampleFor,linkedPage} from './context.mjs';

const environments=['多头','震荡','空头'];
const sampleNames={standard:'标准样本',all:'全部样本',blackSwan:'黑天鹅',extreme:'极端行情',excludeBlackSwan:'排除黑天鹅',excludeExtreme:'排除极端行情'};
const finite=Number.isFinite;
const clean=s=>typeof s==='string'&&s.trim()?s.trim():null;
const number=n=>n.toLocaleString('zh-CN',{maximumFractionDigits:2});

export function performanceMatrix(result){
  const map=new Map(),names=new Set((Array.isArray(result?.strategies)?result.strategies:[]).map(clean).filter(Boolean)),catalog=new Set(names);
  for(const row of Array.isArray(result?.rows)?result.rows:[]){
    const name=clean(row.strategy);
    if(!name||!environments.includes(row.trend)||!Number.isSafeInteger(row.n)||row.n<=0||!finite(row.winRate)||row.winRate<0||row.winRate>100)continue;
    names.add(name);
    if(!map.has(name))map.set(name,new Map());
    map.get(name).set(row.trend,row);
  }
  return [...names].map(strategy=>({strategy,archivedOnly:!catalog.has(strategy),cells:map.get(strategy)||new Map()}));
}

function contents(result,book,selection,navigate){
  const matrix=performanceMatrix(result),populated=matrix.filter(r=>r.cells.size);
  const title=clean(result.book.name)||'研究账户',demo=book==='demo';
  const account=h('strong',{class:demo?'fy-note':''},demo?'教学演示账户 · '+title:'当前账户 · '+title);
  const stamp=String(result.asOf||'').replace('T',' ').slice(0,16);
  const labels=h('div',{class:'fy-inline'},account,h('span',{class:'fy-muted'},sampleNames[selection]),stamp?h('small',{class:'fy-muted'},'统计截止 '+stamp+'（北京时间）'):null);
  const to=(page,strategy)=>navigate(linkedPage(page,{sample:selection,strategy}));
  const rowView=rows=>table([
    {label:'战法 / 回测',value:r=>h('span',{},button(r.strategy,()=>to('backtest',r.strategy),'quiet'),r.archivedOnly?h('small',{class:'fy-muted'},'档案自有模式'):null)},
    ...environments.map(trend=>({label:trend,value:r=>{
      const cell=r.cells.get(trend);
      if(!cell)return h('span',{class:'fy-muted'},'暂无样本');
      return h('div',{},h('strong',{},number(cell.winRate)+'%'),h('small',{class:'fy-muted',style:'display:block'},cell.n+' 笔 · 盈亏比 '+(finite(cell.payoff)&&cell.payoff>=0?number(cell.payoff):'—')));
    }}))
  ],rows);
  const show=populated.slice().sort((a,b)=>Math.max(...[...b.cells.values()].map(r=>r.n))-Math.max(...[...a.cells.values()].map(r=>r.n))).slice(0,3);
  const summary=populated.length?h('p',{class:'fy-muted'},'已覆盖 '+populated.length+' 套战法。以下按单一环境的样本数量展示。'):h('div',{},
    h('p',{},'当前账户在所选样本范围内暂无带行情环境标注的成熟战法样本。'),
    button('导入研究样本',()=>to('import'),'secondary'),button('查看交易样本',()=>to('trades'),'quiet'));
  const details=h('details',{class:'fy-details'},h('summary',{},'全部 '+matrix.length+' 套战法 · 分环境胜率与盈亏比'));
  let painted=false;
  if(matrix.length)details.addEventListener('toggle',()=>{if(details.open&&!painted){painted=true;details.append(rowView(matrix));}});
  return [labels,summary,...(show.length?[rowView(show)]:[]),...(matrix.length?[details]:[]),
    h('small',{class:'fy-muted'},'胜率和平均盈亏比沿用当前账户的研究权重。盈亏比需要同时有盈利和亏损样本。')];
}

// Credentials stay in ctx.api. A response is consumed only by the same live
// editor, book and sample selection that requested it.
export function mountHomePerformance(host,ctx){
  let ticket=0,key='';
  const allowed=()=>ctx.canEdit===true&&!ctx.signal?.aborted;
  function refresh(force=false){
    if(!allowed()){ticket++;key='';host.replaceChildren();host.hidden=true;return;}
    const book=activeBook(),sample=sampleFor(book),id=book+'/'+sample;
    if(!force&&key===id)return;
    key=id;const current=++ticket;
    host.hidden=false;host.replaceChildren(h('p',{class:'fy-muted'},'正在读取账户的分环境绩效…'));
    const visible=()=>current===ticket&&allowed()&&activeBook()===book&&sampleFor(book)===sample;
    const follow=()=>{if(current===ticket&&!visible())refresh();};
    return Promise.resolve().then(()=>visible()?ctx.api('/api/research/shortline',{signal:ctx.signal,headers:{...bookHeaders(book),
      'X-V6-Research-View':'home','X-V6-Sample-Filter':sample}}):null).then(response=>{
      if(!visible()){follow();return;}
      const r=response?.result;
      if(!r||r.book?.id!==book||r.selection!==sample||!Array.isArray(r.rows)||!Array.isArray(r.strategies))throw Error('账户或样本范围未能核对');
      host.replaceChildren(...contents(r,book,sample,sub=>{if(visible())ctx.navigate('lab',sub);}));
    }).catch(()=>{
      if(!visible()){follow();return;}
      host.replaceChildren(h('p',{class:'fy-muted'},'本次未能读取账户绩效。'),button('重新读取',()=>refresh(true),'quiet'));
    });
  }
  ctx.onState?.(()=>{if(!allowed()||activeBook()+'/'+sampleFor(activeBook())!==key)refresh();});
  ctx.signal?.addEventListener('abort',()=>{ticket++;key='';host.replaceChildren();},{once:true});
  return refresh();
}
