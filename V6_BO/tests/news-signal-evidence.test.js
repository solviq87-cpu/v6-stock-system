'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const Journal=require('../src/core/news-evidence-journal');
const {createReader,LIMITS}=require('../src/core/news-signal-evidence');
const NOW=Date.parse('2026-11-12T02:00:00Z');
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'signal-news-reference-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'private');}
const source=(extra={})=>({schemaVersion:1,source:'operator-fixture',eventId:'event-1',sourceRevisionId:'edition-1',kind:'original',supersedes:null,
 url:'https://example.test/original',title:'来源声明正文',body:'原始内容',bodyScope:'declared-body',securities:['600000'],publishedAt:NOW-60000,receivedAt:NOW-1000,revisedAt:null,...extra});
const put=(dir,input,recordedAt=NOW)=>Journal.appendBatch(dir,[input],{now:recordedAt}).results[0];
const capture=(reader,dir,triggerAt=NOW,now=NOW+10000)=>reader(dir,{code:'600000',triggerAt,now});

test('original, revision and retraction retain exact versions and only the visible current version can support',t=>{
 const dir=root(t),reader=createReader(),one=put(dir,source());
 const two=put(dir,source({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,body:'修订内容',receivedAt:NOW+1000,revisedAt:NOW+500}),NOW+1000);
 const three=put(dir,source({kind:'retracted',sourceRevisionId:'edition-3',supersedes:two.eventHash,body:'已撤稿',receivedAt:NOW+2000,revisedAt:NOW+1500}),NOW+2000);
 const first=capture(reader,dir,NOW),second=capture(reader,dir,NOW+1000),last=capture(reader,dir,NOW+2000);
 assert.deepEqual(first.originalEvidence.map(x=>x.eventHash),[one.eventHash]);
 assert.equal(first.binding.asOfHeadHash,one.eventHash);assert.equal(first.binding.asOfSequence,1);
 assert.deepEqual(second.originalEvidence.map(x=>x.eventHash),[two.eventHash]);
 assert.equal(second.binding.versions[0].current,false);assert.equal(second.binding.versions[0].eligibleForResearchSupport,false);
 assert.ok(second.binding.versions[0].issues.includes('SUPERSEDED'));
 assert.equal(last.originalEvidence,null);assert.equal(last.binding.status,'partial');assert.ok(last.binding.reasons.includes('RETRACTED'));
 assert.equal(last.binding.versions.at(-1).eventHash,three.eventHash);assert.ok(last.binding.versions.every(x=>!x.eligibleForResearchSupport));
 const ref=second.originalEvidence[0],stored=Journal.readJournal(dir,{now:NOW+2000})[1];
 assert.equal(ref.bodyHash,stored.evidence.bodyHash);assert.equal(ref.supersedes,one.eventHash);assert.equal(ref.previousHash,one.eventHash);
 assert.equal(ref.publishedAt,NOW-60000);assert.equal(ref.receivedAt,NOW+1000);assert.equal(ref.revisedAt,NOW+500);assert.equal(ref.recordedAt,NOW+1000);
 assert.equal(ref.url,'https://example.test/original');assert.equal(ref.source,'operator-fixture');assert.equal(ref.sourceRevisionId,'edition-2');
 assert.equal(ref.bodyIncluded,false);assert.equal(Object.hasOwn(ref,'body'),false);assert.equal(ref.canTrade,false);assert.equal(ref.canTrain,false);assert.equal(ref.canNotify,false);
 assert.equal(second.binding.association,'same-security-context');assert.ok(Object.isFrozen(second.binding.versions[0]));
 assert.throws(()=>{second.binding.versions[0].securities.push('000001');},TypeError);
});

