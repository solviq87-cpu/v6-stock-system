'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const cli=path.resolve(__dirname,'../tools/strategy-cli.js');

function invoke(mode,file){
 const run=spawnSync(process.execPath,[cli,mode,file],{
  encoding:'utf8',timeout:20000,env:{...process.env,V6_OPTIONAL_RESEARCH_FILE:''}});
 assert.equal(run.status,0,run.stderr||run.error?.message);
 return JSON.parse(run.stdout);
}
function sample(){
 const bars=Array.from({length:45},(_,i)=>{
  const close=+(10+i*.03).toFixed(3);
  return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
   open:close,high:+(close+.2).toFixed(3),low:+(close-.2).toFixed(3),
   close,volume:1000000};
 });
 return {source:'simulated',start:27,end:35,stocks:[
  {symbol:'000001',market:'main',bars}]};
}

test('backtest CLI uses ledger with daily marks; simplified path is explicit only',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-backtest-cli-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'sample.json');
 fs.writeFileSync(file,JSON.stringify(sample()));
 const ledger=invoke('backtest',file);
 assert.equal(ledger.executionModel,'ledger-with-explicit-policy');
 assert.equal(ledger.backtestPolicy.mode,'daily-position-ledger');
 assert.equal(ledger.backtestPolicy.lotSize,100);
 assert.equal(ledger.backtestPolicy.sellTaxBps,5);
 assert.equal(ledger.backtestPolicy.feeBps,8);
 assert.equal(ledger.backtestPolicy.slippageBps,10);
 assert.equal(ledger.researchOnly,true);
 assert.equal(ledger.canTrade,false);
 assert.ok(Array.isArray(ledger.orders));
 assert.ok(Array.isArray(ledger.openPositions));
 assert.ok(Array.isArray(ledger.dailyEquity)||ledger.equity?.every(r=>Number.isFinite(r.value)));
 assert.ok(ledger.assumptions.some(s=>s.includes('卖出受阻继续持仓')));
 const legacy=invoke('backtest-legacy',file);
 assert.equal(legacy.executionModel,'legacy-simplified');
 assert.equal(legacy.researchOnly,true);
 assert.equal(legacy.canTrade,false);
 assert.ok(legacy.warnings.some(s=>s.includes('跳过卖出受阻样本')));
 assert.equal(legacy.openPositions,undefined);
 const scan=invoke('scan',file);
 assert.equal(scan.total,1);
 assert.equal(scan.executionModel,undefined);
});

test('backtest policy explicitly discloses overrides and refuses invalid mode',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-backtest-options-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'sample.json');
 fs.writeFileSync(file,JSON.stringify({...sample(),lotSize:1,sellTaxBps:0,
  feeBps:12,slippageBps:25}));
 const report=invoke('backtest',file);
 assert.equal(report.backtestPolicy.lotSize,1);
 assert.equal(report.backtestPolicy.sellTaxBps,0);
 assert.equal(report.backtestPolicy.feeBps,12);
 assert.equal(report.backtestPolicy.slippageBps,25);
 const wrong=spawnSync(process.execPath,[cli,'backtest-unknown',file],{encoding:'utf8',timeout:10000});
 assert.notEqual(wrong.status,0);
 assert.match(wrong.stderr,/backtest-legacy/);
});
