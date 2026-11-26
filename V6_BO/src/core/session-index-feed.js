'use strict';
const {timestamp}=require('./public-market');
const {quoteObservationView}=require('./quote-observation-view');
const {requestResearchBytes}=require('./research-curl-bytes');

const symbols={sh000001:['1.000001','上证'],sz399001:['0.399001','深成'],sz399006:['0.399006','创业板'],sh000688:['1.000688','科创50']};
const codes=new Set(Object.values(symbols).map(([code])=>code));
const dayOf=at=>new Date(at+28800000).toISOString().slice(0,10).replaceAll('-','');
const positive=text=>/^\d+(?:\.\d+)?$/.test(text)&&Number(text)>0&&Number.isFinite(Number(text))?Number(text):null;

function sinaIndices(raw,receivedAt){
  const rows=[];
  for(const match of new TextDecoder('gb18030').decode(raw).matchAll(/hq_str_((?:sh|sz)\d{6})="([^"]+)"/g)){
    const identity=symbols[match[1]],fields=match[2].split(',');
    if(!identity||!/^\d{4}-\d{2}-\d{2}$/.test(fields[30])||!/^\d\d:\d\d:\d\d$/.test(fields[31]))continue;
    const price=positive(fields[3]),previous=positive(fields[2]);
    if(!price)continue;
    let quoteAt;
    try{quoteAt=timestamp((fields[30]+fields[31]).replace(/[-:]/g,''));}catch{continue;}
    rows.push({code:identity[0],name:identity[1],price,pct:previous?Math.round((price/previous-1)*10000)/100:null,
      quoteAt,receivedAt,quoteSource:'sina-index',quoteMode:'index-observation',canTrade:false,canNotify:false});
  }
  return rows;
}
async function fetchSinaIndices(){
  const url='https://hq.sinajs.cn/list='+Object.keys(symbols).join(',');
  const {raw}=await requestResearchBytes(url,{timeoutMs:4000,processTimeoutMs:5000,maxBytes:16384});
  return sinaIndices(raw,Date.now());
}

