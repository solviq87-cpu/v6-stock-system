'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createCloudRecordsCasStore,digest}=require('../src/core/cloud-records-cas-store');
const {createCloudRecordsHttpHandler}=require('../src/server/cloud-records-http');
const state=(revision=0,cash=100000)=>({revision,cash,positions:[],orders:[]});
function testServer(t,{bootstrap=true,anchorAfterUpdate=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-cas-http-'));fs.chmodSync(root,0o700);
 const store=createCloudRecordsCasStore(root);
 if(bootstrap){const records=[{name:'v6.app.state',content:JSON.stringify(state())}];
  store.bootstrap({records,expectedSourceHash:digest({records}),operatorApproved:true,requestId:'bootstrap_0001'});}
 if(anchorAfterUpdate && bootstrap){
   store.upsert({expectedRevision:1,requestId:'anchor_http_0001',
     record:{name:'v6.app.state',content:JSON.stringify(state(1,63000))}});
 }
 const pinned=anchorAfterUpdate&&bootstrap?store.read():null;
 const liveStore=pinned?createCloudRecordsCasStore(root,{
   trustedReadAnchor:{revision:pinned.revision,proof:pinned.proof}}):store;
 const handler=createCloudRecordsHttpHandler({store:liveStore,
  authenticate:async token=>token==='editor-token-123'?'edit':token==='viewer-token-123'?'view':null,
  sameOrigin:req=>!req.headers.origin||req.headers.origin==='http://trusted.fixture'});
 const server=http.createServer((req,res)=>{
  const chunks=[];let size=0;req.on('data',b=>{size+=b.length;if(size<=5*1024*1024)chunks.push(b);});
  req.on('end',()=>void handler(req,res,Buffer.concat(chunks).toString('utf8')));
 });
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{force:true,recursive:true});});
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({store,liveStore,root,server,port:server.address().port})));
}
function get(f,route='/api/records',token='editor-token-123',options={}){
 return new Promise((resolve,reject)=>{
  const json=options.body===undefined?null:JSON.stringify(options.body);
  const headers={...(token?{Authorization:'Bearer '+token}:{}),
    ...(json?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(json)}:{}),
    ...(options.headers||{})};
  const req=http.request({host:'127.0.0.1',port:f.port,path:route,method:options.method||'GET',headers},res=>{
   let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body),headers:res.headers}));
  });req.on('error',reject);req.end(json||undefined);
 });
}
const payload=(rev,requestId,cash=50000)=>({name:'v6.app.state',content:JSON.stringify(state(rev,cash)),expectedRevision:rev,requestId});
test('adapter cannot be created without mandatory authenticated session and same-origin policy',()=>{
 const fake={read(){},upsert(){}};
 assert.throws(()=>createCloudRecordsHttpHandler({store:fake}),/AUTH_AND_ORIGIN_POLICIES_REQUIRED/);
 assert.throws(()=>createCloudRecordsHttpHandler({store:fake,authenticate:()=>true}),/AUTH_AND_ORIGIN_POLICIES_REQUIRED/);
});
test('missing, invalid, read-only device tokens and hostile origins cannot disclose account',async t=>{
 const f=await testServer(t);
 for(const [token,opts,expected]of [[null,{},401],['invalid-token-123',{},401],['viewer-token-123',{},403],['editor-token-123',{headers:{Origin:'https://evil.fixture'}},403]]){
  const r=await get(f,'/api/records',token,opts);assert.equal(r.status,expected);
  assert.equal(r.body.ok,false);assert.equal(JSON.stringify(r.body).includes('cash'),false);
 }
 assert.equal((await get(f,'/api/records?sharecode=public-link',null)).status,400);
 assert.equal((await get(f,'/api/records?token=private-token', 'editor-token-123')).status,400);
});
test('authorized GET on absent authoritative account fails without default initialization',async t=>{
 const f=await testServer(t,{bootstrap:false}),r=await get(f);
 assert.equal(r.status,503);assert.equal(r.body.code,'AUTHORITATIVE_LEDGER_UNAVAILABLE');
 assert.equal(f.store.read().status,'uninitialized');
});
test('editor GET/POST preserves explicit CAS revision and request-id replay result',async t=>{
 const f=await testServer(t),initial=await get(f);
 assert.equal(initial.status,200);assert.equal(initial.body.revision,1);
 assert.equal(initial.body.writeContract,'cas-v1');assert.equal(initial.body.accountRecoveryVerified,false);
 const post=await get(f,'/api/records','editor-token-123',{method:'POST',body:payload(1,'mobile_0001')});
 assert.equal(post.status,200);assert.equal(post.body.revision,2);assert.equal(post.body.reused,false);
 const retry=await get(f,'/api/records','editor-token-123',{method:'POST',body:payload(1,'mobile_0001')});
 assert.equal(retry.status,200);assert.equal(retry.body.reused,true);
 const latest=await get(f);assert.equal(latest.body.records.length,1);assert.equal(latest.body.revision,2);
 assert.equal(JSON.parse(latest.body.records[0].content).cash,50000);
});
test('concurrent phone and desktop writes cannot both succeed for one expected version',async t=>{
 const f=await testServer(t);
 const [a,b]=await Promise.all([
  get(f,'/api/records','editor-token-123',{method:'POST',body:payload(1,'mobile_0001',70000)}),
  get(f,'/api/records','editor-token-123',{method:'POST',body:payload(1,'desktop_001',80000)})
 ]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);
 assert.equal((await get(f)).body.revision,2);
});
test('same request ID carrying different content yields 409, no account overwrite',async t=>{
 const f=await testServer(t);
 assert.equal((await get(f,'/api/records','editor-token-123',{method:'POST',body:payload(1,'mobile_0001',70000)})).status,200);
 const r=await get(f,'/api/records','editor-token-123',{method:'POST',body:payload(1,'mobile_0001',80000)});
 assert.equal(r.status,409);assert.equal(r.body.code,'IDEMPOTENCY_CONTENT_CONFLICT');
 assert.equal(JSON.parse((await get(f)).body.records[0].content).cash,70000);
});
test('missing version/id or unexpected field cannot bypass server CAS contract',async t=>{
 const f=await testServer(t);
 for(const body of [{name:'v6.app.state',content:JSON.stringify(state())},
  {...payload(1,'okid_0001'),unknown:'bad'}, {...payload(1,'okid_0002'),expectedRevision:0}]){
  const r=await get(f,'/api/records','editor-token-123',{method:'POST',body});
  assert.equal(r.status,400);
 }
 assert.equal((await get(f)).body.revision,1);
});
test('unsupported verbs and other routes never write to the ledger',async t=>{
 const f=await testServer(t);
 assert.equal((await get(f,'/api/records','editor-token-123',{method:'PUT'})).status,405);
 assert.equal((await get(f,'/api/status','editor-token-123')).status,404);
 assert.equal(f.store.read().revision,1);
});

