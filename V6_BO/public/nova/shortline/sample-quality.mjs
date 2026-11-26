// Quality and archive purpose are independent dimensions. Existing paper
// executions are real research observations unless explicitly marked as tests.
const yes=value=>value===true||value===1||['1','true','是'].includes(value);
export function isTestSample(row={}){
  return row?.sampleSet==='test'||row?.scope==='demo'||yes(row?.testSample)||yes(row?.isTest)||
    row?.quality==='教学样本'||row?.sampleSource==='教学样本'||/^合成教学样本/.test(row?.name||'');
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
// Resolve only already-visible, same-purpose records. Exact retries collapse;
// conflicting records sharing either identity are quarantined together.
export function uniqueEvidenceRows(rows,{requireIdentity=false,settlements=false}={}){
 const groups=new Map(),rejected=new Set(),duplicates=new Set(),input=Array.isArray(rows)?rows:[];
 for(let i=0;i<input.length;i++){
  const row=input[i];if(!row||typeof row!=='object'||Array.isArray(row)){rejected.add(i);continue;}
  const scope=isTestSample(row)?'test':'research',keys=[];
  if(typeof row.id==='string'&&row.id.trim())keys.push(JSON.stringify([scope,'id',row.id]));
  if(settlements&&row.paperSettlement!=null){
   const p=row.paperSettlement;
   if(typeof p.accountId!=='string'||!p.accountId.trim()||typeof p.exitEventId!=='string'||!p.exitEventId.trim()){
    rejected.add(i);continue;
   }
   keys.push(JSON.stringify([scope,'settlement',p.accountId,p.exitEventId]));
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
