'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIndexNewsInvestigator,investigateCurrentNews}=require('../src/core/index-news-association');
const T=Date.parse('2026-11-05T10:00:00+08:00');
const event={baseAt:T,quoteAt:T+60000,detectedAt:T+65000};
function fixture(){
 const news={goodAll:[],badAll:[],neutralAll:[]},latest=new Map();let seq=0;
 const add=(title,body='原文',type='neutral',patch={})=>{
  const i=++seq,id='event-'+i,hash=i.toString(16).padStart(64,'0');
  const e={source:'eastmoney-fast-news',eventId:id,sourceRevisionId:'v1',kind:'original',publishedAt:T+1000,receivedAt:T+2000,revisedAt:null,securities:['600000'],title,body,bodyScope:'declared-body',...patch};
  const entry={evidence:e,eventHash:hash,sequence:i,recordedAt:T+3000};latest.set(id,entry);
  const row={id,source:e.source,type,codes:[...e.securities],publishedAt:e.publishedAt,receivedAt:T+4000,newsEvidence:{eventHash:hash,sourceRevisionId:'v1',sequence:i,recordedAt:entry.recordedAt}};news[type+'All'].push(row);return {entry,row};
 };
 const run=(ev=event,allowedHashes)=>investigateCurrentNews(ev,news,{allowedHashes,resolveCurrent:row=>({entry:latest.get(row.id),explicitSectors:[]})});
 const adapter=createIndexNewsInvestigator({readNews:()=>news,allowsItem:row=>latest.has(row.id),currentState:()=>({unknown:false,latest}),readSectors:()=>[],explicitSectorMatch:()=>false});
 return {news,latest,add,run,adapter};
}
const context=v=>{assert.equal(v.attribution,'unknown');assert.equal(v.canTrade,false);assert.equal(v.canNotify,false);const c=v.hypothesisContext;assert.equal(c.cause,'unknown');assert.equal(c.independentSourcesVerified,false);assert.equal(c.marketOnlyAlternativeRetained,true);return c;};
test('simultaneous policy, earnings and overseas headlines remain separate alternative clues',()=>{
 const f=fixture();f.add('央行降准公告','政策原文','good');f.add('上市公司业绩预亏','公告正文','bad');f.add('美联储利率决议','海外消息');
 const v=f.adapter(event),c=context(v);assert.equal(c.textGroups.length,3);assert.equal(c.referenceCount,3);assert.equal(c.distinctTextGroups,3);assert.equal(c.status,'multiple-text-clues');
 assert.ok(c.textGroups.some(g=>g.topicHints.includes('monetary-fiscal')));assert.ok(c.textGroups.some(g=>g.topicHints.includes('issuer-earnings')));assert.ok(c.textGroups.some(g=>g.topicHints.includes('overseas')));
 assert.equal(c.exposureStatus,'unknown');assert.equal(c.confirmedCounterEvidenceCount,null);
});
test('archive content, not cache title or price direction, determines explicit counter-text clues',()=>{
 const f=fixture(),a=f.add('公司澄清：未签订重大合同','澄清公告','good');a.row.title='伪造利好';
 const b=f.add('公司签订重大合同','公告正文','bad');b.row.title='否认';
 const c=context(f.run({...event,returnPct:-4}));const negative=c.textGroups.find(g=>g.evidenceHashes.includes(a.entry.eventHash));const positive=c.textGroups.find(g=>g.evidenceHashes.includes(b.entry.eventHash));
 assert.deepEqual(negative.counterTextHints,['clarification','negation']);assert.deepEqual(positive.counterTextHints,[]);assert.equal(c.counterTextGroupCount,1);assert.equal(c.confirmedCounterEvidenceCount,null);
 assert.deepEqual(context(f.run({...event,returnPct:4})),c);
});
test('duplicate exact archived texts count as one text group but preserve all original hashes',()=>{
 const f=fixture(),a=f.add('产业政策','原文','good'),b=f.add('产业政策','原文','bad');f.news.goodAll.push(a.row);
 const v=f.run(),c=context(v);assert.equal(v.evidenceHashes.length,2);assert.equal(c.referenceCount,2);assert.equal(c.distinctTextGroups,1);assert.equal(c.textGroups[0].evidenceHashes.length,2);assert.deepEqual(c.textGroups[0].evidenceHashes,[a.entry.eventHash,b.entry.eventHash]);assert.equal(c.textGroups[0].textScope,'declared-body');assert.ok(c.textGroups[0].topicHints.includes('industrial-policy'));
});
test('summary and missing body are separate uncertain text scopes, not independent sources',()=>{
 const f=fixture();f.add('公司澄清','相同文字','good');f.add('公司澄清','相同文字','neutral',{bodyScope:'provider-summary'});f.add('国家政策',undefined,'bad',{body:''});
 const c=context(f.run());assert.equal(c.distinctTextGroups,2);assert.equal(c.unknownReferenceGroups,1);assert.deepEqual(new Set(c.textGroups.map(g=>g.textScope)),new Set(['declared-body','provider-summary','unknown']));assert.equal(c.independentSourcesVerified,false);
});
test('allowlist, revocation, late discovery and resolver failure cannot contribute replacement hypotheses',()=>{
 const f=fixture(),a=f.add('财政政策'),b=f.add('美联储决议');const first=f.adapter(event);assert.equal(context(first).referenceCount,2);
 f.latest.delete(a.row.id);const late=f.add('业绩公告');late.entry.recordedAt=event.detectedAt+1;late.row.newsEvidence.recordedAt=late.entry.recordedAt;
 const reviewed=f.adapter(event,first.evidenceHashes);assert.deepEqual(reviewed.evidenceHashes,[b.entry.eventHash]);assert.equal(context(reviewed).referenceCount,1);
 const failed=investigateCurrentNews(event,f.news,{resolveCurrent:()=>{throw Error('archive missing');}});assert.deepEqual(failed.evidenceHashes,[]);assert.equal(context(failed).status,'unavailable');assert.deepEqual(failed.hypothesisContext.textGroups,[]);
});
test('unknown original content and empty cache preserve market-only alternative without invented category',()=>{
 const f=fixture();assert.equal(context(f.run()).status,'unavailable');const x=f.add('不明确',undefined,'neutral',{title:null,body:null});const c=context(f.run());assert.equal(c.status,'no-qualified-text-clues');assert.equal(c.distinctTextGroups,0);assert.equal(c.unknownReferenceGroups,1);assert.deepEqual(c.textGroups[0].topicHints,[]);assert.deepEqual(c.textGroups[0].counterTextHints,[]);assert.equal(c.textGroups[0].textScope,'unknown');assert.equal(c.textGroups[0].textHash,null);
});
