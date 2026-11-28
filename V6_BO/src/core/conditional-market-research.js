'use strict';
// Only called with visible, version-selected original private asset observations.
// All supplied rights, quotes and calculation parameters remain declarations.
const {quoteObservationView}=require('./quote-observation-view');
const {sessionMinute}=require('./index-window-research').sameMinuteResearchPolicy;
const finite=x=>typeof x==='number'&&Number.isFinite(x),positive=x=>finite(x)&&x>0;
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const id=x=>typeof x==='string'&&/^[\w.:-]{1,120}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const day=x=>new Date(x+28800000).toISOString().slice(0,10);
const flags=Object.freeze({researchOnly:true,canTrade:false,canNotify:false,sourcePermissionCertified:false,independentValueVerified:false});
const proof=r=>({source:r.source,id:r.id,revision:r.revision,archiveHash:r.archiveHash,recordedAt:r.recordedAt});
const bad=q=>['synthetic','simulated','mock','fixture','testSample','conflict','sourceConflict','quoteSourceConflict'].some(k=>q?.[k]===true)||['test','demo','synthetic'].includes(q?.sampleSet);
function admitted(r,asOf){return r&&id(r.id)&&id(r.source)&&Number.isSafeInteger(r.revision)&&r.revision>0&&hash(r.archiveHash)&&r.inputOrigin==='explicit-private-import'&&r.independentlyVerified===false&&time(r.recordedAt)&&r.recordedAt<=asOf&&r.firstKnownAt===r.recordedAt&&time(r.publishedAt)&&r.publishedAt<=r.recordedAt&&!bad(r)&&r.retracted!==true;}
function rights(r,scope,a,b){const g=r?.authorization;return g?.status==='granted'&&g.provider===r.source&&g.scope===scope&&id(g.evidenceId)&&time(g.validFrom)&&time(g.validUntil)&&g.validFrom<=a&&b<=g.validUntil;}
function profile(rows,r,kind,a,b,scope){const p=rows.filter(x=>x.kind===kind&&x.id===r.profileId&&x.source===r.profileSource&&x.recordedAt<=a&&time(x.validFrom)&&time(x.validUntil)&&x.validFrom<=a&&x.validUntil>=b&&rights(x,scope,x.recordedAt,b));return p.length===1?p[0]:null;}
function session(a,b,calendar){const x=sessionMinute(a),y=sessionMinute(b);return time(a)&&time(b)&&a<b&&b-a<=3600000&&day(a)===day(b)&&x!==null&&y!==null&&(x<690)===(y<690)&&calendar?.status==='available'&&hash(calendar.metadata?.sha256)&&time(Date.parse(calendar.metadata.knowledgeAvailableAt))&&Date.parse(calendar.metadata.knowledgeAvailableAt)<=a&&['SSE','SZSE'].every(e=>calendar.metadata.supportedExchanges?.includes(e))&&Array.isArray(calendar.tradeDates)&&calendar.tradeDates.length<=1000&&calendar.tradeDates.every((d,i)=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&(!i||d>calendar.tradeDates[i-1]))&&calendar.tradeDates.includes(day(a));}
function quote(q,code,source,at,recordedAt){
 if(!q||q.code!==code||q.quoteSource!==source||q.currency!=='CNY'||q.quoteAt!==at||!time(q.receivedAt)||q.receivedAt<at||q.receivedAt-at>15000||q.receivedAt>recordedAt||q.priceBasis!=='unadjusted'||q.corporateAction!==false||q.suspended!==false||q.sessionOpen!==true||bad(q)||!positive(q.price)||q.price>1e9)return null;
 const v=quoteObservationView(q,q.receivedAt);return v.quoteStatus==='recent-unverified'&&v.missingReason===null?q.price:null;
}
const pair=(s,code,source,a,b,recordedAt)=>{const x=quote(s?.start,code,source,a,recordedAt),y=quote(s?.end,code,source,b,recordedAt);return x===null||y===null?null:[x,y];};
function contribution(r,p,a,b){
 if(!p||p.method!=='fixed-adjusted-shares-divisor'||p.complete!==true||p.corporateActions!=='none-in-window'||!['1.000001','0.399001','0.399006','1.000688'].includes(p.index)||!['sina-index','tencent-index'].includes(p.indexSource)||r.index!==p.index||!positive(p.divisor)||r.startDivisor!==p.divisor||r.endDivisor!==p.divisor||!id(p.divisorVersion)||r.divisorVersion!==p.divisorVersion||!time(p.weightAt)||p.weightAt>p.recordedAt||!Array.isArray(p.members)||p.members.length<2||p.members.length>500||!Array.isArray(r.components)||r.components.length!==p.members.length)return null;
 const valid=m=>m&&/^\d{6}$/.test(m.code)&&positive(m.adjustedShares)&&positive(m.weight)&&m.weight<=1&&positive(m.weightPrice);
 if(!p.members.every(valid)||new Set(p.members.map(m=>m.code)).size!==p.members.length||!r.components.every(m=>m&&/^\d{6}$/.test(m.code))||new Set(r.components.map(m=>m.code)).size!==r.components.length||Math.abs(p.members.reduce((s,m)=>s+m.weight,0)-1)>1e-8)return null;
 const cap=p.members.reduce((s,m)=>s+m.adjustedShares*m.weightPrice,0);if(!positive(cap)||p.members.some(m=>Math.abs(m.adjustedShares*m.weightPrice/cap-m.weight)>1e-8))return null;
 const I=pair(r.indexPrices,p.index,p.indexSource,a,b,r.recordedAt);if(!I)return null;
 const components=new Map(r.components.map(m=>[m.code,m.prices]));let start=0,end=0;const memberContributions=[];
 for(const m of p.members){const prices=pair(components.get(m.code),m.code,r.source,a,b,r.recordedAt);if(!prices)return null;const x=prices[0]*m.adjustedShares/p.divisor,y=prices[1]*m.adjustedShares/p.divisor;start+=x;end+=y;memberContributions.push({code:m.code,contributionPoints:y-x});}
 if(![start,end,end-start].every(finite)||!memberContributions.every(m=>finite(m.contributionPoints)))return null;
 const residuals={startPoints:I[0]-start,endPoints:I[1]-end,changePoints:(I[1]-I[0])-(end-start)};
 if(!Object.values(residuals).every(finite))return null;
 const reconciled=Math.abs(residuals.startPoints)<=.01000001&&Math.abs(residuals.endPoints)<=.01000001;
 memberContributions.sort((x,y)=>Math.abs(y.contributionPoints)-Math.abs(x.contributionPoints)||x.code.localeCompare(y.code));
 return {status:reconciled?'declared-reconciled':'reconciliation-failed',index:p.index,memberCount:p.members.length,divisor:p.divisor,divisorVersion:p.divisorVersion,observedIndexPoints:I,recomputedIndexPoints:[start,end],residuals,roundingTolerancePoints:.01000001,totalContributionPoints:reconciled?end-start:null,memberContributions:reconciled?memberContributions.slice(0,20):[],omittedContributionPoints:reconciled?memberContributions.slice(20).reduce((s,m)=>s+m.contributionPoints,0):null,originalFeedReceiptVerified:false,evidence:[proof(p),proof(r)]};
}
function futures(r,p,a,b){
 if(!p||p.method!=='fixed-contract-carry-v1'||p.currency!=='CNY'||p.contractType!=='stock-index-futures'||p.exchange!=='CFFEX'||!id(p.index)||!id(p.contract)||r.contract!==p.contract||r.index!==p.index||p.rollState!=='unchanged-contract'||r.multiplier!==p.multiplier||!positive(p.multiplier)||p.priceUnit!=='index-points'||r.priceUnit!==p.priceUnit||!time(p.expiryAt)||b>=p.expiryAt||!id(p.financingEvidenceId)||!id(p.dividendEvidenceId)||p.dividendScheduleComplete!==true||!finite(p.annualFinancingRate)||p.annualFinancingRate<-.1||p.annualFinancingRate>.3||!Array.isArray(p.dividends)||p.dividends.length>500)return null;
 if(!p.dividends.every((d,i)=>time(d?.at)&&d.at>b&&d.at<=p.expiryAt&&finite(d.points)&&d.points>=0&&(!i||d.at>p.dividends[i-1].at)))return null;
 const S=pair(r.spotPrices,p.index,r.source,a,b,r.recordedAt),F=pair(r.futuresPrices,p.contract,r.source,a,b,r.recordedAt);if(!S||!F)return null;
 const year=365*86400000;
 const values=[a,b].map((t,i)=>{const tau=(p.expiryAt-t)/year,pv=p.dividends.reduce((sum,d)=>sum+d.points*Math.exp(-p.annualFinancingRate*(d.at-t)/year),0),fair=(S[i]-pv)*Math.exp(p.annualFinancingRate*tau);return {quoteAt:t,spot:S[i],futures:F[i],basisPoints:F[i]-S[i],basisPct:100*(F[i]/S[i]-1),fairFuturesPoints:fair,carryResidualPoints:F[i]-fair,dividendPresentValuePoints:pv,yearsToExpiry:tau};});
 if(values.some(v=>!Object.values(v).every(finite)||!positive(v.fairFuturesPoints)))return null;
 return {status:'declared-synchronized-comparison',index:p.index,contract:p.contract,expiryAt:p.expiryAt,multiplier:p.multiplier,observations:values,basisChangePoints:values[1].basisPoints-values[0].basisPoints,carryResidualChangePoints:values[1].carryResidualPoints-values[0].carryResidualPoints,futuresMinusSpotReturnPct:100*(F[1]/F[0]-S[1]/S[0]),costOfCarryAssumptions:{annualFinancingRate:p.annualFinancingRate,dayCount:'ACT/365',continuousCompounding:true,dividendScheduleCompleteDeclared:true},divergenceSignalVerified:false,arbitrageVerified:false,evidence:[proof(p),proof(r)]};
}
function reviewConditionalMarkets(visibleRows,{asOf,calendar}={}){
 const empty=task=>({task,status:'unknown',attempted:0,computed:0,rejected:0,rows:[],...flags});
 const index=empty('F03.4'),carry=empty('F08.4'),divergence={task:'F17.3',status:'unknown',sharedEvidence:'F08.4',...flags};
 const base={mode:'conditional-index-and-futures-research-v1',index,carry,divergence,...flags};
 if(!time(asOf)||!Array.isArray(visibleRows)||visibleRows.length>500)return base;
 const rows=visibleRows.filter(r=>admitted(r,asOf)),windows=new Map();
 const windowKey=r=>JSON.stringify([r.kind,r.index,r.kind==='index-futures-window'?r.contract:null,r.startAt,r.endAt]);
 for(const r of rows)if(['index-contribution-window','index-futures-window'].includes(r.kind)){const k=windowKey(r);windows.set(k,(windows.get(k)||0)+1);}
 for(const r of rows){const isIndex=r.kind==='index-contribution-window',isFutures=r.kind==='index-futures-window';if(!isIndex&&!isFutures)continue;
  const report=isIndex?index:carry,{startAt:a,endAt:b}=r;report.attempted++;
  const eligible=windows.get(windowKey(r))===1&&time(a)&&time(b)&&session(a,b,calendar)&&r.recordedAt>=b&&r.recordedAt-b<=15000&&r.publishedAt>=b&&rights(r,isIndex?'index-contribution':'index-futures',a,b);
  const p=eligible?profile(rows,r,isIndex?'index-contribution-profile':'index-futures-profile',a,b,isIndex?'index-constituents':'index-futures'):null;
  const value=p?(isIndex?contribution(r,p,a,b):futures(r,p,a,b)):null;
  if(!value){report.rejected++;continue;}report.rows.push(value);if(value.status!=='reconciliation-failed')report.computed++;
 }
 for(const report of [index,carry]){report.status=report.computed?'observed-research':report.rows.length?'reconciliation-failed':'unknown';report.truncated=report.rows.length>30;report.rows=report.rows.slice(-30);}
 return {...base,divergence:{...divergence,status:carry.status,attempted:carry.attempted,computed:carry.computed,rejected:carry.rejected,meaning:'reuse exact F08.4 synchronized observations; no separate signal or order'}};
}
module.exports={reviewConditionalMarkets};
