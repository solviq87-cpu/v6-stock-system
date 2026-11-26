'use strict';
// Admission only: existing jobs keep their own queues, deadlines and authority
// checks. These are declared V8 old-generation limits, not process RSS, native
// buffers, subprocess memory or an operating-system CPU reservation.
const {isMainThread,workerData}=require('node:worker_threads');
const KEY='__v6WorkerAdmissionBudgetV1',MAGIC=0x56364231n,MAX_ID=0x7fffffffn;
const definitions=Object.freeze({
 research:256,'adaptive-research':256,'research-workspace':384,
 'stock-observation':192,'public-factor':192,'linked-intelligence':192,
 'learning-runtime':192,'decision-financial-cache':192,'release-provenance':96,'advanced-account-risk':128
});
const names=Object.keys(definitions),HEADER=8,LENGTH=HEADER+names.length*2;
// Slots 2/3 belong exclusively to background work; slot 4 is reserved for risk.
// Every background declaration is <=384 MiB, so two atomic slots also enforce
// the fixed 768 MiB aggregate even during an interrupted metadata publication.
const lanes=Object.freeze({background:Object.freeze({slots:[2,3],maxWorkers:2,maxOldGenerationSizeMb:768}),
 risk:Object.freeze({slots:[4],maxWorkers:1,maxOldGenerationSizeMb:128})});
const inherited=!isMainThread&&workerData&&typeof workerData==='object'?workerData[KEY]:null;
// Private transport metadata never enters a research hash, report or archive.
if(!isMainThread&&workerData&&typeof workerData==='object')delete workerData[KEY];
let state=null,owner=0n;
if(isMainThread){state=new BigInt64Array(new SharedArrayBuffer(LENGTH*8));Atomics.store(state,0,MAGIC);}
else if(inherited?.shared instanceof SharedArrayBuffer&&inherited.shared.byteLength===LENGTH*8&&
 typeof inherited.owner==='bigint'&&inherited.owner>0n&&inherited.owner<=MAX_ID&&typeof inherited.token==='bigint'){
 const candidate=new BigInt64Array(inherited.shared);
 if(Atomics.load(candidate,0)===MAGIC&&inherited.token>>32n===inherited.owner&&
   [2,3,4].some(slot=>Atomics.load(candidate,slot)===inherited.token)){
  state=candidate;owner=inherited.owner;
 }
}
function count(index){if(state)Atomics.add(state,index,1n);}
function tryAcquire(kind){
 const index=names.indexOf(kind);if(index<0||!state)return null;
 const lane=kind==='advanced-account-risk'?lanes.risk:lanes.background;
 let id=null,token=null,slot=null;
 // No Atomics.wait, retry timer or admission queue on the quote/event thread.
 for(let turn=0;turn<8&&slot===null;turn++)for(const candidate of lane.slots){
  if(Atomics.load(state,candidate)!==0n)continue;
  if(id===null){id=Atomics.add(state,1,1n)+1n;if(id>MAX_ID)break;token=((owner||id)<<32n)|id;}
  if(id>MAX_ID)break;
  if(Atomics.compareExchange(state,candidate,0n,token)===0n){slot=candidate;break;}
 }
 if(slot===null){count(HEADER+index*2+1);return null;}
 Atomics.store(state,slot+3,(id<<8n)|BigInt(index+1));count(HEADER+index*2);
 const root=owner||id;let released=false,worker=null,resolveStopped;
 const stopped=new Promise(resolve=>{resolveStopped=resolve;});
 function release(){
  if(released)return;released=true;
  // Terminating a parent stops its nested workers, but does not execute the
  // parent's child-exit/finally callbacks. Reclaim only this stopped root's
  // leases. Unique tokens prevent a late release from clearing a reused slot.
  if(root===id){
   for(const candidate of [2,3,4]){const current=Atomics.load(state,candidate);
    if(current!==0n&&current>>32n===root)Atomics.compareExchange(state,candidate,current,0n);
   }
  }else Atomics.compareExchange(state,slot,token,0n);
  resolveStopped(true);
 }
 return Object.freeze({
  options(payload){return {workerData:{...payload,[KEY]:{shared:state.buffer,owner:root,token}},
   resourceLimits:{maxOldGenerationSizeMb:definitions[kind]}};},
  watch(value){worker=value;worker.once('exit',release);return worker;},
  async stop(){
   if(released)return true;
   if(!worker){release();return true;}
   try{await worker.terminate();release();return true;}
   catch{return stopped;} // Wait for the actual exit; an uncertain stop keeps its lease.
  }
 });
}
function stats(){
 const jobs=names.map((type,index)=>({type,active:0,declaredOldGenerationSizeMb:definitions[type],
  admitted:state?Number(Atomics.load(state,HEADER+index*2)):null,
  rejected:state?Number(Atomics.load(state,HEADER+index*2+1)):null}));
 const result={scope:'declared-worker-v8-old-generation-only',available:state!==null,
  background:{maxWorkers:2,maxOldGenerationSizeMb:768,active:0,declaredOldGenerationSizeMb:0},
  risk:{maxWorkers:1,maxOldGenerationSizeMb:128,active:0,declaredOldGenerationSizeMb:0},jobs};
 if(state)for(const slot of [2,3,4]){
  const token=Atomics.load(state,slot);if(token===0n)continue;
  const lane=slot===4?result.risk:result.background,metadata=Atomics.load(state,slot+3);
  const index=Number(metadata&255n)-1,known=metadata>>8n===(token&0xffffffffn)&&jobs[index];
  // Metadata can lag its lease by a few instructions. Count conservatively.
  lane.active++;lane.declaredOldGenerationSizeMb+=known?jobs[index].declaredOldGenerationSizeMb:slot===4?128:384;
  if(known)jobs[index].active++;
 }
 return result;
}
module.exports={tryAcquire,stats};
