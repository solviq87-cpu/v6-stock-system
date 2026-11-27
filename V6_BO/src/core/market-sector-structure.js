'use strict';
// Intraday shadow observations only. Reuses frozen membership and raw quote clocks.
const {freezeSectorMemberIdentity}=require('./sector-member-identity-proof');
const {classifyQuoteTime,chinaMarketWindowHint}=require('./market-snapshot-quote-time');
const FLAGS=Object.freeze({canTrade:false,canNotify:false,canOpenRisk:false,weightsChanged:false,autoPromotion:false,certified:false});
const RULES=Object.freeze({minFrames:3,maxFrames:12,minGapMs:15000,maxGapMs:90000,maxSectors:30,maxStocks:10000});
const stamp=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000;
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const iso=t=>{if(typeof t!=='string')return null;const n=Date.parse(t);return stamp(n)&&new Date(n).toISOString()===t?n:null;};
const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=160;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pct=x=>finite(x)&&x>=-100&&x<=100;
const amount=x=>finite(x)&&x>=0;
const sum=x=>x.reduce((s,n)=>s+n,0);
const avg=x=>sum(x)/x.length;
const key=x=>x.category+'|'+x.code;
const order=(a,b)=>a<b?-1:a>b?1:0;
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const positive=x=>x.absolutePct>0&&x.relativePct>0;
const rankTolerance=1e-9;
function session(t){const h=chinaMarketWindowHint(t);return h.continuousTradingWindowHint?day(t)+'|'+h.window:null;}
function freezeFrame(f,asOf){
 const s=f?.snapshot,m=f?.membership,t=f?.asOf,k=f?.knownAt;
 if(!stamp(t)||!stamp(k)||t>k||k>asOf||!str(f.evidenceId)||!s||!m||f.simulated===true||s.simulated===true||m.simulated===true||
  s.source!=='eastmoney-clist-unverified-live'||s.date!==day(t)||s.returnWindow!=='session-to-date'||!session(t)||session(k)!==session(t)||
  !Number.isSafeInteger(s.universeSize)||s.universeSize<5||s.universeSize>RULES.maxStocks||!Array.isArray(s.stocks)||s.stocks.length!==s.universeSize)
  throw Error('frame-clock-scope-or-universe-invalid');
 const start=iso(s.startedAt),end=iso(s.retrievedAt);
 if(start===null||end!==t||start>end||end-start>120000||session(start)!==session(t))throw Error('frame-sampling-invalid');
 if(m.tradeDate!==s.date||!stamp(m.observedAt)||!stamp(m.knownAt)||m.observedAt>m.knownAt||m.knownAt>start||day(m.observedAt)!==s.date||!str(m.evidenceId)||!str(m.provider)||!str(m.classificationVersion)||!Array.isArray(m.sectors)||m.sectors.length>RULES.maxSectors)
  throw Error('membership-not-known-at-sampling');
 const proof=freezeSectorMemberIdentity(m);
 if(proof.status!=='identity-frozen-unverified')throw Error('membership-identity-invalid');
 const quotes=new Map();
 for(const r of s.stocks){
  if(!r||typeof r.code!=='string'||!/^\d{6}$/.test(r.code)||quotes.has(r.code)||!pct(r.pctChange)||(r.suspended!=null&&r.suspended!==false)||r.simulated===true||
   (r.symbol!=null&&r.symbol!==r.code)||(r.source!=null&&r.source!==s.source)||(r.tradeDate!=null&&r.tradeDate!==s.date)||
   classifyQuoteTime(r,{requestDate:s.date,retrievedAt:t}).quoteTimeStatus!=='recent-source-unverified'||session(r.vendorQuoteAt)!==session(t))throw Error('quote-identity-return-or-time-invalid');
  quotes.set(r.code,r);
 }
 const sectors=[...m.sectors].sort((a,b)=>order(key(a),key(b)));
 for(const a of sectors)if(!str(a.name)||a.members.some(c=>!quotes.has(c)))throw Error('sector-members-outside-frozen-universe');
 const ids=[...quotes.keys()].sort(),unit=s.sourceCoverage?.monetaryUnit;
 const amountOK=s.amountWindow==='session-to-date'&&str(unit)&&[...quotes.values()].every(r=>amount(r.amount)&&(r.amountUnit==null||r.amountUnit===unit)&&(r.monetaryUnit==null||r.monetaryUnit===unit));
 const totalAmount=amountOK?sum(ids.map(c=>quotes.get(c).amount)):null;
 const marketPct=avg(ids.map(c=>quotes.get(c).pctChange));
 const stats=sectors.map(a=>{const values=[...a.members].sort().map(c=>quotes.get(c).pctChange),absolutePct=avg(values);return {id:key(a),category:a.category,code:a.code,absolutePct,relativePct:absolutePct-marketPct,upShare:values.filter(v=>v>0).length/values.length};});
 for(const r of stats){const peers=stats.filter(x=>x.category===r.category);r.rank=peers.length<3?null:1+peers.filter(x=>x.relativePct-r.relativePct>rankTolerance).length;r.uniqueLead=r.rank===1&&peers.filter(x=>Math.abs(x.relativePct-r.relativePct)<=rankTolerance).length===1&&positive(r);}
 const identity=JSON.stringify([m.provider,m.classificationVersion,proof.sectors.map(x=>[key(x),x.memberSha256]),sectors.map(x=>[key(x),x.name])]);
 const expiry=Math.min(Date.parse(s.date+(chinaMarketWindowHint(t).window==='morning-continuous-window'?'T11:30:00+08:00':'T14:57:00+08:00')),...ids.map(c=>quotes.get(c).vendorQuoteAt+90000));
 if(k>=expiry)throw Error('frame-known-after-original-expiry');
 return {t,k,evidenceId:f.evidenceId,membershipEvidenceId:m.evidenceId,identity,proof,sectors,ids,quotes,unit:amountOK&&finite(totalAmount)?unit:null,totalAmount:amountOK&&finite(totalAmount)?totalAmount:null,stats,marketPct,session:session(t),expiry};
}
function turnover(frames,members){
 const unavailable=reason=>({status:'unknown',reason,marketShare:null,topTwoShare:null,hhi:null,intervalMarketShare:null});
 if(frames.some(f=>f.unit===null||f.unit!==frames[0].unit))return unavailable('amount-coverage-or-unit-incomplete');
 for(let i=1;i<frames.length;i++)if(frames[i].ids.some(c=>frames[i].quotes.get(c).amount<frames[i-1].quotes.get(c).amount))return unavailable('cumulative-amount-reset');
 const last=frames.at(-1),prev=frames.at(-2),a=members.map(c=>last.quotes.get(c).amount).sort((x,y)=>y-x),total=sum(a);
 if(!finite(total)||total<=0||last.totalAmount<=0)return unavailable('nonpositive-total-amount');
 const delta=c=>last.quotes.get(c).amount-prev.quotes.get(c).amount;
 const marketDelta=sum(last.ids.map(delta)),sectorDelta=sum([...members].sort().map(delta));
 if(!finite(marketDelta)||!finite(sectorDelta))return unavailable('amount-delta-overflow');
 return {status:'declared-unverified',reason:null,monetaryUnit:last.unit,marketShare:Math.min(1,total/last.totalAmount),topTwoShare:sum(a.slice(0,2))/total,hhi:sum(a.map(x=>(x/total)**2)),intervalMarketShare:marketDelta>0?Math.min(1,sectorDelta/marketDelta):null};
}
function cohorts(first,last,members){
 const gain=members.filter(c=>first.quotes.get(c).pctChange>0).sort((a,b)=>first.quotes.get(b).pctChange-first.quotes.get(a).pctChange||order(a,b));
 if(gain.length<2||(gain.length>2&&first.quotes.get(gain[1]).pctChange===first.quotes.get(gain[2]).pctChange))return {status:'unknown',reason:'initial-leader-cutoff-ambiguous',leaders:[],leaderChangePp:null,otherChangePp:null,relation:'unknown'};
 const leaders=gain.slice(0,2),others=members.filter(c=>!leaders.includes(c));
 const delta=cs=>avg(cs.map(c=>last.quotes.get(c).pctChange-first.quotes.get(c).pctChange));
 const l=delta(leaders),o=delta(others);
 return {status:'declared-unverified',reason:null,leaders,leaderChangePp:l,otherChangePp:o,relation:l>0&&o<=0?'leaders-up-others-not-up':l<0&&o>0?'leaders-down-others-up':l>0&&o>0?'both-improving':l<0&&o<0?'both-weakening':'mixed'};
}
function phase(series,cohort){
 const first=series[0],prev=series.at(-2),last=series.at(-1);
 if(positive(prev)&&!positive(last)&&last.upShare<prev.upShare&&last.absolutePct<prev.absolutePct)return 'retreat-clue';
 if(positive(last)&&last.upShare<first.upShare&&cohort.relation==='leaders-up-others-not-up')return 'narrowing-clue';
 if(positive(last)&&positive(prev)&&!positive(first)&&last.upShare>first.upShare)return 'formation-clue';
 if(positive(last)&&last.upShare>first.upShare&&last.absolutePct>first.absolutePct&&cohort.otherChangePp>0)return 'expansion-clue';
 if(positive(last)&&positive(prev)&&last.absolutePct>prev.absolutePct&&last.upShare>=prev.upShare)return 'strengthening-clue';
 return 'mixed-observation';
}
function analyzeIntradaySectorStructure(frames,{asOf}={}){
 const base={schemaVersion:1,mode:'shadow-intraday-sector-structure',status:'unknown',reason:null,asOf,marketAsOf:null,expiresAt:null,observations:[],sectors:[],overlapScope:'within-category; sector shares not additive across groups',crowdingConfirmed:false,profitabilityVerified:false,...FLAGS};
 const fail=reason=>({...base,reason});
 if(!stamp(asOf)||!Array.isArray(frames)||frames.length<RULES.minFrames||frames.length>RULES.maxFrames)return fail('invalid-or-insufficient-frames');
 try{
  const fs=frames.map(f=>freezeFrame(f,asOf)),first=fs[0],last=fs.at(-1),evidence=new Set();
  for(let i=0;i<fs.length;i++){
   const f=fs[i],p=fs[i-1];
   if(evidence.has(f.evidenceId)||f.identity!==first.identity||!equal(f.ids,first.ids)||f.session!==first.session)throw Error('evidence-duplicate-or-cohort-session-changed');
   evidence.add(f.evidenceId);
   if(p&&(f.t-p.t<RULES.minGapMs||f.t-p.t>RULES.maxGapMs||p.k>f.t||f.k<=p.k||f.ids.some(c=>f.quotes.get(c).vendorQuoteAt<=p.quotes.get(c).vendorQuoteAt)))throw Error('nonforward-or-discontinuous-original-observation');
  }
  const counts=new Map();for(const s of first.sectors)for(const c of s.members)counts.set(s.category+'|'+c,(counts.get(s.category+'|'+c)||0)+1);
  const sectors=first.sectors.map((s,i)=>{
   const series=fs.map(f=>f.stats[i]),latest=series.at(-1),cohort=cohorts(first,last,[...s.members].sort());
   return {...latest,name:s.name,memberCount:s.members.length,overlappingMembers:s.members.filter(c=>counts.get(s.category+'|'+c)>1).length,
    membershipSha256:first.proof.sectors.find(x=>key(x)===key(s)).memberSha256,
    observedLead:series.every(r=>r.uniqueLead)?'persistent-observed-lead':latest.uniqueLead?'new-leading-observation':series.slice(0,-1).some(r=>r.uniqueLead)?'lost-leading-observation':'no-unique-lead',
    rankHistory:series.map(r=>r.rank),cohort,turnover:turnover(fs,s.members),phaseObservation:phase(series,cohort),
    opportunityObservation:positive(latest)?'observed-dual-positive':latest.relativePct>0?'relative-only':'no-dual-positive',
    historicalNetEdge:'unknown',canTrade:false,canNotify:false};
  });
  const current=asOf<last.expiry&&session(asOf)===last.session;
  return {...base,status:current?'declared-unverified':'historical-unverified',marketAsOf:last.t,expiresAt:last.expiry,marketReturnPct:last.marketPct,
   observations:fs.map(f=>({asOf:f.t,knownAt:f.k,evidenceId:f.evidenceId,membershipEvidenceId:f.membershipEvidenceId})),sectors};
 }catch(e){return fail(e.message);}
}
module.exports={analyzeIntradaySectorStructure};
