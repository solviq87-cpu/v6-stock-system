'use strict';

const {validTradingDate}=require('../strategy/cached-kline-adapter');
const wallTime=ms=>new Date(ms+8*3600000).toISOString().slice(0,16).replace('T',' ');

// The archive records when this instance obtained its calendar. Loading an
// old exchange schedule today cannot make that file visible to a past signal.
function calendarObservation(day,{calendar,isOpen,next,loadedAt}){
  if(!validTradingDate(day))return null;
  let nextTradingDay,source;
  if(calendar){
    if(day<calendar.metadata.from||day>calendar.metadata.to||!calendar.isOpen(day))return null;
    nextTradingDay=calendar.next(day);source=calendar.metadata.source;
  }else{
    if(!day.startsWith('2026-')||!isOpen(new Date(day+'T12:00:00')))return null;
    nextTradingDay=next(day+'T12:00:00');source='V6 内置交易所 2026 年休市安排';
    if(!nextTradingDay?.startsWith('2026-'))return null;
  }
  return nextTradingDay?{nextTradingDay,calendarSource:source,calendarKnownAt:loadedAt}:null;
}

async function attachPressure(snapshot,reader,now=Date.now){
  if(!snapshot?.day||!snapshot.stock)return snapshot;
  const live=snapshot.latestClosed===true&&snapshot.latestClosedDay===snapshot.day;
  try{
    const report=await reader({code:snapshot.code,day:snapshot.day,bars:snapshot.bars,stock:snapshot.stock,
      recentClose:live,...(live?{}:{asOf:Date.parse(snapshot.day+'T15:00:00+08:00')})});
    const received=now();
    if(report.code!==snapshot.code||report.day!==snapshot.day||!Number.isSafeInteger(report.knownAt)||report.knownAt>received)
      throw Error('压力观测时点或标的不符');
    snapshot.stock.pressure=report;
    if(live){snapshot.observedAtMs=received;snapshot.observedAt=wallTime(received);}
  }catch{
    (snapshot.missing||=[]).push('当次公告与筹码来源未完成核对');
  }
  return snapshot;
}
module.exports={calendarObservation,attachPressure};
