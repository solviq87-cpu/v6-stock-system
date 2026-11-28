'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../src/core/research-workspace-store'),W=require('../src/core/research-interaction-workbench');
const {fixture,at}=require('./helpers/research-workspace-fixtures'),D=require('../src/core/research-workspace-decision');
test('original workbench private feedback commits once and rechecks authority inside original lock',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-feedback-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const data=D.buildWorkspaceDecision(fixture()),a=at(70),e=S.appendEvent(root,'analysis',data,{now:a,requestId:'fayo_feedback_original'});
 const input={action:'save-feedback',symbol:'600000',runId:e.hash,feedback:'reviewed'},roots={root};
 const r=await W.run(roots,{},input,{authorize:()=>true});assert.equal(r.performanceLabel,null);assert.equal(r.reused,false);
 const retry=await W.run(roots,{},input,{authorize:()=>true});assert.equal(retry.recordId,r.recordId);assert.equal(retry.reused,true);
 await assert.rejects(W.run(roots,{},input,{authorize:()=>false}),/授权/);
 let checks=0;await assert.rejects(W.run(roots,{}, {...input,feedback:'ignored'},{authorize:()=>++checks<3}),/授权/);
 assert.equal(S.readEvents(root).length,2);
 const report=await W.run(roots,{mode:'feedback',symbol:'600000',runId:e.hash},null);assert.equal(report.receipts.length,1);
 const historic=await W.run(roots,{mode:'feedback',symbol:'600000',runId:e.hash,asOf:a},null);assert.equal(historic.latest,null);
});
