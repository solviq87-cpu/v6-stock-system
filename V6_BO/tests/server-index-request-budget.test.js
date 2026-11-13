'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createFixture}=require('./helpers/v6-studio-fixture');
const root=path.resolve(__dirname,'..'),em=fs.readFileSync(path.join(root,'em.js'),'utf8'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
function fn(src,name){const start=src.indexOf('function '+name+'('),end=src.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start);return src.slice(start,end);}

test('the guarded index byte entrypoint rejects alternate hosts and coalesces exact concurrent quote requests',async()=>{
 let calls=0,release;
 const pending=new Promise(resolve=>{release=resolve;});
 const c=vm.createContext({URL,Promise,_inflight:new Map(),txGet:async()=>{calls++;await pending;return Buffer.from('fixture');}});
 vm.runInContext(fn(em,'dedup')+'\n'+fn(em,'requestQuoteBytes'),c);
 for(const url of ['https://72.push2.eastmoney.com/q=sh000001','http://qt.gtimg.cn/q=sh000001',
  'https://user:password@qt.gtimg.cn/q=sh000001','https://qt.gtimg.cn/q=sh000001?other=1','https://qt.gtimg.cn/other'])
  await assert.rejects(c.requestQuoteBytes(url));
 assert.equal(calls,0);
 const one=c.requestQuoteBytes('https://qt.gtimg.cn/q=sh000001'),two=c.requestQuoteBytes('https://qt.gtimg.cn/q=sh000001');
 assert.equal(calls,1);release();await Promise.all([one,two]);
});

test('actual beta consumer uses guarded bytes and preserves the original index averaging calculation',async()=>{
 let calls=0,writes=0;
 const c=vm.createContext({TextDecoder,Buffer,betaWindowOpen:()=>true,
  em:{requestQuoteBytes:async target=>{calls++;assert.match(target,/q=s_sh000001,s_sz399001,s_sz399006$/);return Buffer.from('v_s_sh000001="上证~000001~3000~0~0~1";v_s_sz399001="深证~399001~9000~0~0~-2";');}},
  S:{marketBeta:{}},normDate:value=>value,todayStr:()=> '20261113',atomicWrite:()=>{writes++;},MARKET_FILE:'fixture-only'});
 const start=server.indexOf('async function fetchMarketBeta('),end=server.indexOf('\n}',start)+2;
 vm.runInContext(server.slice(start,end),c);
 const result=await c.fetchMarketBeta();assert.equal(result.avg,-.5);assert.equal(calls,1);assert.equal(writes,1);
 assert.equal(c.S.marketBeta['20261113'],-.5);
});

test('real reference-index HTTP endpoint delegates to the shared quote transport without a separate Node request',async t=>{
 const anchor='let _quantPicksCache = { ts: 0, data: null, busy: false };';
 const fields=Array(40).fill('0');fields[3]='100';fields[4]='99';
 const payload=['sh000001','sz399001','sz399006','sh000688'].map(code=>'v_'+code+'="'+fields.join('~')+'";').join('');
 const inject='em.requestQuoteBytes=async()=>Buffer.from('+JSON.stringify(payload)+');\n';
 const fixture=await createFixture({count:1,serverSource:server.replace(anchor,inject+anchor)});t.after(()=>fixture.close());
 const response=await fixture.request('/api/reference-indexes');assert.equal(response.body.ok,true);
 assert.equal(Object.keys(response.body.items).length,4);assert.equal(response.body.items.sh.price,100);
 assert.equal(response.body.items.kc50.previousClose,99);assert.equal(response.body.items.sh.changePct,1.01);
});
