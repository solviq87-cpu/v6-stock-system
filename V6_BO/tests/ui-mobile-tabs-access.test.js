'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('public/mobile.html','utf8');
const css=fs.readFileSync('public/assets/v6-design.css','utf8');
test('mobile research entry is hidden until developer role is confirmed',()=>{
 assert.match(html,/id="v6MobileResearchEntry"[^>]*hidden/);
 assert.match(html,/researchEntry\.hidden = role !== 'edit'/);
 assert.match(css,/\[hidden\]\{display:none!important\}/);
});
test('mobile tabs support arrow navigation, home/end and roving tabindex',()=>{
 assert.match(html,/e\.key==='ArrowRight'/);
 assert.match(html,/e\.key==='ArrowLeft'/);
 assert.match(html,/e\.key==='Home'/);
 assert.match(html,/e\.key==='End'/);
 assert.match(html,/b\.tabIndex =/);
 assert.match(html,/switchTab\(tabs\[next\]\.dataset\.tab,true\)/);
});
test('mobile tab restoration rejects invalid stored names',()=>{
 assert.match(html,/if \(!\['overview','market','plan'\]\.includes\(name\)\) return/);
});
