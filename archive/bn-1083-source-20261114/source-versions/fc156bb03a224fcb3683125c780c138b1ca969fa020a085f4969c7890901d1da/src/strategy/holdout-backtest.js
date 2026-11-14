'use strict';
const {ledgerBacktest}=require('./position-ledger-backtest');

function holdoutBacktest({splitDay,start=27,end,stocks,...options}={}){
 const last=end??Math.min(...stocks.map(s=>s.bars.length))-1;
 if(!Number.isInteger(splitDay)||splitDay<start+2||splitDay>=last)throw Error('样本内外各需至少两个交易日');
 if(!Number.isInteger(last)||stocks.some(s=>s.bars.length<=last))throw Error('样本外区间越界');
 const run=(first,final)=>ledgerBacktest({...options,stocks,start:first,end:final});
 return {splitDay,inSample:run(start,splitDay-1),outOfSample:run(splitDay,last),
  method:'预先指定分割点，同一配置分别从空仓启动。测试段指标可预热使用分割前历史，训练段持仓和订单不跨段。'};
}
module.exports={holdoutBacktest};
