'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createDrawerMinutes}=require('../src/research/drawer-minutes');
const day='2026-11-06',now=Date.parse(day+'T16:00:00+08:00'),code='600000';
const bar=(symbol,date,minute='09:35')=>({code:symbol,role:'stock',period:'5m',source:'测试源',date:date+' '+minute,knownAt:now,close:10});
test('minute reads share source jobs, reject unreached closes and isolate symbols, dates and future receipts',async()=>{
 let calls=0,finish;
 const read=createDrawerMinutes({clock:()=>now,reader:{readIntraday:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}});
 assert.equal((await read(code,'2026-11-07')).status,'no-closed-session');
 const first=read(code,day),second=read(code,day);await Promise.resolve();assert.equal(calls,1);
 finish({bars:[bar(code,day),bar('600001',day),bar(code,'2026-11-05'),{...bar(code,day),knownAt:now+1}]});
 const results=await Promise.all([first,second,read(code,day)]);
 for(const result of results){assert.equal(result.status,'observed');assert.deepEqual(result.minuteBars,[bar(code,day)]);}
 assert.equal(calls,1);
 const other=createDrawerMinutes({clock:()=>now,reader:{readIntraday:()=>Promise.reject(Error('network'))}});
 assert.equal((await other(code,day)).status,'unavailable');
 assert.equal((await other(code,day)).minuteBars.length,0);
});
test('quote trails keep true minutes, separate providers and clear between sessions',async()=>{
 const {createQuoteTrail,archivePoints}=await import('../public/nova/stock-timeline.js'),trail=createQuoteTrail();
 for(const [time,price,source] of [['09:30:02',10,'a'],['09:30:12',11,'a'],['09:31:00',12,'a'],['09:31:00',13,'b'],['12:10:00',14,'a']])
  trail.add({code,price,quoteAt:Date.parse(day+'T'+time+'+08:00'),source},now);
 const groups=trail.read(code,day);assert.deepEqual([...groups.get('a').values()].map(x=>x.value),[11,12]);assert.equal(groups.get('b').size,1);
 const closed=archivePoints([bar(code,day),bar('600003',day),bar(code,'2026-11-05')],code,day,now);
 assert.equal(closed.size,1);assert.equal(trail.read(code,'2026-11-05').size,0);
 trail.clear();assert.equal(trail.read(code,day).size,0);
});
test('abnormal movement alerts require a configured private channel, a primary trading session and reviewed same-day observations',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const body=source.slice(source.indexOf('function notifyAbnormalMoves('),source.indexOf('function abMoveThreshold('));
 const sent=[],ctx={feishuSecReady:()=>false,isReplica:()=>false,isContinuousTrading:()=>true,aShareCalendarDate:()=>day,
  reviewedRows:items=>items.filter(row=>row.canNotify),govTrim:(rows,n)=>rows.slice(0,n),govFilter:(type,rows)=>{assert.equal(type,'abmove');return rows;},
  recommendationSendOptions:(batch,options)=>({batch,...options}),pushAll:(text,force,options)=>sent.push({text,force,options})};
 vm.runInNewContext(body,ctx);
 const alert={name:'隔离样本',evidenceDay:day,gain:21,threshold:20,canNotify:true,code,status:'top'};
 const scan=()=>ctx.notifyAbnormalMoves({items:[alert,{...alert,code:'600001',canNotify:false},{...alert,code:'600002',evidenceDay:'2026-11-05'}]});
 scan();ctx.feishuSecReady=()=>true;ctx.isReplica=()=>true;scan();ctx.isReplica=()=>false;ctx.isContinuousTrading=()=>false;scan();
 assert.equal(sent.length,0);ctx.isContinuousTrading=()=>true;scan();
 assert.equal(sent.length,1);assert.equal(sent[0].options.private,true);assert.equal(sent[0].force,false);
 assert.deepEqual(Array.from(sent[0].options.batch,r=>r.code),[code]);
});

test('the shared simulated execution clock stops at lunch and the start of the closing auction',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const fn=source.slice(source.indexOf('const isContinuousTrading ='),source.indexOf('// 收盘后（交易日15:00之后）'));
 let open=true;
 const run=vm.runInNewContext(fn+'\nisContinuousTrading',{isTradeDay:()=>open});
 for(const [hm,want] of [['09:29',false],['09:30',true],['11:29',true],['11:30',false],['12:59',false],['13:00',true],['14:56',true],['14:57',false],['15:00',false]]){
  const [hour,minute]=hm.split(':').map(Number);assert.equal(run({getHours:()=>hour,getMinutes:()=>minute}),want,hm);
 }
 open=false;assert.equal(run({getHours:()=>10,getMinutes:()=>0}),false);
});
