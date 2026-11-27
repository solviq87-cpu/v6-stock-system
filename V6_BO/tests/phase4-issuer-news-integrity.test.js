'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {linkIssuerEvents,classifyTitle,buildIssuerLinkage,buildIssuerPools}=require('../src/strategy/issuer-event-linkage');
const now=Date.parse('2026-11-07T08:00:00Z'),published='2026-11-06T08:00:00Z',pub=Date.parse(published);
const symbol='600001';
const row=(patch={})=>({code:symbol,title:'关于股份回购计划的公告',source:'巨潮资讯',publishedAt:published,
 url:'https://static.cninfo.com.cn/finalpage/2026-11-06/101.pdf',...patch});
const run=(announcements,asOf=now)=>linkIssuerEvents({symbol,announcements,now:asOf});
test('all supplied news availability clocks must be causal; unknown legacy receipt stays disclosed',()=>{
 for(const patch of [{knownAt:now+1},{receivedAt:pub-1},{availableAt:'bad'},{recordedAt:now+1},
  {observedAt:'2026-02-30T12:00:00+08:00'},{retrievedAt:'2026-11-07T24:00:00+08:00'},
  {knownAt:pub,observedAt:pub+1},{receivedAt:pub+2,recordedAt:pub+1}]){
  const r=run([row(patch)]);assert.equal(r.count,0);assert.equal(r.unusableCount,1);
 }
 const a=run([row({knownAt:new Date(pub+1000).toISOString(),receivedAt:pub+1000})]);
 assert.equal(a.events[0].knownAt,pub+1000);assert.equal(a.events[0].timeBasis,'declared-publication-and-local-availability');
 const legacy=run([row()]);assert.equal(legacy.count,1);assert.equal(legacy.events[0].knownAt,null);
 assert.equal(legacy.events[0].verified,false);
});
test('same document conflicting headline or publication time is one disputed clue, not two favorable votes',()=>{
 const rows=[row(),row({title:'收到立案调查通知书'}),row({source:'另一来源'})];
 const out=run(rows);
 assert.equal(out.count,1);assert.equal(out.strengthClues.length,0);assert.equal(out.conflicts.length,1);
 assert.equal(out.documentConflicts.length,1);assert.equal(out.duplicateCount,1);
 assert.equal(out.conflicts[0].variants.length,2);
 assert.deepEqual(run([...rows].reverse()),out);
 const timeConflict=run([row(),row({publishedAt:'2026-11-06T09:00:00Z'})]);
 assert.equal(timeConflict.count,1);assert.equal(timeConflict.conflicts.length,1);
});
test('duplicate official URLs with identical content do not multiply research evidence',()=>{
 const a=row({knownAt:pub+1000}),b=row({url:'HTTPS://STATIC.CNINFO.COM.CN/finalpage/2026-11-06/101.pdf',knownAt:pub+2000});
 const out=run([a,b,a]);assert.equal(out.count,1);assert.equal(out.duplicateCount,2);
 assert.equal(out.strengthClues.length,1);assert.equal(out.documentConflicts.length,0);
 assert.deepEqual(run([b,a,a]),out);
});
test('visible withdrawals suppress favorable clues; future withdrawal cannot rewrite earlier observation',()=>{
 for(const patch of [{retracted:true},{withdrawn:true},{kind:'retracted'},{status:'superseded'}]){
  const out=run([row(),row({...patch,receivedAt:now})]);
  assert.equal(out.count,0);assert.equal(out.withdrawnDocuments.length,1);
  assert.equal(out.strengthClues.length,0);
 }
 const future=row({retracted:true,retractedAt:now+1000,receivedAt:now+1000});
 assert.equal(run([row(),future]).strengthClues.length,1);
 assert.equal(run([row(),future],now+2000).strengthClues.length,0);
});
test('negation clarification and rumor headlines are not positive or negative conclusions',()=>{
 for(const title of ['关于回购股份传闻的澄清公告','尚未中标的说明','不存在重大诉讼的公告',
  '未收到立案调查通知书','无回购股份计划','关于取消回购股份的公告','关于终止回购股份的公告']){
  assert.equal(classifyTitle(title),'conflicting');
  const out=run([row({title})]);assert.equal(out.strengthClues.length,0);assert.equal(out.conflicts.length,1);
 }
 assert.equal(classifyTitle('收到立案调查通知书'),'risk-clue');
 assert.equal(classifyTitle('关于股份回购计划的公告'),'strength-clue');
 assert.equal(classifyTitle('召开股东大会的通知'),'neutral-review');
});
test('explicit artificial evidence and inconsistent issuer identities are excluded',()=>{
 for(const patch of [{simulated:true},{synthetic:true},{testSample:true},{sampleSet:'demo'},{mode:'simulation'},
  {code:'000001',codes:[symbol]},{symbol:'000001'},{codes:[symbol,symbol]},{codes:[symbol,123]}]){
  assert.equal(run([row(patch)]).count,0);
 }
 const multiple=run([row({codes:[symbol,'600002']})]);
 assert.equal(multiple.count,1);assert.equal(multiple.events[0].verified,false);
});
test('official-looking impossible document date and invalid analysis clock are rejected',()=>{
 assert.equal(run([row({url:'https://static.cninfo.com.cn/finalpage/2026-02-30/101.pdf'})]).count,0);
 assert.equal(run([row()],now+.5).status,'invalid-input');
 assert.equal(run([row()],Number.MAX_SAFE_INTEGER).status,'invalid-input');
});
test('disputed title remains a risk-review clue and simulated or stale quality cannot enter strength pool',()=>{
 const e=run([row(),row({title:'收到立案调查通知书'})]);
 const l=buildIssuerLinkage({issuerEvidence:e,patterns:{positiveCount:1}});
 assert.equal(l.riskConflict,true);assert.equal(l.strengthConfluence,false);assert.equal(l.bonusPoints,0);
 assert.equal(buildIssuerPools([{symbol,issuerEvidence:e,issuerLinkage:l,quality:{usable:true}}])['公告矛盾待核对池'].length,1);
 const clean=run([row()]);
 for(const quality of [{usable:true,fresh:false},{usable:true,simulated:true}]){
  assert.equal(buildIssuerPools([{symbol,issuerEvidence:clean,quality}])['公告优势线索池'].length,0);
 }
 assert.equal(buildIssuerPools([{symbol,issuerEvidence:clean,quality:{usable:true,fresh:true}}])['公告优势线索池'].length,1);
});

