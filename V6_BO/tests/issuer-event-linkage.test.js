'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {linkIssuerEvents,classifyTitle,buildIssuerLinkage,buildIssuerPools}=require('../src/strategy/issuer-event-linkage');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {scanUniverse:scanV2}=require('../src/strategy/research-v2-universe-scanner');
const now=Date.parse('2026-11-07T08:00:00Z');
function event(title,id,code='600001',when='2026-11-06T08:00:00Z'){
 return {code,title,source:'巨潮资讯 · 未独立核验',publishedAt:when,url:'https://static.cninfo.com.cn/finalpage/2026-11-06/'+id+'.pdf'};
}
function fixture(){
 const bars=Array.from({length:36},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
  open:10,high:10.2,low:9.8,close:10,volume:1000000,amount:120000000}));
 bars.splice(-3,3,
  {...bars.at(-3),open:9.8,close:10.1,low:9.7,high:10.15},
  {...bars.at(-2),open:9.95,close:10.3,low:9.8,high:10.35},
  {...bars.at(-1),open:10.1,close:10.5,low:9.9,high:10.55});
 return {symbol:'600001',name:'样本股',market:'main',feed:{source:'imported',timestamp:now},bars};
}
test('announcement headlines remain unverified clues with original CNINFO PDF only',()=>{
 const x=linkIssuerEvents({symbol:'600001',now,announcements:[
  event('关于股份回购计划的公告','101'),
  event('关于股份回购计划的公告','101'),
  event('收到立案调查通知书','102'),
  event('关于终止回购股份的公告','103'),
  event('某公司重大诉讼','104','000001'),
  event('<img src=x onerror=alert(1)>','105')
 ]});
 assert.equal(x.status,'headline-research-only');
 assert.equal(x.count,4,'deduplicate identical documents and reject unrelated stock');
 assert.equal(x.riskClues.length,1);
 assert.equal(x.strengthClues.length,1);
 assert.equal(x.conflicts.length,1);
 assert.equal(x.events.every(v=>v.verified===false&&v.impactScore===null),true);
 assert.equal(classifyTitle('关于终止回购股份的公告'),'conflicting');
 assert.equal(x.events.some(v=>v.title.includes('<img')),true,'raw title must remain evidence; UI escape is separate');
});
test('future, impossible or stale timestamps and malicious PDF URLs cannot count as evidence',()=>{
 const rows=[
  event('重大诉讼','101','600001','2026-11-08T08:00:00Z'),
  event('重大诉讼','102','600001','2026-02-30T08:00:00Z'),
  event('重大诉讼','103','600001','2025-05-01T08:00:00Z'),
  {...event('重大诉讼','104'),url:'https://evil.example/finalpage/2026-11-06/104.pdf'},
  {...event('重大诉讼','105'),url:'https://static.cninfo.com.cn/finalpage/2026-11-06/../../secret'}
 ];
 const res=linkIssuerEvents({symbol:'600001',now,announcements:rows});
 assert.equal(res.count,0);
 assert.equal(res.unusableCount,rows.length);
 assert.equal(linkIssuerEvents({symbol:'600001',now,announcements:'wrong'}).status,'invalid-input');
});
test('bullish pattern + issuer risk creates conflict without changing original score, official pool or trading authority',()=>{
 const base=fixture();
 const bad=event('收到立案调查通知书','100');
 const good=event('关于回购股份的公告','101');
 for(const scan of [scanUniverse,scanV2]){
  const baseline=scan({stocks:[base],now});
  const linked=scan({stocks:[{...base,announcements:[bad,good]}],now});
  assert.equal(linked.items[0].score,baseline.items[0].score);
  assert.equal(linked.items[0].tradable,baseline.items[0].tradable);
  assert.equal(linked.items[0].patterns.positiveCount,baseline.items[0].patterns.positiveCount);
  assert.equal(linked.items[0].issuerLinkage.riskConflict,true);
  assert.equal(linked.items[0].issuerLinkage.bonusPoints,0);
  assert.equal(linked.items[0].issuerLinkage.priority,'unchanged');
  assert.equal(linked.issuerPools['公告风险核对池'].length,1);
  assert.equal(linked.issuerPools['公告优势线索池'].length,1);
  assert.equal(linked.issuerPools['公告矛盾待核对池'].length,1);
  assert.equal(linked.items[0].issuerEvidence.events.every(d=>d.verified===false),true);
 }
});
test('risk still surfaces for blocked stocks; strength pool does not promote risk-blocked stocks',()=>{
 const e=linkIssuerEvents({symbol:'600001',now,announcements:[event('收到立案调查通知书','100'),event('关于回购股份的公告','101')]});
 const item={symbol:'600001',name:'样本',issuerEvidence:e,issuerLinkage:buildIssuerLinkage({issuerEvidence:e,patterns:{positiveCount:2,riskCount:0}}),blockedBySafety:true,quality:{usable:true}};
 const p=buildIssuerPools([item]);
 assert.equal(p['公告风险核对池'].length,1);
 assert.equal(p['公告优势线索池'].length,0);
 assert.equal(p['公告矛盾待核对池'].length,1);
});
test('scanner reuses optional CNINFO document when configured, but does not manufacture news without it',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v6-issuer-'));
 const fn=path.join(folder,'optional.json'),original=process.env.V6_OPTIONAL_RESEARCH_FILE;
 try{
  fs.writeFileSync(fn,JSON.stringify({schemaVersion:1,mode:'optional-research-sources',code:'600001',
   observedAt:now,canTrade:false,verifiedLive:false,sources:[{provider:'cninfo',status:'observed',data:{announcements:[{
    id:'101',code:'600001',title:'关于回购股份的公告',publishedAt:now-1000,
    url:'https://static.cninfo.com.cn/finalpage/2026-11-06/101.pdf'}]}}]}));
  process.env.V6_OPTIONAL_RESEARCH_FILE=fn;
  const linked=scanUniverse({stocks:[fixture()],now});
  assert.equal(linked.items[0].issuerEvidence.strengthClues.length,1);
  assert.equal(linked.issuerEvidenceSource,'research-only');
  delete process.env.V6_OPTIONAL_RESEARCH_FILE;
  const noFeed=scanUniverse({stocks:[fixture()],now});
  assert.equal(noFeed.items[0].issuerEvidence.count,0);
  assert.equal(noFeed.issuerEvidenceSource,'unconfigured');
 }finally{
  if(original===undefined)delete process.env.V6_OPTIONAL_RESEARCH_FILE;else process.env.V6_OPTIONAL_RESEARCH_FILE=original;
  fs.rmSync(folder,{recursive:true,force:true});
 }
});
test('research UI visibly exposes announcement pools, unverified disclosure and document links',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
 const client=fs.readFileSync(path.join(__dirname,'../public/assets/research-workbench.js'),'utf8');
 assert.match(html,/id="issuerPools"/);
 assert.match(client,/issuerEvidence/);
 assert.match(client,/issuerLinkage/);
 assert.match(client,/rel="noopener noreferrer"/);
 assert.match(client,/未经正文核实/);
});
