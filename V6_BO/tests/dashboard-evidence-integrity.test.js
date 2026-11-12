'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {dashboardView}=require('../src/core/dashboard-view');
const now=Date.parse('2026-11-12T06:00:00Z'),ts=now-60000;
function view(signal={},row={},meta={}){
 return dashboardView({stocksAt:now,candidatePool:[{code:'000001',price:10,score:80,...row}],signals:[{code:'000001',type:'趋势票',ts,prob:78,...signal}]},null,now,{strategyVersion:'current-app',pushGov:{minProb:70},...meta});
}
function frontend(start,end,context={}){
 const src=fs.readFileSync(require.resolve('../public/assets/terminal-dashboard.js'),'utf8');
 vm.createContext(context);vm.runInContext(src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start))),context);return context;
}
test('application version never fills missing frozen signal strategy version',()=>{
 assert.equal(view().pushes.items[0].strategyVersion,'');
 assert.equal(view({strategyVersion:'strategy-at-trigger'}).pushes.items[0].strategyVersion,'strategy-at-trigger');
});
test('current probability gate and invented zero/70 gates cannot judge old signal or candidate',()=>{
 const d=view({}, {momentumScore:88});
 assert.ok(d.pushes.items[0].conditions.every(x=>x.satisfied===null&&x.threshold===null));
 const candidate=dashboardView({stocksAt:now,candidatePool:[{code:'000001',price:10,score:80,momentumScore:88}]},null,now).pushes.items[0];
 assert.ok(candidate.conditions.every(x=>x.satisfied===null&&x.threshold===null));
});
test('only recorded numeric condition evidence with a source and causal time is evaluated',()=>{
 const conditionEvidence=[{id:'probability',label:'触发评分门',value:78,threshold:75,operator:'>=',source:'frozen-rule',updatedAt:ts}];
 const item=view({conditionEvidence}).pushes.items[0];assert.equal(item.conditions[0].satisfied,true);assert.equal(item.conditions[0].threshold,75);
 for(const patch of [{updatedAt:ts+1},{source:''},{value:null},{threshold:null}]){
  const c=view({conditionEvidence:[{...conditionEvidence[0],...patch}]}).pushes.items[0].conditions[0];assert.equal(c.satisfied,null);
 }
});
test('retained push history is not silently limited to 20 and matching receipt is still found behind newer logs',()=>{
 const logs=Array.from({length:25},(_,i)=>({ts:now-i,status:'✅ 已送达',title:'other-'+i,extra:{codes:['000001']}}));
 logs.push({ts:now-1000,status:'✅ 已送达',extra:{codes:['000001'],signalRefs:[{code:'000001',type:'趋势票',ts}]}});
 const item=view({}, {}, {pushLog:logs}).pushes.items[0];assert.equal(item.pushHistory.length,26);assert.equal(item.stage,'sent');
});
test('logs for stocks outside current pool and signals remain visible as history, without invented quote or active signal',()=>{
 const d=dashboardView({},null,now,{pushLog:[{ts:ts,status:'✅ 已送达',extra:{codes:['600001']}}]});
 assert.equal(d.pushes.items.length,1);const item=d.pushes.items[0];assert.equal(item.stage,'history');assert.equal(item.price,null);assert.equal(item.triggerAt,null);assert.equal(item.signalValidity,'unknown');
});
test('all distinct strategy signals remain available, including older than the previous 12-row limit',()=>{
 const d=dashboardView({signals:Array.from({length:17},(_,i)=>({code:'000001',type:i%2?'甲':'乙',ts:ts-i}))},null,now);
 assert.equal(d.pushes.items[0].signalHistory.length,17);
});
test('history deduplication keeps records with distinct signal identities at the same timestamp',()=>{
 const logs=[ts,ts-1].map(t=>({ts:now,status:'✅ 已送达',title:'same',extra:{codes:['000001'],signalRefs:[{code:'000001',type:'趋势票',ts:t}]}}));
 assert.equal(view({}, {}, {pushLog:logs}).pushes.items[0].pushHistory.length,2);
});
test('frontend fallback never synthesizes a production factor threshold',()=>{
 const c=frontend('function shapeCondition(', 'function pushItemsForView(', {finite:Number.isFinite});
 assert.ok(c.fallbackConditions({score:80,factorValues:{momentumScore:88}}).every(x=>x.threshold===null&&x.satisfied===null));
});
test('index-linked market scope includes STAR in Shanghai without calling the STAR board the STAR50 constituents',()=>{
 const c=frontend('function indexKey(', 'function rowInSector(');
 assert.equal(c.rowInIndex({code:'688001'},'1.000001'),true);
 assert.equal(c.indexKey('1.000688'),'star');
 assert.equal(c.rowInIndex({code:'600001'},'0.399001'),false);
});
test('frontend keeps all supplied histories and does not replace absent signal version with current app version',()=>{
 const item={code:'000001',stage:'triggered',pushHistory:Array.from({length:26},(_,i)=>({ts:ts-i,status:'✅ 已送达'})),signalHistory:Array.from({length:17},(_,i)=>({triggerAt:ts-i,triggerStrategy:'趋势票'}))};
 const c=frontend('function shapeCondition(', 'function normalizePushOpen(', {model:{pushes:{items:[item],strategyVersion:'current-app'}},codeRe:/^\d{6}$/,finite:Number.isFinite,indexScope:'all',sectorScope:'',pushTab:'pushed',pushStage:'all',rowInIndex:()=>true,stageMap:{}});
 const out=c.pushItemsForView()[0];assert.equal(out.pushHistory.length,26);assert.equal(out.signalHistory.length,17);assert.equal(out.strategyVersion,'');
});
test('a failed or unknown second channel cannot erase the matching successful delivery',()=>{
 const receipt=(status,at,channel)=>({ts:at,status,channel,extra:{codes:['000001'],signalRefs:[{code:'000001',type:'趋势票',ts}]}});
 for(const status of ['❌ 未送达','⚠️ 送达结果未知']){
  const item=view({}, {}, {pushLog:[receipt(status,now-1,'email'),receipt('✅ 已送达',now-2,'private')]}).pushes.items[0];
  assert.equal(item.stage,'sent');assert.equal(item.pushChannel,'private');assert.equal(item.pushHistory.length,2);
 }
});
test('each historical signal preserves its own frozen version, conditions and quote provenance',()=>{
 const conditionEvidence=[{id:'gate',label:'评分门',value:78,threshold:75,operator:'>=',source:'frozen-rule',updatedAt:ts}];
 const d=dashboardView({signals:[{code:'000001',type:'甲',ts,strategyVersion:'old',conditionEvidence,quoteAt:ts-1,quoteSource:'snapshot-old'},{code:'000001',type:'乙',ts:ts+1,strategyVersion:'new'}]},null,now);
 const old=d.pushes.items[0].signalHistory.find(h=>h.triggerStrategy==='甲');
 assert.equal(old.strategyVersion,'old');assert.equal(old.conditionEvidence[0].satisfied,true);assert.equal(old.quoteAt,ts-1);assert.equal(old.quoteSource,'snapshot-old');
});
