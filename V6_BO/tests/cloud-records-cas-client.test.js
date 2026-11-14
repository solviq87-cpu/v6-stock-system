'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createClient } = require('../public/assets/v6-cloud-cas-client');
const { createCloudRecordsCasStore, digest } = require('../src/core/cloud-records-cas-store');
const { createCloudRecordsHttpHandler } = require('../src/server/cloud-records-http');
const EDIT = 'editor-token-123', VIEW = 'viewer-token-123';
const state = (revision=0,cash=100000) => ({revision,cash,positions:[],orders:[],risk:{},picks:{}});
const row = (revision=0,cash=100000) => ({name:'v6.app.state',content:JSON.stringify(state(revision,cash))});
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const readReply = (revision=1,records=[row()]) => ({ok:true,writeContract:'cas-v1',revision,records});
const code = (fn,expected) => assert.rejects(fn,error=>error && error.code===expected,expected);
async function fixture(t,{withNews=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'v6-cas-client-'));
  fs.chmodSync(directory,0o700);
  const store=createCloudRecordsCasStore(directory);
  const records=[row()];
  store.bootstrap({records,expectedSourceHash:digest({records}),operatorApproved:true,requestId:'bootstrap_test_01'});
  if(withNews)store.upsert({expectedRevision:1,requestId:'news_record_001',
    record:{name:'v6.news.pool',content:'{"items":[]}'}});
  const handler=createCloudRecordsHttpHandler({store,
    authenticate:token=>token===EDIT?'edit':token===VIEW?'view':null,
    sameOrigin:req=>!req.headers.origin||req.headers.origin==='http://trusted.fixture'});
  const server=http.createServer(async(req,res)=>{
    const chunks=[];let total=0;
    req.on('data',chunk=>{total+=chunk.length;if(total<=5*1024*1024)chunks.push(chunk);});
    req.on('end',()=>{
      void handler(req,res,Buffer.concat(chunks).toString('utf8')).catch(()=>{
        if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}
      });
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const port=server.address().port, requests=[];
  const fetchImpl=async(url,options)=>{
    assert.ok(url==='/api/records'||/^\/api\/records\/receipts\/[A-Za-z0-9_-]{8,100}$/.test(url),
      'client may only access fixed same-origin CAS paths');
    assert.equal(options.mode,'same-origin');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.redirect,'error');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.headers.Authorization,'Bearer '+EDIT);
    requests.push({method:options.method,body:options.body?JSON.parse(options.body):null});
    return fetch('http://127.0.0.1:'+port+url,{...options,mode:'cors'});
  };
  return {directory,store,server,fetchImpl,requests};
}
test('no live session token means no HTTP requests, secrets never exposed',async()=>{
  let count=0;
  const client=createClient({getToken:()=>'',fetchImpl:()=>{count++;throw Error('unexpected');}});
  await code(()=>client.load(),'LOGIN_REQUIRED');
  assert.equal(count,0);
  assert.deepEqual(Object.keys(client.status()).includes('token'),false);
  assert.equal(client.status().accountRecoveryVerified,false);
});
test('default is read-only even with valid session and authoritative CAS endpoint',async t=>{
  const f=await fixture(t);
  const c=createClient({getToken:()=>EDIT,fetchImpl:f.fetchImpl});
  const loaded=await c.load();
  assert.equal(loaded.revision,1);
  assert.equal(loaded.loaded,true);
  assert.equal(c.status().readOnly,true);
  assert.equal(c.record('v6.app.state').name,'v6.app.state');
  await code(()=>c.commit(row(1,90000)),'READ_ONLY_MODE');
  assert.equal(f.requests.filter(x=>x.method==='POST').length,0);
});
test('no automatic initialization if missing or duplicate account; even HTTP 200 is insufficient',async()=>{
  const cases=[
    [readReply(1,[]),'LEDGER_MISSING_OR_DUPLICATED'],
    [readReply(1,[row(),row(1,200)]),'RECORDS_INVALID'],
    [readReply(1,[{name:'v6.app.state',content:'{broken'}]),'LEDGER_INVALID'],
    [{ok:true,records:[row()],revision:1},'CAS_CONTRACT_REQUIRED'],
    [readReply(0,[row()]),'RECORDS_INVALID']
  ];
  for(const [body,expected] of cases){
    const client=createClient({getToken:()=>EDIT,fetchImpl:()=>Promise.resolve(json(body))});
    await code(()=>client.load(),expected);
    assert.equal(client.status().loaded,false);
    assert.equal(client.status().blocked,true);
  }
});
test('two logged-in devices use server global revision and only one can commit',async t=>{
  const f=await fixture(t,{withNews:true});
  const mobile=createClient({getToken:()=>EDIT,fetchImpl:f.fetchImpl,allowMutations:true,requestIdFactory:()=> 'mobile_req_001'});
  const desktop=createClient({getToken:()=>EDIT,fetchImpl:f.fetchImpl,allowMutations:true,requestIdFactory:()=> 'desktop_req_01'});
  assert.equal((await mobile.load()).revision,2);
  assert.equal((await desktop.load()).revision,2);
  const result=await mobile.commit(row(1,90000));
  assert.equal(result.status,'confirmed');
  assert.equal(result.revision,3);
  assert.equal(result.accountRecoveryVerified,false);
  await code(()=>desktop.commit(row(1,80000)),'REVISION_CONFLICT');
  assert.equal(desktop.status().blocked,true);
  assert.equal(desktop.status().pendingWrite,false);
  assert.equal(JSON.parse(f.store.read().records.find(x=>x.name==='v6.app.state').content).cash,90000);
  assert.equal((await desktop.load()).revision,3);
  assert.equal(desktop.status().blocked,false);
  assert.equal(f.requests.filter(x=>x.method==='POST').length,2);
  assert.equal(f.requests.find(x=>x.method==='POST').body.expectedRevision,2);
});
test('lost POST response keeps the exact requestId and retry does not append a second event',async t=>{
  const f=await fixture(t);
  let lost=false;
  const transport=async(url,options)=>{
    const response=await f.fetchImpl(url,options);
    if(options.method==='POST'&&!lost){lost=true;throw Error('network dropped after server commit');}
    return response;
  };
  const client=createClient({getToken:()=>EDIT,fetchImpl:transport,allowMutations:true,
    requestIdFactory:()=> 'idempotent_req_01'});
  await client.load();
  await code(()=>client.commit(row(1,75000)),'TRANSPORT_UNCERTAIN');
  assert.equal(client.status().pendingWrite,true);
  assert.equal(client.status().blocked,true);
  assert.equal(f.store.read().revision,2,'first POST actually committed');
  await code(()=>client.commit(row(2,70000)),'PENDING_WRITE_MUST_BE_RECONCILED');
  const retry=await client.retryPending();
  assert.equal(retry.status,'confirmed');
  assert.equal(retry.reused,true);
  assert.equal(client.status().pendingWrite,false);
  assert.equal(f.store.read().events,2);
  const attempts=f.requests.filter(x=>x.method==='POST').map(x=>x.body);
  assert.equal(attempts.length,2);
  assert.deepEqual(attempts[0],attempts[1],'same payload and requestId required');
});
test('a rotated device token clears previously loaded private data and prevents writes',async t=>{
  const f=await fixture(t);
  let token=EDIT;
  const c=createClient({getToken:()=>token,fetchImpl:f.fetchImpl,allowMutations:true});
  await c.load();
  token='new-invalid-session-token';
  await code(()=>c.commit(row(1,90000)),'AUTH_CHANGED');
  assert.equal(c.status().loaded,false);
  assert.equal(c.status().blocked,true);
  assert.equal(c.status().pendingWrite,false);
  await code(async()=>c.record('v6.app.state')||Promise.resolve(),'NOT_SYNCHRONIZED');
  assert.equal(f.requests.filter(x=>x.method==='POST').length,0);
});
test('explicit clear invalidates an in-flight GET, even if token remains unchanged',async()=>{
  let resume;
  const pending=new Promise(resolve=>resume=resolve);
  const c=createClient({getToken:()=>EDIT,fetchImpl:()=>pending});
  const load=c.load();
  c.clear();
  resume(json(readReply()));
  await code(()=>load,'AUTH_CHANGED');
  assert.equal(c.status().loaded,false);
  assert.equal(c.status().blocked,true);
});
test('a readback that shows a different account after acknowledged commit never claims saved',async()=>{
  let reads=0;
  const c=createClient({getToken:()=>EDIT,allowMutations:true,requestIdFactory:()=> 'ack_test_0001',
    fetchImpl:async(url,options)=>{
      if(options.method==='GET')return json(reads++===0?readReply():readReply(3,[row(2,70000)]));
      return json({ok:true,writeContract:'cas-v1',revision:2,appliedRevision:2,reused:false});
    }});
  await c.load();
  await code(()=>c.commit(row(1,80000)),'WRITE_SUPERSEDED_OR_UNVERIFIED');
  assert.equal(c.status().blocked,true);
  assert.equal(c.status().pendingWrite,false);
  assert.equal(c.status().revision,3);
});
test('invalid write acknowledgements keep a pending ID for same-operation recovery',async()=>{
  let posts=0;
  const c=createClient({getToken:()=>EDIT,allowMutations:true,requestIdFactory:()=> 'ack_retry_0001',
    fetchImpl:async(url,options)=>{
      if(options.method==='GET')return json(readReply(posts===0?1:2,[posts===0?row():row(1,90000)]));
      posts++;
      return json(posts===1?{ok:true,writeContract:'cas-v1',revision:2,reused:false}:
        {ok:true,writeContract:'cas-v1',revision:2,appliedRevision:2,reused:true});
    }});
  await c.load();
  await code(()=>c.commit(row(1,90000)),'WRITE_ACK_UNVERIFIED');
  assert.equal(c.status().pendingWrite,true);
  const result=await c.retryPending();
  assert.equal(result.reused,true);
  assert.equal(c.status().pendingWrite,false);
});
test('readback and status never expose Bearer token and do not carry it in URL or query',async t=>{
  const f=await fixture(t);
  const c=createClient({getToken:()=>EDIT,fetchImpl:f.fetchImpl,allowMutations:true,requestIdFactory:()=> 'privacy_req_001'});
  const r=await c.load();
  const saved=await c.commit(row(1,80000));
  for(const data of [r,c.status(),saved]){
    assert.equal(JSON.stringify(data).includes(EDIT),false);
    assert.equal(JSON.stringify(data).includes('sharecode'),false);
  }
  assert.ok(f.requests.every(x=>!JSON.stringify(x).includes(EDIT)));
});


