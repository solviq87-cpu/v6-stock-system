'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {createFixture}=require('./helpers/v6-studio-fixture');
const {shortlineHttp}=require('../src/server/shortline-http');
const endpoint='/api/research/shortline';
test('V6 real private research route uses native account, revision CAS, durable observations and empty initialization',{timeout:45000},async t=>{
 const f=await createFixture({count:1});t.after(()=>f.close());
 // Native page hydration and independent desktop/mobile reads share a worker.
 const [manual,first,second]=await Promise.all([f.request('/api/research/manual-loop'),f.request(endpoint),f.request(endpoint)]);
 assert.equal(manual.status,200,JSON.stringify(manual.body));assert.equal(second.status,200,JSON.stringify(second.body));
 assert.deepEqual(first.body,second.body);
 assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.ok,true);
 assert.equal(first.body.state.scope,'live');assert.equal(first.body.state.catalog.length,95);
 assert.equal(first.body.state.trades.length,0);assert.equal(first.body.state.bars.length,0);
 assert.equal(first.body.state.revision,0);assert.equal(first.body.state.permissions.canWrite,true);
 const file=path.join(f.tmp,'data','shortline-research','research.json');
 assert.equal(fs.existsSync(file),false);
 for(const token of ['',f.viewerToken]){
   const r=await f.request(endpoint,'GET',null,token);assert.notEqual(r.body.ok,true);assert.equal(r.body.state,undefined);
 }
 const bad=await f.request(endpoint+'?accountId=someone-else');assert.equal(bad.status,400);
 const post={action:'review:note',revision:0,payload:{date:'2024-06-04',kind:'annotation',text:'本地隔离测试，人工复核记录'}};
 assert.equal((await f.request(endpoint,'POST',post,f.viewerToken)).status,403);
 let r=await f.request(endpoint,'POST',post);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.state.revision,1);assert.equal(r.body.state.notes[0].text,post.payload.text);
 const bytes=fs.readFileSync(file,'utf8');
 assert.equal(fs.statSync(file).mode&0o777,0o600);assert.ok(!bytes.includes(f.token));assert.ok(!bytes.includes('permissions'));
 r=await f.request(endpoint,'POST',post);assert.equal(r.status,409);assert.equal(fs.readFileSync(file,'utf8'),bytes);
 r=await f.request(endpoint);assert.equal(r.body.state.notes[0].text,post.payload.text);assert.equal(r.body.state.revision,1);
 const json=JSON.parse(bytes);json.state.notes[0].text='改动';fs.writeFileSync(file,JSON.stringify(json));
 r=await f.request(endpoint);assert.equal(r.status,503);assert.equal(r.body.state,undefined);
});
test('短线 API 副本及权限拒绝发生在外部行情读取与存档工作之前',async()=>{
 const input={revision:0,action:'v6:sync',payload:{code:'600000'}};
 async function call(role,replica,origin){
  const result={};const req={method:'POST',headers:{authorization:'Bearer device-1234',host:'localhost',...(origin?{origin}:{})}};
  const res={writeHead:s=>result.status=s,end:raw=>result.data=JSON.parse(raw)};
  await shortlineHttp(req,res,{body:JSON.stringify(input),url:new URL('http://localhost'+endpoint),authenticate:()=>role,isReplica:()=>replica,job(){throw Error('unexpected write');},readSource(){throw Error('unexpected source request');}});
  return result.status;
 }
 assert.equal(await call('edit',true),409);assert.equal(await call('view',false),403);assert.equal(await call('edit',false,'https://other.test'),403);
});
test('真实同步事务去重，历史时点不采用今天读取时刻，新的成交与批注自动形成复盘',async t=>{
 const os=require('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'shortline-store-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const {shortlineJob}=await import('../src/research/shortline/store.mjs');
 const day='2024-06-04',stock={code:'600000',name:'隔离样本'},snapshot={...stock,day,stock,latestClosed:false,latestClosedDay:'2024-06-07',observedAt:'2024-06-07 17:00',observedAtMs:Date.parse('2024-06-07T17:00+08:00'),bars:[],market:[],missing:['无收盘行情'],evidence:[]};
 let rev=0;
 const op=async(action,payload,snap)=>{const r=await shortlineJob({root,input:{revision:rev,action,payload},snapshot:snap});rev=r.state.revision;return r;};
 let r=await op('v6:sync',{code:stock.code},snapshot);
 assert.equal(r.state.checks.length,1);assert.equal(r.state.notes.length,1);assert.equal(r.state.v6Observation.asOf,day+' 15:00');
 r=await op('v6:sync',{code:stock.code},{...snapshot,observedAt:'2024-06-07 18:00'});
 assert.equal(r.state.checks.length,1);assert.equal(r.state.notes.length,1);
 assert.equal(r.state.plans.length,0);assert.equal(r.state.versions.length,0);
 r=await op('learn:trade',{...stock,entryTime:'2024-06-03T10:00',exitTime:day+'T11:00',entryPrice:10,exitPrice:10.1,shares:100,cost:1,position:5,strategy:'观察',trend:'震荡',exitReason:'到期离场'});
 assert.equal(r.state.trades.length,1);assert.equal(r.state.notes.at(-1).source,'V6 自动复盘');
 assert.ok(r.state.notes.at(-1).text.includes(stock.name));
 r=await op('review:note',{date:day,kind:'annotation',text:'保持仓位纪律',tradeId:r.result.id});
 assert.ok(r.state.notes.at(-1).text.includes('保持仓位纪律'));
 const csv='date,code,name,open,high,low,close,volume\n2024-06-05,600000,测试,10,11,9,10.2,1000';
 r=await op('k:import',{csv});assert.equal(r.state.notes.at(-1).date,'2024-06-05');
 const total=r.state.notes.length;
 r=await op('k:import',{csv});assert.equal(r.result.duplicates,1);assert.equal(r.state.notes.length,total);
});
