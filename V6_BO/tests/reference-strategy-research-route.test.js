'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('native four-strategy research route is POST-only and editor-gated',()=>{
  const start=server.indexOf("if (p === '/api/reference-strategy-research')");
  assert.ok(start>=0);
  const block=server.slice(start,start+2200);
  assert.match(block,/req\.method !== 'POST'/);
  assert.match(block,/requireEditor\(res,req\.__tok,req\)/);
  assert.match(block,/8 \* 1024 \* 1024/);
  assert.match(block,/runNativeDaily\(payload\.history/);
  assert.match(block,/不代表实时行情、可成交收益或实盘表现/);
});

test('research route does not write account or trigger order operations',()=>{
  const start=server.indexOf("if (p === '/api/reference-strategy-research')");
  const block=server.slice(start,start+2200);
  assert.doesNotMatch(block,/paperService\.(buy|sell)|placeOrder|writeFileSync/);
});
