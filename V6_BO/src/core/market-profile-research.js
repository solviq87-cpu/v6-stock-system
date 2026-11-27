'use strict';
// Read-only market profiles over the existing frozen intraday frame contract.
const {analyzeIntradaySectorStructure,freezeIntradayResearchFrame:freeze}=require('./market-sector-structure');
const FLAGS=Object.freeze({canTrade:false,canNotify:false,canOpenRisk:false,weightsChanged:false,autoPromotion:false,certified:false});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const stamp=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000;
const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=160;
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const dayOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const clock=t=>(t+28800000)%86400000;
const sum=a=>a.reduce((s,v)=>s+v,0),avg=a=>sum(a)/a.length;
const median=a=>{const b=[...a].sort((x,y)=>x-y),i=Math.floor(b.length/2);return b.length%2?b[i]:(b[i-1]+b[i])/2;};
const sd=a=>{const m=avg(a);return Math.sqrt(avg(a.map(v=>(v-m)**2)));};
const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const unavailable=reason=>({status:'unknown',reason});
function metrics(f){const v=f.ids.map(c=>f.quotes.get(c).pctChange);return {meanPct:avg(v),medianPct:median(v),dispersionPp:sd(v),upShare:v.filter(n=>n>0).length/v.length,downShare:v.filter(n=>n<0).length/v.length};}
function interval(a,b){const v=b.ids.map(c=>b.quotes.get(c).pctChange-a.quotes.get(c).pctChange);return {durationMs:b.t-a.t,meanChangePp:avg(v),dispersionPp:sd(v),downMoveShare:v.filter(n=>n<0).length/v.length};}
function turnover(a,b){if(!a.unit||a.unit!==b.unit||a.totalAmount===null||b.totalAmount===null||b.ids.some(c=>b.quotes.get(c).amount<a.quotes.get(c).amount))return null;const delta=sum(b.ids.map(c=>b.quotes.get(c).amount-a.quotes.get(c).amount));return finite(delta)?{unit:b.unit,cumulative:b.totalAmount,interval:delta}:null;}
function currentActivity(fs){for(let i=1;i<fs.length;i++)if(!turnover(fs[i-1],fs[i]))return null;return turnover(fs.at(-2),fs.at(-1));}
function readPartitions(p,f){
 if(!p||p.simulated===true||p.tradeDate!==day(f.t)||!str(p.source)||!str(p.version)||!str(p.evidenceId)||!stamp(p.observedAt)||!stamp(p.knownAt)||day(p.observedAt)!==p.tradeDate||p.observedAt>p.knownAt||p.knownAt>f.samplingStart||!Array.isArray(p.partitions)||p.partitions.length<1||p.partitions.length>3)throw Error('profile-membership-not-known-or-invalid');
 const kinds=new Set(),all=[];
 for(const part of p.partitions){if(!['board','size','style'].includes(part?.kind)||kinds.has(part.kind)||!Array.isArray(part.groups)||part.groups.length<2||part.groups.length>20)throw Error('profile-partition-invalid');kinds.add(part.kind);
  const seen=new Set(),labels=new Set(),groups=[];
  for(const g of part.groups){if(!str(g?.id)||labels.has(g.id)||!Array.isArray(g.members)||!g.members.length)throw Error('profile-group-invalid');labels.add(g.id);const members=[...g.members].sort();for(const c of members){if(typeof c!=='string'||!f.quotes.has(c)||seen.has(c))throw Error('profile-membership-overlap-or-identity-invalid');seen.add(c);}groups.push({id:g.id,members});}
  if(seen.size!==f.ids.length)throw Error('profile-membership-incomplete');all.push({kind:part.kind,groups:groups.sort((a,b)=>a.id.localeCompare(b.id,'en'))});
 }
 all.sort((a,b)=>a.kind.localeCompare(b.kind,'en'));return {source:p.source,version:p.version,evidenceId:p.evidenceId,partitions:all,identity:JSON.stringify([p.source,p.version,all])};
}
function profiles(input,fs){
 if(!Array.isArray(input)||input.length!==fs.length)return unavailable('profile-membership-missing');
 try{const ps=input.map((p,i)=>readPartitions(p,fs[i])),first=ps[0],last=fs.at(-1);if(ps.some(p=>p.identity!==first.identity))throw Error('profile-membership-drift');
 const parts=first.partitions.map(part=>{const groups=part.groups.map(g=>{const v=g.members.map(c=>last.quotes.get(c).pctChange),meanPct=avg(v),prior=avg(g.members.map(c=>fs[0].quotes.get(c).pctChange));return {id:g.id,memberCount:v.length,meanPct,medianPct:median(v),upShare:v.filter(n=>n>0).length/v.length,relativeToUniversePp:meanPct-last.marketPct,changeFromFirstPp:meanPct-prior};});const top=Math.max(...groups.map(g=>g.meanPct)),bottom=Math.min(...groups.map(g=>g.meanPct));return {kind:part.kind,groups,leader:groups.filter(g=>Math.abs(g.meanPct-top)<=1e-9).length===1?groups.find(g=>g.meanPct===top).id:null,spreadPp:top-bottom};});
 return {status:'declared-unverified',reason:null,source:first.source,version:first.version,evidenceIds:ps.map(p=>p.evidenceId),partitions:parts};}catch(e){return unavailable(e.message);}
}
function baselineReport(b,fs){
 const last=fs.at(-1),prev=fs.at(-2),nowTurn=currentActivity(fs);
 const empty=reason=>({...unavailable(reason),days:[],amount:null,dispersion:null});
 if(!b||b.simulated===true||!str(b.calendar?.source)||!str(b.calendar?.evidenceId)||!stamp(b.calendar?.knownAt)||b.calendar.knownAt>prev.t||!Array.isArray(b.calendar.tradeDates)||!Array.isArray(b.sessions))return empty('baseline-calendar-or-sessions-missing');
 const dates=b.calendar.tradeDates;
 if(dates.length<4||dates.length>21||dates.at(-1)!==day(last.t)||dates.some((d,i)=>!dayOK(d)||(i>0&&d<=dates[i-1]))||b.sessions.length!==dates.length-1)return empty('baseline-calendar-window-invalid');
 try{const used=new Set(fs.map(f=>f.evidenceId)),samples=[];for(let i=0;i<b.sessions.length;i++){
  const pair=b.sessions[i];if(!Array.isArray(pair)||pair.length!==2)throw Error('baseline-pair-invalid');const a=freeze(pair[0],prev.t),z=freeze(pair[1],prev.t);
  if(day(a.t)!==dates[i]||day(z.t)!==dates[i]||clock(a.t)!==clock(prev.t)||clock(z.t)!==clock(last.t)||a.k>z.t||z.k<=a.k||a.identity!==z.identity||!eq(a.ids,last.ids)||!eq(z.ids,last.ids)||a.ids.some(c=>z.quotes.get(c).vendorQuoteAt<=a.quotes.get(c).vendorQuoteAt)||used.has(a.evidenceId)||used.has(z.evidenceId)||a.evidenceId===z.evidenceId)throw Error('baseline-window-cohort-or-time-mismatch');
  used.add(a.evidenceId);used.add(z.evidenceId);samples.push({date:dates[i],evidenceIds:[a.evidenceId,z.evidenceId],turn:turnover(a,z),dispersion:metrics(z).dispersionPp,interval:interval(a,z).dispersionPp});}
 const ratio=(v,m)=>m>0&&finite(v/m)?v/m:null;
 const disp=median(samples.map(s=>s.dispersion)),int=median(samples.map(s=>s.interval));let activity=null;
 if(nowTurn&&samples.every(s=>s.turn&&s.turn.unit===nowTurn.unit)){const c=median(samples.map(s=>s.turn.cumulative)),d=median(samples.map(s=>s.turn.interval));activity={unit:nowTurn.unit,current:nowTurn,medianCumulative:c,medianInterval:d,cumulativeRatio:ratio(nowTurn.cumulative,c),intervalRatio:ratio(nowTurn.interval,d)};}
 return {status:'declared-unverified',reason:null,calendarSource:b.calendar.source,calendarEvidenceId:b.calendar.evidenceId,calendarCertified:false,days:samples.map(({date,evidenceIds})=>({date,evidenceIds})),amount:activity,dispersion:{medianSessionPp:disp,medianIntervalPp:int,sessionRatio:ratio(metrics(last).dispersionPp,disp),intervalRatio:ratio(interval(prev,last).dispersionPp,int)}};
 }catch(e){return empty(e.message);}
}
function correlation(a,b){if(a.length<4)return null;const ma=avg(a),mb=avg(b),x=a.map(v=>v-ma),y=b.map(v=>v-mb),den=Math.sqrt(sum(x.map(v=>v*v))*sum(y.map(v=>v*v)));if(den<=Number.EPSILON)return null;return Math.max(-1,Math.min(1,sum(x.map((v,i)=>v*y[i]))/den));}
function overlap(fs){const s=fs[0].sectors,edges=[],sameDuration=fs.slice(1).every((f,i)=>f.t-fs[i].t===fs[1].t-fs[0].t);for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++){const a=s[i],b=s[j];if(a.category!==b.category)continue;const bm=new Set(b.members),shared=a.members.filter(c=>bm.has(c)).length;
 const values=k=>fs.slice(1).map((f,n)=>f.stats[k].absolutePct-fs[n].stats[k].absolutePct);edges.push({from:a.category+'|'+a.code,to:b.category+'|'+b.code,sharedMembers:shared,jaccard:shared/(a.members.length+b.members.length-shared),coMovement:sameDuration?correlation(values(i),values(j)):null,intervalCount:fs.length-1,independentEvidence:false,causal:false});}return edges;}
function analyzeIntradayMarketProfile(frames,{asOf,profileMemberships,baseline}={}){
 const base={schemaVersion:1,mode:'shadow-market-profile',status:'unknown',reason:null,marketAsOf:null,expiresAt:null,participation:null,profiles:unavailable('no-current-evidence'),activity:null,baseline:unavailable('no-current-evidence'),topicEdges:[],microLiquidity:unavailable('bid-ask-depth-and-execution-unavailable'),...FLAGS};
 const study=analyzeIntradaySectorStructure(frames,{asOf});if(study.status==='unknown')return {...base,reason:study.reason};
 try{const fs=frames.map(f=>({...freeze(f,asOf),samplingStart:Date.parse(f.snapshot.startedAt)})),last=fs.at(-1),prev=fs.at(-2);return {...base,status:study.status,marketAsOf:last.t,expiresAt:study.expiresAt,participation:{...metrics(last),interval:interval(prev,last)},profiles:profiles(profileMemberships,fs),activity:currentActivity(fs),baseline:baselineReport(baseline,fs),topicEdges:overlap(fs)};}catch(e){return {...base,reason:e.message};}
}
module.exports={analyzeIntradayMarketProfile};
