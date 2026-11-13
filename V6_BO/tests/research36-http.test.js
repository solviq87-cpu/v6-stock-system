'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),server=require.resolve('../server.js'),source=fs.readFileSync(server,'utf8');
const block=source.slice(source.indexOf("  if(p==='/api/research/strategy36'){"),source.indexOf("  if(p==='/api/research/news-evidence'){"));
function call(method,body='',editor=true){
 const headers={};let response=null,checked=0;
 const context={p:'/api/research/strategy36',req:{method,__tok:'fixture'},body,Buffer,Date,require:createRequire(server),res:{setHeader:(k,v)=>headers[k]=v},
  requireEditor:()=>{checked++;return editor;},json:(_r,value,status=200)=>{response={status,value};}};
 vm.runInNewContext('(function(){'+block+'})()',context);
 return {response,headers,checked};
}
test('real research36 route requires editor before GET or evaluation and marks responses no-store',()=>{
 for(const method of ['GET','POST']){const r=call(method,'{}',false);assert.equal(r.checked,1);assert.equal(r.response,null);assert.equal(r.headers['Cache-Control'],'no-store');}
 const r=call('GET');assert.equal(r.response.value.catalog.strategies.length,36);assert.equal(r.response.value.catalog.canTrade,false);
});
test('research36 route bounds payload, rejects future clocks and unsupported operations without executing a backtest',()=>{
 assert.equal(call('DELETE').response.status,405);
 assert.equal(call('POST',' '.repeat(256*1024+1)).response.status,413);
 for(const input of [null,[],{stock:{code:'600000'},asOf:Date.now()+100000},{action:'backtest'},{stock:{code:'600000'},asOf:Date.now(),config:{macd:{weight:-1}}}])assert.equal(call('POST',JSON.stringify(input)).response.status,422);
 const r=call('POST',JSON.stringify({stock:{code:'600000'},asOf:Date.now()}));assert.equal(r.response.status,200);assert.equal(r.response.value.result.matched,0);assert.equal(r.response.value.result.canNotify,false);
});

const observeBlock=source.slice(source.indexOf("  if(p==='/api/research/strategy36/observe'){"),source.indexOf("  if(p==='/api/research/strategy36'){"));
async function observeCall(method,body,editor=true){
 let response=null;const jobs=[],headers={},realRequire=createRequire(server);
 await vm.runInNewContext('(function(){'+observeBlock+'})()',{p:'/api/research/strategy36/observe',req:{method},body,Buffer,res:{setHeader:(k,v)=>headers[k]=v},requireEditor:()=>editor,json:(_r,value,status)=>{response={value,status};},stockObservationOptions:()=>({fixture:true}),require:p=>p==='./src/server/stock-observation-job'?{runStockObservationJob:async input=>{jobs.push(input);return {ok:true};}}:realRequire(p)});
 return {response,jobs,headers};
}
test('stock capture route bounds input and authenticates before any collection',async()=>{
 assert.equal((await observeCall('POST','{}',false)).jobs.length,0);
 for(const [method,body,status] of [['GET','{}',405],['POST',' '.repeat(65537),413],['POST','{}',422],['POST',JSON.stringify({symbol:'600000',url:'https://example.org'}),422],['POST',JSON.stringify({symbol:'600000',historyDays:501}),422]]){const r=await observeCall(method,body);assert.equal(r.response.status,status);assert.equal(r.jobs.length,0);}
 const r=await observeCall('POST',JSON.stringify({symbol:'600000',historyDays:120}));assert.equal(r.response.status,200);assert.equal(r.jobs[0].includeFinancials,true);assert.equal(r.headers['Cache-Control'],'no-store');
});
