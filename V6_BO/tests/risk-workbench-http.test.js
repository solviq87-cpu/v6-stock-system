'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createFixture}=require('./helpers/v6-studio-fixture');
const day='2026-11-16',start=Date.parse(day+'T14:00:00+08:00');

function hashes(root,wholeTree=false) {
  const out={};
  function visit(dir) {
    if(!fs.existsSync(dir))return;
    for(const name of fs.readdirSync(dir).sort()) {
      const file=path.join(dir,name),stat=fs.lstatSync(file);
      if(stat.isDirectory())visit(file);
      else if(stat.isFile())out[path.relative(root,file).replaceAll(path.sep,'/')]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      else throw Error('unexpected non-file in isolated evidence directory');
    }
  }
  if(wholeTree)visit(root);
  else for(const name of ['data','durable'])visit(path.join(root,name));
  for(const name of ['paper.json','holdings.json']){
    const file=path.join(root,name);if(fs.existsSync(file))out[name]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return out;
}
const authorityHashes=root=>Object.fromEntries(Object.entries(hashes(root)).filter(([file])=>!file.startsWith('data/risk-evidence/')));

async function fixture(t) {
  const root=path.resolve(__dirname,'..'),clockRoot=fs.mkdtempSync(path.join(os.tmpdir(),'risk-http-clock-')),
    clockFile=path.join(clockRoot,'clock');
  fs.writeFileSync(clockFile,String(start));
  const original=fs.readFileSync(path.join(root,'server.js'),'utf8'),anchor="  if (p === '/api/state') {",
    plansAnchor="readPlans:()=>require('./src/server/research-workspace-job').runWorkspaceJob({action:'shortline',root:shortlineResearchDir(),book:'main',replica:isReplica()}),";
  assert.equal(original.split(anchor).length,2);
  assert.equal(original.split(plansAnchor).length,2);
  // Only drive the real runtime in a disposable copy. No test route or role
  // override is added to the production server; all transport stays denied by
  // the original studio fixture's outbound-network guard.
  const source=original.replace(anchor,`
  if(p==='/__fixture/risk-tick'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;
    return riskWorkbenchRuntime().tick().then(result=>json(res,{ok:true,result},req));
  }
  if(p==='/__fixture/risk-role'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;
    const input=JSON.parse(body);S.config.pushRole=input.replica?'replica':'primary';
    return json(res,{ok:true,replica:isReplica()},req);
  }
  if(p==='/__fixture/risk-pause'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;
    let release;const promise=new Promise(resolve=>{release=resolve;});
    S.__riskHttpPause={promise,release,entered:false};riskWorkbenchRuntime().invalidate();
    return json(res,{ok:true},req);
  }
  if(p==='/__fixture/risk-phase'){
    if(!requireEditor(res,req.__tok,req))return;
    return json(res,{ok:true,entered:S.__riskHttpPause?.entered===true},req);
  }
  if(p==='/__fixture/risk-release'&&req.method==='POST'){
    if(!requireEditor(res,req.__tok,req))return;
    const pause=S.__riskHttpPause;S.__riskHttpPause=null;pause?.release();
    return json(res,{ok:true},req);
  }
`+anchor).replace(plansAnchor,`readPlans:async()=>{
      const pause=S.__riskHttpPause;if(pause){pause.entered=true;await pause.promise;}
      return require('./src/server/research-workspace-job').runWorkspaceJob({action:'shortline',root:shortlineResearchDir(),book:'main',replica:isReplica()});
    },`);
  let f;try{f=await createFixture({count:0,serverSource:source,clockFile});}
  catch(error){fs.rmSync(clockRoot,{recursive:true,force:true});throw error;}
  t.after(async()=>{await f.close();fs.rmSync(clockRoot,{recursive:true,force:true});});
  return {...f,clockFile,clock:at=>fs.writeFileSync(clockFile,String(at)),
    tick:()=>f.request('/__fixture/risk-tick','POST',{}),
    report:(account='pool',token=f.token)=>f.request('/api/risk-workbench?account='+account,'GET',null,token)};
}

async function read(f,account='pool') {
  const response=await f.report(account);assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal(response.body.ok,true,JSON.stringify(response.body));return response.body.result;
}
async function createPendingRisk(f) {
  const before=await f.request('/api/research/order-account','POST',{action:'read',accountId:'pool'});
  assert.equal(before.body.ok,true,JSON.stringify(before.body));
  const submitted=await f.request('/api/research/order-account','POST',{action:'submit',accountId:'pool',
    order:{orderId:'isolated-pending-risk',symbol:'600000',side:'buy',quantity:1000,limitPrice:10,tradeDate:day}});
  assert.equal(submitted.body.ok,true,JSON.stringify(submitted.body));
  const configured=await f.request('/api/research/order-account','POST',{action:'configure',accountId:'pool',
    configuration:{expectedRevision:submitted.body.result.revision,riskPolicy:{version:'isolated-installed-risk-v1',maxPositionPct:5,maxGrossExposurePct:40}}});
  assert.equal(configured.body.ok,true,JSON.stringify(configured.body));
  return configured.body.result;
}

test('real risk HTTP reads are editor-only, no-store, scoped to original accounts and do not write evidence or ledgers',{timeout:45000},async t=>{
  const f=await fixture(t),before=hashes(f.tmp);
  for(const token of ['',f.viewerToken]){
    const denied=await f.report('pool',token);assert.notEqual(denied.body?.ok,true);
    assert.equal(denied.body?.result,undefined);
    const write=await f.request('/api/risk-workbench/alerts','POST',{action:'view',accountId:'pool'},token);
    assert.notEqual(write.body?.ok,true);assert.equal(write.body?.result,undefined);
  }
  const response=await f.report(),pool=response.body.result;assert.equal(response.status,200,JSON.stringify(response.body));
  assert.match(response.headers['cache-control'],/no-store/);assert.equal(pool.readOnly,true);assert.equal(pool.canTrade,false);
  assert.equal(pool.account.id,'pool');assert.equal(pool.equity.cash,100000);
  assert.equal(pool.rules.policyConfigured,false);assert.ok(pool.rules.rules.every(rule=>rule.configurationStatus==='not-configured'));
  assert.equal(pool.rules.automaticRules.parameters.maxPos,5);
  const pre=await read(f,'pre');assert.equal(pre.account.id,'pre');assert.equal(pre.equity.cash,500000);
  assert.notEqual(pre.accountEpoch,pool.accountEpoch);assert.equal(pre.rules.automaticRules.parameters.maxPos,8);
  assert.equal((await f.request('/api/risk-workbench?account=other')).status,400);
  assert.equal((await f.request('/api/risk-workbench?code=../../etc/passwd')).status,400);
  assert.equal((await f.request('/api/risk-workbench','POST',{})).status,405);
  assert.equal((await f.request('/api/risk-workbench/alerts')).status,405);
  assert.deepEqual(hashes(f.tmp),before,'GET and denied operations cannot create or alter derived evidence or authority');
  assert.equal(fs.existsSync(path.join(f.tmp,'data/risk-evidence')),false);
});

test('real runtime tick writes only account-separated derived evidence and repeated reads or ticks do not trade',{timeout:45000},async t=>{
  const f=await fixture(t);await createPendingRisk(f);
  const before=hashes(f.tmp),authority=authorityHashes(f.tmp),tick=await f.tick();
  assert.equal(tick.body.ok,true);assert.equal(tick.body.result.lastError,null,JSON.stringify(tick.body));
  assert.deepEqual(authorityHashes(f.tmp),authority);
  const after=hashes(f.tmp),newPaths=Object.keys(after).filter(file=>!Object.hasOwn(before,file));
  assert.ok(newPaths.some(file=>file.startsWith('data/risk-evidence/equity/pool/')));
  assert.ok(newPaths.some(file=>file.startsWith('data/risk-evidence/equity/pre/')));
  assert.ok(newPaths.every(file=>file.startsWith('data/risk-evidence/')));
  const pool=await read(f),pre=await read(f,'pre');
  assert.equal(pool.rules.occupancy.pendingBuyValue,10000);assert.equal(pre.rules.occupancy.pendingBuyValue,0);
  const exposure=pool.rules.rules.find(rule=>rule.id==='maxPositionPct');assert.equal(exposure.enabled,true);
  assert.equal(exposure.exceeded,true);assert.equal(exposure.used,10);assert.equal(exposure.limit,5);
  assert.equal(pool.alerts.accountId,'pool');assert.equal(pre.alerts.accountId,'pre');
  assert.ok(pool.alerts.groups.some(group=>group.rootCauseId==='rule/maxPositionPct'&&group.severity==='critical'));
  assert.ok(!pre.alerts.groups.some(group=>group.rootCauseId==='rule/maxPositionPct'&&group.severity==='critical'));
  assert.equal(pool.runtime.privateChannel,'unconfigured');
  assert.ok(pool.alerts.groups.every(group=>group.notification.status==='not-queued'));
  const observed=hashes(f.tmp);await read(f);await read(f,'pre');assert.deepEqual(hashes(f.tmp),observed);
  await f.tick();
  const repeated=await read(f);
  assert.equal(repeated.equityHistory.observations.length,pool.equityHistory.observations.length,'a repeated same-clock tick cannot invent another equity observation');
  assert.deepEqual(repeated.alerts.groups.map(group=>group.events.map(event=>event.id)),pool.alerts.groups.map(group=>group.events.map(event=>event.id)),
    'repeated observations preserve lifecycle event identities without duplicate incidents');
  assert.deepEqual(authorityHashes(f.tmp),authority);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.tmp,'data/order-accounts/pool.json'))).account.events.length,0);
});

