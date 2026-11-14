'use strict';
/** Raw A-share daily turnover arithmetic; NOT licensed/exchange-grade verification.
 * Turnover (CNY)/volume (shares) is not comparable with adjusted OHLC prices.
 * The 100 bps band tolerates minor vendor precision/venue coverage differences.
 * Mismatches are evidence to quarantine, NEVER a basis to synthesize data.
 */
const TOLERANCE_BPS=100;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function assessDailyTurnoverBar(bar){
 if(!bar||!finite(bar.low)||!finite(bar.high)||bar.low<=0||
    bar.high<bar.low||!Number.isSafeInteger(bar.volume)||bar.volume<0||
    !finite(bar.amount)||bar.amount<0)
  return {status:'invalid-values',vwap:null,deviationBps:null};
 if(bar.volume===0&&bar.amount===0)
  return {status:'no-trades',vwap:null,deviationBps:0};
 if(bar.volume===0||bar.amount===0)
  return {status:'inconsistent-zero',vwap:null,deviationBps:null};
 const vwap=bar.amount/bar.volume;
 const lower=bar.low*(1-TOLERANCE_BPS/10000);
 const upper=bar.high*(1+TOLERANCE_BPS/10000);
 if(!finite(vwap)||vwap<=0||!finite(lower)||!finite(upper))
  return {status:'invalid-values',vwap:null,deviationBps:null};
 const outside=vwap<lower?(lower-vwap)/lower:vwap>upper?(vwap-upper)/upper:0;
 return {status:outside>0?'outside-range':'in-range',vwap,
  deviationBps:Math.min(1e9,Math.max(0,outside*10000))};
}
module.exports={TOLERANCE_BPS,assessDailyTurnoverBar};
