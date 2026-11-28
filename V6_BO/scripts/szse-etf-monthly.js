#!/usr/bin/env node
'use strict';
const {collectEtfMonthly, compareArchivedMonths} = require('../src/core/szse-etf-monthly');

async function main([action,root,...args]) {
  if (action === 'capture' && args.length === 2) {
    const [month,documentId] = args;
    require('../src/core/research-workspace-store').privateRoot(root);
    const result = await collectEtfMonthly({archiveRoot:root,month,documentId});
    return {provider:result.provider,month,sourceUrl:result.sourceUrl,count:result.rows.length,observedAt:result.observedAt,
      archiveReceipt:result.archiveReceipt,canTrade:false};
  }
  if (action === 'compare' && args.length === 6) {
    const [symbol,firstMonth,firstId,secondMonth,secondId,asOf] = args;
    if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(asOf)) throw Error('研究截点需要明确时区');
    return compareArchivedMonths({root,symbol,decisionAt:Date.parse(asOf),earlier:{month:firstMonth,documentId:firstId},
      later:{month:secondMonth,documentId:secondId}});
  }
  throw Error('用法：capture 原档案目录 YYYY-MM 原文件名，或 compare 原档案目录 基金代码 前月 前文件名 后月 后文件名 ISO截点');
}

if (require.main === module) main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(e=>{
  console.error(e.message); process.exitCode=1;
});
module.exports = {main};
