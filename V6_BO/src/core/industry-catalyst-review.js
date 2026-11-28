'use strict';
// Additional declared-document diagnostics for the existing event review.
// No data fetch, causal assertion, price target, new strategy or trade right.
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const str=(x,n=180)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/.test(x);
const url=x=>{try{const u=new URL(x);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
const quote=(body,clause)=>str(body,50000)&&str(clause,1000)&&body.includes(clause);
const clean=r=>r&&!['retracted','synthetic','fixture','simulated','mock'].some(k=>r[k]===true)&&!['test','demo','synthetic'].includes(r.sampleSet)&&!/(?:^|[-_:/\.\s])(?:mock|synthetic|fixture|test|demo|simulated)(?:$|[-_:/\.\s])/i.test(String(r.source||''));
const proof=(r,cutoff)=>clean(r)&&str(r.id)&&str(r.source,160)&&Number.isSafeInteger(r.revision)&&r.revision>0&&[r.publishedAt,r.firstKnownAt,r.recordedAt].every(time)&&r.publishedAt<=r.firstKnownAt&&r.firstKnownAt<=r.recordedAt&&r.recordedAt<=cutoff&&url(r.sourceUrl)&&r.bodyScope==='declared-body';
const reference=r=>({id:r.id,source:r.source,revision:r.revision,recordedAt:r.recordedAt,sourceUrl:r.sourceUrl});
const literalNumber=(clause,n,unit)=>finite(n)&&[...clause.matchAll(/[-+]?\d+(?:\.\d+)?/g)].some(m=>Number(m[0])===n&&clause.slice(m.index+m[0].length).trimStart().startsWith(unit));
const measured=(m,body,cutoff)=>m&&str(m.metric,80)&&str(m.period,80)&&str(m.unit,60)&&finite(m.value)&&time(m.observedAt)&&time(m.knownAt)&&m.observedAt<=m.knownAt&&m.knownAt<=cutoff&&quote(body,m.clause)&&literalNumber(m.clause,m.value,m.unit)&&m.clause.includes(m.period)&&m.clause.includes(m.unit);
function industryReview(event,relations=[]){
 const out={mode:'declared-industry-review-v1',status:'unknown',businessPaths:[],conceptObservations:[],benefitAmount:null,lagVerified:false,canTrade:false,canNotify:false};
 if(!time(event?.recordedAt)||!code(event?.symbol)||!Array.isArray(relations)||relations.length>2000)return out;
 // A selected current relation can only qualify if it was already known and
 // valid at this event's receipt. Names alone are never security identities.
 for(const r of relations){
  if(!proof(r,event.recordedAt)||r.from!==event.symbol||!id(r.to)||!time(r.validFrom)||r.validFrom>event.recordedAt||r.validUntil!=null&&(!time(r.validUntil)||r.validUntil<=event.recordedAt))continue;
  if(r.relationClass==='concept'){if(out.conceptObservations.length<20)out.conceptObservations.push({entityId:r.to,evidence:reference(r),role:'observation-only'});continue;}
  if(r.relationClass!=='business'||!id(r.productId)||!['upstream','midstream','downstream'].includes(r.stage)||!quote(r.documentText,r.businessClause)||out.businessPaths.length>=20)continue;
  const a=r.industryFacts||{},revenue=a.revenue,order=a.order;
  let revenueShare=null,orderEvidence=null;
  if(revenue&&measured(revenue.related,r.documentText,r.recordedAt)&&measured(revenue.total,r.documentText,r.recordedAt)&&revenue.related.metric==='related-revenue'&&revenue.total.metric==='total-revenue'&&revenue.related.period===revenue.total.period&&revenue.related.unit===revenue.total.unit&&revenue.related.value>=0&&revenue.total.value>0&&revenue.related.value<=revenue.total.value&&revenue.related.clause!==revenue.total.clause){
   revenueShare={status:'declared-ratio',period:revenue.total.period,unit:revenue.total.unit,relatedRevenue:revenue.related.value,totalRevenue:revenue.total.value,share:revenue.related.value/revenue.total.value,clauses:[revenue.related.clause,revenue.total.clause]};
  }
  if(order&&['signed','delivered'].includes(order.status)&&time(order.confirmedAt)&&order.confirmedAt<=r.publishedAt&&quote(r.documentText,order.clause)&&(order.status==='signed'?/(已签署|已签订|合同已生效)/:/(已交付|完成交付|已验收)/).test(order.clause)&&!/(意向|尚未|未签|预计|拟签|取消|终止)/.test(order.clause))orderEvidence={status:'declared-confirmed-order',stage:order.status,confirmedAt:order.confirmedAt,clause:order.clause,realizedRevenue:null};
  const indicators=Array.isArray(a.indicators)?a.indicators.slice(0,30).filter(m=>['inventory','demand','price'].includes(m?.metric)&&measured(m,r.documentText,r.recordedAt)).map(m=>({metric:m.metric,period:m.period,unit:m.unit,value:m.value,observedAt:m.observedAt,knownAt:m.knownAt,clause:m.clause})):[];
  const c=a.costExposure,shock=event.costShock;
  let costDirection=null;
  if(c&&shock&&c.productId===r.productId&&shock.productId===r.productId&&['input-cost','output-price'].includes(c.role)&&quote(r.documentText,c.clause)&&proof(event,event.recordedAt)&&quote(event.body,shock.clause)&&['rising','falling'].includes(shock.direction)&&time(shock.observedAt)&&shock.observedAt<=event.publishedAt){
   costDirection={status:'declared-exposure-hypothesis',role:c.role,priceDirection:shock.direction,pressure:(c.role==='input-cost')===(shock.direction==='rising')?'adverse':'favorable',clause:c.clause,shockClause:shock.clause,profitImpact:null};
  }
  out.businessPaths.push({entityId:r.to,productId:r.productId,stage:r.stage,evidence:reference(r),businessClause:r.businessClause,revenueShare,orderEvidence,indicators,costDirection,benefitAmount:null});
 }
 out.status=out.businessPaths.length?'declared-business-review':out.conceptObservations.length?'concept-observation-only':'unknown';return out;
}
function catalystReview(event,events=[]){
 const out={mode:'catalyst-receipt-review-v1',status:'unknown',plannedAt:null,actualAt:null,previousPlannedAt:null,policyExpectation:null,expiresAt:null,active:false,canTrade:false,canNotify:false};
 if(!proof(event,event?.recordedAt))return out;
 const c=event.catalyst;
 if(c&&id(c.id)&&['planned','rescheduled','cancelled','occurred'].includes(c.status)&&quote(event.body,c.clause)){
  // Preserve original scheduled and actual timestamps separately. A scheduled
  // date does not prove occurrence; cancellations never grant an active signal.
  if(time(c.plannedAt)&&(c.status!=='rescheduled'||time(c.previousPlannedAt)&&c.previousPlannedAt!==c.plannedAt)){
   out.status=c.status;out.plannedAt=c.plannedAt;out.previousPlannedAt=c.status==='rescheduled'?c.previousPlannedAt:null;
   if(c.status==='occurred'&&time(c.actualAt)&&c.actualAt<=event.publishedAt&&quote(event.body,c.actualClause)&&c.actualClause!==c.plannedClause&&!/(预计|拟于|尚未|计划)/.test(c.actualClause))out.actualAt=c.actualAt;
   if(c.status==='occurred'&&out.actualAt===null)out.status='occurrence-unverified';
  }
 }
 const p=event.policyExpectation;
 if(p&&id(p.policyId)&&str(p.draftId)&&str(p.draftSource,160)&&quote(event.body,p.formalClause)&&Array.isArray(events)&&events.length<=10000){
  const matches=events.filter(r=>r.id===p.draftId&&r.source===p.draftSource&&r.policyDraft?.policyId===p.policyId&&proof(r,event.publishedAt-1)&&r.publishedAt<event.publishedAt&&quote(r.body,r.policyDraft.clause));
  if(matches.length===1){const d=matches[0];out.policyExpectation={status:'declared-text-comparison',draft:reference(d),draftClause:d.policyDraft.clause,formalClause:p.formalClause,exactClauseChanged:d.policyDraft.clause!==p.formalClause,surpriseDirection:null};}
 }
 // Calendar schedule is not a trading opportunity and has no inferred lifetime.
 return out;
}
function textBaseline(event){
 const out={mode:'literal-text-baseline-v1',status:'unknown',sentences:[],entityIds:[],independentlyVerified:false,canTrade:false};
 if(!proof(event,event?.recordedAt)||!str(event.body,50000))return out;
 // Preserve exact sentences, not generated summaries or inferred entities.
 const sentences=event.body.match(/[^。！？；\n]+[。！？；]?/g)||[];
 for(const s of sentences.slice(0,100)){
  const sentence=s.trim();if(!str(sentence,1000))continue;
  const negated=/(澄清|否认|辟谣|尚未|未签|不涉及|不存在|取消|终止)/.test(sentence);
  if(negated||/(政策|订单|主营|收入|成本|公告|业绩)/.test(sentence))out.sentences.push({quote:sentence,negationHint:negated});
  if(out.sentences.length>=12)break;
 }
 if(code(event.symbol))out.entityIds=[event.symbol];out.status=out.sentences.length?'literal-clues-only':'no-selected-sentence';return out;
}
module.exports={industryReview,catalystReview,textBaseline};
