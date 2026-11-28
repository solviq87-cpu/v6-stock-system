'use strict';
// Projection of the existing research journal's selected events/relations.
// No publisher certification, source fetch, order or notification authority.
const {createHash}=require('node:crypto');
const Journal=require('./news-evidence-journal');
const {industryReview,catalystReview,textBaseline}=require('./industry-catalyst-review');
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const str=(x,n=2000)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const href=x=>{try{const u=new URL(x);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
const excluded=x=>['synthetic','fixture','simulated','mock','retracted'].some(k=>x?.[k]===true)||['test','demo','synthetic'].includes(x?.sampleSet)||/(?:^|[-_:/\.\s])(?:mock|synthetic|fixture|test|demo|simulated)(?:$|[-_:/\.\s])/i.test(String(x?.source||''));
const proof=(r,at)=>r&&!excluded(r)&&str(r.id,180)&&str(r.source,160)&&Number.isSafeInteger(r.revision)&&r.revision>0&&[r.publishedAt,r.firstKnownAt,r.recordedAt].every(time)&&r.publishedAt<=r.firstKnownAt&&r.firstKnownAt<=r.recordedAt&&r.recordedAt<=at&&(href(r.sourceUrl)||str(r.evidenceId,256));
const ref=r=>({id:r.id,source:r.source,revision:r.revision,evidenceId:r.evidenceId??null,recordedAt:r.recordedAt});
const excerpt=(body,value)=>str(body,50000)&&str(value,1000)&&body.includes(value);
const full=r=>r.bodyScope==='declared-body'&&href(r.sourceUrl)&&str(r.body,50000);
const sameIdentity=r=>JSON.stringify([r.source,r.id]);
// Imported text remains a declaration. A raw journal entry may only be used
// when its actual archive reference and security association match the event.
function eventText(e,archive){
 const row=archive.get(e.evidenceId),x=row?.evidence;
 if(x&&row.sequence===e.revision&&row.recordedAt===e.recordedAt&&x.source===e.source&&x.kind!=='retracted'&&x.securities?.includes(e.symbol)&&x.url===e.sourceUrl&&x.title===e.title&&x.receivedAt===e.firstKnownAt&&(x.kind==='original'?x.publishedAt:x.revisedAt)===e.publishedAt){
  return {...e,body:x.body,bodyScope:x.bodyScope};
 }
 return e;
}
function pathsFor(e,relations,{entity,product,region}={}){
 if(!code(e.symbol)||!str(entity,180))return [];
 return relations.filter(r=>proof(r,e.recordedAt)&&str(r.from,180)&&str(r.to,180)&&r.from!==r.to&&str(r.relation,80)&&r.relationClass==='business'&&r.bodyScope==='declared-body'&&href(r.sourceUrl)&&time(r.validFrom)&&r.validFrom<=e.recordedAt&&(r.validUntil==null||time(r.validUntil)&&r.validUntil>e.recordedAt)&&
  (r.from===e.symbol&&r.to===entity||r.to===e.symbol&&r.from===entity)&&
  (product===undefined||r.productId===product)&&(region===undefined||r.marketRegion===region)&&excerpt(r.documentText,r.businessClause))
  .slice(0,20).map(r=>({entity,productId:r.productId??null,marketRegion:r.marketRegion??null,businessClause:r.businessClause,evidence:ref(r)}));
}
function policyPath(e,relations){
 const p=e.policyApplicability,base={status:'unknown',reason:'policy-clause-or-business-document-missing',paths:[],impactDirection:null,benefitAmount:null};
 if(!full(e)||!p||!str(p.productId,180)||!str(p.entityId,180)||!excerpt(e.body,p.clause))return base;
 const paths=pathsFor(e,relations,{entity:p.entityId,product:p.productId});
 return {...base,status:paths.length?'declared-path-review':'unknown',reason:paths.length?null:base.reason,policyClause:p.clause,productId:p.productId,paths};
}
function explicitInstant(value,expected){
 if(typeof value!=='string')return false;
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
 if(!m||+m[2]>23||+m[3]>59||+m[4]>59||m[6]&&(+m[7]>23||+m[8]>59))return false;
 const t=Date.parse(m[1]+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===m[1]&&Date.parse(value)===expected;
}
function overseasPath(e,relations){
 const p=e.overseasEvent,base={status:'unknown',sourceTime:null,region:null,domesticExposure:null,paths:[],impactDirection:null,exposureAmount:null};
 // Explicit offset (including Z) is required; no host-timezone inference.
 if(!p||!str(p.region,120)||p.region==='CN'||!explicitInstant(p.publishedAtIso,e.publishedAt)||!full(e))return base;
 const paths=pathsFor(e,relations,{entity:p.entityId,region:p.region});
 return {...base,status:paths.length?'declared-path-review':'public-time-only',sourceTime:p.publishedAtIso,region:p.region,domesticExposure:paths.length?'declared-business-path':null,paths};
}
function issuerClue(e){
 const p=e.publisherEvidence;
 return full(e)&&p?.role==='issuing-entity'&&str(p.publisher,180)&&excerpt(e.body,p.clause)&&p.clause.includes(p.publisher)?{status:'declared-issuer-document',publisher:p.publisher,independentlyVerified:false}:{status:'authority-unknown',publisher:null,independentlyVerified:false};
}
function fundContext(e,authority){
 const f=e.fundActivity,base={status:'unknown',plan:null,executionDisclosure:null,executionRecord:null,buyerIdentity:null,amount:null,netSubscriptions:null,mechanisms:['arbitrage','passive-rebalance','hedging','directional-buying','stabilization'].map(kind=>({kind,status:'unknown'}))};
 if(!f||!full(e))return base;
 // A literal plan and a literal execution statement are separate declarations;
 // even an issuer statement is not a verified trade receipt.
 const plan=excerpt(e.body,f.planClause)?{clause:f.planClause,evidence:ref(e)}:null;
 const execute=authority.status==='declared-issuer-document'&&f.executionStatus==='reported-executed'&&excerpt(e.body,f.executionClause)&&f.executionClause!==f.planClause&&time(f.executionAt)&&f.executionAt<=e.publishedAt?{clause:f.executionClause,executionAt:f.executionAt,evidence:ref(e),independentlyVerified:false}:null;
 const mechanisms=base.mechanisms.map(m=>{const text=Array.isArray(f.mechanisms)?f.mechanisms.find(x=>x?.kind===m.kind&&excerpt(e.body,x.clause)):null;return text?{kind:m.kind,status:'declared-text-clue',clause:text.clause}:m;});
 return {...base,status:execute?'declared-execution-statement':plan?'declared-plan':'review-only',plan,executionDisclosure:execute,mechanisms};
}
function projectEventReview({events=[],relations=[],journalRows=[],account,asOf}={}){
 const empty={mode:'event-path-review-v1',status:'unknown',asOf,rows:[],reviewOrder:[],holdingsStatus:'unknown',sourceAuthorityVerified:false,notificationQueueVerified:false,canTrade:false,canNotify:false};
 if(!time(asOf)||!Array.isArray(events)||!Array.isArray(relations)||!Array.isArray(journalRows)||events.length>10000||relations.length>2000||journalRows.length>10000)return empty;
 // The existing versions() reader is authoritative for selected versions.
 // Defensively reject duplicate identities instead of choosing input order.
 const counts=new Map();for(const e of events){if(proof(e,asOf))counts.set(sameIdentity(e),(counts.get(sameIdentity(e))||0)+1);}
 const held=account&&['observed-account','incomplete-valuation'].includes(account.status)&&time(account.sourceAt)&&account.sourceAt<=asOf&&asOf-account.sourceAt<=15000&&Array.isArray(account.positions)&&account.positions.length<=1000&&account.positions.every(p=>code(p.symbol)&&Number.isSafeInteger(p.shares)&&p.shares>0)&&new Set(account.positions.map(p=>p.symbol)).size===account.positions.length?new Set(account.positions.map(p=>p.symbol)):null;
 const eligible=events.filter(e=>proof(e,asOf)&&(code(e.symbol)||e.symbol==null&&(e.overseasEvent||e.policyApplicability||e.fundActivity))&&counts.get(sameIdentity(e))===1).sort((a,b)=>Number(held?.has(b.symbol)===true)-Number(held?.has(a.symbol)===true)||b.recordedAt-a.recordedAt||a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
 const wanted=new Set(eligible.slice(0,100).map(e=>e.evidenceId).filter(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)));
 const archive=new Map();
 for(const row of journalRows){
  if(!row||!wanted.has(row.eventHash)||!time(row.recordedAt)||row.recordedAt>asOf||!row.evidence)continue;
  const {eventHash,...payload}=row;
  if(Journal.hash(payload)===eventHash)archive.set(eventHash,row);
 }
 const rows=[],groups=new Map();
 for(const raw of eligible.slice(0,100)){
  const e=eventText(raw,archive),authority=issuerClue(e),holdingRelated=held&&code(e.symbol)?held.has(e.symbol):null;
  const group=['declared-body','provider-summary'].includes(e.bodyScope)&&str(e.title,1000)&&str(e.body,50000)?hash([e.bodyScope,e.title,e.body]):hash([e.source,e.id,e.revision]);
  const row={event:ref(e),symbol:e.symbol??null,originalPublishedAt:e.originalPublishedAt??e.publishedAt,receivedAt:e.firstKnownAt,holdingRelated,authority,policy:policyPath(e,relations),overseas:overseasPath(e,relations),fund:fundContext(e,authority),industry:industryReview(e,relations),catalyst:catalystReview(e,events),textBaseline:textBaseline(e),group};
  rows.push(row);
  const g=groups.get(group)||{group,refs:[],symbols:new Set(),holdingRelated:null,authorityClue:false,latestRecordedAt:0};
  g.refs.push(row.event);if(code(row.symbol))g.symbols.add(row.symbol);if(holdingRelated===true)g.holdingRelated=true;else if(holdingRelated===false&&g.holdingRelated===null)g.holdingRelated=false;if(authority.status==='declared-issuer-document')g.authorityClue=true;g.latestRecordedAt=Math.max(g.latestRecordedAt,e.recordedAt);groups.set(group,g);
 }
 const reviewOrder=[...groups.values()].map(g=>({...g,symbols:[...g.symbols].sort(),sourceAuthorityVerified:false})).sort((a,b)=>Number(b.holdingRelated===true)-Number(a.holdingRelated===true)||Number(b.authorityClue)-Number(a.authorityClue)||b.latestRecordedAt-a.latestRecordedAt||a.group.localeCompare(b.group));
 return {...empty,status:rows.length?'declared-review':'unknown',holdingsStatus:held?'current-account-association':'unknown',rows,reviewOrder,eligibleEvents:eligible.length,truncatedEvents:Math.max(0,eligible.length-100)};
}
module.exports={projectEventReview};
