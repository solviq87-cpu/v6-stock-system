'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createRejectionAudit}=require('../src/core/rejection-audit');
const {preflight,drill,execute}=require('../scripts/advanced-safety-operations');
const password='isolated-fixture-password-0123456789';
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-safety-operations-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'original'),file=path.join(source,'pool.json');fs.mkdirSync(source,{mode:0o700});
 const now=Date.parse('2026-11-05T02:00:00Z');
 const app=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});app.initialize(100000);
 app.submit({orderId:'buy-one',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:'2026-11-05'});
 app.fill('buy-one','fill-one',{symbol:'600000',source:'simulated',tradeDate:'2026-11-05',timestamp:now,volumeUnit:'shares',volume:10000,price:10,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
 const audit=createRejectionAudit(file+'.audit.json');
 for(let i=0;i<2;i++){audit.append({action:'submit',input:{orderId:'rejected-'+i},at:now+i,reasonCodes:['FIXTURE_REJECTION']});if(i===0)audit.rotate();}
 const config=path.join(source,'risk-config.json'),access=path.join(source,'access.json');
 fs.writeFileSync(config,JSON.stringify({version:'fixture-v1',maxPositionPct:10}));
 fs.writeFileSync(access,JSON.stringify({token:'PRIVATE_ACCESS_SENTINEL_DO_NOT_PRINT'}));
 const spec={schemaVersion:1,accounts:[{id:'pool',file}],files:[{id:'risk-config',category:'configuration',file:config},{id:'access',category:'access-control',file:access}]};
 return {dir,source,file,app,audit,spec};
}
function bytesOf(root){
 const result={};
 function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),st=fs.lstatSync(file);if(st.isDirectory())walk(file);else if(st.isFile())result[path.relative(root,file)]=fs.readFileSync(file).toString('base64');}}
 walk(root);return result;
}
test('migration preflight validates original financial and segmented audit evidence and lists explicit coverage',t=>{
 const x=setup(t),before=bytesOf(x.source),result=preflight(x.spec);
 assert.equal(result.readyForIsolatedDrill,true);assert.equal(result.productionReady,false);assert.equal(result.fullSiteBackup,false);
 assert.equal(result.accounts[0].revision,3);assert.equal(result.accounts[0].orders,1);assert.equal(result.accounts[0].ledgerEvents,1);
 assert.equal(result.accounts[0].auditEvents,2);assert.equal(result.accounts[0].cutoverPerformed,false);
 assert.equal(result.inventory.filter(x=>x.category==='rejection-audit').length,2);
 assert.equal(result.categories.find(x=>x.category==='model-artifact').status,'not-supplied');
 assert.equal(result.categories.find(x=>x.category==='configuration').files,1);
 assert.deepEqual(bytesOf(x.source),before);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ACCESS_SENTINEL|"cash"|original\//);
});
test('isolated drill consumes the real encrypted backup and original restore tools with measured local RPO/RTO',t=>{
 const x=setup(t),before=bytesOf(x.source),destination=path.join(x.dir,'isolated-drill');
 const result=drill(x.spec,destination,password);
 assert.equal(result.status,'verified-isolated');assert.equal(result.productionExercise,false);assert.equal(result.cutoverPerformed,false);
 assert.equal(result.originalInputsUnchanged,true);assert.equal(result.plaintextRetained,false);
 assert.deepEqual(bytesOf(x.source),before);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination,'report.json'))),result);
 assert.equal(result.artifacts.length,3);assert.equal(result.restored.find(x=>x.kind==='account').auditEvents,2);
 assert.equal(result.restored.find(x=>x.kind==='account').revision,3);assert.ok(result.restored.every(x=>x.byteMatch));
 assert.ok(result.measurements.rtoMs>0);assert.ok(result.measurements.backupMs>0);assert.ok(result.measurements.totalMs>=result.measurements.rtoMs);
 assert.equal(result.measurements.rpoMs,result.simulatedFailureAt-Math.min(...result.artifacts.map(x=>x.capturedFromAt)));
 assert.equal(result.measurements.productionRpoMs,null);assert.equal(result.measurements.productionRtoMs,null);
 assert.deepEqual(fs.readdirSync(destination).sort(),['report.json',...result.artifacts.map(x=>x.file)].sort());
 for(const artifact of result.artifacts){
  const file=path.join(destination,artifact.file);assert.equal(fs.statSync(file).mode&0o777,0o600);
  const encrypted=fs.readFileSync(file,'utf8');assert.doesNotMatch(encrypted,/PRIVATE_ACCESS_SENTINEL|fill-one|FIXTURE_REJECTION/);
  assert.equal(JSON.parse(encrypted).schemaVersion,1);
 }
 assert.equal(fs.statSync(destination).mode&0o777,0o700);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ACCESS_SENTINEL|isolated-fixture-password/);
 assert.throws(()=>drill(x.spec,destination,password),/ALREADY_EXISTS/);
});
test('bad evidence, missing sources, symlinks, overlapping directories and existing targets fail before mutation',t=>{
 const x=setup(t),before=bytesOf(x.source),existing=path.join(x.dir,'existing');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'keep'),'original');
 assert.throws(()=>drill(x.spec,existing,password),/ALREADY_EXISTS/);assert.equal(fs.readFileSync(path.join(existing,'keep'),'utf8'),'original');
 assert.throws(()=>drill(x.spec,path.join(x.source,'do-not-create'),password),/ISOLATED/);assert.equal(fs.existsSync(path.join(x.source,'do-not-create')),false);
 assert.throws(()=>drill(x.spec,path.join(x.dir,'bad-password'),'short'),/PASSWORD/);
 const alias=path.join(x.dir,'alias');fs.symlinkSync(x.source,alias);
 assert.throws(()=>preflight({...x.spec,accounts:[{id:'pool',file:path.join(alias,'pool.json')}]}),/SYMLINK/);
 assert.throws(()=>drill(x.spec,path.join(alias,'drill'),password),/SYMLINK/);
 assert.throws(()=>preflight({...x.spec,accounts:[{id:'missing',file:path.join(x.dir,'never-created','pool.json')}]}),/UNAVAILABLE/);
 assert.equal(fs.existsSync(path.join(x.dir,'never-created')),false);
 assert.throws(()=>preflight({...x.spec,files:[{...x.spec.files[0],category:'made-up-category'}]}),/INVALID/);
 assert.deepEqual(bytesOf(x.source),before);
 fs.appendFileSync(x.file+'.audit.json','tampered');assert.throws(()=>preflight(x.spec),/ORIGINAL_ACCOUNT_OR_AUDIT_INVALID/);
 assert.throws(()=>drill(x.spec,path.join(x.dir,'rejected-drill'),password),/ORIGINAL_ACCOUNT_OR_AUDIT_INVALID/);
 assert.equal(fs.existsSync(path.join(x.dir,'rejected-drill')),false);
});
test('an original account writer lock yields a failed report and never publishes a restored account',t=>{
 const x=setup(t),before=fs.readFileSync(x.file),destination=path.join(x.dir,'busy-drill');
 fs.writeFileSync(x.file+'.lock',JSON.stringify({pid:process.pid}));
 const result=drill(x.spec,destination,password);
 assert.equal(result.status,'failed');assert.equal(result.phase,'capture');assert.equal(result.productionExercise,false);
 assert.equal(result.measurements.rpoMs,null);assert.equal(result.measurements.rtoMs,null);
 assert.deepEqual(fs.readFileSync(x.file),before);assert.deepEqual(fs.readdirSync(destination),['report.json']);
 assert.doesNotMatch(JSON.stringify(result),new RegExp(x.source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
test('CLI resolves only explicit manifest files, uses the environment password and emits no plaintext secrets',t=>{
 const x=setup(t),spec=path.join(x.dir,'operations.json');
 fs.writeFileSync(spec,JSON.stringify({...x.spec,accounts:[{id:'pool',file:'original/pool.json'}],files:[]}));
 const result=execute(['preflight',spec]);assert.equal(result.accounts[0].revision,3);
 const destination=path.join(x.dir,'cli-drill'),script=require.resolve('../scripts/advanced-safety-operations');
 const run=spawnSync(process.execPath,[script,'drill',spec,destination],{env:{...process.env,V6_BACKUP_PASSWORD:password},encoding:'utf8',timeout:15000});
 assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).status,'verified-isolated');
 assert.doesNotMatch(run.stdout+run.stderr,/PRIVATE_ACCESS_SENTINEL|isolated-fixture-password|"cash"/);
 const missing=spawnSync(process.execPath,[script,'drill',spec,path.join(x.dir,'no-password')],{env:{...process.env,V6_BACKUP_PASSWORD:''},encoding:'utf8',timeout:15000});
 assert.equal(missing.status,1);assert.match(missing.stderr,/BACKUP_PASSWORD_REQUIRED/);assert.equal(fs.existsSync(path.join(x.dir,'no-password')),false);
});
