'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
for(const name of ['paperBuy','paperSell'])test(name+' stops notification on authoritative commit failure',()=>{
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1),body=source.slice(start,end);
 assert.match(body,/const committed=savePaper\('sync',key\);if\(!committed\)return;/);
 assert.ok(body.indexOf('if(!committed)return;')<body.indexOf('pushPaperDigest('));
});
test('savePaper rolls memory back by reloading the durable authority',()=>{
 const body=source.slice(source.indexOf('function savePaper('),source.indexOf('// ---------------- 模拟盘对账'));
 assert.match(body,/refreshPaperAuthority\(true\)/);assert.match(body,/_diskFail\('权威模拟账户提交失败'\)/);
});