test('view and mute update notification state only while station risks, limits and original pending orders remain',{timeout:45000},async t=>{
  const f=await fixture(t);await createPendingRisk(f);await f.tick();const initial=await read(f),authority=authorityHashes(f.tmp);
  const target='rule/maxPositionPct',group=initial.alerts.groups.find(group=>group.rootCauseId===target);assert.ok(group);
  const viewed=await f.request('/api/risk-workbench/alerts','POST',{action:'view',accountId:'pool',accountEpoch:initial.accountEpoch,
    expectedRevision:initial.alerts.revision,rootCauseId:target});
  assert.equal(viewed.status,200,JSON.stringify(viewed.body));assert.equal(viewed.body.ok,true);
  assert.equal(viewed.body.result.groups.find(row=>row.rootCauseId===target).viewed,true);
  const muted=await f.request('/api/risk-workbench/alerts','POST',{action:'mute',accountId:'pool',accountEpoch:initial.accountEpoch,
    expectedRevision:viewed.body.result.revision,rootCauseId:target,mutedUntil:start+600000});
  assert.equal(muted.status,200,JSON.stringify(muted.body));assert.equal(muted.body.ok,true);
  const after=await read(f),changed=after.alerts.groups.find(row=>row.rootCauseId===target);
  assert.equal(changed.muted,true);assert.equal(changed.notificationOnlyMute,true);assert.equal(changed.stationVisible,true);
  assert.equal(changed.restrictionsStillApply,true);assert.equal(changed.notification.receiverConfirmed,false);
  assert.ok(after.risks.some(risk=>risk.rootCauseId===target&&risk.status==='active'));
  assert.deepEqual(after.rules,initial.rules);assert.deepEqual(authorityHashes(f.tmp),authority);
  const secondLogin=await f.request('/api/lock/unlock','POST',{role:'edit',password:f.password,fp:'risk-other-editor',name:'isolated second viewer'},'');
  assert.equal(secondLogin.body.ok,true);
  const other=await f.report('pool',secondLogin.body.token);
  assert.equal(other.body.result.alerts.groups.find(row=>row.rootCauseId===target).viewed,false,'view acknowledgement belongs to the original authorized device');
});

