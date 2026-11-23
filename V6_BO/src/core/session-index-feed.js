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
  let day=null,quotes=new Map(),channels=new Map();
  function valid(row,now){
    return codes.has(row?.code)&&Number.isFinite(row.price)&&row.price>0&&
      Number.isSafeInteger(row.quoteAt)&&row.quoteAt>0&&row.quoteAt<=row.receivedAt&&
      Number.isSafeInteger(row.receivedAt)&&row.receivedAt<=now&&dayOf(row.quoteAt)===day;
  }
  function pull(source,fetchRows,interval){
    const now=clock(),slot=channels.get(source);
    if(slot&&(slot.pending||now<slot.nextAt))return;
    const state=slot||{status:'reading',checkedAt:null,quoteAt:null,count:0};
    channels.set(source,state);
    const forDay=day;
    state.nextAt=now+interval;
    state.pending=Promise.resolve().then(fetchRows).then(rows=>{
      if(day!==forDay)return;
      const asOf=clock(),unique=new Map();
      for(const row of rows||[])if(row.quoteSource===source&&valid(row,asOf)&&(!unique.has(row.code)||row.quoteAt>unique.get(row.code).quoteAt))unique.set(row.code,row);
      const received=[...unique.values()];
      state.checkedAt=asOf;state.count=received.length;
      state.quoteAt=received.length?Math.max(...received.map(r=>r.quoteAt)):null;
      state.status=received.length?'observed':'no-session-quote';
      let changed=false;
      for(const row of received){
        const old=quotes.get(row.code);
        if(!old||old.quoteAt<row.quoteAt||old.quoteAt===row.quoteAt&&source==='tencent-index'&&old.quoteSource!==source){
          quotes.set(row.code,{...row,canTrade:false,canNotify:false});changed=true;
        }
      }
      if(changed)onUpdate({at:asOf,items:[...quotes.values()]});
    }).catch(()=>{
      if(day===forDay)Object.assign(state,{checkedAt:clock(),status:'unavailable',count:0,quoteAt:null});
    }).finally(()=>{state.pending=null;});
  }
  function read(session){
    if(day!==session.day){day=session.day;quotes=new Map();channels=new Map();}
    const now=clock();
    if(session.trading){
      pull('tencent-index',primary,5000);
      const primaryHealthy=channels.get('tencent-index')?.count===codes.size&&
        [...quotes.values()].filter(r=>now-r.quoteAt<=15000).length===codes.size;
      const secondary=channels.get('sina-index');
      // Healthy primary: check the fallback once a minute. On degradation it
      // may be retried at the normal quote cadence, subject to supplier limits.
      if(!secondary||!primaryHealthy||now-(secondary.checkedAt||0)>=60000)pull('sina-index',backup,5000);
    }
    return {day:session.day,indices:[...quotes.values()].map(r=>({...r,...quoteObservationView(r,now)})),
      channels:[...channels].map(([source,{status,checkedAt,quoteAt,count}])=>({source,status,checkedAt,quoteAt,count}))};
  }
  return {read};
}
module.exports={createSessionIndexFeed,sinaIndices};
