'use strict';
/**
 * Read-only, paired, chronologically fresh champion/challenger research
 * scorecard. All three versions see IDENTICAL matured cross-sections.
 * It is not a return forecast, portfolio P&L or authorization to trade.
 */
const {researchScorecard}=require('./fayo-model-evidence-audit');
const {routeDiagnostic}=require('./fayo-final-model-review');
const MIN_DAYS=5,MAX_WINDOW=20;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(n,d=6)=>n===null?null:+n.toFixed(d);
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const median=xs=>{
 const s=[...xs].sort((a,b)=>a-b),i=Math.floor(s.length/2);
 return s.length%2?s[i]:(s[i-1]+s[i])/2;
};
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function compareShadowVersions(days,ids,originalWeights,acceptedWeights,proposedWeights,score){
 if(!Array.isArray(days)||days.length>400||
    !Array.isArray(ids)||ids.length<2||new Set(ids).size!==ids.length||
    typeof score!=='function')
  throw Error('三版本对照的独立日期或因子协议无效');
 for(const weights of [originalWeights,acceptedWeights,proposedWeights]){
  if(!weights||typeof weights!=='object'||Array.isArray(weights)||
     ids.some(id=>!Object.hasOwn(weights,id)||!finite(weights[id])||weights[id]<=0))
   throw Error('三版本对照权重缺失或非正有限值');
 }
 for(let i=0;i<days.length;i++)
  if(!date(days[i]?.day)||(i>0&&days[i-1].day>=days[i].day))
   throw Error('三版本对照必须使用严格递增的真实交易日键');
 const window=days.slice(-MAX_WINDOW);
 const base={status:'insufficient-fresh-evidence',scope:'untouched-matured-holdout',
  requiredDays:MIN_DAYS,maxWindowDays:MAX_WINDOW,assessedDays:0,
  firstDay:window[0]?.day||null,lastDay:window.at(-1)?.day||null,
  perDay:[],original:null,accepted:null,proposed:null,
  proposedVsOriginal:null,proposedVsAccepted:null,
  originalGatePassed:false,canTrade:false,productionWeightsChanged:false};
 if(window.length<MIN_DAYS)return base;
 // Preserve full-precision deltas exclusively for the research promotion gate.
 // The six-decimal scorecard is presentation evidence, not decision input.
 const rows=[],rawOriginalDeltas=[],rawAcceptedDeltas=[],rawICs=[[],[],[]];
 for(const d of window){
  const values=[originalWeights,acceptedWeights,proposedWeights].map(w=>score([d],ids,w));
  if(values.some(x=>!x||x.days!==1)){
   return {...base,status:'incomparable-fresh-evidence',
    assessedDays:rows.length,reason:'incomplete-paired-cross-section'};
  }
  const ics=values.map(x=>x.meanIC);
  if(ics.some(x=>!finite(x)||x < -1||x>1))
   throw Error('三版本对照IC不是有限的相关系数');
  ics.forEach((ic,i)=>rawICs[i].push(ic));
  rawOriginalDeltas.push(ics[2]-ics[0]);
  rawAcceptedDeltas.push(ics[2]-ics[1]);
  rows.push({day:d.day,originalIC:round(ics[0]),acceptedIC:round(ics[1]),
   proposedIC:round(ics[2]),
   proposedMinusOriginal:round(ics[2]-ics[0]),
   proposedMinusAccepted:round(ics[2]-ics[1])});
 }
 const summaries=[
  ['original','originalIC'],['accepted','acceptedIC'],['proposed','proposedIC']
 ].map(([name],i)=>{
  const ic=rawICs[i];
  return [name,{meanIC:round(mean(ic)),medianIC:round(median(ic)),
   positiveDayPct:round(ic.filter(x=>x>0).length/ic.length*100,2)}];
 });
 const uplift=deltas=>{
  const split=Math.floor(deltas.length/2);
  return {meanDeltaIC:round(mean(deltas)),
   firstHalfDeltaIC:round(mean(deltas.slice(0,split))),
   recentHalfDeltaIC:round(mean(deltas.slice(split))),
   betterDayPct:round(deltas.filter(x=>x>0).length/deltas.length*100,2),
   worstDayDeltaIC:round(Math.min(...deltas))};
 };
 // Evaluate diagnostic booleans on raw paired IC deltas; round solely for output.
 // Descriptive fragility only. Five observed dates are not necessarily
 // independent trading sessions; this must never authorize promotion.
 const pairedFragility=deltas=>{
  const omitMeans=deltas.map((_,i)=>mean(deltas.filter((__,j)=>j!==i)));
  const rawWorstLeaveOneOut=Math.min(...omitMeans);
  const worstLeaveOneOut=round(rawWorstLeaveOneOut);
  const blocks=[],rawBlockMeans=[];
  for(let i=0;i+5<=deltas.length;i+=5){
   const blockMean=mean(deltas.slice(i,i+5));
   rawBlockMeans.push(blockMean);
   blocks.push({firstDay:rows[i].day,lastDay:rows[i+4].day,
    meanDeltaIC:round(blockMean)});
  }
  return {status:deltas.length<10?'limited-fresh-observations':'descriptive-unverified',
   assessedDays:deltas.length,
   worstLeaveOneOutMeanDeltaIC:worstLeaveOneOut,
   bestLeaveOneOutMeanDeltaIC:round(Math.max(...omitMeans)),
   singleDayDependent:mean(deltas)>0&&rawWorstLeaveOneOut<=0,
   completeFiveObservationBlocks:blocks,
   incompleteTailDays:deltas.length%5,
   allCompleteBlocksPositive:blocks.length>=2?
    rawBlockMeans.every(blockMean=>blockMean>0):null,
   inference:'descriptive-only-not-independent-days-or-statistical-confidence',
   changesPromotionGate:false,canTrade:false};
 };
 const relativeOriginal=uplift(rawOriginalDeltas);
 const relativeAccepted=uplift(rawAcceptedDeltas);
 const split=Math.floor(rawOriginalDeltas.length/2);
 const originalGatePassed=mean(rawOriginalDeltas)>.002&&
  rawOriginalDeltas.filter(x=>x>0).length/rawOriginalDeltas.length*100>=60&&
  mean(rawOriginalDeltas.slice(0,split))>=-.001&&
  mean(rawOriginalDeltas.slice(split))>=-.001;
 const evidenceBreakdown=researchScorecard(window,rows.map((r,i)=>({...r,originalIC:rawICs[0][i],acceptedIC:rawICs[1][i],proposedIC:rawICs[2][i]})),ids,[originalWeights,acceptedWeights,proposedWeights]);
 return {...base,status:'paired-scorecard-unverified',
  assessedDays:rows.length,perDay:rows,...Object.fromEntries(summaries),
  evidenceBreakdown,routeDiagnostic:routeDiagnostic(evidenceBreakdown),
  proposedVsOriginal:{...relativeOriginal,fragility:pairedFragility(rawOriginalDeltas)},
  proposedVsAccepted:{...relativeAccepted,fragility:pairedFragility(rawAcceptedDeltas)},
  originalGatePassed};
}
// Forecast research: select chronological non-overlapping origin/target windows
// without using the result to choose dates. Equal dates share the same block.
// This is a descriptive price-error comparison, not independent proof or promotion.
function compareFoundationWindows(rows){
 const base={mode:'nonoverlapping-forecast-blocks-v1',status:'unknown',attempted:Array.isArray(rows)?rows.length:0,selected:0,omitted:0,windows:0,blocks:[],bothBlocksImproved:null,independenceCertified:false,canTrade:false,autoPromotion:false};
 if(!Array.isArray(rows)||rows.length>10000||!rows.length)return base;
 const good=r=>r&&date(r.originDate)&&date(r.targetDate)&&r.originDate<r.targetDate&&typeof r.symbol==='string'&&/^\d{6}$/.test(r.symbol)&&[r.absoluteError,r.naiveError,r.driftError].every(x=>finite(x)&&x>=0)&&r.corporateActionEvidence==='declared-no-action'&&r.latestCorporateActionEvidence==='declared-no-action'&&r.revisedOutcome===false&&r.outcomeConflictSeen===false;
 if(!rows.every(good))return {...base,status:'incomparable-outcomes'};
 const groups=new Map(),seen=new Set();
 for(const r of rows){const key=JSON.stringify([r.originDate,r.targetDate]),identity=JSON.stringify([r.symbol,r.originDate,r.targetDate]);if(seen.has(identity))return {...base,status:'duplicate-outcomes'};seen.add(identity);const g=groups.get(key)||{from:r.originDate,to:r.targetDate,rows:[]};g.rows.push(r);groups.set(key,g);}
 const windows=[];let through='';for(const w of [...groups.values()].sort((a,b)=>a.to.localeCompare(b.to)||a.from.localeCompare(b.from))){if(w.from>through){windows.push(w);through=w.to;}}
 const selected=windows.flatMap(w=>w.rows),common={...base,selected:selected.length,omitted:rows.length-selected.length,windows:windows.length};
 if(windows.length<10||selected.length<30||new Set(selected.map(r=>r.symbol)).size<5)return {...common,status:'insufficient-nonoverlapping-windows'};
 const split=Math.floor(windows.length/2),blocks=[];let improved=true;
 for(const ws of [windows.slice(0,split),windows.slice(split)]){
  const rs=ws.flatMap(w=>w.rows),model=mean(rs.map(r=>r.absoluteError)),naive=mean(rs.map(r=>r.naiveError)),drift=mean(rs.map(r=>r.driftError));
  if(![model,naive,drift].every(finite))return {...common,status:'incomparable-outcomes'};
  const tolerance=1e-8*Math.max(1,model,naive,drift),better=model<naive-tolerance&&model<drift-tolerance;improved=improved&&better;
  blocks.push({from:ws[0].from,to:ws.at(-1).to,windows:ws.length,samples:rs.length,modelMae:round(model),naiveMae:round(naive),driftMae:round(drift),bothBaselinesBeaten:better});
 }
 return {...common,status:'descriptive-two-blocks',blocks,bothBlocksImproved:improved};
}
module.exports={compareShadowVersions,compareFoundationWindows};
