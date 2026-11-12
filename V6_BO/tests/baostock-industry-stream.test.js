'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
for(const name of ['test_error_after_all_apparently_valid_rows_is_rejected','test_successful_complete_stream_keeps_current_snapshot_contract']){
 test('industry collector actual Python stream: '+name,()=>{
  const result=spawnSync(process.env.V6_NATIVE_PYTHON||'python3',['-m','unittest','test_baostock_industry_stream.StreamTests.'+name],
   {cwd:__dirname,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,(result.stderr||result.stdout||String(result.error)).slice(-2000));
 });
}