test('query credentials and non-JSON posts fail even with authenticated edit token',async t=>{
 const f=await testServer(t);
 const good=payload(1,'mobile_0005',99999);
 for(const path of ['/api/records?sharecode=leaked-test','/api/records?token=leaked-test']){
  const result=await get(f,path,'editor-token-123',{method:'POST',body:good});
  assert.equal(result.status,400);
  assert.equal(result.body.code,'QUERY_CREDENTIALS_FORBIDDEN');
 }
 const bad=await get(f,'/api/records','editor-token-123',{
  method:'POST',body:good,headers:{'Content-Type':'text/plain'}
 });
 assert.equal(bad.status,415);
 assert.equal(bad.body.code,'JSON_CONTENT_TYPE_REQUIRED');
 assert.equal(f.store.read().revision,1,'rejected requests must not advance ledger');
});
test('success responses never leak in browser cache and never imply production validation',async t=>{
 const f=await testServer(t),r=await get(f);
 assert.equal(r.status,200);
 assert.equal(r.headers['cache-control'],'no-store');
 assert.equal(r.headers['referrer-policy'],'no-referrer');
 assert.equal(r.headers['x-content-type-options'],'nosniff');
 assert.equal(r.body.accountRecoveryVerified,false);
});


test('authenticated receipt GET proves an immutable event without exposing account data',async t=>{
 const f=await testServer(t);
 const noEvent=await get(f,'/api/records/receipts/not_sent_001');
 assert.equal(noEvent.status,200);
 assert.equal(noEvent.body.ok,true);
 assert.equal(noEvent.body.receipt.found,false);
 assert.equal(noEvent.body.receipt.status,'not-present-in-verified-ledger');
 assert.equal(noEvent.body.receipt.currentRevision,1);
 assert.equal(noEvent.body.accountRecoveryVerified,false);
 const write=await get(f,'/api/records','editor-token-123',{
  method:'POST',body:payload(1,'receipt_phone_001',76000)
 });
 assert.equal(write.status,200);
 const proof=await get(f,'/api/records/receipts/receipt_phone_001');
 assert.equal(proof.status,200);
 assert.equal(proof.body.writeContract,'cas-v1');
 assert.equal(proof.body.receipt.found,true);
 assert.equal(proof.body.receipt.action,'upsert');
 assert.equal(proof.body.receipt.recordName,'v6.app.state');
 assert.equal(proof.body.receipt.appliedRevision,2);
 assert.equal(proof.body.receipt.readOnly,true);
 for(const secret of ['76000','positions','orders','content','hash','fingerprint']){
  assert.ok(!JSON.stringify(proof.body).includes(secret),secret);
 }
 assert.equal(f.store.read().revision,2);
 assert.equal(proof.headers['cache-control'],'no-store');
});

