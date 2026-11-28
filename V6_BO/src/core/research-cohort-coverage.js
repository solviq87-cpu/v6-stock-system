'use strict';
// Original observation and alignment counts are preserved. This is a
// descriptive coverage report, never a new rank, weight or approval rule.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const key=r=>JSON.stringify([r?.id,r?.code,r?.day]);
function researchCohortCoverage(observations,alignment,expectedFactors=[]){
 const base={mode:'research-attempt-coverage-v1',status:'unknown',attempts:null,aligned:null,excluded:null,duplicateChecks:null,coverage:null,reasons:{},factors:[],canTrade:false,canApprove:false,productionWeightsChanged:false};
 if(!Array.isArray(observations)||observations.length>10000||!Array.isArray(alignment?.samples)||!Array.isArray(alignment?.rejected)||!Array.isArray(expectedFactors)||expectedFactors.length>256)return base;
 const pending=new Map(),originals=new Map(),reasons=Object.create(null),ids=new Set(expectedFactors);
 const signature=r=>JSON.stringify([r.market,Object.keys(r.values||{}).sort().map(k=>[k,r.values[k]])]);
 const valid=r=>r&&typeof r.id==='string'&&r.id.length>0&&typeof r.code==='string'&&r.code.length>0&&typeof r.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.day);
 for(const r of observations){if(!valid(r))return base;const k=key(r);pending.set(k,(pending.get(k)||0)+1);if(!originals.has(k))originals.set(k,new Set());originals.get(k).add(signature(r));for(const id of Object.keys(r.values||{}))ids.add(id);}
 if(ids.size>256||[...ids].some(id=>typeof id!=='string'||!id||id.length>128))return base;
 for(const r of [...alignment.samples,...alignment.rejected]){if(!valid(r)||!pending.get(key(r)))return base;pending.set(key(r),pending.get(key(r))-1);}
 if([...pending.values()].some(n=>n!==0))return base;
 for(const r of alignment.rejected){if(typeof r.reason!=='string'||!r.reason)return base;reasons[r.reason]=(reasons[r.reason]||0)+1;}
 const groups=new Set();for(const r of alignment.samples){const k=JSON.stringify([r.market,r.code,r.day]);if(!r.market||groups.has(k)||!finite(r.returnPct)||r.canTrade!==false||!originals.get(key(r))?.has(signature(r)))return base;groups.add(k);}
 const factors=[...ids].sort().map(id=>{const observed=observations.filter(r=>Object.hasOwn(r.values||{},id)&&finite(r.values[id])),mature=alignment.samples.filter(r=>Object.hasOwn(r.values||{},id)&&finite(r.values[id]));return {factorId:id,attempts:observations.length,observed:observed.length,unknown:observations.length-observed.length,observedZero:observed.filter(r=>r.values[id]===0).length,aligned:mature.length,notAlignedOrUnknown:observations.length-mature.length,coverage:observations.length?mature.length/observations.length:null};});
 return {...base,status:observations.length?'observed-coverage':'no-observations',attempts:observations.length,aligned:alignment.samples.length,excluded:alignment.rejected.length,duplicateChecks:reasons['duplicate-symbol-day-check']||0,coverage:observations.length?alignment.samples.length/observations.length:null,reasons,factors};
}
module.exports={researchCohortCoverage};
