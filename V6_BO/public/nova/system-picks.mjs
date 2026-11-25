// Shared by the V6 pool scanner and both dashboard entry points.
export function eligiblePick(row) {
  return !!row && /^\d{6}$/.test(row.code) && !/(?:^|\*)ST|退市/i.test(row.name || '') &&
    !['excluded','blocked','bad','riskBlocked','riskWarning','isST','halt','suspended','synthetic','simulated','fixture','mock','blacklisted','buyHeld','heldRecord'].some(key => row[key] === true) &&
    !row.heldRecord && row.canOpen !== false && row.currentSourceConfirmed !== false &&
    row.cap !== '空仓' && row.decisionReview?.action !== 'sell';
}

export function pickReasons(row) {
  const values = [row.hit, row.signals || row.paths, row.explanation || row.pathWhy, row.reasons, row.why]
    .flatMap(value => Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);
  return [...new Set(values.map(value => typeof value === 'string' ? value : value?.text || value?.label || value?.id)
    .filter(value => typeof value === 'string' && value.trim()))];
}

export function topSystemPicks(rows) {
  const sorted = rows.filter(eligiblePick).slice().sort((a,b) =>
    (Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity) ||
    a.code.localeCompare(b.code));
  const byCode = new Map();
  for (const row of sorted) {
    if (!byCode.has(row.code)) byCode.set(row.code,row);
    if (byCode.size === 3) break;
  }
  return [...byCode.values()];
}

export function systemPickDay(row, fallback, now=Date.now()){
  const normalize=value=>{
    if(typeof value!=='string')return null;
    const d=value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
    const ms=Date.parse(d+'T00:00:00Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(ms)&&new Date(ms).toISOString().startsWith(d)?d:null;
  };
  const stamp=row.vendorQuoteAt??row.quoteAt??row.quoteTimestamp;
  if(stamp!=null&&(!Number.isSafeInteger(stamp)||stamp<=0||stamp>now))return null;
  const dates=[row.poolDay,row.sourceTradeDate,row.tradeDate].filter(value=>value!=null&&value!=='').map(normalize);
  if(stamp!=null)dates.push(new Date(stamp+28800000).toISOString().slice(0,10));
  return dates.length?(dates.every(day=>day&&day===dates[0])?dates[0]:null):normalize(fallback);
}
