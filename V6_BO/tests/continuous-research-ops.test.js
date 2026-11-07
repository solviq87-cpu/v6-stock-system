'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {makeOperations,createResearchOpsServer}=require('../src/core/continuous-research-ops');
const {parse}=require('../scripts/continuous-research');
const days=Array.from({length:41},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const history={source:'fixture',asOf:days.at(-1),splitDay:34,stocks:[{code:'000001',bars:days.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
function setup(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v6-ops-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const historyPath=path.join(folder,'history.json');fs.writeFileSync(historyPath,JSON.stringify(history));return {folder,historyPath,outputRoot:path.join(folder,'runs')};}
function request(port,pathname,token){return new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:pathname,headers:token?{Authorization:'Bearer '+token}:{}},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve({status:r.statusCode,body,headers:r.headers}));});req.on('error',reject);});}
test('持续研究单次运行生成完整可重放档案，重复数据不覆盖',t=>{
 const f=setup(t),ops=makeOperations(f);const first=ops.runOnce();
 assert.equal(first.updated,true);assert.equal(first.summary.replayed,true);assert.equal(first.summary.gate.eligible,false);
 assert.equal(ops.runOnce().reason,'unchanged');assert.equal(ops.status().successfulRuns,1);
 assert.ok(fs.existsSync(path.join(f.outputRoot,first.summary.runId,'report.json')));
 const status=JSON.parse(fs.readFileSync(path.join(f.outputRoot,'operations-status.json')));
 assert.equal(status.canTrade,false);assert.equal(status.lastSummary.runId,first.summary.runId);
});
test('进程重启使用已归档且可复放的旧运行，不覆盖旧结果',t=>{
 const f=setup(t),first=makeOperations(f).runOnce();const ops=makeOperations(f);
 assert.equal(ops.status().lastSummary.runId,first.summary.runId);
 const run=ops.runOnce();assert.equal(run.reused,true);assert.equal(run.updated,false);
});
test('输入错误时拒绝生成新档案，保留最后一次成功报告',t=>{
 const f=setup(t),ops=makeOperations(f),first=ops.runOnce();
 fs.writeFileSync(f.historyPath,'{');const fail=ops.runOnce();
 assert.ok(fail.error);assert.equal(ops.status().lastSummary.runId,first.summary.runId);
 assert.equal(fs.readdirSync(f.outputRoot).filter(x=>/^[0-9a-f]{24}$/.test(x)).length,1);
});
test('篡改状态文件不能伪造四策略绩效，恢复必须重验运行档案',t=>{
 const f=setup(t),ops=makeOperations(f),first=ops.runOnce();const statusFile=path.join(f.outputRoot,'operations-status.json');
 const json=JSON.parse(fs.readFileSync(statusFile));json.lastSummary.independentPortfolios.fourteen.returnPct=999999;
 fs.writeFileSync(statusFile,JSON.stringify(json));const restarted=makeOperations(f);
 assert.notEqual(restarted.status().lastSummary.independentPortfolios.fourteen.returnPct,999999);
 assert.equal(restarted.status().lastSummary.runId,first.summary.runId);
});
test('输入软链接和非法轮询间隔在运行前被拒绝',t=>{
 const f=setup(t),link=path.join(f.folder,'link.json');fs.symlinkSync(f.historyPath,link);
 assert.throws(()=>makeOperations({...f,historyPath:link}),/符号链接/);
 assert.throws(()=>makeOperations({...f,pollMs:10}),/间隔/);
});
test('本地双端研究界面只读、鉴权、禁缓存，报告与健康接口一致',async t=>{
 const f=setup(t),ops=makeOperations(f),token='x'.repeat(40);
 const srv=createResearchOpsServer({operations:ops,token});const addr=await srv.listen();
 t.after(async()=>{await srv.close();});
 const home=await request(addr.port,'/');assert.equal(home.status,200);assert.match(home.body,/viewport/);
 const blocked=await request(addr.port,'/api/ops/latest');assert.equal(blocked.status,401);
 const okay=await request(addr.port,'/api/ops/latest',token);assert.equal(okay.status,200);
 const latest=JSON.parse(okay.body);assert.equal(latest.data.replayed,true);assert.equal(latest.data.gate.eligible,false);
 const health=await request(addr.port,'/api/ops/health',token);assert.equal(JSON.parse(health.body).canTrade,false);
 assert.equal((await request(addr.port,'/api/ops/latest',token)).headers['cache-control'],'no-store');
});
test('命令行参数拒绝无效选项和 Python 证据混用',()=>{
 assert.equal(parse(['/tmp/h','/tmp/out','--once']).once,true);
 assert.throws(()=>parse(['/tmp/h','/tmp/out','--random','z']),/未知/);
 assert.throws(()=>parse(['/tmp/h','/tmp/out','--evidence','/tmp/e','--python-script','/tmp/p']),/混用/);
});
test('更新同一份历史时启动新的不可变运行归档，并保留旧运行可重放',t=>{
 const f=setup(t),ops=makeOperations(f),a=ops.runOnce();
 const next=JSON.parse(fs.readFileSync(f.historyPath));next.stocks[0].bars[40].open+=.01;
 next.stocks[0].bars[40].high+=.01;next.stocks[0].bars[40].low+=.01;next.stocks[0].bars[40].close+=.01;
 fs.writeFileSync(f.historyPath,JSON.stringify(next));const b=ops.runOnce();
 assert.equal(b.updated,true);assert.notEqual(a.summary.runId,b.summary.runId);
 const {verifyBundle}=require('../src/core/integrated-run-bundle');
 assert.equal(verifyBundle(path.join(f.outputRoot,a.summary.runId),{replay:true}).replayed,true);
 assert.equal(verifyBundle(path.join(f.outputRoot,b.summary.runId),{replay:true}).replayed,true);
});
