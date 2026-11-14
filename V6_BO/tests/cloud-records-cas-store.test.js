'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCloudRecordsCasStore,digest}=require('../src/core/cloud-records-cas-store');
const account=(revision=0,cash=100000)=>({revision,cash,positions:[],orders:[],risk:{},picks:{}});
const ledger=(state=account())=>({name:'v6.app.state',title:'模拟账户',content:JSON.stringify(state),author:'V6'});
const news=content=>({name:'v6.news.pool',title:'事件',content});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-cloud-cas-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{force:true,recursive:true}));return {root,store:createCloudRecordsCasStore(root)};}
function seed(f,rows=[ledger()]){return f.store.bootstrap({records:rows,expectedSourceHash:digest({records:rows}),operatorApproved:true,requestId:'bootstrap_0001'});}
const code=(fn,expected)=>assert.throws(fn,e=>e&&e.code===expected);

test('no authoritative store is never automatically initialized by upsert',t=>{
 const f=fixture(t);
 const read=f.store.read();assert.equal(read.status,'uninitialized');assert.equal(read.records,null);
 code(()=>f.store.upsert({expectedRevision:1,requestId:'request_0001',record:ledger()}),'NO_AUTHORITATIVE_SNAPSHOT');
 assert.equal(fs.readdirSync(f.root).filter(x=>x.endsWith('.json')).length,0);
});
test('bootstrap needs operator approval, exact source hash, valid account, and never replaces existing snapshot',t=>{
 const f=fixture(t),records=[ledger(),news('{}')];
 code(()=>f.store.bootstrap({records,expectedSourceHash:digest({records}),requestId:'bootstrap_0001'}),'EXPLICIT_OPERATOR_APPROVAL_REQUIRED');
 code(()=>f.store.bootstrap({records,expectedSourceHash:'0'.repeat(64),operatorApproved:true,requestId:'bootstrap_0001'}),'AUTHORITATIVE_BACKUP_PROOF_REQUIRED');
 code(()=>f.store.bootstrap({records:[news('{}')],expectedSourceHash:digest({records:[news('{}')]}),operatorApproved:true,requestId:'bootstrap_0001'}),'AUTHORITATIVE_BACKUP_PROOF_REQUIRED');
 const a=seed(f,records);assert.equal(a.revision,1);assert.equal(a.records.length,2);
 code(()=>f.store.bootstrap({records,expectedSourceHash:digest({records}),operatorApproved:true,requestId:'bootstrap_0002'}),'BOOTSTRAP_WOULD_OVERWRITE_EXISTING_DATA');
});
test('a stale second device cannot overwrite a first device commit',t=>{
 const f=fixture(t);seed(f);
 const first=f.store.upsert({expectedRevision:1,requestId:'mobile_0001',record:ledger(account(1,88888))});
 assert.equal(first.appliedRevision,2);assert.equal(first.reused,false);
 code(()=>f.store.upsert({expectedRevision:1,requestId:'desktop_0001',record:ledger(account(1,77777))}),'REVISION_CONFLICT');
 const final=f.store.read();assert.equal(final.revision,2);
 assert.equal(JSON.parse(final.records.find(r=>r.name==='v6.app.state').content).cash,88888);
});
test('same requestId retries are idempotent, changed content with same ID is rejected',t=>{
 const f=fixture(t);seed(f);const req={expectedRevision:1,requestId:'mobile_0001',record:ledger(account(1,90000))};
 const first=f.store.upsert(req),second=f.store.upsert(req);
 assert.equal(first.appliedRevision,2);assert.equal(second.reused,true);
 f.store.upsert({expectedRevision:2,requestId:'market_0001',record:news('{}')});
 assert.equal(f.store.upsert(req).currentRevision,3);
 code(()=>f.store.upsert({...req,record:ledger(account(1,55555))}),'IDEMPOTENCY_CONTENT_CONFLICT');
 assert.equal(f.store.read().events,3);
});
test('failed partial file or before-rename fault leaves prior state intact',t=>{
 const f=fixture(t);seed(f);const before=f.store.read();
 for(const point of ['during-write','before-rename']){
  assert.throws(()=>f.store.upsert({expectedRevision:1,requestId:'retry_'+point.replace(/-/g,'_'),record:ledger(account(1,200))},
   {injectFault:step=>{if(step===point)throw Error('injected-stop');}}),/injected-stop/);
  assert.equal(f.store.read().proof,before.proof);
 }
});
test('uncertain response after commit is recovered by requestId, without duplicate state change',t=>{
 const f=fixture(t);seed(f);
 const req={expectedRevision:1,requestId:'retry_after_commit',record:ledger(account(1,199))};
 assert.throws(()=>f.store.upsert(req,{injectFault:p=>{if(p==='after-commit')throw Error('late-response-lost');}}),/late-response-lost/);
 assert.equal(f.store.read().revision,2);
 assert.equal(f.store.upsert(req).reused,true);
 assert.equal(f.store.read().events,2);
});
test('Unicode content is byte-exact through an on-disk event and reload',t=>{
 const f=fixture(t);seed(f);
 const rec=news(JSON.stringify({title:'中信证券 🚀 数据',source:'公开公告'}));
 f.store.upsert({expectedRevision:1,requestId:'unicode_0001',record:rec});
 assert.deepEqual(createCloudRecordsCasStore(f.root).read().records.find(x=>x.name===rec.name),rec);
});
test('broken hashes, chain gaps, unsafe files and duplicate account names refuse recovery',t=>{
 const f=fixture(t);seed(f);f.store.upsert({expectedRevision:1,requestId:'market_0001',record:news('{}')});
 const second=path.join(f.root,'000002.json'),old=fs.readFileSync(second,'utf8');
 fs.writeFileSync(second,old.replace('v6.news.pool','v6.news.bad'));
 code(()=>f.store.read(),'EVENT_HASH_MISMATCH');
 fs.writeFileSync(second,old);fs.renameSync(second,path.join(f.root,'000003.json'));
 code(()=>f.store.read(),'EVENT_SEQUENCE_GAP');
 fs.renameSync(path.join(f.root,'000003.json'),second);
 fs.chmodSync(second,0o644);code(()=>f.store.read(),'EVENT_FILE_UNSAFE');fs.chmodSync(second,0o600);
 assert.equal(f.store.read().revision,2);
 const other=fixture(t),rows=[ledger(),ledger(account(2))];
 code(()=>other.store.bootstrap({records:rows,expectedSourceHash:digest({records:rows}),operatorApproved:true,requestId:'bootstrap_0001'}),'DUPLICATE_RECORD_NAME');
});
test('storage refuses public directories and symlinked roots',t=>{
 const f=fixture(t),dir=path.join(f.root,'public');fs.mkdirSync(dir);
 code(()=>createCloudRecordsCasStore(dir).read(),'PUBLIC_OR_ROOT_DIRECTORY_FORBIDDEN');
 const link=path.join(f.root,'symlink');fs.symlinkSync(f.root,link);
 code(()=>createCloudRecordsCasStore(link).read(),'UNSAFE_DIRECTORY');
});
test('a legacy lock artifact prevents writes and requires operator inspection',t=>{
 const f=fixture(t);seed(f);const lock=path.join(f.root,'records.lock');fs.writeFileSync(lock,'{}');
 assert.throws(()=>f.store.upsert({expectedRevision:1,requestId:'mobile_0001',record:ledger(account(1,90000))}),/账户正在处理其他请求/);
 code(()=>f.store.read(),'UNEXPECTED_STORAGE_FILES');
 fs.unlinkSync(lock);assert.equal(f.store.read().revision,1);
});
test('two independent child processes cannot both commit the same expected revision',async t=>{
 const {spawn}=require('node:child_process');
 const f=fixture(t);seed(f);const modulePath=path.resolve(__dirname,'../src/core/cloud-records-cas-store.js');
 const workers=[['phone_00001',200],['desktop_01',300]].map(([id,cash])=>{
  const script='const s=require('+JSON.stringify(modulePath)+').createCloudRecordsCasStore('+JSON.stringify(f.root)+');'
  +'try{s.upsert({expectedRevision:1,requestId:'+JSON.stringify(id)+',record:{name:"v6.app.state",content:JSON.stringify({revision:1,cash:'+cash+',orders:[],positions:[]})}});process.exit(0)}'
  +'catch(e){process.stderr.write(e.code||e.message);process.exit(4)}';
  return new Promise((resolve,reject)=>{
   const p=spawn(process.execPath,['-e',script],{stdio:['ignore','pipe','pipe']});let err='';
   p.stderr.on('data',b=>err+=b);p.once('error',reject);p.once('exit',c=>resolve({exit:c,err}));
  });
 });
 const results=await Promise.all(workers);
 assert.equal(results.filter(r=>r.exit===0).length,1,JSON.stringify(results));
 assert.ok(results.some(r=>r.exit!==0 && /REVISION_CONFLICT|账户正在处理其他请求/.test(r.err)),JSON.stringify(results));
 assert.equal(f.store.read().revision,2);
});
test('structured market/news cache remains unchanged without altering the account',t=>{
 const f=fixture(t);seed(f);
 const payload={v:1,encoding:'json',data:{title:'公开新闻',items:[{id:'a',seenAt:null}]}};
 f.store.upsert({expectedRevision:1,requestId:'newsjson_0001',record:{name:'v6.news.pool',content:payload}});
 const snapshot=f.store.read();
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot.records.find(r=>r.name==='v6.news.pool').content)),payload);
 assert.equal(JSON.parse(snapshot.records.find(r=>r.name==='v6.app.state').content).cash,100000);
});


