'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {readWatchJournal,commitWatchJournal}=require('../src/core/research-watch-journal');
const digest=s=>'a'.repeat(64),fingerprint=s=>'a'.repeat(63)+s;
const stage=(date='2026-11-06')=>({symbol:'600001',name:'私有本机观察',stage:'observe',
 lastSeen:date,streak:1,misses:0,matched:['quality:trend'],riskIds:[],
 confirmed:false,dataStatus:'observed-research-only',reason:'导入历史战法研究命中'});
function withDir(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-watch-journal-')),file=path.join(dir,'daily-watch.json');
 try{return fn({dir,file});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('private local daily journal advances two days and same-day rerun is exactly idempotent',()=>withDir(({file})=>{
 const empty=readWatchJournal(file);
 assert.equal(empty.present,false);assert.deepEqual(empty.states,[]);
 const initial=commitWatchJournal(file,{date:'2026-11-06',inputFingerprint:fingerprint('1'),
  states:[stage()],expectedDigest:null});
 assert.equal(initial.revision,1);assert.equal(initial.reused,false);
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 const firstContent=fs.readFileSync(file,'utf8');
 assert.equal(readWatchJournal(file).digest,initial.digest);
 const repeat=commitWatchJournal(file,{date:'2026-11-06',inputFingerprint:fingerprint('1'),
  states:[stage()],expectedDigest:initial.digest});
 assert.equal(repeat.reused,true);
 assert.equal(repeat.revision,1);assert.equal(fs.readFileSync(file,'utf8'),firstContent);
 const next=commitWatchJournal(file,{date:'2026-11-09',inputFingerprint:fingerprint('2'),
  states:[{...stage('2026-11-09'),stage:'focus',streak:2,confirmed:true}],
  expectedDigest:initial.digest});
 assert.equal(next.revision,2);assert.equal(next.reused,false);
 const recovered=readWatchJournal(file);
 assert.equal(recovered.present,true);assert.equal(recovered.date,'2026-11-09');
 assert.equal(recovered.states[0].stage,'focus');
 assert.notEqual(recovered.digest,initial.digest);
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).previousDigest,initial.digest);
 assert.equal(fs.existsSync(file+'.lock'),false);
 assert.ok(!fs.readdirSync(path.dirname(file)).some(n=>n.includes('.tmp-')));
}));
test('old day, revised same-day inputs, mismatched expected digest and concurrent lock fail closed',()=>withDir(({file})=>{
 const one=commitWatchJournal(file,{date:'2026-11-06',inputFingerprint:fingerprint('1'),
  states:[stage()],expectedDigest:null});
 const before=fs.readFileSync(file,'utf8');
 for(const call of [
  {date:'2026-11-05',inputFingerprint:fingerprint('1'),states:[stage('2026-11-05')],expectedDigest:one.digest},
  {date:'2026-11-06',inputFingerprint:fingerprint('2'),states:[stage()],expectedDigest:one.digest},
  {date:'2026-11-09',inputFingerprint:fingerprint('2'),states:[stage()],expectedDigest:null}
 ])assert.throws(()=>commitWatchJournal(file,call));
 assert.equal(fs.readFileSync(file,'utf8'),before);
 const lock=fs.openSync(file+'.lock','wx',0o600);
 try{assert.throws(()=>commitWatchJournal(file,{date:'2026-11-09',inputFingerprint:fingerprint('2'),
  states:[stage()],expectedDigest:one.digest}));}
 finally{fs.closeSync(lock);fs.unlinkSync(file+'.lock');}
 assert.equal(fs.readFileSync(file,'utf8'),before);
}));
test('tamper, malformed records and symlinked paths cannot be silently reused',()=>withDir(({file,dir})=>{
 const one=commitWatchJournal(file,{date:'2026-11-06',inputFingerprint:fingerprint('1'),
  states:[stage()],expectedDigest:null});
 const unchanged=fs.readFileSync(file,'utf8');
 let doc=JSON.parse(unchanged);doc.states[0].stage='focus';
 fs.writeFileSync(file,JSON.stringify(doc));
 assert.throws(()=>readWatchJournal(file),/指纹/);
 assert.throws(()=>commitWatchJournal(file,{date:'2026-11-09',inputFingerprint:fingerprint('2'),
  states:[stage()],expectedDigest:one.digest}),/指纹/);
 fs.writeFileSync(file,unchanged);
 for(const broken of [
  [{...stage(),symbol:'bad'}],[stage(),stage()],
  [{...stage(),lastSeen:'2026-11-31'}],
  [{...stage(),dataStatus:'verified-live'}],
  [{...stage(),lastSeen:'2027-01-01'}]
 ])assert.throws(()=>commitWatchJournal(file,{date:'2026-11-09',
  inputFingerprint:fingerprint('2'),states:broken,expectedDigest:one.digest}));
 const link=path.join(dir,'alias.json');fs.symlinkSync(file,link);
 assert.throws(()=>readWatchJournal(link));
 assert.throws(()=>commitWatchJournal(link,{date:'2026-11-09',
  inputFingerprint:fingerprint('2'),states:[stage()],expectedDigest:null}));
 const nested=path.join(dir,'folder-link');fs.symlinkSync(dir,nested,'dir');
 assert.throws(()=>readWatchJournal(path.join(nested,'daily-watch.json')));
 assert.equal(fs.readFileSync(file,'utf8'),unchanged);
}));
test('fresh journal rejects any future-dated watch status and never reports outside deliveries',()=>withDir(({file})=>{
 assert.throws(()=>commitWatchJournal(file,{date:'2026-11-06',inputFingerprint:fingerprint('1'),
  states:[stage('2026-11-09')],expectedDigest:null}),/未来/);
 assert.equal(fs.existsSync(file),false);
 const result=commitWatchJournal(file,{date:'2026-11-09',inputFingerprint:fingerprint('1'),
  states:[],expectedDigest:null});
 assert.equal(result.revision,1);
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(raw.canTrade,false);assert.equal(raw.canNotify,false);
 assert.ok(!JSON.stringify(raw).includes('brokerAccount'));
}));
