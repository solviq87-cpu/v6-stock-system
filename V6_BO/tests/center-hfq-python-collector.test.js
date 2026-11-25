'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{spawnSync}=require('node:child_process');

test('centre HFQ Python collector enforces explicit adjustment, bounded complete SDK streams and original clocks offline',t=>{
  const python=spawnSync('python3',['--version'],{encoding:'utf8'});
  if(python.error||python.status!==0){t.skip('Python3 is unavailable in this optional development environment');return;}
  const result=spawnSync('python3',[path.join(__dirname,'test_center_hfq_collector_offline.py')],{
    encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.error,undefined,String(result.error||''));
  assert.equal(result.status,0,String(result.stderr||'').slice(-6000));
  assert.match(result.stderr,/Ran 7 tests/);
  assert.match(result.stderr,/^OK$/m);
});
