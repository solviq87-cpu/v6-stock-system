'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createRequire}=require('node:module'),serverPath=require.resolve('../server.js'),source=fs.readFileSync(serverPath,'utf8');
const at=Date.parse('2026-11-13T10:00:00+08:00');
const row=patch=>({code:'000001',name:'正常股票',price:10,quoteAt:at-1000,receivedAt:at,mode:'public-live-unverified',
 quoteSource:'vendor-original',canNotify:true,amount:1e8,volume:10000,ts:at,signalId:'a'.repeat(64),type:'趋势票',...patch});
function fn(name){const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}\n',a)+2;assert.ok(a>=0&&b>a,name);return source.slice(a,b);}
function engine(){
 let now=at;const sends=[],logs=[],releases=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const c=vm.createContext({Date:Clock,require:createRequire(serverPath),process:{env:{}},console:{log(){},error(){},warn(){}},S:{config:{}},
  FSQ:{createQueue:send=>require('../feishuq').createQueue(send,{minGap:0,sleep:(_ms,callback)=>callback()})},
  redactSecrets:x=>x,extractStockCodes:()=>['000001'],inManualPush:()=>false,isReplica:()=>false,msgGate:()=>({ok:true}),inQuietHours:()=>false,
  sseSendEdit(){},sseSend(){},privReady:()=>true,feishuSecId:()=> 'send-mock',feishuSecMask:()=> 'send-mock',
  feishuProbe:async(_id,_secret,text)=>{sends.push(text);return {ok:true};},pushLog:(...args)=>logs.push(args),_pushLast:{},
  govReleaseAll:list=>releases.push(...list),modDayRelease:mod=>releases.push(mod),
  INTRADAY:{buf:new Map(),parts:[],firstAt:at,lastSent:0},INTRADAY_MAX_ITEMS:4,ALERT_RANK:{},alertScore:()=>1,
  buildAlertsReport:()=> '现价10 · 当前可买 · 参考止损9.7'});
 for(const name of ['reviewRecommendation','reviewedRows','reviewSnapshotFields','freezeRecommendationRows','recommendationSendOptions','prepareRecommendationDelivery','pushAll','flushIntraday'])vm.runInContext(fn(name),c);
 const queueStart=source.indexOf('const _fsPrivateQueue ='),queueEnd=source.indexOf('// opts.priority',queueStart);
 vm.runInContext(source.slice(queueStart,queueEnd),c);
 return {c,sends,logs,releases,set:value=>{now=value;}};
}
test('actual final sender rechecks same original row, and a fresh approved recommendation still sends',async()=>{
 const e=engine(),r=row(),opts=e.c.recommendationSendOptions([r],{private:true});
 r.price=999;r.quoteAt=0;
 assert.equal(e.c.pushAll('当前价格10 · 已审核候选',false,opts),true);await new Promise(setImmediate);
 assert.deepEqual(e.sends,['当前价格10 · 已审核候选']);assert.equal(opts.recommendationRows[0].price,10);assert.ok(Object.isFrozen(opts.recommendationRows[0]));
});
for(const delay of [60000,180000])test('actual '+delay+'ms batch keeps the trigger observation without stale current-price recommendations',async()=>{
 const e=engine();e.c.INTRADAY.buf.set('signal',row());e.set(at+delay);e.c.flushIntraday();await new Promise(setImmediate);
 assert.equal(e.sends.length,1,'buffered functionality remains available');
 assert.match(e.sends[0],/历史触发观察 · 非当前推荐/);assert.match(e.sends[0],/当时报价10/);
 assert.ok(e.sends[0].includes(new Date(at-1000).toISOString()));assert.ok(e.sends[0].includes('a'.repeat(64)));
 assert.doesNotMatch(e.sends[0],/现价10|当前可买|参考止损9\.7/);
 assert.ok(e.logs.some(entry=>entry[0]==='✅ 已送达(私密)'));
});
test('buffered text sections carry immutable original rows through the same actual flush',async()=>{
 const e=engine(),opts=e.c.recommendationSendOptions([row()],{undo:[{code:'000001',type:'pool'}],modDay:'pool'});
 e.c.INTRADAY.parts.push({text:'现价10 当前可买 参考止损9.7',opt:opts});e.set(at+180000);e.c.flushIntraday();await new Promise(setImmediate);
 assert.equal(e.sends.length,1);assert.match(e.sends[0],/当时报价10/);assert.doesNotMatch(e.sends[0],/当前可买|参考止损9\.7/);
});
test('an originally missing or prohibited row never becomes an approved historical trigger, including force send',()=>{
 for(const patch of [{quoteAt:null},{canNotify:false},{mode:'simulated'},{volume:0},{receivedAt:at-2000}]){
  const e=engine(),opts=e.c.recommendationSendOptions([row(patch)],{undo:[{code:'000001',type:'pool'}],modDay:'pool'});
  e.set(at+180000);assert.equal(e.c.pushAll('当前可买',true,opts),false);assert.equal(e.sends.length,0);
  assert.equal(e.releases.length,2);assert.ok(e.logs.some(entry=>entry[0]==='推荐证据未通过·不外发'));
 }
});
test('manual resend is an explicit historical observation even when its original row remains fresh',async()=>{
 const e=engine(),opts=e.c.recommendationSendOptions([row()],{private:true},true);
 assert.equal(e.c.pushAll('当前可买 参考止损9.7',true,opts),true);await new Promise(setImmediate);
 assert.match(e.sends[0],/手动历史重发/);assert.doesNotMatch(e.sends[0],/当前可买|参考止损9\.7/);
});
