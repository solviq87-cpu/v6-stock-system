'use strict';
// Read-only extension of the original event outcome archive. The fixed
// pre-publication window is a descriptive placebo, not a registered trial.
const {createHash}=require('node:crypto');
const ESTIMATION=20,HORIZONS=new Set([1,5,20,60]);
const time=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dayOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const close=d=>Date.parse(d+'T15:00:00+08:00');
const open=d=>Date.parse(d+'T09:30:00+08:00');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const gross=(a,b)=>100*(b/a-1);
function preEventComparison({event,dates,horizon,stockSource,indexSource,calendarKnownAt,calendarHash,readStock,readIndex}={}){
 const base={mode:'fixed-pre-publication-placebo-v1',status:'unknown',reason:null,estimationSessions:ESTIMATION,horizonSessions:HORIZONS.has(horizon)?horizon:null,
  cutoff:null,stockSource:stockSource??null,indexSource:indexSource??null,calendarHash:null,estimationDates:[],placeboDates:[],evidenceHash:null,
  dailyGrossExcessMeanPct:null,placeboStockReturnPct:null,placeboMarketReturnPct:null,placeboGrossExcessPct:null,
  matchedIndustry:null,netAbnormalReturnPct:null,confidenceInterval:null,preregistered:false,causalInferenceVerified:false,canTrade:false,canNotify:false};
 const unknown=(reason,extra={})=>({...base,...extra,reason});
 if(!event||typeof event.symbol!=='string'||!/^\d{6}$/.test(event.symbol)||![event.publishedAt,event.firstKnownAt,event.recordedAt].every(time)||event.publishedAt>event.firstKnownAt||event.firstKnownAt>event.recordedAt||!HORIZONS.has(horizon))return unknown('invalid-event-clock-or-horizon');
 const cutoff=event.publishedAt,ctx={cutoff};
 if(!time(calendarKnownAt)||calendarKnownAt>=cutoff||typeof calendarHash!=='string'||!/^[a-f0-9]{64}$/.test(calendarHash)||!Array.isArray(dates)||dates.length>10000||!dates.every((d,i)=>dayOK(d)&&(!i||d>dates[i-1])))return unknown('pre-event-calendar-unavailable',ctx);
 ctx.calendarHash=calendarHash;
 if(typeof stockSource!=='string'||!stockSource||typeof indexSource!=='string'||!indexSource||typeof readStock!=='function'||typeof readIndex!=='function')return unknown('same-source-market-comparison-unavailable',ctx);
 const required=Math.max(ESTIMATION,horizon),prior=dates.filter(d=>close(d)<cutoff).slice(-required);
 if(prior.length!==required)return unknown('pre-event-window-insufficient',ctx);
 const pairs=[];
 for(const date of prior){
  const stock=readStock(date),index=readIndex(date);
  const priceOK=x=>x&&finite(x.open)&&x.open>0&&finite(x.close)&&x.close>0;
  if(!priceOK(stock)||!priceOK(index)||stock.date!==date||index.date!==date||stock.code!==event.symbol||stock.source!==stockSource||index.source!==indexSource||stock.priceBasis!=='unadjusted'||stock.corporateAction!==false||
     !time(stock.knownAt)||stock.knownAt<close(date)||stock.knownAt>=cutoff||
     !time(stock.corporateActionKnownAt===undefined?stock.knownAt:stock.corporateActionKnownAt)||(stock.corporateActionKnownAt===undefined?stock.knownAt:stock.corporateActionKnownAt)>=cutoff||
     !time(index.knownAt)||!time(index.receivedAt)||index.knownAt<close(date)||index.knownAt>index.receivedAt||index.receivedAt>=cutoff)return unknown('pre-event-price-or-availability-missing',ctx);
  const dailyExcess=gross(stock.open,stock.close)-gross(index.open,index.close);
  if(!finite(dailyExcess))return unknown('pre-event-return-invalid',ctx);
  pairs.push({date,stock:{open:stock.open,close:stock.close,knownAt:stock.knownAt,corporateActionKnownAt:stock.corporateActionKnownAt===undefined?stock.knownAt:stock.corporateActionKnownAt},index:{open:index.open,close:index.close,knownAt:index.knownAt,receivedAt:index.receivedAt},dailyExcess});
 }
 const estimation=pairs.slice(-ESTIMATION),placebo=pairs.slice(-horizon),a=placebo[0],b=placebo.at(-1),stockReturn=gross(a.stock.open,b.stock.close),indexReturn=gross(a.index.open,b.index.close),mean=estimation.reduce((n,r)=>n+r.dailyExcess/ESTIMATION,0);
 if(![stockReturn,indexReturn,mean,stockReturn-indexReturn].every(finite))return unknown('pre-event-return-invalid',ctx);
 return {...base,...ctx,status:'descriptive-unverified',estimationDates:estimation.map(r=>r.date),placeboDates:placebo.map(r=>r.date),placeboStartAt:open(a.date),placeboEndAt:close(b.date),
  evidenceHash:hash([event.symbol,cutoff,stockSource,indexSource,calendarHash,pairs]),dailyGrossExcessMeanPct:mean,placeboStockReturnPct:stockReturn,placeboMarketReturnPct:indexReturn,placeboGrossExcessPct:stockReturn-indexReturn};
}
module.exports={preEventComparison};

