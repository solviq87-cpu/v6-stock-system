'use strict';
// Isolated original account/report fixtures, never production executions.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const W=require('../src/core/research-interaction-workbench');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {createPaperExecutionReportStore}=require('../src/core/paper-execution-report-store');
const stamp=(d,t='15:15:00')=>Date.parse(d+'T'+t+'+08:00');
const days=['2026-11-06','2026-11-09','2026-11-10'];
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-nextplan-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const roots={root:path.join(base,'workspace'),manualRoot:path.join(base,'manual'),shortlineRoot:path.join(base,'shortline')};
 let now=stamp(days[0],'09:20:00');
 const file=path.join(base,'pool.json'),account=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:d=>days.includes(d)}});
 account.adoptLegacy({initial:100000,cash:100000,enabled:true,positions:{},trades:[],realized:0});
 const plans=days.map((day,index)=>{
  const c={authority:'fayo-decision-center',decisionId:String(index+1).repeat(64),code:'600000',name:'隔离计划',day,
   calculatedAt:stamp(day,'09:19:40'),strategyAt:stamp(day,'09:19:00'),quoteBasis:{source:'tencent',quoteAt:stamp(day,'09:19:39')},
   plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
  return bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-00000000000'+(index+1),sampleSet:'real',
   frozenAt:new Date(stamp(day,'09:20:00')).toISOString(),...decisionPlanPayload(c)},c);
 });
 const quote=(day,price)=>({symbol:'600000',price,quoteAt:now,timestamp:now,receivedAt:now,quoteSource:'tencent',provider:'tencent',
  mode:'public-live-unverified',tradeDate:day,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5,suspended:false,tradable:true});
 function buy(index,price){
  const p=plans[index],day=days[index];now=stamp(day,'10:00:00');
  const before=account.legacy(),reason='作战台计划['+p.id+'] 原账户风控';
  const trade={t:now,side:'买入',code:p.code,name:'隔离账户',price,shares:100,amount:price*100,fee:5,pnl:null,reason};
  account.saveLegacy({...before,cash:before.cash-price*100-5,
   positions:{'600000':{code:p.code,name:'隔离账户',shares:100,basis:price*100+5,buyPrice:price,buyTs:now,lastPrice:price,peak:0,reason}},
   trades:[trade,...before.trades]},account.read().revision,{quotes:{'600000':quote(day,price)}});
 }
 function sell(index){
  const day=days[index];now=stamp(day,'09:35:00');
  account.submit({orderId:'close-'+index,side:'sell',quantity:100,symbol:'600000',limitPrice:9.5,tradeDate:day});
  account.fill('close-'+index,'close-fill-'+index,{symbol:'600000',price:10,timestamp:now,source:'simulated',tradeDate:day,
   volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5,suspended:false,tradable:true});
 }
 const reportRoot=path.join(roots.shortlineRoot,'execution-reports');
 const store=createPaperExecutionReportStore({root:reportRoot,clock:()=>now,canWrite:()=>true});
 function save(index,{at=stamp(days[index]),include=plans.slice(0,index+1)}={}){
  now=at;return store.save({day:days[index],now,book:account.read(),plans:include,observations:[],conditionalOrders:[],
   sources:{archiveRevision:index+1,observationRevision:0,conditionalRevision:0,ledgerReadAt:now}});
 }
 async function read(asOf=now){return W.readDiscipline(roots,{symbol:'600000',asOf});}
 return {roots,plans,account,file,store,reportRoot,buy,sell,save,read,setNow:value=>{now=value;}};
}
const original=result=>result.followups.find(r=>r.source==='原模拟执行日报'&&r.date===days[0]&&r.rule==='按计划买入');

test('native plan, original ledger and sealed reports expose the first later plan without erasing the original incident',async t=>{
 const x=fixture(t);x.buy(0,10.2);const first=x.save(0);x.sell(1);x.buy(1,10);const second=x.save(1);
 const ledger=fs.readFileSync(x.file),before=await x.read(stamp(days[0]));
 assert.equal(original(before).status,'触发');assert.equal(original(before).nextPlanCheck.status,'unknown');
 const result=await x.read(),row=original(result),next=row.nextPlanCheck;
 assert.equal(row.status,'触发');assert.equal(row.followup.status,'后续原核验再次触发');assert.equal(row.accountId,'pool');
 assert.equal(row.ref,first.reportHash);assert.equal(row.planFrozenAt,stamp(days[0],'09:20:00'));
 assert.equal(next.status,'observed');assert.equal(next.label,'后续计划原核验符合');
 assert.equal(next.accountId,row.accountId);assert.equal(next.planId,x.plans[1].id);assert.notEqual(next.planVersion,row.planVersion);
 assert.equal(next.rule,row.rule);assert.equal(next.ruleVersion,row.ruleVersion);assert.equal(next.ref,second.reportHash);
 assert.ok(next.refs.includes(second.reportHash));assert.ok(next.planFrozenAt>row.knownAt&&next.planFrozenAt<=next.knownAt);
 assert.match(next.note,/不证明用户看过建议或习惯改善/);assert.equal(result.canTrade,false);assert.equal(result.canNotify,false);
 assert.deepEqual(fs.readFileSync(x.file),ledger);assert.deepEqual((await x.read()).followups,result.followups);
});

test('a missing next-plan execution cannot be skipped in favour of a later successful plan',async t=>{
 const x=fixture(t);x.buy(0,10.2);x.save(0);x.sell(1);x.save(1);x.buy(2,10);x.save(2);
 const row=original(await x.read());assert.equal(row.status,'触发');
 assert.equal(row.nextPlanCheck.planId,x.plans[1].id);assert.equal(row.nextPlanCheck.status,'unknown');
 assert.match(row.nextPlanCheck.reason,/原核验.*资料不足/);assert.equal(row.nextPlanCheck.label,'后续计划证据不足');
});

