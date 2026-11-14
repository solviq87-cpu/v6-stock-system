'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function functionBody(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b)}
test('automatic buy retains original account and does not notify after persistence failure',()=>{
 const body=functionBody('function paperBuy(', '// ---------------- A股 T+1');
 assert.match(body,/const beforeTrade = JSON\.parse\(JSON\.stringify\(acc\)\)/);
 assert.match(body,/if \(!savePaper\(\)\) \{[\s\S]*?Object\.assign\(acc, beforeTrade\);[\s\S]*?return;[\s\S]*?\}\s*pushPaperDigest/);
});
test('automatic sell restores cash, position and trade history if save fails',()=>{
 const body=functionBody('function paperSell(', '// 收益联动');
 assert.match(body,/const beforeTrade = JSON\.parse\(JSON\.stringify\(acc\)\)/);
 assert.match(body,/if \(!savePaper\(\)\) \{[\s\S]*?Object\.assign\(acc, beforeTrade\);[\s\S]*?return;[\s\S]*?\}\s*const pct/);
});
