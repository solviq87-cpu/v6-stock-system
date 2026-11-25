import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import workspaceStore from '../../core/research-workspace-store.js';
import accountLock from '../../core/account-process-lock.js';
import marketData from '../../core/market-data-center.js';
import decisionPlans from '../../core/paper-decision-plan.js';
import {mutate} from './engine.mjs';
import minuteArchive from '../shortline-minute-archive.js';
import {bookIdOk,booksOf,bookPath,createBook} from './workbooks.mjs';
import {seedDemo} from './demo.mjs';
import {mergePressureHistory} from '../../../public/nova/shortline/pressure.mjs';
import {observeDerivedFactors} from '../../../public/nova/shortline/derived-factor-observations.mjs';
import {learningSnapshot} from '../../../public/nova/shortline/learning.mjs';
import {dictionaryVersion,factorPacket,factorDictionary} from '../../../public/nova/shortline/factor-dictionary.mjs';

const catalogFile=fileURLToPath(new URL('../../../public/nova/shortline/catalog.json',import.meta.url));
const arrays=['market','marketHistory','checks','plans','trades','explanations','candidates','versions','notes','bars','corrections','checkins'];
const archiveLimit=64*1024*1024;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=(message,httpStatus)=>Object.assign(new Error(message),{httpStatus});
function initial(scope='live'){
  return {scope,revision:0,schemaVersion:1,researchOnly:true,canTrade:false,canNotify:false,...Object.fromEntries(arrays.map(k=>[k,[]]))};
}
function load(root,scope='live'){
  const file=path.join(workspaceStore.privateRoot(root),'research.json');
  let fd;
  try {
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  } catch(e){if(e.code==='ENOENT')return initial(scope);throw e;}
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.mode&0o077||stat.size>archiveLimit)throw Error();
    const {digest,state}=JSON.parse(fs.readFileSync(fd,'utf8'));
    if(hash(state)!==digest||state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<1||arrays.some(k=>!Array.isArray(state[k])))throw Error();
    if((state.scope||'live')!==scope)throw Error();
    state.scope=scope;
    attachMinuteBars(root,state);
    return state;
  }catch{throw error('私有研究档案校验失败，请检查受控备份',503);}finally{fs.closeSync(fd);}
}
// Bind the selected day for validation and learning without copying minute
// arrays into research.json, its digest, or unrelated background writes.
function minuteRoot(root,state){
  if(!state.minuteGeneration)return root;
  if(!/^[a-f0-9-]{36}$/.test(state.minuteGeneration))throw error('分钟档案代次无效',503);
  return path.join(root,'minute-generations',state.minuteGeneration);
}
function attachMinuteBars(root,state){
  const obs=state.v6Observation;
  if(!obs)return;
  let rows;
  Object.defineProperty(obs,'minuteBars',{configurable:true,enumerable:false,get(){
    return rows??=minuteArchive.readMinuteBars(minuteRoot(root,state),obs);
  }});
}
function responseState(state,catalog,replica){
  const obs=state.v6Observation;
  return {...state,...(obs?{v6Observation:{...obs,minuteBars:obs.minuteBars||[]}}:{}),catalog,permissions:{role:'edit',replica,canWrite:!replica}};
}
function checkFingerprint(check){
  const {id,createdAt,observedAt,asOf,sourceFingerprint,...facts}=check;
  return hash(facts);
}
async function syncAdapters(){
  const [{default:source},{default:paper}]=await Promise.all([import('../shortline-v6-data.js'),import('../shortline-paper-import.js')]);
  return {applySource:source.applyShortlineV6Source,readSettlements:paper.importSettledPaperTrades};
}
function applySnapshot(state,snapshot,{applySource,readSettlements},root,mainBook){
  const {minuteBars=[],bars=[],...capture}=snapshot;
  const daily=[],minutes=[...minuteBars];
  for(const row of bars){
    if(['stock','sector'].includes(row.role)&&['1m','5m'].includes(row.period))minutes.push(row);
    else daily.push(row);
  }
  const minuteReport=minutes.length?minuteArchive.saveMinuteBars(minuteRoot(root,state),capture,minutes):{added:0,confirmed:0,conflicts:0};
  const info=applySource(state,{...capture,bars:daily});
  mergePressureHistory(state,capture.stock?.pressure);
  if(minuteReport.conflicts)info.missing=[...(info.missing||[]),'分钟行情与首次冻结值冲突 '+minuteReport.conflicts+' 条，使用首次记录'];
  // Only the account service's sealed fills can create a tagged paper sample.
  // The request cannot choose an account file, inject trades or supply an as-of clock.
  const settlements=mainBook?readSettlements(state):{imported:0,exitDays:[]};
  const {code,day,stock={},name,observedAt,latestClosedDay}=snapshot;
  const latestClosed=snapshot.latestClosed===true&&day===latestClosedDay;
  state.v6Observation={code,day,name:name||stock.name||code,stock,observedAt,observedAtMs:snapshot.observedAtMs,latestClosed,latestClosedDay:latestClosedDay||null,
    asOf:latestClosed?observedAt:day+' 15:00',missing:info.missing||[],evidence:info.evidence||[]};
  attachMinuteBars(root,state);
  const derived=observeDerivedFactors(state,state.v6Observation);
  if(Object.keys(derived).length){
    stock.factorEvidence={...stock.factorEvidence,...derived};
    stock.factorCodes=[...new Set([...(stock.factorCodes||[]),...Object.keys(derived)])];
    state.v6Observation.evidence=[...state.v6Observation.evidence,...Object.values(derived).map(e=>e.text)];
  }
  const record=mutate(state,'check',{date:day,code,name:state.v6Observation.name});
  const fingerprint=checkFingerprint(record);
  const prior=state.checks.slice(0,-1).find(c=>c.sourceFingerprint===fingerprint);
  if(prior)state.checks.pop();
  else record.sourceFingerprint=fingerprint;
  const candidate=mutate(state,'learn:auto-candidate',{});
  for(const exitDay of new Set(settlements.exitDays||[]))if(exitDay!==day)refreshDailyReview(state,exitDay);
  const note=refreshDailyReview(state,day);
  return {...info,minuteReport,settlements,code,day,name:state.v6Observation.name,stock,missing:state.v6Observation.missing,
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
  if(action==='journal:flat')return result.end||result.endDate||result.date;
  if(action==='import:ths'&&result.count>0)return result.days?.at(-1);
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
    const changed=result.changed||paper.imported>0||paper.updated>0;
    if(changed){
      state.catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
      for(const day of new Set([...(result.exitDays||[]),...paper.exitDays]))refreshDailyReview(state,day);
      mutate(state,'learn:auto-candidate',{});
      persist(dir,state);
    }
    return {changed,revision:state.revision,imported:result.imported+paper.imported,updated:paper.updated||0,retry:!!(result.issues?.length||paper.issues.length)};
  });
}
// Market-only recovery also runs when the user's research and candidate pools are empty.
export async function saveRecoveredMarket(root,rows,day){
  const {applyShortlineV6Source}=await import('../shortline-v6-data.js');
  const dir=workspaceStore.privateRoot(root,true);
  return accountLock.withAccountLock(path.join(dir,'shortline'),()=>{
    const state=load(dir);
    const changed=applyShortlineV6Source(state,{day,bars:[],market:rows,missing:[],evidence:[],latestClosed:false});
    if(changed.daysAdded||changed.daysRevised){
      state.catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
      const now=Date.now();
      state.marketResearchAsOf={day,knownAt:now};
      refreshDailyReview(state,day);
      persist(dir,state);
    }
    return {revision:state.revision};
  });
}
// The main account keeps its original path. Named books and fixtures can never
// select an upstream ledger or a filesystem path supplied by the client.
export async function shortlineJob({root,book='main',replica=false,input,snapshot,view,knownDictionary,selection='standard',degraded,decisionPlan,centerFeedback,beforeCenterCommit,beforeDecisionCommit}){
  if(!bookIdOk(book))throw error('无效研究账户',400);
  const scope=book==='demo'?'demo':'live',main=book==='main';
  const master=load(root),books=booksOf(master),current=books.find(b=>b.id===book);
  if(!current)throw error('研究账户不存在',404);
  const dir=workspaceStore.privateRoot(bookPath(root,book),Boolean(input)&&!replica);
  const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  const present=(state)=>{
    const out=responseState(state,catalog,replica);
    out.book=current;out.books=main?booksOf(state):books;out.dictionaryVersion=dictionaryVersion;
    if(knownDictionary===dictionaryVersion)delete out.catalog;
    return out;
  };
  if(!input){
    const state=main?master:load(dir,scope);
    if(view==='model'){
      const packet=factorPacket({...state,catalog});
      if(knownDictionary!==dictionaryVersion)packet.mapping=factorDictionary(catalog).entries;
      return {ok:true,result:packet};
    }
    if(view==='home'){
      const perf=learningSnapshot({...state,catalog},{selection,includeTest:book==='demo'});
      return {ok:true,result:{book:current,revision:state.revision,asOf:perf.asOf,rows:perf.strategyByTrend,
        totals:perf.totals,strategies:catalog.filter(c=>c.kind==='strategy').map(c=>c.name),selection}};
    }
    if(view==='notices'){
      const {noticeView}=await import('./web-notices.mjs');
      return {ok:true,result:noticeView({root,dir,book,state})};
    }
    return {ok:true,state:present(state)};
  }
  if(replica)throw error('副本只读，请在主实例保存研究记录',409);
  if(book==='demo'&&input.action==='v6:sync')throw error('演示库仅使用教学行情',422);
  if(degraded&&input.action==='v6:sync'){
    const state=main?master:load(dir,scope);
    return {ok:true,state:present(state),result:{degraded:true,confidence:0,code:input.payload.code,day:input.payload.day||null,
      missing:['原始行情本次未能核实'],emotion:{stage:'未判定',confidence:0},position:0}};
  }
  const notice=input.action.startsWith('notice:')||input.action.startsWith('settings:')||input.action==='book:reset'?await import('./web-notices.mjs'):null;
  const apply=input.action==='v6:sync'?await syncAdapters():null;
  // Existing archive reads do not depend on the optional centre configuration.
  const center=input.action==='learn:center-feedback'&&centerFeedback?await import('./center-feedback.mjs'):null;
  const decisionResearch=decisionPlan?(await import('../../core/decision-plan-research.js')).default:null;
  return accountLock.withAccountLock(path.join(dir,'shortline'),()=>{
    let state=load(dir,scope),retiredMinuteDir=null;
    if(input.revision!==state.revision)throw error('另一台设备已更改档案，请重新读取后再提交',409);
    state.catalog=catalog;
    let result;
    try{
      const p=input.payload;
      if(input.action.startsWith('notice:')){
        if(book==='demo')throw Error('演示库只提供站内演示');
        result=notice.noticeDeviceAction({root,dir,book,action:input.action,payload:p,replica});
        return {ok:true,state:present(state),result};
      }
      if(input.action==='v6:sync')result=applySnapshot(state,snapshot,apply,dir,main);
      else if(input.action==='book:create'){
        if(!main)throw Error('请从主研究账户建立新账户');
        result=createBook(state,p);
      }else if(input.action==='book:demo')result=seedDemo(state);
      else if(input.action==='book:lock'){
        if(typeof p.locked!=='boolean')throw Error('锁定状态无效');
        state.resetLocked=p.locked;result={locked:p.locked};
      }else if(input.action==='book:reset'){
        if(state.resetLocked||p.confirmation!=='清空'+current.name||p.book!==book)throw Error('请先解除清空保护并输入当前账户的完整确认文字');
        // Flip the generation together with the state revision. A crash after
        // commit cannot reattach retired shards, even if cleanup is interrupted.
        retiredMinuteDir=path.join(minuteRoot(dir,state),'minutes-v1');
        state={...initial(scope),revision:state.revision,books:state.books,settingsHistory:state.settingsHistory,
          settingsProfiles:state.settingsProfiles,ledgerStartAt:Date.now(),minuteGeneration:crypto.randomUUID(),resetLocked:false};
        result={book,reset:true};
      }else if(input.action==='learn:center-feedback'){
        if(!main||!centerFeedback||decisionPlan||Object.keys(p).length)throw Error('中心反馈只能由服务端专用入口复算，客户端不得提交权重或授权标志');
        result=center.applyCenterFeedback(state,centerFeedback);
      }else{
        if(centerFeedback)throw Error('中心反馈服务端上下文与操作不匹配');
        if(decisionPlan&&(!main||input.action!=='learn:plan'))throw Error('服务器决策计划只能冻结到原主研究档案');
        // Re-read and validate the exact preparation-time check under the
        // original archive lock. A missing link stays missing; do not bind a
        // check created after the card, or choose a replacement at commit.
        const research=decisionPlan?decisionResearch.prepareDecisionPlanResearch(decisionPlan,
          {...state,dictionaryVersion},{now:Date.now(),checkId:p.checkId??null}):null;
        const planInput=research?{...p}:p;
        if(research){
          delete planInput.checkId;
          if(research.payload.checkId)planInput.checkId=research.payload.checkId;
        }
        result=mutate(state,input.action,planInput);
        // Only the native paper adapter supplies this internal job argument.
        // The browser research route never accepts or forwards an authority flag.
        if(decisionPlan){
          decisionPlans.bindAuthoritativePlan(result,decisionPlan);
          result.researchFactorReference={...research.researchReference,frozenAt:result.frozenAt};
        }
        const day=affectedDay(state,input.action,result);
        if(day)refreshDailyReview(state,day);
        if(input.action==='learn:decision'){
          const item=state.candidates.find(c=>c.id===p.id);
          if(item?.decision)item.decision.authorizedRole='edit';
        }
      }
    }catch(e){throw error(e.message,422);}
    if(centerFeedback){
      let authorized=false;
      try{authorized=typeof beforeCenterCommit==='function'&&beforeCenterCommit()===true;}catch{}
      if(!authorized)throw error('中心提案提交前编辑授权或主实例角色已变化，原档案保留',403);
    }
    if(decisionPlan){
      let authorized=false;
      try{authorized=typeof beforeDecisionCommit==='function'&&beforeDecisionCommit()===true;}catch{}
      if(!authorized)throw error('冻结计划提交前编辑授权或主实例角色已变化，原档案保留',403);
    }
    // Optional fields of v1 archives are absent on older installations.
    persist(dir,state);
    // Report a committed revision even if a secondary cleanup fails. The
    // generation and ledger cutoff already exclude the retired records.
    const maintenance=[];
    if(notice){
      try{
        if(input.action==='book:reset'&&book!=='demo')notice.resetNoticeArchive({dir});
        notice.syncNoticeSchedule({dir,state,book});
      }catch{maintenance.push('本账户的网页通知索引需要重新同步');}
    }
    if(retiredMinuteDir){
      try{fs.rmSync(retiredMinuteDir,{recursive:true,force:true});}
      catch{maintenance.push('已隔离的旧分钟档案需要清理');}
    }
    return {ok:true,state:present(state),result:result??null,...(maintenance.length?{maintenance}:{})};
  });
}

export async function runBookNotices({root,book,day,now,primaryFlag}){
  if(book==='demo'||!bookIdOk(book)||!primaryFlag)return;
  const isPrimary=()=>Atomics.load(new Int32Array(primaryFlag),0)===1;
  if(!isPrimary())return;
  if(book!=='main'&&!booksOf(load(root)).some(b=>b.id===book))return;
  const dir=workspaceStore.privateRoot(bookPath(root,book));
  const {tickWebNotices}=await import('./web-notices.mjs');
  const file=path.join(dir,'research.json'),stat=fs.statSync(file,{throwIfNoEntry:false});
  if(!stat)return;
  const state=load(dir);state.catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  const isCurrent=()=>{
    const s=fs.statSync(file,{throwIfNoEntry:false});
    return s?.ino===stat.ino&&s?.dev===stat.dev&&s?.mtimeMs===stat.mtimeMs;
  };
  return tickWebNotices({root,dir,book,state,day,now,tradingDay:true,primary:true,isPrimary,isCurrent});
}
