'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {dashboardView}=require('../src/core/dashboard-view');
test('per-stock dashboard links only matching CNINFO documents and preserves ordering, score, missing-data status',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-company-dash-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const now=Date.parse('2026-11-07T08:00:00Z');
 const source=path.join(dir,'optional.json');
 fs.writeFileSync(source,JSON.stringify({
  schemaVersion:1,mode:'optional-research-sources',code:'600001',observedAt:now,canTrade:false,verifiedLive:false,
  sources:[{provider:'cninfo',status:'observed',data:{announcements:[{
   id:'100',code:'600001',title:'关于回购股份的公告',publishedAt:now-1000,
   url:'https://static.cninfo.com.cn/finalpage/2026-11-06/100.pdf'
  }]}}]
 }));
 const previous=process.env.V6_OPTIONAL_RESEARCH_FILE;
 try{
  process.env.V6_OPTIONAL_RESEARCH_FILE=source;
  const stockState={stocksAt:now,news:{},candidatePool:[
   {code:'000001',name:'另一只',score:90,price:11},
   {code:'600001',name:'样本',score:80,price:10}]};
  const result=dashboardView(stockState,null,now);
  assert.deepEqual(result.rows.map(x=>x.code),['000001','600001']);
  assert.deepEqual(result.rows.map(x=>x.score),[90,80]);
  assert.equal(result.rows[0].issuerEvidence.count,0);
  assert.equal(result.rows[1].issuerEvidence.count,1);
  assert.equal(result.rows[1].issuerEvidence.events[0].verified,false);
  assert.equal(result.rows[1].issuerEvidence.events[0].category,'strength-clue');
  assert.equal(result.verifiedLive,false);
 }finally{
  if(previous===undefined)delete process.env.V6_OPTIONAL_RESEARCH_FILE;
  else process.env.V6_OPTIONAL_RESEARCH_FILE=previous;
 }
});
