'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateDataset,runValidatedBacktest}=require('../src/core/historical-validation');
const {runHistoricalValidation}=require('../src/core/decision-research-pipeline');
const {main}=require('../scripts/validate-history');
const fixture=()=>({source:'fixture',asOf:'2026-10-31',splitDay:35,stocks:[{symbol:'000001',market:'main',bars:Array.from({length:48},(_,i)=>({open:10+i*.02,high:10.2+i*.02,low:9.8+i*.02,close:10+i*.02,volume:100000}))}]});
test('完整历史研究包含每日净值、交易成本、分割样本和禁止实盘标志',()=>{
 const result=runValidatedBacktest(fixture());assert.equal(result.releaseEligible,false);
 assert.equal(result.dataset.barsPerStock,48);assert.equal(result.equity.length,21);
 assert.equal(result.holdout.status,'evaluated');assert.ok(result.metrics.finalEquity>0);
 assert.ok(Array.isArray(result.orders));assert.ok(Array.isArray(result.openPositions));
});
test('不同股票的日历缺口和错误OHLCV被拒绝',()=>{
 const d=fixture();d.stocks[0].bars[2].high=1;assert.throws(()=>validateDataset(d),/OHLCV/);
 const e=fixture();e.stocks.push({...e.stocks[0],symbol:'000002',bars:e.stocks[0].bars.slice(1)});assert.throws(()=>validateDataset(e),/未对齐/);
});
test('缺少可追溯来源时禁止声明验证成功',()=>{
 const d=fixture();d.source='real-feed';assert.throws(()=>validateDataset(d),/provider|datasetId/);
 assert.equal(runHistoricalValidation({...d}).status,'invalid');
});
test('离线CLI写出完整JSON报告并阻止覆盖数据',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-backtest-'));
 try{const input=path.join(dir,'input.json'),output=path.join(dir,'report.json');fs.writeFileSync(input,JSON.stringify(fixture()));
  assert.throws(()=>main([input,input]),/不能相同/);const result=main([input,output]);
  assert.equal(JSON.parse(fs.readFileSync(output)).metrics.finalEquity,result.metrics.finalEquity);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
