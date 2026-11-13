'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require.resolve('../server'),'utf8');
function fn(name){let a=src.indexOf('function '+name+'(');assert.ok(a>=0);if(src.slice(a-6,a)==='async ')a-=6;return src.slice(a,src.indexOf('\n}\n',a)+2);}
const bars=()=>Array.from({length:30},(_,i)=>({date:'d'+i,close:10,open:10,high:11,low:9,volume:100,pct:0}));
function harness(n,options={}){
 const pool=Array.from({length:n},(_,i)=>({code:String(600000+i),name:'合成样本',limitUpCount:1,price:10,pct:10,amount:1e8,sealAmount:1e8,floatCap:6e9,sector:'板块',breakCount:0,turnover:5}));
 const batches=[],requests=[],saved=[],pushes=[],states=[];
 const S={ztDay:'20261113',ztDayProbed:true,ztPool:pool,ztBySector:{'板块':pool},klines:new Map(),sectors:[],stocks:[],review:{date:'20261112',items:[{code:'old'}]},news:{goodCodes:new Set()}};
 const c=vm.createContext({S,Date,Map,Set,JSON,console:{log(){},warn(){},error(){}},path:{join:(...x)=>x.join('/')},__dirname:'/fixture',KLINE_CACHE:'/fixture/cache',fs:{writeFileSync(){}},
  poolConfirmedEmpty:()=>false,staleMark:(k,v)=>states.push([k,v]),klineSet:(code,k)=>S.klines.set(code,k),_klineWriteErr(){},
  em:{pool:async(items,work,limit)=>{batches.push({items:[...items],limit});for(const item of items)await work(item);},fetchKline:async code=>{requests.push(code);if(options.fail===code)throw Error('fixture unavailable');return {rows:bars()};},fetchBatchSnapshot:async()=>{options.mutate?.(S);return [];}},
  A:{reviewFlags:r=>r?.length>=25?{aboveMa5:true,brokeHighHold:true,volPriceUp:true}:null,nextDayLimitProb:()=>60,buildZTReason:()=>'',isJunkName:n=>n==='ST样本'},
  secStrongOf:()=>[],classifySectorRoles:arr=>({map:new Map(arr.map(x=>[x.code,'follow']))}),ztThemesOf:()=>[],todayHead:()=> 'fixture',todayStr:()=> '20261113',
  atomicWrite:(_p,b)=>saved.push(JSON.parse(b)),pushYiEr:()=>pushes.push('yier'),pushLianbanRelay:()=>pushes.push('relay'),sentToday:()=>true,
  todayBeta:()=>0,themeStrengthOf:()=>({score:60,inflowSum:1e8,theme:'板块'}),isMainlineStock:()=>({ok:true,reason:'fixture'}),krowsOf:()=>bars(),
  fusedProb:()=>({prob:80,delta:0}),ZT_INFER_PUSH_PROB:55,annotateSignalConditions(){},newsSupportsCode:()=>false});
 for(const name of ['mkReviewShell','_computeReviewInner','scanYiEr','scanLianbanRelay'])vm.runInContext(fn(name),c);
 return {c,S,batches,requests,saved,pushes,states};
}
test('95-stock review covers the tail and exposes coverage to downstream relay selection',async()=>{
 const h=harness(95);await h.c._computeReviewInner();assert.equal(h.requests.length,95);
 assert.deepEqual(h.batches.map(b=>b.items.length),[60,35]);assert.ok(h.batches.every(b=>b.limit===12));
 assert.equal(h.S.review.items.length,95);assert.ok(h.S.review.items.every(x=>x.aboveMa5===true));
 assert.equal(h.S.review.historyCoverage.available,95);assert.equal(h.saved[0].historyCoverage.missing,0);assert.deepEqual(h.pushes,['yier','relay']);
});
test('large review remains bounded, reports deferred structure and resumes on next cycle',async()=>{
 const h=harness(195);await h.c._computeReviewInner();assert.equal(h.requests.length,180);
 assert.equal(h.S.review.historyCoverage.deferred,15);assert.equal(h.S.review.historyCoverage.missing,15);
 assert.equal(h.S.review.items.filter(x=>x.aboveMa5===null).length,15);
 h.requests.length=0;await h.c._computeReviewInner();assert.equal(h.requests.length,15);assert.equal(h.S.review.historyCoverage.missing,0);
});
test('one failing K-line does not discard the other review candidates or the existing linkage',async()=>{
 const h=harness(65,{fail:'600010'});await h.c._computeReviewInner();assert.equal(h.S.review.items.length,65);
 assert.equal(h.S.review.historyCoverage.missing,1);assert.equal(h.S.review.items.find(x=>x.code==='600010').aboveMa5,null);
 assert.equal(h.S.review.items.find(x=>x.code==='600064').aboveMa5,true);assert.equal(h.pushes.length,2);
});
test('in-flight pool or data-day replacement cannot publish a mixed review or trigger relay',async()=>{
 for(const mutate of [S=>{S.ztDay='20261116';},S=>{S.ztPool=[...S.ztPool,{code:'600099'}];},S=>{S.ztPool[0].limitUpCount=2;}]){
  const h=harness(1,{mutate}),old=h.S.review;await h.c._computeReviewInner();
  assert.equal(h.S.review,old);assert.equal(h.saved.length,0);assert.equal(h.pushes.length,0);assert.ok(h.states.some(x=>x[1]==='held'));
 }
});
test('unknown board levels never become first-board candidates and known stages stay separate',()=>{
 const h=harness(8);h.S.ztPool.forEach((r,i)=>{r.limitUpCount=[undefined,null,0,NaN,1,2,3,4][i];});
 assert.deepEqual(Array.from(h.c.scanYiEr(),x=>x.code),['600004']);
 const relay=h.c.scanLianbanRelay();assert.deepEqual(Array.from(relay,x=>x.level).sort(),[2,3]);
 assert.ok(relay.every(x=>x.targetLevel===x.level+1));
});
test('equal-ranked relay candidates remain deterministic across provider ordering',()=>{
 const h=harness(10),a=Array.from(h.c.scanYiEr(),x=>x.code);h.S.ztPool.reverse();
 assert.deepEqual(Array.from(h.c.scanYiEr(),x=>x.code),a);
 h.S.ztPool.forEach(x=>x.limitUpCount=2);const b=Array.from(h.c.scanLianbanRelay(),x=>x.code);h.S.ztPool.reverse();
 assert.deepEqual(Array.from(h.c.scanLianbanRelay(),x=>x.code),b);
});
