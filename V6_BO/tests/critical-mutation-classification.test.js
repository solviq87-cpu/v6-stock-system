'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classify,CASES}=require('../scripts/check-critical-mutations');
test('fixed mutation budget covers quote time, authorization, idempotency and cash',()=>{assert.equal(CASES.length,4);assert.equal(new Set(CASES.map(c=>c.id)).size,4);assert.ok(CASES.every(c=>c.test.startsWith('tests/')&&c.file.startsWith('src/core/')));});
const tap=({tests=1,pass=0,fail=1,skip=0,assertion=true}={})=>`TAP version 13\n${Array.from({length:tests},(_,i)=>`${i<fail?'not ok':'ok'} ${i+1} - case${i+1}`).join('\n')}\n${assertion?"  ---\n  failureType: 'testCodeFailure'\n  code: 'ERR_ASSERTION'\n  error: 'assertion failed'\n  ...\n":''}1..${tests}\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# cancelled 0\n# skipped ${skip}\n# todo 0\n# duration_ms 1\n`;
test('only complete reports with executed assertions count as killed',()=>{const output=tap();assert.equal(classify({status:1,stdout:output}).status,'killed');for(const run of [{status:0,stdout:''},{status:1,stdout:output+'\nSyntaxError'},{status:1,stdout:output+'\nReferenceError'},{status:1,stdout:output+'\nMODULE_NOT_FOUND'},{status:null,signal:'SIGTERM',stdout:output},{status:1,stdout:output,error:{code:'ETIMEDOUT'}},{status:1,stdout:tap({tests:0,fail:0})},{status:0,stdout:tap({pass:0,fail:0,skip:1})},{status:1,stdout:output.replace('1..1','1..2')},{status:1,stdout:output.replace('# duration_ms 1','')}])assert.equal(classify(run).status,'inconclusive');});
test('survival is not automatically called equivalence or successful validation',()=>{const run={status:0,stdout:tap({pass:1,fail:0,assertion:false})};assert.equal(classify(run).status,'survived');assert.equal(classify(run,{baseline:true}).status,'baseline-pass');assert.equal(classify({status:1,stdout:tap()},{baseline:true}).status,'inconclusive');});

test('an assertion token outside the failed-test diagnostic is not a killed mutation',()=>{const out=tap({assertion:false})+"# code: 'ERR_ASSERTION'\n";assert.equal(classify({status:1,stdout:out}).status,'inconclusive');});
test('summary cannot contradict actual failures or inflate the executed test count',()=>{
 const failed=tap().replace('# pass 0','# pass 1').replace('# fail 1','# fail 0');
 assert.equal(classify({status:0,stdout:failed},{baseline:true}).status,'inconclusive');
 const inflated=tap({pass:1,fail:0,assertion:false}).replace('# tests 1','# tests 100').replace('# pass 1','# pass 100');
 assert.equal(classify({status:0,stdout:inflated},{baseline:true}).status,'inconclusive');
});

test('stderr cannot supply missing TAP evidence or a conflicting test receipt',()=>{
 const output=tap();const split=output.indexOf('1..1');
 assert.equal(classify({status:1,stdout:output.slice(0,split),stderr:output.slice(split)}).status,'inconclusive');
 assert.equal(classify({status:1,stdout:output,stderr:'not ok 2 - unrelated\n'}).status,'inconclusive');
});
test('results and all summaries must be on their own side of the terminal TAP plan',()=>{
 const output=tap(),early=output.replace('1..1\n','').replace('TAP version 13\n','TAP version 13\n1..1\n');
 assert.equal(classify({status:1,stdout:early}).status,'inconclusive');
 assert.equal(classify({status:1,stdout:output.replace('# fail 1\n','').replace('1..1\n','# fail 1\n1..1\n')}).status,'inconclusive');
 assert.equal(classify({status:1,stdout:output+'Bail out! lost runner\n'}).status,'inconclusive');
});
test('a mix of real assertion failures and nonassertion failures is inconclusive',()=>{
 const output=tap({tests:2,fail:2}).replace('not ok 2 - case2\n',"  ---\n  failureType: 'testCodeFailure'\n  error: 'unexpected runtime failure'\n  ...\nnot ok 2 - case2\n");
 assert.equal(classify({status:1,stdout:output}).status,'inconclusive');
});
test('a native Node assertion diagnostic stays valid with benign stderr',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-mutation-receipt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'assertion.test.cjs');
 fs.writeFileSync(file,"const test=require('node:test');const assert=require('node:assert/strict');test('real assertion',()=>assert.equal(1,2));\n");
 const run=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,TMPDIR:dir}});
 assert.equal(run.status,1);assert.equal(classify({...run,stderr:'ordinary diagnostic\n'}).status,'killed');
});
