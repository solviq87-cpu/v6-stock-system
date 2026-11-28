'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const J=require('../src/core/news-evidence-journal');
const T=Date.parse('2026-11-10T08:00:00Z');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'news-coverage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'private');
 const base={schemaVersion:1,source:'fixture-a',eventId:'e1',sourceRevisionId:'r1',kind:'original',supersedes:null,url:'https://example.test/a',title:'Synthetic policy',body:'Exact policy text',securities:['600000'],publishedAt:T-1000,receivedAt:T,revisedAt:null};
 const put=(patch={},now=T)=>J.appendBatch(root,[{...base,...patch}],{now}).results[0];
 const copy=(patch={},now=T+1)=>put({source:'fixture-b',url:'https://example.test/b',receivedAt:now,...patch},now);
 const query=(asOf=T+10,opts={})=>J.queryAt(root,{asOf,now:T+10,...opts});
 return {root,base,put,copy,query};
}
const coverage=(q,rows,groups,duplicates)=>assert.deepEqual(q.contentCoverage,{eligibleStatements:rows,distinctExactTexts:groups,duplicateStatements:duplicates,independentSourcesVerified:false});
test('exact title and body on different source IDs count as one text, not independent corroboration',t=>{
 const f=fixture(t);f.put();f.copy();const q=f.query();coverage(q,2,1,1);
 assert.equal(q.summary.eligibleForResearchSupport,2,'legacy statement count remains intact');
 assert.equal(q.rows[0].contentGroup.id,q.rows[1].contentGroup.id);assert.equal(q.rows[0].contentGroup.statementCount,2);
 assert.equal(q.rows[0].contentGroup.independentSourcesVerified,false);assert.equal(q.canNotify,false);assert.equal(q.canTrade,false);
});
test('same title with different body is not deduped',t=>{
 const f=fixture(t);f.put();f.copy({body:'Different evidence'});const q=f.query();coverage(q,2,2,0);assert.notEqual(q.rows[0].contentGroup.id,q.rows[1].contentGroup.id);
});
test('provider summary, missing source time and missing links do not count as complete text',t=>{
 const f=fixture(t);f.put();f.copy({bodyScope:'provider-summary'});f.put({eventId:'unknown-clock',publishedAt:null,receivedAt:T+2},T+2);f.put({eventId:'unknown-link',url:null,receivedAt:T+3},T+3);const q=f.query();coverage(q,1,1,0);assert.equal(q.rows.filter(r=>r.contentGroup!==null).length,1);
});
test('historical replay never incorporates a later copy; full coverage precedes pagination',t=>{
 const f=fixture(t);f.put();f.copy();const old=f.query(T),latest=f.query(T+1,{limit:1});coverage(old,1,1,0);coverage(latest,2,1,1);
 assert.equal(old.rows[0].contentGroup.statementCount,1);assert.equal(latest.rows[0].contentGroup.statementCount,2);assert.equal(latest.rows.length,1);
 assert.equal(old.rows[0].contentGroup.id,latest.rows[0].contentGroup.id);
});
test('withdrawal removes only that active statement; copies are not certified or erased',t=>{
 const f=fixture(t);const a=f.put();f.copy();f.put({kind:'retracted',supersedes:a.eventHash,sourceRevisionId:'r2',body:'Withdrawn',receivedAt:T+2,revisedAt:T+2},T+2);
 coverage(f.query(T+1),2,1,1);const q=f.query(T+2);coverage(q,1,1,0);assert.equal(q.rows[0].contentGroup,null);assert.equal(q.rows[0].supportStatus,'retracted');assert.equal(q.rows[1].contentGroup.independentSourcesVerified,false);
});
test('symbol filter cannot count unrelated statements and CLI current read exposes same coverage',t=>{
 const f=fixture(t);f.put();f.copy({securities:['000001']});coverage(f.query(T+1,{symbol:'600000'}),1,1,0);coverage(f.query(T+1),2,1,1);
 const r=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/news-evidence.js'),'list','600000'],{encoding:'utf8',env:{...process.env,V6_NEWS_EVIDENCE_DIR:f.root}});assert.equal(r.status,0,r.stderr);coverage(JSON.parse(r.stdout),1,1,0);
});
