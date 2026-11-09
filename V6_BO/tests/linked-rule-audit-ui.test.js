'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/assets/complete-workbench.js'),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.handlers={};this.children=[];this.value='';this.checked=false;this.textContent='';this.hidden=false;}
 addEventListener(n,fn){this.handlers[n]=fn;}
 append(...elements){this.children.push(...elements);}
 replaceChildren(...elements){this.children=elements;}
 after(el){this.attached=el;}
 remove(){this.removed=true;}
}
function ui(auditReport){
 const ids=Object.fromEntries(['completeRun','paperAppend','paperRead','completeStatus',
  'completeOutput','completeSummary','payload','paperAccountId','token',
  'publicRuleAuditEnabled','linkedRulesAuditEnabled'].map(x=>[x,new Element()]));
 ids.payload.value=JSON.stringify({history:{source:'imported',stocks:[]},
  publicRuleAuditOptions:{windows:2,testDays:25}});
 const found=[];
 const document={getElementById:id=>ids[id]||found.find(x=>x.id===id&&!x.removed)||null,
   createElement(tag){const e=new Element(tag);found.push(e);return e;}};
 const calls=[];
 const fetch=async(url,options)=>{
  calls.push({url,options});
  return {json:async()=>({ok:true,result:{selectionEvidence:{status:'not-evaluated',candidates:[]},
    publicRuleForwardAudit:auditReport||{configuration:{horizons:[]},rules:[]}}})};
 };
 vm.runInNewContext(js,{document,fetch,JSON,Array,String,Number,Error});
 return {ids,calls,found};
}
test('new linked audit checkbox and original safety warning are present in research page',()=>{
 assert.match(html,/id="publicRuleAuditEnabled"/);
 assert.match(html,/id="linkedRulesAuditEnabled"/);
 assert.match(html,/1\/5\/20\/60/);
 assert.match(js,/includeLinkedRules:true/);
 assert.ok(!js.includes('eval('));
});
test('checking linked strategy automatically requests historical audit with preserved options',async()=>{
 const {ids,calls}=ui();ids.linkedRulesAuditEnabled.checked=true;ids.token.value='test-token';
 await ids.completeRun.handlers.click();
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'/api/research/complete-run');
 assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
 const payload=JSON.parse(calls[0].options.body);
 assert.equal(payload.validatePublicRules,true);
 assert.equal(payload.publicRuleAuditOptions.includeLinkedRules,true);
 assert.equal(payload.publicRuleAuditOptions.windows,2);
 assert.equal(payload.publicRuleAuditOptions.testDays,25);
});
test('unchecked linked rules never introduce the extra audit flag or a fake strategy win rate',async()=>{
 const {ids,calls}=ui();ids.publicRuleAuditEnabled.checked=true;
 await ids.completeRun.handlers.click();
 const payload=JSON.parse(calls[0].options.body);
 assert.equal(payload.validatePublicRules,true);
 assert.equal(payload.publicRuleAuditOptions.includeLinkedRules,undefined);
 assert.match(js,/averageNetReturnPct==null\?'未验证'/);
});

test('historical audit renders distinct rule families and no automatic weight change',async()=>{
 const report={configuration:{horizons:[1]},rules:[{id:'donchian20_liquidity',label:'唐奇安',
   byHorizon:{1:{signals:2,modeled:1,averageNetReturnPct:null,winRatePct:null}}}],
  overlapDiagnostics:{status:'descriptive-only',rawRuleSignals:3,uniqueStockDays:2,
   independentFamilyExposures:2,sameFamilyDuplicateSignals:1,
   byRule:{donchian20_liquidity:{signalDays:2,sameFamilyOverlapDays:1,otherFamilyOverlapDays:0,
    reviewNote:'存在同家族重叠，先去相关及扩充独立样本，不建议据此升权'}}}};
 const h=ui(report);await h.ids.completeRun.handlers.click();
 const section=h.found.find(e=>e.id==='publicRuleAuditSummary');
 assert.ok(section.children.some(e=>e.textContent.includes('同家族重复命中 1')));
 const detail=section.children.find(e=>e.tag==='details');
 assert.ok(detail.children.some(e=>e.textContent.includes('同家族重叠 1')));
 assert.ok(detail.children.some(e=>e.textContent.includes('本次未改权重')));
});
