'use strict';
/** Evidence-oriented A-share historical data audit.
 * Never infer suspension, price adjustment or corporate actions from a flat price series.
 * Flags are research review items, not proof the external feed was validated. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const round=n=>Math.round(n*10000)/10000;
function auditMarketData(history,{maxStalenessDays=5}={}){
 const valid=validateDataset(history);
 if(!Number.isSafeInteger(maxStalenessDays)||maxStalenessDays<0||maxStalenessDays>365)throw Error('行情陈旧阈值无效');
 const issues=[],bySymbol=[],ref=Date.parse(history.asOf+'T00:00:00Z');
 const dated=Boolean(valid.lastDate);
 const age=dated?Math.floor((ref-Date.parse(valid.lastDate+'T00:00:00Z'))/86400000):null;
 if(age!==null&&age>maxStalenessDays)issues.push({severity:'warning',code:'STALE_DATA',detail:`行情最后日期比截至日期早 ${age} 个自然日（含休市日；需交易所日历核验）`});
 if(history.source==='imported'&&(!history.provider||!history.datasetId))issues.push({severity:'blocker',code:'UNTRACKED_SOURCE',detail:'外部行情缺失provider或datasetId'});
 if(history.source!=='imported')issues.push({severity:'blocker',code:'NON_EXTERNAL_SOURCE',detail:'fixture/simulated 数据不得作为真实行情通过验收'});
 const adjustment=history.priceAdjustment;
 if(!adjustment||!['qfq','hfq','unadjusted'].includes(adjustment.mode)||typeof adjustment.provider!=='string'||!adjustment.provider.trim()){
  issues.push({severity:'blocker',code:'ADJUSTMENT_UNVERIFIED',detail:'缺少明确的复权模式及供应商出处；不能判断除权除息影响'});
 }
 let zeroVolume=0, largeGaps=0, lockedBars=0;
 for(const s of history.stocks){
  const symbol=String(s.symbol||s.code);let zeros=0,gaps=0,locks=0;const bars=s.bars;
  for(let i=0;i<bars.length;i++){
   const b=bars[i];if(b.volume===0)zeros++;
   if(i>0){
    const prev=bars[i-1],gapPct=Math.abs((b.open/prev.close-1)*100);
    if(gapPct>30)gaps++;
    if(b.high===b.low&&Math.abs(b.open/prev.close-1)>=0.048)locks++;
   }
  }
  zeroVolume+=zeros;largeGaps+=gaps;lockedBars+=locks;
  const flags=[];
  if(zeros)flags.push('存在零成交量，需核实停牌/数据缺失');
  if(gaps)flags.push('存在超过30%的隔夜跳空，需核实公司行为及异常行情');
  if(locks)flags.push('存在疑似涨跌停一字板，纸面撮合应限制');
  if(s.corporateActionsVerified!==true&&history.source==='imported')flags.push('公司行为尚未逐股票验证');
  bySymbol.push({symbol,bars:bars.length,zeroVolumeBars:zeros,largeOpenGaps:gaps,suspectedLimitLockedBars:locks,flags});
 }
 if(largeGaps)issues.push({severity:'warning',code:'LARGE_GAPS',detail:`发现 ${largeGaps} 处超过30%的隔夜跳空，需要供应商核验复权及公司行为`});
 if(zeroVolume)issues.push({severity:'warning',code:'ZERO_VOLUME',detail:`发现 ${zeroVolume} 条零成交量K线，撮合时必须禁止交易`});
 const ready=history.source==='imported'&&issues.every(i=>i.severity!=='blocker')&&history.stocks.every(s=>s.corporateActionsVerified===true);
 return {schemaVersion:1,mode:'offline-market-quality-audit',canTrade:false,verifiedExternal:false,
  source:history.source,provider:history.provider||null,datasetId:history.datasetId||null,
  asOf:history.asOf,lastDate:valid.lastDate,calendarVerified:false,adjustmentVerified:Boolean(adjustment&&['qfq','hfq','unadjusted'].includes(adjustment.mode)&&adjustment.provider),
  dataFingerprint:sha(history),summary:{stocks:valid.stocks,barsPerStock:valid.barsPerStock,stalenessCalendarDays:age,zeroVolumeBars:zeroVolume,largeOpenGaps:largeGaps,suspectedLimitLockedBars:lockedBars},
  reviewReady:ready,releaseReady:false,issues,bySymbol,
  limitations:['自然日滞后不是交易所休市日历验证','复权声明不等于复权正确性检验','公司行为须核对外部可信来源','数据质量审核不等于实盘可交易授权']};
}
module.exports={auditMarketData};
