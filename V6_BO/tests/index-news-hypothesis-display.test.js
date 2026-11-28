'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {investigateCurrentNews}=require('../src/core/index-news-association');
const t=Date.parse('2026-11-05T10:00:00+08:00'),event={baseAt:t,quoteAt:t+60000,detectedAt:t+65000};
function result(){
 const news={goodAll:[],badAll:[],neutralAll:[]},entries=new Map();
 ['央行降准','业绩澄清：未签订合同','央行降准'].forEach((title,i)=>{
  const id='ref'+i,eventHash=String(i+1).repeat(64),evidence={source:'eastmoney-fast-news',eventId:id,sourceRevisionId:'v1',kind:'original',publishedAt:t+1000,receivedAt:t+2000,revisedAt:null,securities:[],title,body:'原文',bodyScope:'provider-summary'};
  const entry={eventHash,sequence:i+1,recordedAt:t+3000,evidence};entries.set(id,entry);news.neutralAll.push({source:evidence.source,type:'neutral',id,codes:[],publishedAt:evidence.publishedAt,receivedAt:t+4000,newsEvidence:{eventHash,sequence:entry.sequence,recordedAt:entry.recordedAt,sourceRevisionId:'v1'}});
 });
 const run=allowedHashes=>investigateCurrentNews(event,news,{allowedHashes,resolveCurrent:row=>({entry:entries.get(row.id)})});return {run,entries};
}
test('original shared market display reports de-duplicated text clues, not a verified cause',async()=>{
 const {indexHypothesisDisclosure}=await import('../public/nova/index-continuity-view.mjs');const s=indexHypothesisDisclosure(result().run());
 assert.match(s,/同窗文本线索 2 组/);assert.match(s,/原档案引用 3 条/);assert.match(s,/货币\/财政/);assert.match(s,/公司业绩/);assert.match(s,/待核反证线索 1 组/);assert.match(s,/供应商摘要/);assert.match(s,/原因与影响敞口未知/);assert.match(s,/非消息因素仍待核/);
});
test('read-time removal of evidence is reflected in the same disclosure and no cached hypothesis is reused',async()=>{
 const {indexHypothesisDisclosure}=await import('../public/nova/index-continuity-view.mjs');const f=result(),v=f.run();f.entries.delete('ref1');const s=indexHypothesisDisclosure(f.run(v.evidenceHashes));
 assert.match(s,/同窗文本线索 1 组/);assert.match(s,/原档案引用 2 条/);assert.doesNotMatch(s,/公司业绩/);assert.doesNotMatch(s,/待核反证线索 1 组/);
});
test('unknown or malformed contexts and altered permissions fail closed',async()=>{
 const {indexHypothesisDisclosure}=await import('../public/nova/index-continuity-view.mjs');assert.equal(indexHypothesisDisclosure(null),'');assert.equal(indexHypothesisDisclosure({}), '');
 for(const change of [v=>v.canTrade=true,v=>v.canNotify=true,v=>v.hypothesisContext.cause='policy',v=>v.hypothesisContext.confirmedCounterEvidenceCount=1,v=>v.hypothesisContext.referenceCount=50,v=>v.hypothesisContext.textGroups[0].evidenceHashes.push(v.evidenceHashes[0]),v=>v.hypothesisContext.textGroups[0].topicHints.push('bad'),v=>v.hypothesisContext.textGroups[0].textHash=null,v=>v.hypothesisContext.textGroups[0].textScope='unknown',v=>v.hypothesisContext.textGroups[0]=null]){const v=result().run();change(v);assert.equal(indexHypothesisDisclosure(v),'');}
});
