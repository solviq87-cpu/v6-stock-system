'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
test('desktop and mobile expose the same accessible read-only diagnostic',()=>{
 for(const page of ['public/index.html','public/mobile.html']){
  const html=read(page);
  assert.match(html,/id="v6UiHealthRun"/);
  assert.match(html,/id="v6UiHealth" role="status" aria-live="polite"/);
  assert.match(html,/assets\/ui-health\.js\?v=20261105ui46/);
  assert.match(html,/v6-design\.css\?v=20261105ui46/);
 }
});
test('diagnostic never sends a write request or exposes returned account data',()=>{
 const src=read('public/assets/ui-health.js');
 assert.match(src,/\/api\/state/);
 assert.match(src,/cache:'no-store'/);
 assert.doesNotMatch(src,/method:\s*['"]POST|innerHTML|\/api\/paper\/action/);
 assert.match(src,/btn\.disabled=true/);
 assert.match(src,/finally\{pending=false;btn\.disabled=false/);
});
