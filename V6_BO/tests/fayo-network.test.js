'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const{readPublic,proxyEnv}=require('../deploy/windows-host/fayo-network');
test('entry network adapter is bounded, shell-free and restricted to its public release repository',async()=>{
 let called=0;const result=await readPublic('https://api.github.com/repos/solviq87-cpu/v6-stock-system/branches/dev',{headers:{Accept:'application/json'}},{run:(exe,args,opts)=>{called++;assert.equal(exe,'curl');assert.equal(args[0],'--disable');assert.ok(args.includes('=https'));assert.ok(args.includes('--max-time'));assert.equal(opts.maxBuffer,12*1024*1024);return{status:0,stdout:Buffer.from('{"ok":true}')};}});assert.deepEqual(await result.json(),{ok:true});assert.equal(called,1);
 for(const url of ['http://api.github.com/repos/solviq87-cpu/v6-stock-system/branches/dev','https://example.invalid/private','file:///etc/passwd'])await assert.rejects(readPublic(url,{}, {run:()=>assert.fail('must not invoke curl')}),{code:'network-target-refused'});
});
test('only existing proxy environment is forwarded, without unrelated credentials',()=>{assert.deepEqual(proxyEnv({HTTPS_PROXY:'http://proxy.invalid',GITHUB_TOKEN:'private',PRIVATE_PASSWORD:'private'}),{HTTPS_PROXY:'http://proxy.invalid'});});
