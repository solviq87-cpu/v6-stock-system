// UI-only read receipts. Never authorize a trade, a notification mutation or a
// risk release; the existing server must recheck its own epoch and revision.
export const RISK_VIEW_MAX_AGE_MS=15000;
const time=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const elapsed=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const account=x=>x==='pool'||x==='pre';
export function validateRiskRead(reply,accountId,selectedCode=null){
 const r=reply?.result;
 if(!account(accountId)||selectedCode!=null&&!code(selectedCode)||reply?.ok!==true||r?.protocol!=='fayo-risk-workbench-v1'||
    r.account?.id!==accountId||!time(r.generatedAt)||!Array.isArray(r.risks)||!r.summary||
    (selectedCode==null?r.selectedCode!=null:r.selectedCode!==selectedCode))
  throw Error('未取得同一账户、标的与观察时点的完整风险回执');
 return r;
}
// Subtract the age already consumed by current price-dependent source rows.
// Server-generated time and original observation time are in the same clock
// domain; local elapsed time only makes this budget smaller, never larger.
function originalAgeBudget(report){
 let budget=RISK_VIEW_MAX_AGE_MS;
 const apply=at=>{budget=Math.min(budget,time(at)&&at<=report.generatedAt?RISK_VIEW_MAX_AGE_MS-(report.generatedAt-at):0);};
 for(const r of Array.isArray(report.risks)?report.risks:[])
  if(r?.priceDependent===true&&r.dataState==='valid')apply(r.riskContract?.dataAt??r.sourceAt);
 for(const p of Array.isArray(report.equity?.positions)?report.equity.positions:[])
  if(p?.evidenceStatus==='available')apply(p.quote?.quoteAt);
 for(const q of Array.isArray(report.rules?.quoteEvidence)?report.rules.quoteEvidence:[])
  if(q?.usable===true)apply(q.quoteAt);
 for(const a of Array.isArray(report.actions?.items)?report.actions.items:[])
  if(['triggered','not-triggered'].includes(a?.condition?.status))apply(a.condition.quoteAt);
 const odds=boundRiskResearch(report,'planOdds');
 for(const row of Array.isArray(odds?.rows)?odds.rows:[])
  if(['price-geometry-only','stop-reached','target-reached','entry-range-expired'].includes(row?.status))apply(row.quoteAt);
 return Math.max(0,budget);
}
export function createRiskViewReceipt({report,accountId,selectedCode=null,startedAt,receivedAt}={}){
 if(!report||report.account?.id!==accountId||!time(report.generatedAt)||
    (selectedCode==null?report.selectedCode!=null:report.selectedCode!==selectedCode)||
    !elapsed(startedAt)||!elapsed(receivedAt)||receivedAt<startedAt)return null;
 const budget=originalAgeBudget(report);
 if(receivedAt-startedAt>=budget)return null;
 return Object.freeze({report,accountId,selectedCode,startedAt,receivedAt,expiresAt:startedAt+budget});
}
export function remainingRiskViewMs(receipt,now){
 if(!receipt||!elapsed(now)||now<receipt.receivedAt||now>=receipt.expiresAt)return 0;
 return receipt.expiresAt-now;
}
export function riskViewMatches(receipt,{report,accountId,selectedCode=null,now,available,editable,aborted=false}={}){
 return !!(receipt&&receipt.report===report&&receipt.accountId===accountId&&receipt.selectedCode===selectedCode&&
  remainingRiskViewMs(receipt,now)>0&&available===true&&editable===true&&aborted===false);
}
// A scope belongs to the selected security, not merely to its in-flight fetch.
// Changing scopes detaches the former signal; a later abort of the old scope
// cannot invalidate the new one. Disposal removes its listener as well.
export function createRiskScope(onAbort){
 let signal=null,handler=null,valid=true;
 function detach(){if(signal&&handler)signal.removeEventListener('abort',handler);signal=handler=null;}
 function set(next){
  if(next===signal)return valid&&!signal?.aborted;
  detach();signal=next||null;valid=true;
  if(!signal)return true;
  if(signal.aborted){detach();valid=false;onAbort();return false;}
  const current=signal;
  handler=()=>{if(signal!==current)return;detach();valid=false;onAbort();};
  signal.addEventListener('abort',handler,{once:true});return true;
 }
 return {set,detach,active:()=>valid&&!signal?.aborted};
}
// The optional C research sections are subordinate to the SAME original risk
// report. A wrong account/epoch/snapshot/clock is not current evidence. Keep
// the original workbench report and fail only the optional section closed.
export function boundRiskResearch(report,key){
 const stress=report?.stress,e=report?.equity,x=stress?.[key];
 const expected=key==='adversePaths'?'fayo-adverse-path-research-v1':key==='planOdds'?'fayo-frozen-plan-odds-research-v1':null;
 if(!expected||!x||x.protocol!==expected||x.researchOnly!==true||x.canTrade!==false||x.canNotify!==false||
    x.writesAccount!==false||x.accountMutated!==false||x.executionGuaranteed!==false||x.maximumLossGuarantee!==false||
    !account(report.account?.id)||!hash(report.accountEpoch)||!Number.isSafeInteger(report.accountRevision)||report.accountRevision<1||
    !time(report.generatedAt)||e?.accountId!==report.account.id||e.accountEpoch!==report.accountEpoch||
    e.source?.accountRevision!==report.accountRevision||e.observedAt!==report.generatedAt||!hash(e.fingerprint)||!hash(e.source?.snapshotFingerprint)||
    stress.accountId!==report.account.id||stress.accountEpoch!==report.accountEpoch||stress.asOf!==report.generatedAt||
    stress.generatedAt!==report.generatedAt||stress.equityEvidenceId!==e.fingerprint||stress.authoritySnapshotFingerprint!==e.source.snapshotFingerprint||
    x.accountId!==report.account.id||x.accountEpoch!==report.accountEpoch||x.accountRevision!==report.accountRevision||
    x.equityEvidenceId!==e.fingerprint||x.authoritySnapshotFingerprint!==e.source.snapshotFingerprint||x.asOf!==report.generatedAt)return null;
 return x;
}
