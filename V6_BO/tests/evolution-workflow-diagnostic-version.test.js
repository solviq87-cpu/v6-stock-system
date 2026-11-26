'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {diagnosticImplementationFingerprint:fingerprint,diagnosticImplementationManifest:manifest,assertDiagnosticImplementationFingerprint:assertFingerprint,SEEDS}=require('../src/core/evolution-diagnostic-version');
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

const unavailable=e=>e.code==='DIAGNOSTIC_IMPLEMENTATION_UNAVAILABLE'&&!/\/tmp\/|private-fixture/.test(e.message);
test('content identity detects same-size edits, stable atomic replacement and the new protocol without depending on inode or mtime',t=>{
 const {root,write}=sources(t),rel='src/core/trading-fees.js',file=path.join(root,rel);
 write(rel,'// fee:1\n');const before=fingerprint({root}),st=fs.statSync(file);
 assert.equal(manifest({root}).protocol,'evolution-diagnostic-implementation-v2');
 write(rel,'// fee:2\n');fs.utimesSync(file,st.atime,st.mtime);
 const changed=fingerprint({root});assert.notEqual(changed,before);
 assert.throws(()=>assertFingerprint(before,{root}),unavailable);
 write(rel+'.tmp','// fee:3\n');fs.renameSync(file+'.tmp',file);
 const replaced=fingerprint({root});assert.notEqual(replaced,changed);
 write(rel+'.tmp','// fee:3\n');fs.renameSync(file+'.tmp',file);
 assert.equal(fingerprint({root}),replaced,'identical stable content has portable identity');
 assert.equal(assertFingerprint(replaced,{root}),replaced);
 assert.throws(()=>assertFingerprint(null,{root}),unavailable);
});
test('a descriptor opened before an atomic source replacement cannot return a reusable manifest',t=>{
 const {root,write}=sources(t),rel='src/core/trading-fees.js',file=path.join(root,rel),open=fs.openSync;let injected=false;
 t.mock.method(fs,'openSync',(name,...args)=>{const fd=open.call(fs,name,...args);if(name===file&&!injected){injected=true;write(rel+'.tmp','// replacement');fs.renameSync(file+'.tmp',file);}return fd;});
 assert.throws(()=>fingerprint({root}),unavailable);assert.equal(injected,true);
});
test('during-read rewrites, short reads, growth and read errors fail closed and close the descriptor',t=>{
 const read=fs.readSync,close=fs.closeSync;
 for(const mode of ['same-size','short-read','grow','error']){
  const {root,write}=sources(t),rel='src/core/trading-fees.js',file=path.join(root,rel),stat=fs.statSync(file,{bigint:true});
  let injected=false,affected=null,closed=false;
  const reader=t.mock.method(fs,'readSync',(fd,...args)=>{
   if(!injected&&fs.fstatSync(fd,{bigint:true}).ino===stat.ino){
    injected=true;affected=fd;
    if(mode==='short-read')return 0;
    if(mode==='error')throw Object.assign(Error('/private-fixture/secret'),{code:'EIO'});
    const n=read.call(fs,fd,...args);
    if(mode==='same-size')write(rel,Buffer.alloc(Number(stat.size),65));else fs.appendFileSync(file,'extra');
    return n;
   }
   return read.call(fs,fd,...args);
  });
  const closer=t.mock.method(fs,'closeSync',fd=>{if(fd===affected)closed=true;return close.call(fs,fd);});
  try{assert.throws(()=>fingerprint({root}),unavailable);assert.equal(injected,true,mode);assert.equal(closed,true,mode);}
  finally{reader.mock.restore();closer.mock.restore();}
 }
});
test('manifest rechecks previously read files and resolution priority before publishing the fingerprint',t=>{
 const read=fs.readSync;
 for(const mode of ['earlier-file','new-resolution']){
  const {root,write}=sources(t),last=path.join(root,'strategies/extended-factor-pack.json');
  if(mode==='new-resolution'){
   write('src/core/evolution-research-statistics.js',"require('../../public/nova/optional-dependency');\n");
   write('public/nova/optional-dependency.json','{}');
  }
  const stat=fs.statSync(last,{bigint:true});let injected=false;
  const reader=t.mock.method(fs,'readSync',(fd,...args)=>{const n=read.call(fs,fd,...args);
   if(!injected&&fs.fstatSync(fd,{bigint:true}).ino===stat.ino){injected=true;
    if(mode==='earlier-file')fs.appendFileSync(path.join(root,'analysis.js'),'// changed earlier\n');
    else write('public/nova/optional-dependency.js','// new dependency\n');
   }return n;});
  try{assert.throws(()=>fingerprint({root}),unavailable);assert.equal(injected,true,mode);}
  finally{reader.mock.restore();}
 }
});
