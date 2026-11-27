// Run from V6_BO. All source-tagged prices in this exercise are synthetic fixtures.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),load=name=>require(path.resolve(name));
const {bindAuthoritativePlan,decisionPlanPayload}=load('src/core/paper-decision-plan');
const {createPaperApplicationService}=load('src/core/paper-application-service');
const {createFixture}=load('tests/helpers/v6-studio-fixture');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),out=process.env.FAYO_STUDY_RECEIPTS||__dirname;
(async()=>{
 const f=await createFixture({count:0});
 try {
  fs.copyFileSync(path.resolve('config/intelligence-center.json'),path.join(f.tmp,'config','intelligence-center.json'));
  const {shortlineJob,syncManualLedger}=await import(path.resolve('src/research/shortline/store.mjs'));
  const dir=path.join(f.tmp,'data','order-accounts'),root=path.join(f.tmp,'data','shortline-research');
  const code='600000',day='2026-11-25',sellDay='2026-11-26';const t=(d,s)=>Date.parse(d+'T'+s+'+08:00');
  const entry=t(day,'10:00:15'),exit=t(sellDay,'11:00:00');let now=entry;
  const card={authority:'fayo-decision-center',decisionId:'b'.repeat(64),code,day,calculatedAt:entry-6000,strategyAt:entry-30000,
   quoteBasis:{code,source:'tencent',quoteAt:entry-7000,receivedAt:entry-6500,price:9.98},plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:19.6}};
  const p=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000002',sampleSet:'real',frozenAt:new Date(entry-5000).toISOString(),...decisionPlanPayload(card)},card);
  const {state}=await shortlineJob({root,book:'main'});delete state.catalog;delete state.permissions;state.revision=1;state.plans=[p];
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(root,'research.json'),JSON.stringify({digest:sha(JSON.stringify(state)),state}),{mode:0o600});
  const file=path.join(dir,'pool.json'),app=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});
  app.adoptLegacy({initial:100000,cash:100000,enabled:true,positions:{},trades:[],realized:0});
  const prior=app.legacy(),reason='作战台计划['+p.id+'] 原账户风控',trade={t:entry,side:'买入',code,name:'隔离复验',price:10,shares:300,amount:3000,fee:5,pnl:null,reason};
  const q={symbol:code,price:10,quoteAt:entry,timestamp:entry,receivedAt:entry,quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',tradeDate:day,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5,suspended:false,tradable:true};
  app.saveLegacy({...prior,cash:prior.cash-3005,positions:{[code]:{code,name:'隔离复验',shares:300,basis:3005,buyPrice:10,buyTs:entry,lastPrice:10,peak:0,reason}},trades:[trade]},app.read().revision,{quotes:{[code]:q}});
  const route='/api/decision-center/research';const reports=[];
  for(const [i,qty] of [100,200].entries()){
   now=exit+i*1000;const id='exit-'+i;app.submit({orderId:id,side:'sell',quantity:qty,symbol:code,limitPrice:11,tradeDate:sellDay});
   app.fill(id,id+'-fill',{symbol:code,timestamp:now,source:'simulated',tradeDate:sellDay,price:11,suspended:false,tradable:true,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5});
   const account=sha(fs.readFileSync(file));const sync=await syncManualLedger(root,path.join(f.tmp,'absent-manual'),dir);assert.equal(sync.imported,1);
   const same=await syncManualLedger(root,path.join(f.tmp,'absent-manual'),dir);assert.equal(same.changed,false);
   const response=await f.request(route);assert.equal(response.status,200);assert.equal(response.body.ok,true,JSON.stringify(response.body).slice(0,350));
   const costs=response.body.result.executionValidation.settledEntryCosts;assert.equal(costs.withBenchmark,i+1);assert.equal(costs.matchedShares,i?300:100);assert.equal(costs.entryPriceDifferenceCny,i?6:2);
   assert.equal(costs.allEntryFeesCny,i?5:1.67);assert.equal(costs.filledEntryShortfallCny,i?11:3.67);assert.equal(costs.unfilledOpportunityCostCny,null);assert.equal(costs.exitPriceDifferenceCny,null);
   assert.equal(sha(fs.readFileSync(file)),account);reports.push({stage:i?'fully-closed':'partially-closed',sync,response:response.status,costs,feesAndNet:response.body.result.executionValidation.strata.standard.attribution.actual});
  }
  const stored=JSON.parse(fs.readFileSync(path.join(root,'research.json'),'utf8')).state;
  fs.writeFileSync(path.join(out,'benchmark-input.json'),JSON.stringify({scope:stored.scope,plans:stored.plans,trades:stored.trades}));
  const denied=await f.request(route,'GET',null,f.viewerToken);assert.equal(denied.status,200);assert.equal(denied.body.locked,true);assert.equal(denied.body.readOnly,true);assert.equal(denied.body.ok,false);assert.equal(denied.body.result,undefined);
  const after=app.read(),balance=after.account.cash-100000;assert.equal(Math.round(balance*100),Math.round(reports[1].feesAndNet.netPnlCny*100));
  const result={scope:'isolated actual paper service, original researcher import, authenticated HTTP; synthetic quote sequence',accountCashChange:balance,viewerHttp:denied.status,viewerLocked:denied.body.locked,viewerReceivedReport:false,reports};
  fs.writeFileSync(path.join(out,'native-account.json'),JSON.stringify(result,null,2)+'\n');
  if(process.env.FAYO_ENTRY_BROWSER){const child=spawnSync('python',[process.env.FAYO_ENTRY_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out}),encoding:'utf8',timeout:100000});if(child.status!==0)throw Error((child.stderr||'browser failed').slice(-1400));}
  console.log(JSON.stringify(result));
 } finally {await f.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
