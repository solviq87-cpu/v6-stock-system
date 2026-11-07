'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDurablePaperOrderService}=require('../src/core/paper-durable-order-service');
const day='2026-11-05';
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-durable-'));const file=path.join(dir,'orders.json');return {file,service:()=>createDurablePaperOrderService({file,initialCash:100000})}}
test('部分成交撤单资金释放、重启后账本完全一致、幂等',()=>{
 const {service}=fixture();let a=service();const submit={id:'cmd1',action:'submit',args:{id:'order1',side:'BUY',code:'600000',quantity:300,limitPrice:10,tradingDay:day}};
 a.execute(submit);assert.equal(a.read().snapshot.reservedCash>0,true);
 a.execute({id:'cmd2',action:'fill',args:{orderId:'order1',fill:{quantity:100,price:9.5,tradingDay:day}}});
 const before=a.read();assert.equal(before.snapshot.orders[0].status,'PARTIALLY_FILLED');
 a=service();assert.deepEqual(a.read(),before);
 a.execute({id:'cmd3',action:'cancel',args:{orderId:'order1',options:{tradingDay:day}}});
 const after=a.read();assert.equal(after.snapshot.reservedCash,0);assert.equal(after.snapshot.positions['600000'].shares,100);assert.equal(after.snapshot.orders[0].status,'CANCELLED');assert.equal(after.ok,true);
 a=service();assert.deepEqual(a.read(),after);assert.equal(a.execute(submit).idempotent,true);
 assert.throws(()=>a.execute({...submit,args:{...submit.args,quantity:200}}),/冲突/);
});
test('非法写入不污染内存与磁盘',()=>{const {file,service}=fixture();const a=service();const original=a.read();assert.throws(()=>a.execute({id:'bad',action:'fill',args:{orderId:'missing',fill:{quantity:100,price:10,tradingDay:day}}}));assert.deepEqual(a.read(),original);assert.equal(fs.existsSync(file),false)});
test('账本损坏必须拒绝恢复，不静默重置',()=>{const {file,service}=fixture();const a=service();a.execute({id:'x',action:'submit',args:{id:'o',side:'BUY',code:'600000',quantity:100,limitPrice:10,tradingDay:day}});fs.writeFileSync(file,'{"schemaVersion":1,"commands":[]}');assert.throws(()=>service(),/校验失败/)});
test('同一API视图适用于电脑与手机，均为只读快照',()=>{const {service}=fixture();const a=service();const desktop=JSON.parse(JSON.stringify(a.read()));const mobile=JSON.parse(JSON.stringify(a.read()));assert.deepEqual(desktop,mobile);assert.equal(desktop.brokerConnected,false);assert.equal(desktop.legacyAccountMutated,false)});