test('forged receipt, arbitrary mutations, invalid bodies, stale revisions and cross-account epochs are rejected without writes',{timeout:45000},async t=>{
  const f=await fixture(t);await f.tick();const pool=await read(f),pre=await read(f,'pre'),before=hashes(f.tmp);
  const base={accountId:'pool',accountEpoch:pool.accountEpoch,expectedRevision:pool.alerts.revision,rootCauseId:pool.alerts.groups[0].rootCauseId};
  for(const input of [null,true,42,'arbitrary',[],{...base,action:'receiver-confirmed'},{...base,action:'view',receiverReceipt:{confirmed:true}},
    {...base,action:'trade'},{...base,action:'view',price:1},{...base,action:'mute',mutedUntil:-1},
    {...base,action:'view',accountEpoch:pre.accountEpoch},{...base,action:'view',expectedRevision:pool.alerts.revision+10}]){
    const response=await f.request('/api/risk-workbench/alerts','POST',input);
    assert.notEqual(response.body?.ok,true,JSON.stringify({input,response:response.body}));
    assert.ok([400,409].includes(response.status),String(response.status));
  }
  assert.deepEqual(hashes(f.tmp),before);
});

test('original reset starts a new risk epoch and rejects prior view or mute operations without changing either historical evidence or new ledger',{timeout:45000},async t=>{
  const f=await fixture(t);await createPendingRisk(f);await f.tick();const original=await read(f),riskRoot=path.join(f.tmp,'data/risk-evidence');
  const oldEvidence=Object.fromEntries(Object.entries(hashes(riskRoot,true)).filter(([file])=>{
    if(file.startsWith('equity/pool/'+original.accountEpoch+'/'))return true;
    if(!/^notifications\/risk-alerts-[a-f0-9]{64}\.json$/.test(file))return false;
    const record=JSON.parse(fs.readFileSync(path.join(riskRoot,file)));
    return record.accountId==='pool'&&record.accountEpoch===original.accountEpoch;
  }));
  assert.ok(Object.keys(oldEvidence).length>=2,'original pool epoch has both equity and notification evidence');
  const reset=await f.request('/api/paper','POST',{action:'reset',account:'pool'});assert.equal(reset.body.ok,true,JSON.stringify(reset.body));
  const updated=await read(f);assert.notEqual(updated.accountEpoch,original.accountEpoch);
  assert.equal(updated.alerts.groups.length,0);assert.equal(updated.rules.occupancy.pendingBuyValue,0);
  const afterReset=hashes(f.tmp);
  const denied=await f.request('/api/risk-workbench/alerts','POST',{action:'view',accountId:'pool',accountEpoch:original.accountEpoch,
    rootCauseId:original.alerts.groups[0].rootCauseId,expectedRevision:original.alerts.revision});
  assert.equal(denied.status,409);assert.equal(denied.body.ok,false);assert.deepEqual(hashes(f.tmp),afterReset);
  await f.tick();assert.deepEqual(authorityHashes(f.tmp),Object.fromEntries(Object.entries(afterReset).filter(([file])=>!file.startsWith('data/risk-evidence/'))));
  const paths=Object.keys(hashes(f.tmp));assert.ok(paths.some(file=>file.includes('/'+original.accountEpoch+'/')));
  assert.ok(paths.some(file=>file.includes('/'+updated.accountEpoch+'/')));
  const retained=hashes(path.join(f.tmp,'data/risk-evidence'),true);
  for(const [file,fingerprint] of Object.entries(oldEvidence))assert.equal(retained[file],fingerprint,'reset must retain old derived evidence: '+file);
});

