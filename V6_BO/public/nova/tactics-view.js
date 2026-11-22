import {h,section,table,format,dateTime,updateReadout} from './ui.js';
import {tactics,crossesRisingMA20,holdsMA10,overheated} from './tactics.js';
import {onResearchRead,readAutomatic,researchCode} from './automatic-research.js';

// These are descriptive close observations. Backtests use the server's point-in-time ledger.
export function dailyConditions(bars,day,asOf=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(asOf)||!(Date.parse(day+'T15:00:00+08:00')<=asOf)||!Array.isArray(bars))return [];
 const rows=bars.filter(r=>r&&r.date<=day);
 if(rows.at(-1)?.date!==day)return [];
 const tail=rows.slice(-21);
 if(tail.some((r,i)=>i&&r.date<=tail[i-1].date||r.knownAt!=null&&(!Number.isSafeInteger(r.knownAt)||r.knownAt>asOf)||
  r.closed===false||r.suspended===true||!['open','close','high','low'].every(k=>Number.isFinite(r[k])&&r[k]>0)||
  r.low>Math.min(r.open,r.close)||r.high<Math.max(r.open,r.close)))return [];
 const latest=tail.at(-1),prior=tail.at(-2),found=[];
 const mean=(a,field)=>a.reduce((total,b)=>total+b[field],0)/a.length;
 const keep=(id,hit,detail)=>found.push({id,name:tactics.find(t=>t.id===id).name,hit,detail});
 if(prior&&!latest.corporateAction){
  const base=latest.limitReferencePrice>0?latest.limitReferencePrice:prior.close;
  const gap=100*(latest.open-base)/base,amplitude=100*(latest.high-latest.low)/base;
  keep('t35',overheated(gap,amplitude),'开盘相对参考前收 '+format(gap,2)+'% · 振幅 '+format(amplitude,2)+'%');
 }
 if(tail.length>=20){
  const ma=n=>mean(tail.slice(-n),'close'),ma5=ma(5),ma10=ma(10),ma20=ma(20);
  if(tail.length>=21){
   const prev5=mean(tail.slice(-6,-1),'close'),prev20=mean(tail.slice(-21,-1),'close');
   keep('t20',crossesRisingMA20(ma5,ma20,prev5,prev20),'MA5 '+format(prev5,2)+' → '+format(ma5,2)+' · MA20 '+format(prev20,2)+' → '+format(ma20,2));
  }
  const recent=tail.slice(-6);
  if(recent.every(r=>Number.isFinite(r.volume)&&r.volume>=0)){
   const average=mean(recent.slice(0,-1),'volume');
   if(average>0){
    const ratio=latest.volume/average;
    keep('t21',holdsMA10(latest.close,latest.open,latest.low,ma5,ma10,ma20,ratio),'收盘 '+format(latest.close,2)+' · MA10 '+format(ma10,2)+' · 较前五日均量 '+format(ratio,2)+' 倍');
   }
  }
 }
 return found;
}

export function stockTactics(bars,day,asOf,provider){
 const rows=dailyConditions(bars,day,asOf);
 if(!rows.length)return document.createDocumentFragment();
 return section('日线条件实测',[day,provider].filter(Boolean).join(' · '),
  rows.map(r=>h('p',{},h('strong',{},r.name+' · '+(r.hit?'满足':'未触发')),'　'+r.detail)));
}

async function readPublicClose(ctx,symbol){
 if(!/^\d{6}$/.test(symbol))throw Error('正在读取行情标的');
 const data=await ctx.api('/api/kline?code='+symbol+'&n=30',{signal:ctx.signal,timeoutMs:45000});
 const asOf=Date.now(),provider=data?.dataQuality?.source||data?.source;
 if(data?.code!==symbol||!provider)throw Error('日线来源尚未核实');
 const bound=ctx.state?.closeSession?.day;
 const rows=(Array.isArray(data.rows)?data.rows:[]).map(r=>/^\d{8}$/.test(r?.date)?{...r,date:r.date.slice(0,4)+'-'+r.date.slice(4,6)+'-'+r.date.slice(6)}:r);
 const bars=rows.filter(r=>r&&typeof r.date==='string').filter(r=>(!bound||r.date<=bound)&&Date.parse(r.date+'T15:00:00+08:00')<=asOf);
 if(!bars.length)throw Error('正在读取收盘行情');
 return {symbol,name:data.name||ctx.findStock?.(symbol)?.name||symbol,tradeDate:bars.at(-1).date,provider,asOf,stock:{bars}};
}

export function tacticsCenter(ctx){
 const live=h('div',{'aria-live':'polite'},h('p',{class:'fy-muted'},'正在读取标的收盘记录…'));
 const details=t=>h('details',{},h('summary',{},t.name),h('p',{},'命中条件　'+t.hitRule),
  h('p',{},'失效条件　'+t.failRule),h('p',{},t.learn));
 let sequence=0,lastReceipt='';
 onResearchRead(ctx,async()=>{
  const turn=++sequence,symbol=researchCode(ctx),expected=ctx.state?.closeSession?.day;
  try{
   const x=ctx.canEdit||ctx.role==='edit'?await readAutomatic(ctx,symbol):await readPublicClose(ctx,symbol);
   if(ctx.signal?.aborted||turn!==sequence)return;
   if(x.stock?.simulated||x.stock?.retracted||!x.provider||!Number.isSafeInteger(x.asOf)||x.asOf>Date.now())throw Error('正在核对行情来源');
   const evaluations=x.research36?.evaluations||[];
   const verified=evaluations.filter(r=>r.status==='research_candidate'||r.status==='not_matched');
   const hits=verified.filter(r=>r.status==='research_candidate');
   const content=section((x.name&&x.name!==x.symbol?x.name+' ':'')+x.symbol+' · 收盘校验',x.tradeDate+' · '+x.provider+' · 取得 '+dateTime(x.stock.observedAt||x.stock.bars.at(-1).knownAt||x.asOf),
    stockTactics(x.stock.bars,x.tradeDate,x.asOf,x.provider),verified.length?h('p',{},'服务端已核对 '+verified.length+' 项策略，其中 '+hits.length+' 项命中。',
     hits.length?' '+hits.map(r=>r.name).join('、'):''):null);
   lastReceipt=[symbol,expected].join('/');updateReadout(live,content);
  }catch{
   if(turn!==sequence||ctx.signal?.aborted)return;
   if(lastReceipt!==[symbol,expected].join('/'))updateReadout(live,h('p',{class:'fy-muted'},'正在同步该标的的公开行情。'));
  }
 });
 return section('公开战法库','',live,table([{label:'战法与条件',value:details},{label:'家族',key:'family'},{label:'规则来源',key:'source'}],tactics));
}