test('old source publication and receipt cannot make a late local import or revision known earlier',t=>{
 const dir=root(t),reader=createReader();
 const one=put(dir,source(),NOW);
 const late=put(dir,source({eventId:'late-import',receivedAt:NOW-500}),NOW+1000);
 const revised=put(dir,source({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,body:'晚导入修订',receivedAt:NOW,revisedAt:NOW-100}),NOW+2000);
 const early=capture(reader,dir,NOW,NOW+3000);
 assert.deepEqual(early.binding.versions.map(x=>x.eventHash),[one.eventHash]);
 assert.equal(early.binding.asOfHeadHash,one.eventHash);assert.equal(early.binding.asOfSequence,1);
 assert.ok(early.binding.versions.every(x=>x.recordedAt<=NOW));
 const later=capture(reader,dir,NOW+2000,NOW+3000);
 assert.deepEqual(new Set(later.originalEvidence.map(x=>x.eventHash)),new Set([late.eventHash,revised.eventHash]));
 const beforeAll=capture(reader,dir,NOW-1,NOW+3000);
 assert.equal(beforeAll.originalEvidence,null);assert.equal(beforeAll.binding.asOfHeadHash,null);assert.equal(beforeAll.binding.asOfSequence,0);
 assert.deepEqual(beforeAll.binding.versions,[]);assert.ok(beforeAll.binding.reasons.includes('NO_NEWS_VERSION_KNOWN_AT_TRIGGER'));
});

test('a newer cache queried for a past trigger cannot lend future versions or a future journal head',t=>{
 const dir=root(t),reader=createReader(),one=put(dir,source());
 const two=put(dir,source({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,body:'后来内容',receivedAt:NOW+1000,revisedAt:NOW+500}),NOW+1000);
 assert.equal(capture(reader,dir,NOW+1000).originalEvidence[0].eventHash,two.eventHash);
 const past=capture(reader,dir,NOW);
 assert.equal(past.originalEvidence[0].eventHash,one.eventHash);assert.equal(past.binding.versions.length,1);
 assert.equal(past.binding.asOfHeadHash,one.eventHash);assert.equal(past.binding.asOfSequence,1);
 assert.equal(JSON.stringify(past).includes(two.eventHash),false);
});

test('future security associations do not consume the past trigger candidate capacity',t=>{
 const dir=root(t),reader=createReader(),one=put(dir,source());
 const future=Array.from({length:LIMITS.candidates+1},(_,i)=>source({eventId:'future-'+i,receivedAt:NOW+1000}));
 for(let i=0;i<future.length;i+=200)Journal.appendBatch(dir,future.slice(i,i+200),{now:NOW+1000});
 const past=capture(reader,dir,NOW);
 assert.equal(past.binding.status,'recorded');assert.equal(past.binding.versions.length,1);
 assert.equal(past.originalEvidence[0].eventHash,one.eventHash);assert.equal(past.binding.asOfSequence,1);
 assert.equal(capture(reader,dir,NOW+1000).originalEvidence,null);
});

test('a visible revision removing the security supersedes the old association rather than reviving it',t=>{
 const dir=root(t),reader=createReader(),one=put(dir,source());
 const two=put(dir,source({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,securities:['000001'],receivedAt:NOW+1000,revisedAt:NOW+500}),NOW+1000);
 const result=capture(reader,dir,NOW+1000);
 assert.equal(result.originalEvidence,null);assert.equal(result.binding.status,'partial');assert.ok(result.binding.reasons.includes('SECURITY_REMOVED'));
 assert.equal(result.binding.versions[0].eligibleForResearchSupport,false);assert.equal(result.binding.versions[0].current,false);
 assert.equal(result.binding.versions[1].eventHash,two.eventHash);assert.equal(result.binding.versions[1].current,true);
 assert.ok(result.binding.versions[1].issues.includes('SECURITY_REMOVED'));
});

test('unknown source clocks, missing links and provider summaries remain partial with original nulls intact',t=>{
 for(const change of [{publishedAt:null},{url:null},{body:''},{bodyScope:'provider-summary'}]){
  const dir=root(t),reader=createReader();put(dir,source(change));const result=capture(reader,dir);
  assert.equal(result.originalEvidence,null);assert.equal(result.binding.status,'partial');assert.equal(result.binding.versions[0].eligibleForResearchSupport,false);
  assert.equal(result.binding.versions[0].publishedAt,change.publishedAt===null?null:NOW-60000);
  assert.equal(result.binding.versions[0].revisedAt,null);assert.equal(result.binding.versions[0].bodyScope,change.bodyScope||'declared-body');
  if(change.bodyScope)assert.ok(result.binding.reasons.includes('SUMMARY_ONLY'));
 }
 const dir=root(t),reader=createReader(),one=put(dir,source());
 put(dir,source({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,receivedAt:NOW+1000,revisedAt:null}),NOW+1000);
 const unknown=capture(reader,dir,NOW+1000);
 assert.equal(unknown.originalEvidence,null);assert.equal(unknown.binding.versions.at(-1).revisedAt,null);
 assert.ok(unknown.binding.reasons.includes('UNKNOWN_OR_INVALID_REVISION_TIME'));
 assert.equal(unknown.binding.versions[0].eligibleForResearchSupport,false);
});

