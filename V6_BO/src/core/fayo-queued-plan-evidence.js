'use strict';
// Preserve the original alert and account-scoped delivery identity. This
// helper can only reject an old reminder; it cannot reserve or send one.
const stamp=x=>Number.isSafeInteger(x)&&x>0;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function alertIdentityMatches(risk,alert,plan,versionOf){
 const r=risk?.references;
 if(!r||!alert||!plan||typeof versionOf!=='function'||risk.status!=='active'||risk.priceDependent!==true||
    !['entry','stop','target'].includes(alert.kind)||!hash(alert.id)||!hash(alert.observationId)||!hash(alert.planVersion)||
    !stamp(alert.quoteAt)||typeof alert.price!=='number'||!Number.isFinite(alert.price)||alert.price<=0||
    alert.private!==true||alert.canTrade!==false)return false;
 if(r.planId!==alert.planId||r.alertId!==alert.id||r.observationId!==alert.observationId||r.kind!==alert.kind||
    (r.entryEventId??null)!==(alert.entryEventId??null)||risk.sourceAt!==alert.quoteAt||
    risk.object?.id!==alert.code||plan.id!==alert.planId||plan.code!==alert.code||
    plan.decisionAuthority!=='fayo-decision-center')return false;
 try{return versionOf(plan)===alert.planVersion;}catch{return false;}
}
function queuedPlanMatches({risk,alert,plan,context,quote,versionOf,queuedGeneration,currentGeneration,now}={}){
 if(!Number.isSafeInteger(queuedGeneration)||queuedGeneration!==currentGeneration||!alertIdentityMatches(risk,alert,plan,versionOf)||
    !context||context.current!==true||context.ambiguous||!stamp(now)||!stamp(quote?.quoteAt)||
    quote.quoteAt<alert.quoteAt||quote.quoteAt>now||now-quote.quoteAt>15000||now-alert.quoteAt>15000||
    typeof quote.price!=='number'||!Number.isFinite(quote.price)||quote.price<=0||
    quote.quoteAt===alert.quoteAt&&quote.price!==alert.price)return false;
 if(alert.kind==='entry')return (alert.entryEventId??null)===null&&context.entry===null;
 return typeof alert.entryEventId==='string'&&alert.entryEventId.length>0&&context.entry?.eventId===alert.entryEventId&&
  Number.isSafeInteger(context.remaining)&&context.remaining>0;
}
module.exports={alertIdentityMatches,queuedPlanMatches};
