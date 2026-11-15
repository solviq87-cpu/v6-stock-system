'use strict';
// Display recovery is deliberately separate from S and every execution/price store.
const fs = require('node:fs');
const path = require('node:path');
const MARKET_FIELDS = ['stocksAt','idxRt','candidatePool','sectors','sectorsAt','sectorsDay','sectorsInd',
  'ztPool','ztDay','ztDayProbed','ztBySector','ztTopics','ztTopicSrc','ztNameClans','ztReasonHit','auction',
  'preselect','poolBasis','mainline','bigMoney','abMove','extLink','global','external','ztPre','ztPreBasis',
  'trendScan','trendScanBasis','steadyUp','steadyUpBasis','trendPool','trendRej','smallyang','myrules','buzhang','pre',
  'nextplan','idxDisc','ztNameClanScans','ztExcluded'];
const ARRAY_FIELDS=new Set(['candidatePool','sectors','sectorsInd','ztPool','ztTopics','ztNameClans','global','ztPre','trendScan','steadyUp','trendPool']);
const validField=(key,value)=>ARRAY_FIELDS.has(key)?Array.isArray(value):key==='stocksAt'||key==='sectorsAt'?typeof value==='number'&&Number.isFinite(value)&&value>0:key==='idxRt'?!!value&&Array.isArray(value.items):true;
const forbidden = /secret|token|password|credential|cookie|account|cash|balance|holding|webhook|private/i;
const dayOf = at => typeof at === 'number' && Number.isFinite(at) && at > 0
  ? new Date(at + 8 * 3600000).toISOString().slice(0,10).replaceAll('-','') : '';
const validDay = day => typeof day === 'string' && /^\d{8}$/.test(day) &&
  dayOf(Date.parse(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T04:00:00Z')) === day;
function safe(value, depth=0) {
  if (depth > 14 || value == null) return value == null ? null : undefined;
  if (Array.isArray(value)) return value.map(v=>safe(v,depth+1)).filter(v=>v!==undefined);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!forbidden.test(key)&&!['__proto__','constructor','prototype'].includes(key))
    .map(([key,v])=>[key,safe(v,depth+1)]).filter(([,v])=>v!==undefined));
  if (['string','boolean'].includes(typeof value)) return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function originalQuoteDay(state, now) {
  const rows = [...(Array.isArray(state.idxRt?.items)?state.idxRt.items:[]),
    ...(Array.isArray(state.candidatePool)?state.candidatePool:[]), ...(Array.isArray(state.stocks)?state.stocks:[])];
  const times = rows.map(r=>r?.quoteAt).filter(at=>typeof at==='number'&&Number.isFinite(at)&&at>0&&at<=now);
  return times.length ? dayOf(Math.max(...times)) : '';
}
function populated(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value==='object') {
    for (const key of ['items','rows','strong']) if (Array.isArray(value[key])) return value[key].length > 0;
    return Object.keys(value).length>0;
  }
  return value !== undefined && value !== null && value !== '' && value !== 0;
}
function createMarketDisplaySnapshot({file, clock=Date.now, onError=()=>{}, isSessionDay=day=>![0,6].includes(new Date(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T12:00:00Z').getUTCDay())}={}) {
  let saved = null, lastWrite=0;
  try {
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    if(data?.schemaVersion===1&&validDay(data.day)&&data.fields&&typeof data.fields==='object') {
      saved={schemaVersion:1,day:data.day,capturedAt:data.capturedAt,
        fields:Object.fromEntries(MARKET_FIELDS.filter(k=>k in data.fields&&validField(k,data.fields[k])).map(k=>[k,safe(data.fields[k])])),fieldDays:safe(data.fieldDays)||{},mood:safe(data.mood)};
    }
  } catch(error) { if(error.code!=='ENOENT')onError('market-display-snapshot-read'); }
  function select(state, {trading=false, openDay=false, mood=null}={}) {
    const now=clock(), today=dayOf(now), rawSourceDay=originalQuoteDay(state,now);
    let sourceDay='';
    try {if(rawSourceDay&&isSessionDay(rawSourceDay))sourceDay=rawSourceDay;} catch {}
    // A retained provider quote can seed an old installation, but cannot replace
    // Friday's durable snapshot with a weekend recomputation or a Sunday receipt.
    const replaceCurrent=openDay&&sourceDay===today;
    const fillClosed=saved?.day===sourceDay&&MARKET_FIELDS.some(key=>!populated(saved.fields[key])&&populated(state[key]));
    const canCapture=sourceDay && sourceDay<=today && ((!saved || saved.day<sourceDay) || replaceCurrent || fillClosed);
    if(canCapture) {
      const previous=saved?.day===sourceDay?saved.fields:{};
      const fields={...previous},fieldDays=saved?.day===sourceDay?{...saved.fieldDays}:{};
      for(const key of MARKET_FIELDS) if((replaceCurrent || !populated(fields[key])) && (populated(state[key]) || !(key in fields))) {
        if(state[key]!==undefined && validField(key,state[key])) {
          fields[key]=safe(state[key]);
          const value=state[key], rows=Array.isArray(value)?value:(value?.items||value?.strong||[]);
          fieldDays[key]=originalQuoteDay({candidatePool:rows},now)||sourceDay;
        }
      }
      const next={schemaVersion:1,day:sourceDay,capturedAt:now,fields,fieldDays,mood:(!replaceCurrent&&saved?.mood)||safe(mood)||null};
      saved=next;
      if(file && (fillClosed || now-lastWrite>=30000)) {
        try {
          fs.mkdirSync(path.dirname(file),{recursive:true});
          const temp=file+'.'+process.pid+'.tmp';
          fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,file);lastWrite=now;
        } catch {onError('market-display-snapshot-write');}
      }
    }
    if(saved && saved.day<=today) {
      // While open, only recover missing fields from the same provider day.
      // While closed, freeze all market pools; current news/accounts stay current.
      const retained=!trading || !sourceDay || sourceDay!==today;
      const fields={};
      for(const key of MARKET_FIELDS) if(key in saved.fields &&
          (retained || ((!sourceDay || sourceDay===saved.day) && !populated(state[key])))) fields[key]=safe(saved.fields[key]);
      return {state:{...state,...fields},mood:retained?safe(saved.mood):mood,
        meta:{trading,isSnapshot:retained,snapshotRetained:retained,snapshotDay:saved.day,
          snapshotCapturedAt:saved.capturedAt,snapshotFieldDays:{...saved.fieldDays},snapshotSource:'last-valid-provider-quotes',canTrade:false}};
    }
    return {state,mood,meta:{trading,isSnapshot:!trading,snapshotRetained:false,snapshotDay:sourceDay,
      snapshotCapturedAt:null,snapshotSource:sourceDay?'provider-quotes':'unavailable',canTrade:false}};
  }
  return {select};
}
module.exports={createMarketDisplaySnapshot,originalQuoteDay};
