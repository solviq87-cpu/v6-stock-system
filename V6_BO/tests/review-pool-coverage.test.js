'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {eligibleSupplementRows}=require('../src/core/limit-up-supplement');
const server=fs.readFileSync(require.resolve('../server'),'utf8'),em=fs.readFileSync(require.resolve('../em'),'utf8');
const extract=(src,name)=>{const start=src.indexOf('function '+name+'(');return src.slice(start,src.indexOf('\n}\n',start)+2);};
const at=s=>Date.parse('2026-11-17T'+s+'+08:00');
const row=extra=>({code:'600770',name:'时间校验样本',price:5.53,preClose:5.03,pct:9.94,quoteAt:at('15:00:00'),receivedAt:at('18:00:00'),quoteSource:'sina',...extra});

test('supplement rejects undated, pre-close, wrong-day, future and incoherent observations',()=>{
 const now=at('18:01:00');
 for(const extra of [{quoteAt:null},{receivedAt:null},{quoteSource:null},{quoteAt:at('14:59:59')},{quoteAt:at('15:00:00')-86400000},{quoteAt:now+1},{receivedAt:now+1},{receivedAt:at('14:59:00')}])
  assert.deepEqual(eligibleSupplementRows([row(extra)],'20261117',now),[],JSON.stringify(extra));
 const good=row();assert.deepEqual(eligibleSupplementRows([good],'20261117',now),[good]);
 assert.deepEqual(eligibleSupplementRows([good],'20261118',now),[]);
 assert.deepEqual(eligibleSupplementRows([row({quoteAt:Date.parse('2026-03-02T15:00:00+08:00')})],'20260230',now),[]);
});
test('intraday original-time boundary is 15 seconds, reception does not rejuvenate a row',()=>{
 const now=at('10:00:15'),good=row({quoteAt:at('10:00:00'),receivedAt:now});
 assert.equal(eligibleSupplementRows([good],'20261117',now).length,1);
 assert.equal(eligibleSupplementRows([{...good,quoteAt:good.quoteAt-1}],'20261117',now).length,0);
});
test('both production supplement paths preserve provenance and apply the time gate',()=>{
 const derive=new Function('A','return ('+extract(server,'deriveLimitUpMissed')+');')(require('../analysis'));
 const stocks=[row({quoteAt:null}),row({code:'600001'})];
 const candidates=derive(stocks,[]);assert.equal(candidates.length,2);
 assert.equal(candidates[1].quoteAt,stocks[1].quoteAt);assert.equal(candidates[1].quoteSource,'sina');
 assert.match(server,/const _datedStocks = \(Array\.isArray\(S\.stocks\)/,
  'supplier original dates are filtered before stock reconstruction');
 for(const name of ['_derived','_missed']){
  const expression=server.match(new RegExp('const '+name+' = ([^;]+);'))?.[1];assert.ok(expression,name);
  const result=new Function('require','deriveLimitUpMissed','_derivedEvidence','_datedStocks','zt','_ztDay','return '+expression)(
   ()=>({eligibleSupplementRows:(rows,day)=>eligibleSupplementRows(rows,day,at('18:01:00'))}),
   derive, rows=>rows, [stocks[1]],[],'20261117');
  assert.deepEqual(result.map(x=>x.code),['600001'],
   'both fallback paths require dated original close and the time gate');
 }
});
function fetchPool(data){
 let fallbacks=0;
 const c=vm.createContext({EMX:'https://fixture.invalid',Date,console,
  get:async()=>({data}),curlGet:async()=>{fallbacks++;return {data};},fetchZTPoolThs:async()=>{fallbacks++;return [];},_srcWarn(){},
  require:require('node:module').createRequire(require.resolve('../em.js'))});
 vm.runInContext('async '+extract(em,'fetchZTPool'),c);
 return {run:()=>c.fetchZTPool('20261117'),fallbacks:()=>fallbacks};
}
const records=n=>Array.from({length:n},(_,i)=>({c:String(600000+i),n:'合成样本',p:10000,zdp:10}));
test('provider total 37 and partial 33 remain distinct through JSON persistence',async()=>{
 const f=fetchPool({tc:37,qdate:20261117,pool:records(33)}),rows=JSON.parse(JSON.stringify(await f.run()));
 assert.equal(rows.length,33);assert.equal(f.fallbacks(),0);
 assert.deepEqual({...rows[0].poolEvidence,receivedAt:0},{source:'em',scope:'eastmoney-limit-up-pool',tradeDate:'20261117',requestedDay:'20261117',receivedAt:0,reportedCount:37,returnedCount:33,uniqueCount:33});
});
test('count proof detects duplicate rows and never replaces unknown totals with array length',async()=>{
 const pool=records(2);pool.push(pool[0]);const rows=await fetchPool({tc:3,qdate:20261117,pool}).run();
 assert.equal(rows[0].poolEvidence.returnedCount,3);assert.equal(rows[0].poolEvidence.uniqueCount,2);
 for(const tc of [null,'',false,-1,3.5])assert.equal((await fetchPool({tc,qdate:20261117,pool}).run())[0].poolEvidence.reportedCount,null);
});
test('wrong provider date cannot silently become the requested day',async()=>{
 const f=fetchPool({tc:1,qdate:20261116,pool:records(1)});assert.equal((await f.run()).length,0);assert.equal(f.fallbacks(),2);
 const unknown=await fetchPool({tc:1,pool:records(1)}).run();assert.equal(unknown.length,0,
  'missing upstream date cannot be presented as a dated provider observation');
});
test('review freezes input membership and provider count before later pool changes',()=>{
 const evidence={source:'em',tradeDate:'20261117',reportedCount:37,returnedCount:37,uniqueCount:37};
 const S={ztPool:records(37).map(x=>({code:x.c,name:x.n,src:'em',poolEvidence:evidence})),ztDay:'20261117',ztDayProbed:true};
 const shell=new Function('S','return ('+extract(server,'mkReviewShell')+');')(S);
 const saved=JSON.parse(JSON.stringify(shell(S.ztPool.slice(0,33))));S.ztPool=[];
 assert.equal(saved.items.length,33);assert.equal(saved.poolMembers.length,37);assert.equal(saved.poolEvidence.length,1);assert.equal(saved.poolEvidence[0].reportedCount,37);
});
