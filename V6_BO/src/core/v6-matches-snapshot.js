'use strict';
/**
 * V6 all-matches read-only projection over one *completed* quantPicksScan pass.
 * In-memory and deliberately ephemeral. Page reads never scan, publish, trade,
 * send notifications, or mutate the existing account/audit state.
 *
 * This data covers the six rules evaluated by quantPicksScan, NOT all V6 strategy
 * systems. It cannot be advertised as a complete all-strategy market universe.
 */
const crypto = require('node:crypto');
const MAX_STOCKS = 8000;
const MAX_PAGE = 100;

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function short(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function stockCode(v) {
  return typeof v === 'string' && /^\d{6}$/.test(v) ? v : '';
}
function project(item) {
  if (!item || typeof item !== 'object') return null;
  const code=stockCode(item.code);
  if (!code) return null;
  const hit=Array.isArray(item.hit) ? item.hit.slice(0,64).map(x=>{
    if (typeof x === 'string') return {id:'',text:short(x,250)};
    return { id: x?.id==null?'':short(String(x.id),32), text:short(x?.text,250) };
  }).filter(x=>x.id||x.text) : [];
  return Object.freeze({
    code,name:short(item.name,100),sector:short(item.sector,80),
    price:finite(item.price),pct:finite(item.pct),score:finite(item.score),
    quoteAt:finite(item.vendorQuoteAt??item.quoteAt??item.quoteTimestamp),
    quoteSource:short(item.quoteSource||item.source,80)||null,
    riskLevel:short(item.riskLevel,60),blocked:item.blocked===true,
    hit:Object.freeze(hit.map(x=>Object.freeze(x))),
    hitIds:Object.freeze(hit.map(x=>x.id).filter(Boolean))
  });
}
function createV6MatchesSnapshotStore(){
  let active=null;
  function publish({items,asOf,totalScanned,board,evidence={}}){
    if(board!=='all')return {ok:false,error:'only all-board snapshots are supported'};
    if(!Array.isArray(items)||items.length>MAX_STOCKS||
       !Number.isSafeInteger(asOf)||asOf<=0||
       !Number.isSafeInteger(totalScanned)||totalScanned<items.length){
      return {ok:false,error:'invalid complete scan evidence'};
    }
    const map=new Map();
    for(const raw of items){
      const item=project(raw);
      if(!item) return {ok:false,error:'invalid stock record'};
      if(map.has(item.code))return {ok:false,error:'duplicate stock code in completed scan'};
      map.set(item.code,item);
    }
    const rows=Object.freeze([...map.values()]);
    const snapshot=Object.freeze({
      id:crypto.randomBytes(12).toString('hex'),asOf,totalScanned,
      totalStocks:rows.length,
      totalSignals:rows.reduce((n,x)=>n+x.hit.length,0),
      scope:'quant-picks-six-rules',
      coverage:Object.freeze({candidateUniverse:'server-available-stocks',
        fullMarketCertified:false,allStrategyEngines:false,
        rule5:evidence.hotSectorsReady===true?'available':'not-evaluated'}),
      // A complete scan of this particular six-rule system only.
      rows
    });
    active=snapshot;
    return {ok:true,snapshotId:snapshot.id,totalStocks:rows.length,totalSignals:snapshot.totalSignals};
  }
  function page({limit=50,cursor=''}={}){
    if(!active) return {ok:false,status:'not-ready',error:'尚无已完成的量化六条件扫描快照',scope:'quant-picks-six-rules'};
    if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE)
      return {ok:false,status:'invalid-limit',error:'limit必须为1至100的整数'};
    if(typeof cursor!=='string'||cursor.length>120)
      return {ok:false,status:'invalid-cursor',error:'cursor格式错误'};
    let offset=0;
    if(cursor){
      try{
        if(!/^[A-Za-z0-9_-]{8,120}$/.test(cursor))throw Error('syntax');
        const decoded=Buffer.from(cursor,'base64url').toString('utf8');
        const m=/^([a-f0-9]{24}):([1-9]\d*)$/.exec(decoded);
        if(!m)throw Error('syntax');
        if(m[1]!==active.id)return {ok:false,status:'snapshot-changed',error:'快照已更新，请从第一页重新读取',snapshotId:active.id};
        offset=Number(m[2]);
        if(!Number.isSafeInteger(offset)||offset<1||offset>=active.rows.length)throw Error('range');
      }catch{
        return {ok:false,status:'invalid-cursor',error:'cursor格式或偏移无效'};
      }
    }
    const end=Math.min(active.rows.length,offset+limit);
    const hasMore=end<active.rows.length;
    const nextCursor=hasMore?Buffer.from(active.id+':'+end).toString('base64url'):null;
    return {
      ok:true,source:'quant-picks-scan',scope:active.scope,
      completeForScope:true,liveCertified:false,
      coverage:active.coverage,
      snapshotId:active.id,asOf:active.asOf,totalScanned:active.totalScanned,
      totalStocks:active.totalStocks,totalSignals:active.totalSignals,
      offset,limit,items:active.rows.slice(offset,end),hasMore,nextCursor
    };
  }
  return {publish,page};
}
module.exports={createV6MatchesSnapshotStore,MAX_STOCKS,MAX_PAGE};
