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