test('receipt lookup is read-only and unavailable without verified original history',t=>{
 const f=fixture(t);
 code(()=>f.store.receipt('request_0001'),'NO_AUTHORITATIVE_SNAPSHOT');
 code(()=>f.store.receipt('../../secret'),'INVALID_REQUEST_ID');
 assert.equal(f.store.read().status,'uninitialized');
 assert.equal(fs.readdirSync(f.root).filter(n=>n.endsWith('.json')).length,0);
});

test('receipt proof survives restart, preserves original revision after later updates, and never returns balances',t=>{
 const f=fixture(t);seed(f);
 const before=f.store.receipt('bootstrap_0001');
 assert.equal(before.found,true);
 assert.equal(before.action,'bootstrap');
 assert.equal(before.recordName,null);
 const initial=f.store.read().events;
 const missing=f.store.receipt('never_sent_001');
 assert.deepEqual({found:missing.found,status:missing.status,applied:missing.appliedRevision},
  {found:false,status:'not-present-in-verified-ledger',applied:null});
 const update=f.store.upsert({expectedRevision:1,requestId:'phone_receipt_001',
  record:ledger(account(1,72000))});
 assert.equal(update.currentRevision,2);
 f.store.upsert({expectedRevision:2,requestId:'news_receipt_001',record:news('{"items":[]}')});
 const restart=createCloudRecordsCasStore(f.root);
 const receipt=restart.receipt('phone_receipt_001');
 assert.equal(receipt.found,true);
 assert.equal(receipt.action,'upsert');
 assert.equal(receipt.recordName,'v6.app.state');
 assert.equal(receipt.appliedRevision,2);
 assert.equal(receipt.currentRevision,3);
 assert.equal(receipt.verifiedFromHashChain,true);
 assert.equal(receipt.accountRecoveryVerified,false);
 assert.equal(receipt.productionDeployed,false);
 assert.equal(receipt.readOnly,true);
 assert.equal(f.store.read().events,initial+2);
 const text=JSON.stringify(receipt);
 assert.ok(!text.includes('72000'));
 assert.ok(!text.includes('positions'));
});

test('corrupt immutable history cannot produce a positive receipt despite a matching requestId',t=>{
 const f=fixture(t);seed(f);
 f.store.upsert({expectedRevision:1,requestId:'proof_tamper_001',record:ledger(account(1,22000))});
 const pathToEvent=path.join(f.root,'000002.json');
 const original=fs.readFileSync(pathToEvent,'utf8');
 fs.writeFileSync(pathToEvent,original.replace('22000','88000'));
 code(()=>f.store.receipt('proof_tamper_001'),'EVENT_HASH_MISMATCH');
 fs.writeFileSync(pathToEvent,original);
 assert.equal(f.store.receipt('proof_tamper_001').found,true);
});
