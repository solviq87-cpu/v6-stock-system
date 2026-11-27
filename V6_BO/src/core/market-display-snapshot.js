'use strict';
// Display recovery is deliberately separate from S and every execution/price store.
const fs = require('node:fs');
const path = require('node:path');
const MARKET_FIELDS = ['stocksAt','idxRt','candidatePool','sectors','sectorsAt','sectorsDay','sectorsInd',
  'ztPool','ztReviewPool','ztReviewPoolMeta','ztDay','ztDayProbed','ztBySector','ztTopics','ztTopicSrc','ztNameClans','ztReasonHit','auction',
  'preselect','poolBasis','mainline','bigMoney','abMove','extLink','global','external','ztPre','ztPreBasis',
  'trendScan','trendScanBasis','steadyUp','steadyUpBasis','trendPool','trendRej','smallyang','myrules','buzhang','pre',
  'nextplan','idxDisc','ztNameClanScans','ztExcluded'];
const ARRAY_FIELDS=new Set(['candidatePool','sectors','sectorsInd','ztPool','ztReviewPool','ztTopics','ztNameClans','global','ztPre','trendScan','steadyUp','trendPool']);
const dense=value=>Array.isArray(value)&&Array.from(value,(v,i)=>Object.hasOwn(value,i)).every(Boolean);
const validField=(key,value)=>ARRAY_FIELDS.has(key)?dense(value):key==='stocksAt'||key==='sectorsAt'?typeof value==='number'&&Number.isFinite(value)&&value>0:key==='idxRt'?!!value&&dense(value.items):true;
const forbidden = /secret|token|password|credential|cookie|account|cash|balance|holding|webhook|private/i;
const denied=new Set(['canTrade','canNotify','verifiedLive','certifiedLive','canExecute','canTrain','autoPromotion']);
const {quoteSnapshotFields}=require('./quote-observation-view');
const validTime=at=>Number.isSafeInteger(at)&&at>0&&at<=8e15;
const dayOf = at => validTime(at)
  ? new Date(at + 8 * 3600000).toISOString().slice(0,10).replaceAll('-','') : '';
