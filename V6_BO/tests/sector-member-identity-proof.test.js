'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fingerprintSectorMembers,freezeSectorMemberIdentity,
 compareSectorMemberIdentity}=require('../src/core/sector-member-identity-proof');
const baseCodes=['600001','600002','600003','600004','600005'];
const membership=(date='2026-11-04')=>({
 schemaVersion:1,source:'imported',provider:'baostock:query_stock_industry',
 classificationVersion:'csrc-frozen-v1',tradeDate:date,
 observedAt:Date.parse(date+'T09:20:00+08:00'),
 sectors:[0,1,2].map(i=>({category:'industry',code:'BS_'+i,
  memberCount:5,members:baseCodes.map(x=>String(Number(x)+i*100))}))
});
const freeze=x=>freezeSectorMemberIdentity(x);
test('stable hash is insensitive to member ordering and trade date',()=>{
 const a=membership(),b=membership('2026-11-05');
 b.sectors[0].members.reverse();
 const x=freeze(a),y=freeze(b);
 assert.equal(x.status,'identity-frozen-unverified');
 assert.equal(compareSectorMemberIdentity(x,y).status,'identity-matched-unverified');
 assert.equal(compareSectorMemberIdentity(x,y).canTrain,false);
});
test('same member count with replaced symbol is blocked',()=>{
 const a=membership(),b=membership('2026-11-05');
 b.sectors[0].members[0]='699999';
 const r=compareSectorMemberIdentity(freeze(a),freeze(b));
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'member-identity-drift');
 assert.equal(r.canTrade,false);
});
test('duplicates and invalid symbols cannot produce proof',()=>{
 const a=membership();a.sectors[0].members[0]=a.sectors[0].members[1];
 assert.equal(freeze(a).status,'blocked');
 assert.equal(fingerprintSectorMembers({...membership().sectors[0],members:['x']}).status,'blocked');
});
test('missing proof and altered digest never silently pass',()=>{
 const a=freeze(membership()),b=freeze(membership('2026-11-05'));
 assert.equal(compareSectorMemberIdentity(a,null).status,'unknown');
 delete b.sectors[0].memberSha256;
 assert.equal(compareSectorMemberIdentity(a,b).status,'unknown');
});
test('provider and classification drift block',()=>{
 const a=membership(),b=membership('2026-11-05');
 b.classificationVersion='new-classification';
 assert.equal(compareSectorMemberIdentity(freeze(a),freeze(b)).reason,
  'classification-or-provider-drift');
 b.classificationVersion=a.classificationVersion;b.provider='different';
 assert.equal(compareSectorMemberIdentity(freeze(a),freeze(b)).status,'blocked');
});
test('changed sector set and nonforward date block',()=>{
 const a=freeze(membership()),b=freeze(membership('2026-11-05'));
 b.sectors.pop();
 assert.equal(compareSectorMemberIdentity(a,b).reason,'sector-set-changed');
 assert.equal(compareSectorMemberIdentity(a,a).reason,'non-forward-trading-date');
});
test('research helper never mutates inputs or authorizes model learning',()=>{
 const a=membership(),b=membership('2026-11-05');
 const before=JSON.stringify({a,b});
 const r=compareSectorMemberIdentity(freeze(a),freeze(b));
 assert.equal(JSON.stringify({a,b}),before);
 assert.equal(r.comparable,true);
 assert.equal(r.canTrain,false);
 assert.equal(r.canTrade,false);
 assert.equal(r.weightsChanged,false);
});
