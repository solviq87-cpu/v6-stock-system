// Quality and archive purpose are independent dimensions. Existing paper
// executions are real research observations unless explicitly marked as tests.
const yes=value=>value===true||value===1||['1','true','是'].includes(value);
export function isTestSample(row={}){
  return row?.sampleSet==='test'||row?.scope==='demo'||yes(row?.testSample)||yes(row?.isTest)||
    row?.quality==='教学样本'||row?.sampleSource==='教学样本'||/^合成教学样本/.test(row?.name||'');
}
// Formal learning excludes explicit teaching/synthetic purpose markers.
// The original fee-bearing source "V6 模拟成交" is not a teaching label.
export function isLearningTestSample(row={}){
 const teaching=/(?:^|[-_:/ .])(?:fixture|simulated|synthetic|mock|demo|test)(?:$|[-_:/ .])|教学样本|演示样本/i;
 return isTestSample(row)||['test','demo','synthetic'].includes(row?.sampleSet)||
  ['test','demo'].includes(row?.sampleScope)||['test','demo'].includes(row?.scope)||
  ['simulated','synthetic','mock','fixture'].some(k=>yes(row?.[k]))||
  row?.quality==='演示样本'||['source','sampleSource','provider','provenance'].some(k=>teaching.test(String(row?.[k]||'')));
}
export function sampleMatches(row={},selection='all'){
  if(!row)return false;
  const quality=row.quality;
  const black=yes(row.blackSwan)||quality==='黑天鹅'||quality==='黑天鹅行情'||quality==='blackSwan';
  const extreme=yes(row.extreme)||yes(row.extremeMarket)||quality==='extreme'||/不可复制|极端行情/.test(quality||'')||row.repeatable===false&&!black;
  switch(selection){
    case 'all':return true;
    case 'standard':return !black&&!extreme;
    case 'blackSwan':return black;
    case 'extreme':return extreme;
    case 'excludeBlackSwan':return !black;
    case 'excludeExtreme':return !extreme;
    default:return false;
  }
}

