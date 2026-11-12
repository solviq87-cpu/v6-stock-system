'use strict';
const {featureObservation,names,catalog}=require('./public-factor-features');
const {createHash}=require('node:crypto');
const sets=Object.freeze({
 'baseline-v1':Object.freeze([]),
 'public-volume-v1':Object.freeze(names.filter(n=>n.startsWith('qlib_'))),
 'public-volume-liquidity-v1':names
});
function selectPublicFeatures(name){
 if(!Object.hasOwn(sets,name))throw Error('未知研究 featureSet');
 return sets[name];
}
function publicFeaturesAt(stock,day,tradingDates){
 const signal=stock.bars[day],history=stock.factorHistory;
 const stamp=typeof signal.availableAt==='number'?signal.availableAt:Date.parse(signal.availableAt);
 // Research formation is a same-session close decision. Later restatements
 // cannot trade at an earlier next-open label even if their timestamps parse.
 const dayEnd=Date.parse(signal.date+'T23:59:59.999+08:00');
 if(!Number.isFinite(stamp)||stamp>dayEnd)return {status:'unavailable',values:{},reasons:['LATE_SIGNAL_AVAILABILITY']};
 // Adjusted feature bars are deliberately separate from executable raw prices.
 // Never feed an adjusted close into the existing order/cost ledger.
 return featureObservation({symbol:String(stock.symbol||stock.code),bars:history?.bars}, {
  asOf:signal.date,observedAt:signal.availableAt,tradingDates,
  metadata:history?.metadataByDate?.[signal.date]??history?.metadata
 });
}
const catalogFingerprint=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
module.exports={selectPublicFeatures,publicFeaturesAt,catalogFingerprint};
