'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../public/assets/complete-workbench.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
const service=fs.readFileSync(path.join(__dirname,'../src/core/complete-workbench.js'),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.handlers={};this.textContent='';this.checked=false;this.value='';this.hidden=false;}
 append(...children){this.children.push(...children);}
 after(node){this.afterNode=node;}
 replaceChildren(...children){this.children=children;}
 remove(){this.removed=true;}
 addEventListener(type,callback){this.handlers[type]=callback;}
 trigger(type){return this.handlers[type]?.();}
}
function harness(){
 const ids=Object.fromEntries(['completeRun','paperAppend','paperRead','completeStatus','completeOutput',
  'completeSummary','payload','paperAccountId','token','publicRuleAuditEnabled'].map(id=>[id,new Element()]));
 const created=[];
 const document={getElementById(id){return ids[id]||created.find(e=>e.id===id&&!e.removed)||null;},
  createElement(tag){const e=new Element(tag);created.push(e);return e;}};
 ids.payload.value=JSON.stringify({history:{source:'imported',stocks:[]}});ids.token.value='private-test-token';
 const calls=[];
 const result={ok:true,result:{selectionEvidence:{status:'not-evaluated',candidates:[]},
  publicRuleForwardAudit:{mode:'frozen-public-rule-forward-audit',status:'evaluated',
   configuration:{horizons:[1,5,20,60]},rules:[{id:'vnpy_boll_cci_atr',label:'布林CCI ATR',
   byHorizon:{1:{signals:3,modeled:2,averageNetReturnPct:-0.5,winRatePct:25},
    5:{signals:3,modeled:0,averageNetReturnPct:null,winRatePct:null}}}]}}};
 const fetch=async(url,options)=>{calls.push({url,options});
  const requested=JSON.parse(options.body).validatePublicRules===true;
  return {json:async()=>requested?result:{ok:true,result:{selectionEvidence:{status:'not-evaluated',candidates:[]}}}};
 };
 vm.runInNewContext(script,{document,fetch,JSON,Array,Error,String,Number});
 return {ids,created,document,calls};
}
test('web option is opt-in, non-live and description includes horizons',()=>{
 assert.ok(html.includes('id="publicRuleAuditEnabled" type="checkbox"'));
 assert.ok(html.includes('1/5/20/60'));
 assert.ok(service.includes('evaluatePublicRuleForwardAudit'));
 assert.ok(service.includes("payload.validatePublicRules===true"));
 assert.ok(service.includes("publicRuleForwardAudit"));
});
test('checked box runs authenticated existing research endpoint and prints blocked statistics',async()=>{
 const h=harness();h.ids.publicRuleAuditEnabled.checked=true;
 await h.ids.completeRun.trigger('click');
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url,'/api/research/complete-run');
 assert.equal(h.calls[0].options.headers.Authorization,'Bearer private-test-token');
 const payload=JSON.parse(h.calls[0].options.body);
 assert.equal(payload.validatePublicRules,true);
 const section=h.document.getElementById('publicRuleAuditSummary');
 assert.ok(section);
 assert.ok(section.children.some(e=>e.textContent.includes('独立未来表现验证')));
 const details=section.children.filter(e=>e.tag==='details');
 assert.equal(details.length,1);
 assert.ok(details[0].children.some(e=>e.textContent.includes('无法建模 1')));
 assert.ok(details[0].children.some(e=>e.textContent.includes('未验证')));
});
test('unchecked box does not request expensive audit and subsequent results clear previous audit',async()=>{
 const h=harness();h.ids.publicRuleAuditEnabled.checked=true;await h.ids.completeRun.trigger('click');
 assert.ok(h.document.getElementById('publicRuleAuditSummary'));
 h.ids.publicRuleAuditEnabled.checked=false;await h.ids.completeRun.trigger('click');
 assert.ok(!Object.hasOwn(JSON.parse(h.calls[1].options.body),'validatePublicRules'));
 assert.equal(h.document.getElementById('publicRuleAuditSummary'),null);
});
test('research output uses textContent, not arbitrary HTML injection',()=>{
 assert.ok(script.includes("child.textContent=String(value"));
 assert.ok(!script.includes('innerHTML'));
});