test('verified receipt supports read-only after page restart with a previously known request ID',async t=>{
 const f=await fixture(t);
 const id='receipt_mobile_001';
 const writer=createClient({getToken:()=>EDIT,fetchImpl:f.fetchImpl,
  allowMutations:true,requestIdFactory:()=>id});
 await writer.load();
 assert.equal((await writer.commit(row(1,84000))).status,'confirmed');
 const restarted=createClient({getToken:()=>EDIT,fetchImpl:f.fetchImpl});
 const before=f.store.read().revision;
 const found=await restarted.receipt(id);
 assert.equal(found.found,true);
 assert.equal(found.status,'committed');
 assert.equal(found.action,'upsert');
 assert.equal(found.appliedRevision,2);
 assert.equal(found.currentRevision,2);
 assert.equal(found.accountRecoveryVerified,false);
 assert.equal(restarted.status().loaded,false,'receipt metadata must not silently hydrate an account');
 assert.equal(f.store.read().revision,before);
 const noEvent=await restarted.receipt('unknown_id_0001');
 assert.equal(noEvent.found,false);
 assert.equal(noEvent.status,'not-present-in-verified-ledger');
 assert.equal(noEvent.appliedRevision,null);
 assert.equal(noEvent.accountRecoveryVerified,false);
 assert.ok(!JSON.stringify(found).includes('84000'));
 assert.ok(!JSON.stringify(found).includes(EDIT));
});