test('selected file in-place damage is detected even within the cache metadata window and unchanged directory mtime',t=>{
 const dir=root(t),reader=createReader();put(dir,source());assert.equal(capture(reader,dir,NOW,NOW).binding.status,'recorded');
 const file=path.join(dir,'000001.json'),before=fs.statSync(dir).mtimeMs,record=JSON.parse(fs.readFileSync(file,'utf8'));
 record.evidence.body='内容被原地破坏';fs.writeFileSync(file,JSON.stringify(record));
 assert.equal(fs.statSync(dir).mtimeMs,before,'overwriting an existing file leaves directory mtime unchanged');
 const broken=capture(reader,dir,NOW,NOW+1);assert.equal(broken.originalEvidence,null);assert.equal(broken.binding.status,'partial');
 assert.ok(broken.binding.reasons.includes('NEWS_JOURNAL_UNAVAILABLE_OR_INVALID'));
});

test('active writer, exposed mode, symlink and chain gaps fail closed after a previously valid read',t=>{
 for(const mutation of ['lock','mode','symlink','gap']){
  const dir=root(t),reader=createReader();put(dir,source());assert.equal(capture(reader,dir).binding.status,'recorded');
  const file=path.join(dir,'000001.json');
  if(mutation==='lock')fs.writeFileSync(path.join(dir,'.lock'),'fixture',{mode:0o600});
  if(mutation==='mode')fs.chmodSync(file,0o644);
  if(mutation==='symlink'){const target=path.join(path.dirname(dir),'external.json');fs.renameSync(file,target);fs.symlinkSync(target,file);}
  if(mutation==='gap')fs.renameSync(file,path.join(dir,'000002.json'));
  const result=capture(reader,dir);assert.equal(result.originalEvidence,null,mutation);assert.equal(result.binding.status,'partial',mutation);
 }
});

test('unrelated in-place damage invalidates the verified chain at the bounded metadata sweep',t=>{
 const dir=root(t),reader=createReader();put(dir,source());put(dir,source({eventId:'unrelated',securities:['000001']}));
 put(dir,source({eventId:'head',securities:['600000']}));assert.equal(capture(reader,dir,NOW,NOW).binding.status,'recorded');
 const file=path.join(dir,'000002.json'),row=JSON.parse(fs.readFileSync(file,'utf8'));row.evidence.body='破坏其他事件';fs.writeFileSync(file,JSON.stringify(row));
 const result=capture(reader,dir,NOW,NOW+LIMITS.metadataCheckMs);
 assert.equal(result.originalEvidence,null);assert.equal(result.binding.status,'partial');
});

test('missing private root and invalid identities do not create files or substitute trigger clocks',t=>{
 const dir=root(t),reader=createReader(),missing=capture(reader,dir);
 assert.equal(missing.originalEvidence,null);assert.equal(missing.binding.status,'partial');assert.equal(fs.existsSync(dir),false);
 for(const input of [{code:'../600000',triggerAt:NOW,now:NOW},{code:'600000',triggerAt:NOW+1,now:NOW},{code:'600000',triggerAt:null,now:NOW}]){
  const result=reader(dir,input);assert.equal(result.originalEvidence,null);assert.ok(result.binding.reasons.includes('INVALID_NEWS_BINDING_IDENTITY_OR_CLOCK'));
 }
 assert.equal(fs.existsSync(dir),false);
});

