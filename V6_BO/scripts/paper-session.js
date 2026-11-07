'use strict';
const fs=require('node:fs');
const {buildSession,loadSession,saveSession,summary}=require('../src/core/paper-session');
function main(args=process.argv.slice(2)){
 const [cmd,filename,input]=args;
 if(cmd==='status'&&args.length===2){const s=summary(loadSession(filename));process.stdout.write(JSON.stringify(s,null,2)+'\n');return s;}
 if(!['init','append'].includes(cmd)||args.length!==3)throw Error('用法: node scripts/paper-session.js init|append <账户.json> <历史数据.json>；或 status <账户.json>');
 if(require('node:path').resolve(filename)===require('node:path').resolve(input))throw Error('账户与历史输入不能是同一文件');
 if(fs.statSync(input).size>30*1024*1024)throw Error('历史数据超过30MB');
 if(cmd==='init'&&fs.existsSync(filename))throw Error('账户已存在，不允许覆盖');
 const previous=cmd==='append'?loadSession(filename):null;
 const config=previous?previous.config:{};
 const result=buildSession(JSON.parse(fs.readFileSync(input,'utf8')),config,previous);
 if(result.updated)saveSession(filename,result.session);
 const s={...summary(result.session),updated:result.updated};process.stdout.write(JSON.stringify(s,null,2)+'\n');return s;
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
