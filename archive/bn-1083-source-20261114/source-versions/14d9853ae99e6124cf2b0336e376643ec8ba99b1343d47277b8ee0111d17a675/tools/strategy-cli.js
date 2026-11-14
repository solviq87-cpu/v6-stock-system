 'use strict';
const fs=require('node:fs');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {walkForward}=require('../src/strategy/walk-forward-backtest');
function main(argv=process.argv.slice(2)){
 const [mode,file]=argv;
 if(!['scan','backtest'].includes(mode)||!file)throw Error('用法: node tools/strategy-cli.js scan|backtest 数据.json');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=mode==='scan'?scanUniverse(input):walkForward(input);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
