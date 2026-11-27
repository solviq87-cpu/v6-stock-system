'use strict';
// C-group shadow research proposal. Not an installed entry rule, notification
// producer, or second authority. The existing A/B shared contract is unchanged.
const {aShareCalendarDate}=require('./a-share-calendar');
const {validateEquityEvidence}=require('./account-equity-evidence');
const VERSION='fayo-c-shadow-review-v1';
const DIMENSIONS=Object.freeze(['market','position','crowding','liquidity-support','sentiment','leader','exit','reward-risk']);
const FLAGS=Object.freeze({researchOnly:true,shadowOnly:true,canTrade:false,canNotify:false,canAuthorize:false,canOpenRisk:false,writesAccount:false,productionWeightsChanged:false});
const arr=x=>Array.isArray(x)?x:[];
const time=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const qty=x=>Number.isSafeInteger(x)&&x>=0;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=240&&!/[\x00-\x1f\x7f]/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fake=x=>/(?:^|[-_:/\.\s])(?:mock|synthetic|fixture|test|demo|simulated)(?:$|[-_:/\.\s])/i.test(String(x||''));
const current=(at,now)=>time(at)&&time(now)&&at<=now&&now-at<=15000&&aShareCalendarDate(at)===aShareCalendarDate(now);
const uniq=xs=>new Set(xs).size===xs.length;
const fraction=x=>finite(x)&&x>=0&&x<=100;
const sameSet=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const signature=x=>JSON.stringify(canonical(x));
function session(at){
 const d=new Date(at+28800000),m=d.getUTCHours()*60+d.getUTCMinutes();
 return m>=570&&m<690?'am':m>=780&&m<900?'pm':null;
}
// Validate the original task 72 projected row at its own frozen observation
// time. Currentness at a later review is never inferred from the wrapper clock.
function themeRow(report,id,source){
 if(report?.schemaVersion!==1||report.researchOnly!==true||report.canTrade!==false||!time(report.asOf))return null;
 const matches=arr(report.modules?.[72]?.rows).filter(r=>r?.id===id&&r.evidence?.source===source);
 if(matches.length!==1)return null;
 const r=matches[0],e=r.evidence,m=r.metrics,at=report.asOf,members=new Set(arr(r.members));
 if(r.current!==true||!['observed-research','crowding-observation'].includes(r.status)||r.thresholdVersion!=='theme-descriptive-v1'||
    !text(r.name)||!current(r.snapshotAt,at)||!session(r.snapshotAt)||!qty(e.revision)||e.revision===0||
    e.id!==id||!text(e.evidenceId)&&!text(e.sourceUrl)||fake(e.source)||![e.publishedAt,e.firstKnownAt,e.recordedAt].every(time)||
    e.publishedAt>e.firstKnownAt||r.snapshotAt>e.firstKnownAt||e.firstKnownAt>e.recordedAt||e.recordedAt>at||
    !Array.isArray(r.members)||!r.members.length||r.members.length>10000||!r.members.every(code)||!uniq(r.members)||
    r.memberCount!==r.members.length||r.observedMembers!==r.members.length||r.coveragePct!==100||
    !Array.isArray(r.memberEvidence)||r.memberEvidence.length!==r.members.length||
    !uniq(r.memberEvidence.map(x=>x?.symbol))||!r.memberEvidence.every(x=>members.has(x.symbol)&&text(x.source)&&!fake(x.source)&&
      current(x.quoteAt,at)&&x.quoteAt<=r.snapshotAt)||
    !m||!finite(m.amount)||m.amount<=0||!fraction(m.turnoverConcentrationTop3Pct)||!finite(m.meanTurnoverPct)||m.meanTurnoverPct<0||
    !finite(m.meanChangePct)||!fraction(m.advanceFractionPct)||!fraction(m.limitUpFractionPct))return null;
 const conditions=[['成交额集中',r.members.length>=5&&m.turnoverConcentrationTop3Pct>=70],
  ['换手较高',m.meanTurnoverPct>=10],['涨停扩散',m.limitUpFractionPct>=30],['价格快速上涨',m.meanChangePct>=5]]
  .filter(([,v])=>v).map(([name])=>name);
 if(!Array.isArray(r.matchedConditions)||!sameSet(conditions,r.matchedConditions)||
    (conditions.length>=2)!==(r.status==='crowding-observation'))return null;
 return {at: r.snapshotAt,asOf:at,day:aShareCalendarDate(r.snapshotAt),session:session(r.snapshotAt),
  source,id,revision:e.revision,evidenceRef:e.evidenceId||e.sourceUrl,knownAt:e.recordedAt,
  members:r.members.slice().sort(),quotes:r.memberEvidence.map(x=>({symbol:x.symbol,source:x.source,at:x.quoteAt})).sort((a,b)=>a.symbol.localeCompare(b.symbol)),
  metrics:{...m},conditions,crowded:conditions.length>=2,thresholdVersion:r.thresholdVersion};
}
function comparable(a,b){
 return !!(a&&b&&a.day===b.day&&a.session===b.session&&a.thresholdVersion===b.thresholdVersion&&sameSet(a.members,b.members)&&
  b.at>a.at&&b.at-a.at<=60000&&b.revision>a.revision&&b.knownAt>a.knownAt&&b.evidenceRef!==a.evidenceRef&&
  b.quotes.every((q,i)=>q.symbol===a.quotes[i].symbol&&q.source===a.quotes[i].source&&q.at>a.quotes[i].at));
}
const rises=(a,b)=>b.metrics.advanceFractionPct>a.metrics.advanceFractionPct&&b.metrics.meanChangePct>a.metrics.meanChangePct;
const falls=(a,b)=>b.metrics.advanceFractionPct<a.metrics.advanceFractionPct&&b.metrics.meanChangePct<a.metrics.meanChangePct;
function buildThemeLifecycle({reports=[],themeId,source,now=Date.now()}={}){
 const result={version:VERSION,themeId:themeId??null,source:source??null,asOf:time(now)?now:null,phase:'unknown',phaseConfirmed:false,current:false,
  latest:null,transitions:[],lastAdverseAt:null,lastAdverseReason:null,recoveryRequired:false,reason:'THEME_HISTORY_UNAVAILABLE',...FLAGS};
 if(!time(now)||!text(themeId)||!text(source)||fake(source)||!Array.isArray(reports)||reports.length>100)return result;
 const groups=new Map();
 // Ignore future reports, but keep a missing/invalid latest observation as
 // an explicit gap. Never fall back from a current bad observation to old data.
 for(const r of reports){
  if(!time(r?.asOf)){result.reason='THEME_HISTORY_CLOCK_UNKNOWN';return result;}
  if(r.asOf>now)continue;
  const rows=groups.get(r.asOf)||[];rows.push(r);groups.set(r.asOf,rows);
 }
 let previous=null,declines=0,improvements=0,hadCrowding=false,phase='unknown';
 for(const [at,group] of [...groups].sort(([a],[b])=>a-b)){
  const rows=group.map(r=>themeRow(r,themeId,source));
  const row=rows[0];
  if(!row||rows.some(r=>!r||signature(r)!==signature(row))){
   previous=null;declines=improvements=0;hadCrowding=false;phase='unknown';
   result.latest=null;result.reason='THEME_OBSERVATION_GAP_OR_CONFLICT';continue;
  }
  const repeated=previous&&row.at===previous.at&&row.revision===previous.revision&&row.evidenceRef===previous.evidenceRef&&
    signature(row.quotes)===signature(previous.quotes)&&signature(row.metrics)===signature(previous.metrics)&&signature(row.members)===signature(previous.members);
  if(repeated)continue;
  const linked=comparable(previous,row);
  if(!linked){declines=improvements=0;hadCrowding=false;}
  const declining=linked&&falls(previous,row),improving=linked&&rises(previous,row);
  declines=declining?declines+1:0;improvements=improving?improvements+1:0;
  hadCrowding=hadCrowding||row.crowded;
  // These are descriptive shadow candidates, not calibrated stage thresholds.
  if(declines>=2&&hadCrowding&&row.metrics.meanChangePct<0)phase='collapse-candidate';
  else if(declining&&hadCrowding)phase='divergence-candidate';
  else if(improvements>=2&&result.lastAdverseAt!==null&&!row.crowded)phase='repair-candidate';
  else if(row.crowded&&linked&&previous.crowded&&!declining&&row.metrics.meanChangePct>0)phase='climax-candidate';
  else if(improving)phase='strengthening-candidate';
  else if(row.metrics.meanChangePct>0)phase='formation-watch';
  else phase='unknown';
  if(row.crowded||['divergence-candidate','collapse-candidate'].includes(phase)){
   result.lastAdverseAt=row.at;result.lastAdverseReason=phase==='collapse-candidate'?'SUSTAINED_THEME_DETERIORATION':row.crowded?'ORIGINAL_DESCRIPTIVE_CROWDING':'THEME_DIVERGENCE';
  }
  result.transitions.push({asOf:at,sourceAt:row.at,phase,comparableToPrevious:!!linked,evidenceRef:row.evidenceRef,
   revision:row.revision,coveragePct:100,metrics:row.metrics});
  previous=row;result.latest=row;
  result.reason=linked?'COMPARABLE_RESEARCH_OBSERVATION':'NEW_OR_DISCONTINUOUS_RESEARCH_OBSERVATION';
 }
 result.recoveryRequired=result.lastAdverseAt!==null;
 if(!result.latest||!current(result.latest.at,now)||!result.latest.quotes.every(q=>current(q.at,now))){
  result.phase='unknown';result.reason=result.latest?'LATEST_ORIGINAL_THEME_QUOTE_STALE':result.reason;return result;
 }
 result.phase=phase;result.current=true;
 result.assumptions={comparisonMaxGapMs:60000,source:'research-only comparison window; original theme-descriptive-v1 thresholds unchanged',
  collapseRule:'two successive comparable breadth and mean-change declines after observed crowding, latest mean change negative',
  repairRule:'two successive comparable rises without current descriptive crowding; original risk clearance still required',validated:false};
 return result;
}
function boundAccount(report,accountId,now){
 try{
  if(!['pool','pre'].includes(accountId)||!report||report.protocol!=='fayo-risk-workbench-v1'||report.schemaVersion!==1||
     report.account?.id!==accountId||report.generatedAt!==now||report.instance?.role!=='primary'||report.readOnly!==true||
     report.canTrade!==false||report.writesAccount!==false)return null;
  const e=validateEquityEvidence(report.equity),r=report.rules;
  if(e.accountId!==accountId||e.observedAt!==now||e.accountEpoch!==report.accountEpoch||e.source.accountRevision!==report.accountRevision||
     e.source.kind!=='authoritative-paper-account'||!qty(e.source.accountRevision)||e.source.accountRevision===0||e.positions.length>1000||
     !uniq(e.positions.map(p=>p?.symbol))||e.positions.some(p=>!code(p?.symbol)||!qty(p.quantity)||p.quantity===0)||
     r?.accountId!==accountId||r.accountEpoch!==e.accountEpoch||r.accountRevision!==e.source.accountRevision||
     r.authoritySnapshotFingerprint!==e.source.snapshotFingerprint||r.generatedAt!==now||r.readOnly!==true||r.canTrade!==false)return null;
  return {e,r};
 }catch{return null;}
}
function accountScope(bound,symbol){
 const missing={scope:'account-unknown',quantity:null,sellableQuantity:null,hasActiveOrder:null,advice:'原账户证据不足，不能判断是否持仓或新增风险'};
 if(!bound)return missing;
 const {e,r}=bound,p=e.positions.find(p=>p.symbol===symbol),active=r.occupancy?.activeOrderSymbols;
 const ordersKnown=Array.isArray(active)&&uniq(active)&&active.every(code),hasActiveOrder=ordersKnown?active.includes(symbol):null;
 if(p){
  const sellable=qty(p.sellableQuantity)&&p.sellableQuantity<=p.quantity?p.sellableQuantity:null;
  const scope=sellable===null?'held-sellability-unknown':sellable===0?'held-locked-or-frozen':sellable<p.quantity?'held-partial-sellable':'held';
  const advice=scope==='held-locked-or-frozen'?'当前无已核可卖数量；保留风险，勿假定立即退出':
   scope==='held-partial-sellable'?'只按已核可卖部分复核防御；其余仓位仍承压':
   scope==='held-sellability-unknown'?'已有持仓，但可卖数量未知；先核对原批次及委托':
   '已有持仓；按原条件和可卖数量复核防御，建议不等于成交';
  return {scope,quantity:p.quantity,sellableQuantity:sellable,hasActiveOrder,advice};
 }
 if(!ordersKnown||e.status!=='complete'||e.cashMovements?.status!=='reconciled')return missing;
 return {scope:hasActiveOrder?'active-order-no-holding':'unheld',quantity:0,sellableQuantity:0,hasActiveOrder,
  advice:hasActiveOrder?'有未终结委托，先核对原状态；不重复使用预算':'未持仓，先观察参与条件与原风控；不盲目追高'};
}
// The remaining seven dimensions are a proposal for the original producers.
// Missing evidence is never replaced by a score, another dimension, or a model.
function dimensionRows({observations,symbol,now,lifecycle}){
 const rows=DIMENSIONS.map(d=>({dimension:d,status:'unknown',values:[],rootCauseIds:[],evidenceRefs:[],reason:'NO_BOUND_DIMENSION_EVIDENCE'}));
 const byDim=new Map(rows.map(r=>[r.dimension,r]));
 if(lifecycle?.current===true&&lifecycle.latest&&current(lifecycle.latest.at,now)){
  const r=byDim.get('crowding'),t=lifecycle.latest;
  if(t.members.includes(symbol)){
   const adverse=t.crowded||lifecycle.recoveryRequired;
   Object.assign(r,{status:adverse?'observed-risk':'observed-not-triggered',reason:adverse?'ORIGINAL_CROWDING_OR_RECHECK_REQUIRED':'DESCRIPTIVE_THRESHOLDS_NOT_TRIGGERED',
    values:[{value:t.metrics,source:t.source,dataAt:t.at,knownAt:t.knownAt,coveragePct:100,version:t.thresholdVersion}],
    rootCauseIds:['theme/'+t.source+'/'+t.id],evidenceRefs:[t.evidenceRef]});
  }
 }
 const groups=new Map(),invalidDimensions=new Set();
 if(Array.isArray(observations)&&observations.length<=1000)for(const x of observations){
  if(!x||x.dimension==='crowding'||!byDim.has(x.dimension)||x.symbol!==symbol)continue;
  // Future arrivals are invisible to an earlier review. Other invalid visible
  // same-dimension rows must not disappear beside an apparently clear row.
  if(time(x.knownAt)&&x.knownAt>now)continue;
  if(!text(x.metricId)||!text(x.rootCauseId)||!text(x.evidenceRef)||
     !text(x.source)||fake(x.source)||!text(x.ruleVersion)||!finite(x.value)||!text(x.unit)||
     !current(x.dataAt,now)||!time(x.knownAt)||x.knownAt<x.dataAt||x.knownAt>now||
     !qty(x.observed)||!qty(x.total)||x.total===0||x.observed!==x.total||
     !['adverse','not-triggered'].includes(x.finding)||x.retracted===true||x.researchOnly!==true||x.canTrade!==false){
    invalidDimensions.add(x.dimension);continue;
  }
  const key=x.dimension+'\n'+x.rootCauseId+'\n'+x.evidenceRef;
  const group=groups.get(key)||[];group.push(x);groups.set(key,group);
 }
 for(const group of groups.values()){
  const x=group[0],r=byDim.get(x.dimension);
  const conflict=group.some(q=>signature(q)!==signature(x));
  r.values.push({metricId:x.metricId,value:conflict?null:x.value,unit:x.unit,source:x.source,dataAt:x.dataAt,knownAt:x.knownAt,
   coveragePct:100,version:x.ruleVersion,finding:conflict?'conflict':x.finding});
  r.rootCauseIds.push(x.rootCauseId);r.evidenceRefs.push(x.evidenceRef);
 }
 for(const r of rows.filter(r=>r.dimension!=='crowding'&&r.values.length)){
  const findings=new Set(r.values.map(x=>x.finding));
  r.status=findings.has('conflict')||findings.size>1?'conflict':findings.has('adverse')?'observed-risk':'observed-not-triggered';
  r.reason=r.status==='conflict'?'CONFLICTING_RESEARCH_DIMENSION':'DECLARED_SHADOW_RESEARCH_EVIDENCE';
  r.rootCauseIds=[...new Set(r.rootCauseIds)];r.evidenceRefs=[...new Set(r.evidenceRefs)];
 }
 for(const d of invalidDimensions){
  const r=byDim.get(d);
  if(r.status!=='observed-risk'){
   r.status=r.values.length?'conflict':'unknown';r.reason='VISIBLE_DIMENSION_EVIDENCE_INCOMPLETE';
  }
 }
 return rows;
}
function compareModelOpinions({opinions=[],symbol,now}){
 const out={status:'unknown',reason:'NO_COMPARABLE_MODEL_EVIDENCE',modelCount:0,targetId:null,horizonSessions:null,probability:null,expectedValue:null};
 if(!Array.isArray(opinions)||opinions.length>100||!opinions.length)return out;
 const models=new Map();
 for(const x of opinions){
  if(!x||x.symbol!==symbol||!text(x.modelId)||!text(x.modelVersion)||!text(x.targetId)||!text(x.evidenceRef)||
     !qty(x.horizonSessions)||x.horizonSessions===0||x.horizonSessions>250||!current(x.signalAt,now)||
     !time(x.knownAt)||x.knownAt<x.signalAt||x.knownAt>now||!['adverse','not-triggered','abstain'].includes(x.verdict)||
     x.researchOnly!==true||x.canTrade!==false||x.retracted===true)return out;
  const old=models.get(x.modelId);
  if(old&&signature(old)!==signature(x))return {...out,status:'conflict',reason:'SAME_MODEL_CONFLICTING_VERSION_OR_VERDICT'};
  models.set(x.modelId,x);
 }
 const rows=[...models.values()],first=rows[0];
 if(rows.length<2||!uniq(rows.map(x=>x.evidenceRef))||rows.some(x=>x.targetId!==first.targetId||x.horizonSessions!==first.horizonSessions||x.signalAt!==first.signalAt))return out;
 const findings=new Set(rows.map(x=>x.verdict));
 // Agreement is not probability calibration or an independent hard gate.
 return {...out,modelCount:rows.length,targetId:first.targetId,horizonSessions:first.horizonSessions,
  status:findings.has('abstain')?'unknown':findings.size>1?'conflict':'observed-agreement',
  reason:findings.has('abstain')?'MODEL_ABSTENTION':findings.size>1?'MODEL_DISAGREEMENT':'DECLARED_RESEARCH_AGREEMENT',verdict:findings.size===1?[...findings][0]:null};
}
function buildShadowReview({symbol,accountId,report,themeReports=[],themeId,themeSource,observations=[],opinions=[],now=Date.now()}={}){
 if(!code(symbol)||!time(now))throw Error('影子风险标的或时间无效');
 const bound=boundAccount(report,accountId,now),scope=accountScope(bound,symbol);
 const lifecycle=buildThemeLifecycle({reports:themeReports,themeId,source:themeSource,now});
 const dimensions=dimensionRows({observations,symbol,now,lifecycle}),models=compareModelOpinions({opinions,symbol,now});
 const byRoot=new Map();let originalRestrictionRetained=false;
 const add=(priority,rootCauseId,evidenceRef,message)=>{
  if(priority===2)originalRestrictionRetained=true;
  const old=byRoot.get(rootCauseId);
  if(!old){byRoot.set(rootCauseId,{priority,rootCauseId,evidenceRef,message,
    evidenceRefs:evidenceRef===null?[]:[evidenceRef],messages:[message]});return;}
  if(priority<old.priority){old.priority=priority;old.message=message;old.evidenceRef=evidenceRef;}
  if(evidenceRef!==null&&!old.evidenceRefs.includes(evidenceRef))old.evidenceRefs.push(evidenceRef);
  if(!old.messages.includes(message))old.messages.push(message);
 };
 if(!bound||scope.scope==='account-unknown'||bound.e.status!=='complete'||bound.e.cashMovements?.status!=='reconciled')
  add(1,'account/evidence',null,'原账户、资金或持仓证据不完整，不能确认新增风险');
 if(scope.hasActiveOrder!==false)add(1,'account/active-order-evidence',null,'在途委托存在或未知，不能重复使用风险预算');
 if(bound){
  if(!Array.isArray(bound.r.rules))add(1,'account/policy-evidence',null,'原生效规则证据缺失');
  for(const r of arr(bound.r.rules)){
   if(!text(r?.id))continue;
   if(r.enabled===true&&r.configurationStatus==='active'&&r.evidenceStatus==='available'&&r.exceeded===true)
    add(2,'rule/'+r.id,bound.r.policyVersion??null,'原已生效规则超限；保持原限制');
   else if(r.configurationStatus==='invalid'||r.configurationStatus==='unknown'||r.enabled===true&&r.configurationStatus==='active'&&(r.evidenceStatus!=='available'||typeof r.exceeded!=='boolean'))
    add(1,'rule/'+r.id,bound.r.policyVersion??null,'原生效规则尚无完整核验');
  }
  for(const r of arr(report.risks)){
   if(!text(r?.rootCauseId)||r.status==='resolved'||r.object?.type==='security'&&r.object.id!==symbol)continue;
   if(['manual-security'].includes(r.object?.type))continue;
   if(r.riskLevel>=3&&r.assessmentState==='risk-detected'||r.lastValidRisk?.riskLevel>=3&&r.status==='unknown')
    add(2,r.rootCauseId,r.id??null,'原严重风险或尚未解除的原严重风险，不能由研究结论覆盖');
  }
 }
 for(const d of dimensions){
  if(d.status==='unknown'||d.status==='conflict')add(3,'dimension/'+d.dimension,null,'风险维度未知或冲突');
  if(d.status==='observed-risk'||d.status==='conflict')for(const [i,root] of d.rootCauseIds.entries())
   add(3,root,d.evidenceRefs[i]??null,'专项研究风险或冲突待核对；不启用新正式门禁');
 }
 if(lifecycle.recoveryRequired&&lifecycle.latest?.members.includes(symbol))add(3,'theme/'+themeSource+'/'+themeId,lifecycle.latest.evidenceRef,'原主题风险仍需正式恢复复核');
 if(models.status!=='observed-agreement'||models.verdict==='adverse'||models.verdict==='abstain')add(4,'models/review',null,'模型缺证、冲突、弃权或不利，仅研究复核');
 const reasons=[...byRoot.values()],evidenceRefs=[...new Set(dimensions.flatMap(d=>d.evidenceRefs))],rootCauseIds=[...new Set(dimensions.flatMap(d=>d.rootCauseIds))];
 return {version:VERSION,symbol,accountId:accountId??null,asOf:now,accountEpoch:bound?.e.accountEpoch??null,
  accountRevision:bound?.e.source.accountRevision??null,accountEvidenceId:bound?.e.fingerprint??null,
  scope,lifecycle,dimensions,models,reasons:reasons.sort((a,b)=>a.priority-b.priority||a.rootCauseId.localeCompare(b.rootCauseId)),
  originalRestrictionRetained,disposition:reasons.some(r=>r.priority<=2)?'withhold-original-risk-or-unknown':
   reasons.length?'shadow-withhold-or-abstain':'research-review-only',
  rawEvidenceCoverage:{observedDimensions:dimensions.filter(d=>d.status.startsWith('observed-')).length,totalDimensions:8,
   uniqueEvidenceRefs:evidenceRefs,uniqueRootCauseIds:rootCauseIds,independentVoteCount:null},
  score:null,riskProbability:null,clearanceGranted:false,...FLAGS};
}
module.exports={VERSION,DIMENSIONS,buildThemeLifecycle,compareModelOpinions,buildShadowReview};
