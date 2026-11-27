'use strict';
// Operator-declared evidence for exact registered routes. Not a legal opinion,
// credential store, billing system, permission grant, or live feed activation.
const validTime=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const dense=x=>Array.isArray(x)&&Array.from(x,(_,i)=>Object.hasOwn(x,i)).every(Boolean);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(o,keys)=>object(o)&&Object.keys(o).every(k=>keys.includes(k));
const scopes=new Set(['personal-research','internal-research','historical-research','display','commercial-display','redistribution','model-training','broker-execution']);
const statuses=new Set(['declared-permitted','declared-restricted','declared-revoked','unknown']);
const currencies=new Set(['CNY','HKD','USD','JPY','EUR','GBP','KRW']);
const fail=()=>{throw Error('数据源许可或费用登记证据无效');};
function auditSourceCommercialEvidence({asOf,ledger,registeredRoutes}={}){
 if(!validTime(asOf)||!dense(registeredRoutes)||!registeredRoutes.length||
    !exact(ledger,['schemaVersion','mode','records'])||ledger.schemaVersion!==1||
    ledger.mode!=='operator-declared-source-commercial-evidence'||!dense(ledger.records)||
    ledger.records.length>registeredRoutes.length)fail();
 const ids=new Set(registeredRoutes.map(r=>r.id)),seen=new Map();
 if(ids.size!==registeredRoutes.length)fail();
 for(const record of ledger.records){
  if(!exact(record,['routeId','licenses','costs'])||typeof record.routeId!=='string'||
    !ids.has(record.routeId)||seen.has(record.routeId)||
    !dense(record.licenses)||record.licenses.length>32||
    !dense(record.costs)||record.costs.length>24||record.licenses.length+record.costs.length===0)fail();
  const licenses=[],costs=[],revisions=new Set(),expenseRefs=new Set();
  for(const l of record.licenses){
   if(!exact(l,['status','scope','observedAt','effectiveAt','expiresAt','documentSha256'])||
      !statuses.has(l.status)||!scopes.has(l.scope)||!validTime(l.observedAt)||
      l.observedAt>asOf||!validTime(l.effectiveAt)||!digest(l.documentSha256)||
      !(l.expiresAt===null||validTime(l.expiresAt)&&l.expiresAt>l.effectiveAt))fail();
   const identity=l.scope+':'+l.observedAt;
   if(revisions.has(identity))fail();
   revisions.add(identity);
   const currentDeclaredStatus=l.status!=='declared-permitted'?l.status:
    l.effectiveAt>asOf?'not-yet-effective':
    l.expiresAt!==null&&asOf>=l.expiresAt?'declared-expired':'declared-permitted';
   licenses.push({status:l.status,currentDeclaredStatus,scope:l.scope,observedAt:l.observedAt,
    effectiveAt:l.effectiveAt,expiresAt:l.expiresAt,documentSha256:l.documentSha256,
    independentlyVerified:false,licenseGrantsRuntimePermission:false});
  }
  // Latest actually known declaration for each use scope. Preserve previous
  // versions, including revoked states; do not revive an older permission.
  licenses.sort((a,b)=>a.scope.localeCompare(b.scope)||a.observedAt-b.observedAt);
  const currentByScope=new Map();
  for(const l of licenses)currentByScope.set(l.scope,l);
  for(const c of record.costs){
   if(!exact(c,['basis','currency','amountMinor','periodStartAt','periodEndAt','recordedAt','documentSha256'])||
      c.basis!=='reported-allocated-data-service-cost'||!currencies.has(c.currency)||
      !Number.isSafeInteger(c.amountMinor)||c.amountMinor<0||c.amountMinor>1e12||
      !validTime(c.periodStartAt)||!validTime(c.periodEndAt)||c.periodStartAt>=c.periodEndAt||
      !validTime(c.recordedAt)||c.recordedAt<c.periodEndAt||c.recordedAt>asOf||!digest(c.documentSha256)||
      expenseRefs.has(c.documentSha256))fail();
   expenseRefs.add(c.documentSha256);
   costs.push({basis:c.basis,currency:c.currency,amountMinor:c.amountMinor,
    periodStartAt:c.periodStartAt,periodEndAt:c.periodEndAt,recordedAt:c.recordedAt,
    documentSha256:c.documentSha256,independentlyVerified:false});
  }
  costs.sort((a,b)=>a.periodStartAt-b.periodStartAt||a.periodEndAt-b.periodEndAt);
  // This is allocated total cost for a route/window, not line items. Do not
  // add overlapping windows or convert unlike currencies into one total.
  if(costs.some((c,i)=>i>0&&c.periodStartAt<costs[i-1].periodEndAt))fail();
  seen.set(record.routeId,{licenseHistory:licenses,currentLicenseDeclarations:[...currentByScope.values()],reportedCosts:costs});
 }
 const routes=registeredRoutes.map(r=>({routeId:r.id,
  licenseHistory:seen.get(r.id)?.licenseHistory??[],currentLicenseDeclarations:seen.get(r.id)?.currentLicenseDeclarations??[],
  reportedCosts:seen.get(r.id)?.reportedCosts??[],
  costStatus:seen.get(r.id)?.reportedCosts.length?'declared-cost-unverified':'unknown-cost',
  actualAuthorizationVerified:false,costVerified:false,canTrade:false,productionEnabled:null}));
 return {schemaVersion:1,mode:'read-only-source-commercial-review',asOf,
  registeredRouteCount:routes.length,reportedLicenseRouteCount:routes.filter(r=>r.currentLicenseDeclarations.length>0).length,
  reportedCostRouteCount:routes.filter(r=>r.reportedCosts.length>0).length,
  actualAuthorizationVerifiedCount:0,actualCostVerifiedCount:0,routes,
  autoEnableNewProviders:false,canTrade:false,
  note:'逐确切路线、用途、可知时点登记许可声明与分摊费用；原文档摘要不等于文档真伪核验。费用缺失不是免费，明确登记0才是登记零费用；不同货币/周期不自动合并。历史记录保留，当前状态不授予实际调用、发布、模型或交易权限。'};
}
module.exports={auditSourceCommercialEvidence};
