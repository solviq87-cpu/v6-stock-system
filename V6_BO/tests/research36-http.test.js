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
