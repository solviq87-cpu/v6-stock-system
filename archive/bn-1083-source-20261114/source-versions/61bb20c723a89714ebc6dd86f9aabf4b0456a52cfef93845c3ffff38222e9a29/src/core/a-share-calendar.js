'use strict';
/**
 * A-share daily bars and snapshots are labelled by the China-market calendar day,
 * not by the server's UTC day or the machine's local timezone. China has used
 * UTC+08:00 without daylight saving for the modern market period.
 *
 * This only converts calendar dates. It DOES NOT certify exchange open days,
 * session completion, feed freshness or the validity of same-day OHLC values.
 */
const CHINA_OFFSET_MS=8*60*60*1000;
function aShareCalendarDate(instant=Date.now()){
 const time=new Date(instant).getTime();
 if(!Number.isFinite(time)||!Number.isFinite(time+CHINA_OFFSET_MS))throw RangeError('A股市场时间无效');
 const shifted=new Date(time+CHINA_OFFSET_MS);
 if(!Number.isFinite(shifted.getTime()))throw RangeError('A股市场时间超出有效范围');
 return shifted.toISOString().slice(0,10);
}
/** Calendar age is a day count in Asia/Shanghai, not a difference of
 * UTC timestamps. At 00:00 China time the UTC clock still shows yesterday. */
function aShareCalendarAgeDays(barDate,now=Date.now()){
 const today=aShareCalendarDate(now);
 if(typeof barDate!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(barDate)||
    !Number.isFinite(Date.parse(barDate+'T00:00:00Z'))||
    new Date(barDate+'T00:00:00Z').toISOString().slice(0,10)!==barDate)
  throw RangeError('K线日历日期无效');
 return (Date.parse(today+'T00:00:00Z')-Date.parse(barDate+'T00:00:00Z'))/86400000;
}
/**
 * A same-day daily K-line has not necessarily settled merely because it has a
 * valid date. Only admit it for daily-bar research if it was observed after
 * 15:10 China time, ten minutes after the regular A-share cash-market close.
 * This is an observation-time safety gate, NOT an exchange trading calendar,
 * finality confirmation or guarantee that an upstream provider is complete.
 * Historical days do not need a contemporary 15:10 observation.
 */
const SAME_DAY_DAILY_BAR_CUTOFF_MINUTES = 15*60 + 10;
function assessDailyBarFinality(barDate,{observedAt,now=Date.now()}={}){
 const today=aShareCalendarDate(now);
 if(barDate>today)return {usable:false,status:'future-date',reason:'K线日期位于未来',providerConfirmed:false};
 if(barDate<today)return {usable:true,status:'prior-market-date',reason:null,providerConfirmed:false};
 if(typeof observedAt!=='number'||!Number.isFinite(observedAt)||observedAt>new Date(now).getTime()||observedAt<=0)
  return {usable:false,status:'untrusted-observation',reason:'当日K线缺少可信采集时间',providerConfirmed:false};
 if(aShareCalendarDate(observedAt)!==today)
  return {usable:false,status:'prior-day-observation',reason:'当日K线的缓存采集时间不在对应北京时间日期',providerConfirmed:false};
 const local=new Date(observedAt+CHINA_OFFSET_MS);
 const minute=local.getUTCHours()*60+local.getUTCMinutes();
 if(minute<SAME_DAY_DAILY_BAR_CUTOFF_MINUTES)
  return {usable:false,status:'intraday-unfinished',reason:'当日K线采集于北京时间15:10之前，不能视为已完成日线',providerConfirmed:false};
 return {usable:true,status:'after-close-time-gate-not-certified',reason:null,providerConfirmed:false};
}
module.exports={aShareCalendarDate,aShareCalendarAgeDays,assessDailyBarFinality,SAME_DAY_DAILY_BAR_CUTOFF_MINUTES};
