'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const checks = [
 ['核心语法','npm',['run','check']],
 ['策略语法','npm',['run','check:strategy']],
 ['策略冒烟','npm',['run','smoke:strategy']],
 ['权限矩阵','node',['_test_auth_matrix.js']],
 ['私密信息隔离','node',['_test_priv_no_leak.js']],
 ['只读设备与密码回归','node',['_test_view_idle.js']],
 ['HTTP路由静态检查','node',['_test_routes_smoke.js']]
];
const results = checks.map(([name,cmd,args])=>{
 const p=spawnSync(cmd,args,{cwd:root,encoding:'utf8',timeout:20000,
  shell:process.platform==='win32',env:{...process.env,V6_TEST_MODE:'1',PUSH_ROLE:'replica'}});
 const output=((p.stdout||'')+'\n'+(p.stderr||'')).trim();
 return {name,pass:p.status===0,exitCode:p.status,output:output.slice(-1800)};
});
console.log(JSON.stringify({ok:results.every(r=>r.pass),results},null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
