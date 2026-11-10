'use strict';
/**
 * Pure research-only membership identity evidence. A count or classification
 * version is never proof that constituent identities remained unchanged.
 */
const {createHash}=require('node:crypto');
const symbolOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const id=x=>x.category+'|'+x.code;
function fingerprintSectorMembers(sector){
 if(!sector||!['industry','concept'].includes(sector.category)||
  typeof sector.code!=='string'||!/^[A-Za-z0-9_-]{2,30}$/.test(sector.code)||
  !Array.isArray(sector.members)||sector.members.length<5||
  sector.members.length>10000||sector.memberCount!==sector.members.length||
  sector.members.some(x=>!symbolOK(x))||
  new Set(sector.members).size!==sector.members.length)
  return {status:'blocked',reason:'invalid-or-duplicate-members'};
 const members=[...sector.members].sort();
 const canonical=JSON.stringify(['sector-members-v1',sector.category,sector.code,members]);
 return {status:'identity-frozen-unverified',category:sector.category,
  code:sector.code,memberCount:members.length,
  memberSha256:createHash('sha256').update(canonical,'utf8').digest('hex')};
}
function freezeSectorMemberIdentity(membership){
 const blocked=reason=>({schemaVersion:1,status:'blocked',reason,
  comparable:false,canTrain:false,canTrade:false,weightsChanged:false});
 if(membership?.schemaVersion!==1||membership.source!=='imported'||
  typeof membership.provider!=='string'||!membership.provider||
  typeof membership.classificationVersion!=='string'||!membership.classificationVersion||
  !/^\d{4}-\d{2}-\d{2}$/.test(membership.tradeDate||'')||
  !Number.isSafeInteger(membership.observedAt)||membership.observedAt<=0||
  !Array.isArray(membership.sectors)||membership.sectors.length<3||
  membership.sectors.length>300)return blocked('invalid-frozen-membership');
 const seen=new Set(),sectors=[];
 for(const sector of membership.sectors){
  const proof=fingerprintSectorMembers(sector);
  if(proof.status==='blocked'||seen.has(id(sector)))
   return blocked('invalid-or-duplicate-sector');
  seen.add(id(sector));sectors.push(proof);
 }
 sectors.sort((a,b)=>id(a).localeCompare(id(b),'en'));
 return {schemaVersion:1,status:'identity-frozen-unverified',
  tradeDate:membership.tradeDate,observedAt:membership.observedAt,
  membershipProvider:membership.provider,
  classificationVersion:membership.classificationVersion,
  sectors,comparable:false,canTrain:false,canTrade:false,
  weightsChanged:false,
  note:'指纹仅证明给定成员清单的身份，不证明源授权、行情真实性或历史收益'};
}
function compareSectorMemberIdentity(baseline,future){
 const fail=(status,reason)=>({schemaVersion:1,status,reason,
  comparable:false,canTrain:false,canTrade:false,weightsChanged:false});
 if(!baseline||!future||baseline.status!=='identity-frozen-unverified'||
  future.status!=='identity-frozen-unverified'||baseline.schemaVersion!==1||
  future.schemaVersion!==1||!Array.isArray(baseline.sectors)||
  !Array.isArray(future.sectors))return fail('unknown','missing-member-identity-proof');
 if(baseline.membershipProvider!==future.membershipProvider||
  baseline.classificationVersion!==future.classificationVersion)
  return fail('blocked','classification-or-provider-drift');
 if(typeof baseline.tradeDate!=='string'||typeof future.tradeDate!=='string'||
  future.tradeDate<=baseline.tradeDate)return fail('blocked','non-forward-trading-date');
 const proofMap=new Map();
 for(const proof of baseline.sectors){
  if(!proof||!['industry','concept'].includes(proof.category)||
   typeof proof.code!=='string'||!Number.isSafeInteger(proof.memberCount)||
   proof.memberCount<5||typeof proof.memberSha256!=='string'||
   !/^[a-f0-9]{64}$/.test(proof.memberSha256)||proofMap.has(id(proof)))
   return fail('unknown','invalid-baseline-proof');
  proofMap.set(id(proof),proof);
 }
 const seen=new Set();
 for(const proof of future.sectors){
  if(!proof||typeof proof.code!=='string'||seen.has(id(proof))||
   !Number.isSafeInteger(proof.memberCount)||
   typeof proof.memberSha256!=='string'||!/^[a-f0-9]{64}$/.test(proof.memberSha256))
   return fail('unknown','invalid-future-proof');
  seen.add(id(proof));
  const old=proofMap.get(id(proof));
  if(!old)return fail('blocked','sector-set-changed');
  if(old.memberCount!==proof.memberCount||old.memberSha256!==proof.memberSha256)
   return fail('blocked','member-identity-drift');
 }
 if(seen.size!==proofMap.size)return fail('blocked','sector-set-changed');
 return {schemaVersion:1,status:'identity-matched-unverified',
  comparable:true,checkedSectors:seen.size,canTrain:false,canTrade:false,
  weightsChanged:false,
  note:'仅成员身份匹配，仍需独立核验价格、时点和未来收益标签'};
}
module.exports={fingerprintSectorMembers,freezeSectorMemberIdentity,compareSectorMemberIdentity};
