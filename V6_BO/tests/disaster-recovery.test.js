const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {backup,verify,restore}=require('../scripts/disaster-recovery');
const digest=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-dr-'));try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}}
test('backup verifies hashes and restores identical state only after explicit apply',()=>fixture(dir=>{const input=path.join(dir,'state.json'),b=path.join(dir,'backup'),out=path.join(dir,'restore');fs.writeFileSync(input,'{"cash":123}');backup([input],b);assert.equal(verify(b).files.length,1);assert.equal(restore(b,out).restored,false);assert.equal(fs.existsSync(out),false);assert.equal(restore(b,out,{apply:true}).restored,true);assert.equal(fs.readFileSync(path.join(out,'state.json'),'utf8'),'{"cash":123}')}));
test('tampered backup is rejected and cannot be restored',()=>fixture(dir=>{const f=path.join(dir,'state.json'),b=path.join(dir,'backup');fs.writeFileSync(f,'safe');backup([f],b);fs.writeFileSync(path.join(b,'state.json'),'bad!');assert.throws(()=>verify(b),/integrity mismatch/);assert.throws(()=>restore(b,path.join(dir,'out'),{apply:true}),/integrity mismatch/)}));
test('backup rejects symlinks and duplicate names',()=>fixture(dir=>{const f=path.join(dir,'a.json'),l=path.join(dir,'b.json');fs.writeFileSync(f,'ok');fs.symlinkSync(f,l);assert.throws(()=>backup([l],path.join(dir,'b1')),/regular state/);assert.throws(()=>backup([f,f],path.join(dir,'b2')),/duplicate/)}));
test('restore rejects nonempty destination',()=>fixture(dir=>{const f=path.join(dir,'a.json'),b=path.join(dir,'backup'),out=path.join(dir,'out');fs.writeFileSync(f,'ok');backup([f],b);fs.mkdirSync(out);fs.writeFileSync(path.join(out,'existing'),'important');assert.throws(()=>restore(b,out,{apply:true}),/must be empty/)}));
test('backup rejects injected manifest path and unexpected files',()=>fixture(dir=>{const f=path.join(dir,'a.json'),b=path.join(dir,'backup');fs.writeFileSync(f,'ok');backup([f],b);const m=JSON.parse(fs.readFileSync(path.join(b,'manifest.json')));m.files[0].name='../escape';fs.writeFileSync(path.join(b,'manifest.json'),JSON.stringify(m));assert.throws(()=>verify(b),/unsafe/)}));

