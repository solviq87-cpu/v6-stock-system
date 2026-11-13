'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const B=require('../bazi'),Q=require('../feishuq');
const {classifyFeishuReceipt:receipt}=require('../src/core/feishu-receipt');
const {reviewRecommendationEvidence:review,reviewQuoteSnapshotFields:copy}=require('../src/core/recommendation-evidence-review');
const source=fs.readFileSync(require.resolve('../server'),'utf8');
function fn(name){const a=source.indexOf('function '+name+'(');assert.ok(a>=0);return source.slice(a,source.indexOf('\n}\n',a)+2);}
function clock(){let now=1000,id=0;const timers=new Map();return {now:()=>now,
 setTimer:(delay,handler)=>{const key=++id;timers.set(key,{at:now+delay,handler});return key;},
 clearTimer:key=>timers.delete(key),
 step(){const next=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)return false;timers.delete(next[0]);now=next[1].at;next[1].handler();return true;},
 run(){for(let i=0;timers.size;i++){assert.ok(i<1000,'timer loop');this.step();}}};}
function queue(send,options={}){const c=clock();return {c,q:Q.createQueue(send,{now:c.now,sleep:c.setTimer,setTimer:(handler,ms)=>c.setTimer(ms,handler),clearTimer:c.clearTimer,...options})};}
const bars=()=>Array.from({length:65},(_,i)=>({date:'2026-10-'+i,open:10+i*.01,close:10.05+i*.01,high:10.1+i*.01,low:9.9+i*.01,pct:i%3===0?-1:1,volume:1000}));
function fund(extra={}){return B.dimFund({rows:bars(),code:'600000',name:'合成样本',...extra});}
test('bazi missing funds never become zero or get replaced by a favorable fallback',()=>{
 for(const missing of [null,undefined,NaN,Infinity,'',false,'100']){
  const r=fund({fundDays:[{main:100},{main:missing},{main:100}]});
  assert.equal(r.fundsEvidence.observed,false);assert.equal(r.fundsEvidence.net,null);assert.ok(r.miss.includes('资金流'));
 }
 const zero=fund({mainInflow:0,thsNetAmt:99999999});
 assert.equal(zero.fundsEvidence.net,0);assert.equal(zero.fundsEvidence.source,'当日主力净流入');
 assert.doesNotMatch(zero.why,/资金持续撤离|主力在进/);
 assert.equal(fund({mainInflow:-100,thsNetAmt:99999999}).fundsEvidence.net,-100);
 assert.equal(fund({fundDays:[{main:1},{main:0},{main:-1}],mainInflow:999}).fundsEvidence.net,0);
 assert.equal(fund({mainInflow:null,thsNetAmt:5}).fundsEvidence.method,'active-net-buy');
});
test('partial history uses an observed fallback but cannot claim continuous inflow',()=>{
 const r=fund({fundDays:[{main:100},{main:null},{main:100}],mainInflow:5});
 assert.equal(r.fundsEvidence.net,5);assert.equal(r.fundsEvidence.historyComplete,false);
 assert.doesNotMatch(r.why,/连续净流入/);
});
test('bazi coverage and critical missing data prevent intervention advice without removing observation',()=>{
 for(const input of [{rows:[]},{rows:bars(),price:10.69}]){
  const r=B.evaluate({code:'600000',name:'样本',...input});
  assert.equal(r.verdict,'观察');assert.equal(r.actionable,false);assert.ok(r.coverage.criticalMissing.length>0);
  assert.match(r.advise,/关键证据不足/);assert.equal(r.scoreKind,'research-score');assert.equal(r.calibrationCertified,false);
 }
 const r=B.evaluate({rows:bars(),price:10.69,mainInflow:0,sectorInfo:{secZT:2,streak:null}});
 assert.equal(r.coverage.criticalMissing.length,0);assert.ok(r.coverage.missing.includes('板块连续性'));
 assert.doesNotMatch(r.dims.trend.why,/连续2日/);
});
test('missing candidate evidence survives buffering and blocks fresh-quote recommendation',()=>{
 const now=Date.parse('2026-11-13T10:00:00+08:00');
 const row={code:'600000',name:'样本',price:10,amount:1e6,quoteAt:now,receivedAt:now,quoteSource:'eastmoney',quoteMode:'live',canNotify:true};
 assert.equal(review(row,{purpose:'intraday-recommendation',now}).canRecommend,true);
 const missing={...row,selectionEvidenceStatus:'incomplete'};
 assert.equal(copy(missing).selectionEvidenceStatus,'incomplete');
 assert.equal(review(missing,{purpose:'intraday-recommendation',now}).canRecommend,false);
 const c=vm.createContext({Date,reviewSnapshotFields:copy});vm.runInContext(fn('freezeRecommendationRows'),c);
 assert.equal(c.freezeRecommendationRows([missing])[0].selectionEvidenceStatus,'incomplete');
});
test('overflow retains urgent FIFO jobs and never logs private content',()=>{
 const sent=[],logs=[],done=[];
 const {q,c}=queue((text,cb)=>{sent.push(text);cb(true,'ok');},{maxQ:3,log:{error:m=>logs.push(m)}});
 q.send('active');q.send('urgent1',()=>{}, {priority:true});q.send('routine-secret',ok=>done.push(ok));q.send('urgent2',()=>{}, {priority:true});q.send('new-routine');
 c.run();assert.deepEqual(sent,['active','urgent1','urgent2','new-routine']);assert.deepEqual(done,[false]);
 assert.ok(logs.every(x=>!x.includes('secret')));
});
test('full urgent queue explicitly rejects routine arrival without evicting risk messages',()=>{
 const sent=[];const {q,c}=queue((text,cb)=>{sent.push(text);cb(true,'ok');},{maxQ:2});
 q.send('active');q.send('risk1',null,{priority:true});q.send('risk2',null,{priority:true});
 let result;q.send('routine',ok=>result=ok);assert.equal(result,false);assert.equal(q.size,2);
 c.run();assert.deepEqual(sent,['active','risk1','risk2']);
});
test('throwing completion or logger cannot strand subsequent messages',()=>{
 const sent=[];const {q,c}=queue((text,cb)=>{sent.push(text);cb(true,'ok');},{log:{error:()=>{throw Error('logger');}}});
 q.send('one',()=>{throw Error('consumer');});q.send('two');c.run();
 assert.deepEqual(sent,['one','two']);assert.equal(q.running,false);assert.equal(q.stats().callbackErrors,1);
});
test('watchdog and late callbacks settle once and never retry unknown delivery',()=>{
 let first;const results=[],sent=[];const {q,c}=queue((text,cb)=>{sent.push(text);if(text==='one')first=cb;else cb(true,'ok');},{guardMs:10,minGap:1});
 q.send('one',(ok,msg)=>results.push({ok,msg}));q.send('two');c.run();first(true,'late');
 assert.equal(results.length,1);assert.match(results[0].msg,/结果未知/);assert.deepEqual(sent,['one','two']);assert.equal(q.stats().retried,0);
});
test('retry honors minimum gap and only retries actual rate-limit responses',()=>{
 let count=0;const times=[];let c;const h=queue((_text,cb)=>{times.push(c.now());cb(++count>=3,count<3?'HTTP 429':'ok');},{minGap:5000});c=h.c;
 h.q.send('one');c.run();assert.deepEqual(times,[1000,6000,11000]);assert.equal(h.q.stats().retried,2);
 assert.equal(Q.RETRYABLE.test('code=9499 Bad Request'),false);assert.equal(Q.RETRYABLE.test('code=9499 too many request'),true);
});
test('Feishu receipt requires HTTP success and consistent numeric codes',()=>{
 for(const payload of [{code:0},{StatusCode:0},{code:0,StatusCode:0}])assert.equal(receipt(200,payload).ok,true);
 for(const [status,payload] of [[503,{code:0}],[200,{msg:'success'}],[200,{code:'0'}],[200,null],[302,{code:0}],[undefined,{code:0}]]){
  assert.equal(receipt(status,payload).status,'unknown');assert.equal(receipt(status,payload).ok,false);
 }
 assert.equal(receipt(200,{code:19021,msg:'success'}).status,'rejected');assert.equal(receipt(200,{code:0,StatusCode:19021}).ok,false);
 assert.equal(receipt(429,null).msg,'HTTP 429');
});
test('default private queue serializes actual probes and rechecks queued evidence and channel changes',async()=>{
 const c=clock(),sent=[],pending=[];
 const context=vm.createContext({FSQ:{createQueue:send=>Q.createQueue(send,{minGap:1200,now:c.now,sleep:c.setTimer,setTimer:(fn,ms)=>c.setTimer(ms,fn),clearTimer:c.clearTimer})},
  process:{env:{V6_FEISHU_PRIVATE_SECRET:'key'}},S:{config:{}},feishuSecId:()=> 'original',isReplica:()=>false,console:{warn(){},error(){}},
  prepareRecommendationDelivery:()=>({canRecommend:true}),feishuProbe:(id,key,text)=>{sent.push({id,key,text,at:c.now()});return new Promise(resolve=>pending.push(resolve));}});
 const a=source.indexOf('const _fsPrivateQueue ='),b=source.indexOf('// opts.priority',a);
 vm.runInContext(source.slice(a,b),context);
 const one=context.feishuSendPrivate('first',{}),two=context.feishuSendPrivate('second',{});
 c.step();assert.equal(sent.length,1);pending.shift()({ok:true,msg:'ok'});await Promise.resolve();await Promise.resolve();
 c.step();assert.equal(sent.length,2);assert.ok(sent[1].at-sent[0].at>=1200);pending.shift()({ok:true,msg:'ok'});await one;await two;
 const third=context.feishuSendPrivate('stale',{recommendationRows:[{}]});context.prepareRecommendationDelivery=()=>({canRecommend:false});c.run();assert.equal((await third).ok,false);assert.equal(sent.length,2);
 const fourth=context.feishuSendPrivate('wrong recipient',{});context.feishuSecId=()=> 'replacement';c.run();assert.equal((await fourth).ok,false);assert.equal(sent.length,2);
 const fifth=context.feishuSendPrivate('old primary',{});context.isReplica=()=>true;c.run();assert.equal((await fifth).ok,false);assert.equal(sent.length,2);
});
test('unknown receipt preserves the existing send-result-unknown contract',()=>{
 const c=vm.createContext({});vm.runInContext(fn('sendResultUnknown'),c);
 assert.equal(c.sendResultUnknown(receipt(502,null).msg),true);
 assert.equal(c.sendResultUnknown(receipt(200,{code:19021}).msg),false);
});
test('essential flag cannot bypass replica exclusion and historical observation keeps its purpose',()=>{
 const logs=[],sends=[];
 const c=vm.createContext({prepareRecommendationDelivery:text=>({ok:true,text,kind:'historical-trigger-observation'}),
  redactSecrets:x=>x,extractStockCodes:()=>[],inManualPush:()=>false,isReplica:()=>true,
  console:{log(){}},pushLog:(...args)=>logs.push(args),sseSendEdit(){},sseSend(){},
  feishuSendPrivate:()=>{sends.push('private');return Promise.resolve({ok:true});}});
 vm.runInContext(fn('pushAll'),c);assert.equal(c.pushAll('test',false,{essential:true}),true);
 assert.equal(sends.length,0);assert.match(logs[0][0],/副本拦截/);
 c.isReplica=()=>false;Object.assign(c,{msgGate:()=>({ok:true}),inQuietHours:()=>false,privReady:()=>true,
  feishuSendPrivate:(_text,opts)=>{assert.equal(opts.forceHistoricalObservation,true);return new Promise(()=>{});}});
 assert.equal(c.pushAll('historical observation',false,{recommendationRows:[{}]}),true);
});