test('late source receipts do not backdate improvement knowledge, and a removed latest report cannot erase the first next plan',async t=>{
 const x=fixture(t);x.buy(0,10.2);x.save(0,{at:stamp(days[1],'09:25:00')});x.sell(1);x.buy(1,10);x.save(1);
 const late=original(await x.read());assert.equal(late.nextPlanCheck.status,'unknown');assert.equal(late.nextPlanCheck.planId,null);
 const y=fixture(t);y.buy(0,10.2);y.save(0);y.sell(1);y.save(1);
 y.save(1,{at:stamp(days[1],'16:00:00'),include:[]});y.buy(2,10);y.save(2);
 const removed=original(await y.read());assert.equal(removed.nextPlanCheck.planId,y.plans[1].id);
 assert.equal(removed.nextPlanCheck.status,'unknown');assert.match(removed.nextPlanCheck.reason,/同一原引用/);
});

test('same-plan followup stays distinct and incomplete identities, references or changed rule versions remain unknown',async t=>{
 const x=fixture(t);x.buy(0,10.2);const first=x.save(0);x.sell(1);x.buy(1,10);const second=x.save(1);x.sell(2);x.buy(2,10);const third=x.save(2);
 const nextPlans=[],rows=[first,second,third].flatMap(saved=>W.reportDisciplineRows(saved,{asOf:stamp(days[2]),nextPlans}));
 const base=rows.find(r=>r.date===days[0]&&r.rule==='按计划买入');
 assert.equal(W.followups(rows,{nextPlans,asOf:stamp(days[2])}).find(r=>r.ref===base.ref&&r.rule===base.rule).nextPlanCheck.status,'observed');
 for(const patch of [{accountId:null},{planVersion:null},{planFrozenAt:null},{ref:null}]){
  const changed=rows.map(r=>r===base?{...r,...patch}:r);
  assert.equal(W.followups(changed,{nextPlans,asOf:stamp(days[2])})[0].nextPlanCheck.status,'not-ready');
 }
 for(const patch of [{ruleVersion:'different-original-rule'},{evidenceRefs:[]},{status:'资料不足'},{status:'不适用'}]){
  const changed=rows.map(r=>r.planId===x.plans[1].id?{...r,...patch}:r);
  const changedPlans=nextPlans.map(r=>r.planId===x.plans[1].id&&patch.ruleVersion?{...r,ruleVersion:patch.ruleVersion}:r);
  const next=W.followups(changed,{nextPlans:changedPlans,asOf:stamp(days[2])})[0].nextPlanCheck;
  assert.equal(next.planId,x.plans[1].id);assert.equal(next.status,'unknown');
 }
 const manual={...base,source:'本人实录',accountId:null};
 assert.equal(W.followups([manual],{asOf:stamp(days[2])})[0].nextPlanCheck.status,'not-ready');
 const same={...base,date:days[1],knownAt:stamp(days[1]),status:'符合'};
 const originalRow=W.followups([base,same],{asOf:stamp(days[2])})[0];
 assert.equal(originalRow.followup.status,'后续处理已有符合证据');assert.equal(originalRow.nextPlanCheck.status,'unknown');
});

test('the next native plan can trigger again; repeated versions deduplicate and identity overflow cannot select a favourable subset',async t=>{
 const x=fixture(t);x.buy(0,10.2);const first=x.save(0);x.sell(1);x.buy(1,10.3);const second=x.save(1);
 const actual=original(await x.read());assert.equal(actual.status,'触发');assert.equal(actual.nextPlanCheck.status,'observed');
 assert.equal(actual.nextPlanCheck.label,'后续计划原核验再次触发');
 const nextPlans=[],rows=[first,second].flatMap(saved=>W.reportDisciplineRows(saved,{asOf:stamp(days[1]),nextPlans}));
 const candidate=nextPlans.find(p=>p.planId===x.plans[1].id),base=rows.find(r=>r.date===days[0]&&r.rule==='按计划买入');
 const repeated=Array.from({length:20001},()=>candidate);
 assert.equal(W.followups(rows,{nextPlans:repeated,asOf:stamp(days[1])})[0].nextPlanCheck.status,'observed');
 const different=repeated.map((p,i)=>({...p,planId:'distinct-native-identity-'+i}));
 const overflow=W.followups([base],{nextPlans:different,asOf:stamp(days[1])})[0];
 assert.equal(overflow.status,'触发');assert.equal(overflow.nextPlanCheck.status,'not-ready');
 assert.equal(overflow.nextPlanCheck.planId,null);assert.match(overflow.nextPlanCheck.reason,/20000.*未选择任何候选/);
 for(const patch of [{accountId:null},{planFrozenAt:null}]){
  const unknown=W.followups(rows,{nextPlans:[{...candidate,...patch}],asOf:stamp(days[1])})[0].nextPlanCheck;
  assert.equal(unknown.status,'unknown');assert.match(unknown.reason,/不能确定核对顺序/);
 }
 const changed=[candidate,{...candidate,planVersion:'f'.repeat(64)}];
 const ambiguity=W.followups(rows,{nextPlans:changed,asOf:stamp(days[1])})[0].nextPlanCheck;
 assert.equal(ambiguity.planId,candidate.planId);assert.equal(ambiguity.status,'unknown');assert.match(ambiguity.reason,/版本身份有歧义/);
});
