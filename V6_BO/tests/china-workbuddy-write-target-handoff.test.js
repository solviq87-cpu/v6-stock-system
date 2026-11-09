'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const host='https://acd98a1c1a46e6ce4.app.workbuddy.host';
const doc='V6_BO/docs/CHINA_WORKBUDDY_WRITE_TARGET.md';
const refs=['AGENTS.md','README.md','V6_BO/AGENTS.md','V6_BO/RESTORE.md','V6_BO/integration/CHAT_HANDOFF.md',doc];
test('future V6 maintainers can discover exact user-specified China write target without chat memory',()=>{
 for(const file of refs)
  assert.ok(read(file).includes(host),'missing WorkBuddy target in '+file);
 assert.ok(read('AGENTS.md').includes(doc));
 assert.ok(read('V6_BO/AGENTS.md').includes('docs/CHINA_WORKBUDDY_WRITE_TARGET.md'));
 assert.ok(read('V6_BO/RESTORE.md').includes('历史恢复记录'));
});
test('reference config has explicit authorization gaps, not an invented write API or deployment',()=>{
 const cfg=JSON.parse(read('V6_BO/config/china-workbuddy-write-target.example.json'));
 assert.equal(cfg.origin,host);
 assert.equal(cfg.documentation.pathname,'/api/ai/doc');
 assert.equal(cfg.documentation.query.id,'ai');
 assert.equal(cfg.documentation.accessStatus,'http-401-invalid-or-missing-token');
 assert.equal(cfg.writeEndpoint,null);
 assert.equal(cfg.writeMethod,null);
 assert.equal(cfg.deployTargetResource,null);
 assert.equal(cfg.providerAuthorized,false);
 assert.equal(cfg.productionDeployed,false);
});
test('no shared URL credential is persisted in onboarding documents or machine config',()=>{
 const files=[...refs,'V6_BO/config/china-workbuddy-write-target.example.json'];
 for(const file of files){
  const source=read(file);
  assert.ok(!source.includes('3FZJAR4PPH'),'the supplied sharecode must not be committed: '+file);
  assert.ok(!source.includes('sharecode='),'sharecode must come from the private credential store: '+file);
 }
});
test('docs distinguish protected documentation from verified deployment and prohibit guessing',()=>{
 const s=read(doc);
 assert.match(s,/401/);
 assert.match(s,/不是已验证的写入 endpoint/);
 assert.match(s,/未执行/);
 assert.match(s,/禁止/);
});
