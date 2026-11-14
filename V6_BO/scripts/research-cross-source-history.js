#!/usr/bin/env node
'use strict';
/** Explicit local-file-only Eastmoney/BaoStock parity audit.
 * This reads two already-collected datasets, never makes network requests,
 * does not trade, never rewrites source evidence and cannot certify licenses. */
const fs=require('node:fs'),path=require('node:path');
const {normalizeBaoStockDaily}=require('../src/core/baostock-historical-normalizer');
const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
const {validateImport}=require('../src/core/market-data-center');
const {partitionBaoStockRows,auditDailySessionCoverage}=require('../src/core/a-share-session-coverage');
function readObject(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.size<2||stat.size>8*1024*1024)throw Error('输入证据不是8MiB以内的普通文件');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function collectBaoStock(payload){
 if(payload?.mode==='optional-research-sources'&&Array.isArray(payload.sources)){
  const item=payload.sources.find(x=>x.provider==='baostock');
  if(!item||item.status!=='observed'||!Array.isArray(item.data?.bars))
   throw Error('可选采集证据中的BaoStock未成功获得原始日线');
  return {code:payload.code,rows:item.data.bars,collectorObservedAt:payload.observedAt};
 }
 if(payload?.provider==='baostock'&&Array.isArray(payload.rows))
  return {code:payload.code,rows:payload.rows,collectorObservedAt:payload.collectorObservedAt};
 throw Error('不接受没有明确BaoStock来源标签的原始历史');
}
function audit(emFile,baostockFile,{now=Date.now(),calendarFile}={}){
 const em=readObject(emFile),raw=collectBaoStock(readObject(baostockFile));
 if(em?.provider!=='eastmoney-public-history'||em?.source!=='imported'||
  em.priceAdjustment?.mode!=='unadjusted'||!Array.isArray(em.stocks)||
  em.stocks.length!==1||em.stocks[0].code!==raw.code)
  throw Error('需要单只相同代码、未复权且身份明确的东方财富历史');
 validateImport(em,{provider:em.provider,datasetId:em.datasetId,now});
 // Suspended BaoStock rows are SOURCE STATUS EVIDENCE, never synthetic OHLC.
 // Keep normalizer strict: only actually traded rows reach numeric parity.
 const partition=partitionBaoStockRows({...raw,now});
 const normalized=normalizeBaoStockDaily({...raw,rows:partition.tradingRows});
 const comparison=compareMarketFeeds(em,normalized.dataset);
 const calendarCoverage=auditDailySessionCoverage(normalized.dataset,{
  now,calendarFile,suspensions:partition.suspensions
 });
 const researchEvidenceComplete=comparison.consensus===true&&
  calendarCoverage.completeByProviderEvidence===true;
 return {schemaVersion:1,mode:'historical-independent-upstream-parity',
  code:raw.code,asOf:comparison.asOf,comparison,
  calendarCoverage,rawBaoStockFingerprint:partition.rawFingerprint,
  excludedRawSuspensionRows:partition.suspensions.length,
  researchEvidenceComplete,baostock:normalized.provenance,
  canTrade:false,verifiedLive:false,verifiedExternal:false,
  sourceIndependenceAuthenticated:false,usableForExecution:false,
  warning:'价格一致不等于交易日完整。必须另外审计交易所研究日历、供应商自报停牌、未解释缺口及公司行为；报告没有交易权限，历史日历不构成当年已知时点证据'};
}
function main(args){
 if(args.length!==3)throw Error('用法: node scripts/research-cross-source-history.js <eastmoney-unadjusted.json> <baostock-raw.json> <new-report.json>');
 const [emFile,bFile,destFile]=args;
 const report=audit(emFile,bFile);
 const full=path.resolve(destFile),dir=path.dirname(full);
 if(!fs.existsSync(dir))throw Error('输出目录必须预先存在，禁止意外创建目录');
 const fd=fs.openSync(full,'wx',0o600);
 try{
  fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 console.log(JSON.stringify({output:full,numericMatched:report.comparison.consensus,
  sessionCoverage:report.calendarCoverage.status,
  researchEvidenceComplete:report.researchEvidenceComplete,
  differences:report.comparison.discrepancies,canTrade:false}));
}
if(require.main===module){
 try{main(process.argv.slice(2));}
 catch(e){console.error(String(e.message||e));process.exitCode=1;}
}
module.exports={audit,collectBaoStock,readObject,main};