test('replica serves explicit unknown authority evidence and cannot mutate reminder state or derived samples',{timeout:45000},async t=>{
  const f=await fixture(t);await f.tick();const primary=await read(f);
  const role=await f.request('/__fixture/risk-role','POST',{replica:true});assert.equal(role.body.replica,true);
  const before=hashes(f.tmp),replica=await read(f);
  assert.equal(replica.instance.role,'replica');assert.equal(replica.accountEpoch,null);assert.equal(replica.equity,null);
  assert.equal(replica.rules.policyConfigured,null);assert.ok(replica.risks.some(risk=>risk.evidenceStatus==='missing'||risk.evidenceStatus==='unknown'));
  const denied=await f.request('/api/risk-workbench/alerts','POST',{action:'view',accountId:'pool',accountEpoch:primary.accountEpoch,
    expectedRevision:primary.alerts.revision,rootCauseId:primary.alerts.groups[0].rootCauseId});
  assert.equal(denied.status,403);assert.equal(denied.body.readOnly,true);
  await f.tick();assert.deepEqual(hashes(f.tmp),before);
});

for(const method of ['GET','POST'])test('in-flight device revocation blocks '+method+' risk evidence or notification changes after original async archive read',{timeout:45000},async t=>{
  const f=await fixture(t);await createPendingRisk(f);await f.tick();const initial=await read(f);
  const devices=await f.request('/api/lock/devices'),originalDevice=devices.body.items.find(row=>row.role==='edit');assert.ok(originalDevice);
  const login=await f.request('/api/lock/unlock','POST',{role:'edit',password:f.password,fp:'risk-revoke-controller',name:'risk revoke controller'},'');
  assert.equal(login.body.ok,true);const controller=login.body.token;
  const before=hashes(f.tmp);
  const paused=await f.request('/__fixture/risk-pause','POST',{},controller);assert.equal(paused.body.ok,true);
  const pending=method==='GET'?f.report():f.request('/api/risk-workbench/alerts','POST',{
    action:'view',accountId:'pool',accountEpoch:initial.accountEpoch,expectedRevision:initial.alerts.revision,rootCauseId:'rule/maxPositionPct'});
  try{
    let entered=false;
    for(let i=0;i<100;i++){
      const phase=await f.request('/__fixture/risk-phase','GET',null,controller);
      if(phase.body.entered){entered=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(entered,true,'real runtime must await the original archive before revocation');
    const revoked=await f.request('/api/lock/revoke','POST',{id:originalDevice.id},controller);
    assert.equal(revoked.body.ok,true,JSON.stringify(revoked.body));
  }finally{await f.request('/__fixture/risk-release','POST',{},controller);}
  const response=await pending;
  assert.equal(response.body.ok,false,JSON.stringify(response.body));assert.equal(response.body.result,undefined);
  assert.equal(response.status,method==='GET'?403:409);
  assert.deepEqual(hashes(f.tmp),before,'revoked in-flight request must not write any original or derived state');
  const fresh=await f.report('pool',controller);assert.equal(fresh.status,200);
  assert.equal(fresh.body.result.alerts.groups.find(row=>row.rootCauseId==='rule/maxPositionPct').viewed,false);
  assert.notEqual((await f.report()).body?.ok,true,'original device remains revoked');
});
