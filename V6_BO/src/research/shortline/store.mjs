import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import workspaceStore from '../../core/research-workspace-store.js';
import accountLock from '../../core/account-process-lock.js';
import marketData from '../../core/market-data-center.js';
import {mutate} from './engine.mjs';

const catalogFile=fileURLToPath(new URL('../../../public/nova/shortline/catalog.json',import.meta.url));
const arrays=['market','marketHistory','checks','plans','trades','explanations','candidates','versions','notes','bars','corrections','checkins'];
const archiveLimit=64*1024*1024;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=(message,httpStatus)=>Object.assign(new Error(message),{httpStatus});
function initial(){
  return {scope:'live',revision:0,schemaVersion:1,researchOnly:true,canTrade:false,canNotify:false,...Object.fromEntries(arrays.map(k=>[k,[]]))};
}
function load(root){
  const file=path.join(workspaceStore.privateRoot(root),'research.json');
  let fd;
  try {
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  } catch(e){if(e.code==='ENOENT')return initial();throw e;}
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.mode&0o077||stat.size>archiveLimit)throw Error();
    const {digest,state}=JSON.parse(fs.readFileSync(fd,'utf8'));
    if(hash(state)!==digest||state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<1||arrays.some(k=>!Array.isArray(state[k])))throw Error();
    return state;
  }catch{throw error('私有研究档案校验失败，请检查受控备份',503);}finally{fs.closeSync(fd);}
}
function responseState(state,catalog,replica){
  return {...state,catalog,permissions:{role:'edit',replica,canWrite:!replica}};
}
function checkFingerprint(check){
  const {id,createdAt,observedAt,asOf,sourceFingerprint,...facts}=check;
  return hash(facts);
}
async function syncAdapters(){
  const [{default:source},{default:paper}]=await Promise.all([import('../shortline-v6-data.js'),import('../shortline-paper-import.js')]);
  return {applySource:source.applyShortlineV6Source,readSettlements:paper.importSettledPaperTrades};
}
function applySnapshot(state,snapshot,{applySource,readSettlements}){
  const info=applySource(state,snapshot);
  // Only the account service's sealed fills can create a tagged paper sample.
  // The request cannot choose an account file, inject trades or supply an as-of clock.
  const settlements=readSettlements(state);
  const {code,day,stock={},name,observedAt,latestClosedDay}=snapshot;
  const latestClosed=snapshot.latestClosed===true&&day===latestClosedDay;
  state.v6Observation={code,day,name:name||stock.name||code,stock,observedAt,observedAtMs:snapshot.observedAtMs,latestClosed,latestClosedDay:latestClosedDay||null,
    asOf:latestClosed?observedAt:day+' 15:00',missing:info.missing||[],evidence:info.evidence||[]};
  const record=mutate(state,'check',{date:day,code,name:state.v6Observation.name});
  const fingerprint=checkFingerprint(record);
  const prior=state.checks.slice(0,-1).find(c=>c.sourceFingerprint===fingerprint);
  if(prior)state.checks.pop();
  else record.sourceFingerprint=fingerprint;
  const candidate=mutate(state,'learn:auto-candidate',{});
  for(const exitDay of new Set(settlements.exitDays||[]))if(exitDay!==day)refreshDailyReview(state,exitDay);
  const note=refreshDailyReview(state,day);
  return {...info,settlements,code,day,name:state.v6Observation.name,stock,missing:state.v6Observation.missing,
    observedAt,checkId:(prior||record).id,reviewId:note.id,candidateId:candidate?.id||null};
}
function refreshDailyReview(state,day){
  const note=mutate(state,'review:generate',{date:day,period:'day',depth:'brief'});
  const previous=state.notes.slice(0,-1).find(n=>n.kind===note.kind&&n.period===note.period&&n.date===day&&n.text===note.text);
  if(previous){state.notes.pop();return previous;}
  note.source='V6 自动复盘';
  return note;
}
function affectedDay(state,action,result){
  if(action==='learn:trade')return result.exitDate;
  if(['review:note','review:checkin','check','market'].includes(action))return result.date;
  if(action==='k:correct')return result.date?.slice(0,10);
  // Each CSV is one research batch. Refresh its latest observation day;
  // historical dates and periods remain individually queryable on demand.
  if(action==='k:import'&&result.count>0){
    return state.bars.slice(-result.count).reduce((day,b)=>day>b.date.slice(0,10)?day:b.date.slice(0,10),'');
  }
}
function persist(dir,state){
  delete state.catalog;
  delete state.permissions;
  state.revision++;
  const raw=JSON.stringify({digest:hash(state),state});
  if(Buffer.byteLength(raw)>archiveLimit)throw error('研究档案超过 64 MiB，保留已有记录',413);
  marketData.atomicWrite(path.join(dir,'research.json'),raw);
}

// An internal projection of V6's append-only manual ledger. Its clock and root
// are supplied by the native service. Browsers cannot submit this operation.
export async function syncManualLedger(root,ledgerRoot,accountDir){
  const manualPresent=fs.existsSync(ledgerRoot);
  if(!manualPresent&&!accountDir)return {changed:false};
  const {importManualDecisionLoop}=await import('../shortline-manual-import.js');
  const {importSettledPaperTrades}=await import('../shortline-paper-import.js');
  const dir=workspaceStore.privateRoot(root,true);
  return accountLock.withAccountLock(path.join(dir,'shortline'),()=>{
    const state=load(dir);
    const result=manualPresent?importManualDecisionLoop(state,{root:ledgerRoot}):{changed:false,imported:0,exitDays:[]};
    const paper=accountDir?importSettledPaperTrades(state,{accountDir}):{imported:0,exitDays:[],issues:[]};
    const changed=result.changed||paper.imported>0;
    if(changed){
      state.catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
      for(const day of new Set([...(result.exitDays||[]),...paper.exitDays]))refreshDailyReview(state,day);
      mutate(state,'learn:auto-candidate',{});
      persist(dir,state);
    }
    return {changed,revision:state.revision,imported:result.imported+paper.imported,retry:!!(result.issues?.length||paper.issues.length)};
  });
}
export async function shortlineJob({root,replica=false,input,snapshot}){
  const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  if(!input)return {ok:true,state:responseState(load(root),catalog,replica)};
  if(replica)throw error('副本只读，请在主实例保存研究记录',409);
  const apply=input.action==='v6:sync'?await syncAdapters():null;
  const dir=workspaceStore.privateRoot(root,true);
  return accountLock.withAccountLock(path.join(dir,'shortline'),()=>{
    const state=load(dir);
    if(input.revision!==state.revision)throw error('另一台设备已更改档案，请重新读取后再提交',409);
    state.catalog=catalog;
    let result;
    try{
      if(input.action==='v6:sync')result=applySnapshot(state,snapshot,apply);
      else {
        result=mutate(state,input.action,input.payload);
        const day=affectedDay(state,input.action,result);
        if(day)refreshDailyReview(state,day);
        if(input.action==='learn:decision'){
          // The human-entered display name is separate from the authorizing V6 role.
          const item=state.candidates.find(c=>c.id===input.payload.id);
          if(item?.decision)item.decision.authorizedRole='edit';
        }
      }
    }catch(e){throw error(e.message,422);}
    persist(dir,state);
    return {ok:true,state:responseState(state,catalog,replica),result:result??null};
  });
}
