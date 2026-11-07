'use strict';
/** Explicit operator-only paper-account recovery; defaults to inspection. */
const {recoverSession}=require('../src/core/paper-session');
const [file,flag]=process.argv.slice(2);
if(!file||!['--check','--restore',undefined].includes(flag)){
 console.error('用法: node scripts/paper-recover.js <账户JSON> [--check|--restore]');process.exitCode=2;
}else{
 try{console.log(JSON.stringify(recoverSession(file,{dryRun:flag!=='--restore'}),null,2));}
 catch(e){console.error('恢复失败:',e.message);process.exitCode=1;}
}