// Exact evidence clocks; minute-only local records are Beijing time. A date
// alone is accepted only at the explicit historical close compatibility edge.
export function sampleEvidenceTime(value,{dateAtClose=false}={}){
 if(Number.isSafeInteger(value)&&value>0&&value<8e15)return value;
 if(typeof value!=='string')return null;
 const s=value.replace(' ','T'),d=s.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||
    new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)return null;
 let at;
 if(s===d&&dateAtClose)at=Date.parse(d+'T15:00:00+08:00');
 else if(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(s))
  at=Date.parse(s+(/(?:Z|[+-]\d{2}:\d{2})$/.test(s)?'':'+08:00'));
 return Number.isSafeInteger(at)&&at>0&&at<8e15?at:null;
}
const clocks=['createdAt','recordedAt','availableAt','knownAt','receivedAt','observedAt','observedAtMs','asOf','updatedAt','revisedAt'];
export function evidenceVisibleAt(row,cutoff){
 if(!row||typeof row!=='object'||Array.isArray(row)||sampleEvidenceTime(cutoff)===null)return false;
 return clocks.every(k=>{
  if(row[k]==null||row[k]==='')return true;
  const t=sampleEvidenceTime(row[k],{dateAtClose:k==='asOf'});return t!==null&&t<=cutoff;
 });
}
// Only an explicit valid later archive/revision proves that a row is
// outside the earlier identity population. Broken outcomes or receipt clocks
// are NOT proof of lateness; keep them for collision detection.
export function learningIdentityVisibleAt(row,cutoff,{frozen=false}={}){
 const end=sampleEvidenceTime(cutoff);
 if(!row||typeof row!=='object'||Array.isArray(row)||end===null)return false;
 const keys=['createdAt','recordedAt','receivedAt','updatedAt','revisedAt',...(frozen?['frozenAt']:[])];
 return !keys.some(k=>{const at=sampleEvidenceTime(row[k]);return at!==null&&at>end;});
}
export function settlementObservation(row,cutoff,{requireReceipt=false}={}){
 if(!evidenceVisibleAt(row,cutoff)||typeof row.pnl!=='number'||!Number.isFinite(row.pnl))return null;
 const exit=sampleEvidenceTime(row.exitTimestamp??row.exitTime??row.sellTime??row.exitDate,{dateAtClose:true});
 const entryRaw=row.entryTimestamp??row.entryTime,entry=entryRaw==null?null:sampleEvidenceTime(entryRaw);
 if(exit===null||exit>cutoff||entryRaw!=null&&(entry===null||entry>=exit))return null;
 // Exact native timestamps and legacy wall-minute aliases must refer to
 // the same minute. A later archive time cannot repair an earlier receipt.
 for(const [precise,alias] of [['entryTimestamp','entryTime'],['exitTimestamp','exitTime']]){
  if(row[precise]!=null&&row[alias]!=null){
   const a=sampleEvidenceTime(row[precise]),b=sampleEvidenceTime(row[alias]);
   if(a===null||b===null||Math.floor(a/60000)!==Math.floor(b/60000))return null;
  }
 }
 if(row.exitDate!=null&&row.exitDate!==new Date(exit+28800000).toISOString().slice(0,10))return null;
 const receipts=['createdAt','recordedAt','receivedAt','updatedAt','revisedAt'].filter(k=>row[k]!=null&&row[k]!=='').map(k=>sampleEvidenceTime(row[k]));
 if(receipts.some(t=>t===null||t<exit||t>cutoff)||requireReceipt&&!receipts.length)return null;
 const receipt=receipts.length?Math.max(...receipts):null;
 const knownAt=receipt===null?null:Math.max(exit,receipt,...clocks.filter(k=>row[k]!=null&&row[k]!=='').map(k=>sampleEvidenceTime(row[k],{dateAtClose:k==='asOf'})));
 return {exit,entry,receipt,knownAt};
}
// Verified learning is narrower than recorded settlement history. Recovery
// restores eligibility only from its own evidence time, never from the sale
// or the earlier receipt. The original settlement remains readable.
export function verifiedLearningObservation(row,cutoff){
 const observation=row?.snapshotVerified===true?settlementObservation(row,cutoff,{requireReceipt:true}):null;
 if(!observation||row.planEvidenceReview==null)return observation;
 const review=row.planEvidenceReview;
 const first=sampleEvidenceTime(review.firstQuarantinedAt),last=sampleEvidenceTime(review.lastQuarantinedAt),
   restored=sampleEvidenceTime(review.revalidatedAt);
 if(review.status!=='revalidated'||first===null||last===null||restored===null||
   first>last||last>restored||restored>cutoff)return null;
 return {...observation,knownAt:Math.max(observation.knownAt,restored)};
}
// Resolve only already-visible, same-purpose records. Exact retries collapse;
// conflicting records sharing either identity are quarantined together.
export function uniqueEvidenceRows(rows,{requireIdentity=false,settlements=false,testSample=isTestSample}={}){
 const groups=new Map(),rejected=new Set(),duplicates=new Set(),input=Array.isArray(rows)?rows:[];
 for(let i=0;i<input.length;i++){
  const row=input[i];if(!row||typeof row!=='object'||Array.isArray(row)){rejected.add(i);continue;}
  const scope=testSample(row)?'test':'research',keys=[];
  if(typeof row.id==='string'&&row.id.trim())keys.push(JSON.stringify([scope,'id',row.id]));
  if(settlements&&row.paperSettlement!=null){
   const p=row.paperSettlement;
   if(typeof p.accountId!=='string'||!p.accountId.trim()||typeof p.exitEventId!=='string'||!p.exitEventId.trim()){
    // A malformed secondary identity cannot hide a usable local ID collision.
    rejected.add(i);
   }else keys.push(JSON.stringify([scope,'settlement',p.accountId,p.exitEventId]));
  }
  if(!keys.length&&requireIdentity){rejected.add(i);continue;}
  for(const key of keys){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
 }
 const canonical=v=>v&&typeof v==='object'?
  Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 for(const ids of groups.values()){
  if(ids.length<2)continue;
  const signature=i=>JSON.stringify(canonical(input[i]));
  const first=signature(ids[0]);
  if(ids.some(i=>signature(i)!==first))ids.forEach(i=>rejected.add(i));
  else ids.slice(1).forEach(i=>duplicates.add(i));
 }
 return {rows:input.filter((_,i)=>!rejected.has(i)&&!duplicates.has(i)),
  conflicts:rejected.size,duplicates:[...duplicates].filter(i=>!rejected.has(i)).length};
}


// Both research views and the approval reducer use this same known-withdrawal
// projection. A recovered source does not repair an older validation window.
function reviewSourceIds(state,sourceIds,frozenAt,asOf){
 const ids=new Set(Array.isArray(sourceIds)?sourceIds.filter(id=>typeof id==='string'&&id):[]);
 const at=sampleEvidenceTime(asOf),created=sampleEvidenceTime(frozenAt),affected=new Set();
 if(!ids.size)return {ids,affected};
 const visible=(Array.isArray(state?.trades)?state.trades:[]).filter(row=>learningIdentityVisibleAt(row,at));
 const scoped=visible.filter(row=>state?.scope==='demo'||!isLearningTestSample(row));
 const resolved=uniqueEvidenceRows(scoped,{requireIdentity:true,settlements:true,testSample:isLearningTestSample});
 const retained=new Set(resolved.rows.map(row=>row.id)),scopedIds=new Set(scoped.map(row=>row.id));
 // Source IDs may also refer to historical K-line labels. Absence alone is
 // not revocation, but known conflicting/teaching-only trade IDs are.
 for(const row of scoped)if(ids.has(row.id)&&!retained.has(row.id))affected.add(row.id);
 if(state?.scope!=='demo')for(const row of visible)
  if(ids.has(row.id)&&isLearningTestSample(row)&&!scopedIds.has(row.id))affected.add(row.id);
 for(const row of state?.trades||[]){
  const review=row?.planEvidenceReview;
  if(!review||!ids.has(row.id)||state?.scope!=='demo'&&isLearningTestSample(row))continue;
  const first=sampleEvidenceTime(review.firstQuarantinedAt),last=sampleEvidenceTime(review.lastQuarantinedAt);
  if(first!==null&&last!==null&&first<=last&&at!==null&&first>at)continue;
  const restored=sampleEvidenceTime(review.revalidatedAt);
  const usable=review.status==='revalidated'&&at!==null&&created!==null&&first!==null&&last!==null&&restored!==null&&
    first<=last&&last<=restored&&restored<=created&&created<=at;
  if(!usable)affected.add(row.id);
 }
 return {ids,affected};
}
function reviewSummary(checks){
 const ids=new Set(),affected=new Set();
 for(const check of checks){for(const id of check.ids)ids.add(id);for(const id of check.affected)affected.add(id);}
 return {status:affected.size?'requires-revalidation':ids.size?'no-known-revocation':'unavailable',
  affectedSources:affected.size,canTrade:false};
}
function candidateChecks(state,candidate,asOf){
 return [reviewSourceIds(state,candidate?.sourceIds,candidate?.createdAt,asOf),
  reviewSourceIds(state,candidate?.numericModel?.sourceIds,candidate?.numericModel?.trainCutoff,asOf)];
}
export function candidateEvidenceReview(state,candidate,asOf){
 return reviewSummary(candidateChecks(state,candidate,asOf));
}
export function approvedModelEvidenceReview(state,version,asOf){
 // The numeric basis can survive the original candidate archive and is
 // independently bound to its own training cutoff, not today's proposal date.
 // Explicit centre adjustments also depend on their original approved parent.
 const checks=[],queue=version?[version]:[],seen=new Set();
 const candidates=Array.isArray(state?.candidates)?state.candidates:[],versions=Array.isArray(state?.versions)?state.versions:[];
 while(queue.length){
  const v=queue.pop();if(seen.has(v))continue;seen.add(v);
  checks.push(reviewSourceIds(state,v.numericModel?.sourceIds,v.numericModel?.trainCutoff,asOf));
  for(const c of candidates.filter(c=>c?.id&&c.id===v.candidateId)){
   checks.push(...candidateChecks(state,c,asOf));
   if((c.centerFeedback||c.numericModel?.adjustment)&&Number.isSafeInteger(c.baseVersion)&&c.baseVersion>0&&c.baseVersion<v.number)
    queue.push(...versions.filter(parent=>parent.number===c.baseVersion));
  }
 }
 return reviewSummary(checks);
}
