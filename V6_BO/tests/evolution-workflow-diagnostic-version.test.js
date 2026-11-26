'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {diagnosticImplementationFingerprint:fingerprint,diagnosticImplementationManifest:manifest,SEEDS}=require('../src/core/evolution-diagnostic-version');
function sources(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'evolution-diagnostic-source-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(relative,content)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);};
 for(const relative of SEEDS)write(relative,relative.endsWith('.json')?'{}':'// source fixture '+relative+'\n');
 return {root,write};
}
test('diagnostic identity includes the actual native models, indicators, risk, fee and ledger source closure',()=>{
 const m=manifest(),files=new Set(m.files.map(f=>f.path));
 for(const required of ['src/core/evolution-research-statistics.js','src/core/research-causal-diagnostics.js','src/core/native-strategy-daily-runner.js','src/core/python-three-round-evidence.js','myrules.js','bazi.js','src/core/multi-strategy-engine.js','src/core/strategy-engine.js','src/strategy/historical-indicators.js','src/core/trading-fees.js','src/core/execution-risk.js','src/core/portfolio-risk-gate.js','src/core/common-entry-risk.js','src/core/corporate-settlements.js','src/core/historical-universe.js','src/strategy/research-v2-position-ledger-backtest.js','strategies/a-share-strategy-pack.json','package-lock.json'])assert.ok(files.has(required),required);
 assert.equal(files.size,m.files.length);assert.equal(m.runtime.node,process.versions.node);assert.match(m.fingerprint,/^[a-f0-9]{64}$/);assert.ok(m.files.every(f=>!path.isAbsolute(f.path)&&!f.path.startsWith('data/')));
});
test('transitive implementation and rule/fee changes invalidate persisted diagnostic identity without executing code',t=>{
 const {root,write}=sources(t);
 write('src/core/evolution-research-statistics.js',"require('../strategy/version-child.mjs'); throw Error('this source must never execute');\n");
 write('src/strategy/version-child.mjs',"import { fee } from '../core/trading-fees.js'; export { x } from './version-grandchild.js';\n");
 write('src/strategy/version-grandchild.js','export const x=1;\n');
 const first=fingerprint({root});assert.equal(fingerprint({root}),first);assert.ok(manifest({root}).files.some(f=>f.path==='src/strategy/version-grandchild.js'));
 write('src/strategy/version-grandchild.js','export const x=2;\n');const child=fingerprint({root});assert.notEqual(child,first);
 write('src/core/trading-fees.js','// fee rounding changed\n');const fee=fingerprint({root});assert.notEqual(fee,child);
 write('strategies/a-share-strategy-pack.json','{"weight":2}');const parameters=fingerprint({root});assert.notEqual(parameters,fee);
 write('package-lock.json','{"runtimeDependencyVersion":2}');assert.notEqual(fingerprint({root}),parameters);
});
test('unrelated user data cannot affect a diagnostic code identity and missing files fail closed',t=>{
 const {root,write}=sources(t),first=fingerprint({root});write('data/private-research.json','{"notSource":true}');write('access.json','private fixture');assert.equal(fingerprint({root}),first);
 fs.unlinkSync(path.join(root,'src/core/common-entry-risk.js'));assert.throws(()=>fingerprint({root}),e=>e.code==='DIAGNOSTIC_IMPLEMENTATION_UNAVAILABLE'&&!e.message.includes(root));
 assert.throws(()=>fingerprint({root:'relative'}),/版本不可核验/);
});
test('source links, private imports, and excessive files cannot create a reusable version',t=>{
 const {root,write}=sources(t),target=path.join(root,'private.json');fs.writeFileSync(target,'private fixture');
 fs.unlinkSync(path.join(root,'src/core/trading-fees.js'));fs.symlinkSync(target,path.join(root,'src/core/trading-fees.js'));assert.throws(()=>fingerprint({root}),/不可核验/);
 fs.unlinkSync(path.join(root,'src/core/trading-fees.js'));write('src/core/trading-fees.js','// restored source');
 write('src/core/evolution-research-statistics.js',"require('../../data/private-research.json');");write('data/private-research.json','{}');assert.throws(()=>fingerprint({root}),/不可核验/);
 write('src/core/evolution-research-statistics.js','// restored source');write('src/core/trading-fees.js',Buffer.alloc(8*1024*1024+1));assert.throws(()=>fingerprint({root}),/不可核验/);
});
