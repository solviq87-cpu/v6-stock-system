'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const host='https://af3c7822e6aafc135.app.workbuddy.host';
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
test('reference config records verified official API while deployment still fails closed',()=>{
 const cfg=JSON.parse(read('V6_BO/config/china-workbuddy-write-target.example.json'));
 assert.equal(cfg.origin,host);
 assert.equal(cfg.documentation.pathname,'/console');
 assert.deepEqual(cfg.documentation.query,{});
 assert.equal(cfg.documentation.accessStatus,'http-200-official-guide-verified');
 assert.equal(cfg.writeEndpoint,'/api/publish');
 assert.equal(cfg.writeMethod,'POST');
 assert.equal(cfg.credentialNames.docShareCode,'V6_WORKBUDDY_SHARECODE');
 assert.equal(cfg.deployTargetResource,null);
 assert.equal(cfg.providerAuthorized,false);
 assert.equal(cfg.productionDeployed,false);
});
test('handoff source never embeds a credential-bearing share URL',()=>{
 const files=[...refs,'V6_BO/config/china-workbuddy-write-target.example.json',
  'V6_BO/docs/AUTO_UPDATE_WORKBUDDY_20261113.md'];
 for(const file of files){
  const source=read(file);
  assert.doesNotMatch(source,/[?&]sharecode\s*=\s*[A-Za-z0-9]{4,}/i,
    'share codes belong to private runtime storage: '+file);
 }
});
test('documentation distinguishes historical auth failures and verified reads from deployment',()=>{
 const s=read(doc);
 assert.match(s,/历史记录/);
 assert.match(s,/401/);
 assert.match(s,/GET \/console/);
 assert.match(s,/POST \/api\/publish/);
 assert.match(s,/尚未执行写入/);
 assert.match(s,/无分享码.*403/);
 assert.match(s,/不是已验证的写入 endpoint/);
 assert.match(s,/未执行/);
 assert.match(s,/禁止/);
});

test('automatic update handoff discloses the secret blocker and exact CI gate',()=>{
 const s=read('V6_BO/docs/AUTO_UPDATE_WORKBUDDY_20261113.md');
 assert.ok(s.includes(host));
 for(const text of ['403','V6_WORKBUDDY_SHARECODE','verify-web','精确','尚未激活','加密','--apply'])
  assert.ok(s.includes(text),'missing honest automation constraint: '+text);
});
