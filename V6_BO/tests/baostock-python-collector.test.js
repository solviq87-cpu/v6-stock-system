'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('BaoStock Python collector: offline SDK fake, chronology and actual Python to Node contract',t=>{
 const python=spawnSync('python3',['--version'],{encoding:'utf8'});
 if(python.error||python.status!==0){
  t.skip('Python3 not available in optional offline dev environment');
  return;
 }
 const script=path.join(__dirname,'test_baostock_collector_offline.py');
 const result=spawnSync('python3',[script],{
  encoding:'utf8',
  timeout:30000,
  maxBuffer:1024*1024,
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
 });
 assert.equal(result.error,undefined,String(result.error||''));
 assert.equal(result.status,0,
  'BaoStock offline fake-SDK collector regression failed:\n'+
  String(result.stderr||'').slice(-6000));
 assert.match(result.stderr,/Ran 7 tests/);
 assert.match(result.stderr,/^OK$/m);
});
