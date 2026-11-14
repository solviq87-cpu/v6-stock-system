'use strict';
/**
 * Immutable review catalogue of upstream DATA PUBLISHERS and wrapper routes.
 * A SDK route is not an independent vendor, and a registry entry never grants
 * copyright/usage permission, feed freshness, broker execution or live trust.
 */
// Some isolated server fixtures intentionally copy only src/ and no config/.
 // Missing or corrupt registries must NOT crash unrelated account/read-only
 // routes. Every actual lineage comparison still fails closed without them.
function guardedCatalogue(file){
 try{return require(file);}
 catch{return null;}
}
const registry=guardedCatalogue('../../config/data-source-registry-2026.json');
const legacy=guardedCatalogue('../../config/data-source-catalog.json');
const catalogAvailable=!!(registry&&legacy&&Array.isArray(registry.sources)&&Array.isArray(legacy.sources));
function requireCatalogue(){
 if(!catalogAvailable)throw Error('原始行情上游目录缺失或损坏，禁止多源核对放行');
}
const safe=/^[a-z][a-z0-9-]{0,63}$/;
const routes=new Map((registry?.sources||[]).map(x=>[x.id,Object.freeze({...x})]));
const baseIds=new Set((legacy?.sources||[]).map(x=>x.id));
function sourceLineage(id){
 if(typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(id))return null;
 const r=routes.get(id);
 if(!r)return {id,known:false,upstreamGroup:null,upstreamAmbiguous:true,
  dataClass:null,access:'unreviewed',adapter:'unregistered',active:false,
  verifiedIndependent:false,canTrade:false};
 const ambiguous=r.upstreamGroup.startsWith('multi:');
 return {id:r.id,known:true,upstreamGroup:ambiguous?null:r.upstreamGroup,
  upstreamAmbiguous:ambiguous,dataClass:r.dataClass,market:r.market,
  access:r.access,adapter:r.adapter,active:false,
  verifiedIndependent:false,canTrade:false};
}
function resolveUpstream(id,declaredGroup){
 requireCatalogue();
 const r=sourceLineage(id);
 if(!r)throw Error('数据源标识格式无效');
 if(declaredGroup!==undefined&&(typeof declaredGroup!=='string'||!safe.test(declaredGroup)))
  throw Error('显式上游身份标记无效');
 const canonical=r.upstreamGroup;
 // Registered wrappers cannot disguise a known Eastmoney/Tencent/Sina/TDX
 // parent with a renamed upstream. Legacy native vendor overrides remain
 // research-only and are not elevated into verified identity.
 if(declaredGroup!==undefined&&canonical&&r.adapter!=='public-quote-probe'&&declaredGroup!==canonical)
  throw Error('登记包装源的上游身份与目录不一致: '+id);
 const group=declaredGroup??canonical??(r.known?null:id);
 return {id,group,known:r.known,ambiguous:group===null,
  catalogGroup:canonical,declared:declaredGroup!==undefined,
  verifiedIndependent:false,canTrade:false};
}
function sourceSummary(){
 requireCatalogue();
 const upstreams=new Set();
 const byAccess={};const byClass={};
 for(const s of registry.sources){
  upstreams.add(s.upstreamGroup);
  byAccess[s.access]=(byAccess[s.access]||0)+1;
  byClass[s.dataClass]=(byClass[s.dataClass]||0)+1;
 }
 return {schemaVersion:1,routeCount:routes.size,claimedUpstreamGroups:upstreams.size,
  underlyingProvidersVerified:0,authorizedLiveFeedsVerified:0,
  autoEnableNewProviders:false,canTrade:false,byAccess,byClass};
}
function validateRegistry(){
 requireCatalogue();
 if(registry.schemaVersion!==1||registry.productionEntitlementGranted!==false||
   registry.autoEnableNewProviders!==false||registry.defaultCanTrade!==false||
   registry.sources.length<14||routes.size!==registry.sources.length)
  throw Error('数据源目录必须为不启用新服务、无交易权限的完整登记');
 const legalAccess=new Set(['guarded-research','registered-only','permission-review','credentials-required','client-required']);
 for(const r of registry.sources){
  if(!safe.test(r.id)||typeof r.upstreamGroup!=='string'||
     !(safe.test(r.upstreamGroup)||/^multi:[a-z][a-z0-9-]*$/.test(r.upstreamGroup))||
     !legalAccess.has(r.access)||typeof r.dataClass!=='string'||!r.dataClass||
     !['CN','HK','US','KR','GLOBAL'].includes(r.market)||
     typeof r.evidenceUrl!=='string'||!/^https:\/\//.test(r.evidenceUrl)||typeof r.adapter!=='string')
   throw Error('数据源目录字段非法: '+r.id);
 }
 for(const id of baseIds)if(!routes.has(id))throw Error('原始14个数据源不允许删除: '+id);
 // Existing enabled Boastock research is not a license for every other source.
 const enabled=registry.sources.filter(x=>x.access==='guarded-research').map(x=>x.id).sort();
 if(JSON.stringify(enabled)!==JSON.stringify(['baostock','eastmoney-public-history']))
  throw Error('新增来源不得擅自启用采集');
 return sourceSummary();
}
module.exports={sourceLineage,resolveUpstream,sourceSummary,validateRegistry};
