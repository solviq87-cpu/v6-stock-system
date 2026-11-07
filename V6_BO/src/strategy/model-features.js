'use strict';
const names = ['return5','return20','momentum60Skip5','volatility20','volumeRatio20','body','range','closeLocation'];
function featuresAt(bars, day) {
  if (!Array.isArray(bars) || day < 60 || day >= bars.length) return null;
  const window = bars.slice(day-60, day+1);
  if (window.some(b => !b || ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
      b.low<=0 || b.low>Math.min(b.close,b.open) || b.high<Math.max(b.close,b.open) || b.volume<0)) return null;
  const last = window[60];
  if (!last.volume || last.suspended) return null;
  const returns = window.slice(41).map((b,i) => b.close/window[40+i].close-1);
  const mean = returns.reduce((a,b)=>a+b,0)/20;
  const vol = Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/20);
  const volumeBase = window.slice(40,60).reduce((sum,b)=>sum+b.volume,0)/20;
  if (!volumeBase) return null;
  return {return5:last.close/window[55].close-1,return20:last.close/window[40].close-1,
    momentum60Skip5:window[55].close/window[0].close-1,volatility20:vol,volumeRatio20:last.volume/volumeBase,
    body:last.close/last.open-1,range:(last.high-last.low)/last.open,
    closeLocation:last.high===last.low?0:(2*last.close-last.high-last.low)/(last.high-last.low)};
}
module.exports={featuresAt,names};
