'use strict';
/** Isolated, durable offline order command log. Never mutates legacy PAPER or a broker. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createPaperOrderLedger}=require('./paper-order-lifecycle');
const {withAccountLock}=require('./account-process-lock');
const MAX_BYTES=16*1024*1024,MAX_COMMANDS=50000;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
function atomic(file,data){
 const serialized=JSON.stringify(data)+'\n';
 if(Buffer.byteLength(serialized,'utf8')>MAX_BYTES)throw Error('账本文件达到容量上限');
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const temp=path.join(dir,`.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
 let fd;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,serialized);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);const d=fs.openSync(dir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}catch(e){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp)}catch{}throw e;}
}
function createDurablePaperOrderService({file,initialCash,feeBps=8,sellTaxBps=5,lotSize=100}){
 if(typeof file!=='string'||!file)throw Error('必须提供账本文件');
 const options={initialCash,feeBps,sellTaxBps,lotSize};
 const filePath=path.resolve(file);
 function replay(commands){const ledger=createPaperOrderLedger(options);for(const item of commands){if(!item||!['submit','fill','cancel','advanceTradingDay'].includes(item.action))throw Error('非法事件类型');const a=item.args;if(item.action==='submit')ledger.submit(a);else if(item.action==='fill')ledger.fill(a.orderId,a.fill);else if(item.action==='cancel')ledger.cancel(a.orderId,a.options);else ledger.advanceTradingDay(a.day)}const check=ledger.audit();if(!check.ok)throw Error('账务不守恒：'+check.errors.join(';'));return ledger;}
 // Never make a long-lived in-memory replay the authority for a later write.
 // Each successful read remembers the observed prefix, not a writable snapshot.
 let observed=null;
 function remember(commands,exists){
  if(exists)observed={count:commands.length,digest:digest(commands)};
 }
 function load(){
  let fd,doc,exists=true;
  try{
   // Atomic rename by cooperating writers makes an opened file a stable snapshot.
   // NOFOLLOW/NONBLOCK also reject symlinks and avoid blocking on a special file.
   if(fs.lstatSync(filePath).isSymbolicLink())throw Error('不安全的账本文件');
   fd=fs.openSync(filePath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
   const st=fs.fstatSync(fd);
   if(!st.isFile()||st.size>MAX_BYTES)throw Error('不安全的账本文件');
   const bytes=fs.readFileSync(fd);
   if(bytes.length>MAX_BYTES)throw Error('不安全的账本文件');
   doc=JSON.parse(bytes.toString('utf8'));
  }catch(error){
   if(error.code==='ENOENT'&&fd===undefined){
    if(observed)throw Error('已观察账本历史发生变化或文件丢失，拒绝重建');
    // On platforms lacking NOFOLLOW, also distinguish a dangling link from absence.
    try{fs.lstatSync(filePath);throw Error('不安全的账本文件');}catch(e){if(e.code!=='ENOENT')throw e;}
    exists=false;
   }else if(error.code==='ELOOP')throw Error('不安全的账本文件');
   else throw error;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  let commands=[],ids=new Map();
  if(exists){
   if(!doc||doc.schemaVersion!==1||!doc.options||digest(doc.options)!==digest(options)||!Array.isArray(doc.commands)||doc.commands.length>MAX_COMMANDS||doc.checksum!==digest({options:doc.options,commands:doc.commands}))throw Error('账本文件校验失败');
   commands=doc.commands;
   for(const item of commands){if(!item||typeof item.id!=='string'||ids.has(item.id)||item.fingerprint!==digest({action:item.action,args:item.args}))throw Error('账本事件重复或损坏');ids.set(item.id,item.fingerprint)}
   if(observed&&(commands.length<observed.count||digest(commands.slice(0,observed.count))!==observed.digest))throw Error('已观察账本历史发生变化，拒绝覆盖');
  }
  const ledger=replay(commands);
  remember(commands,exists);
  return {commands,ids,ledger};
 }
 // Preserve the original eager recovery check, including refusal of bad files.
 load();
 function view(commands,ledger){return {mode:'isolated-offline-paper',brokerConnected:false,legacyAccountMutated:false,revision:commands.length,...ledger.audit()}}
 function execute({id,action,args}){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('事件ID无效');
  if(!['submit','fill','cancel','advanceTradingDay'].includes(action))throw Error('事件操作无效');
  const storedArgs=clone(args),fingerprint=digest({action,args:storedArgs});
  fs.mkdirSync(path.dirname(filePath),{recursive:true,mode:0o700});
  // Reuse the existing stable kernel guard. Stop older unguarded writers before upgrade.
  return withAccountLock(filePath,()=>{
   const {commands,ids,ledger}=load();
   if(ids.has(id)){if(ids.get(id)!==fingerprint)throw Error('事件ID内容冲突');return {idempotent:true,...view(commands,ledger)}}
   if(commands.length>=MAX_COMMANDS)throw Error('账本事件达到容量上限');
   const next=commands.concat([{id,action,args:storedArgs,fingerprint}]);const candidate=replay(next);
   const doc={schemaVersion:1,options,commands:next,checksum:digest({options,commands:next})};
   atomic(filePath,doc);remember(next,true);
   return {idempotent:false,...view(next,candidate)};
  });
 }
 function read(){const {commands,ledger}=load();return view(commands,ledger)}
 return Object.freeze({execute,read});
}
module.exports={createDurablePaperOrderService};
