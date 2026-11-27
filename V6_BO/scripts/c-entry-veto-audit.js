'use strict';
// Explicit unresolved C20 integration-contract probes, not a production gate.
// Exit nonzero while the stricter proposed C contract is not satisfied. The
// ordinary tests cover the EXISTING approved authority; this script is a
// separate review gate for the pending shared contract, never a skipped CI test.
const {fixture,probe,model}=require('../tests/helpers/c-entry-veto-fixture');
async function run(){
 const cases=[
  ['LATEST_CARD_INCOMPLETE',f=>{f.authoritative.plan={...f.authoritative.plan,complete:false};},'inconsistent card injected; real producer reachability unproven'],
  ['CURRENT_INTERVAL_DISAGREES',f=>{f.authoritative.plan={...f.authoritative.plan,buyLow:10.01,buyHigh:10.02};},'inconsistent card/quote injected; real producer reachability unproven'],
  ['FROZEN_PROTECTION_REVISED',async f=>{
   const [m]=await model;
   f.authoritative.plan=m.decisionPlan({price:10,levels:{ma5:9.9,stop:9.5,t1:11.2}},{enabled:true,cash:10000,equity:10000,maxPos:5,positions:[]});
  },'current price geometry separately valid; authoritative producer/transaction route still needs end-to-end proof'],
  ['UNAPPROVED_C_SPECIALIST_VETO',f=>{f.authoritative.riskAssessment={status:'blocked',canOpenRisk:false};},'explicit negative field on an injected current authority card; producer and transaction-lock integration are not approved or demonstrated'],
  ['MISSING_EXPLICIT_QUOTE_PERMISSION',f=>{delete f.quote.canTrade;},'adapter reaches callback; original transaction may still reject absent fill authority']
 ];
 const results=[];
 for(const [id,edit,scope] of cases){
  const f=await fixture();await edit(f);const result=probe(f);
  results.push({id,scope,proposedExpected:'reject-before-buy-callback',observed:result,reviewRequired:result.reached});
 }
 return {scope:'isolated original adapter callback, no real execution or ledger mutation',results,unresolved:results.filter(x=>x.reviewRequired).length,formalContractApproved:false};
}
if(require.main===module)run().then(r=>{process.stdout.write(JSON.stringify(r,null,2)+'\n');if(r.unresolved)process.exitCode=1;},e=>{console.error(e);process.exitCode=1;});
module.exports={run};
