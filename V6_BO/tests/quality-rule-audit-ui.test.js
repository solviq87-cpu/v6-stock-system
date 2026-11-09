'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../public/assets/complete-workbench.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.handlers={};this.children=[];this.checked=false;this.value='';this.textContent='';}
 addEventListener(type,fn){this.handlers[type]=fn;}
 trigger(type){return this.handlers[type]?.();}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 after(node){this.afterNode=node;}
 remove(){this.removed=true;}
}
function setup(){
 const ids=Object.fromEntries(['completeRun','paperAppend','paperRead','completeStatus','completeOutput','completeSummary',
  'payload','paperAccountId','token','publicRuleAuditEnabled','linkedRulesAuditEnabled','qualityRulesAuditEnabled']
  .map(x=>[x,new Element()]));
 ids.payload.value=JSON.stringify({history:{source:'imported',stocks:[]}});ids.token.value='test-token';
 const created=[],calls=[];
 const document={
  getElementById(id){return ids[id]||created.find(e=>e.id===id&&!e.removed)||null;},
  createElement(tag){const e=new Element(tag);created.push(e);return e;}
 };
 const fetch=async (url,options)=>{
  calls.push({url,options});
  return {json:async()=>({ok:true,result:{selectionEvidence:{status:'not-evaluated',candidates:[]},
   publicRuleForwardAudit:{status:'unavailable',reason:'历史样本不足'}}})};
 };
 vm.runInNewContext(script,{document,fetch,JSON,Array,Error,String,Number});
 return {ids,calls};
}
test('research UI presents explicit opt-in for quality three-rule forward audit',()=>{
 assert.ok(html.includes('id="qualityRulesAuditEnabled" type="checkbox"'));
 assert.ok(html.includes('验证趋势质量'));
});
test('quality checkbox requests optional dated research audit without enabling linked rules',async()=>{
 const app=setup();app.ids.qualityRulesAuditEnabled.checked=true;
 await app.ids.completeRun.trigger('click');
 assert.equal(app.calls[0].url,'/api/research/complete-run');
 assert.equal(app.calls[0].options.headers.Authorization,'Bearer test-token');
 const body=JSON.parse(app.calls[0].options.body);
 assert.equal(body.validatePublicRules,true);
 assert.equal(body.publicRuleAuditOptions.includeQualityRules,true);
 assert.equal(body.publicRuleAuditOptions.includeLinkedRules,undefined);
});
test('multiple opt-ins coexist and leaving all unchecked restores old default requests',async()=>{
 const app=setup();app.ids.qualityRulesAuditEnabled.checked=true;
 app.ids.linkedRulesAuditEnabled.checked=true;
 await app.ids.completeRun.trigger('click');
 const first=JSON.parse(app.calls[0].options.body);
 assert.equal(first.publicRuleAuditOptions.includeQualityRules,true);
 assert.equal(first.publicRuleAuditOptions.includeLinkedRules,true);
 app.ids.qualityRulesAuditEnabled.checked=false;app.ids.linkedRulesAuditEnabled.checked=false;
 await app.ids.completeRun.trigger('click');
 const later=JSON.parse(app.calls[1].options.body);
 assert.equal(Object.hasOwn(later,'validatePublicRules'),false);
});
test('audit display remains safe text rather than inserting untrusted HTML',()=>{
 assert.ok(script.includes("textContent=String(value"));
 assert.equal(script.includes('innerHTML'),false);
});
