'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../public/nova');
const files=fs.readdirSync(source).filter(file=>file.endsWith('.js')).sort();
if(!files.length)throw Error('FAYO native frontend modules are missing');
for(const file of files){
 const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:fs.readFileSync(path.join(source,file),'utf8'),encoding:'utf8',timeout:10000,maxBuffer:65536});
 if(checked.error||checked.status!==0){process.stderr.write(file+': '+(checked.stderr||checked.error?.message||'syntax check failed'));process.exit(1);}
}
console.log('FAYO: syntax verified for '+files.length+' independent native frontend modules.');
