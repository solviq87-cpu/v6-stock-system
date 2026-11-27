// Shared market disclosure: research states only, not trade or safety signals.
const phases=Object.freeze({started:'首次异动',strengthening:'异动强化',weakening:'异动减弱',steady:'异动幅度持平',
 reversed:'异动方向反转','below-historical-range':'回到历史变动范围'});
const codes=new Set(['1.000001','0.399001','0.399006','1.000688']);
const sources=new Set(['tencent-index','sina-index']);
export function indexContinuityRows(value,asOf){
 if(!Array.isArray(value)||!Number.isSafeInteger(asOf)||asOf<=0)return [];
 return value.filter(e=>e?.method==='adjacent-qualified-index-window-v1'&&codes.has(e.code)&&sources.has(e.source)&&
  [1,5,15].includes(e.windowMinutes)&&Object.hasOwn(phases,e.phase)&&
  (e.phase==='below-historical-range'?e.status==='ended':e.status==='abnormal')&&
  ['up','down'].includes(e.direction)&&Number.isSafeInteger(e.revision)&&e.revision>0&&
  Number.isSafeInteger(e.quoteAt)&&e.quoteAt>0&&Number.isSafeInteger(e.detectedAt)&&e.quoteAt<=e.detectedAt&&e.detectedAt<=asOf&&
  e.validUntil===(Math.floor(e.quoteAt/60000)+1)*60000&&asOf<e.validUntil&&
  Number.isFinite(e.returnPct)&&Number.isFinite(e.historicalMaxAbsPct)&&e.historicalMaxAbsPct>=0&&
  (e.status==='abnormal'?Math.abs(e.returnPct)>e.historicalMaxAbsPct:Math.abs(e.returnPct)<=e.historicalMaxAbsPct)&&
  e.referenceDays===20&&e.attribution==='unknown'&&e.canTrade===false&&e.canNotify===false)
 .slice(0,12).map(e=>({code:e.code,source:e.source,windowMinutes:e.windowMinutes,quoteAt:e.quoteAt,
  returnPct:e.returnPct,revision:e.revision,label:phases[e.phase],direction:e.direction==='up'?'上涨':'下跌',
  note:e.status==='ended'?'仅该研究窗口回落，不代表风险解除':'原因待核，仅研究观察'}));
}

export function indexHistoryDisclosure(value){
 if(value?.mode!=='sealed-index-minute-history-v1'||value.currentSession!=='fresh-observation-required'||value.canTrade!==false||value.canNotify!==false||value.sourceVerified!==false||value.canTrain!==false||
   !Number.isSafeInteger(value.daysLoaded)||value.daysLoaded<0||value.daysLoaded>21||
   !Number.isSafeInteger(value.archivedDays)||value.archivedDays<0||value.archivedDays>16384||value.archivedDays<value.daysLoaded)return '';
 const notes={restored:'已恢复 '+value.daysLoaded+' 日已封存的分钟研究样本',saved:'已封存交易日研究样本',empty:'尚无可恢复的分钟研究样本',unavailable:'分钟研究档案不可用，基准需重新积累','clock-reset':'研究时钟变化，已清空本次基准'};
 return Object.hasOwn(notes,value.status)?notes[value.status]+'；本交易日重新采样，不恢复旧报价或旧异动结论。':'';
}
