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
module.exports={aShareCalendarDate};