test('restore rejects symlink destination and symlink ancestors',()=>fixture(dir=>{const f=path.join(dir,'state'),b=path.join(dir,'backup'),real=path.join(dir,'real'),link=path.join(dir,'link');fs.writeFileSync(f,'ok');backup([f],b);fs.mkdirSync(real);fs.symlinkSync(real,link);assert.throws(()=>restore(b,link,{apply:true}),/symlink/);assert.throws(()=>restore(b,path.join(link,'child'),{apply:true}),/symlink/);assert.equal(fs.readdirSync(real).length,0)}));
test('backup rejects symlink parent and restore rejects backup overlap',()=>fixture(dir=>{const f=path.join(dir,'state'),real=path.join(dir,'real'),link=path.join(dir,'link'),b=path.join(dir,'backup');fs.writeFileSync(f,'ok');fs.mkdirSync(real);fs.symlinkSync(real,link);assert.throws(()=>backup([f],path.join(link,'backup')),/symlink/);backup([f],b);assert.throws(()=>restore(b,path.join(b,'nested'),{apply:true}),/overlaps backup/)}));
test('verify rejects malformed sizes and hashes in manifest',()=>fixture(dir=>{const f=path.join(dir,'state'),b=path.join(dir,'backup');fs.writeFileSync(f,'ok');backup([f],b);const m=JSON.parse(fs.readFileSync(path.join(b,'manifest.json')));m.files[0].size=-1;fs.writeFileSync(path.join(b,'manifest.json'),JSON.stringify(m));assert.throws(()=>verify(b),/unsafe/)}));
test('verify rejects invalid or non-canonical backup timestamps',()=>fixture(dir=>{const f=path.join(dir,'state'),b=path.join(dir,'backup');fs.writeFileSync(f,'ok');backup([f],b);const m=JSON.parse(fs.readFileSync(path.join(b,'manifest.json')));m.createdAt='2026-02-30T00:00:00.000Z';fs.writeFileSync(path.join(b,'manifest.json'),JSON.stringify(m));assert.throws(()=>verify(b),/invalid backup manifest/)}));
test('restore publishes a complete staged directory and supports an existing empty destination',()=>fixture(dir=>{const f1=path.join(dir,'a.json'),f2=path.join(dir,'b.json'),b=path.join(dir,'backup'),out=path.join(dir,'out');fs.writeFileSync(f1,'alpha');fs.writeFileSync(f2,'beta');backup([f1,f2],b);fs.mkdirSync(out);const result=restore(b,out,{apply:true});assert.equal(result.restored,true);assert.deepEqual(fs.readdirSync(out).sort(),['a.json','b.json']);assert.equal(fs.readFileSync(path.join(out,'a.json'),'utf8'),'alpha');assert.equal(fs.readFileSync(path.join(out,'b.json'),'utf8'),'beta')}));
test('bounded capture binds exact preflight bytes and rejects growth, substitutions and scope drift before publishing',()=>fixture(dir=>{
 const input=path.join(dir,'state.json'),destination=path.join(dir,'backup'),bytes=Buffer.from('original');fs.writeFileSync(input,bytes);
 const expectedFiles=[{name:'state.json',size:bytes.length,sha256:digest(bytes)}],options={maxTotalBytes:bytes.length,expectedFiles};
 fs.appendFileSync(input,'growth');assert.throws(()=>backup([input],destination,options),/BACKUP_SOURCE_CHANGED/);assert.equal(fs.existsSync(destination),false);
 fs.writeFileSync(input,'replaced');assert.throws(()=>backup([input],destination,options),/BACKUP_SOURCE_CHANGED/);assert.equal(fs.existsSync(destination),false);
 fs.writeFileSync(input,bytes);assert.throws(()=>backup([input],destination,{...options,maxTotalBytes:bytes.length-1}),/BACKUP_BYTE_BUDGET_EXCEEDED/);
 assert.throws(()=>backup([input],destination,{...options,expectedFiles:[...expectedFiles,{name:'absent.json',size:0,sha256:digest('')}]}),/BACKUP_EXPECTED_FILES_MISMATCH/);
 assert.equal(fs.existsSync(destination),false);const manifest=backup([input],destination,options);assert.deepEqual(manifest.files,expectedFiles);assert.deepEqual(fs.readFileSync(path.join(destination,'state.json')),bytes);
}));
test('capture reads only the prechecked length when a source grows during the descriptor read',t=>fixture(dir=>{
 const input=path.join(dir,'state.json'),destination=path.join(dir,'backup'),bytes=Buffer.from('safe');fs.writeFileSync(input,bytes);
 const originalRead=fs.readSync;let changed=false;const lengths=[];
 t.mock.method(fs,'readSync',(fd,buffer,offset,length,position)=>{
  lengths.push(length);if(!changed){changed=true;fs.appendFileSync(input,Buffer.alloc(1024*1024));}
  return originalRead(fd,buffer,offset,length,position);
 });
 assert.throws(()=>backup([input],destination,{maxTotalBytes:bytes.length,expectedFiles:[{name:'state.json',size:bytes.length,sha256:digest(bytes)}]}),/BACKUP_SOURCE_CHANGED/);
 assert.ok(changed);assert.ok(lengths.every(length=>length<=bytes.length));assert.equal(fs.existsSync(destination),false);
}));
test('a total byte limit also bounds legacy captures without an expected inventory',()=>fixture(dir=>{
 const first=path.join(dir,'a.json'),second=path.join(dir,'b.json'),destination=path.join(dir,'backup');fs.writeFileSync(first,'alpha');fs.writeFileSync(second,'beta');
 assert.throws(()=>backup([first,second],destination,{maxTotalBytes:8}),/BACKUP_BYTE_BUDGET_EXCEEDED/);assert.equal(fs.existsSync(destination),false);
 assert.equal(backup([first,second],destination,{maxTotalBytes:9}).files.length,2);
}));
test('a source replaced with a FIFO between stat and open is rejected without waiting for a writer',{timeout:10000},()=>fixture(dir=>{
 const {spawnSync}=require('node:child_process'),input=path.join(dir,'state.json'),destination=path.join(dir,'backup');fs.writeFileSync(input,'safe');
 const code=`const fs=require('node:fs'),{spawnSync}=require('node:child_process'),recovery=require(process.argv[1]);const input=process.argv[2],destination=process.argv[3],open=fs.openSync;let changed=false;fs.openSync=function(file,...args){if(file===input&&!changed){changed=true;fs.renameSync(input,input+'.saved');const made=spawnSync('mkfifo',[input]);if(made.status!==0)throw Error('fifo setup failed');}return open.call(fs,file,...args);};try{recovery.backup([input],destination);process.exitCode=1;}catch(error){if(error.code!=='BACKUP_SOURCE_CHANGED')throw error;console.log('fifo rejected');}`;
 const run=spawnSync(process.execPath,['-e',code,require.resolve('../scripts/disaster-recovery'),input,destination],{encoding:'utf8',timeout:5000});
 assert.equal(run.status,0,run.error?.message||run.stderr);assert.match(run.stdout,/fifo rejected/);assert.equal(fs.existsSync(destination),false);
}));
