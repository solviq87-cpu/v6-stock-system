'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createFixture}=require('./helpers/v6-studio-fixture');

// The old documents remain source/recovery evidence. These requests exercise the
// actual HTTP entry used by people; a static CSS presence check cannot certify
// that an alias still opens the previous application.
test('every existing product entry serves the independent FAYO application without importing the old frontend',async()=>{
 const service=await createFixture({count:3});
 try{
  const entries=['/','/m','/index.html','/mobile.html','/picks.html','/auction-picks.html','/reference-dashboard.html','/research.html','/model-library.html','/v6-studio.html','/v6-matches.html','/v6-research.html','/v6-validation.html','/v6-paper.html','/v6-market-radar.html'];
  for(const entry of entries){
   const response=await service.request(entry,'GET',null,'');
   assert.equal(response.status,200,entry+' keeps its public application shell');
   assert.match(response.headers['content-type'],/text\/html/,entry);
   assert.match(response.raw,/绯曜|FAYO/i,entry+' new product identity');
   assert.match(response.raw,/\/nova\/app\.js/,entry+' native app entry');
   assert.match(response.raw,/\/nova\/fayo\.css/,entry+' independent visual system');
   assert.doesNotMatch(response.raw,/<iframe\b|\/assets\/(?:app|terminal-dashboard|unified-workspace|original-workspace|v6-design|reference-match)\.(?:js|css)/i,entry+' must not embed or reskin the old frontend');
   assert.doesNotMatch(response.raw,/studio-fixture-only-password|synthetic-context-editor/,entry+' public shell has no account data');
   assert.match(response.headers['cache-control'],/no-store/,entry+' deployment updates must revalidate');
  }
  for(const resource of ['/nova/app.js','/nova/client.js','/nova/ui.js','/nova/market.js','/nova/research.js','/nova/operations.js','/nova/fayo.css']){
   const response=await service.request(resource,'GET',null,'');
   assert.equal(response.status,200,resource+' is served as an independent module');
   assert.match(response.headers['cache-control'],/no-store/,resource+' is not stuck behind the old worker cache');
   assert.doesNotMatch(response.raw,/import\s+(?:[^;]*?from\s*)?['"](?:\.\.\/assets\/|\/assets\/)(?:app|terminal-dashboard|unified-workspace|original-workspace)/,resource+' does not delegate controls to the previous app');
  }
  const manifest=await service.request('/manifest.json','GET',null,'');
  assert.match(manifest.body?.name||'',/绯曜/,'installed PWA receives the new product identity');
  assert.match(manifest.body?.short_name||'',/绯曜/,'home-screen label is also renamed');
  assert.doesNotMatch(JSON.stringify(manifest.body),/天枢|v6-reference/i,'new install metadata must not retain the previous brand');
  for(const icon of manifest.body?.icons||[]){
   assert.ok(icon.src.startsWith('/nova/'),'installed app uses the new mark');
   assert.equal((await service.request(icon.src,'GET',null,'')).status,200,'new brand mark is available');
  }
  // An open application document never grants access to account/order state.
  const denied=await service.request('/api/state','GET',null,'invalid-fayo-session');
  assert.ok(denied.status===401||denied.status===403||denied.body?.locked||denied.body?.needAuth,'an invalid session is still denied by the existing server');
  const allowed=await service.request('/api/state');
  assert.equal(allowed.status,200,'the existing authenticated service remains usable');
  assert.ok(allowed.body&&typeof allowed.body==='object','same API produces server-authoritative state');
 }finally{await service.close();}
});

test('a fresh worker install caches the complete eager module graph needed to show the offline gate',async()=>{
 const listeners={},cached=new Set();let install;
 const publicRoot=path.resolve(__dirname,'../public');
 vm.runInNewContext(fs.readFileSync(path.join(publicRoot,'sw.js'),'utf8'),{
  self:{addEventListener:(type,fn)=>{listeners[type]=fn;},skipWaiting:()=>Promise.resolve()},
  caches:{open:async()=>({addAll:async urls=>urls.forEach(url=>cached.add(new URL(url,'https://fayo.invalid').pathname))})}
 });
 listeners.install({waitUntil:promise=>{install=promise;}});await install;
 const visited=new Set();
 function requireCachedModule(url){
  if(visited.has(url))return;visited.add(url);
  assert.ok(cached.has(url),'offline startup dependency must be in the installed shell: '+url);
  const source=fs.readFileSync(path.join(publicRoot,url),'utf8');
  for(const match of source.matchAll(/\bimport\s+(?:[^;'"\n]*?\s+from\s*)?['"](\.[^'"]+)['"]/g)){
   requireCachedModule(new URL(match[1],'https://fayo.invalid'+url).pathname);
  }
 }
 requireCachedModule('/nova/app.js');
 assert.ok(visited.size>=5,'checks the real transitive graph, including evidence helpers');
 assert.equal([...cached].some(url=>url.startsWith('/api/')),false,'offline shell never includes private data');
});
