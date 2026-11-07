'use strict';
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// SSE 是长连接：只读取首个响应块，不等待连接结束。
const streamProbe=(port,token='')=>new Promise((resolve,reject)=>{
 const suffix=token?'?token='+encodeURIComponent(token):'';
 const req=http.get({hostname:'127.0.0.1',port,path:'/api/stream'+suffix,timeout:3000},res=>{
  const status=res.statusCode,contentType=res.headers['content-type']||'';
  res.once('data',chunk=>{resolve({status,contentType,chunk:String(chunk)});res.destroy();});
  res.once('end',()=>resolve({status,contentType,chunk:''}));
  res.once('error',reject);
 });
 req.once('error',reject);req.once('timeout',()=>req.destroy(Error('SSE probe timeout')));
});

const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const request=(port,url,method='GET',obj=null,token='',extraHeaders={})=>new Promise((resolve,reject)=>{
 const body=obj===null?'':JSON.stringify(obj);
 const req=http.request({hostname:'127.0.0.1',port,path:url,method,timeout:3000,headers:{...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...(token?{'Authorization':'Bearer '+token}:{}),...extraHeaders}},res=>{
  let data='';res.on('data',d=>data+=d);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch{resolve({status:res.statusCode,raw:data});}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('request timeout')));req.end(body);
});
(async()=>{
 const p=await port(),source=path.resolve(__dirname,'..');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-http-'));
 // No user accounts, cache, passwords or holdings copied: isolated temp deployment.
 const copy=(rel)=>{const src=path.join(source,rel),dst=path.join(tmp,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.cpSync(src,dst,{recursive:true});};
 for(const rel of ['server.js','src','strategies','public','package.json'])if(fs.existsSync(path.join(source,rel)))copy(rel);
 for(const f of fs.readdirSync(source))if(f.endsWith('.js')&&f!=='server.js')copy(f);
 const salt=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify({salt,hash:crypto.scryptSync('isolated-test-password',salt,32).toString('hex'),devices:{}}));
 const calendarDate=new Date(Date.now()+8*3600000).toISOString().slice(0,10);fs.writeFileSync(path.join(tmp,'test-calendar.json'),JSON.stringify({schemaVersion:1,exchange:'SSE',source:'test-only-not-official',from:calendarDate,to:calendarDate,sessions:[{date:calendarDate,open:true}]}));
 const monitorRoot=path.join(tmp,'adaptive-runs'),monitorInput=path.join(tmp,'adaptive-input.json');
 fs.writeFileSync(monitorInput,JSON.stringify(require('./helpers/adaptive-fixture').fixture(65)));
 const monitor= require('../src/core/adaptive-research-monitor').createAdaptiveMonitor({inputFile:monitorInput,outputRoot:monitorRoot});
 const savedReport=await monitor.runOnce();
 const child=spawn(process.execPath,['server.js'],{cwd:tmp,env:{...process.env,V6_ADAPTIVE_RUNS_DIR:monitorRoot,PORT:String(p),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_TRADING_CALENDAR_FILE:path.join(tmp,'test-calendar.json'),V6_RESEARCH_CACHE_DIR:path.join(tmp,'empty-cache')},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 try{
  let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('server exited '+logs.slice(-1000));try{const r=await request(p,'/api/lock/status');if(r.status===200){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'server not ready '+logs.slice(-1000));
  const anonymousStream=await streamProbe(p);assert.ok(!/text\/event-stream/.test(anonymousStream.contentType),'匿名请求不可进入 SSE');
  const invalidStream=await streamProbe(p,'invalid-token');assert.ok(!/text\/event-stream/.test(invalidStream.contentType),'无效令牌不可进入 SSE');
  const endpoints=['/api/research/adaptive-latest','/api/research/adaptive-market','/api/lock/devices','/api/research/capabilities','/api/research/scan','/api/research/ledger','/api/research/cache-scan','/api/research/cache-ledger','/api/research/disk-save','/api/research/disk-scan','/api/research/disk-ledger'];
  let checks=0;
  for(const url of endpoints){const r=await request(p,url,(url.endsWith('capabilities')||url.endsWith('adaptive-latest'))?'GET':'POST',url.endsWith('capabilities')?null:{});assert.notEqual(r.body?.ok,true,'anonymous allowed '+url);checks++;}
  const login=await request(p,'/api/lock/unlock','POST',{password:'isolated-test-password',role:'edit',fp:'isolated-http-test'});assert.equal(login.body?.ok,true,JSON.stringify(login.body));checks++;
  const token=login.body.token;assert.ok(token);checks++;
  const orderAccount=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'initialize',initialCash:100000},token);assert.equal(orderAccount.body?.ok,true,JSON.stringify(orderAccount.body));checks++;
  const submitOrder=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'submit',order:{orderId:'httporder',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:'2026-11-05'}},token);assert.equal(submitOrder.body?.ok,true,JSON.stringify(submitOrder.body));checks++;
  const persistedOrder=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'read'},token);assert.equal(persistedOrder.body?.result?.orders?.httporder?.state.status,'pending');checks++;
  const quote={symbol:'600000',source:'simulated',tradeDate:calendarDate,timestamp:Date.now(),volumeUnit:'shares',volume:100000,price:10,upperLimit:11,lowerLimit:9,suspended:false,tradable:true};
  const fillPayload={accountId:'unified',action:'fill',orderId:'httporder',eventId:'httpfill',quote};
  const fill=await request(p,'/api/research/order-account','POST',fillPayload,token);assert.equal(fill.body?.ok,true,JSON.stringify(fill.body));assert.equal(fill.body.result.orders.httporder.state.status,'filled');assert.equal(fill.body.result.account.cash,98995);checks+=3;
  const repeatFill=await request(p,'/api/research/order-account','POST',fillPayload,token);assert.equal(repeatFill.body.result.revision,fill.body.result.revision);checks++;
  const configure=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'configure',configuration:{expectedRevision:repeatFill.body.result.revision,feeSchedules:[{version:'http-fee-v1',effectiveFrom:calendarDate,feeBps:3,minFee:5,sellTaxBps:5,transferBps:1}],riskPolicy:{version:'http-risk-v1',maxPositionPct:.5}}},token);assert.equal(configure.body.ok,true,JSON.stringify(configure.body));checks++;
  assert.equal(configure.body.result.account.events[0].fee,5);checks++;
  const riskDenied=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'submit',order:{orderId:'risk-denied',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:calendarDate},riskContext:{observedAt:Date.now(),marks:{'600000':10}}},token);assert.equal(riskDenied.body.ok,false);assert.match(riskDenied.body.error,/SINGLE_POSITION_LIMIT/);checks+=2;

  const auditView=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'audit'},token);assert.equal(auditView.body.ok,true);assert.ok(auditView.body.result.events.some(e=>e.reasonCodes.includes('SINGLE_POSITION_LIMIT')));checks+=2;
  const settlement={eventId:'http-dividend',actionId:'provider-action',sourceRecordId:'provider-row',source:'imported',provider:'test-fixture-not-official',kind:'cash-dividend',symbol:'600000',effectiveDate:calendarDate,publishedAt:new Date(Date.now()-60000).toISOString(),expectedQuantity:100,expectedCostBasis:1005,cashDelta:10,shareDelta:0,basisDelta:0};
  const rights=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'settle',settlement,expectedRevision:configure.body.result.revision},token);assert.equal(rights.body.ok,true,JSON.stringify(rights.body));assert.equal(rights.body.result.account.cash,99005);assert.equal(rights.body.result.corporateEvents.length,1);checks+=3;

  // Explicit operator workflow: status is read-only and importing uses revision guards.
  const evidenceCall=(payload,auth=token)=>request(p,'/api/research/order-account','POST',{accountId:'evidence-http',...payload},auth);
  const evidenceInit=await evidenceCall({action:'initialize',initialCash:100000});assert.equal(evidenceInit.body.ok,true);checks++;
  const evidenceConfig=await evidenceCall({action:'configure',configuration:{expectedRevision:1,riskPolicy:{version:'http-sector',maxSectorPct:50}}});assert.equal(evidenceConfig.body.ok,true);checks++;
  const evidenceQuery={tradeDate:calendarDate,symbol:'600000'};
  const evidenceMissing=await evidenceCall({action:'risk-evidence-status',query:evidenceQuery});assert.equal(evidenceMissing.body.result.evidenceReady,false);assert.deepEqual(evidenceMissing.body.result.checks[0].reasonCodes,['MISSING_IMPORTED_SECTOR']);checks+=2;
  const evidenceAt=new Date(Date.now()-1000).toISOString();
  const evidence={schemaVersion:1,source:'imported',kind:'sector',version:'http-sector-data',provider:'test-fixture',sourceRecordId:'http-sector-row',tradeDate:calendarDate,publishedAt:evidenceAt,knownAt:evidenceAt,classificationAsOf:calendarDate,sectors:{600000:'fixture-sector'}};
  const evidencePreview=await evidenceCall({action:'preview-risk-evidence-import',expectedRevision:evidenceConfig.body.result.revision,evidenceList:[evidence]});assert.equal(evidencePreview.body.ok,true);assert.equal(evidencePreview.body.result.previewOnly,true);assert.equal(evidencePreview.body.result.imported,1);checks+=3;
  const evidenceBatchInvalid=await evidenceCall({action:'import-risk-evidence-batch',expectedRevision:evidenceConfig.body.result.revision,evidenceList:[evidence,{...evidence,version:''}]});assert.equal(evidenceBatchInvalid.body.ok,false);checks++;
  const evidenceImport=await evidenceCall({action:'import-risk-evidence',expectedRevision:evidenceConfig.body.result.revision,evidence});assert.equal(evidenceImport.body.ok,true,JSON.stringify(evidenceImport.body));checks++;
  const evidenceBatchReplay=await evidenceCall({action:'import-risk-evidence-batch',expectedRevision:evidenceImport.body.result.revision,evidenceList:[evidence,evidence]});assert.equal(evidenceBatchReplay.body.ok,true);assert.equal(evidenceBatchReplay.body.result.revision,evidenceImport.body.result.revision);checks+=2;
  const evidenceReady=await evidenceCall({action:'risk-evidence-status',query:evidenceQuery});assert.equal(evidenceReady.body.result.evidenceReady,true);assert.equal(evidenceReady.body.result.accountRevision,evidenceImport.body.result.revision);checks+=2;
  const evidenceConflict=await evidenceCall({action:'import-risk-evidence',expectedRevision:evidenceImport.body.result.revision,evidence:{...evidence,sectors:{600000:'conflict'}}});assert.equal(evidenceConflict.body.ok,false);checks++;
  const evidenceAnon=await evidenceCall({action:'risk-evidence-status',query:evidenceQuery},'');assert.notEqual(evidenceAnon.body.ok,true);checks++;

  const adaptiveInput=require('./helpers/adaptive-fixture').fixture(65);adaptiveInput.simulation={start:45,end:64,topN:2};
  const adaptiveResult=await request(p,'/api/research/adaptive-market','POST',adaptiveInput,token);assert.equal(adaptiveResult.body.ok,true,JSON.stringify(adaptiveResult.body).slice(0,300));assert.equal(adaptiveResult.body.result.canTrade,false);assert.equal(adaptiveResult.body.result.indexModels.a50.instrument,'index');assert.ok(adaptiveResult.body.result.simulation.orders.length);checks+=4;
  const savedLatest=await request(p,'/api/research/adaptive-latest?outputRoot=/etc','GET',null,token);assert.equal(savedLatest.body.status,'verified');assert.equal(savedLatest.body.sourceStatus,'simulated');assert.equal(savedLatest.body.revision,1);assert.equal(savedLatest.body.stale,true);checks+=4;
  const latestPost=await request(p,'/api/research/adaptive-latest','POST',{},token);assert.equal(latestPost.status,405);checks++;
  const savedPath=path.join(monitorRoot,'reports',savedReport.reportFile),savedBytes=fs.readFileSync(savedPath);fs.writeFileSync(savedPath,'broken');
  const brokenLatest=await request(p,'/api/research/adaptive-latest','GET',null,token);assert.equal(brokenLatest.status,422);assert.equal(brokenLatest.body.result,undefined);checks+=2;fs.writeFileSync(savedPath,savedBytes);
  const poolAfterAdaptive=await request(p,'/api/research/order-account','POST',{accountId:'pool',action:'read'},token);assert.equal(poolAfterAdaptive.body.result.account.cash,100000);assert.equal(poolAfterAdaptive.body.result.account.events.length,0);checks+=2;

  const sharedOrder={orderId:'sharedpool',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:calendarDate};
  const sharedSubmit=await request(p,'/api/research/order-account','POST',{accountId:'pool',action:'submit',order:sharedOrder},token);assert.equal(sharedSubmit.body.ok,true);checks++;
  const sharedFill=await request(p,'/api/research/order-account','POST',{accountId:'pool',action:'fill',orderId:'sharedpool',eventId:'sharedfill',quote:{...quote,timestamp:Date.now()}},token);assert.equal(sharedFill.body.ok,true,JSON.stringify(sharedFill.body));checks++;
  const legacyView=await request(p,'/api/paper','GET',null,token);assert.equal(legacyView.body.paper.pool.cash,98995);assert.equal(legacyView.body.paper.pool.positions[0].shares,100);assert.equal(legacyView.body.paper.pool.trades[0].eventId,'sharedfill');checks+=3;
  const resetShared=await request(p,'/api/paper','POST',{action:'reset',account:'pool'},token);assert.equal(resetShared.body.ok,true,JSON.stringify(resetShared.body));checks++;
  const resetBook=await request(p,'/api/research/order-account','POST',{accountId:'pool',action:'read'},token);assert.equal(resetBook.body.result.account.cash,100000);assert.equal(resetBook.body.result.archives[0].orders.sharedpool.state.status,'filled');checks+=2;



  const editorStream=await streamProbe(p,token);assert.equal(editorStream.status,200,'开发者 SSE 可连接');assert.match(editorStream.contentType,/text\/event-stream/);
  const devices=await request(p,'/api/lock/devices','GET',null,token);assert.equal(devices.body?.ok,true,'Bearer developer should list devices: '+JSON.stringify(devices.body));checks++;
  const cap=await request(p,'/api/research/capabilities','GET',null,token);assert.equal(cap.body?.ok,true,JSON.stringify(cap.body));checks++;
  const bars=Array.from({length:46},(_,i)=>{const close=10+i*.04;return {open:close,high:close+.1,low:close-.1,close,volume:1e6};});
  const payload={stocks:[{symbol:'000001',market:'main',feed:{source:'imported',timestamp:Date.now()},bars}],start:27,end:39};
  for(const url of ['/api/research/scan','/api/research/ledger']){
   const r=await request(p,url,'POST',payload,token);assert.equal(r.body?.ok,true,url+': '+JSON.stringify(r.body).slice(0,500));checks++;
   assert.equal(r.body.verifiedLive,false);checks++;
  }
  const viewSetup=await request(p,'/api/lock/change','POST',{role:'view',newPassword:'isolated-view-password',token},token);
  assert.equal(viewSetup.body?.ok,true,'view password setup '+JSON.stringify(viewSetup.body));checks++;
  const viewLogin=await request(p,'/api/lock/unlock','POST',{role:'view',password:'isolated-view-password',fp:'viewer-test-device',name:'isolated viewer'});
  assert.equal(viewLogin.body?.pending,true,'view must await approval: '+JSON.stringify(viewLogin.body));checks++;
  const requestId=viewLogin.body.req;assert.ok(requestId);checks++;
  const before=await request(p,'/api/lock/pending-status?req='+encodeURIComponent(requestId));assert.equal(before.body?.state,'pending');checks++;
  const pending=await request(p,'/api/lock/pending-list','POST',{},token);assert.equal(pending.body?.ok,true);checks++;
  const approve=await request(p,'/api/lock/pending-approve','POST',{req:requestId,allow:true},token);assert.equal(approve.body?.state,'allowed',JSON.stringify(approve.body));checks++;
  const poll=await request(p,'/api/lock/pending-status?req='+encodeURIComponent(requestId));assert.equal(poll.body?.state,'allowed');checks++;
  const viewToken=poll.body.token;assert.ok(viewToken);checks++;
  const auditDenied=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'audit'},viewToken);assert.notEqual(auditDenied.body?.ok,true);checks++;
  const previewViewerDenied=await evidenceCall({action:'preview-risk-evidence-import',expectedRevision:evidenceImport.body.result.revision,evidenceList:[evidence]},viewToken);assert.notEqual(previewViewerDenied.body?.ok,true);checks++;
  const latestViewerDenied=await request(p,'/api/research/adaptive-latest','GET',null,viewToken);assert.notEqual(latestViewerDenied.body?.ok,true);checks++;
  const adaptiveViewerDenied=await request(p,'/api/research/adaptive-market','POST',{},viewToken);assert.notEqual(adaptiveViewerDenied.body?.ok,true);checks++;
  const evidenceViewerDenied=await evidenceCall({action:'risk-evidence-status',query:evidenceQuery},viewToken);assert.notEqual(evidenceViewerDenied.body?.ok,true);checks++;
  const orderDenied=await request(p,'/api/research/order-account','POST',{accountId:'unified',action:'read'},viewToken);assert.notEqual(orderDenied.body?.ok,true);checks++;

  const viewerStream=await streamProbe(p,viewToken);assert.equal(viewerStream.status,200,'已批准只读设备可连接 SSE');
  const once=await request(p,'/api/lock/pending-status?req='+encodeURIComponent(requestId));assert.notEqual(once.body?.ok,true);checks++;
  const denied=await request(p,'/api/research/scan','POST',payload,viewToken);assert.notEqual(denied.body?.ok,true,'viewer cannot scan');checks++;
  const deniedDevices=await request(p,'/api/lock/devices','GET',null,viewToken);assert.notEqual(deniedDevices.body?.ok,true,'viewer cannot list devices');checks++;
  const listing=await request(p,'/api/lock/devices','GET',null,token);assert.equal(listing.body?.ok,true);checks++;
  const viewDevice=listing.body.items.find(x=>x.role==='view');assert.ok(viewDevice,'view device missing');checks++;
  const heldStream=await new Promise((resolve,reject)=>{
    const r=http.get({host:'127.0.0.1',port:p,path:'/api/stream?token='+encodeURIComponent(viewToken)},response=>{
      if(response.statusCode!==200){response.resume();reject(new Error('held SSE status '+response.statusCode));return;}
      response.on('data',()=>{});
      let settled=false;
      const closed=new Promise(done=>{response.on('end',()=>{settled=true;done(true)});response.on('close',()=>{if(!settled)done(true)});});
      resolve({closed,request:r});
    });
    r.on('error',reject);
  });
  const revoked=await request(p,'/api/lock/revoke','POST',{id:viewDevice.id},token);assert.equal(revoked.body?.revoked,1,JSON.stringify(revoked.body));checks++;
  // Never leave the 29-second watchdog timer open after an immediate revoke.
  const heldClosed=await new Promise(resolve=>{
    const watchdog=setTimeout(()=>resolve(false),29000);
    heldStream.closed.then(()=>{clearTimeout(watchdog);resolve(true);});
  });
  heldStream.request.destroy();
  assert.equal(heldClosed,true,'已建立的 SSE 应在撤权后立即关闭');checks++;

  const revokedStream=await streamProbe(p,viewToken);assert.ok(!/text\/event-stream/.test(revokedStream.contentType),'已撤销设备不可新建 SSE');
  const afterRevoke=await request(p,'/api/research/scan','POST',payload,viewToken);assert.notEqual(afterRevoke.body?.ok,true,'revoked viewer should be blocked');checks++;
  const refreshDenied=await request(p,'/api/research/history-refresh','POST',{codes:['000001']});assert.notEqual(refreshDenied.body?.ok,true,'historical refresh requires developer');checks++;
  const refreshInvalid=await request(p,'/api/research/history-refresh','POST',{codes:['bad-code']},token);assert.equal(refreshInvalid.body?.ok,false,'historical refresh rejects bad codes');checks++;
  const spoof=await request(p,'/api/research/scan','POST',{stocks:[{...payload.stocks[0],feed:{source:'eastmoney',timestamp:Date.now()}}]},token);
  assert.equal(spoof.body?.ok,false);checks++;
  const huge=await request(p,'/api/research/scan','POST',{stocks:[],padding:'x'.repeat(2*1024*1024)},token);
  assert.equal(huge.body?.ok,false);checks++;
  const disk=await request(p,'/api/research/disk-scan','POST',{},token);assert.equal(disk.body?.ok,false);checks++;
  // In cloud mode untrusted XFF must not reset the per-IP auth failure count.
  // Wrong authorization codes do not require or disclose user secrets.
  for(let i=0;i<10;i++){
    const attack=await request(p,'/api/auth/redeem','POST',{code:'000000'},'',{'X-Forwarded-For':'198.51.100.'+(i+1)});
    assert.equal(attack.body?.ok,false);checks++;
  }
  const rateLimited=await request(p,'/api/auth/redeem','POST',{code:'000000'},'',{'X-Forwarded-For':'198.51.100.251'});
  assert.match(String(rateLimited.body?.error||''),/尝试次数过多/,'XFF spoof must not bypass auth throttle');checks++;
  // Permission failure must not leave an in-memory-only revoked session. A normal
  // non-writable tmp directory emulates a failed atomic access.json commit.
  const editorId=devices.body.items.find(x=>x.role==='edit')?.id;
  assert.ok(editorId);checks++;
  const originalMode=fs.statSync(tmp).mode & 0o777;
  fs.chmodSync(tmp,0o500);
  try{
    // root can bypass chmod. The rollback is always covered by the injected
    // failure unit test; do the real HTTP disk-failure simulation where possible.
    if(process.getuid?.()!==0){
      const failure=await request(p,'/api/lock/revoke','POST',{id:editorId},token);
      assert.equal(failure.body?.ok,false,'write failure must not report a persisted revoke: '+JSON.stringify(failure.body));checks++;
      const unchanged=await request(p,'/api/lock/devices','GET',null,token);
      assert.equal(unchanged.body?.ok,true,'failed revoke should preserve valid editor session');checks++;
      assert.ok(unchanged.body.items.some(x=>x.id===editorId));checks++;
    }
  }finally{fs.chmodSync(tmp,originalMode);}
  console.log('PASS '+checks+' real HTTP checks in isolated QD_CLOUD mode');
 }finally{child.kill('SIGTERM');await delay(300);if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
