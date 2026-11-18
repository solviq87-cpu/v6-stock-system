'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'public/assets/reference-portal.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/assets/reference-portal.css'),'utf8');
test('review card list covers all already-rendered distinct original stock codes, not first 12',()=>{
 assert.match(js,/reviewSource\?\.querySelectorAll\('\.rvc'\)/);
 assert.match(js,/const shown=new Set\(\)/);
 assert.match(js,/shown\.has\(code\)/);
 assert.match(js,/shown\.size>=200/);
 assert.doesNotMatch(js,/slice\(0,12\)/);
 assert.match(js,/当前原复盘已渲染/);
 assert.match(js,/不代表全市场涨停清单已独立核实/);
});
test('a stock row opens its own original detail or evidence button when available',()=>{
 assert.match(js,/link\.dataset\.reviewCode=code/);
 assert.match(js,/link\.addEventListener\('click'/);
 assert.match(js,/row\.querySelector\('\.rvc-h span\.muted'\)/);
 assert.match(js,/const evidence=latest\.querySelector\('\.rv-evidence-trigger'\)/);
 assert.match(js,/if\(evidence\)evidence\.click\(\)/);
 assert.match(js,/latest\.scrollIntoView\?\./);
 assert.match(js,/parent\.tagName==='DETAILS'\)parent\.open=true/);
});
test('read-only details keep provenance caveat and mobile scroll space',()=>{
 assert.match(js,/题材标签不是涨停原因因果认证/);
 assert.match(js,/原复盘明细与事件证据（如有）/);
 assert.match(css,/v6-portal-real-rows\{[\s\S]*?max-height:680px/);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.doesNotMatch(js,/\bfetch\s*\(|setInterval\s*\(/);
});
