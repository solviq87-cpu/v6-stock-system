'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8'),start=source.indexOf('function loadSnapshotsOnBoot()'),end=source.indexOf('\n}',start)+2;
const receivedAt=Date.parse('2026-11-13T15:05:00+08:00'),eventAt=receivedAt-60000;
function snapshot(){return {day:'20261113',pool:[{code:'600000',name:'样本'}],reviewPool:[{code:'600000',name:'样本',tradeDate:'2026-11-13',sources:['eastmoney','cls'],price:10,
 receivedAt,sourceEventAt:eventAt,quoteAt:null,reason:'原始原因',reasonTradeDate:'2026-11-13',reasonSource:'cls',reasonReceivedAt:receivedAt,reasonDateStatus:'matched',
 currentSourceConfirmed:true,heldRecord:false,sourceStatuses:{eastmoney:'available',cls:'available'},canTrade:true,canNotify:true}],
 reviewMeta:{tradeDate:'2026-11-13',status:'ready',rowCount:1,heldRecordCount:0,providerComplete:true,partial:false,
 sources:[{source:'eastmoney',tradeDate:'2026-11-13',receivedAt,totalCount:1,fetchedCount:1,providerComplete:true,status:'available'},
 {source:'cls',tradeDate:'2026-11-13',receivedAt,totalCount:1,fetchedCount:1,providerComplete:true,status:'available'}]}};}
function recover(saved){
 const state={stocks:[],ztPool:[],sectors:[],ztReviewPool:[],ztReviewPoolMeta:null};
 const noNetwork=()=>assert.fail('snapshot recovery must not contact a provider');
 const c=vm.createContext({S:state,STOCKS_SNAP_FILE:'stocks-fixture',ZTPOOL_SNAP_FILE:'pool-fixture',SECTORS_FILE:'sectors-fixture',
  fs:{readFileSync(file){if(file==='pool-fixture')return JSON.stringify(saved);throw Object.assign(Error('missing fixture'),{code:'ENOENT'});},existsSync:()=>false},
  A:require('../analysis'),path,console:{log(){},error(){}},loadStrategyCards:()=>false,loadAuctionSnapshot:()=>false,
  fetch:noNetwork,em:{fetchZTPool:noNetwork},require:require('node:module').createRequire(require.resolve('../server.js'))});
 vm.runInContext(source.slice(start,end),c);c.loadSnapshotsOnBoot();return state;
}
test('actual boot recovery marks every readonly row as held without changing original evidence',()=>{
 const saved=snapshot(),before=structuredClone(saved),state=recover(saved),row=state.ztReviewPool[0];
 assert.ok(row);assert.equal(row.heldRecord,true);assert.equal(row.currentSourceConfirmed,false);assert.equal(row.recordStatus,'held-source-observation');
 assert.deepEqual(Array.from(row.heldSources),['eastmoney','cls']);assert.equal(row.sourceStatuses.eastmoney,'retained');assert.equal(row.sourceStatuses.cls,'retained');assert.equal(row.reasonSourceStatus,'retained');
 for(const field of ['tradeDate','receivedAt','sourceEventAt','quoteAt','reasonTradeDate','reasonReceivedAt','reason'])assert.equal(row[field],saved.reviewPool[0][field]);
 assert.equal(row.canTrade,false);assert.equal(row.canNotify,false);assert.deepEqual(saved,before);
});
test('boot retention describes startup verification separately from provider failures and preserves source dates/counts',()=>{
 const saved=snapshot(),state=recover(saved),meta=state.ztReviewPoolMeta;
 assert.equal(meta.status,'retained');assert.equal(meta.retentionReason,'startup-not-verified');assert.equal(meta.currentSourceConfirmed,false);assert.equal(meta.heldRecordCount,1);assert.equal(meta.heldSourceRecordCount,1);
 assert.equal(meta.lastAttempt,undefined);assert.equal(meta.tradeDate,'2026-11-13');assert.equal(meta.providerComplete,true);assert.equal(meta.partial,false);
 for(const source of meta.sources){assert.equal(source.status,'retained');assert.equal(source.retentionReason,'startup-not-verified');assert.equal(source.currentSourceConfirmed,false);assert.equal(source.lastAttempt,undefined);assert.equal(source.receivedAt,receivedAt);assert.equal(source.totalCount,1);assert.equal(source.fetchedCount,1);}
 assert.equal(meta.canTrade,false);assert.equal(meta.canNotify,false);
});
test('readonly source recovery remains available when the independent strategy snapshot has no rows',()=>{
 const saved=snapshot();saved.pool=[];
 const state=recover(saved);
 assert.equal(state.ztPool.length,0,'readonly source records must not populate a strategy pool');
 assert.equal(state.ztReviewPool.length,1);
 assert.equal(state.ztReviewPool[0].currentSourceConfirmed,false);
 assert.equal(state.ztReviewPoolMeta.tradeDate,saved.reviewMeta.tradeDate);
});