test('receipt queries never substitute a URL sharecode or accept a revoked identity',async t=>{
 const f=await fixture(t);
 let token=EDIT;
 const c=createClient({getToken:()=>token,fetchImpl:f.fetchImpl});
 await c.load();
 token=VIEW;
 await code(()=>c.receipt('old_receipt_001'),'AUTH_CHANGED');
 assert.equal(c.status().loaded,false);
 assert.equal(c.status().blocked,true);
 await code(()=>c.receipt('../not-valid'),'INVALID_REQUEST_ID');
 assert.equal(f.requests.filter(x=>x.method==='POST').length,0);
});

test('malformed receipt responses are never proof, even with successful HTTP',async()=>{
 const c=createClient({getToken:()=>EDIT,fetchImpl:async()=>json({
  ok:true,writeContract:'cas-v1',
  receipt:{found:true,status:'committed',appliedRevision:1,currentRevision:1,
    readOnly:false,verifiedFromHashChain:false,accountRecoveryVerified:false}
 })});
 await code(()=>c.receipt('receipt_test_001'),'RECEIPT_UNVERIFIED');
 assert.equal(c.status().loaded,false);
});

test('clear while receipt GET is pending blocks delayed proof and keeps private state empty',async()=>{
 let resolve;
 const response=new Promise(r=>resolve=r);
 const c=createClient({getToken:()=>EDIT,fetchImpl:()=>response});
 const checking=c.receipt('receipt_test_001');
 c.clear();
 resolve(json({ok:true,writeContract:'cas-v1',receipt:{
  found:false,status:'not-present-in-verified-ledger',currentRevision:1,
  appliedRevision:null,readOnly:true,verifiedFromHashChain:true,
  accountRecoveryVerified:false
 }}));
 await code(()=>checking,'AUTH_CHANGED');
 assert.equal(c.status().loaded,false);
 assert.equal(c.status().blocked,true);
});
