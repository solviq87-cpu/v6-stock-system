'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {evolutionHttp}=require('../src/server/evolution-http');
const {buildEvolutionReport}=require('../src/core/intelligence-evolution');
const {readEvolutionOperatingEvidence}=require('../src/core/evolution-operating-evidence');
const {createPaperPlanObservationStore}=require('../src/core/paper-plan-observation-store');
const {observePaperPlans}=require('../src/core/paper-plan-observer');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const day='2026-11-20',at=Date.parse(day+'T10:00:00+08:00'),code='600000';
const quote=(patch={})=>({code,name:'原计划安全验证',price:10,volume:100000,preClose:10,quoteSource:'tencent',quoteMode:'public-live-unverified',quoteAt:at,receivedAt:at,canTrade:true,suspended:false,tradable:true,...patch});
function plan(){
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code,day,name:'原计划安全验证',calculatedAt:at-60000,strategyAt:at-90000,quoteBasis:{source:'tencent',quoteAt:at-61000},plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
 return bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',frozenAt:new Date(at-50000).toISOString(),...decisionPlanPayload(card)},card);
}
function observation(frozen,now=at,price=10){
 const row=quote({price,quoteAt:now,receivedAt:now}),q={...row,symbol:code,provider:'tencent',timestamp:now,tradeDate:day,mode:row.quoteMode,volume:row.volume*100,volumeUnit:'shares',upperLimit:11,lowerLimit:9,
  inputProvenance:createAutomaticInputProvenance({stock:row,observation:row,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
 const book={revision:1,legacy:{enabled:true},feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},account:{cash:10000,events:[],positions:{}},orders:{}};
 return observePaperPlans({plans:[frozen],book,quotes:{[code]:q},day,now,calendar:{isOpen:d=>d===day},continuous:true,
  entryEligibilityByPlan:{[frozen.id]:{allowed:true,reason:'原预检通过',checkedAt:now,quoteAt:now}}});
}
function temporary(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'evolution-operating-safety-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return base;}

test('operator reads reject symlink and public paths without touching another private directory',async t=>{
 const base=temporary(t),outside=path.join(base,'outside'),root=path.join(base,'research');
 fs.mkdirSync(outside,{mode:0o700});fs.mkdirSync(root,{mode:0o700});fs.writeFileSync(path.join(outside,'sentinel'),'retain',{mode:0o600});
 for(const name of ['execution-reports','feedback-runs','plan-observations'])fs.symlinkSync(outside,path.join(root,name),'dir');
 const result=await readEvolutionOperatingEvidence({root,asOf:at});
 assert.ok(Object.values(result.workflowSources).every(s=>s.status==='unavailable'));
 assert.deepEqual(fs.readdirSync(outside),['sentinel']);assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'retain');
 const publicRoot=path.join(base,'public','research'),invalid=await readEvolutionOperatingEvidence({root:publicRoot,asOf:at});
 assert.ok(Object.values(invalid.workflowSources).every(s=>s.status==='unavailable'));assert.equal(fs.existsSync(publicRoot),false);
 assert.doesNotMatch(JSON.stringify(invalid),new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('HTTP historical research does not send a currently newer quote into the historical worker',async()=>{
 let payload,status;const now=at+3600000,current=quote({quoteAt:now,receivedAt:now});
 const req={method:'GET',headers:{host:'fayo.test',authorization:'Bearer isolated-token'},socket:{}};
 const res={writeHead:s=>{status=s;},end:()=>{}};
 await evolutionHttp(req,res,{url:new URL('http://fayo.test/api/research/evolution?symbol='+code+'&asOf='+at),root:'/private/research',workspaceRoot:'/private/workspace',authenticate:()=> 'edit',isReplica:()=>false,clock:()=>now,
  readQuote:()=>current,job:async p=>{payload=p;return {ok:true};}});
 assert.equal(status,200);assert.equal(payload.latestQuote,null,'a later real receipt cannot replace the selected historical observation');
});

test('real original observation chains replay by time, and research never substitutes daily close for a missing tick',async t=>{
 const base=temporary(t),frozen=plan(),first=observation(frozen),second=observation(frozen,at+15000,10.2),root=path.join(base,'research');
 assert.deepEqual(first.rejected,[]);assert.deepEqual(second.rejected,[]);
 let clock=at;const store=createPaperPlanObservationStore({root:path.join(root,'plan-observations'),clock:()=>clock,canWrite:()=>true});
 await store.append({...first,now:clock});clock=at+15000;await store.append({...second,now:clock});
 const older=await readEvolutionOperatingEvidence({root,asOf:at}),latest=await readEvolutionOperatingEvidence({root,asOf:clock});
 assert.equal(older.planObservations.length,1);assert.equal(older.planObservations[0].fingerprint,first.records[0].fingerprint);assert.equal(latest.planObservations.length,2);
 const archive={scope:'live',catalog:[],plans:[frozen],bars:[{code,date:'2026-11-19',period:'日K',open:10,high:11,low:9,close:10,volume:1000,source:'tencent',knownAt:at-86400000,availableAt:'2026-11-19',priceBasis:'unadjusted'}],checks:[]};
 const observed=await buildEvolutionReport({archive:{...archive,...older},code,asOf:at});
 assert.equal(observed.market.signalValidity.priceReview.price,10);assert.equal(observed.market.signalValidity.priceReview.evidenceKind,'validated-plan-observation');assert.equal(observed.canTrade,false);
 const missing=await buildEvolutionReport({archive,code,asOf:at});
 assert.equal(missing.market.signalValidity.priceReview.price,null);assert.equal(missing.market.signalValidity.priceReview.status,'unknown');
 const live=await buildEvolutionReport({archive,code,asOf:at,latestQuote:quote({price:10.2})});
 assert.equal(live.market.signalValidity.priceReview.price,10.2);assert.equal(live.market.signalValidity.priceReview.status,'outside-range');
 const damaged=structuredClone(older);damaged.planObservations[0].price=1;
 assert.equal((await buildEvolutionReport({archive:{...archive,...damaged},code,asOf:at})).market.signalValidity.priceReview.price,null);
});

test('future quote perturbation cannot hide a valid historical plan receipt or change its research conclusion',async()=>{
 const frozen=plan(),old=observation(frozen),archive={scope:'live',catalog:[],plans:[frozen],checks:[],bars:[],planObservations:old.records};
 const first=await buildEvolutionReport({archive,code,asOf:at});
 const future=await buildEvolutionReport({archive,code,asOf:at,latestQuote:quote({price:100,quoteAt:at+10000,receivedAt:at+10000})});
 assert.deepEqual(future.market.signalValidity,first.market.signalValidity);
});