// F05.6: long-horizon price context stays separate from the short event path.
// No inference of a bull/bear market or change of production weights.
function eventRegimeOverlay({event,dates,indexSource,calendarKnownAt,calendarHash,readIndex,asOf}={}){
 const out={mode:'pre-event-60-session-index-context-v1',status:'unknown',reason:null,indexSource:indexSource??null,calendarHash:null,
  longContext:{status:'unknown',direction:null,sessions:60,returnPct:null,firstDate:null,lastDate:null,referenceHash:null},
  shortReaction:{status:'unknown',firstDate:null,secondDate:null,dayOneReturnPct:null,twoDayReturnPct:null,phase:null},
  causalInferenceVerified:false,productionRegimeChanged:false,canTrade:false,canNotify:false};
 if(!event||![event.publishedAt,event.firstKnownAt,event.recordedAt,asOf].every(time)||event.publishedAt>event.firstKnownAt||event.firstKnownAt>event.recordedAt||event.recordedAt>asOf||
    !time(calendarKnownAt)||calendarKnownAt>=event.publishedAt||typeof calendarHash!=='string'||!/^[a-f0-9]{64}$/.test(calendarHash)||!Array.isArray(dates)||dates.length>10000||!dates.every((d,i)=>dayOK(d)&&(!i||d>dates[i-1]))||typeof indexSource!=='string'||!indexSource||typeof readIndex!=='function')return {...out,reason:'event-calendar-or-index-source-unavailable'};
 out.calendarHash=calendarHash;
 const valid=(b,d,cutoff,strict)=>b&&b.date===d&&b.source===indexSource&&finite(b.open)&&b.open>0&&finite(b.close)&&b.close>0&&time(b.knownAt)&&time(b.receivedAt)&&b.knownAt>=close(d)&&b.knownAt<=b.receivedAt&&(strict?b.receivedAt<cutoff:b.receivedAt<=cutoff);
 const prior=dates.filter(d=>close(d)<event.publishedAt).slice(-60),rows=prior.map(readIndex);
 if(prior.length===60&&rows.every((b,i)=>valid(b,prior[i],event.publishedAt,true))){
  const first=rows[0],last=rows.at(-1),ret=gross(first.open,last.close),avg=rows.reduce((s,r)=>s+r.close/60,0);
  if(finite(ret)&&finite(avg)&&avg>0){out.longContext={status:'observed-unverified',direction:ret>0&&last.close>avg?'upward-price-context':ret<0&&last.close<avg?'downward-price-context':'mixed-price-context',sessions:60,returnPct:ret,firstDate:prior[0],lastDate:prior.at(-1),referenceHash:hash([indexSource,calendarHash,rows])};}
 }
 const start=dates.findIndex(d=>open(d)>event.recordedAt),firstDate=start>=0?dates[start]:null,secondDate=start>=0?dates[start+1]??null:null;
 if(firstDate&&close(firstDate)<=asOf){
  const first=readIndex(firstDate);
  if(valid(first,firstDate,asOf,false)){
   const dayOne=gross(first.open,first.close);if(finite(dayOne)){
    out.shortReaction={...out.shortReaction,status:'first-session-observed',firstDate,secondDate,dayOneReturnPct:dayOne};
    if(secondDate&&close(secondDate)<=asOf){const second=readIndex(secondDate);if(valid(second,secondDate,asOf,false)){
     const twoDay=gross(first.open,second.close);
     if(finite(twoDay))out.shortReaction={...out.shortReaction,status:'two-sessions-observed',twoDayReturnPct:twoDay,phase:dayOne>0&&twoDay<=0?'first-day-rise-faded':dayOne<0&&twoDay>=0?'first-day-fall-faded':dayOne===0?'no-first-day-direction':Math.abs(twoDay)<Math.abs(dayOne)?'weakened':'continued'};
    }}
   }
  }
 }
 out.status=out.longContext.status==='observed-unverified'&&out.shortReaction.status!=='unknown'?'observed-unverified':'partial-or-unknown';
 return out;
}
module.exports.eventRegimeOverlay=eventRegimeOverlay;
