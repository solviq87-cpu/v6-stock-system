'use strict';
/** Isolated, durable offline order command log. Never mutates legacy PAPER or a broker. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createPaperOrderLedger}=require('./paper-order-lifecycle');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
function atomic(file,data){
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const temp=path.join(dir,`.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
 let fd;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(data)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);const d=fs.openSync(dir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}catch(e){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp)}catch{}throw e;}
}
function createDurablePaperOrderService({file,initialCash,feeBps=8,sellTaxBps=5,lotSize=100}){
 if(typeof file!=='string'||!file)throw Error('必须提供账本文件');
 const options={initialCash,feeBps,sellTaxBps,lotSize};
 const filePath=path.resolve(file);
 function replay(commands){const ledger=createPaperOrderLedger(options);for(const item of commands){if(!item||!['submit','fill','cancel','advanceTradingDay'].includes(item.action))throw Error('非法事件类型');const a=item.args;if(item.action==='submit')ledger.submit(a);else if(item.action==='fill')ledger.fill(a.orderId,a.fill);else if(item.action==='cancel')ledger.cancel(a.orderId,a.options);else ledger.advanceTradingDay(a.day)}const check=ledger.audit();if(!check.ok)throw Error('账务不守恒：'+check.errors.join(';'));return ledger;}
 let commands=[],ids=new Map(),ledger;
 if(fs.existsSync(filePath)){
  const st=fs.lstatSync(filePath);if(!st.isFile()||st.isSymbolicLink()||st.size>16*1024*1024)throw Error('不安全的账本文件');
  const doc=JSON.parse(fs.readFileSync(filePath,'utf8'));
  if(!doc||doc.schemaVersion!==1||!doc.options||digest(doc.options)!==digest(options)||!Array.isArray(doc.commands)||doc.commands.length>50000||doc.checksum!==digest({options:doc.options,commands:doc.commands}))throw Error('账本文件校验失败');
  commands=doc.commands;for(const item of commands){if(typeof item.id!=='string'||ids.has(item.id)||item.fingerprint!==digest({action:item.action,args:item.args}))throw Error('账本事件重复或损坏');ids.set(item.id,item.fingerprint)}
 }
 ledger=replay(commands);
 // All commands, including automatic strategy fills, share this ONE durable log.
 // A batch is replayed and audited before its single atomic rename; failure commits nothing.
 function executeBatch(batch){
  if(!Array.isArray(batch)||batch.length===0||batch.length>100)throw Error('事务命令数量无效');
  const seen=new Set(),pending=[];
  for(const item of batch){
   const {id,action,args}=item||{};
   if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('事件ID无效');
   if(!['submit','fill','cancel','advanceTradingDay'].includes(action))throw Error('事件操作无效');
   if(seen.has(id))throw Error('同一事务事件ID重复');seen.add(id);
   const fingerprint=digest({action,args});
   if(ids.has(id)){
    if(ids.get(id)!==fingerprint)throw Error('事件ID内容冲突');
    // Do not allow partially repeated batches to apply a second time.
    continue;
   }
   pending.push({id,action,args:clone(args),fingerprint});
  }
  if(pending.length!==batch.length&&pending.length!==0)throw Error('事务部分重放，拒绝写入');
  if(!pending.length)return {idempotent:true,...read()};
  if(commands.length+pending.length>50000)throw Error('账本事件达到容量上限');
  const next=commands.concat(pending),candidate=replay(next);
  const doc={schemaVersion:1,options,commands:next,checksum:digest({options,commands:next})};
  atomic(filePath,doc);
  commands=next;for(const item of pending)ids.set(item.id,item.fingerprint);ledger=candidate;
  return {idempotent:false,...read()};
 }
 function execute(command){return executeBatch([command])}
 // An auto trade is NOT a second balance update. It is an order and fill in
 // the same journal transaction, using the exact same cash/position ledger.
 function executeAutoFill({id,side,code,quantity,price,tradingDay}){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,90}$/.test(id))throw Error('自动成交ID无效');
  const orderId=`auto_${id}`;
  return executeBatch([
   {id:`${id}_submit`,action:'submit',args:{id:orderId,side,code,quantity,limitPrice:price,tradingDay}},
   {id:`${id}_fill`,action:'fill',args:{orderId,fill:{quantity,price,tradingDay}}}
  ]);
 }
 function read(){return {mode:'isolated-offline-paper',brokerConnected:false,legacyAccountMutated:false,revision:commands.length,...ledger.audit()}}
 return Object.freeze({execute,executeBatch,executeAutoFill,read});
}
module.exports={createDurablePaperOrderService};
