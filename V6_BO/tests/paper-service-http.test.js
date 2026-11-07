'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPaperService}=require('../src/core/paper-service');
const {buildSession,saveSession}=require('../src/core/paper-session');
function fixture(){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'研究样本',market:'main',bars:Array.from({length:65},(_,i)=>{const p=10+i*.08;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.25,low:p-.2,close:p+.1,volume:100000};})}]};}
async function setup(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-http-paper-')),file=path.join(dir,'account.json');saveSession(file,buildSession(fixture()).session);const token='test-token-at-least-24-characters';const svc=createPaperService({accountFile:file,token});const addr=await svc.listen();try{await fn({file,token,base:`http://127.0.0.1:${addr.port}`});}finally{await new Promise(r=>svc.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}}
test('HTTP account status and full report are available only with bearer token',async()=>setup(async({base,token})=>{const no=await fetch(base+'/api/paper/report');assert.equal(no.status,401);const headers={Authorization:`Bearer ${token}`};const status=await fetch(base+'/api/paper/status',{headers});assert.equal(status.status,200);const s=(await status.json()).data;assert.equal(s.canTrade,false);const report=await fetch(base+'/api/paper/report',{headers});const r=(await report.json()).data;assert.ok(Array.isArray(r.equity));assert.equal(r.account.revision,1);assert.equal(report.headers.get('cache-control'),'no-store');}));
test('HTTP refuses mutations and unknown routes',async()=>setup(async({base,token})=>{const headers={Authorization:`Bearer ${token}`};assert.equal((await fetch(base+'/api/paper/status',{method:'POST',headers})).status,405);assert.equal((await fetch(base+'/api/paper/trade',{headers})).status,404);}));
test('HTTP detects tampered account on every request',async()=>setup(async({base,token,file})=>{const s=JSON.parse(fs.readFileSync(file));s.report.metrics.finalEquity=999999;fs.writeFileSync(file,JSON.stringify(s));const r=await fetch(base+'/api/paper/report',{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,503);assert.ok(!(await r.text()).includes('999999'));}));
test('HTTP service rejects public bind and short tokens',()=>{assert.throws(()=>createPaperService({accountFile:'a',token:'short'}),/令牌/);assert.throws(()=>createPaperService({accountFile:'a',token:'x'.repeat(32),host:'0.0.0.0'}),/回环/);});
test('HTTP independent audit recomputes account and reports tampering without mutation',async()=>setup(async({base,token,file})=>{
 const headers={Authorization:`Bearer ${token}`};
 const before=fs.readFileSync(file);
 const good=await fetch(base+'/api/paper/audit',{headers});
 assert.equal(good.status,200);assert.equal((await good.json()).data.ok,true);
 assert.deepEqual(fs.readFileSync(file),before);
 const tampered=JSON.parse(before);tampered.report.metrics.finalEquity=999999;
 fs.writeFileSync(file,JSON.stringify(tampered));
 const bad=await fetch(base+'/api/paper/audit',{headers});
 assert.equal(bad.status,503);assert.equal((await bad.json()).data.ok,false);
 assert.equal((await fetch(base+'/api/paper/audit')).status,401);
}));
