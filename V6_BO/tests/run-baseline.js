'use strict';
// Deterministic consolidated regression gate. No real network or production credentials.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const dir=__dirname;
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js')&&f!=='run-baseline.js').sort();
let pass=0,fail=0;
for(const file of files){
 const r=cp.spawnSync(process.execPath,[path.join(dir,file)],{cwd:path.join(dir,'..'),encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
 const ok=r.status===0&&!r.error;
 console.log(`${ok?'PASS':'FAIL'} ${file}`);
 if(!ok){fail++;console.error((r.stderr||r.stdout||String(r.error)).slice(-1200));}else pass++;
}
console.log(JSON.stringify({passed:pass,failed:fail,total:files.length}));
process.exitCode=fail?1:0;
