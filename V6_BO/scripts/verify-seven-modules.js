#!/usr/bin/env node
'use strict';
/** Offline integration verification for the seven user-facing V6 workstreams.
 * Passing local tests never certifies market provenance or production acceptance.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const groups={
 market:['market-data-center-e2e.test.js','market-data-quality-gates.test.js','market-temporal-integrity.test.js'],
 strategies:['native-strategy-daily.test.js','independent-strategy-attribution.test.js','unified-strategy-project.test.js'],
 backtest:['ashare-t1-backtest.test.js','position-ledger-backtest.test.js','integrated-run-bundle.test.js'],
 paper:['paper-replay.test.js','paper-monitor-e2e.test.js','paper-session.test.js'],
 risk:['portfolio-risk-linkage.test.js','parallel-market-risk.test.js','research-risk-gate.test.js'],
 accounts:['device-access-persistence.test.js','concentrated-security-research.test.js'],
 interfaces:['decision-workspace-ui.test.js','live-market-ui-integration.test.js','ui-navigation-accessibility.test.js']
};
function run({node=process.execPath,timeout=120000}={}){
 const result={schemaVersion:1,mode:'offline-seven-module-integration',canTrade:false,verifiedLive:false,
  productionAccepted:false,startedAt:new Date().toISOString(),modules:{},externalBlockers:[
   '授权A股行情与交易日历未实地认证','四套策略真实独立样本外效果未验收',
   '模拟盘多日实盘数据驱动未验收','真实短信OTP和生产HTTPS未验收',
   '异地灾备与电脑手机真机验收未完成']};
 let all=true;
 for(const [name,files] of Object.entries(groups)){
  for(const file of files)if(!fs.statSync(path.join(root,'tests',file)).isFile())throw Error('缺少集成测试: '+file);
  const args=['--test','--test-reporter=tap','--test-concurrency=2',...files.map(f=>path.join(root,'tests',f))];
  const proc=cp.spawnSync(node,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:16*1024*1024,env:process.env});
  const output=(proc.stdout||'')+'\n'+(proc.stderr||'');
  const count=key=>{const m=output.match(new RegExp('^# '+key+' (\\d+)$','m'));return m?Number(m[1]):null;};
  const passed=proc.status===0&&count('fail')===0&&count('tests')!==null&&count('pass')===count('tests')&&count('skipped')===0;
  result.modules[name]={passed,tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped'),exitCode:proc.status,
   error:proc.error?.message||null,files:files.map(f=>({name:f,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'tests',f))).digest('hex')}))};
  all=all&&passed;
 }
 result.offlineIntegrationPassed=all;
 result.finishedAt=new Date().toISOString();
 return result;
}
if(require.main===module){
 try{
  const result=run();
  const destination=process.argv[2];
  if(destination){const file=path.resolve(destination);fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'w',mode:0o600});}
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.offlineIntegrationPassed)process.exitCode=1;
 }catch(err){console.error(err);process.exitCode=2;}
}
module.exports={groups,run};
