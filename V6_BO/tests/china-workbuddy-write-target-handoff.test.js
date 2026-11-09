'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const host='https://acd98a1c1a46e6ce4.app.workbuddy.host';
const doc='V6_BO/docs/CHINA_WORKBUDDY_WRITE_TARGET.md';
const refs=['AGENTS.md','README.md','V6_BO/README.md','V6_BO/AGENTS.md',
  'V6_BO/RESTORE.md','V6_BO/integration/CHAT_HANDOFF.md',doc];
test('every AI entrypoint retains exact user-designated China write destination',()=>{
 for(const file of refs)
  assert.ok(read(file).includes(host),'missing WorkBuddy target in '+file);
 assert.ok(read('AGENTS.md').includes(doc));
 assert.ok(read('V6_BO/AGENTS.md').includes('docs/CHINA_WORKBUDDY_WRITE_TARGET.md'));
 assert.ok(read('V6_BO/RESTORE.md').includes('历史恢复记录'));
});
test('reference config fails closed: protected documentation is not an invented writing API',()=>{
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
test('handoff source never embeds a credential-bearing share URL',()=>{
 const files=[...refs,'V6_BO/config/china-workbuddy-write-target.example.json'];
 for(const file of files){
  const source=read(file);
  assert.doesNotMatch(source,/[?&]sharecode\s*=\s*[A-Za-z0-9]{4,}/i,
    'share codes belong to private runtime storage: '+file);
 }
});
test('documentation distinguishes 401 from successful deployment',()=>{
 const s=read(doc);
 assert.match(s,/401/);
 assert.match(s,/不是已验证的写入 endpoint/);
 assert.match(s,/未执行/);
 assert.match(s,/禁止/);
});
