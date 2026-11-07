'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/research.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/assets/research-workbench.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('rule comparison workbench has explicit input, button, status and details',()=>{
 for(const id of ['rulePayload','ruleAnalyze','ruleStatus','ruleSummary','ruleDetails'])assert.match(html,new RegExp('id="'+id+'"'));
});
test('UI sends authorized independent comparison request and escapes table values',()=>{
 assert.match(js,/fetch\('\/api\/research\/rule-comparison'/);
 assert.match(js,/Authorization.*Bearer/);
 assert.match(js,/rows\.map\(x=>/);
 assert.match(js,/esc\(x\.label/);
 assert.match(js,/不改变线上选股排名/);
});
test('comparison route requires developer and size bound and keeps original ranking separate',()=>{
 const at=server.indexOf("if (p === '/api/research/rule-comparison')");assert.ok(at>0);
 const route=server.slice(at,at+1350);
 assert.match(route,/requireEditor\(res,req\.__tok,req\)/);
 assert.match(route,/256\*1024/);
 assert.match(route,/compareRuleSystems/);
 assert.match(route,/verifiedLive:false/);
 assert.match(server,/if \(p === '\/api\/strategy\/dashboard'\)/);
});
