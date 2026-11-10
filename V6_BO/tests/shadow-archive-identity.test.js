'use strict';
// Offline regression: archive filename must be bound to the sealed SHA and
// training-end date, including files that are not the latest accepted model.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {latestAccepted,latestCooldown,latestTrial}=require('../scripts/factor-shadow-worker');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sealed(status='shadow-updated'){
 const payload={mode:'v6-factor-shadow-evolution-v1',status,
  schemaVersion:1,version:1,trainingEnd:'2026-11-09',
  lastObservationDay:'2026-11-10',previousFingerprint:null,
  canTrade:false,productionWeightsChanged:false};
 return {...payload,fingerprint:hash(payload)};
}
function temp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-archive-name-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
function archive(dir,record,{day=record.trainingEnd,prefix=record.fingerprint.slice(0,12)}={}){
 const file=path.join(dir,`shadow-${day}-${prefix}.json`);
 fs.writeFileSync(file,JSON.stringify(record),{mode:0o600});
 return file;
}
test('correctly named, sealed accepted history remains readable in all readers',t=>{
 const dir=temp(t),record=sealed();
 archive(dir,record);
 const accepted=latestAccepted(dir);
 assert.equal(accepted.fingerprint,record.fingerprint);
 assert.equal(latestCooldown(dir,accepted),null);
 assert.equal(latestTrial(dir,accepted),null);
});
for(const mismatch of ['fingerprint-prefix','training-end-date']){
 test('content-valid archive with mismatched '+mismatch+' fails closed in all readers',t=>{
  const dir=temp(t),record=sealed();
  const prefix=record.fingerprint.startsWith('000000000000')?'ffffffffffff':'000000000000';
  archive(dir,record,mismatch==='fingerprint-prefix'?
   {prefix}:{day:'2026-11-08'});
  // Hash integrity is intact; only the filename has been substituted.
  assert.equal(hash((({fingerprint,...payload})=>payload)(record)),record.fingerprint);
  assert.throws(()=>latestAccepted(dir),/完整性无效/);
  assert.throws(()=>latestCooldown(dir,record),/完整性无效/);
  assert.throws(()=>latestTrial(dir,record),/被篡改|文件名/);
 });
}
test('misnamed nonaccepted shadow report is also rejected, not silently skipped',t=>{
 const dir=temp(t),record=sealed('shadow-recovered');
 archive(dir,record,{day:'2026-11-08'});
 assert.throws(()=>latestAccepted(dir),/完整性无效/);
 assert.throws(()=>latestTrial(dir,null),/被篡改|文件名/);
});