// Readers and the background clock share each supplier request. Publish each
// provider independently so a slow or failed request cannot hold up its peer.
function createSessionIndexFeed({primary,backup=fetchSinaIndices,clock=Date.now,onUpdate=()=>{}}){
  let day=null,epoch=0,lastClock=null,quotes=new Map(),books=new Map(),channels=new Map(),nextCloseCheck=0;
  const providers=['tencent-index','sina-index'];
  const validTime=at=>Number.isSafeInteger(at)&&at>0&&at<=8e15;
  function reset(nextDay){
    day=nextDay;epoch++;quotes=new Map();books=new Map();channels=new Map();nextCloseCheck=0;
  }
  function sampleClock(){
    const now=clock();
    if(!validTime(now)){reset(day);lastClock=null;return null;}
    if(lastClock!==null&&now<lastClock){reset(day);lastClock=now;return null;}
    lastClock=now;return now;
  }
  function timed(row,now,startedAt){
    return codes.has(row?.code)&&validTime(row.quoteAt)&&validTime(row.receivedAt)&&
      row.quoteAt<=row.receivedAt&&row.receivedAt>=startedAt&&row.receivedAt<=now&&dayOf(row.quoteAt)===day;
  }
  function valid(row,source,now){
    if(row.quoteSource!==source||!Number.isFinite(row.price)||row.price<=0||
      row.pct!=null&&(typeof row.pct!=='number'||!Number.isFinite(row.pct)))return false;
    const view=quoteObservationView(row,now);
    return view.quoteStatus==='recent-unverified'||view.quoteStatus==='stale';
  }
  const differs=(a,b)=>a.price!==b.price||(a.pct!=null&&b.pct!=null&&a.pct!==b.pct);
  // Across independent providers allow one display rounding unit. Intra-source
  // corrections at the same original timestamp are ambiguous, not a new tick.
  const crossDiffers=(a,b)=>Math.abs(a.price-b.price)>0.01000001||
    a.pct!=null&&b.pct!=null&&Math.abs(a.pct-b.pct)>0.01000001;
  function reconcile(asOf){
    const next=new Map();
    for(const code of codes){
      const records=providers.map(source=>books.get(source)?.get(code)).filter(Boolean);
      if(!records.length)continue;
      const newest=Math.max(...records.map(record=>record.at));
      const candidates=records.filter(record=>record.at===newest&&!record.blocked).map(record=>record.row);
      // Contradictory same-source observations suppress that route/time. A
      // separately valid peer at that time can still support an observation.
      if(!candidates.length||candidates.length===2&&crossDiffers(candidates[0],candidates[1]))continue;
      const best=candidates.find(row=>row.quoteSource==='tencent-index')||candidates[0];
      if(best)next.set(code,best);
    }
    const comparable=r=>[r?.quoteAt,r?.quoteSource,r?.price,r?.pct??null,r?.receivedAt];
    const changed=next.size!==quotes.size||[...next].some(([code,row])=>JSON.stringify(comparable(row))!==JSON.stringify(comparable(quotes.get(code))));
    quotes=next;
    if(changed)onUpdate({at:asOf,items:[...quotes.values()].map(row=>({...row}))});
  }
  function pull(source,fetchRows,interval,startedAt){
    const slot=channels.get(source);
    if(slot&&(slot.pending||startedAt<slot.nextAt))return;
    const state=slot||{status:'reading',checkedAt:null,quoteAt:null,count:0};
    channels.set(source,state);
    const forEpoch=epoch,forDay=day;
    state.nextAt=startedAt+interval;
    state.pending=Promise.resolve().then(fetchRows).then(rows=>{
      if(epoch!==forEpoch||day!==forDay)return;
      const asOf=sampleClock();
      if(asOf===null||epoch!==forEpoch||dayOf(asOf)!==forDay)return;
      if(!Array.isArray(rows))throw Error('invalid index response');
      const unique=new Map(),book=books.get(source)||new Map();
      books.set(source,book);
      for(const row of rows){
        if(!timed(row,asOf,startedAt))continue;
        const previous=unique.get(row.code),at=row.quoteAt;
        const good=valid(row,source,asOf);
        if(previous&&previous.at>at)continue;
        if(previous?.at===at){
          if(previous.blocked||!good||differs(previous.row,row))unique.set(row.code,{at,blocked:true});
          else if(previous.row.pct==null&&row.pct!=null)unique.set(row.code,{at,blocked:false,row:{...row,canTrade:false,canNotify:false,verifiedLive:false}});
          continue;
        }
        unique.set(row.code,good?{at,blocked:false,row:{...row,canTrade:false,canNotify:false,verifiedLive:false}}:{at,blocked:true});
      }
      for(const [code,next] of unique){
        const old=book.get(code);
        if(old&&old.at>next.at)continue;
        if(old?.at===next.at){
          if(old.blocked||next.blocked||differs(old.row,next.row)){book.set(code,{at:next.at,blocked:true});continue;}
          // The original observation remains; repeated retrieval does not renew it.
          continue;
        }
        book.set(code,next);
      }
      const received=[...unique].filter(([code,r])=>!r.blocked&&book.get(code)?.at===r.at&&!book.get(code)?.blocked).map(([,r])=>r.row);
      const conflicts=[...unique].filter(([code,r])=>book.get(code)?.at===r.at&&book.get(code)?.blocked).length;
      state.checkedAt=asOf;state.count=received.length;
      state.quoteAt=received.length?Math.max(...received.map(r=>r.quoteAt)):null;
      state.status=conflicts?'conflicting-observation':received.length?'observed':'no-session-quote';
      reconcile(asOf);
    }).catch(()=>{
      if(epoch!==forEpoch||day!==forDay)return;
      const asOf=sampleClock();
      if(asOf!==null&&epoch===forEpoch)Object.assign(state,{checkedAt:asOf,status:'unavailable',count:0,quoteAt:null});
    }).finally(()=>{state.pending=null;});
  }
  function read(session){
    if(day!==session.day)reset(session.day);
    const now=sampleClock();
    if(now===null||dayOf(now)!==day)return {day:session.day,indices:[],channels:[]};
    if(session.trading){
      pull('tencent-index',primary,5000,now);
      const primaryRows=books.get('tencent-index'),primaryState=channels.get('tencent-index');
      const primaryHealthy=primaryState?.status==='observed'&&primaryState.count===codes.size&&
        [...codes].every(code=>{const record=primaryRows?.get(code);return record&&!record.blocked&&now-record.at<=15000;});
      const secondary=channels.get('sina-index');
      if(!secondary||!primaryHealthy||now-(secondary.checkedAt||0)>=60000)pull('sina-index',backup,5000,now);
    }else if(session.openDay&&session.minute>=900&&session.minute<905&&now>=nextCloseCheck){
      const cutoff=Date.parse(day.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')+'T15:00:00+08:00');
      if([...quotes.values()].filter(row=>row.quoteAt>=cutoff).length<codes.size){
        nextCloseCheck=now+60000;pull('tencent-index',primary,5000,now);pull('sina-index',backup,5000,now);
      }
    }
    return {day:session.day,indices:[...quotes.values()].filter(r=>r.quoteAt<=now&&r.receivedAt<=now).map(r=>({...r,...quoteObservationView(r,now)})),
      channels:[...channels].map(([source,{status,checkedAt,quoteAt,count}])=>({source,status,checkedAt,quoteAt,count}))};
  }
  return {read};
}
module.exports={createSessionIndexFeed,sinaIndices};
