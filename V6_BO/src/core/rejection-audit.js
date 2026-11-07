'use strict';
// Separate evidence, never a second balance ledger. Only whitelisted business
// fields are persisted; request bodies and arbitrary error strings stay private.
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(x)?x:null;
function businessView(input){const o=input?.order||input||{},q=input?.quote;return {orderId:text(o.orderId),eventId:text(input?.eventId),symbol:/^\d{6}$/.test(o.symbol)?o.symbol:null,side:['buy','sell'].includes(o.side)?o.side:null,strategyId:text(o.strategyId),quantity:Number.isSafeInteger(o.quantity)?o.quantity:null,limitPrice:Number.isFinite(o.limitPrice)?o.limitPrice:null,tradeDate:/^\d{4}-\d{2}-\d{2}$/.test(o.tradeDate)?o.tradeDate:null,quoteFingerprint:q?hash(q):null};}
function safeRisk(x){if(!x)return null;const keys=['maxPositionPct','maxGrossExposurePct','maxSectorPct','maxStrategyPct','maxConsecutiveLosses','maxDrawdownPausePct','maxDailyLossPausePct'];const policy=Object.fromEntries(keys.filter(k=>Number.isFinite(x.policy?.[k])).map(k=>[k,x.policy[k]]));
 const marks=Object.fromEntries(Object.entries(x.marks||{}).filter(([k,v])=>/^\d{6}$/.test(k)&&Number.isFinite(v)).slice(0,1000));const sectors=Object.fromEntries(Object.entries(x.sectors||{}).filter(([k,v])=>/^\d{6}$/.test(k)&&typeof v==='string'&&v.length<=80).slice(0,1000));
 return {truncated:(x.positions?.length||0)>1000||(x.pending?.length||0)>1000||Object.keys(x.marks||{}).length>1000||Object.keys(x.sectors||{}).length>1000,policy,evidenceRefs:(x.evidenceRefs||[]).slice(0,2).map(e=>({kind:text(e.kind),version:text(e.version),fingerprint:text(e.fingerprint)})),symbol:text(x.symbol),strategyId:text(x.strategyId),quantity:x.quantity,price:x.price,cash:x.cash,positions:(x.positions||[]).slice(0,1000).map(p=>({symbol:text(p.symbol),quantity:p.quantity,strategyId:text(p.strategyId)})),pending:(x.pending||[]).slice(0,1000).map(p=>({symbol:text(p.symbol),quantity:p.quantity,price:p.price,strategyId:text(p.strategyId)})),marks,sectors,lossStreak:x.lossStreak,previousClose:x.previousClose?Object.fromEntries(['priorEquity','priorPeak','previousEquity'].filter(k=>Number.isFinite(x.previousClose[k])).map(k=>[k,x.previousClose[k]])):null};}
function createRejectionAudit(file,options={}){
 const store=require('./segmented-audit-store').createSegmentedAuditStore(file,options);
 function append({action,input,reasonCodes,policyVersion,revision,valuation,riskInput,at}){return store.append({at,action,request:businessView(input),inputFingerprint:hash(input??null),valuationFingerprint:valuation?hash(valuation):null,policyVersion:policyVersion||null,accountRevision:revision||null,reasonCodes,riskInput:safeRisk(riskInput)});}
 return {append,read:store.read,rotate:store.rotate,storageFiles:store.storageFiles};
}
module.exports={createRejectionAudit};
