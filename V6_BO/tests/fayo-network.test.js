'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const{readPublic,proxyEnv}=require('../deploy/windows-host/fayo-network');
test('entry network adapter is bounded, shell-free and restricted to its public release repository',async()=>{
 let called=0;const result=await readPublic('https://api.github.com/repos/solviq87-cpu/v6-stock-system/branches/dev',{headers:{Accept:'application/json'}},{run:(exe,args,opts)=>{called++;assert.equal(exe,'curl');assert.equal(args[0],'--disable');assert.ok(args.includes('=https'));assert.ok(args.includes('--max-time'));assert.equal(opts.maxBuffer,12*1024*1024);return{status:0,stdout:Buffer.from('{"ok":true}')};}});assert.deepEqual(await result.json(),{ok:true});assert.equal(called,1);
 for(const url of ['http://api.github.com/repos/solviq87-cpu/v6-stock-system/branches/dev','https://example.invalid/private','file:///etc/passwd'])await assert.rejects(readPublic(url,{}, {run:()=>assert.fail('must not invoke curl')}),{code:'network-target-refused'});
});
test('only existing proxy environment is forwarded, without unrelated credentials',()=>{assert.deepEqual(proxyEnv({HTTPS_PROXY:'http://proxy.invalid',GITHUB_TOKEN:'private',PRIVATE_PASSWORD:'private'}),{HTTPS_PROXY:'http://proxy.invalid'});});
test('only the diagnosed Python bootstrap download gets bounded timeout retries',async()=>{
 const url='https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl';
 await readPublic(url,{}, {run:(exe,args,options)=>{assert.equal(args[args.indexOf('--max-time')+1],'180');assert.equal(args[args.indexOf('--retry')+1],'2');assert.equal(args[args.indexOf('--retry-max-time')+1],'540');assert.equal(options.timeout,550000);assert.equal(options.maxBuffer,12*1024*1024);assert.equal(args.includes('--insecure'),false);return{status:0,stdout:Buffer.from('synthetic transport only')};}});
 await readPublic('https://api.github.com/repos/solviq87-cpu/v6-stock-system/branches/dev',{}, {run:(exe,args,options)=>{assert.equal(args[args.indexOf('--max-time')+1],'15');assert.equal(args.includes('--retry'),false);assert.equal(options.timeout,20000);return{status:0,stdout:Buffer.from('{}')};}});
});