test('a simulated source or an official PDF path from a future day cannot support news clues',()=>{
 for(const patch of [{source:'synthetic-fixture'},{provider:'mock-feed'},{provenance:'replay/test'},{dataMode:'fixture-only'},
  {url:'https://static.cninfo.com.cn/finalpage/2026-11-08/101.pdf'}]){
  const out=run([row(patch)]);assert.equal(out.count,0);assert.equal(out.unusableCount,1);
 }
 assert.equal(run([row()]).strengthClues.length,1);
});
test('news linkage and pools cannot reuse another security or historical-only data as current strength',()=>{
 const e=run([row()]),good={symbol,issuerEvidence:e,patterns:{positiveCount:1},quality:{usable:true,fresh:true}};
 assert.equal(buildIssuerLinkage(good).strengthConfluence,true);
 assert.equal(buildIssuerPools([good])['公告优势线索池'].length,1);
 for(const bad of [{...good,symbol:'600002'},{...good,code:'600002'},
   {...good,issuerEvidence:{...e,strengthClues:[{...e.strengthClues[0],code:'600002'}]}}]){
  assert.equal(buildIssuerLinkage(bad).strengthConfluence,false);
  assert.equal(buildIssuerPools([bad])['公告优势线索池'].length,0);
 }
 for(const quality of [{...good.quality,historical:true},{...good.quality,readOnlyBackup:true}])
  assert.equal(buildIssuerPools([{...good,quality}])['公告优势线索池'].length,0);
});
