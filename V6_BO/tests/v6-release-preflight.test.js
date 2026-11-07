'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runPreflight,parse}=require('../scripts/v6-release-preflight');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:33,stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
test('统一上线门禁对 11 大工程逐项核验源码，但绝不自行签署生产完成',()=>{
 const r=runPreflight();assert.equal(r.workstreams.length,11);assert.equal(r.workstreamsWithCodeEvidence,11);assert.equal(r.codeChecksPassed,true);assert.equal(r.productionReady,false);assert.ok(r.workstreams.every(x=>x.productionAccepted===false&&x.externalBlocker));
});
test('离线实际运行与确定性重放可加入统一预检，但不会提升实盘资格',t=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'v6-preflight-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
 const historyPath=path.join(d,'history.json');fs.writeFileSync(historyPath,JSON.stringify(history));
 const r=runPreflight({historyPath,outputRoot:path.join(d,'runs')});
 assert.equal(r.offlineRuntime.verified,true);assert.equal(r.offlineRuntime.archiveReplay,true);assert.equal(r.productionReady,false);
});
test('预检命令行拒绝重复参数与缺少必要文件位置',()=>{
 assert.equal(parse(['--strict'])['--strict'],true);
 assert.throws(()=>parse(['--history']),/未知或缺失/);
 assert.throws(()=>parse(['--out','/tmp/a','--out','/tmp/b']),/未知或缺失/);
});
