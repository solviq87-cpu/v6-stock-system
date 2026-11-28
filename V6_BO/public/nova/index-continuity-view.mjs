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

// Describe only the archived, currently admitted references. Never turn
// coincident headline text, negation cues or duplicate copies into causal votes.
const topics=Object.freeze({'monetary-fiscal':'货币/财政','industrial-policy':'产业政策','issuer-earnings':'公司业绩',overseas:'海外事件','market-mechanics':'市场机制'});
const contraryHints=new Set(['clarification','negation','withdrawal-mention']);
const hashOK=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=150;
export function indexHypothesisDisclosure(value){
 const c=value?.hypothesisContext,refs=value?.evidenceHashes;
 if(value?.status!=='cached-window-checked'||value.currentLocalEvidence!==true||value.attribution!=='unknown'||value.canTrade!==false||value.canNotify!==false||
  c?.mode!=='same-window-archived-text-clues-v1'||c.cause!=='unknown'||c.exposureStatus!=='unknown'||c.independentSourcesVerified!==false||c.marketOnlyAlternativeRetained!==true||c.confirmedCounterEvidenceCount!==null||
  !Array.isArray(refs)||refs.length<1||refs.length>150||!refs.every(hashOK)||new Set(refs).size!==refs.length||c.referenceCount!==refs.length||
  !Array.isArray(c.textGroups)||c.textGroups.length<1||c.textGroups.length>150||![c.distinctTextGroups,c.unknownReferenceGroups,c.counterTextGroupCount].every(count))return '';
 const seenRefs=new Set(),seenTexts=new Set(),hints=new Set();let unknown=0,counter=0,summary=0;
 for(const g of c.textGroups){
  if(!g||!['declared-body','provider-summary','unknown'].includes(g.textScope)||!Array.isArray(g.evidenceHashes)||!g.evidenceHashes.length||g.evidenceHashes.length>150||
     !Array.isArray(g.topicHints)||g.topicHints.length>Object.keys(topics).length||!g.topicHints.every(x=>typeof x==='string'&&Object.hasOwn(topics,x))||new Set(g.topicHints).size!==g.topicHints.length||
     !Array.isArray(g.counterTextHints)||g.counterTextHints.length>contraryHints.size||!g.counterTextHints.every(x=>contraryHints.has(x))||new Set(g.counterTextHints).size!==g.counterTextHints.length)return '';
  for(const ref of g.evidenceHashes){if(!hashOK(ref)||!refs.includes(ref)||seenRefs.has(ref))return '';seenRefs.add(ref);}
  if(g.textScope==='unknown'){
   if(g.textHash!==null||g.evidenceHashes.length!==1||g.topicHints.length||g.counterTextHints.length)return '';unknown++;
  }else{
   if(!hashOK(g.textHash)||seenTexts.has(g.textHash))return '';seenTexts.add(g.textHash);
   if(g.textScope==='provider-summary')summary++;
  }
  if(g.counterTextHints.length)counter++;
  for(const hint of g.topicHints)hints.add(hint);
 }
 const distinct=seenTexts.size,expected=distinct>1?'multiple-text-clues':distinct?'single-text-clue':'no-qualified-text-clues';
 if(seenRefs.size!==refs.length||c.distinctTextGroups!==distinct||c.unknownReferenceGroups!==unknown||c.counterTextGroupCount!==counter||c.status!==expected)return '';
 const labels=Object.keys(topics).filter(x=>hints.has(x)).map(x=>topics[x]);
 return ' · 同窗文本线索 '+distinct+' 组 / 原档案引用 '+refs.length+' 条'+(labels.length?' · 标题待核类别：'+labels.join('、'):'')+
  (counter?' · 待核反证线索 '+counter+' 组':'')+(summary?' · 供应商摘要 '+summary+' 组':'')+(unknown?' · 原文范围未知 '+unknown+' 组':'')+
  ' · 原因与影响敞口未知，非消息因素仍待核；不代表独立来源或已证实反证';
}
