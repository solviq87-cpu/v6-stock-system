'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-legacy-authority-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'pool.json');let now=Date.parse('2026-11-05T02:00:00Z');const app=createPaperApplicationService({file,clock:()=>now,maxParticipationPct:1,calendar:{isOpen:d=>['2026-11-05','2026-11-06'].includes(d)}});app.adoptLegacy({initial:100000,cash:100000,realized:0,enabled:true,positions:{},trades:[]});const quote=()=>({symbol:'600000',source:'simulated',tradeDate:new Date(now+8*3600000).toISOString().slice(0,10),timestamp:now,volumeUnit:'shares',volume:1000000,price:10,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});return {app,file,quote,now:()=>now,advance:()=>{now+=86400000;}};}
test('legacy automatic fill and new pending/partial/cancel share cash, batches and events',t=>{
 const x=setup(t),base=x.app.read(),legacy=x.app.legacy();
 const buy={t:x.now(),side:'买入',code:'600000',name:'研究样本',price:10,shares:200,amount:2000,fee:5,pnl:null,reason:'test-only'};
 const proposed={...legacy,cash:97995,positions:{'600000':{code:'600000',name:'研究样本',shares:200,buyPrice:10,buyTs:x.now(),basis:2005}},trades:[buy]};
 const imported=x.app.saveLegacy(proposed,base.revision,{quotes:{'600000':x.quote()}});assert.equal(imported.account.cash,97995);assert.equal(imported.account.events.length,1);assert.equal(Object.values(imported.orders)[0].state.status,'filled');
 x.advance();x.app.submit({orderId:'sell-partial',symbol:'600000',side:'sell',quantity:200,limitPrice:9,tradeDate:'2026-11-06'});
 const q={...x.quote(),volume:10000};const sold=x.app.fill('sell-partial','partial-fill',q);assert.equal(sold.orders['sell-partial'].state.status,'partial');assert.equal(sold.account.positions['600000'].quantity,100);assert.equal(sold.account.positions['600000'].lots[0].cost,1002.5);
 const projected=x.app.legacy();assert.equal(projected.positions['600000'].shares,100);assert.equal(projected.positions['600000'].basis,1002.5);assert.equal(projected.cash,sold.account.cash);assert.equal(projected.realized,-8);
 x.app.cancel('sell-partial','cancel');assert.equal(x.app.read().orders['sell-partial'].state.remainingQuantity,100);
});
test('stale legacy state cannot overwrite newly committed order account; reset archives prior book',t=>{
 const x=setup(t),before=x.app.read(),legacy=x.app.legacy();x.app.submit({orderId:'pending',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:'2026-11-05'});const raw=fs.readFileSync(x.file);assert.throws(()=>x.app.saveLegacy(legacy,before.revision),/版本冲突/);assert.deepEqual(fs.readFileSync(x.file),raw);
 const current=x.app.read();const reset=x.app.saveLegacy({...legacy,cash:50000,initial:50000},current.revision,{action:'setInitial'});assert.equal(reset.account.cash,50000);assert.equal(reset.archives[0].orders.pending.state.status,'pending');
});
test('legacy buy respects pending cash reservations and rejects inconsistent projection atomically',t=>{
 const x=setup(t);x.app.submit({orderId:'pending',symbol:'600001',side:'buy',quantity:9000,limitPrice:10,tradeDate:'2026-11-05'});const state=x.app.read(),legacy=x.app.legacy(),raw=fs.readFileSync(x.file);const trade={t:x.now(),side:'买入',code:'600000',price:10,shares:2000,fee:5};assert.throws(()=>x.app.saveLegacy({...legacy,cash:79995,trades:[trade],positions:{}},state.revision,{quotes:{'600000':x.quote()}}),/冻结资金/);assert.deepEqual(fs.readFileSync(x.file),raw);
});
test('failure before publishing the authoritative snapshot never exposes half a legacy fill',t=>{
 const x=setup(t),book=x.app.read(),legacy=x.app.legacy(),raw=fs.readFileSync(x.file),rename=fs.renameSync;
 const trade={t:x.now(),side:'买入',code:'600000',name:'fixture',price:10,shares:100,amount:1000,fee:5};
 const proposed={...legacy,cash:98995,positions:{'600000':{code:'600000',shares:100,buyTs:x.now(),buyPrice:10,basis:1005}},trades:[trade]};
 t.mock.method(fs,'renameSync',(from,to)=>{if(to===x.file)throw Object.assign(Error('test injected disk failure'),{code:'EIO'});return rename(from,to);});
 assert.throws(()=>x.app.saveLegacy(proposed,book.revision,{quotes:{'600000':x.quote()}}),/disk failure/);assert.deepEqual(fs.readFileSync(x.file),raw);assert.equal(x.app.read().account.events.length,0);assert.equal(x.app.legacy().cash,100000);
});
test('metadata updates preserve financial state and share restart state with the new order service',t=>{
 const x=setup(t),before=x.app.read();x.app.saveLegacy({...x.app.legacy(),enabled:false},before.revision);const reopened=createPaperApplicationService({file:x.file});assert.equal(reopened.legacy().enabled,false);assert.equal(reopened.read().account.cash,100000);assert.deepEqual(reopened.read().account.events,[]);
});
test('unchanged authority revision preserves unflushed stop-loss peak metadata; force reload rolls back',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');const start=source.indexOf('function refreshPaperAuthority('),end=source.indexOf('function paperAuthorityQuotes(',start);const book={revision:1};const legacy={initial:100000,cash:100000,positions:{'600000':{peak:.1}},trades:[]};
 const context={isReplica:()=>false,PAPER_CFG:{pool:{initial:100000}},PAPER:{pool:{positions:{'600000':{peak:.25}}}},_paperAuthority:{pool:{read:()=>book}},_paperAuthorityRevision:{pool:1},fs:{existsSync:()=>true},path,process:{env:{}},__dirname:'/test',require:()=>({projectLegacy:()=>structuredClone(legacy)})};vm.runInNewContext(source.slice(start,end)+'\nthis.refresh=refreshPaperAuthority;',context);context.refresh();assert.equal(context.PAPER.pool.positions['600000'].peak,.25);context.refresh(true);assert.equal(context.PAPER.pool.positions['600000'].peak,.1);
});
test('CLI and legacy/new services use the identical authoritative account snapshot',t=>{
 const x=setup(t),request=path.join(path.dirname(x.file),'request.json');fs.writeFileSync(request,JSON.stringify({action:'submit',order:{orderId:'cli-order',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:'2026-11-05'}}));const result=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'../scripts/paper-account.js'),x.file,request],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(x.app.read().orders['cli-order'].state.status,'pending');assert.equal(JSON.parse(result.stdout).result.account.cash,x.app.legacy().cash);
});
