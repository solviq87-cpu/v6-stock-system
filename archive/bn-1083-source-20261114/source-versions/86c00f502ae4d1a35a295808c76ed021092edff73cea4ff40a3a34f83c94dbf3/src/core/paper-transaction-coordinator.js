'use strict';
/** Recoverable coordinator for order-fill events and the paper cash/position ledger.
 * Uses a durable prepare record plus the account ledger's event-id idempotency.
 * Offline paper trading only; no broker calls and no live-account mutation.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const safeId = v => { const s=String(v||''); if(!/^[A-Za-z0-9_-]{1,100}$/.test(s)) throw new Error('事务ID无效'); return s; };
const validDate = v => { const s=String(v||''); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d=new Date(`${s}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===s; };
function validatePayload(order,fill,tradeDate){
  if(!order||!['buy','sell'].includes(order.side)||!/^[0-9]{6}$/.test(String(order.symbol||''))||typeof order.orderId!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(order.orderId)) throw new Error('事务订单信息无效');
  const orderQty=Number(order.quantity), qty=Number(fill&&fill.quantity), price=Number(fill&&fill.price), fee=Number(fill&&fill.fee||0);
  if(!Number.isSafeInteger(orderQty)||orderQty<=0||orderQty%100||!Number.isSafeInteger(qty)||qty<=0||qty%100||qty>orderQty||!Number.isFinite(price)||price<=0||!Number.isFinite(fee)||fee<0) throw new Error('事务成交数量、价格、费用或订单数量无效');
  if(!fill||fill.orderId!==order.orderId||typeof fill.eventId!=='string'||! /^[A-Za-z0-9_-]{1,120}$/.test(fill.eventId)) throw new Error('事务订单与成交关联无效');
  if(!validDate(tradeDate)) throw new Error('事务交易日期无效');
}
function atomic(file, value) {
  const dir=path.dirname(file); const tmp=path.join(dir,`.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd;
  try { fd=fs.openSync(tmp,'wx',0o600); fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined; fs.renameSync(tmp,file); const d=fs.openSync(dir,'r'); try{fs.fsyncSync(d);}finally{fs.closeSync(d);} }
  catch(e){if(fd!==undefined)try{fs.closeSync(fd);}catch(_){} try{fs.unlinkSync(tmp);}catch(_){} throw e;}
}
function createPaperTransactionCoordinator({ledger,journalDir}) {
  if(!ledger || typeof ledger.transact!=='function' || typeof ledger.read!=='function') throw new Error('需要有效的模拟盘账户账本');
  const dir=path.resolve(journalDir); fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const fileOf=id=>path.join(dir,`${safeId(id)}.txn.json`);
  function readTxn(file){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.size>1024*1024)throw new Error('事务日志文件不安全');const x=JSON.parse(fs.readFileSync(file,'utf8'));if(!x||x.schemaVersion!==1||!['prepared','committed'].includes(x.status))throw new Error('事务日志状态无效');if(!/^[A-Za-z0-9_-]{1,100}$/.test(String(x.transactionId||'')))throw new Error('事务日志ID无效');try{validatePayload(x.order,x.fill,x.tradeDate);}catch(e){throw new Error(`事务日志订单、成交或日期无效：${e.message}`);}if(x.fingerprint!==hash({transactionId:x.transactionId,order:x.order,fill:x.fill,tradeDate:x.tradeDate,status:x.status}))throw new Error('事务日志指纹校验失败');return x;}
  function writeTxn(x){const value={...x,fingerprint:hash({transactionId:x.transactionId,order:x.order,fill:x.fill,tradeDate:x.tradeDate,status:x.status})};atomic(fileOf(x.transactionId),value);return value;}
  function apply(transactionId,order,fill,tradeDate){
    const id=safeId(transactionId), file=fileOf(id);
    validatePayload(order,fill,tradeDate); const lock=`${file}.lock`; let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('事务正在处理中，拒绝并发执行');throw e;}
    try {
      if(fs.existsSync(file)){const old=readTxn(file);if(hash({order:old.order,fill:old.fill,tradeDate:old.tradeDate})!==hash({order,fill,tradeDate}))throw new Error('事务ID内容冲突');if(old.status==='committed')return { ...old, idempotent:true };}
      else writeTxn({schemaVersion:1,transactionId:id,order,fill,tradeDate,status:'prepared'});
      const prepared=readTxn(file);
      const account=ledger.transact(prepared.order,prepared.fill,prepared.tradeDate);
      const committed=writeTxn({...prepared,status:'committed'});
      return { ...committed, account, recovered:false, paperOnly:true, brokerConnected:false };
    } finally {try{fs.closeSync(fd);}catch(_){} try{fs.unlinkSync(lock);}catch(_){}}
  }
  function recover(){
    const results=[];
    for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.txn.json')).sort()){
      const file=path.join(dir,name), tx=readTxn(file); if(tx.status==='committed')continue;
      if(tx.status!=='prepared')throw new Error(`未知事务状态：${tx.status}`);
      const lock=`${file}.lock`;let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST'){results.push({transactionId:tx.transactionId,status:'busy'});continue;}throw e;}
      try{ledger.transact(tx.order,tx.fill,tx.tradeDate);const done=writeTxn({...tx,status:'committed'});results.push({transactionId:tx.transactionId,status:done.status,recovered:true});}
      finally{try{fs.closeSync(fd);}catch(_){}try{fs.unlinkSync(lock);}catch(_){}}
    }
    return {schemaVersion:1,mode:'offline-paper-transaction-recovery',results,recoveredCount:results.filter(x=>x.recovered).length,brokerConnected:false,accountMutated:true};
  }
  function inspect(){return fs.readdirSync(dir).filter(x=>x.endsWith('.txn.json')).sort().map(n=>readTxn(path.join(dir,n)));}
  return Object.freeze({apply,recover,inspect});
}
module.exports={createPaperTransactionCoordinator};
