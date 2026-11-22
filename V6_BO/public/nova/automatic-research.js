import {selectResearchPicks,closeSessionDay,rowsFrom} from './market.js';

const requests=new WeakMap();
export function researchCode(ctx){
 if(/^\d{6}$/.test(ctx.stock||''))return ctx.stock;
 const state=ctx.state||{};
 return selectResearchPicks(state).items[0]?.code||rowsFrom(state.dashboard?.rows||state.pool)[0]?.code||'';
}
export function readAutomatic(ctx,symbol=researchCode(ctx)){
 const scope=ctx.signal||ctx;
 const cache=requests.get(scope)||new Map();requests.set(scope,cache);
 const key=(closeSessionDay(ctx.state)||'live')+'/'+symbol,prior=cache.get(key);
 if(prior&&prior.until>Date.now())return prior.job;
 const job=ctx.api('/api/research/automatic-evidence'+(symbol?'?symbol='+encodeURIComponent(symbol):''),{signal:ctx.signal,timeoutMs:55000})
  .then(data=>{
   const x=data?.result;
   if(!x?.stock?.bars?.length||symbol&&x.symbol!==symbol)throw Error('此标的的行情正在同步');
   return x;
  }).catch(e=>{if(cache.get(key)?.job===job)cache.delete(key);throw e;});
 cache.set(key,{job,until:Date.now()+60000});return job;
}
export function automaticSummary(x){
 return {symbol:x.symbol,name:x.name,tradeDate:x.tradeDate,provider:x.provider,status:x.name+' '+x.symbol+' · '+x.tradeDate,
  note:'已读取 '+x.stock.bars.length+' 根日线 · '+x.source,observations:x.observations,...(x.publicReview?{publicReview:x.publicReview}:{})};
}
// The shell already manages market hours, visibility, reconnect and route cancellation.
export function onResearchRead(ctx,run){
 let last='',at=0;
 const read=(_state,meta={})=>{
  if(ctx.signal?.aborted||globalThis.document?.hidden||globalThis.navigator?.onLine===false)return;
  const state=ctx.state||{},day=closeSessionDay(state),key=[day||'live',researchCode(ctx),state.marketRecovery?.closeWatch?.knownAt||'',state.dabanke?.revision||''].join('/');
  if(key===last&&!meta.manual&&Date.now()-at<(day||state.marketClock?.trading===false?300000:60000))return;
  last=key;at=Date.now();run();
 };
 queueMicrotask(read);ctx.onState?.(read);
 if(ctx.signal)globalThis.addEventListener?.('online',()=>read(null,{manual:true}),{signal:ctx.signal});
}
