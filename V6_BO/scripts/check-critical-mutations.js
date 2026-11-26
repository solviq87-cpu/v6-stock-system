#!/usr/bin/env node
'use strict';
// Four fixed fault injections in child-process module compilation. Repository
// source files are never changed, and only existing isolated account tests run.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const CASES=Object.freeze([
 {id:'stale-quote-admitted',file:'src/core/paper-application-service.js',from:'now-at>15000',to:'now-at>180000',test:'tests/automatic-paper-commit-quote-time.test.js',invariant:'新增自动成交必须在落盘前通过原始报价15秒门禁'},
 {id:'unauthorized-read-admitted',file:'src/core/paper-service.js',from:'if(!safeEqual(req.headers.authorization,`Bearer ${token}`))',to:'if(false)',test:'tests/paper-service-http.test.js',invariant:'原本机只读纸面账户HTTP仍拒绝无令牌读取'},
 {id:'duplicate-fill-booked',file:'src/core/paper-account-ledger.js',from:'if (account.eventHashes[fill.eventId]) {',to:'if (false) {',test:'tests/paper-account-ledger.test.js',invariant:'相同成交重复到达不再次扣款或增加持仓'},
 {id:'cash-debit-corrupted',file:'src/core/paper-account-ledger.js',from:'account.cash = money(account.cash - debit);',to:'account.cash = money(account.cash - debit + 1);',test:'tests/paper-account-ledger.test.js',invariant:'买入后的现金必须与价格数量费用精确一致'}
]);
function classify(run,{baseline=false}={}){
 const output=String(run.stdout||'')+'\n'+String(run.stderr||'');
 const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>{const matches=[...output.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];return [key,matches.length===1?Number(matches[0][1]):null];}));
 const plans=[...output.matchAll(/^1\.\.(\d+)$/gm)],results=[...output.matchAll(/^(not )?ok (\d+) - (.*)$/gm)];
 const failed=results.filter(r=>r[1]).length,skipped=results.filter(r=>!r[1]&&/# SKIP(?:\s|$)/i.test(r[3])).length;
 // This bounded suite is flat. A nested or inconsistent report is deliberately
 // inconclusive until its structure is explicitly supported and verified.
 const complete=output.startsWith('TAP version 13\n')&&plans.length===1&&Number(plans[0][1])>0&&Number(plans[0][1])===results.length&&results.every((r,i)=>Number(r[2])===i+1)&&Object.values(counts).every(x=>Number.isSafeInteger(x)&&x>=0)&&counts.tests===results.length&&counts.fail===failed&&counts.skipped===skipped&&counts.pass===results.length-failed-skipped&&counts.tests>0&&counts.pass+counts.fail>0&&counts.cancelled===0&&counts.todo===0&&counts.tests===counts.pass+counts.fail+counts.skipped&&/^# duration_ms [0-9.]+$/m.test(output);
 if(run.error||run.signal||!complete)return {status:'inconclusive',reason:'超时、进程异常、报告不完整或没有实际执行的测试'};
 if(run.status===0&&counts.fail!==0||run.status!==0&&counts.fail===0)return {status:'inconclusive',reason:'退出状态与测试报告不一致'};
 if(run.status===0)return {status:baseline?'baseline-pass':'survived',reason:baseline?'原隔离测试通过':'错误变更未被当前测试阻断；需人工检查是否等价并补业务断言'};
 const assertionFailure=output.split(/(?=^(?:not )?ok \d+ - |^1\.\.\d+$)/m).some(block=>block.startsWith('not ok ')&&/\n  ---\n[\s\S]*?\n  code: ['"]ERR_ASSERTION['"]\n[\s\S]*?\n  \.\.\./.test(block));
 if(!baseline&&run.status===1&&assertionFailure&&!/(?:SyntaxError|ReferenceError|MODULE_NOT_FOUND)/.test(output))return {status:'killed',reason:'既有业务断言捕获错误变更'};
 return {status:'inconclusive',reason:baseline?'原测试未通过，不能评价变异':'非明确断言失败，不能算捕获业务错误'};
}
function runCriticalMutations(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-critical-mutation-')),preload=path.join(dir,'preload.cjs');
 const files=new Map([...new Set([...CASES.map(c=>c.file),...CASES.map(c=>c.test),'scripts/check-critical-mutations.js'])].map(file=>[file,fs.readFileSync(path.join(root,file))]));
 const sourceHashes=Object.fromEntries([...files].map(([file,bytes])=>[file,hash(bytes)]));
 const tests=[...new Set(CASES.map(c=>c.test))],environment={PATH:process.env.PATH,TMPDIR:dir,RUNNER_TEMP:dir};
 const execute=(selected,args=[])=>spawnSync(process.execPath,[...args,'--test-reporter=tap','--test',...selected],{cwd:root,encoding:'utf8',env:environment,timeout:20000,maxBuffer:2*1024*1024});
 try{
  const baseline=execute(tests),base=classify(baseline,{baseline:true}),results=[];
  for(const c of CASES){
   const original=files.get(c.file).toString('utf8'),occurrences=original.split(c.from).length-1;
   if(base.status!=='baseline-pass'||occurrences!==1){results.push({id:c.id,invariant:c.invariant,status:'inconclusive',reason:base.status!=='baseline-pass'?'原隔离测试失败':'源代码匹配不唯一或已变化，需要更新固定变异'});continue;}
   // The payload is generated from fixed checked-in constants, never input data.
   const target=path.join(root,c.file),code=`'use strict';\nconst fs=require('node:fs'),Module=require('node:module');\nconst original=Module._extensions['.js'],target=${JSON.stringify(target)};\nModule._extensions['.js']=function(mod,file){if(file!==target)return original(mod,file);const code=fs.readFileSync(file,'utf8');mod._compile(code.replace(${JSON.stringify(c.from)},${JSON.stringify(c.to)}),file);};\n`;
   fs.writeFileSync(preload,code,{mode:0o600});
   const run=execute([c.test],['--require',preload]),out=String(run.stdout||'')+'\n'+String(run.stderr||'');
   results.push({id:c.id,file:c.file,test:c.test,invariant:c.invariant,...classify(run),exitCode:run.status,outputSha256:hash(out),failedAssertions:Number(out.match(/# fail (\d+)/)?.[1]??0)});
  }
  const unchanged=[...files].every(([file,bytes])=>fs.readFileSync(path.join(root,file)).equals(bytes));
  if(!unchanged)throw Error('仓库源码在验证期间变化，结果不可归属于冻结版本');
  return {schemaVersion:1,mode:'isolated-critical-mutation-review',revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes,sourceUnchanged:true,baseline:{...base,exitCode:baseline.status,outputSha256:hash(String(baseline.stdout||'')+'\n'+String(baseline.stderr||''))},results,counts:{total:CASES.length,killed:results.filter(x=>x.status==='killed').length,survived:results.filter(x=>x.status==='survived').length,inconclusive:results.filter(x=>x.status==='inconclusive').length,equivalent:null},coverage:'仅四个预定义变异；不代表全部权限路径、故障组合或系统无缺陷',canTrade:false,canDeploy:false};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module){try{if(process.argv.length!==2)throw Error('本命令只运行固定四项变异，不接受自定义代码或生产路径');const result=runCriticalMutations();process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.counts.killed!==result.counts.total)process.exitCode=1;}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
module.exports={CASES,classify,runCriticalMutations};
