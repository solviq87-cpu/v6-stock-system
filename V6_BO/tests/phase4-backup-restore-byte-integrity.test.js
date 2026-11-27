'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {backup,verify,restore}=require('../scripts/disaster-recovery');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-b4-backup-')),input=path.join(dir,'state.json'),saved=path.join(dir,'backup'),out=path.join(dir,'restored');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(input,'original');
 return {dir,input,saved,out};
}
test('restore must verify the bytes copied after the original manifest verification',t=>{
 const x=fixture(t);backup([x.input],x.saved);const mkdir=fs.mkdirSync;
 t.mock.method(fs,'mkdirSync',(p,...args)=>{const result=mkdir(p,...args);if(String(p).includes('.restore-'))fs.writeFileSync(path.join(x.saved,'state.json'),'replaced');return result;});
 try{assert.throws(()=>restore(x.saved,x.out,{apply:true}),/integrity mismatch|BACKUP_SOURCE_CHANGED/);}finally{t.mock.restoreAll();}
 assert.equal(fs.existsSync(x.out),false);assert.equal(fs.readFileSync(x.input,'utf8'),'original');
 assert.equal(fs.readdirSync(x.dir).some(n=>n.includes('.restore-')),false);
});
test('backup rejects same-size source substitution while its descriptor is open',t=>{
 const x=fixture(t),read=fs.readSync;let changed=false;
 t.mock.method(fs,'readSync',(fd,buffer,...args)=>{const n=read(fd,buffer,...args);if(!changed){changed=true;fs.renameSync(x.input,x.input+'.prior');fs.writeFileSync(x.input,'replaced');}return n;});
 try{assert.throws(()=>backup([x.input],x.saved),/BACKUP_SOURCE_CHANGED/);}finally{t.mock.restoreAll();}
 assert.equal(changed,true);assert.equal(fs.existsSync(x.saved),false);assert.equal(fs.readFileSync(x.input+'.prior','utf8'),'original');
});
test('backup cannot follow a symlinked ancestor of an otherwise regular source file',t=>{
 const x=fixture(t),alias=path.join(x.dir,'alias');fs.symlinkSync(x.dir,alias);
 assert.throws(()=>backup([path.join(alias,'state.json')],x.saved),/symlink/);assert.equal(fs.existsSync(x.saved),false);
});
test('staged bytes must match the verified manifest before publishing the restored directory',t=>{
 const x=fixture(t);backup([x.input],x.saved);const rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(from,to)=>{const result=rename(from,to);if(String(to).includes('.restore-')&&path.basename(to)==='state.json')fs.writeFileSync(to,'replaced');return result;});
 try{assert.throws(()=>restore(x.saved,x.out,{apply:true}),/integrity mismatch|BACKUP_SOURCE_CHANGED/);}finally{t.mock.restoreAll();}
 assert.equal(fs.existsSync(x.out),false);assert.equal(verify(x.saved).files.length,1);
});
test('normal dry run and explicit restore preserve all original bytes and schema',t=>{
 const x=fixture(t),manifest=backup([x.input],x.saved);assert.deepEqual(verify(x.saved),manifest);
 assert.equal(restore(x.saved,x.out).restored,false);assert.equal(fs.existsSync(x.out),false);
 assert.equal(restore(x.saved,x.out,{apply:true}).restored,true);assert.deepEqual(fs.readFileSync(path.join(x.out,'state.json')),fs.readFileSync(x.input));
});
