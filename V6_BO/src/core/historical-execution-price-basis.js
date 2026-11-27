'use strict';
/**
 * Fail-closed on EXPLICIT adjusted daily prices at offline execution/replay
 * boundaries. Research charts, cross-source comparison and K-line displays can
 * still use qfq/hfq, but adjusted OHLC must not become simulated fill prices.
 *
 * Legacy files without basis metadata remain readable for compatibility,
 * and are NOT thereby externally verified or eligible for real trading.
 */
function assertVendorBasis(vendor){
 if(typeof vendor==='string'&&/^(eastmoney-public-history-fqt-[12]|baostock-adjustflag-[12])$/i.test(vendor.trim()))
  throw Error('历史模拟成交复权元数据与原供应商参数矛盾');
}
function assertDeclaredBasis(record){
 if(!record||typeof record!=='object'||Array.isArray(record))return;
 if(record.priceBasis!==undefined&&record.priceBasis!=='unadjusted')
  throw Error('历史模拟成交必须使用未复权价格：priceBasis 不是 unadjusted');
 const adjustment=record.priceAdjustment;
 if(adjustment!==undefined){
  if(!adjustment||typeof adjustment!=='object'||Array.isArray(adjustment)||adjustment.mode!=='unadjusted')
   throw Error('历史模拟成交必须使用未复权价格：禁止前复权、后复权或未知 priceAdjustment');
  assertVendorBasis(adjustment.provider);
 }
 assertVendorBasis(record.provider);
}
function assertUnadjustedExecutionPriceBasis(history){
 if(!history||typeof history!=='object'||Array.isArray(history))
  throw Error('历史模拟成交数据无效');
 assertDeclaredBasis(history);
 // An outer raw declaration cannot override explicit stock or bar metadata.
 // Missing legacy metadata still does not certify an entire dataset as raw.
 if(Array.isArray(history.stocks))for(const stock of history.stocks){
  assertDeclaredBasis(stock);
  if(Array.isArray(stock?.bars))for(const bar of stock.bars)assertDeclaredBasis(bar);
 }
 return {basis:history.priceAdjustment!==undefined||history.priceBasis!==undefined?
  'declared-unadjusted-unverified':'legacy-undeclared-unverified',
  verifiedExternal:false,canTrade:false};
}
module.exports={assertUnadjustedExecutionPriceBasis};