test('receipt lookup requires edit permission and never accepts URL credentials or POST',async t=>{
 const f=await testServer(t);
 const route='/api/records/receipts/receipt_phone_001';
 assert.equal((await get(f,route,null)).status,401);
 assert.equal((await get(f,route,'viewer-token-123')).status,403);
 assert.equal((await get(f,route,'editor-token-123',{headers:{Origin:'https://evil.fixture'}})).status,403);
 assert.equal((await get(f,route+'?sharecode=link','editor-token-123')).status,400);
 assert.equal((await get(f,route,'editor-token-123',{method:'POST',body:{requestId:'receipt_phone_001'}})).status,405);
 assert.equal((await get(f,'/api/records/receipts/bad!id','editor-token-123')).status,404);
 assert.equal(f.store.read().revision,1);
});

test('receipt cannot claim successful submission without a verified authoritative store',async t=>{
 const f=await testServer(t,{bootstrap:false});
 const r=await get(f,'/api/records/receipts/receipt_phone_001');
 assert.equal(r.status,503);
 assert.equal(r.body.code,'AUTHORITATIVE_LEDGER_UNAVAILABLE');
 assert.equal(f.store.read().status,'uninitialized');
});


test('pinned HTTP ledger rejects valid-chain rollback on GET, POST and receipt without touching records',async t=>{
 const f=await testServer(t,{anchorAfterUpdate:true});
 const before=await get(f);
 assert.equal(before.status,200);
 assert.equal(before.body.revision,2);
 const event=path.join(f.root,'000002.json');
 fs.unlinkSync(event); // controlled synthetic rollback, not a production recovery action
 assert.equal(f.store.read().revision,1,'unanchored chain remains internally valid');
 const account=await get(f);
 assert.equal(account.status,503);
 assert.equal(account.body.code,'LEDGER_VERIFICATION_FAILED');
 assert.ok(!JSON.stringify(account.body).includes('cash'));
 assert.equal((await get(f,'/api/records/receipts/anchor_http_0001')).status,503);
 const write=await get(f,'/api/records','editor-token-123',{
   method:'POST',body:payload(1,'anchor_http_write_01',9999)});
 assert.equal(write.status,503);
 assert.equal(write.body.code,'LEDGER_WRITE_UNAVAILABLE');
 assert.equal(f.store.read().revision,1);
 assert.equal(fs.existsSync(event),false);
});

test('pinned HTTP ledger blocks fork and incomplete stage even when format and hashes are valid',async t=>{
 const f=await testServer(t,{anchorAfterUpdate:true});
 fs.unlinkSync(path.join(f.root,'000002.json'));
 f.store.upsert({expectedRevision:1,requestId:'anchor_http_fork_001',
  record:{name:'v6.app.state',content:JSON.stringify(state(1,20000))}});
 assert.equal((await get(f)).status,503,'new valid hash chain cannot bypass anchor');
 assert.equal((await get(f,'/api/records/receipts/anchor_http_fork_001')).status,503);
 const stage=path.join(f.root,'.stage-'+('b'.repeat(24)));
 fs.writeFileSync(stage,'incomplete',{mode:0o600});
 assert.equal((await get(f)).status,503);
 fs.unlinkSync(stage);
 assert.equal((await get(f)).status,503,'fork remains invalid after stage cleanup');
 assert.equal(f.store.read().revision,2);
});
