'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {makeBundle,verifyBundle}=require('../src/core/integrated-run-bundle');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:32,stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-bundle-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const input=path.join(dir,'history.json');fs.writeFileSync(input,JSON.stringify(history));return {dir,input,output:path.join(dir,'runs')};}
test('统一研究运行生成不可变报告、四种输入和可核验清单',t=>{const f=fixture(t),r=makeBundle({historyPath:f.input,outputRoot:f.output});assert.equal(r.gate.eligible,false);assert.equal(verifyBundle(r.directory).verified,true);assert.equal(JSON.parse(fs.readFileSync(path.join(r.directory,'report.json'))).canTrade,false);assert.throws(()=>makeBundle({historyPath:f.input,outputRoot:f.output}),/禁止覆盖/);});
test('报告或原始历史数据被修改后验证失败',t=>{const f=fixture(t),r=makeBundle({historyPath:f.input,outputRoot:f.output});fs.appendFileSync(path.join(r.directory,'report.json'),' ');assert.throws(()=>verifyBundle(r.directory),/校验失败/);});
test('运行前拒绝非法证据，不产生报告目录',t=>{const f=fixture(t),e=path.join(f.dir,'e.json');fs.writeFileSync(e,JSON.stringify({'999999/2025-01-10':{symbol:'999999'}}));assert.throws(()=>makeBundle({historyPath:f.input,evidencePath:e,outputRoot:f.output}));assert.equal(fs.existsSync(f.output),false);});
test('原生 Python 与外部证据不能混用',t=>{const f=fixture(t);assert.throws(()=>makeBundle({historyPath:f.input,evidencePath:f.input,pythonScript:f.input,outputRoot:f.output}),/不可混用/);});
test('输出目录的符号链接父目录会被拒绝',t=>{const f=fixture(t),link=path.join(f.dir,'link');fs.symlinkSync(f.dir,link,'dir');assert.throws(()=>makeBundle({historyPath:f.input,outputRoot:path.join(link,'runs')}),/符号链接/);});
test('运行标识不能通过修改清单伪造',t=>{const f=fixture(t),r=makeBundle({historyPath:f.input,outputRoot:f.output});const p=path.join(r.directory,'manifest.json'),m=JSON.parse(fs.readFileSync(p));m.runId='0'.repeat(24);fs.writeFileSync(p,JSON.stringify(m));assert.throws(()=>verifyBundle(r.directory),/运行标识不匹配/);});

test('归档输入可确定性重放并核对完整业务报告',t=>{const f=fixture(t),r=makeBundle({historyPath:f.input,outputRoot:f.output});assert.equal(verifyBundle(r.directory,{replay:true}).replayed,true);});
test('即使攻击者重算报告哈希和运行标识，重放仍能识别伪造的绩效',t=>{const f=fixture(t),r=makeBundle({historyPath:f.input,outputRoot:f.output});const crypto=require('node:crypto');const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const manifestPath=path.join(r.directory,'manifest.json'),m=JSON.parse(fs.readFileSync(manifestPath));const reportPath=path.join(r.directory,'report.json');const report=JSON.parse(fs.readFileSync(reportPath));report.warnings.push('伪造的结论');const data=JSON.stringify(report,null,2)+'\n';fs.writeFileSync(reportPath,data);m.files['report.json']={sha256:sha(data),bytes:Buffer.byteLength(data)};const id=sha(JSON.stringify({schemaVersion:1,inputs:m.files,pythonScriptSha256:null},null,2)+'\n').slice(0,24);m.runId=id;fs.writeFileSync(manifestPath,JSON.stringify(m));const renamed=path.join(f.output,id);fs.renameSync(r.directory,renamed);assert.equal(verifyBundle(renamed).verified,true);assert.throws(()=>verifyBundle(renamed,{replay:true}),/无法从已归档输入确定性重放/);});
test('CLI 支持显式 --replay 且拒绝无效验证参数',()=>{const {parse}=require('../scripts/integrated-run-bundle');assert.equal(parse(['verify','/tmp/a','--replay']).replay,true);assert.throws(()=>parse(['verify','/tmp/a','--unknown']),/用法/);});


test('研究输入文件的符号链接父目录被拒绝，不能绕过归档来源路径检查',t=>{
 const f=fixture(t),link=path.join(f.dir,'input-link');fs.symlinkSync(f.dir,link,'dir');
 assert.throws(()=>makeBundle({historyPath:path.join(link,'history.json'),outputRoot:f.output}),/符号链接/);
 assert.equal(fs.existsSync(f.output),false);
});

test('归档清单经符号链接替换时验证失败',t=>{
 const f=fixture(t),r=makeBundle({historyPath:f.input,outputRoot:f.output});
 const m=path.join(r.directory,'manifest.json'),copy=path.join(f.dir,'manifest-copy.json');
 fs.copyFileSync(m,copy);fs.unlinkSync(m);fs.symlinkSync(copy,m);
 assert.throws(()=>verifyBundle(r.directory),/符号链接/);
});
