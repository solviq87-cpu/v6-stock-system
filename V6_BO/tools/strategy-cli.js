'use strict';
const fs=require('node:fs');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {legacyWalkForward}=require('../src/strategy/walk-forward-backtest');
const {walkForwardWithPolicy}=require('../src/strategy/walk-forward-policy-adapter');

function main(argv=process.argv.slice(2)){
 const [mode,file,...extra]=argv;
 if(!['scan','backtest','backtest-legacy'].includes(mode)||!file||extra.length)
  throw Error('用法: node tools/strategy-cli.js scan|backtest|backtest-legacy 数据.json');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 let result;
 if(mode==='scan'){
  result=scanUniverse(input);
 }else if(mode==='backtest'){
  // The CLI's default research backtest must retain blocked-sale positions and
  // mark daily equity. Keep the historical scanner/ranking rules unchanged.
  const report=walkForwardWithPolicy(input);
  result={...report,researchOnly:true,canTrade:false,
   executionModel:'ledger-with-explicit-policy',
   backtestPolicy:{mode:'daily-position-ledger',lotSize:input.lotSize??100,
    feeMode:input.feeSchedules?'dated-fee-schedules':'flat-bps',
    feeBps:input.feeSchedules?null:input.feeBps??8,
    slippageBps:input.slippageBps??10,
    sellTaxBps:input.feeSchedules?null:input.sellTaxBps??5,
    note:'离线研究撮合参数；不代表真实成交或交易所认证'}};
 }else{
  // Explicit compatibility route: the legacy helper redirects to a ledger
  // when policy inputs are present. Reject those instead of mislabeling it.
  const incompatible=['feeSchedules','riskPolicy','universeHistory','settlements',
   'sellTaxBps','lotSize'].filter(k=>input?.[k]!=null);
  if(incompatible.length)throw Error('旧版简化回测不支持账本/税费参数: '+incompatible.join(','));
  const report=legacyWalkForward(input);
  result={...report,executionModel:'legacy-simplified',
   researchOnly:true,canTrade:false,
   warnings:[...(report.warnings||[]),
    '旧版简化回测会跳过卖出受阻样本，不持续估值受阻持仓；不得与逐日账本净收益/回撤直接比较']};
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 return result;
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