test('repeated reads reuse full journal verification until an actual append',t=>{
 const dir=root(t),reader=createReader(),one=put(dir,source()),originalRead=Journal.readJournal;let reads=0;
 Journal.readJournal=(...args)=>{reads++;return originalRead(...args);};
 try{
  assert.equal(capture(reader,dir,NOW,NOW).binding.status,'recorded');
  assert.equal(capture(reader,dir,NOW,NOW+1).binding.status,'recorded');
  assert.equal(capture(reader,dir,NOW,NOW+LIMITS.metadataCheckMs).binding.status,'recorded');
  assert.equal(reads,1,'unchanged repeated signals must not reread all journal contents');
  put(dir,source({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,receivedAt:NOW+2000,revisedAt:NOW+1500}),NOW+2000);
  const beforeBinding=reads;assert.equal(capture(reader,dir,NOW+2000,NOW+2000).binding.status,'recorded');assert.equal(reads,beforeBinding+1);
 }finally{Journal.readJournal=originalRead;}
});

test('version, candidate, output and archive capacities return partial without truncated positive evidence',t=>{
 {
  const dir=root(t);let previous=put(dir,source());
  for(let i=1;i<=LIMITS.versions;i++)previous=put(dir,source({kind:'revised',sourceRevisionId:'edition-'+(i+1),supersedes:previous.eventHash,receivedAt:NOW+i,revisedAt:NOW+i}),NOW+i);
  const result=capture(createReader(),dir,NOW+LIMITS.versions);
  assert.equal(result.originalEvidence,null);assert.deepEqual(result.binding.reasons,['NEWS_BINDING_VERSION_LIMIT']);assert.deepEqual(result.binding.versions,[]);
 }
 {
  const dir=root(t),inputs=Array.from({length:LIMITS.candidates+1},(_,i)=>source({eventId:'event-'+i}));
  for(let i=0;i<inputs.length;i+=200)Journal.appendBatch(dir,inputs.slice(i,i+200),{now:NOW});
  const result=capture(createReader(),dir);assert.equal(result.originalEvidence,null);assert.deepEqual(result.binding.reasons,['NEWS_BINDING_CANDIDATE_LIMIT']);
 }
 {
  const dir=root(t),inputs=Array.from({length:LIMITS.versions},(_,i)=>source({eventId:'long-'+i,title:'文'.repeat(1000),url:'https://example.test/'+('a'.repeat(1900))}));
  Journal.appendBatch(dir,inputs,{now:NOW});const result=capture(createReader(),dir);
  assert.equal(result.originalEvidence,null);assert.deepEqual(result.binding.reasons,['NEWS_BINDING_OUTPUT_LIMIT']);assert.ok(Buffer.byteLength(JSON.stringify(result))<LIMITS.outputBytes);
 }
 {
  const dir=root(t);fs.mkdirSync(dir,{mode:0o700});
  for(let i=1;i<=LIMITS.events+1;i++)fs.closeSync(fs.openSync(path.join(dir,String(i).padStart(6,'0')+'.json'),'wx',0o600));
  const result=capture(createReader(),dir);assert.equal(result.originalEvidence,null);assert.deepEqual(result.binding.reasons,['NEWS_JOURNAL_UNAVAILABLE_OR_INVALID']);
  assert.equal(fs.readdirSync(dir).length,LIMITS.events+1,'read-only capacity rejection retains existing files');
 }
});

test('a fresh process reproduces the frozen references with all network entry points disabled',t=>{
 const dir=root(t),one=put(dir,source());put(dir,source({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,receivedAt:NOW+1000,revisedAt:NOW+500}),NOW+1000);
 const options={code:'600000',triggerAt:NOW+1000,now:NOW+2000},expected=createReader()(dir,options);
 const script=`let egress=0;const denied=()=>{egress++;throw Error('EGRESS_FORBIDDEN');};
 for(const [name,methods] of [['http',['get','request']],['https',['get','request']],['net',['connect','createConnection']],['tls',['connect']],['dns',['lookup','resolve']]]){const m=require(name);for(const key of methods)m[key]=denied;}global.fetch=denied;
 const result=require(process.argv[1]).capture(process.argv[2],JSON.parse(process.argv[3]));process.stdout.write(JSON.stringify({result,egress}));`;
 const child=spawnSync(process.execPath,['-e',script,require.resolve('../src/core/news-signal-evidence'),dir,JSON.stringify(options)],{encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);const actual=JSON.parse(child.stdout);assert.equal(actual.egress,0);assert.deepEqual(actual.result,expected);
 assert.equal(actual.result.binding.status,'recorded');assert.equal(actual.result.originalEvidence[0].sourceRevisionId,'edition-2');
});
