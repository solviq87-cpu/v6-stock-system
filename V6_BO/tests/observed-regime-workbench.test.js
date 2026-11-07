'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/assets/research-workbench.js'),'utf8');
test('market research has accessible independent input, action and status',()=>{
 for(const id of ['marketPayload','marketAnalyze','marketStatus','marketSummary'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/aria-live="polite"/);
});
test('workbench posts explicit snapshot to editor-only observed regime endpoint',()=>{
 assert.match(js,/fetch\('\/api\/research\/observed-regime'/);
 assert.match(js,/Authorization.*Bearer /);
});
test('unusable classification does not display fabricated regime',()=>{
 assert.match(js,/if\(!result\.usable\)/);
 assert.match(js,/研究结论不可用/);
});
test('research panel labels data as not verified live and not altering selection',()=>{
 assert.match(html,/不改变选股结果/);
 assert.match(js,/未验证为实时行情，不影响原有选股策略/);
});
