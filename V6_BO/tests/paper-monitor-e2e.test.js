'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPaperMonitor}=require('../src/core/paper-monitor');
function fixture(count=65){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'研究样本',market:'main',bars:Array.from({length:count},(_,i)=>{const p=10+i*.08;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.25,low:p-.2,close:p+.1,volume:100000};})}]};}
async function withMonitor(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-monitor-')),inputFile=path.join(dir,'input.json'),accountFile=path.join(dir,'account.json');fs.writeFileSync(inputFile,JSON.stringify(fixture()));const token='test-token-at-least-24-characters';const svc=createPaperMonitor({inputFile,accountFile,token,pollMs:1000});const addr=await svc.listen();try{await fn({svc,inputFile,accountFile,token,base:`http://127.0.0.1:${addr.port}`});}finally{await svc.close();fs.rmSync(dir,{recursive:true,force:true});}}
test('desktop and mobile responsive monitor loads same-origin read-only account',()=>withMonitor(async({base,token})=>{const html=await fetch(base+'/');assert.equal(html.status,200);const content=await html.text();assert.match(content,/@media\(max-width:680px\)/);assert.match(content,/viewport-fit=cover/);assert.match(content,/api\/paper\/report/);assert.equal((await fetch(base+'/api/paper/report')).status,401);const r=await fetch(base+'/api/paper/report',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);assert.equal((await r.json()).data.account.revision,1);assert.equal((await fetch(base+'/api/paper/trade',{headers:{Authorization:'Bearer '+token}})).status,404);}));
test('new bars persist once and unchanged polls do not repeat account revision',()=>withMonitor(async({svc,inputFile,base,token})=>{fs.writeFileSync(inputFile,JSON.stringify(fixture(67)));assert.equal(svc.update().revision,2);assert.equal(svc.update().updated,false);const r=await fetch(base+'/api/paper/status',{headers:{Authorization:'Bearer '+token}});assert.equal((await r.json()).data.revision,2);}));
test('corrupt or rewritten market input does not overwrite the last valid account',()=>withMonitor(async({svc,inputFile,base,token})=>{const edited=fixture(67);edited.stocks[0].bars[0].close=999;fs.writeFileSync(inputFile,JSON.stringify(edited));assert.ok(svc.update().error);fs.writeFileSync(inputFile,'{bad');assert.ok(svc.update().error);const headers={Authorization:'Bearer '+token};const status=await fetch(base+'/api/paper/status',{headers});assert.equal((await status.json()).data.revision,1);const health=await fetch(base+'/api/paper/health',{headers});assert.equal((await health.json()).verifiedLive,false);}));
test('monitor cannot bind publicly or accept short token',()=>{assert.throws(()=>createPaperMonitor({accountFile:'a',inputFile:'b',token:'x'}),/令牌/);assert.throws(()=>createPaperMonitor({accountFile:'a',inputFile:'b',token:'x'.repeat(32),host:'0.0.0.0'}),/本机/);});

test('local private holding watch is authenticated, read-only and does not change paper account',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-holding-monitor-'));
 const inputFile=path.join(dir,'market.json'),accountFile=path.join(dir,'paper.json'),
  holdingWatchFile=path.join(dir,'user-holdings-private.json');
 fs.writeFileSync(inputFile,JSON.stringify(fixture()));
 const now=Date.now(),token='test-token-at-least-24-characters';
 const holding=()=>({schemaVersion:1,mode:'manual-holding-watch',
  positions:[{symbol:'600001',cost:10,shares:100,weightPct:31}],
  quotes:[{symbol:'600001',price:8.9,quoteAt:Date.now()-1000,quoteSource:'tencent'}]});
 fs.writeFileSync(holdingWatchFile,JSON.stringify(holding()),{mode:0o600});
 const svc=createPaperMonitor({inputFile,accountFile,holdingWatchFile,token,pollMs:1000});
 const addr=await svc.listen(),base='http://127.0.0.1:'+addr.port;
 try{
  const page=await (await fetch(base+'/')).text();
  assert.match(page,/自选持仓风险观察/);
  assert.match(page,/holdingRiskRows/);
  assert.equal((await fetch(base+'/api/paper/holding-risks')).status,401);
  assert.equal((await fetch(base+'/api/paper/holding-risks',{method:'POST',
   headers:{Authorization:'Bearer '+token}})).status,405);
  const before=fs.readFileSync(accountFile,'utf8');
  const headers={Authorization:'Bearer '+token};
  const response=await fetch(base+'/api/paper/holding-risks',{headers});
  assert.equal(response.status,200);
  const r=(await response.json()).data;
  assert.equal(r.status,'evaluated');
  assert.equal(r.positions[0].drawdownFromCostPct,-11);
  assert.ok(r.alerts.some(a=>a.code==='loss-warning'));
  assert.ok(r.alerts.some(a=>a.code==='weight-warning'));
  assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
  assert.equal(fs.readFileSync(accountFile,'utf8'),before,
   'private manual holdings risk cannot alter authoritative simulation');
  fs.writeFileSync(holdingWatchFile,'{bad');
  const stale=(await (await fetch(base+'/api/paper/holding-risks',{headers})).json()).data;
  assert.equal(stale.status,'unavailable');
  assert.deepEqual(stale.alerts,[]);
  assert.deepEqual(stale.positions,[]);
  assert.equal(fs.readFileSync(accountFile,'utf8'),before);
  assert.equal((await (await fetch(base+'/api/paper/report',{headers})).json()).ok,true);
 }finally{await svc.close();fs.rmSync(dir,{recursive:true,force:true});}
});
