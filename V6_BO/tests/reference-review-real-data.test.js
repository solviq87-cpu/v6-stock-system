'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'public/assets/reference-portal.js'),'utf8');
test('review screenshot derives counters from existing review summary, never fabricated counts',()=>{
 assert.match(src,/getElementById\('rvSummary'\)/);
 assert.match(src,/getElementById\('rvTime'\)/);
 assert.match(src,/共\\s\*/);
 assert.match(src,/findNumber\('首板'\)/);
 assert.match(src,/findNumber\('连板'\)/);
 assert.match(src,/findNumber\('题材'\)/);
 assert.match(src,/findNumber\('站5日线'\)/);
 assert.match(src,/findNumber\('破前高'\)/);
 assert.match(src,/metricValues\[i\]\.val\.textContent=valid\?String\(val\):'—'/);
 assert.doesNotMatch(src,/37\s*只|32\s*只|33\s*只/);
});
test('review stock rows reuse existing actual review cards and do not fetch independently',()=>{
 assert.match(src,/reviewSource\?\.querySelectorAll\('\.rvc'\)/);
 assert.match(src,/card\.querySelector\('\.rvc-reason'\)/);
 assert.match(src,/new root\.MutationObserver\(queueReviewSync\)/);
 assert.match(src,/reviewSync\(\)/);
 assert.doesNotMatch(src,/\bfetch\s*\(|setInterval\s*\(/);
});
test('stale or unknown review never promoted to current day stats',()=>{
 assert.match(src,/非当日\|日期未知\|可能非当日\|过期\|失败\|未知/);
 assert.match(src,/const total=!stale&&countMatch/);
 assert.match(src,/复盘尚未取得有效的当日数据/);
});
