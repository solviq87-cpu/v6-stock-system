'use strict';
// Adapter for existing capture payloads; no fetch, ranking, orders, or notifications.
const {createHash}=require('node:crypto');
const {createTradingCalendar}=require('./trading-calendar');
const {freezeSectorMemberIdentity}=require('./sector-member-identity-proof');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const {analyzeIntradaySectorStructure}=require('./market-sector-structure');
const {analyzeIntradayMarketProfile}=require('./market-profile-research');
const FLAGS=Object.freeze({canTrade:false,canNotify:false,canOpenRisk:false,weightsChanged:false,autoPromotion:false,certified:false});
const LIMITS=Object.freeze({maxFrames:12,maxStocks:10000,maxSectors:300,maxSelectedSectors:30,maxCandidates:1000});
const stamp=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const text=x=>typeof x==='string'&&x.length>0&&x.length<=160&&x.trim()===x;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const sectorId=x=>typeof x==='string'&&/^(?:industry|concept)\|[A-Za-z0-9_-]{2,30}$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const iso=x=>{const t=typeof x==='string'?Date.parse(x):NaN;return stamp(t)&&new Date(t).toISOString()===x?t:null;};
const fake=x=>x?.simulated===true||x?.synthetic===true||x?.mock===true||x?.sampleSet==='demo';
const check=(v,reason)=>{if(!v)throw Error(reason);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=x=>x.category+'|'+x.code;
const notKnown=reason=>({status:'unknown',reason});
// Receipts bind declared source and original content; NOT third-party signatures.
function receipt(raw,r,kind,source,observedAt,cutoff){
 check(raw&&r&&r.schemaVersion===1&&r.kind===kind&&!fake(raw)&&!fake(r)&&text(source)&&r.source===source&&text(r.evidenceId)&&digest(r.contentSha256)&&r.contentSha256===hash(raw),'capture-receipt-identity-invalid');
 check(stamp(observedAt)&&r.observedAt===observedAt&&stamp(r.knownAt)&&r.knownAt>=observedAt&&r.knownAt<=cutoff,'capture-receipt-clock-invalid');
 if(raw.knownAt!==undefined)check(raw.knownAt===r.knownAt,'capture-known-time-conflict');
 if(raw.evidenceId!==undefined)check(raw.evidenceId===r.evidenceId,'capture-evidence-id-conflict');
 return {evidenceId:r.evidenceId,source:r.source,observedAt,knownAt:r.knownAt,contentSha256:r.contentSha256};
}
function readCalendars(entries,earliest){
 check(Array.isArray(entries)&&entries.length===2,'sse-szse-calendar-pair-required');
 const out=new Map();
 for(const e of entries){const c=e?.calendar,r=e?.receipt;check(['SSE','SZSE'].includes(c?.exchange)&&!out.has(c.exchange),'calendar-exchange-conflict');
  const bound=receipt(c,r,'calendar',c.source,r?.observedAt,earliest);
  for(const k of ['firstObservedAt','observedAt'])if(c[k]!==undefined){const t=stamp(c[k])?c[k]:iso(c[k]);check(t!==null&&t<=bound.observedAt,'calendar-original-clock-conflict');}
  const parsed=createTradingCalendar(c);out.set(c.exchange,{parsed,bound});
 }
 return out;
}
function mapCapture(c,asOf,selection,calendars){
 const s=c?.snapshot,m=c?.membership,sr=c?.snapshotReceipt,mr=c?.membershipReceipt;
 check(s?.source==='eastmoney-clist-unverified-live'&&Array.isArray(s.stocks)&&s.stocks.length<=LIMITS.maxStocks&&m&&Array.isArray(m.sectors)&&m.sectors.length<=LIMITS.maxSectors,'capture-source-or-size-invalid');
 const start=iso(s.startedAt),end=iso(s.retrievedAt);
 check(start!==null&&end!==null&&start<=end&&s.date===day(end)&&end<=asOf,'capture-clock-invalid');
 if(s.samplingDurationMs!==undefined)check(s.samplingDurationMs===end-start,'capture-duration-conflict');
 const srBound=receipt(s,sr,'market-snapshot',s.source,end,asOf);
 check(sr.tradeDate===s.date&&sr.returnWindow==='session-to-date'&&(sr.amountWindow===undefined||sr.amountWindow===null||sr.amountWindow==='session-to-date'),'snapshot-window-not-declared');
 check((s.returnWindow===undefined||s.returnWindow===sr.returnWindow)&&(s.amountWindow===undefined||s.amountWindow===(sr.amountWindow??null))&&(s.asOf===undefined||s.asOf===end),'snapshot-window-or-cutoff-conflict');
 const mrBound=receipt(m,mr,'sector-membership',m.provider,m.observedAt,start);
 check(mr.tradeDate===s.date&&m.tradeDate===s.date,'membership-date-conflict');
 for(const x of calendars.values())check(x.parsed.isOpen(s.date),'calendar-session-closed');
 const proof=freezeSectorMemberIdentity(m);check(proof.status==='identity-frozen-unverified','raw-membership-invalid');
 const byId=new Map(m.sectors.map(x=>[key(x),x]));check(selection.every(id=>byId.has(id)),'selected-sector-missing');
 const snapshot={...s,returnWindow:sr.returnWindow,amountWindow:sr.amountWindow??null};
 const membership={...m,sectors:selection.map(id=>byId.get(id)),knownAt:mrBound.knownAt,evidenceId:mrBound.evidenceId};
 return {frame:{snapshot,membership,asOf:end,knownAt:srBound.knownAt,evidenceId:srBound.evidenceId},rawEvidence:{snapshot:srBound,membership:mrBound}};
}
function candidateCoverage(candidates,risk,snapshot,asOf,current,receiptInput){
 const base={status:'unknown',reason:null,scope:'supplied-candidate-pool-only',candidateCount:null,uniqueCodes:null,duplicates:null,invalid:null,observedResearchCount:null,blockedCount:null,unknownCount:null,observedShare:null,actualExecutableCount:null,netProfitableCount:null,profitabilityVerified:false};
 if(!current)return {...base,reason:'market-structure-not-current'};
 if(!Array.isArray(candidates)||candidates.length>LIMITS.maxCandidates)return {...base,reason:'candidate-list-invalid'};
 // A producer's displayed intersection is bounded, not proof of total coverage.
 const counts=new Map();let invalid=0;
 for(const c of candidates){if(!c||fake(c)||!code(c.code)||(c.symbol!==undefined&&c.symbol!==c.code)){invalid++;continue;}counts.set(c.code,(counts.get(c.code)||0)+1);}
 const duplicates=[...counts.values()].reduce((n,v)=>n+v-1,0),meta={candidateCount:candidates.length,uniqueCodes:counts.size,duplicates,invalid};
 let bound;
 try{bound=receipt(candidates,receiptInput,'candidate-universe',receiptInput?.source,receiptInput?.observedAt,asOf);check(receiptInput.tradeDate===snapshot.date&&day(bound.observedAt)===snapshot.date&&receiptInput.expectedCount===candidates.length,'candidate-denominator-not-declared');}catch(e){return {...base,...meta,reason:e.message};}
 if(invalid||duplicates)return {...base,...meta,evidenceId:bound.evidenceId,reason:'candidate-identity-ambiguous'};
 if(!risk||risk.mode!=='read-only'||risk.canTrade!==false||risk.rankingModified!==false||!Array.isArray(risk.items)||risk.items.length>LIMITS.maxCandidates)return {...base,...meta,evidenceId:bound.evidenceId,reason:'risk-projection-unavailable'};
 const byCode=new Map(),quotes=new Map(snapshot.stocks.map(r=>[r.code,r]));
 for(const r of risk.items){if(!r||!code(r.code)||!counts.has(r.code)||byCode.has(r.code)||r.canTrade!==false||!['blocked','unknown','research-only'].includes(r.riskStatus))return {...base,...meta,evidenceId:bound.evidenceId,reason:'risk-projection-identity-conflict'};byCode.set(r.code,r);}
 let observed=0,blocked=0,unknown=0;
 for(const c of candidates){const r=byCode.get(c.code),q=quotes.get(c.code);
  if(c.isST===true||c.suspended===true||c.tradable===false||r?.riskStatus==='blocked'){blocked++;continue;}
  if(q&&classifyQuoteTime(q,{requestDate:snapshot.date,retrievedAt:asOf}).quoteTimeStatus==='recent-source-unverified'&&r?.riskStatus==='research-only'&&r.evidenceReady===true&&r.quoteTimeStatus==='recent-source-unverified')observed++;else unknown++;
 }
 return {...base,...meta,status:'declared-unverified',evidenceId:bound.evidenceId,reason:null,observedResearchCount:observed,blockedCount:blocked,unknownCount:unknown,observedShare:counts.size?observed/counts.size:null};
}
function evidenceSummary(sectors,profile,current){
 if(!current)return {support:[],counter:[],recheck:['fresh-comparable-capture-required'],scenario:'unknown',forecast:null};
 const p=profile.participation,support=[],counter=[];
 if(p){const fact={scope:'declared-universe',upShare:p.upShare,downShare:p.downShare,medianPct:p.medianPct};if(p.upShare>.5&&p.medianPct>0)support.push({...fact,reason:'broad-positive-participation'});if(p.downShare>.5||p.medianPct<0)counter.push({...fact,reason:'weak-participation'});}
 for(const s of sectors.sectors){const fact={scope:'sector',id:s.id,absolutePct:s.absolutePct,relativePct:s.relativePct,phaseObservation:s.phaseObservation};if(s.opportunityObservation==='observed-dual-positive')support.push({...fact,reason:'absolute-and-relative-positive-observation'});if(s.opportunityObservation==='relative-only'||['retreat-clue','narrowing-clue'].includes(s.phaseObservation))counter.push({...fact,reason:s.phaseObservation==='retreat-clue'||s.phaseObservation==='narrowing-clue'?s.phaseObservation:'relative-strength-without-positive-return'});}
 return {support,counter,recheck:['original-quote-expiry','new-sample-or-membership-revision','participation-or-sector-strength-change','upstream-risk-veto-or-missing-receipt'],scenario:'conditional-observations-only',forecast:null};
}
/** Receives the actual current capture from the existing caller, not a substitute from shadow input. */
function reviewLiveMarketShadow({snapshot,membership,candidates=[],riskEvidence,shadow,asOf}={}){
 const base={schemaVersion:1,mode:'shadow-existing-capture-audit',status:'unknown',reason:null,asOf,marketAsOf:null,expiresAt:null,sourceEvidence:[],calendarEvidence:[],structure:null,profile:null,candidateCoverage:notKnown('current-evidence-unavailable'),scenario:evidenceSummary(null,null,false),authenticatedReceipts:false,verifiedLive:false,...FLAGS};
 try{
  check(stamp(asOf)&&shadow&&!fake(shadow)&&Array.isArray(shadow.history)&&shadow.history.length>=2&&shadow.history.length<LIMITS.maxFrames,'capture-history-or-clock-invalid');
  const ids=shadow.sectorIds;check(Array.isArray(ids)&&ids.length>=3&&ids.length<=LIMITS.maxSelectedSectors&&ids.every(sectorId)&&new Set(ids).size===ids.length,'explicit-sector-selection-invalid');
  const records=[...shadow.history,{snapshot,membership,snapshotReceipt:shadow.snapshotReceipt,membershipReceipt:shadow.membershipReceipt}];
  const starts=records.map(c=>iso(c?.snapshot?.startedAt));check(starts.every(t=>t!==null),'capture-clock-invalid');
  const calendars=readCalendars(shadow.calendars,Math.min(...starts));
  const mapped=records.map(c=>mapCapture(c,asOf,[...ids].sort(),calendars));
  // A receipt may repeat for unchanged membership/calendar, not for different bytes or roles.
  const used=new Map();const bind=(r,role)=>{const value=JSON.stringify([role,r.source,r.observedAt,r.knownAt,r.contentSha256]);check(!used.has(r.evidenceId)||used.get(r.evidenceId)===value,'capture-receipt-reused-across-evidence');used.set(r.evidenceId,value);};
  for(const x of calendars.values())bind(x.bound,'calendar');for(const m of mapped){bind(m.rawEvidence.snapshot,'snapshot');bind(m.rawEvidence.membership,'membership');}
  const frames=mapped.map(m=>m.frame),structure=analyzeIntradaySectorStructure(frames,{asOf});check(structure.status!=='unknown',structure.reason||'structure-unavailable');
  const profile=analyzeIntradayMarketProfile(frames,{asOf});check(profile.status!=='unknown'&&profile.marketAsOf===structure.marketAsOf&&profile.expiresAt===structure.expiresAt,'profile-alignment-invalid');
  const current=structure.status==='declared-unverified'&&profile.status==='declared-unverified';
  const candidateReport=candidateCoverage(candidates,riskEvidence,snapshot,asOf,current,shadow.candidateReceipt);
  if(candidateReport.evidenceId&&used.has(candidateReport.evidenceId))return {...base,reason:'candidate-receipt-reused-across-evidence'};
  return {...base,status:structure.status,marketAsOf:structure.marketAsOf,expiresAt:structure.expiresAt,sourceEvidence:mapped.map(m=>m.rawEvidence),calendarEvidence:[...calendars].map(([exchange,v])=>({exchange,...v.bound,calendarCertified:false})),structure,profile,candidateCoverage:candidateReport,scenario:evidenceSummary(structure,profile,current)};
 }catch(e){return {...base,reason:e.message};}
}
module.exports={reviewLiveMarketShadow};
