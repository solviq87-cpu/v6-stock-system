'use strict';
/**
 * Fail-closed on EXPLICIT adjusted daily prices at offline execution/replay
 * boundaries. Research charts, cross-source comparison and K-line displays can
 * still use qfq/hfq, but adjusted OHLC must not become simulated fill prices.
 *
 * Legacy files without basis metadata remain readable for compatibility,
 * and are NOT thereby externally verified or eligible for real trading.
 */
function assertUnadjustedExecutionPriceBasis(history){
 if(!history||typeof history!=='object'||Array.isArray(history))
  throw Error('历史模拟成交数据无效');
 const basis=history.priceBasis;
 if(basis!==undefined&&basis!=='unadjusted')
  throw Error('历史模拟成交必须使用未复权价格：priceBasis 不是 unadjusted');
 const adjustment=history.priceAdjustment;
 if(adjustment!==undefined){
  if(!adjustment||typeof adjustment!=='object'||Array.isArray(adjustment)||
     adjustment.mode!=='unadjusted')
   throw Error('历史模拟成交必须使用未复权价格：禁止前复权、后复权或未知 priceAdjustment');
  // Known upstream encoding contradicting "raw" is an explicit inconsistency.
  const vendor=adjustment.provider;
  if(typeof vendor==='string'&&(
    /^eastmoney-public-history-fqt-[12]$/.test(vendor)||
    /^baostock-adjustflag-[12]$/.test(vendor)))
   throw Error('历史模拟成交复权元数据与原供应商参数矛盾');
 }
 return {basis:adjustment!==undefined||basis!==undefined?
  'declared-unadjusted-unverified':'legacy-undeclared-unverified',
  verifiedExternal:false,canTrade:false};
}
module.exports={assertUnadjustedExecutionPriceBasis};