const validDay = day => typeof day === 'string' && /^\d{8}$/.test(day) &&
  dayOf(Date.parse(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T04:00:00Z')) === day;
function normalizedDay(v){
 const raw=typeof v==='string'?v:Number.isSafeInteger(v)&&v>=10000000&&v<=99999999?String(v):'';
 const day=/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw.replaceAll('-',''):raw;
 return validDay(day)?day:null;
}
function invalidIdentity(row){
 if(!row||typeof row!=='object')return true;
 return ['sourceConflict','conflict','simulated','synthetic','fixture','mock','testSample','imported'].some(k=>row[k]===true)||
  row.evidenceStatus==='conflict'||row.quoteStatus==='conflict'||
  [row.quoteMode,row.mode].some(mode=>typeof mode==='string'&&/simulat|fixture|mock|synthetic|test-sample|imported/i.test(mode))||
  quoteSnapshotFields(row).sourceConflict===true||
  row.quoteAt!=null&&row.vendorQuoteAt!=null&&row.quoteAt!==row.vendorQuoteAt||
  row.tradeDate!=null&&normalizedDay(row.tradeDate)===null;
}
function malformedClocks(row){
 return ['quoteAt','vendorQuoteAt','receivedAt'].some(key=>row[key]!=null&&!validTime(row[key]));
}
function safe(value, depth=0) {
  if (depth > 14 || value == null) return value == null ? null : undefined;
  if (Array.isArray(value)) return value.map(v=>safe(v,depth+1)).filter(v=>v!==undefined);
  if (typeof value === 'object') {
    const out=Object.fromEntries(Object.entries(value)
      .filter(([key])=>!forbidden.test(key)&&!['__proto__','constructor','prototype'].includes(key))
      .map(([key,v])=>[key,denied.has(key)?false:safe(v,depth+1)]).filter(([,v])=>v!==undefined));
    // Preserve invalid clock/identity evidence before JSON sanitation can turn
    // NaN or Infinity into a missing legacy field at the next process start.
    if((Object.hasOwn(value,'quoteAt')||Object.hasOwn(value,'vendorQuoteAt'))&&
       (invalidIdentity(value)||malformedClocks(value)))out.sourceConflict=true;
    return out;
  }
  if (['string','boolean'].includes(typeof value)) return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
// Explicit negative provenance cannot establish a new original quote day.
 // Legacy display-only rows may lack a receipt, but a declared receipt must
 // agree with the original quote and capture cutoff.
function originalTime(row,now){
 if(!row||!validTime(now)||!validTime(row.quoteAt)||row.quoteAt>now||
    row.receivedAt!=null&&(!validTime(row.receivedAt)||row.receivedAt<row.quoteAt||row.receivedAt>now)||
    invalidIdentity(row)||malformedClocks(row)||
    row.tradeDate!=null&&normalizedDay(row.tradeDate)!==dayOf(row.quoteAt))return null;
 return row.quoteAt;
}
function originalQuoteDay(state, now) {
  const rows = [...(Array.isArray(state.idxRt?.items)?state.idxRt.items:[]),
    ...(Array.isArray(state.candidatePool)?state.candidatePool:[]), ...(Array.isArray(state.stocks)?state.stocks:[])];
  let latest=null;
  for(const row of rows){const at=originalTime(row,now);if(at!==null&&(latest===null||at>latest))latest=at;}
  return latest===null?'':dayOf(latest);
}
function populated(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value==='object') {
    for (const key of ['items','rows','strong']) if (Array.isArray(value[key])) return value[key].length > 0;
    return Object.keys(value).length>0;
  }
  return value !== undefined && value !== null && value !== '' && value !== 0;
}
function marketFieldDay(key,state,now) {
  const value=state[key];
  const declared=key==='sectors'||key==='sectorsInd'?state.sectorsDay:
    key==='ztPool'?state.ztDay:key==='ztReviewPool'?state.ztReviewPoolMeta?.tradeDate:null;
  const rows=Array.isArray(value)?value:value?.items||value?.rows||value?.strong;
  if(declared){
    const day=normalizedDay(declared);
    if(!day||day>dayOf(now))return null;
    // A declared field day is not authority to override contradictory raw dates.
    if(Array.isArray(rows)&&(!dense(rows)||rows.some(row=>{
      if(!row||typeof row!=='object'||invalidIdentity(row)||malformedClocks(row))return true;
      if(row.tradeDate!=null&&normalizedDay(row.tradeDate)!==day)return true;
      const at=row.vendorQuoteAt??row.quoteAt;
      return at!=null&&(originalTime({...row,quoteAt:at},now)===null||dayOf(at)!==day);
    })))return null;
    return day;
  }
  if(!dense(rows)||!rows.length)return null;
  const days=new Set(rows.map(row=>{
    const at=row?.vendorQuoteAt??row?.quoteAt;
    return !invalidIdentity(row)&&!malformedClocks(row)&&originalTime({...row,quoteAt:at},now)!==null?dayOf(at):null;
  }));
  return days.size===1?[...days][0]:null;
}
function createMarketDisplaySnapshot({file, clock=Date.now, onError=()=>{}, isSessionDay=day=>![0,6].includes(new Date(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T12:00:00Z').getUTCDay())}={}) {
  let saved = null, lastWrite=0, dirty=false,lastClock=null;
  function sample(){
    let at;try{at=clock();}catch{return null;}
    if(!validTime(at)||lastClock!==null&&at<lastClock)return null;
    lastClock=at;return at;
  }
  try {
    if(file){
    const now=sample();
    if(now===null)throw Error('snapshot clock');
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error('snapshot file');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
    let data;
    try{
      const opened=fs.fstatSync(fd);
      if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size>16*1024*1024)throw Error('snapshot identity');
      const raw=fs.readFileSync(fd);
      if(raw.length!==opened.size||raw.length>16*1024*1024)throw Error('snapshot size');
      const text=raw.toString('utf8');if(!Buffer.from(text,'utf8').equals(raw))throw Error('snapshot encoding');
      data=JSON.parse(text);
    }finally{fs.closeSync(fd);}
    if(data?.schemaVersion!==1||!validDay(data.day)||!validTime(data.capturedAt)||data.capturedAt>now||
       data.day>dayOf(data.capturedAt)||!isSessionDay(data.day)||!data.fields||typeof data.fields!=='object'||Array.isArray(data.fields))
      throw Error('snapshot schema or original capture time');
    {
      const fields=Object.fromEntries(MARKET_FIELDS.filter(k=>k in data.fields&&validField(k,data.fields[k])).map(k=>[k,safe(data.fields[k])]));
      saved={schemaVersion:1,day:data.day,capturedAt:data.capturedAt,fields,
        fieldDays:Object.fromEntries(Object.keys(fields).map(key=>[key,marketFieldDay(key,fields,data.capturedAt)])),mood:safe(data.mood)};
    }
    }
  } catch(error) { if(error.code!=='ENOENT')onError('market-display-snapshot-read'); }
  function select(state, {trading=false, openDay=false, mood=null}={}) {
    const now=sample();
    if(now===null)return {state,mood,meta:{trading:false,isSnapshot:true,snapshotRetained:false,snapshotDay:'',
      snapshotCapturedAt:null,snapshotSource:'unavailable',clockInvalid:true,canTrade:false}};
    const today=dayOf(now),rawSourceDay=originalQuoteDay(state,now);
    let sourceDay='';
    try {if(rawSourceDay&&isSessionDay(rawSourceDay))sourceDay=rawSourceDay;} catch {}
    // A retained provider quote can seed an old installation, but cannot replace
    // Friday's durable snapshot with a weekend recomputation or a Sunday receipt.
    const liveWindow=require('./closing-card-snapshot').beforeClose(now);
    const replaceCurrent=openDay&&liveWindow&&sourceDay===today&&(!saved||saved.day<=sourceDay);
    const fillClosed=saved?.day===sourceDay&&MARKET_FIELDS.some(key=>!populated(saved.fields[key])&&populated(state[key]));
    const canCapture=sourceDay && sourceDay<=today && ((!saved || saved.day<sourceDay&&replaceCurrent) || replaceCurrent || fillClosed&&!openDay);
    if(canCapture) {
      const previous=saved?.day===sourceDay?saved.fields:{};
      const fields={...previous},fieldDays=saved?.day===sourceDay?{...saved.fieldDays}:{};
      for(const key of MARKET_FIELDS) if((replaceCurrent || !populated(fields[key])) && (populated(state[key]) || !(key in fields))) {
        if(state[key]!==undefined && validField(key,state[key])) {
          fields[key]=safe(state[key]);
          fieldDays[key]=marketFieldDay(key,state,now);
        }
      }
      const next={schemaVersion:1,day:sourceDay,capturedAt:now,fields,fieldDays,mood:(!replaceCurrent&&saved?.mood)||safe(mood)||null};
      saved=next;dirty=true;
    }
    // A failed/throttled write still needs to be retried after the market closes,
    // when another capture may never be admitted for this original quote day.
    if(file && dirty && (!liveWindow || fillClosed || now-lastWrite>=30000)) {
      const temp=file+'.'+require('node:crypto').randomBytes(12).toString('hex')+'.tmp';let fd,owned=false;
      try {
        const raw=JSON.stringify(saved);
        if(Buffer.byteLength(raw)>16*1024*1024)throw Error('snapshot capacity');
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fd=fs.openSync(temp,'wx',0o600);owned=true;
        fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        // Recheck the common clock immediately before replacing the durable file.
        if(sample()===null)throw Error('snapshot clock');
        fs.renameSync(temp,file);owned=false;
        lastWrite=now;dirty=false;
      } catch {onError('market-display-snapshot-write');}
      finally {if(fd!==undefined)try{fs.closeSync(fd);}catch{}if(owned)try{fs.unlinkSync(temp);}catch{}}
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
          snapshotCapturedAt:saved.capturedAt,snapshotFieldDays:{...saved.fieldDays},snapshotSource:'last-valid-provider-quotes',marketFrozen:retained,canTrade:false}};
    }
    return {state,mood,meta:{trading,isSnapshot:!trading,snapshotRetained:false,snapshotDay:sourceDay,
      snapshotCapturedAt:null,snapshotSource:sourceDay?'provider-quotes':'unavailable',canTrade:false}};
  }
  return {select};
}
module.exports={createMarketDisplaySnapshot,originalQuoteDay,marketFieldDay};
