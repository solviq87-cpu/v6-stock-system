'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const load=()=>import('../public/nova/shortline-host.mjs');
const endpoint='/api/research/shortline';

test('desktop and mobile workspace navigation retain all existing research tabs and expose shortline to editors',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../public/nova/app.js'),'utf8');
 const subroutes=['overview','new','checks','library','trades','versions','backtest','review','mistakes'];
 for(const name of subroutes)assert.ok(script.includes("'lab','shortline-"+name+"','edit'"),name);
 for(const existing of ['strategies','learning','sources','backtest'])assert.ok(script.includes("'lab','"+existing+"'"));
 assert.ok(script.includes("workspaceIndex.has('lab/'+route.sub)"));
 const render=fs.readFileSync(path.join(__dirname,'../public/nova/research.js'),'utf8');
 assert.match(render,/if\(!ctx.canEdit\)return empty/);
 assert.match(render,/import\('\.\/shortline-host\.mjs'\)/);
});
test('research target retains candidate-specific market day and prioritizes the selected stock',async()=>{
 const {researchTarget}=await load();
 const ctx={stock:'',state:{snapshotFieldDays:{pool:'20261118',dashboard:'20261120'},pool:[{code:'000001',name:'池一'}],dashboard:{rows:[{code:'600012',name:'面板项'}]}}};
 assert.deepEqual(researchTarget(ctx,{}),{code:'000001',name:'池一',date:'2026-11-18'});
 ctx.stock='600012';
 assert.equal(researchTarget(ctx,{}).date,'2026-11-20');
 ctx.state.dashboard.rows[0].tradeDate='2026-11-17';
 assert.equal(researchTarget(ctx,{}).date,'2026-11-17');
 ctx.state={};ctx.stock='';
 assert.equal(researchTarget(ctx,{checks:[{code:'000002'}]}).code,'000002');
 assert.equal(researchTarget(ctx,{}).date,'');
});
test('parallel automatic loads use one native write and update the shared revision in place',async()=>{
 const {createResearchSession}=await load(),calls=[],state={revision:2,permissions:{canWrite:true}};
 let finish;
 const signal=new AbortController().signal;
 const ctx={signal,canEdit:true,api:async(path,options)=>{calls.push({path,options});return new Promise(resolve=>finish=resolve);}};
 const session=createResearchSession(ctx,state);
 const operations=[session.loadEvidence('000001','2026-11-20'),session.loadEvidence('000001','2026-11-20')];
 assert.equal(calls.length,1);assert.equal(calls[0].path,endpoint);
 assert.deepEqual(calls[0].options.body,{revision:2,action:'v6:sync',payload:{code:'000001',day:'2026-11-20'}});
 finish({state:{revision:3,v6Observation:{code:'000001',day:'2026-11-20'}},result:{code:'000001',day:'2026-11-20'}});
 await Promise.all(operations);
 assert.equal(state.revision,3);
 assert.equal((await session.loadEvidence('000001','2026-11-20')).reused,true);
 assert.equal(calls.length,1);
});
test('viewer, replica and stale route cannot write or overwrite state after an HTTP request',async()=>{
 const {createResearchSession}=await load(),controller=new AbortController(),calls=[];
 const ctx={canEdit:false,signal:controller.signal,api:(...args)=>{calls.push(args);throw Error('unexpected I/O');}};
 const state={permissions:{canWrite:false}},s=createResearchSession(ctx,state);
 await assert.rejects(s.refresh(),/授权/);ctx.canEdit=true;
 await assert.rejects(s.save('review:note',{}),/研究副本/);
 assert.equal((await s.loadEvidence('600000','2026-11-20')).replica,true);assert.equal(calls.length,0);
 ctx.api=async()=>{controller.abort();return {state:{revision:42}};};
 await assert.rejects(s.refresh(),{name:'AbortError'});assert.equal(state.revision,undefined);
});
test('optimistic conflict refreshes the remote archive without replaying a user action',async()=>{
 const {createResearchSession}=await load(),state={revision:1,permissions:{canWrite:true}},calls=[];
 const s=createResearchSession({canEdit:true,api:async(p,opt)=>{
   assert.equal(p,endpoint);calls.push(opt.method||'GET');
   if(opt.method==='POST')throw Object.assign(Error('冲突'),{status:409});
   return {state:{revision:2,permissions:{canWrite:true}}};
 }},state);
 await assert.rejects(s.save('review:note',{text:'归因'}),/重新核对/);assert.deepEqual(calls,['POST','GET']);assert.equal(state.revision,2);
});
test('stock drawer never fetches for observers and discards a private reply after closing or switching stocks',async()=>{
 const {stockCheckAt}=await load();
 const ctx={canEdit:false,api(){throw Error('must not read a private endpoint');}},c=new AbortController();
 assert.equal(await stockCheckAt(ctx,'000001',{},c.signal),null);
 ctx.canEdit=true;let resolve;
 ctx.api=async()=>new Promise(done=>resolve=done);
 const first=stockCheckAt(ctx,'000001',{tradeDate:'2026-11-19'},c.signal);
 c.abort();resolve({state:{checks:[{code:'000001',date:'2026-11-19'}]}});
 await assert.rejects(first,{name:'AbortError'});
 const calls=[];
 ctx.api=async(p,opt)=>{calls.push(opt.method||'GET');return {state:{permissions:{canWrite:false},
   checks:[{code:'000001',date:'2026-11-19',status:'当时结果'},{code:'000001',date:'2026-11-20',status:'较晚结果'},{code:'000002',date:'2026-11-19',status:'其他股票'}]}};};
 const selected=await stockCheckAt(ctx,'000001',{poolDay:'20261119'},new AbortController().signal);
 assert.deepEqual(calls,['GET']);
 assert.equal(selected.record.status,'当时结果');assert.equal(selected.date,'2026-11-19');assert.equal(selected.replica,true);
});
test('same-day evidence is automatically reread after its short cache window',async()=>{
 const {createResearchSession}=await load();
 const now=Date.now(),calls=[],state={revision:1,permissions:{canWrite:true},
   v6Observation:{code:'000001',day:'2026-11-20',observedAtMs:now-61_000}};
 const s=createResearchSession({canEdit:true,api:async(p,opt)=>{calls.push(opt.body);return {state:{revision:2},result:{day:'2026-11-20'}};}},state);
 await s.loadEvidence('000001','2026-11-20');assert.equal(calls.length,1);
});
