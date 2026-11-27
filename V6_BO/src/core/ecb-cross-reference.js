'use strict';
// Cross rates from two original ECB archived daily series, not a second feed.
const {validate}=require('./ecb-fx-daily');
const {readBackgroundAsOf}=require('./market-data-evidence');
function readEcbCrossAsOf({root,baseCurrency,quoteCurrency,start,end,decisionAt}={}){
 if(baseCurrency===quoteCurrency||!Number.isSafeInteger(decisionAt)||decisionAt<=0||decisionAt>Date.now())throw Error('ECB交叉参考汇率时点或币种无效');
 const scope=currency=>({currency,start,end});
 for(const currency of [baseCurrency,quoteCurrency])validate({...scope(currency),now:decisionAt});
 const a=readBackgroundAsOf({root,provider:'ecb',scope:scope(baseCurrency),decisionAt});
 const b=readBackgroundAsOf({root,provider:'ecb',scope:scope(quoteCurrency),decisionAt});
 const evidence=x=>x.receipt?{hash:x.receipt.hash,dataVersion:x.receipt.dataVersion,availableAt:x.receipt.availableAt,observedAt:x.receipt.observedAt}:null;
 const result={schemaVersion:1,mode:'ecb-derived-cross-reference',provider:'ecb',upstreamGroup:'ecb',baseCurrency,quoteCurrency,direction:quoteCurrency+' per 1 '+baseCurrency,start,end,decisionAt,
  evidence:{base:evidence(a),quote:evidence(b)},rows:[],sourcePublishedAt:null,sourceRevisionKnown:false,providerIndependenceVerified:false,
  researchOnly:true,verifiedExternal:false,verifiedLive:false,pointInTimeBacktestReady:false,canTrade:false,canNotify:false};
 if(a.status!=='available-research-snapshot'||b.status!=='available-research-snapshot')return {...result,status:'unavailable-at-decision'};
 const left=new Map(a.data.rows.map(x=>[x.date,x.unitsPerEuro])),right=new Map(b.data.rows.map(x=>[x.date,x.unitsPerEuro]));
 const knownAt=Math.max(a.receipt.availableAt,b.receipt.availableAt);
 for(const date of [...new Set([...left.keys(),...right.keys()])].sort()){
  const l=left.get(date)??null,r=right.get(date)??null;
  const value=l>0&&r>0&&Number.isFinite(r/l)&&r/l>0?r/l:null;
  result.rows.push({date,baseUnitsPerEuro:l,quoteUnitsPerEuro:r,unitsPerBase:value,knownAt,quoteAt:null,providerPublishedAt:null,
   missingReason:value===null?'missing-or-invalid-same-date-reference':null});
 }
 return {...result,status:result.rows.some(x=>x.unitsPerBase!==null)?'derived-research-snapshot':'insufficient-same-date-evidence'};
}
module.exports={readEcbCrossAsOf};
