'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('iPhone 17 Pro 402x874 is exercised on the actual legacy mobile route in all three browser suites',()=>{
 const layout=read('scripts/ui-reference-browser-check.js');
 const unified=read('scripts/ui-unified-workspace-browser-check.js');
 const originals=read('scripts/ui-original-workspace-browser-check.js');
 assert.match(layout,/\['phone-402',402,874,'\/m'\]/);
 assert.match(unified,/const widths = \[320,375,390,393,402,430,1366,1536,1920\]/);
 assert.match(unified,/width===402\?874:/);
 assert.match(originals,/\{url:'\/m',width:402\}/);
 assert.match(originals,/width===402\?874:/);
});
test('iPhone checks retain real source HTML, synthetic data restriction, and no trade writes',()=>{
 const unified=read('scripts/ui-unified-workspace-browser-check.js');
 const originals=read('scripts/ui-original-workspace-browser-check.js');
 assert.match(unified,/serviceWorkers:'block'/);
 assert.match(originals,/serviceWorkers:'block'/);
 assert.match(unified,/synthetic read-only HTTP/);
 assert.match(unified,/business writes/);
});
