'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const J=require('../src/core/news-evidence-journal');
const T=Date.parse('2026-11-10T08:00:00Z');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'news-association-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'private');
 const base={schemaVersion:1,source:'fixture-source',eventId:'event-1',sourceRevisionId:'first',kind:'original',supersedes:null,url:'https://example.test/original',title:'Synthetic policy evidence',body:'Original',securities:['600000'],publishedAt:T-1000,receivedAt:T,revisedAt:null};
 const append=(input,now=T)=>J.appendBatch(root,[input],{now}).results[0];
 const revise=(previous,id,now,securities,kind='revised')=>append({...base,kind,sourceRevisionId:id,supersedes:previous.eventHash,securities,body:id,receivedAt:now,revisedAt:now},now);
 const cli=(symbol)=>{
  const r=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/news-evidence.js'),'list',symbol],{encoding:'utf8',env:{...process.env,V6_NEWS_EVIDENCE_DIR:root}});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
 };
 return {root,base,append,revise,cli};
}
const blocked=row=>{assert.equal(row.eligibleForResearchSupport,false);assert.equal(row.usableAsResearchSupport,false);assert.equal(row.canTrade,false);assert.equal(row.canTrain,false);assert.equal(row.canNotify,false);};
test('current security lookup keeps the newest revision when its association is removed',t=>{
 const f=fixture(t),a=f.append(f.base),b=f.revise(a,'removed',T+1,[]);
 const q=J.query(f.root,{symbol:'600000',now:T+1});
 assert.equal(q.total,2);assert.equal(q.summary.currentEvents,1);assert.equal(q.rows[0].eventHash,b.eventHash);
 assert.equal(q.rows[0].supportStatus,'security-removed');assert.equal(q.rows[0].associated,false);q.rows.forEach(blocked);
});
test('existing CLI list includes terminal withdrawal without security codes',t=>{
 const f=fixture(t),a=f.append(f.base),b=f.revise(a,'withdrawn',T+1,[],'retracted');
 const q=f.cli('600000');assert.equal(q.total,2);assert.equal(q.rows[0].eventHash,b.eventHash);
 assert.equal(q.summary.retractedEvents,1);assert.equal(q.rows[0].supportStatus,'retracted');assert.equal(q.rows[0].associated,false);q.rows.forEach(blocked);
});
test('historical cutoff retains original association until the actual revision is recorded',t=>{
 const f=fixture(t),a=f.append(f.base),b=f.revise(a,'removed',T+1,[]);
 const before=J.queryAt(f.root,{symbol:'600000',asOf:T,now:T+1});
 assert.equal(before.total,1);assert.equal(before.rows[0].eventHash,a.eventHash);assert.equal(before.rows[0].associated,true);assert.equal(before.rows[0].eligibleForResearchSupport,true);
 const after=J.queryAt(f.root,{symbol:'600000',asOf:T+1,now:T+1});assert.equal(after.rows[0].eventHash,b.eventHash);after.rows.forEach(blocked);
});
test('later re-association restores only the newly current research row',t=>{
 const f=fixture(t),a=f.append(f.base),b=f.revise(a,'removed',T+1,[]),c=f.revise(b,'restored',T+2,['600000']);
 const q=J.query(f.root,{symbol:'600000',now:T+2});assert.equal(q.total,3);assert.equal(q.rows[0].eventHash,c.eventHash);assert.equal(q.rows[0].associated,true);assert.equal(q.summary.eligibleForResearchSupport,1);q.rows.slice(1).forEach(blocked);
});
test('same event ID from an unrelated source does not join a security history',t=>{
 const f=fixture(t),a=f.append(f.base);f.revise(a,'removed',T+1,[]);f.append({...f.base,source:'other-source',securities:['000001'],receivedAt:T+2},T+2);
 const q=J.query(f.root,{symbol:'600000',now:T+2});assert.equal(q.total,2);assert.ok(q.rows.every(row=>row.evidence.source==='fixture-source'));
});
test('current and point-in-time views share full summary before limiting results',t=>{
 const f=fixture(t),a=f.append(f.base);f.revise(a,'withdrawn',T+1,[],'retracted');
 const q=J.query(f.root,{symbol:'600000',limit:1,now:T+1}),h=J.queryAt(f.root,{symbol:'600000',limit:1,asOf:T+1,now:T+1});
 assert.equal(q.total,2);assert.equal(q.rows.length,1);assert.deepEqual(q.rows,h.rows);assert.deepEqual(q.summary,h.summary);assert.equal(h.summary.retractedEvents,1);assert.equal(h.nextOffset,1);
 assert.equal(Object.hasOwn(q,'offset'),false);assert.equal(Object.hasOwn(q,'asOf'),false);assert.equal(q.headHash,h.headHash);
});
test('unfiltered queries and unrelated symbols preserve original flags and empty results',t=>{
 const f=fixture(t),a=f.append(f.base);f.revise(a,'withdrawn',T+1,['600000'],'retracted');
 const q=J.query(f.root,{now:T+1});assert.equal(q.summary.retractedEvents,1);q.rows.forEach(blocked);
 assert.equal(J.query(f.root,{symbol:'000001',now:T+1}).total,0);
 assert.throws(()=>J.query(f.root,{symbol:600000,now:T+1}),/INVALID_NEWS_QUERY/);
});
test('query refactoring still validates a corrupted later journal record at any cutoff',t=>{
 const f=fixture(t),a=f.append(f.base);f.revise(a,'removed',T+1,[]);
 const file=path.join(f.root,'000002.json');fs.writeFileSync(file,'{}');
 assert.throws(()=>J.query(f.root,{symbol:'600000',now:T+1}));
 assert.throws(()=>J.queryAt(f.root,{symbol:'600000',asOf:T,now:T+1}));
});
